import { Router } from 'express';
import db, { generateId } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

function visibleProjects(user) {
  if (user.isGlobalAdmin) return db.data.projects;
  if (user.role === 'supervisor') return db.data.projects.filter((p) => p.department === user.department);
  // employees see projects tied to tasks assigned to them, plus their department's active projects
  return db.data.projects.filter((p) => p.department === user.department);
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

export default router;
