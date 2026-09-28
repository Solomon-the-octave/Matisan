import { Router } from 'express';
import db, { generateWorkerId } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

function visibleWorkers(user) {
  if (user.isGlobalAdmin) return db.data.workers;
  return db.data.workers.filter((w) => w.department === user.department);
}

// List / search workers (e.g. ?q=abebe&projectId=p-1) — used both for the
// "all workers" roster and the returning-worker search in the register flow.
router.get('/', requireAuth, (req, res) => {
  let workers = visibleWorkers(req.user);
  const { q, projectId } = req.query;
  if (projectId) workers = workers.filter((w) => w.projectId === projectId);
  if (q) {
    const needle = String(q).toLowerCase();
    workers = workers.filter(
      (w) => w.name.toLowerCase().includes(needle) || w.id.toLowerCase().includes(needle)
    );
  }
  res.json({ workers });
});

router.get('/:id', requireAuth, (req, res) => {
  const worker = db.data.workers.find((w) => w.id === req.params.id);
  if (!worker) return res.status(404).json({ error: 'Worker not found' });
  if (!req.user.isGlobalAdmin && worker.department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }
  res.json({ worker });
});

// Register a brand-new day worker. Any authenticated staff member (the
// on-site registrar) can do this for their own department; admins for any.
router.post('/', requireAuth, async (req, res) => {
  const { name, trade, phone, photo, dailyRate, department, projectId } = req.body;
  if (!name || !department) return res.status(400).json({ error: 'name and department are required' });
  if (!req.user.isGlobalAdmin && department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }
  if (projectId && !db.data.projects.some((p) => p.id === projectId)) {
    return res.status(400).json({ error: 'Unknown project' });
  }

  const worker = {
    id: generateWorkerId(),
    name,
    trade: trade || '',
    phone: phone || '',
    photo: photo || null, // optional data URL, kept small on the client
    dailyRate: dailyRate ? Number(dailyRate) : null,
    department,
    projectId: projectId || null,
    registeredBy: req.user.id,
    createdAt: new Date().toISOString(),
  };
  db.data.workers.push(worker);
  await db.write();
  res.status(201).json({ worker });
});

router.put('/:id', requireAuth, async (req, res) => {
  const worker = db.data.workers.find((w) => w.id === req.params.id);
  if (!worker) return res.status(404).json({ error: 'Worker not found' });
  if (!req.user.isGlobalAdmin && worker.department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }
  const { name, trade, phone, photo, dailyRate, projectId } = req.body;
  if (name) worker.name = name;
  if (trade !== undefined) worker.trade = trade;
  if (phone !== undefined) worker.phone = phone;
  if (photo !== undefined) worker.photo = photo;
  if (dailyRate !== undefined) worker.dailyRate = dailyRate ? Number(dailyRate) : null;
  if (projectId !== undefined) worker.projectId = projectId;
  await db.write();
  res.json({ worker });
});

export default router;
