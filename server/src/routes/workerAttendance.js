import { Router } from 'express';
import db, { generateId } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { canAccessProject } from './projects.js';
import { findLockedPeriod } from './payrollPeriods.js';
import { laborType } from '../laborStructure.js';

const router = Router();

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function assignedProjectIds(user) {
  return db.data.projects.filter((p) => (p.assignedEmployees || []).includes(user.id)).map((p) => p.id);
}

function visibleRecords(user) {
  if (user.isGlobalAdmin || user.role === 'finance') return db.data.workerAttendance;
  if (user.role === 'employee') {
    const ids = assignedProjectIds(user);
    return db.data.workerAttendance.filter((r) => r.department === user.department && ids.includes(r.projectId));
  }
  return db.data.workerAttendance.filter((r) => r.department === user.department);
}

// List today's (or a given date's) roster for a project — this is what the
// head office / site registrar sees: who's on site right now.
router.get('/', requireAuth, (req, res) => {
  let records = visibleRecords(req.user);
  const { date, projectId } = req.query;
  if (date) records = records.filter((r) => r.date === date);
  if (projectId) records = records.filter((r) => r.projectId === projectId);
  res.json({ attendance: records });
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

  const worker = db.data.workers.find((w) => w.id === workerId);
  if (!worker) return res.status(404).json({ error: 'Worker not found' });
  if (!req.user.isGlobalAdmin && worker.department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }

  const effectiveProjectId = projectId || worker.projectId || null;
  if (effectiveProjectId) {
    const project = db.data.projects.find((p) => p.id === effectiveProjectId);
    if (!project || !canAccessProject(req.user, project)) {
      return res.status(403).json({ error: "You're not assigned to that project" });
    }
  } else if (req.user.role === 'employee') {
    // An employee always needs a specific site to mark attendance against.
    return res.status(400).json({ error: 'A project/site is required' });
  }

  const day = date || todayStr();
  if (effectiveProjectId && findLockedPeriod(effectiveProjectId, day) && !req.user.isGlobalAdmin) {
    return res.status(423).json({ error: 'This week has been approved and is locked. Ask an admin to reopen it.' });
  }
  const existing = db.data.workerAttendance.find((r) => r.workerId === workerId && r.date === day);
  if (existing) {
    return res.json({ attendance: existing, alreadyRegistered: true });
  }

  const record = {
    id: generateId('wa'),
    workerId,
    projectId: effectiveProjectId,
    department: worker.department,
    date: day,
    // Default a quick "mark present" tap to a full day; either half (or an
    // explicit half-day registration) can override.
    am: am === undefined ? true : !!am,
    pm: pm === undefined ? true : !!pm,
    otHours: otHours ? Number(otHours) : 0,
    registeredBy: req.user.id,
    registeredAt: new Date().toISOString(),
  };
  db.data.workerAttendance.push(record);
  // Keep the worker's "home" project current so next time they're the
  // default suggestion for that site.
  if (projectId) worker.projectId = projectId;
  await db.write();
  res.status(201).json({ attendance: record });
});

// Adjust an existing day's record — toggle Morning/Afternoon or log OT
// hours, the same correction a foreman would make by hand on the card.
router.put('/:id', requireAuth, async (req, res) => {
  const record = db.data.workerAttendance.find((r) => r.id === req.params.id);
  if (!record) return res.status(404).json({ error: 'Attendance record not found' });
  if (!req.user.isGlobalAdmin && record.department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }
  if (req.user.role === 'employee') {
    const ids = assignedProjectIds(req.user);
    if (!ids.includes(record.projectId)) {
      return res.status(403).json({ error: "You're not assigned to that project" });
    }
  }
  if (record.projectId && findLockedPeriod(record.projectId, record.date) && !req.user.isGlobalAdmin) {
    return res.status(423).json({ error: 'This week has been approved and is locked. Ask an admin to reopen it.' });
  }
  const { am, pm, otHours } = req.body;
  if (am !== undefined) record.am = !!am;
  if (pm !== undefined) record.pm = !!pm;
  if (otHours !== undefined) record.otHours = Number(otHours) || 0;
  await db.write();
  res.json({ attendance: record });
});

// Lightweight running payroll: for each worker, how many days they've been
// marked present (optionally within a date range / project) and what that
// adds up to at their day rate.
router.get('/payroll', requireAuth, (req, res) => {
  const { projectId, from, to } = req.query;
  let records = visibleRecords(req.user);
  if (projectId) records = records.filter((r) => r.projectId === projectId);
  if (from) records = records.filter((r) => r.date >= from);
  if (to) records = records.filter((r) => r.date <= to);

  const byWorker = new Map();
  for (const r of records) {
    const prior = byWorker.get(r.workerId) || { days: 0, otHours: 0 };
    // Half a day for Morning, half for Afternoon — same as reading a paper
    // attendance card where AM and PM are marked separately.
    prior.days += (r.am ? 0.5 : 0) + (r.pm ? 0.5 : 0);
    prior.otHours += r.otHours || 0;
    byWorker.set(r.workerId, prior);
  }

  const workers = req.user.isGlobalAdmin || req.user.role === 'finance'
    ? db.data.workers
    : db.data.workers.filter((w) => w.department === req.user.department);

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

  res.json({
    payroll,
    totals: {
      workers: payroll.length,
      daysPresent: payroll.reduce((s, p) => s + p.daysPresent, 0),
      otHours: payroll.reduce((s, p) => s + p.otHours, 0),
      cost: payroll.reduce((s, p) => s + (p.total || 0), 0),
      byLaborType,
    },
  });
});

export default router;
