import { Router } from 'express';
import { rows, row, query, generateId } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { canAccessProject } from './projects.js';

const router = Router();

// The digital sign-off chain, in order — mirrors the paper sheet's
// Prepared/Checked/Approved lines: a supervisor submits the week once it's
// done, Finance checks the numbers, and an admin gives final approval,
// which locks that week's attendance from further edits.

async function visiblePeriods(user) {
  if (user.isGlobalAdmin || user.role === 'finance') return rows('SELECT * FROM payroll_periods ORDER BY "weekStart" DESC');
  if (user.role === 'supervisor') {
    return rows(
      `SELECT pp.* FROM payroll_periods pp
       WHERE pp."projectId" IN (SELECT id FROM projects WHERE department = $1)
       ORDER BY pp."weekStart" DESC`,
      [user.department]
    );
  }
  // employee — only periods for the project(s) they're assigned to, so they
  // can see "this week is locked" without seeing company-wide payroll state
  return rows(
    `SELECT pp.* FROM payroll_periods pp
     WHERE pp."projectId" IN (SELECT "projectId" FROM project_assignments WHERE "userId" = $1)
     ORDER BY pp."weekStart" DESC`,
    [user.id]
  );
}

router.get('/', requireAuth, async (req, res) => {
  let periods = await visiblePeriods(req.user);
  const { projectId, status } = req.query;
  if (projectId) periods = periods.filter((pp) => pp.projectId === projectId);
  if (status) periods = periods.filter((pp) => pp.status === status);
  res.json({ periods });
});

// Returns whether a given project/date falls inside an approved (locked)
// period — used by worker-attendance to block edits on finalized weeks.
export async function findLockedPeriod(projectId, date) {
  return row(
    `SELECT * FROM payroll_periods
     WHERE "projectId" = $1 AND status = 'approved' AND $2 >= "weekStart" AND $2 <= "weekEnd"`,
    [projectId, date]
  );
}

// Supervisor (or admin) submits a week for review — the first sign-off,
// equivalent to a foreman handing the filled-in card to the office.
router.post('/submit', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  const { projectId, weekStart, weekEnd } = req.body;
  if (!projectId || !weekStart || !weekEnd) {
    return res.status(400).json({ error: 'projectId, weekStart and weekEnd are required' });
  }
  const project = await row('SELECT * FROM projects WHERE id = $1', [projectId]);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!canAccessProject(req.user, { ...project, assignedEmployees: [] })) {
    // Supervisors/admins only reach this point (requireRole above), and
    // canAccessProject for them only checks department/isGlobalAdmin, so an
    // empty assignedEmployees list is fine here.
    return res.status(403).json({ error: "You're not assigned to that project" });
  }

  // Idempotent — re-submitting doesn't regress a period that's already
  // further along the chain.
  const existing = await row(
    'SELECT * FROM payroll_periods WHERE "projectId" = $1 AND "weekStart" = $2 AND "weekEnd" = $3',
    [projectId, weekStart, weekEnd]
  );
  if (existing) return res.json({ period: existing });

  const id = generateId('pp');
  await query(
    `INSERT INTO payroll_periods (id, "projectId", department, "weekStart", "weekEnd", status, "submittedBy", "submittedAt")
     VALUES ($1,$2,$3,$4,$5,'submitted',$6,now())`,
    [id, projectId, project.department, weekStart, weekEnd, req.user.id]
  );
  res.status(201).json({ period: await row('SELECT * FROM payroll_periods WHERE id = $1', [id]) });
});

// Finance (or admin) checks a submitted week's numbers.
router.put('/:id/finance-check', requireAuth, requireRole('admin', 'finance'), async (req, res) => {
  const period = await row('SELECT * FROM payroll_periods WHERE id = $1', [req.params.id]);
  if (!period) return res.status(404).json({ error: 'Payroll period not found' });
  if (period.status !== 'submitted') {
    return res.status(400).json({ error: `Can't finance-check a period in "${period.status}" status` });
  }
  await query(
    `UPDATE payroll_periods SET status = 'finance_checked', "financeCheckedBy" = $1, "financeCheckedAt" = now() WHERE id = $2`,
    [req.user.id, period.id]
  );
  res.json({ period: await row('SELECT * FROM payroll_periods WHERE id = $1', [period.id]) });
});

// Admin gives final approval — the last sign-off, after which the week's
// attendance is locked and payroll is authorized.
router.put('/:id/approve', requireAuth, requireRole('admin'), async (req, res) => {
  const period = await row('SELECT * FROM payroll_periods WHERE id = $1', [req.params.id]);
  if (!period) return res.status(404).json({ error: 'Payroll period not found' });
  if (period.status !== 'finance_checked') {
    return res.status(400).json({ error: `Can't approve a period in "${period.status}" status — it needs a finance check first` });
  }
  await query(
    `UPDATE payroll_periods SET status = 'approved', "approvedBy" = $1, "approvedAt" = now() WHERE id = $2`,
    [req.user.id, period.id]
  );
  res.json({ period: await row('SELECT * FROM payroll_periods WHERE id = $1', [period.id]) });
});

// Admin-only correction path — reopens an approved/checked period back to
// "submitted" so a mistake can be fixed, same as a manager handing a sheet
// back for correction on paper.
router.put('/:id/reopen', requireAuth, requireRole('admin'), async (req, res) => {
  const period = await row('SELECT * FROM payroll_periods WHERE id = $1', [req.params.id]);
  if (!period) return res.status(404).json({ error: 'Payroll period not found' });
  if (period.status === 'submitted') return res.json({ period });
  await query(
    `UPDATE payroll_periods SET status = 'submitted', "financeCheckedBy" = NULL, "financeCheckedAt" = NULL, "approvedBy" = NULL, "approvedAt" = NULL WHERE id = $1`,
    [period.id]
  );
  res.json({ period: await row('SELECT * FROM payroll_periods WHERE id = $1', [period.id]) });
});

export default router;
