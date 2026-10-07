import { Router } from 'express';
import { rows, row } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { weekRange } from './attendanceSubmissions.js';

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

export default router;
