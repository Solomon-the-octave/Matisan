import { Router } from 'express';
import { rows, row, query, generateWorkerId } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { canAccessProject } from './projects.js';
import { laborType } from '../laborStructure.js';

const router = Router();

// Add the derived Skilled / Non-Skilled classification to a worker before
// it goes out over the API — never stored, always computed from the job
// title so it can't drift if the Labor Structure list changes.
function withLaborType(w) {
  return { ...w, laborType: laborType(w.trade) };
}

// An employee's view is scoped to the project(s) they're assigned to, not
// their whole department — same boundary as projects.js.
async function assignedProjectIds(user) {
  const r = await rows('SELECT "projectId" FROM project_assignments WHERE "userId" = $1', [user.id]);
  return r.map((x) => x.projectId);
}

async function visibleWorkers(user) {
  if (user.isGlobalAdmin) return rows('SELECT * FROM workers ORDER BY "createdAt" DESC');
  if (user.role === 'employee') {
    const ids = await assignedProjectIds(user);
    if (ids.length === 0) return [];
    return rows(
      'SELECT * FROM workers WHERE department = $1 AND "projectId" = ANY($2) ORDER BY "createdAt" DESC',
      [user.department, ids]
    );
  }
  return rows('SELECT * FROM workers WHERE department = $1 ORDER BY "createdAt" DESC', [user.department]);
}

// List / search workers (e.g. ?q=abebe&projectId=p-1) — used both for the
// "all workers" roster and the returning-worker search in the register flow.
router.get('/', requireAuth, async (req, res) => {
  let workers = await visibleWorkers(req.user);
  const { q, projectId } = req.query;
  if (projectId) workers = workers.filter((w) => w.projectId === projectId);
  if (q) {
    const needle = String(q).toLowerCase();
    workers = workers.filter((w) => w.name.toLowerCase().includes(needle) || w.id.toLowerCase().includes(needle));
  }
  res.json({ workers: workers.map(withLaborType) });
});

router.get('/:id', requireAuth, async (req, res) => {
  const worker = await row('SELECT * FROM workers WHERE id = $1', [req.params.id]);
  if (!worker) return res.status(404).json({ error: 'Worker not found' });
  if (!req.user.isGlobalAdmin && worker.department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }
  res.json({ worker: withLaborType(worker) });
});

// Register a brand-new day worker. Any authenticated staff member (the
// on-site registrar) can do this for their own department; admins for any.
router.post('/', requireAuth, async (req, res) => {
  if (req.user.role !== 'employee' && !req.user.isGlobalAdmin) {
    return res.status(403).json({ error: 'Workers are registered by the field team' });
  }
  const { name, trade, phone, photo, dailyRate, bankAccount, department, projectId } = req.body;
  if (!name || !department) return res.status(400).json({ error: 'name and department are required' });
  if (!req.user.isGlobalAdmin && department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }
  if (projectId) {
    const project = await row(
      `SELECT p.*, COALESCE((SELECT array_agg(pa."userId") FROM project_assignments pa WHERE pa."projectId" = p.id), ARRAY[]::text[]) AS "assignedEmployees" FROM projects p WHERE p.id = $1`,
      [projectId]
    );
    if (!project) return res.status(400).json({ error: 'Unknown project' });
    if (!canAccessProject(req.user, project)) {
      return res.status(403).json({ error: "You're not assigned to that project" });
    }
  }

  const id = await generateWorkerId();
  await query(
    `INSERT INTO workers (id, name, trade, phone, photo, "dailyRate", "bankAccount", department, "projectId", "registeredBy")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      name,
      trade || '',
      phone || '',
      photo || null, // optional data URL, kept small on the client
      dailyRate ? Number(dailyRate) : null,
      // Where payroll pays this worker — same "Account" column as the paper
      // Daily Labors Payroll Sheet.
      bankAccount || null,
      department,
      projectId || null,
      req.user.id,
    ]
  );
  const worker = await row('SELECT * FROM workers WHERE id = $1', [id]);
  res.status(201).json({ worker: withLaborType(worker) });
});

router.put('/:id', requireAuth, async (req, res) => {
  if (req.user.role !== 'employee' && !req.user.isGlobalAdmin) {
    return res.status(403).json({ error: 'Workers are registered by the field team' });
  }
  const worker = await row('SELECT * FROM workers WHERE id = $1', [req.params.id]);
  if (!worker) return res.status(404).json({ error: 'Worker not found' });
  if (!req.user.isGlobalAdmin && worker.department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }
  const { name, trade, phone, photo, dailyRate, bankAccount, projectId } = req.body;
  await query(
    `UPDATE workers SET
       name = COALESCE($1, name),
       trade = CASE WHEN $2::boolean THEN $3 ELSE trade END,
       phone = CASE WHEN $4::boolean THEN $5 ELSE phone END,
       photo = CASE WHEN $6::boolean THEN $7 ELSE photo END,
       "dailyRate" = CASE WHEN $8::boolean THEN $9 ELSE "dailyRate" END,
       "bankAccount" = CASE WHEN $10::boolean THEN $11 ELSE "bankAccount" END,
       "projectId" = CASE WHEN $12::boolean THEN $13 ELSE "projectId" END
     WHERE id = $14`,
    [
      name || null,
      trade !== undefined, trade ?? null,
      phone !== undefined, phone ?? null,
      photo !== undefined, photo ?? null,
      dailyRate !== undefined, dailyRate !== undefined ? (dailyRate ? Number(dailyRate) : null) : null,
      bankAccount !== undefined, bankAccount ?? null,
      projectId !== undefined, projectId ?? null,
      worker.id,
    ]
  );
  const updated = await row('SELECT * FROM workers WHERE id = $1', [worker.id]);
  res.json({ worker: withLaborType(updated) });
});

export default router;
