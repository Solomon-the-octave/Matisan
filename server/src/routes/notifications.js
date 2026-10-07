import { Router } from 'express';
import { rows, row, query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  const items = await rows('SELECT * FROM notifications WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 30', [req.user.id]);
  const unread = (await row('SELECT count(*)::int AS n FROM notifications WHERE "userId" = $1 AND "readAt" IS NULL', [req.user.id])).n;
  res.json({ items, unread });
});

router.put('/read-all', requireAuth, async (req, res) => {
  await query('UPDATE notifications SET "readAt" = now() WHERE "userId" = $1 AND "readAt" IS NULL', [req.user.id]);
  res.json({ ok: true });
});

router.put('/:id/read', requireAuth, async (req, res) => {
  const r = await query('UPDATE notifications SET "readAt" = COALESCE("readAt", now()) WHERE id = $1 AND "userId" = $2', [req.params.id, req.user.id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Notification not found' });
  res.json({ ok: true });
});

// Things that need the person's own attention, beyond approvals:
// handed-in sheets sent back to their project, and tasks due soon or late.
router.get('/attention', requireAuth, async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const tasks = await rows(
    `SELECT id, title, "dueDate", status FROM tasks
     WHERE "assignedTo" = $1 AND status IN ('created','in_progress') AND "dueDate" IS NOT NULL AND "dueDate" <> '' AND "dueDate" <= $2
     ORDER BY "dueDate"`,
    [req.user.id, soon]
  );
  const returned = await rows(
    `SELECT s.id, s.type, s."periodStart", s."periodEnd", s."reviewNote", p.name AS "projectName"
     FROM attendance_submissions s JOIN projects p ON p.id = s."projectId"
     WHERE s.status = 'returned' AND s."projectId" IN (
       SELECT "projectId" FROM project_assignments WHERE "userId" = $1
       UNION SELECT "projectId" FROM project_position_assignments WHERE "userId" = $1)
     ORDER BY s."periodStart" DESC LIMIT 10`,
    [req.user.id]
  );
  res.json({ tasks: tasks.map((t) => ({ ...t, overdue: t.dueDate < today })), returned });
});

export default router;
