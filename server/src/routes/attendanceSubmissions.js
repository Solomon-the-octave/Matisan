import { Router } from 'express';
import { rows, row, query, generateId } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { canAccessProject } from './projects.js';
import { recordWeeklyHandIn, returnWeekToField } from './approvals.js';

const router = Router();

const SELECT = `
  SELECT s.*, p.name AS "projectName", su.name AS "submittedByName", ru.name AS "reviewedByName"
  FROM attendance_submissions s
  JOIN projects p ON p.id = s."projectId"
  LEFT JOIN users su ON su.id = s."submittedBy"
  LEFT JOIN users ru ON ru.id = s."reviewedBy"
`;

const iso = (d) => d.toISOString().slice(0, 10);
const todayStr = () => iso(new Date());

// Monday-Sunday week containing `dateStr` (UTC, same as the rest of the
// attendance code) — the window of the paper weekly sheet.
function weekRange(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay(); // 0 = Sunday
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { start: iso(monday), end: iso(sunday) };
}

async function loadProject(id) {
  return row(
    `SELECT p.*, COALESCE((SELECT array_agg(pa."userId") FROM project_assignments pa WHERE pa."projectId" = p.id), ARRAY[]::text[]) AS "assignedEmployees"
     FROM projects p WHERE p.id = $1`,
    [id]
  );
}

async function visibleSubmissions(user) {
  if (user.isGlobalAdmin || user.role === 'finance') return rows(`${SELECT} ORDER BY s."submittedAt" DESC`);
  if (user.role === 'supervisor') {
    return rows(`${SELECT} WHERE s.department = $1 ORDER BY s."submittedAt" DESC`, [user.department]);
  }
  return rows(
    `${SELECT} WHERE s."projectId" IN (SELECT "projectId" FROM project_assignments WHERE "userId" = $1)
     ORDER BY s."submittedAt" DESC`,
    [user.id]
  );
}

router.get('/', requireAuth, async (req, res) => {
  let list = await visibleSubmissions(req.user);
  const { projectId, status } = req.query;
  if (projectId) list = list.filter((s) => s.projectId === projectId);
  if (status) list = list.filter((s) => s.status === status);
  res.json({ submissions: list });
});

// Handing in a day or a week. Employees assigned to the project (and
// supervisors/admins who want to hand in on a team's behalf) can submit; it
// then shows up for the project's supervisor and for admin.
router.post('/', requireAuth, async (req, res) => {
  if (req.user.role === 'finance') return res.status(403).json({ error: 'Not authorized' });
  const { projectId, type, date, note } = req.body;
  if (!projectId || !['daily', 'weekly'].includes(type)) {
    return res.status(400).json({ error: 'projectId and type ("daily" or "weekly") are required' });
  }
  const project = await loadProject(projectId);
  if (!project || !canAccessProject(req.user, project)) {
    return res.status(403).json({ error: "You're not assigned to that project" });
  }
  const day = date || todayStr();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return res.status(400).json({ error: 'Invalid date' });
  const { start, end } = type === 'weekly' ? weekRange(day) : { start: day, end: day };

  const totals = await row(
    `SELECT count(DISTINCT "workerId")::int AS workers,
            COALESCE(sum(GREATEST(0, (CASE WHEN am THEN 0.5 ELSE 0 END) + (CASE WHEN pm THEN 0.5 ELSE 0 END) - "lateHours" / 8)), 0)::float AS days,
            COALESCE(sum("otHours"), 0)::float AS ot
     FROM worker_attendance WHERE "projectId" = $1 AND date >= $2 AND date <= $3`,
    [projectId, start, end]
  );
  if (!totals.workers) {
    return res.status(400).json({ error: `No attendance registered for ${type === 'weekly' ? 'this week' : 'that day'} yet` });
  }

  const existing = await row(
    'SELECT * FROM attendance_submissions WHERE "projectId" = $1 AND type = $2 AND "periodStart" = $3',
    [projectId, type, start]
  );
  const cleanNote = note ? String(note).slice(0, 500) : null;
  let id;
  if (existing) {
    if (existing.status !== 'returned') {
      return res.status(409).json({ error: 'Already submitted — your supervisor has it' });
    }
    id = existing.id;
    await query(
      `UPDATE attendance_submissions SET status = 'submitted', "submittedBy" = $1, "submittedAt" = now(),
         "employeeNote" = $2, "workerCount" = $3, "daysPresent" = $4, "otHours" = $5,
         "reviewedBy" = NULL, "reviewedAt" = NULL, "reviewNote" = NULL
       WHERE id = $6`,
      [req.user.id, cleanNote, totals.workers, totals.days, totals.ot, id]
    );
  } else {
    id = generateId('sub');
    await query(
      `INSERT INTO attendance_submissions (id, "projectId", department, type, "periodStart", "periodEnd",
         "submittedBy", "employeeNote", "workerCount", "daysPresent", "otHours")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, projectId, project.department, type, start, end, req.user.id, cleanNote, totals.workers, totals.days, totals.ot]
    );
  }
  // The week's hand-in is step 1 (Prepared By) of the approval path.
  if (type === 'weekly') await recordWeeklyHandIn(projectId, start, end, req.user.id);
  res.status(201).json({ submission: await row(`${SELECT} WHERE s.id = $1`, [id]) });
});

async function review(req, res, status) {
  const sub = await row('SELECT * FROM attendance_submissions WHERE id = $1', [req.params.id]);
  if (!sub) return res.status(404).json({ error: 'Submission not found' });
  if (!req.user.isGlobalAdmin && sub.department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }
  if (sub.status !== 'submitted') {
    return res.status(409).json({ error: 'This submission has already been reviewed' });
  }
  const reviewNote = req.body.note ? String(req.body.note).slice(0, 500) : null;
  if (status === 'returned' && !reviewNote) {
    return res.status(400).json({ error: 'Add a note so the team knows what to fix' });
  }
  if (status === 'returned' && sub.type === 'weekly') {
    const back = await returnWeekToField(sub.projectId, sub.periodStart, sub.periodEnd, req.user.id, reviewNote);
    if (!back.ok) return res.status(409).json({ error: back.error });
  }
  await query(
    `UPDATE attendance_submissions SET status = $1, "reviewedBy" = $2, "reviewedAt" = now(), "reviewNote" = $3 WHERE id = $4`,
    [status, req.user.id, reviewNote, sub.id]
  );
  res.json({ submission: await row(`${SELECT} WHERE s.id = $1`, [sub.id]) });
}

router.put('/:id/acknowledge', requireAuth, requireRole('admin', 'supervisor'), (req, res) => review(req, res, 'acknowledged'));
router.put('/:id/return', requireAuth, requireRole('admin', 'supervisor'), (req, res) => review(req, res, 'returned'));

// While a day/week is handed in (waiting or acknowledged), the field team
// can't keep editing it; a "returned" submission unlocks it again.
export async function findSubmissionLock(projectId, date) {
  return row(
    `SELECT * FROM attendance_submissions
     WHERE "projectId" = $1 AND status IN ('submitted','acknowledged') AND $2 >= "periodStart" AND $2 <= "periodEnd"`,
    [projectId, date]
  );
}

export default router;
