import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, (req, res) => {
  const depts = db.data.departments.map((d) => {
    const memberCount = db.data.users.filter((u) => u.department === d.id).length;
    const projectCount = db.data.projects.filter((p) => p.department === d.id).length;
    return { ...d, memberCount, projectCount };
  });
  res.json({ departments: depts });
});

export default router;
