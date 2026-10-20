import { Router } from 'express';
import { rows, row, query, generateId } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { audit } from '../audit.js';

const router = Router();
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(s));

// Everyone can see the list (the attendance screens may want to mark them).
router.get('/', requireAuth, async (req, res) => {
  res.json({ holidays: await rows('SELECT id, date, name, paid FROM holidays ORDER BY date') });
});

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { date, name, paid } = req.body || {};
  if (!isDate(date)) return res.status(400).json({ error: 'Pick a valid date' });
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Enter the holiday name' });
  if (await row('SELECT 1 AS x FROM holidays WHERE date = $1', [date])) return res.status(409).json({ error: 'That date is already listed' });
  const id = generateId('hol');
  await query('INSERT INTO holidays (id, date, name, paid) VALUES ($1,$2,$3,$4)', [id, date, String(name).trim().slice(0, 100), !!paid]);
  await audit(req.user, 'create', 'holiday', id, `Added holiday ${String(name).trim()} on ${date}${paid ? ' (paid)' : ''}`);
  res.status(201).json({ holiday: await row('SELECT id, date, name, paid FROM holidays WHERE id = $1', [id]) });
});

router.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const h = await row('SELECT * FROM holidays WHERE id = $1', [req.params.id]);
  if (!h) return res.status(404).json({ error: 'Holiday not found' });
  const paid = req.body?.paid === undefined ? h.paid : !!req.body.paid;
  await query('UPDATE holidays SET paid = $1 WHERE id = $2', [paid, h.id]);
  await audit(req.user, 'update', 'holiday', h.id, `${h.name} (${h.date}) set to ${paid ? 'paid' : 'unpaid'}`);
  res.json({ holiday: await row('SELECT id, date, name, paid FROM holidays WHERE id = $1', [h.id]) });
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const h = await row('SELECT * FROM holidays WHERE id = $1', [req.params.id]);
  if (!h) return res.status(404).json({ error: 'Holiday not found' });
  await query('DELETE FROM holidays WHERE id = $1', [h.id]);
  await audit(req.user, 'delete', 'holiday', h.id, `Removed holiday ${h.name} on ${h.date}`);
  res.json({ ok: true });
});

export default router;
