import { Router } from 'express';
import db, { generateId } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

function visibleProjects(user) {
  if (user.isGlobalAdmin) return db.data.projects;
  // Finance reviews payroll company-wide, same as the paper sheets crossed
  // every department — read-only, no create/edit/assign authority.
  if (user.role === 'finance') return db.data.projects;
  if (user.role === 'supervisor') return db.data.projects.filter((p) => p.department === user.department);
  // Employees only see the specific project(s) a supervisor assigned them
  // to — not their whole department's sites. That's the boundary for
  // showing up on their phone and marking attendance for the right site.
  return db.data.projects.filter((p) => (p.assignedEmployees || []).includes(user.id));
}

// Shared by other routes (workers, worker-attendance) that need to check
// whether a user may act on a given project, not just list projects.
export function canAccessProject(user, project) {
  if (!project) return false;
  if (user.isGlobalAdmin) return true;
  if (user.role === 'employee') return (project.assignedEmployees || []).includes(user.id);
  return project.department === user.department; // supervisor
}

router.get('/', requireAuth, (req, res) => {
  res.json({ projects: visibleProjects(req.user) });
});

router.post('/', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  const { name, site, department, description, startDate } = req.body;
  if (!name || !department) return res.status(400).json({ error: 'name and department are required' });
  if (!req.user.isGlobalAdmin && department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }
  const project = {
    id: generateId('p'),
    name,
    site: site || '',
    department,
    managerId: req.user.id,
    status: 'active',
    progress: 0,
    startDate: startDate || new Date().toISOString().slice(0, 10),
    description: description || '',
  };
  db.data.projects.push(project);
  await db.write();
  res.status(201).json({ project });
});

router.put('/:id', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  const project = db.data.projects.find((p) => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!req.user.isGlobalAdmin && project.department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }
  const { status, progress, description, name, site } = req.body;
  if (status) project.status = status;
  if (progress !== undefined) project.progress = progress;
  if (description !== undefined) project.description = description;
  if (name) project.name = name;
  if (site !== undefined) project.site = site;
  await db.write();
  res.json({ project });
});

// Assign or unassign an employee to a project's site team. Only the
// project's own supervisor (same department) or an admin can manage this.
router.put('/:id/assignments', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  const project = db.data.projects.find((p) => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!req.user.isGlobalAdmin && project.department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }
  const { userId, action } = req.body; // action: 'add' | 'remove'
  if (!userId || !['add', 'remove'].includes(action)) {
    return res.status(400).json({ error: 'userId and action ("add" or "remove") are required' });
  }
  const employee = db.data.users.find((u) => u.id === userId);
  if (!employee) return res.status(404).json({ error: 'User not found' });
  if (employee.department !== project.department) {
    return res.status(400).json({ error: "That user is outside this project's department" });
  }

  project.assignedEmployees ??= [];
  if (action === 'add') {
    if (!project.assignedEmployees.includes(userId)) project.assignedEmployees.push(userId);
  } else {
    project.assignedEmployees = project.assignedEmployees.filter((id) => id !== userId);
  }
  await db.write();
  res.json({ project });
});

export default router;
