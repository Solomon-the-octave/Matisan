import { Router } from 'express';
import db, { generateId } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function visibleRecords(user) {
  if (user.isGlobalAdmin) return db.data.workerAttendance;
  return db.data.workerAttendance.filter((r) => r.department === user.department);
}

// List today's (or a given date's) roster for a project — this is what the
// head office / site registrar sees: who's on site right now.
router.get('/', requireAuth, (req, res) => {
  let records = visibleRecords(req.user);
  const { date, projectId } = req.query;
  if (date) records = records.filter((r) => r.date === date);
  if (projectId) records = records.filter((r) => r.projectId === projectId);
  res.json({ attendance: records });
});

// Register a worker as present today (or on a given date). Idempotent: if
// this worker is already marked present that day, hands back the existing
// record instead of creating a duplicate.
router.post('/', requireAuth, async (req, res) => {
  const { workerId, projectId, date } = req.body;
  if (!workerId) return res.status(400).json({ error: 'workerId is required' });

  const worker = db.data.workers.find((w) => w.id === workerId);
  if (!worker) return res.status(404).json({ error: 'Worker not found' });
  if (!req.user.isGlobalAdmin && worker.department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }

  const day = date || todayStr();
  const existing = db.data.workerAttendance.find((r) => r.workerId === workerId && r.date === day);
  if (existing) {
    return res.json({ attendance: existing, alreadyRegistered: true });
  }

  const record = {
    id: generateId('wa'),
    workerId,
    projectId: projectId || worker.projectId || null,
    department: worker.department,
    date: day,
    registeredBy: req.user.id,
    registeredAt: new Date().toISOString(),
  };
  db.data.workerAttendance.push(record);
  // Keep the worker's "home" project current so next time they're the
  // default suggestion for that site.
  if (projectId) worker.projectId = projectId;
  await db.write();
  res.status(201).json({ attendance: record });
});

// Lightweight running payroll: for each worker, how many days they've been
// marked present (optionally within a date range / project) and what that
// adds up to at their day rate.
router.get('/payroll', requireAuth, (req, res) => {
  const { projectId, from, to } = req.query;
  let records = visibleRecords(req.user);
  if (projectId) records = records.filter((r) => r.projectId === projectId);
  if (from) records = records.filter((r) => r.date >= from);
  if (to) records = records.filter((r) => r.date <= to);

  const byWorker = new Map();
  for (const r of records) {
    byWorker.set(r.workerId, (byWorker.get(r.workerId) || 0) + 1);
  }

  const workers = req.user.isGlobalAdmin
    ? db.data.workers
    : db.data.workers.filter((w) => w.department === req.user.department);

  const payroll = workers
    .filter((w) => byWorker.has(w.id))
    .map((w) => {
      const daysPresent = byWorker.get(w.id) || 0;
      return {
        workerId: w.id,
        name: w.name,
        trade: w.trade,
        dailyRate: w.dailyRate,
        daysPresent,
        total: w.dailyRate ? Math.round(w.dailyRate * daysPresent * 100) / 100 : null,
      };
    })
    .sort((a, b) => b.daysPresent - a.daysPresent);

  res.json({
    payroll,
    totals: {
      workers: payroll.length,
      daysPresent: payroll.reduce((s, p) => s + p.daysPresent, 0),
      cost: payroll.reduce((s, p) => s + (p.total || 0), 0),
    },
  });
});

export default router;
