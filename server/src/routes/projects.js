import { Router } from 'express';
import { rows, row, query, generateId } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// Every project row, with its assigned-employee IDs folded in as an array —
// same shape the client has always received (`project.assignedEmployees`).
const PROJECT_SELECT = `
  SELECT p.*, COALESCE(
    (SELECT array_agg(pa."userId") FROM project_assignments pa WHERE pa."projectId" = p.id),
    ARRAY[]::text[]
  ) AS "assignedEmployees"
  FROM projects p
`;

async function visibleProjects(user) {
  if (user.isGlobalAdmin) return rows(`${PROJECT_SELECT} ORDER BY p.name`);
  // Finance reviews payroll company-wide, same as the paper sheets crossed
  // every department — read-only, no create/edit/assign authority.
  if (user.role === 'finance') return rows(`${PROJECT_SELECT} ORDER BY p.name`);
  if (user.role === 'supervisor') {
    return rows(`${PROJECT_SELECT} WHERE p.department = $1 ORDER BY p.name`, [user.department]);
  }
  // Employees only see the specific project(s) a supervisor assigned them
  // to — not their whole department's sites. That's the boundary for
  // showing up on their phone and marking attendance for the right site.
  return rows(
    `${PROJECT_SELECT} WHERE p.id IN (SELECT "projectId" FROM project_assignments WHERE "userId" = $1) ORDER BY p.name`,
    [user.id]
  );
}

async function getProject(id) {
  return row(`${PROJECT_SELECT} WHERE p.id = $1`, [id]);
}

// Shared by other routes (workers, worker-attendance) that need to check
// whether a user may act on a given project, not just list projects.
export function canAccessProject(user, project) {
  if (!project) return false;
  if (user.isGlobalAdmin) return true;
  if (user.role === 'employee') return (project.assignedEmployees || []).includes(user.id);
  return project.department === user.department; // supervisor
}

router.get('/', requireAuth, async (req, res) => {
  res.json({ projects: await visibleProjects(req.user) });
});

router.post('/', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  const { name, site, department, description, startDate } = req.body;
  if (!name || !department) return res.status(400).json({ error: 'name and department are required' });
  if (!req.user.isGlobalAdmin && department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }
  const id = generateId('p');
  await query(
    `INSERT INTO projects (id, name, site, department, "managerId", status, progress, "startDate", description)
     VALUES ($1,$2,$3,$4,$5,'active',0,$6,$7)`,
    [id, name, site || '', department, req.user.id, startDate || new Date().toISOString().slice(0, 10), description || '']
  );
  res.status(201).json({ project: await getProject(id) });
});

router.put('/:id', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!req.user.isGlobalAdmin && project.department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }
  const { status, progress, description, name, site } = req.body;
  await query(
    `UPDATE projects SET
       status = COALESCE($1, status),
       progress = COALESCE($2, progress),
       description = COALESCE($3, description),
       name = COALESCE($4, name),
       site = COALESCE($5, site)
     WHERE id = $6`,
    [status ?? null, progress ?? null, description ?? null, name ?? null, site ?? null, project.id]
  );
  res.json({ project: await getProject(project.id) });
});

// Assign or unassign an employee to a project's site team. Only the
// project's own supervisor (same department) or an admin can manage this.
router.put('/:id/assignments', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!req.user.isGlobalAdmin && project.department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }
  const { userId, action } = req.body; // action: 'add' | 'remove'
  if (!userId || !['add', 'remove'].includes(action)) {
    return res.status(400).json({ error: 'userId and action ("add" or "remove") are required' });
  }
  const employee = await row('SELECT * FROM users WHERE id = $1', [userId]);
  if (!employee) return res.status(404).json({ error: 'User not found' });
  if (employee.department !== project.department) {
    return res.status(400).json({ error: "That user is outside this project's department" });
  }

  if (action === 'add') {
    await query(
      'INSERT INTO project_assignments ("projectId", "userId") VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [project.id, userId]
    );
  } else {
    await query('DELETE FROM project_assignments WHERE "projectId" = $1 AND "userId" = $2', [project.id, userId]);
  }
  res.json({ project: await getProject(project.id) });
});

export default router;
