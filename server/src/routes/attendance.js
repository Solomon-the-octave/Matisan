import { Router } from 'express';
import { rows, row, query, generateId } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function visibleAttendance(user) {
  if (user.isGlobalAdmin) return rows('SELECT * FROM attendance ORDER BY date DESC');
  if (user.role === 'supervisor') {
    return rows('SELECT * FROM attendance WHERE department = $1 ORDER BY date DESC', [user.department]);
  }
  return rows('SELECT * FROM attendance WHERE "userId" = $1 ORDER BY date DESC', [user.id]);
}

router.get('/', requireAuth, async (req, res) => {
  res.json({ attendance: await visibleAttendance(req.user) });
});

router.post('/check-in', requireAuth, async (req, res) => {
  const today = todayStr();
  const existing = await row('SELECT * FROM attendance WHERE "userId" = $1 AND date = $2', [req.user.id, today]);
  if (existing) return res.status(409).json({ error: 'Already checked in today' });

  const id = generateId('a');
  await query(
    `INSERT INTO attendance (id, "userId", department, date, "checkIn", "checkOut", status, hours)
     VALUES ($1,$2,$3,$4,now(),NULL,'pending',0)`,
    [id, req.user.id, req.user.department, today]
  );
  res.status(201).json({ attendance: await row('SELECT * FROM attendance WHERE id = $1', [id]) });
});

router.post('/check-out', requireAuth, async (req, res) => {
  const today = todayStr();
  const record = await row('SELECT * FROM attendance WHERE "userId" = $1 AND date = $2', [req.user.id, today]);
  if (!record) return res.status(404).json({ error: 'No check-in found for today' });
  if (record.checkOut) return res.status(409).json({ error: 'Already checked out today' });

  const checkOut = new Date();
  const hours = Math.round(((checkOut - new Date(record.checkIn)) / 3600000) * 10) / 10;
  await query('UPDATE attendance SET "checkOut" = $1, hours = $2 WHERE id = $3', [checkOut, hours, record.id]);
  res.json({ attendance: await row('SELECT * FROM attendance WHERE id = $1', [record.id]) });
});

router.put('/:id/approve', requireAuth, async (req, res) => {
  if (!(req.user.isGlobalAdmin || req.user.role === 'supervisor')) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  const record = await row('SELECT * FROM attendance WHERE id = $1', [req.params.id]);
  if (!record) return res.status(404).json({ error: 'Record not found' });
  if (!req.user.isGlobalAdmin && record.department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }
  await query("UPDATE attendance SET status = 'approved' WHERE id = $1", [record.id]);
  res.json({ attendance: await row('SELECT * FROM attendance WHERE id = $1', [record.id]) });
});

export default router;
