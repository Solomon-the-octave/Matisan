import jwt from 'jsonwebtoken';
import { row } from '../db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  // A missing secret in production would silently fall back to a public
  // default — fail loudly instead so this can never ship unnoticed.
  throw new Error('JWT_SECRET must be set in production');
}

export function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, department: user.department, isGlobalAdmin: user.isGlobalAdmin },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await row('SELECT * FROM users WHERE id = $1', [payload.id]);
    if (!user) return res.status(401).json({ error: 'User no longer exists' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have access to this resource' });
    }
    next();
  };
}

// Admins (isGlobalAdmin) can act on any department. Supervisors/employees are
// restricted to their own department unless explicitly allowed.
export function scopedToDepartment(req, res, next) {
  if (req.user.isGlobalAdmin) return next();
  const targetDept = req.body.department || req.query.department || req.params.department;
  if (targetDept && targetDept !== req.user.department) {
    return res.status(403).json({ error: 'Outside your department access point' });
  }
  next();
}
