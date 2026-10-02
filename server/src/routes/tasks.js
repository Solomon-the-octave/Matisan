import { Router } from 'express';
import { rows, row, query, generateId } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

function visibleTasks(user) {
  if (user.isGlobalAdmin) return rows('SELECT * FROM tasks ORDER BY "createdAt" DESC');
  if (user.role === 'supervisor') {
    return rows('SELECT * FROM tasks WHERE department = $1 ORDER BY "createdAt" DESC', [user.department]);
  }
  return rows('SELECT * FROM tasks WHERE "assignedTo" = $1 ORDER BY "createdAt" DESC', [user.id]);
}

router.get('/', requireAuth, async (req, res) => {
  res.json({ tasks: await visibleTasks(req.user) });
});

router.post('/', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  const { title, description, projectId, department, assignedTo, priority, dueDate } = req.body;
  if (!title || !department || !assignedTo) {
    return res.status(400).json({ error: 'title, department and assignedTo are required' });
  }
  if (!req.user.isGlobalAdmin && department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }
  const id = generateId('t');
  await query(
    `INSERT INTO tasks (id, title, description, "projectId", department, "assignedTo", "createdBy", priority, status, "dueDate")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'created',$9)`,
    [id, title, description || '', projectId || null, department, assignedTo, req.user.id, priority || 'medium', dueDate || null]
  );
  res.status(201).json({ task: await row('SELECT * FROM tasks WHERE id = $1', [id]) });
});

router.put('/:id', requireAuth, async (req, res) => {
  const task = await row('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const isOwner = task.assignedTo === req.user.id;
  const canManage = req.user.isGlobalAdmin || (req.user.role === 'supervisor' && task.department === req.user.department);
  if (!isOwner && !canManage) return res.status(403).json({ error: 'Not authorized to update this task' });

  const { status, priority, dueDate, title, description } = req.body;
  if (isOwner && !canManage) {
    // Employees may only move their own task through the workflow states.
    const allowed = ['in_progress', 'submitted'];
    if (status && !allowed.includes(status)) {
      return res.status(403).json({ error: 'You can only mark a task in progress or submitted' });
    }
    if (status) await query('UPDATE tasks SET status = $1 WHERE id = $2', [status, task.id]);
  } else {
    await query(
      `UPDATE tasks SET
         status = COALESCE($1, status),
         priority = COALESCE($2, priority),
         "dueDate" = CASE WHEN $3::boolean THEN $4 ELSE "dueDate" END,
         title = COALESCE($5, title),
         description = CASE WHEN $6::boolean THEN $7 ELSE description END
       WHERE id = $8`,
      [status ?? null, priority ?? null, dueDate !== undefined, dueDate ?? null, title ?? null, description !== undefined, description ?? null, task.id]
    );
  }
  res.json({ task: await row('SELECT * FROM tasks WHERE id = $1', [task.id]) });
});

export default router;
