import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db, { generateId } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { publicUser } from './auth.js';

const router = Router();

// List users - admins see everyone, supervisors see their own department
router.get('/', requireAuth, (req, res) => {
  let users = db.data.users;
  if (!req.user.isGlobalAdmin) {
    if (req.user.role === 'employee') {
      return res.status(403).json({ error: 'Not authorized' });
    }
    users = users.filter((u) => u.department === req.user.department);
  }
  res.json({ users: users.map(publicUser) });
});

router.post('/', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  const { name, email, password, role, department, title, phone } = req.body;
  if (!name || !email || !password || !role || !department) {
    return res.status(400).json({ error: 'name, email, password, role, department are required' });
  }
  if (!req.user.isGlobalAdmin && department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }
  if (!req.user.isGlobalAdmin && role === 'admin') {
    return res.status(403).json({ error: 'Only administrators can create admin accounts' });
  }
  if (db.data.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
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
    createdAt: new Date().toISOString(),
  };
  db.data.users.push(user);
  await db.write();
  res.status(201).json({ user: publicUser(user) });
});

router.put('/:id', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  const idx = db.data.users.findIndex((u) => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  const target = db.data.users[idx];
  if (!req.user.isGlobalAdmin && target.department !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }
  const { name, role, title, phone, department } = req.body;
  if (name) target.name = name;
  if (title !== undefined) target.title = title;
  if (phone !== undefined) target.phone = phone;
  if (req.user.isGlobalAdmin && role) target.role = role;
  if (req.user.isGlobalAdmin && department) target.department = department;
  await db.write();
  res.json({ user: publicUser(target) });
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const before = db.data.users.length;
  db.data.users = db.data.users.filter((u) => u.id !== req.params.id);
  if (db.data.users.length === before) return res.status(404).json({ error: 'User not found' });
  await db.write();
  res.json({ ok: true });
});

export default router;
