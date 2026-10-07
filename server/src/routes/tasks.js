import { Router } from 'express';
import multer from 'multer';
import { notify } from '../notify.js';
import { rows, row, query, generateId } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const PRIORITIES = ['low', 'medium', 'high'];

// Every task row with its attachment count and the names/department of the
// people involved, so the list can show details without extra requests.
const TASK_SELECT = `
  SELECT t.*,
    (SELECT count(*)::int FROM task_documents d WHERE d."taskId" = t.id) AS "attachmentCount",
    au.name AS "assignedToName", cu.name AS "createdByName", p.name AS "projectName"
  FROM tasks t
  LEFT JOIN users au ON au.id = t."assignedTo"
  LEFT JOIN users cu ON cu.id = t."createdBy"
  LEFT JOIN projects p ON p.id = t."projectId"
`;

async function validateTaskTargets({ department, assignedTo, projectId }) {
  const assignee = await row('SELECT * FROM users WHERE id = $1', [assignedTo]);
  if (!assignee) return 'Responsible person not found';
  if (assignee.department !== department) return 'Responsible person must belong to the selected department';
  if (projectId) {
    const project = await row('SELECT department FROM projects WHERE id = $1', [projectId]);
    if (!project) return 'Project not found';
    if (project.department !== department) return 'Project belongs to a different department';
  }
  return null;
}

async function loadAccessibleTask(user, id) {
  const task = await row('SELECT * FROM tasks WHERE id = $1', [id]);
  if (!task) return { error: [404, 'Task not found'] };
  const canManage = user.isGlobalAdmin || (user.role === 'supervisor' && task.department === user.department);
  if (!canManage && task.assignedTo !== user.id) return { error: [403, 'Not authorized for this task'] };
  return { task, canManage };
}

function visibleTasks(user) {
  if (user.isGlobalAdmin) return rows(`${TASK_SELECT} ORDER BY t."createdAt" DESC`);
  if (user.role === 'supervisor') {
    return rows(`${TASK_SELECT} WHERE t.department = $1 ORDER BY t."createdAt" DESC`, [user.department]);
  }
  return rows(`${TASK_SELECT} WHERE t."assignedTo" = $1 ORDER BY t."createdAt" DESC`, [user.id]);
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
  if (priority && !PRIORITIES.includes(priority)) return res.status(400).json({ error: 'Invalid priority' });
  const targetErr = await validateTaskTargets({ department, assignedTo, projectId });
  if (targetErr) return res.status(400).json({ error: targetErr });
  const id = generateId('t');
  await query(
    `INSERT INTO tasks (id, title, description, "projectId", department, "assignedTo", "createdBy", priority, status, "dueDate")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'created',$9)`,
    [id, title, description || '', projectId || null, department, assignedTo, req.user.id, priority || 'medium', dueDate || null]
  );
  await notify(assignedTo === req.user.id ? [] : [assignedTo], { type: 'task', title: `New task: ${String(title).slice(0, 80)}`, body: dueDate ? `Due ${dueDate}` : null, link: '/tasks' });
  res.status(201).json({ task: await row(`${TASK_SELECT} WHERE t.id = $1`, [id]) });
});

router.put('/:id', requireAuth, async (req, res) => {
  const task = await row('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const isOwner = task.assignedTo === req.user.id;
  const canManage = req.user.isGlobalAdmin || (req.user.role === 'supervisor' && task.department === req.user.department);
  if (!isOwner && !canManage) return res.status(403).json({ error: 'Not authorized to update this task' });

  const { status, priority, dueDate, title, description, assignedTo } = req.body;
  if (isOwner && !canManage) {
    // Employees may only move their own task through the workflow states.
    const allowed = ['in_progress', 'submitted'];
    if (status && !allowed.includes(status)) {
      return res.status(403).json({ error: 'You can only mark a task in progress or submitted' });
    }
    if (status) await query('UPDATE tasks SET status = $1 WHERE id = $2', [status, task.id]);
  } else {
    if (assignedTo && assignedTo !== task.assignedTo) {
      const targetErr = await validateTaskTargets({ department: task.department, assignedTo, projectId: task.projectId });
      if (targetErr) return res.status(400).json({ error: targetErr });
      await query('UPDATE tasks SET "assignedTo" = $1 WHERE id = $2', [assignedTo, task.id]);
      if (assignedTo !== req.user.id) await notify([assignedTo], { type: 'task', title: `New task: ${String(task.title).slice(0, 80)}`, body: task.dueDate ? `Due ${task.dueDate}` : null, link: '/tasks' });
    }
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
  res.json({ task: await row(`${TASK_SELECT} WHERE t.id = $1`, [task.id]) });
});

// --- Task attachments -----------------------------------------------------
// Managers (admin / own-department supervisor) attach files; the manager and
// the person the task is assigned to can list and download them.
const DOC_COLUMNS = `d.id, d.filename, d."mimeType", d.size, d."uploadedAt", u.name AS "uploadedByName"`;
const listDocs = (taskId) =>
  rows(
    `SELECT ${DOC_COLUMNS} FROM task_documents d LEFT JOIN users u ON u.id = d."uploadedBy"
     WHERE d."taskId" = $1 ORDER BY d."uploadedAt" DESC`,
    [taskId]
  );

router.get('/:id/documents', requireAuth, async (req, res) => {
  const { task, error } = await loadAccessibleTask(req.user, req.params.id);
  if (error) return res.status(error[0]).json({ error: error[1] });
  res.json({ documents: await listDocs(task.id) });
});

router.post('/:id/documents', requireAuth, requireRole('admin', 'supervisor'), upload.single('file'), async (req, res) => {
  const { task, canManage, error } = await loadAccessibleTask(req.user, req.params.id);
  if (error) return res.status(error[0]).json({ error: error[1] });
  if (!canManage) return res.status(403).json({ error: 'Outside your department access point' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  await query(
    `INSERT INTO task_documents (id, "taskId", filename, "mimeType", size, data, "uploadedBy")
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [generateId('tdoc'), task.id, req.file.originalname, req.file.mimetype, req.file.size, req.file.buffer, req.user.id]
  );
  res.status(201).json({ documents: await listDocs(task.id) });
});

router.get('/:id/documents/:docId', requireAuth, async (req, res) => {
  const { task, error } = await loadAccessibleTask(req.user, req.params.id);
  if (error) return res.status(error[0]).json({ error: error[1] });
  const doc = await row('SELECT * FROM task_documents WHERE id = $1 AND "taskId" = $2', [req.params.docId, task.id]);
  if (!doc) return res.status(404).json({ error: 'Attachment not found' });
  res.setHeader('Content-Type', doc.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.filename)}"`);
  res.send(doc.data);
});

router.delete('/:id/documents/:docId', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  const { task, canManage, error } = await loadAccessibleTask(req.user, req.params.id);
  if (error) return res.status(error[0]).json({ error: error[1] });
  if (!canManage) return res.status(403).json({ error: 'Outside your department access point' });
  await query('DELETE FROM task_documents WHERE id = $1 AND "taskId" = $2', [req.params.docId, task.id]);
  res.status(204).end();
});

export default router;
