import { Router } from 'express';
import { rows, row, query, generateId } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { canAccessProject } from './projects.js';
import { findLockedPeriod } from './payrollPeriods.js';
import { laborType } from '../laborStructure.js';

const router = Router();

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

async function assignedProjectIds(user) {
  const r = await rows('SELECT "projectId" FROM project_assignments WHERE "userId" = $1', [user.id]);
  return r.map((x) => x.projectId);
}

async function visibleRecords(user, { date, projectId } = {}) {
  const clauses = [];
  const args = [];
  if (user.isGlobalAdmin || user.role === 'finance') {
    // no department restriction
  } else if (user.role === 'employee') {
    const ids = await assignedProjectIds(user);
    args.push(user.department);
    clauses.push(`department = $${args.length}`);
    if (ids.length === 0) return [];
    args.push(ids);
    clauses.push(`"projectId" = ANY($${args.length})`);
  } else {
    args.push(user.department);
    clauses.push(`department = $${args.length}`);
  }
  if (date) {
    args.push(date);
    clauses.push(`date = $${args.length}`);
  }
  if (projectId) {
    args.push(projectId);
    clauses.push(`"projectId" = $${args.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return rows(`SELECT * FROM worker_attendance ${where} ORDER BY date DESC`, args);
}

// List today's (or a given date's) roster for a project — this is what the
// head office / site registrar sees: who's on site right now.
router.get('/', requireAuth, async (req, res) => {
  const { date, projectId } = req.query;
  res.json({ attendance: await visibleRecords(req.user, { date, projectId }) });
});

// Register a worker as present today (or on a given date). Idempotent: if
// this worker is already marked present that day, hands back the existing
// record instead of creating a duplicate. Mirrors the paper attendance
// card/sheet: a Morning half, an Afternoon half, and OT hours — a quick
// "mark present" tap defaults to a full day (both halves), and either half
// or the OT hours can be adjusted afterwards from the roster.
router.post('/', requireAuth, async (req, res) => {
  const { workerId, projectId, date, am, pm, otHours } = req.body;
  if (!workerId) return res.status(400).json({ error: 'workerId is required' });

  const worker = await row('SELECT * FROM workers WHERE id = $1', [workerId]);
  if (!worker) return res.status(404).json({ error: 'Worker not found' });
  if (!req.user.isGlobalAdmin && worker.department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }

  const effectiveProjectId = projectId || worker.projectId || null;
  if (effectiveProjectId) {
    const project = await row(
      `SELECT p.*, COALESCE((SELECT array_agg(pa."userId") FROM project_assignments pa WHERE pa."projectId" = p.id), ARRAY[]::text[]) AS "assignedEmployees" FROM projects p WHERE p.id = $1`,
      [effectiveProjectId]
    );
    if (!project || !canAccessProject(req.user, project)) {
      return res.status(403).json({ error: "You're not assigned to that project" });
    }
  } else if (req.user.role === 'employee') {
    // An employee always needs a specific site to mark attendance against.
    return res.status(400).json({ error: 'A project/site is required' });
  }

  const day = date || todayStr();
  if (effectiveProjectId && !req.user.isGlobalAdmin && (await findLockedPeriod(effectiveProjectId, day))) {
    return res.status(423).json({ error: 'This week has been approved and is locked. Ask an admin to reopen it.' });
  }
  const existing = await row('SELECT * FROM worker_attendance WHERE "workerId" = $1 AND date = $2', [workerId, day]);
  if (existing) {
    return res.json({ attendance: existing, alreadyRegistered: true });
  }

  const id = generateId('wa');
  await query(
    `INSERT INTO worker_attendance (id, "workerId", "projectId", department, date, am, pm, "otHours", "registeredBy", "registeredAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`,
    [
      id,
      workerId,
      effectiveProjectId,
      worker.department,
      day,
      // Default a quick "mark present" tap to a full day; either half (or an
      // explicit half-day registration) can override.
      am === undefined ? true : !!am,
      pm === undefined ? true : !!pm,
      otHours ? Number(otHours) : 0,
      req.user.id,
    ]
  );
  // Keep the worker's "home" project current so next time they're the
  // default suggestion for that site.
  if (projectId) await query('UPDATE workers SET "projectId" = $1 WHERE id = $2', [projectId, workerId]);

  res.status(201).json({ attendance: await row('SELECT * FROM worker_attendance WHERE id = $1', [id]) });
});

// Adjust an existing day's record — toggle Morning/Afternoon or log OT
// hours, the same correction a foreman would make by hand on the card.
router.put('/:id', requireAuth, async (req, res) => {
  const record = await row('SELECT * FROM worker_attendance WHERE id = $1', [req.params.id]);
  if (!record) return res.status(404).json({ error: 'Attendance record not found' });
  if (!req.user.isGlobalAdmin && record.department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }
  if (req.user.role === 'employee') {
    const ids = await assignedProjectIds(req.user);
    if (!ids.includes(record.projectId)) {
      return res.status(403).json({ error: "You're not assigned to that project" });
    }
  }
  if (record.projectId && !req.user.isGlobalAdmin && (await findLockedPeriod(record.projectId, record.date))) {
    return res.status(423).json({ error: 'This week has been approved and is locked. Ask an admin to reopen it.' });
  }
  const { am, pm, otHours } = req.body;
  await query(
    `UPDATE worker_attendance SET
       am = CASE WHEN $1::boolean THEN $2 ELSE am END,
       pm = CASE WHEN $3::boolean THEN $4 ELSE pm END,
       "otHours" = CASE WHEN $5::boolean THEN $6 ELSE "otHours" END
     WHERE id = $7`,
    [am !== undefined, !!am, pm !== undefined, !!pm, otHours !== undefined, Number(otHours) || 0, record.id]
  );
  res.json({ attendance: await row('SELECT * FROM worker_attendance WHERE id = $1', [record.id]) });
});

// Shared by the on-screen "/payroll" view and the "/export" CSV download so
// the two can never drift apart — same numbers, same rules, two formats.
async function computePayroll(user, { projectId, from, to } = {}) {
  const clauses = [];
  const args = [];
  if (!(user.isGlobalAdmin || user.role === 'finance')) {
    args.push(user.department);
    clauses.push(`department = $${args.length}`);
  }
  if (projectId) {
    args.push(projectId);
    clauses.push(`"projectId" = $${args.length}`);
  }
  if (from) {
    args.push(from);
    clauses.push(`date >= $${args.length}`);
  }
  if (to) {
    args.push(to);
    clauses.push(`date <= $${args.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const records = await rows(`SELECT * FROM worker_attendance ${where}`, args);

  const byWorker = new Map();
  for (const r of records) {
    const prior = byWorker.get(r.workerId) || { days: 0, otHours: 0 };
    // Half a day for Morning, half for Afternoon — same as reading a paper
    // attendance card where AM and PM are marked separately.
    prior.days += (r.am ? 0.5 : 0) + (r.pm ? 0.5 : 0);
    prior.otHours += r.otHours || 0;
    byWorker.set(r.workerId, prior);
  }

  const workers = user.isGlobalAdmin || user.role === 'finance'
    ? await rows('SELECT * FROM workers')
    : await rows('SELECT * FROM workers WHERE department = $1', [user.department]);

  const payroll = workers
    .filter((w) => byWorker.has(w.id))
    .map((w) => {
      const { days: daysPresent, otHours } = byWorker.get(w.id) || { days: 0, otHours: 0 };
      const hourlyRate = w.dailyRate ? w.dailyRate / 8 : null;
      // OT paid at 1.5x the base hourly rate — standard OT premium; adjust
      // here if the company's policy differs.
      const otPay = hourlyRate ? Math.round(hourlyRate * 1.5 * otHours * 100) / 100 : 0;
      const basePay = w.dailyRate ? Math.round(w.dailyRate * daysPresent * 100) / 100 : null;
      return {
        workerId: w.id,
        name: w.name,
        trade: w.trade,
        laborType: laborType(w.trade),
        dailyRate: w.dailyRate,
        bankAccount: w.bankAccount || null,
        daysPresent,
        otHours,
        total: basePay != null ? Math.round((basePay + otPay) * 100) / 100 : null,
      };
    })
    .sort((a, b) => b.daysPresent - a.daysPresent);

  // Headquarters tracks payroll cost split by the Labor Structure chart's
  // two categories (Skilled / Non-Skilled), same split as the payroll sheet.
  const byLaborType = { Skilled: { workers: 0, daysPresent: 0, otHours: 0, cost: 0 }, 'Non-Skilled': { workers: 0, daysPresent: 0, otHours: 0, cost: 0 } };
  for (const p of payroll) {
    const bucket = byLaborType[p.laborType];
    bucket.workers += 1;
    bucket.daysPresent += p.daysPresent;
    bucket.otHours += p.otHours;
    bucket.cost += p.total || 0;
  }
  for (const key of Object.keys(byLaborType)) {
    byLaborType[key].cost = Math.round(byLaborType[key].cost * 100) / 100;
  }

  return {
    payroll,
    totals: {
      workers: payroll.length,
      daysPresent: payroll.reduce((s, p) => s + p.daysPresent, 0),
      otHours: payroll.reduce((s, p) => s + p.otHours, 0),
      cost: payroll.reduce((s, p) => s + (p.total || 0), 0),
      byLaborType,
    },
  };
}

router.get('/payroll', requireAuth, async (req, res) => {
  const { projectId, from, to } = req.query;
  res.json(await computePayroll(req.user, { projectId, from, to }));
});

// CSV downloads matching the paper sheets column-for-column, so a supervisor
// or admin can hand over exactly what they used to print and sign.
// type=weekly-sheet -> Daily Labors Attendance Sheet (one project + week,
//   M/A/OT per day). type=payroll (default) -> Daily Labors Payroll Sheet.
router.get('/export', requireAuth, async (req, res) => {
  const { projectId, from, to, type } = req.query;

  if (projectId) {
    const project = await row(
      `SELECT p.*, COALESCE((SELECT array_agg(pa."userId") FROM project_assignments pa WHERE pa."projectId" = p.id), ARRAY[]::text[]) AS "assignedEmployees" FROM projects p WHERE p.id = $1`,
      [projectId]
    );
    if (!project || !canAccessProject(req.user, project)) {
      return res.status(403).json({ error: "You're not assigned to that project" });
    }
  } else if (!req.user.isGlobalAdmin && req.user.role !== 'finance') {
    return res.status(400).json({ error: 'A project is required' });
  }

  if (type === 'weekly-sheet') {
    if (!projectId || !from || !to) {
      return res.status(400).json({ error: 'projectId, from and to are required for a weekly sheet export' });
    }
    const project = await row('SELECT * FROM projects WHERE id = $1', [projectId]);
    const dates = [];
    const cursor = new Date(from + 'T00:00:00');
    const end = new Date(to + 'T00:00:00');
    while (cursor <= end) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + 1);
    }

    const scopeWorkers = req.user.isGlobalAdmin || req.user.role === 'finance'
      ? await rows('SELECT * FROM workers WHERE "projectId" = $1', [projectId])
      : await rows('SELECT * FROM workers WHERE department = $1 AND "projectId" = $2', [req.user.department, projectId]);

    const records = await rows(
      'SELECT * FROM worker_attendance WHERE "projectId" = $1 AND date = ANY($2)',
      [projectId, dates]
    );
    const byWorkerDate = {};
    records.forEach((r) => {
      byWorkerDate[r.workerId] = byWorkerDate[r.workerId] || {};
      byWorkerDate[r.workerId][r.date] = r;
    });

    const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = [
      'No', 'Name', 'Job Title',
      ...dates.flatMap((d) => [`${d} M`, `${d} A`, `${d} OT`]),
      'Total Working Days', 'Total OT Hours',
    ];
    const lines = [header.map(csvCell).join(',')];
    scopeWorkers.forEach((w, i) => {
      const days = byWorkerDate[w.id] || {};
      let totalDays = 0;
      let totalOT = 0;
      const cells = dates.flatMap((d) => {
        const r = days[d];
        if (r) {
          totalDays += (r.am ? 0.5 : 0) + (r.pm ? 0.5 : 0);
          totalOT += r.otHours || 0;
        }
        return [r?.am ? '1' : '', r?.pm ? '1' : '', r?.otHours || ''];
      });
      lines.push([i + 1, w.name, w.trade || '', ...cells, totalDays, totalOT].map(csvCell).join(','));
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="weekly-sheet-${(project?.name || projectId).replace(/[^a-z0-9]+/gi, '-')}-${from}-to-${to}.csv"`);
    return res.send(lines.join('\n'));
  }

  // Daily Labors Payroll Sheet shape — same numbers as the on-screen
  // Payroll tab / Payroll Review, just handed over as a file.
  const { payroll } = await computePayroll(req.user, { projectId, from, to });
  const project = projectId ? await row('SELECT * FROM projects WHERE id = $1', [projectId]) : null;
  const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = [
    'S/N', 'Name', 'Job Title', 'Labor Type', 'Days', 'Cost per day ETB',
    'Gross Earning ETB', 'Over Time Hour', 'Ordinary Hourly Rate ETB',
    'Overtime Earning', 'Total Payment ETB', 'Account',
  ];
  const lines = [header.map(csvCell).join(',')];
  payroll.forEach((p, i) => {
    const hourlyRate = p.dailyRate ? Math.round((p.dailyRate / 8) * 100) / 100 : '';
    const grossEarning = p.dailyRate ? Math.round(p.dailyRate * p.daysPresent * 100) / 100 : '';
    const otEarning = p.dailyRate && p.otHours ? Math.round((p.dailyRate / 8) * 1.5 * p.otHours * 100) / 100 : '';
    lines.push([
      i + 1, p.name, p.trade || '', p.laborType, p.daysPresent, p.dailyRate ?? '',
      grossEarning, p.otHours || '', hourlyRate, otEarning, p.total ?? '', p.bankAccount || '',
    ].map(csvCell).join(','));
  });

  res.setHeader('Content-Type', 'text/csv');
  const label = project ? project.name.replace(/[^a-z0-9]+/gi, '-') : 'all-projects';
  const range = from && to ? `-${from}-to-${to}` : '';
  res.setHeader('Content-Disposition', `attachment; filename="payroll-${label}${range}.csv"`);
  res.send(lines.join('\n'));
});

export default router;
