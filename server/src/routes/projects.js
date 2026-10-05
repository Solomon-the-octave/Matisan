import { Router } from 'express';
import multer from 'multer';
import { rows, row, query, generateId } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// Kept in memory only for the length of the request, then written straight
// into Postgres as bytea — nothing ever touches local disk, which Render's
// free tier wipes on every deploy anyway. 15MB covers a permit or scope PDF
// without letting the free Neon database fill up on a handful of uploads.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Every project row, with its assigned-employee IDs folded in as an array —
// same shape the client has always received (`project.assignedEmployees`).
const PROJECT_SELECT = `
  SELECT p.*, (SELECT u.name FROM users u WHERE u.id = p."managerId") AS "managerName", COALESCE(
    (SELECT array_agg(pa."userId") FROM project_assignments pa WHERE pa."projectId" = p.id),
    ARRAY[]::text[]
  ) AS "assignedEmployees"
  FROM projects p
`;

async function visibleProjects(user) {
  if (user.isGlobalAdmin) return rows(`${PROJECT_SELECT} ORDER BY p.name`);
  // Finance reviews payroll company-wide, same as the paper sheets crossed
  // every department — read-only, no create/edit/assign authority.
  if (user.role === 'finance') return rows(`${PROJECT_SELECT} ORDER BY p.name`);
  if (user.role === 'supervisor') {
    return rows(`${PROJECT_SELECT} WHERE p.department = $1 ORDER BY p.name`, [user.department]);
  }
  // Employees only see the specific project(s) a supervisor assigned them
  // to — not their whole department's sites. That's the boundary for
  // showing up on their phone and marking attendance for the right site.
  return rows(
    `${PROJECT_SELECT} WHERE p.id IN (SELECT "projectId" FROM project_assignments WHERE "userId" = $1) ORDER BY p.name`,
    [user.id]
  );
}

async function getProject(id) {
  return row(`${PROJECT_SELECT} WHERE p.id = $1`, [id]);
}

// Shared by other routes (workers, worker-attendance) that need to check
// whether a user may act on a given project, not just list projects.
export function canAccessProject(user, project) {
  if (!project) return false;
  if (user.isGlobalAdmin) return true;
  if (user.role === 'employee') return (project.assignedEmployees || []).includes(user.id);
  return project.department === user.department; // supervisor
}

router.get('/', requireAuth, async (req, res) => {
  res.json({ projects: await visibleProjects(req.user) });
});

const PRIORITIES = ['low', 'medium', 'high'];

// The responsible person must be a supervisor/admin in the project's
// department (or a global admin) — returns an error string or null.
async function checkManager(managerId, department) {
  const mgr = await row('SELECT * FROM users WHERE id = $1', [managerId]);
  if (!mgr) return 'Responsible person not found';
  if (!['supervisor', 'admin'].includes(mgr.role)) return 'Responsible person must be a supervisor or admin';
  if (!mgr.isGlobalAdmin && mgr.department !== department) return "Responsible person must be in the project's department";
  return null;
}

router.post('/', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  const { name, site, department, description, startDate, endDate, priority, managerId } = req.body;
  if (!name || !department) return res.status(400).json({ error: 'name and department are required' });
  if (!req.user.isGlobalAdmin && department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }
  if (priority && !PRIORITIES.includes(priority)) return res.status(400).json({ error: 'Invalid priority' });
  const start = startDate || new Date().toISOString().slice(0, 10);
  if (endDate && endDate < start) return res.status(400).json({ error: 'End date cannot be before the start date' });
  const manager = managerId || req.user.id;
  if (managerId) {
    const err = await checkManager(managerId, department);
    if (err) return res.status(400).json({ error: err });
  }
  const id = generateId('p');
  await query(
    `INSERT INTO projects (id, name, site, department, "managerId", status, progress, "startDate", "endDate", priority, description)
     VALUES ($1,$2,$3,$4,$5,'active',0,$6,$7,$8,$9)`,
    [id, name, site || '', department, manager, start, endDate || null, priority || 'medium', description || '']
  );
  res.status(201).json({ project: await getProject(id) });
});

router.put('/:id', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!req.user.isGlobalAdmin && project.department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }
  const { status, progress, description, name, site, endDate, priority, managerId } = req.body;
  if (priority && !PRIORITIES.includes(priority)) return res.status(400).json({ error: 'Invalid priority' });
  if (managerId) {
    const err = await checkManager(managerId, project.department);
    if (err) return res.status(400).json({ error: err });
  }
  await query(
    `UPDATE projects SET
       status = COALESCE($1, status),
       progress = COALESCE($2, progress),
       description = COALESCE($3, description),
       name = COALESCE($4, name),
       site = COALESCE($5, site),
       "endDate" = COALESCE($6, "endDate"),
       priority = COALESCE($7, priority),
       "managerId" = COALESCE($8, "managerId")
     WHERE id = $9`,
    [status ?? null, progress ?? null, description ?? null, name ?? null, site ?? null,
     endDate || null, priority ?? null, managerId || null, project.id]
  );
  res.json({ project: await getProject(project.id) });
});

// Assign or unassign an employee to a project's site team. Only the
// project's own supervisor (same department) or an admin can manage this.
router.put('/:id/assignments', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!req.user.isGlobalAdmin && project.department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }
  const { userId, action } = req.body; // action: 'add' | 'remove'
  if (!userId || !['add', 'remove'].includes(action)) {
    return res.status(400).json({ error: 'userId and action ("add" or "remove") are required' });
  }
  const employee = await row('SELECT * FROM users WHERE id = $1', [userId]);
  if (!employee) return res.status(404).json({ error: 'User not found' });
  if (employee.department !== project.department) {
    return res.status(400).json({ error: "That user is outside this project's department" });
  }

  if (action === 'add') {
    await query(
      'INSERT INTO project_assignments ("projectId", "userId") VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [project.id, userId]
    );
  } else {
    await query('DELETE FROM project_assignments WHERE "projectId" = $1 AND "userId" = $2', [project.id, userId]);
  }
  res.json({ project: await getProject(project.id) });
});

// --- Project documents ----------------------------------------------------
// Admin uploads permits/scopes/drawings against a project; anyone who can
// already see that project (admin, its own-department supervisor, finance,
// or an assigned employee) can list and download them.

router.get('/:id/documents', requireAuth, async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!canAccessProject(req.user, project)) {
    return res.status(403).json({ error: "You're not assigned to that project" });
  }
  const docs = await rows(
    `SELECT d.id, d.filename, d."mimeType", d.size, d."uploadedAt", u.name AS "uploadedByName"
     FROM project_documents d LEFT JOIN users u ON u.id = d."uploadedBy"
     WHERE d."projectId" = $1 ORDER BY d."uploadedAt" DESC`,
    [project.id]
  );
  res.json({ documents: docs });
});

router.post('/:id/documents', requireAuth, requireRole('admin', 'supervisor'), upload.single('file'), async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!req.user.isGlobalAdmin && project.department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const id = generateId('doc');
  await query(
    `INSERT INTO project_documents (id, "projectId", filename, "mimeType", size, data, "uploadedBy")
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, project.id, req.file.originalname, req.file.mimetype, req.file.size, req.file.buffer, req.user.id]
  );
  const docs = await rows(
    `SELECT d.id, d.filename, d."mimeType", d.size, d."uploadedAt", u.name AS "uploadedByName"
     FROM project_documents d LEFT JOIN users u ON u.id = d."uploadedBy"
     WHERE d."projectId" = $1 ORDER BY d."uploadedAt" DESC`,
    [project.id]
  );
  res.status(201).json({ documents: docs });
});

router.get('/:id/documents/:docId', requireAuth, async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!canAccessProject(req.user, project)) {
    return res.status(403).json({ error: "You're not assigned to that project" });
  }
  const doc = await row(
    'SELECT * FROM project_documents WHERE id = $1 AND "projectId" = $2',
    [req.params.docId, project.id]
  );
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  res.setHeader('Content-Type', doc.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.filename)}"`);
  res.send(doc.data);
});

router.delete('/:id/documents/:docId', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!req.user.isGlobalAdmin && project.department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }
  await query('DELETE FROM project_documents WHERE id = $1 AND "projectId" = $2', [req.params.docId, project.id]);
  res.status(204).end();
});

export default router;
