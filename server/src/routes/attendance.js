import { Router } from 'express';
import db, { generateId } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function visibleAttendance(user) {
  if (user.isGlobalAdmin) return db.data.attendance;
  if (user.role === 'supervisor') return db.data.attendance.filter((a) => a.department === user.department);
  return db.data.attendance.filter((a) => a.userId === user.id);
}

router.get('/', requireAuth, (req, res) => {
  res.json({ attendance: visibleAttendance(req.user) });
});

router.post('/check-in', requireAuth, async (req, res) => {
  const today = todayStr();
  const existing = db.data.attendance.find((a) => a.userId === req.user.id && a.date === today);
  if (existing) return res.status(409).json({ error: 'Already checked in today' });

  const record = {
    id: generateId('a'),
    userId: req.user.id,
    department: req.user.department,
    date: today,
    checkIn: new Date().toISOString(),
    checkOut: null,
    status: 'pending',
    hours: 0,
  };
  db.data.attendance.push(record);
  await db.write();
  res.status(201).json({ attendance: record });
});

router.post('/check-out', requireAuth, async (req, res) => {
  const today = todayStr();
  const record = db.data.attendance.find((a) => a.userId === req.user.id && a.date === today);
  if (!record) return res.status(404).json({ error: 'No check-in found for today' });
  if (record.checkOut) return res.status(409).json({ error: 'Already checked out today' });

  record.checkOut = new Date().toISOString();
  const ms = new Date(record.checkOut) - new Date(record.checkIn);
  record.hours = Math.round((ms / 3600000) * 10) / 10;
  await db.write();
  res.json({ attendance: record });
});

router.put('/:id/approve', requireAuth, async (req, res) => {
  if (!(req.user.isGlobalAdmin || req.user.role === 'supervisor')) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  const record = db.data.attendance.find((a) => a.id === req.params.id);
  if (!record) return res.status(404).json({ error: 'Record not found' });
  if (!req.user.isGlobalAdmin && record.department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }
  record.status = 'approved';
  await db.write();
  res.json({ attendance: record });
});

export default router;
