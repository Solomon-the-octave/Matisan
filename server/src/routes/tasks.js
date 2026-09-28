import { Router } from 'express';
import db, { generateId } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

function visibleTasks(user) {
  if (user.isGlobalAdmin) return db.data.tasks;
  if (user.role === 'supervisor') return db.data.tasks.filter((t) => t.department === user.department);
  return db.data.tasks.filter((t) => t.assignedTo === user.id);
}

router.get('/', requireAuth, (req, res) => {
  res.json({ tasks: visibleTasks(req.user) });
});

router.post('/', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  const { title, description, projectId, department, assignedTo, priority, dueDate } = req.body;
  if (!title || !department || !assignedTo) {
    return res.status(400).json({ error: 'title, department and assignedTo are required' });
  }
  if (!req.user.isGlobalAdmin && department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }
  const task = {
    id: generateId('t'),
    title,
    description: description || '',
    projectId: projectId || null,
    department,
    assignedTo,
    createdBy: req.user.id,
    priority: priority || 'medium',
    status: 'created',
    dueDate: dueDate || null,
    createdAt: new Date().toISOString(),
  };
  db.data.tasks.push(task);
  await db.write();
  res.status(201).json({ task });
});

router.put('/:id', requireAuth, async (req, res) => {
  const task = db.data.tasks.find((t) => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const isOwner = task.assignedTo === req.user.id;
  const canManage = req.user.isGlobalAdmin || (req.user.role === 'supervisor' && task.department === req.user.department);
  if (!isOwner && !canManage) return res.status(403).json({ error: 'Not authorized to update this task' });

  const { status, priority, dueDate, title, description } = req.body;
  // Employees may only move their own task through the workflow states.
  if (isOwner && !canManage) {
    const allowed = ['in_progress', 'submitted'];
    if (status && !allowed.includes(status)) {
      return res.status(403).json({ error: 'You can only mark a task in progress or submitted' });
    }
    if (status) task.status = status;
  } else {
    if (status) task.status = status;
    if (priority) task.priority = priority;
    if (dueDate !== undefined) task.dueDate = dueDate;
    if (title) task.title = title;
    if (description !== undefined) task.description = description;
  }
  await db.write();
  res.json({ task });
});

export default router;
