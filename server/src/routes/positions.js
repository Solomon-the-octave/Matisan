import { Router } from 'express';
import { notify } from '../notify.js';
import { rows, row, query, generateId } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { canAccessProject } from './projects.js';

const router = Router();

const PM = 'site-project-manager';

// Everyone signed in can see the structure (names and seats only — it is
// the company's own chart, same as the paper on the wall).
router.get('/', requireAuth, async (req, res) => {
  const positions = await rows('SELECT * FROM positions ORDER BY type, "sortOrder"');
  res.json({ positions });
});

// Head office seats and who holds them.
router.get('/head-office', requireAuth, async (req, res) => {
  const assignments = await rows(
    `SELECT a."positionId", a."userId", u.name AS "userName", u.title AS "userTitle"
     FROM head_office_position_assignments a JOIN users u ON u.id = a."userId"`
  );
  res.json({ assignments });
});

router.put('/head-office/:positionId', requireAuth, requireRole('admin'), async (req, res) => {
  const position = await row("SELECT * FROM positions WHERE id = $1 AND type = 'head_office'", [req.params.positionId]);
  if (!position) return res.status(404).json({ error: 'Position not found' });
  const { userId } = req.body; // null/empty clears the seat
  if (!userId) {
    await query('DELETE FROM head_office_position_assignments WHERE "positionId" = $1', [position.id]);
  } else {
    const user = await row('SELECT id FROM users WHERE id = $1', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    await query(
      `INSERT INTO head_office_position_assignments (id, "positionId", "userId") VALUES ($1,$2,$3)
       ON CONFLICT ("positionId") DO UPDATE SET "userId" = EXCLUDED."userId"`,
      [generateId('hop'), position.id, userId]
    );
    await notify([userId], { type: 'assignment', title: `You are now ${position.name} (Head Office)`, body: 'You will be asked to act on payroll requests at your step.', link: '/dashboard' });
  }
  const assignments = await rows(
    `SELECT a."positionId", a."userId", u.name AS "userName", u.title AS "userTitle"
     FROM head_office_position_assignments a JOIN users u ON u.id = a."userId"`
  );
  res.json({ assignments });
});

// The team on one project: every site seat, with the person (or null).
// The Project Manager seat reads from the project's responsible person
// (managerId) so there is only one source of truth for it.
async function projectTeam(project) {
  const positions = await rows("SELECT * FROM positions WHERE type = 'site' ORDER BY \"sortOrder\"");
  const assigned = await rows(
    `SELECT a."positionId", a."userId", u.name AS "userName", u.title AS "userTitle"
     FROM project_position_assignments a JOIN users u ON u.id = a."userId"
     WHERE a."projectId" = $1`,
    [project.id]
  );
  const byPos = new Map(assigned.map((a) => [a.positionId, a]));
  if (project.managerId) {
    const mgr = await row('SELECT id, name, title FROM users WHERE id = $1', [project.managerId]);
    if (mgr) byPos.set(PM, { positionId: PM, userId: mgr.id, userName: mgr.name, userTitle: mgr.title });
  }
  return positions.map((p) => ({ ...p, userId: byPos.get(p.id)?.userId || null, userName: byPos.get(p.id)?.userName || null, userTitle: byPos.get(p.id)?.userTitle || null }));
}

async function loadProject(id) {
  return row(
    `SELECT p.*, COALESCE((SELECT array_agg(pa."userId") FROM project_assignments pa WHERE pa."projectId" = p.id), ARRAY[]::text[]) AS "assignedEmployees"
     FROM projects p WHERE p.id = $1`,
    [id]
  );
}

router.get('/projects/:projectId', requireAuth, async (req, res) => {
  const project = await loadProject(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  // Finance and any head-office seat holder may also view a project team.
  const hoSeat = await row('SELECT 1 AS x FROM head_office_position_assignments WHERE "userId" = $1', [req.user.id]);
  if (!(canAccessProject(req.user, project) || req.user.role === 'finance' || hoSeat)) {
    return res.status(403).json({ error: "You're not assigned to that project" });
  }
  res.json({ team: await projectTeam(project) });
});

// Admin assigns a person to a site seat on a project. Whoever is chosen is
// also added to the project's assigned team so they can see the project.
router.put('/projects/:projectId/:positionId', requireAuth, requireRole('admin'), async (req, res) => {
  const project = await loadProject(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const position = await row("SELECT * FROM positions WHERE id = $1 AND type = 'site'", [req.params.positionId]);
  if (!position) return res.status(404).json({ error: 'Position not found' });
  const { userId } = req.body;

  if (position.id === PM) {
    if (userId) {
      const u = await row('SELECT * FROM users WHERE id = $1', [userId]);
      if (!u) return res.status(404).json({ error: 'User not found' });
      if (!['supervisor', 'admin'].includes(u.role)) {
        return res.status(400).json({ error: 'The Project Manager must be a supervisor or admin' });
      }
    }
    await query('UPDATE projects SET "managerId" = $1 WHERE id = $2', [userId || null, project.id]);
  } else if (!userId) {
    await query('DELETE FROM project_position_assignments WHERE "projectId" = $1 AND "positionId" = $2', [project.id, position.id]);
  } else {
    const u = await row('SELECT * FROM users WHERE id = $1', [userId]);
    if (!u) return res.status(404).json({ error: 'User not found' });
    await query(
      `INSERT INTO project_position_assignments (id, "projectId", "positionId", "userId") VALUES ($1,$2,$3,$4)
       ON CONFLICT ("projectId", "positionId") DO UPDATE SET "userId" = EXCLUDED."userId"`,
      [generateId('ppa'), project.id, position.id, userId]
    );
    // Employees only see projects they're assigned to.
    if (u.role === 'employee') {
      await query('INSERT INTO project_assignments ("projectId", "userId") VALUES ($1,$2) ON CONFLICT DO NOTHING', [project.id, userId]);
    }
    await notify([userId], { type: 'assignment', title: `You are now ${position.name} on ${project.name}`, body: 'Open your dashboard to see your project.', link: '/dashboard' });
  }
  res.json({ team: await projectTeam(await loadProject(project.id)) });
});

// A user's own positions — shown on their profile / dashboard.
router.get('/mine', requireAuth, async (req, res) => {
  const site = await rows(
    `SELECT a."projectId", p.name AS "projectName", a."positionId", pos.name AS "positionName"
     FROM project_position_assignments a
     JOIN projects p ON p.id = a."projectId" JOIN positions pos ON pos.id = a."positionId"
     WHERE a."userId" = $1`,
    [req.user.id]
  );
  const headOffice = await rows(
    `SELECT a."positionId", pos.name AS "positionName"
     FROM head_office_position_assignments a JOIN positions pos ON pos.id = a."positionId"
     WHERE a."userId" = $1`,
    [req.user.id]
  );
  const managed = await rows('SELECT id AS "projectId", name AS "projectName" FROM projects WHERE "managerId" = $1', [req.user.id]);
  res.json({ site, headOffice, managed });
});

export default router;
