import { Router } from 'express';
import { rows } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

// Admin-only viewer for the audit log (who changed what, and when).
const router = Router();

router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { entityType, q, from, to } = req.query;
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const where = [];
  const params = [];
  if (entityType) { params.push(entityType); where.push(`"entityType" = $${params.length}`); }
  if (q) { params.push(`%${String(q).toLowerCase()}%`); where.push(`(lower(summary) LIKE $${params.length} OR lower(COALESCE("actorName", '')) LIKE $${params.length})`); }
  if (from) { params.push(from); where.push(`"createdAt" >= $${params.length}::date`); }
  if (to) { params.push(to); where.push(`"createdAt" < ($${params.length}::date + 1)`); }
  params.push(limit);
  const entries = await rows(
    `SELECT id, "actorName", action, "entityType", "entityId", summary, "createdAt"
     FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY "createdAt" DESC, id DESC LIMIT $${params.length}`,
    params
  );
  res.json({ entries });
});

export default router;
