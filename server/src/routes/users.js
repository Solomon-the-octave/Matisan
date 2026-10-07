import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { rows, row, query, generateId } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { publicUser } from './auth.js';

const router = Router();
const ROLES = ['admin', 'supervisor', 'employee', 'finance'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// List users - admins see everyone, supervisors see their own department
router.get('/', requireAuth, async (req, res) => {
  if (!req.user.isGlobalAdmin && req.user.role === 'employee') {
    return res.status(403).json({ error: 'Not authorized' });
  }
  const users = req.user.isGlobalAdmin
    ? await rows('SELECT * FROM users ORDER BY name')
    : await rows('SELECT * FROM users WHERE department = $1 ORDER BY name', [req.user.department]);
  res.json({ users: users.map(publicUser) });
});

router.post('/', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  const { password, role, department, title, phone } = req.body;
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim();
  if (!name || !email || !password || !role || !department) {
    return res.status(400).json({ error: 'name, email, password, role, department are required' });
  }
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (!(await row('SELECT id FROM departments WHERE id = $1', [department]))) {
    return res.status(400).json({ error: 'Department not found' });
  }
  if (!req.user.isGlobalAdmin && role === 'finance') {
    return res.status(403).json({ error: 'Only administrators can create finance accounts' });
  }
  if (!req.user.isGlobalAdmin && department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }
  if (!req.user.isGlobalAdmin && role === 'admin') {
    return res.status(403).json({ error: 'Only administrators can create admin accounts' });
  }
  const existing = await row('SELECT id FROM users WHERE lower(email) = lower($1)', [email]);
  if (existing) {
    return res.status(409).json({ error: 'A user with that email already exists' });
  }

  const user = {
    id: generateId('u'),
    name,
    email,
    passwordHash: bcrypt.hashSync(password, 10),
    role,
    department,
    title: title || '',
    phone: phone || '',
    isGlobalAdmin: false,
  };
  await query(
    `INSERT INTO users (id, name, email, "passwordHash", role, department, title, phone, "isGlobalAdmin")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [user.id, user.name, user.email, user.passwordHash, user.role, user.department, user.title, user.phone, user.isGlobalAdmin]
  );
  const created = await row('SELECT * FROM users WHERE id = $1', [user.id]);
  res.status(201).json({ user: publicUser(created) });
});

router.put('/:id', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  const target = await row('SELECT * FROM users WHERE id = $1', [req.params.id]);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (!req.user.isGlobalAdmin && target.department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }
  const { name, role, title, phone, department, email, password } = req.body;
  if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (target.isGlobalAdmin && ((role && role !== 'admin') || (department && department !== target.department))) {
    return res.status(403).json({ error: 'The main administrator account keeps its admin role and department' });
  }
  if (department && !(await row('SELECT id FROM departments WHERE id = $1', [department]))) {
    return res.status(400).json({ error: 'Department not found' });
  }
  if (req.user.isGlobalAdmin && email && email.trim().toLowerCase() !== target.email.toLowerCase()) {
    if (!EMAIL_RE.test(email.trim())) return res.status(400).json({ error: 'Enter a valid email address' });
    if (await row('SELECT id FROM users WHERE lower(email) = lower($1) AND id <> $2', [email.trim(), target.id])) {
      return res.status(409).json({ error: 'A user with that email already exists' });
    }
    await query('UPDATE users SET email = $1 WHERE id = $2', [email.trim(), target.id]);
  }
  if (req.user.isGlobalAdmin && password) {
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    await query('UPDATE users SET "passwordHash" = $1 WHERE id = $2', [bcrypt.hashSync(password, 10), target.id]);
  }
  const next = {
    name: name || target.name,
    title: title !== undefined ? title : target.title,
    phone: phone !== undefined ? phone : target.phone,
    role: req.user.isGlobalAdmin && role ? role : target.role,
    department: req.user.isGlobalAdmin && department ? department : target.department,
  };
  await query(
    'UPDATE users SET name = $1, title = $2, phone = $3, role = $4, department = $5 WHERE id = $6',
    [next.name, next.title, next.phone, next.role, next.department, target.id]
  );
  const updated = await row('SELECT * FROM users WHERE id = $1', [target.id]);
  res.json({ user: publicUser(updated) });
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const result = await query('DELETE FROM users WHERE id = $1', [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true });
});

export default router;
