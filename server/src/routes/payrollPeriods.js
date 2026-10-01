import { Router } from 'express';
import db, { generateId } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { canAccessProject } from './projects.js';

const router = Router();

// The digital sign-off chain, in order — mirrors the paper sheet's
// Prepared/Checked/Approved lines: a supervisor submits the week once it's
// done, Finance checks the numbers, and an admin gives final approval,
// which locks that week's attendance from further edits.

function visiblePeriods(user) {
  if (user.isGlobalAdmin || user.role === 'finance') return db.data.payrollPeriods;
  if (user.role === 'supervisor') {
    const deptProjectIds = db.data.projects.filter((p) => p.department === user.department).map((p) => p.id);
    return db.data.payrollPeriods.filter((pp) => deptProjectIds.includes(pp.projectId));
  }
  // employee — only periods for the project(s) they're assigned to, so they
  // can see "this week is locked" without seeing company-wide payroll state
  const assignedIds = db.data.projects.filter((p) => (p.assignedEmployees || []).includes(user.id)).map((p) => p.id);
  return db.data.payrollPeriods.filter((pp) => assignedIds.includes(pp.projectId));
}

router.get('/', requireAuth, (req, res) => {
  let periods = visiblePeriods(req.user);
  const { projectId, status } = req.query;
  if (projectId) periods = periods.filter((pp) => pp.projectId === projectId);
  if (status) periods = periods.filter((pp) => pp.status === status);
  res.json({ periods });
});

// Returns whether a given project/date falls inside an approved (locked)
// period — used by worker-attendance to block edits on finalized weeks.
export function findLockedPeriod(projectId, date) {
  return db.data.payrollPeriods.find(
    (pp) => pp.projectId === projectId && pp.status === 'approved' && date >= pp.weekStart && date <= pp.weekEnd
  );
}

// Supervisor (or admin) submits a week for review — the first sign-off,
// equivalent to a foreman handing the filled-in card to the office.
router.post('/submit', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  const { projectId, weekStart, weekEnd } = req.body;
  if (!projectId || !weekStart || !weekEnd) {
    return res.status(400).json({ error: 'projectId, weekStart and weekEnd are required' });
  }
  const project = db.data.projects.find((p) => p.id === projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!canAccessProject(req.user, project)) {
    return res.status(403).json({ error: "You're not assigned to that project" });
  }

  let period = db.data.payrollPeriods.find((pp) => pp.projectId === projectId && pp.weekStart === weekStart && pp.weekEnd === weekEnd);
  if (period) {
    // Idempotent — re-submitting doesn't regress a period that's already
    // further along the chain.
    return res.json({ period });
  }
  period = {
    id: generateId('pp'),
    projectId,
    department: project.department,
    weekStart,
    weekEnd,
    status: 'submitted',
    submittedBy: req.user.id,
    submittedAt: new Date().toISOString(),
    financeCheckedBy: null,
    financeCheckedAt: null,
    approvedBy: null,
    approvedAt: null,
  };
  db.data.payrollPeriods.push(period);
  await db.write();
  res.status(201).json({ period });
});

// Finance (or admin) checks a submitted week's numbers.
router.put('/:id/finance-check', requireAuth, requireRole('admin', 'finance'), async (req, res) => {
  const period = db.data.payrollPeriods.find((pp) => pp.id === req.params.id);
  if (!period) return res.status(404).json({ error: 'Payroll period not found' });
  if (period.status !== 'submitted') {
    return res.status(400).json({ error: `Can't finance-check a period in "${period.status}" status` });
  }
  period.status = 'finance_checked';
  period.financeCheckedBy = req.user.id;
  period.financeCheckedAt = new Date().toISOString();
  await db.write();
  res.json({ period });
});

// Admin gives final approval — the last sign-off, after which the week's
// attendance is locked and payroll is authorized.
router.put('/:id/approve', requireAuth, requireRole('admin'), async (req, res) => {
  const period = db.data.payrollPeriods.find((pp) => pp.id === req.params.id);
  if (!period) return res.status(404).json({ error: 'Payroll period not found' });
  if (period.status !== 'finance_checked') {
    return res.status(400).json({ error: `Can't approve a period in "${period.status}" status — it needs a finance check first` });
  }
  period.status = 'approved';
  period.approvedBy = req.user.id;
  period.approvedAt = new Date().toISOString();
  await db.write();
  res.json({ period });
});

// Admin-only correction path — reopens an approved/checked period back to
// "submitted" so a mistake can be fixed, same as a manager handing a sheet
// back for correction on paper.
router.put('/:id/reopen', requireAuth, requireRole('admin'), async (req, res) => {
  const period = db.data.payrollPeriods.find((pp) => pp.id === req.params.id);
  if (!period) return res.status(404).json({ error: 'Payroll period not found' });
  if (period.status === 'submitted') return res.json({ period });
  period.status = 'submitted';
  period.financeCheckedBy = null;
  period.financeCheckedAt = null;
  period.approvedBy = null;
  period.approvedAt = null;
  await db.write();
  res.json({ period });
});

export default router;
