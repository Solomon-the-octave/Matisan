import { Router } from 'express';
import { rows } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  const departments = await rows(`
    SELECT d.*,
      (SELECT count(*)::int FROM users u WHERE u.department = d.id) AS "memberCount",
      (SELECT count(*)::int FROM projects p WHERE p.department = d.id) AS "projectCount"
    FROM departments d
    ORDER BY d.name
  `);
  res.json({ departments });
});

export default router;
