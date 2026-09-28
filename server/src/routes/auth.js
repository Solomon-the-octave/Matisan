import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db, { generateId } from '../db.js';
import { signToken, requireAuth } from '../middleware/auth.js';

const router = Router();

function publicUser(u) {
  const { passwordHash, ...rest } = u;
  return rest;
}

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const user = db.data.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = signToken(user);
  res.json({ token, user: publicUser(user) });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  if (!bcrypt.compareSync(currentPassword, req.user.passwordHash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  const idx = db.data.users.findIndex((u) => u.id === req.user.id);
  db.data.users[idx].passwordHash = bcrypt.hashSync(newPassword, 10);
  await db.write();
  res.json({ ok: true });
});

export default router;
export { publicUser };
