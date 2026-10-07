import { Router } from 'express';
import { rows, row } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { weekRange } from './attendanceSubmissions.js';
import { computePayroll } from './workerAttendance.js';
import { APPROVAL_STEPS, LAST_STEP } from '../approvalSteps.js';

// Read-only context for the single adaptive /dashboard: who is signed in,
// which seats (positions) they hold on which projects, and today's site
// attendance numbers for those projects. Role + position + project decide
// what the dashboard shows; nothing here changes any data.
const router = Router();

const todayStr = () => new Date().toISOString().slice(0, 10);

async function siteSummary(project) {
  const today = todayStr();
  const { start } = weekRange(today);
  const registered = (await row('SELECT count(*)::int AS n FROM workers WHERE "projectId" = $1', [project.projectId])).n;
  const t = await row(
    `SELECT count(*) FILTER (WHERE am)::int AS "presentAM",
            count(*) FILTER (WHERE pm)::int AS "presentPM",
            count(*) FILTER (WHERE am OR pm)::int AS present
     FROM worker_attendance WHERE "projectId" = $1 AND date = $2`,
    [project.projectId, today]
  );
  const daily = await row(
    `SELECT status FROM attendance_submissions WHERE "projectId" = $1 AND type = 'daily' AND "periodStart" = $2`,
    [project.projectId, today]
  );
  const weekly = await row(
    `SELECT status FROM attendance_submissions WHERE "projectId" = $1 AND type = 'weekly' AND "periodStart" = $2`,
    [project.projectId, start]
  );
  const returned = (await row(
    `SELECT count(*)::int AS n FROM attendance_submissions WHERE "projectId" = $1 AND status = 'returned'`,
    [project.projectId]
  )).n;
  return {
    ...project,
    date: today,
    registered,
    presentAM: t.presentAM,
    presentPM: t.presentPM,
    absent: Math.max(0, registered - t.present),
    dailyStatus: daily?.status || null,
    weeklyStatus: weekly?.status || null,
    returned,
  };
}

router.get('/', requireAuth, async (req, res) => {
  const seats = await rows(
    `SELECT a."projectId", p.name AS "projectName", a."positionId", pos.name AS "positionName"
     FROM project_position_assignments a
     JOIN projects p ON p.id = a."projectId" JOIN positions pos ON pos.id = a."positionId"
     WHERE a."userId" = $1 ORDER BY pos.level, p.name`,
    [req.user.id]
  );
  const headOffice = await rows(
    `SELECT a."positionId", pos.name AS "positionName"
     FROM head_office_position_assignments a JOIN positions pos ON pos.id = a."positionId"
     WHERE a."userId" = $1 ORDER BY pos.level`,
    [req.user.id]
  );

  // Projects this person works on: their site seats, their team assignments,
  // and projects they manage. Admins see the company-wide dashboard instead.
  const byProject = new Map();
  for (const s of seats) {
    const cur = byProject.get(s.projectId) || { projectId: s.projectId, projectName: s.projectName, positions: [] };
    cur.positions.push(s.positionName);
    byProject.set(s.projectId, cur);
  }
  if (!req.user.isGlobalAdmin) {
    const extra = await rows(
      `SELECT p.id AS "projectId", p.name AS "projectName" FROM projects p
       WHERE p.id IN (SELECT "projectId" FROM project_assignments WHERE "userId" = $1)
          OR p."managerId" = $1`,
      [req.user.id]
    );
    for (const p of extra) {
      if (!byProject.has(p.projectId)) byProject.set(p.projectId, { ...p, positions: [] });
    }
  }
  const projects = [];
  for (const p of byProject.values()) projects.push(await siteSummary(p));

  res.json({ role: req.user.role, seats, headOffice, projects });
});

// Company-wide picture for management: admin and anyone holding a Head
// Office seat (GM, Deputy GM, Core Department Manager, Finance...).
router.get('/management', requireAuth, async (req, res) => {
  const hoSeat = await row('SELECT 1 AS x FROM head_office_position_assignments WHERE "userId" = $1', [req.user.id]);
  if (!(req.user.isGlobalAdmin || req.user.role === 'finance' || hoSeat)) {
    return res.json({ visible: false }); // not an error: most people simply have no company overview
  }
  const today = todayStr();
  const activeProjects = (await row("SELECT count(*)::int AS n FROM projects WHERE status = 'active'")).n;
  const totalEmployees = (await row('SELECT count(*)::int AS n FROM users')).n;
  const workersOnSite = (await row('SELECT count(DISTINCT "workerId")::int AS n FROM worker_attendance WHERE date = $1 AND (am OR pm)', [today])).n;
  const open = await rows(
    `SELECT pp.id, pp."requestNo", pp."weekStart", pp."weekEnd", pp."currentStep", pp.status, p.name AS "projectName", pp."projectId"
     FROM payroll_periods pp JOIN projects p ON p.id = pp."projectId"
     WHERE pp.status <> 'paid' ORDER BY pp."weekStart" DESC, pp."requestNo" DESC LIMIT 50`
  );
  const requests = [];
  let awaitingAmount = 0;
  let awaitingCount = 0;
  for (const pp of open) {
    const c = await computePayroll({ isGlobalAdmin: true, role: 'admin' }, { projectId: pp.projectId, from: String(pp.weekStart).slice(0, 10), to: String(pp.weekEnd).slice(0, 10) });
    const amount = c.totals?.cost || 0;
    const def = APPROVAL_STEPS[pp.currentStep - 1];
    if (pp.currentStep === LAST_STEP) { awaitingAmount += amount; awaitingCount += 1; }
    requests.push({ id: pp.id, requestNo: pp.requestNo, projectName: pp.projectName, weekStart: pp.weekStart, weekEnd: pp.weekEnd, step: pp.currentStep, awaiting: def ? def.name : null, amount });
  }
  const paidTotal = Number((await row('SELECT COALESCE(sum("amountPaid"),0) AS t FROM payroll_payments')).t);
  res.json({ visible: true, activeProjects, totalEmployees, workersOnSite, pendingApprovals: open.length, awaitingPaymentCount: awaitingCount, awaitingPaymentAmount: awaitingAmount, paidTotal, requests: requests.slice(0, 12) });
});

export default router;
