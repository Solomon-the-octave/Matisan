import { Router } from 'express';
import db, { generateWorkerId } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { canAccessProject } from './projects.js';
import { laborType } from '../laborStructure.js';

// Add the derived Skilled / Non-Skilled classification to a worker before
// it goes out over the API — never stored, always computed from the job
// title so it can't drift if the Labor Structure list changes.
function withLaborType(w) {
  return { ...w, laborType: laborType(w.trade) };
}

const router = Router();

// An employee's view is scoped to the project(s) they're assigned to, not
// their whole department — same boundary as projects.js.
function assignedProjectIds(user) {
  return db.data.projects.filter((p) => (p.assignedEmployees || []).includes(user.id)).map((p) => p.id);
}

function visibleWorkers(user) {
  if (user.isGlobalAdmin) return db.data.workers;
  if (user.role === 'employee') {
    const ids = assignedProjectIds(user);
    return db.data.workers.filter((w) => w.department === user.department && ids.includes(w.projectId));
  }
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
  res.json({ workers: workers.map(withLaborType) });
});

router.get('/:id', requireAuth, (req, res) => {
  const worker = db.data.workers.find((w) => w.id === req.params.id);
  if (!worker) return res.status(404).json({ error: 'Worker not found' });
  if (!req.user.isGlobalAdmin && worker.department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }
  res.json({ worker: withLaborType(worker) });
});

// Register a brand-new day worker. Any authenticated staff member (the
// on-site registrar) can do this for their own department; admins for any.
router.post('/', requireAuth, async (req, res) => {
  const { name, trade, phone, photo, dailyRate, bankAccount, department, projectId } = req.body;
  if (!name || !department) return res.status(400).json({ error: 'name and department are required' });
  if (!req.user.isGlobalAdmin && department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }
  if (projectId) {
    const project = db.data.projects.find((p) => p.id === projectId);
    if (!project) return res.status(400).json({ error: 'Unknown project' });
    if (!canAccessProject(req.user, project)) {
      return res.status(403).json({ error: "You're not assigned to that project" });
    }
  }

  const worker = {
    id: generateWorkerId(),
    name,
    trade: trade || '',
    phone: phone || '',
    photo: photo || null, // optional data URL, kept small on the client
    dailyRate: dailyRate ? Number(dailyRate) : null,
    // Where payroll pays this worker — same "Account" column as the paper
    // Daily Labors Payroll Sheet.
    bankAccount: bankAccount || null,
    department,
    projectId: projectId || null,
    registeredBy: req.user.id,
    createdAt: new Date().toISOString(),
  };
  db.data.workers.push(worker);
  await db.write();
  res.status(201).json({ worker: withLaborType(worker) });
});

router.put('/:id', requireAuth, async (req, res) => {
  const worker = db.data.workers.find((w) => w.id === req.params.id);
  if (!worker) return res.status(404).json({ error: 'Worker not found' });
  if (!req.user.isGlobalAdmin && worker.department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }
  const { name, trade, phone, photo, dailyRate, bankAccount, projectId } = req.body;
  if (name) worker.name = name;
  if (trade !== undefined) worker.trade = trade;
  if (phone !== undefined) worker.phone = phone;
  if (photo !== undefined) worker.photo = photo;
  if (dailyRate !== undefined) worker.dailyRate = dailyRate ? Number(dailyRate) : null;
  if (bankAccount !== undefined) worker.bankAccount = bankAccount;
  if (projectId !== undefined) worker.projectId = projectId;
  await db.write();
  res.json({ worker: withLaborType(worker) });
});

export default router;
