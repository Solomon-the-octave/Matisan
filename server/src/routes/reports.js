import { Router } from 'express';
import { rows } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/summary', requireAuth, async (req, res) => {
  const user = req.user;
  const deptFilter = user.isGlobalAdmin ? '' : 'WHERE department = $1';
  const deptArgs = user.isGlobalAdmin ? [] : [user.department];

  const projects = await rows(`SELECT * FROM projects ${deptFilter}`, deptArgs);
  const tasks = user.role === 'employee'
    ? await rows('SELECT * FROM tasks WHERE "assignedTo" = $1', [user.id])
    : await rows(`SELECT * FROM tasks ${deptFilter}`, deptArgs);

  const today = new Date().toISOString().slice(0, 10);
  const attendanceToday = await rows(
    `SELECT * FROM attendance WHERE date = $1 ${user.isGlobalAdmin ? '' : 'AND department = $2'}`,
    user.isGlobalAdmin ? [today] : [today, user.department]
  );
  const myAttendanceToday = (await rows('SELECT * FROM attendance WHERE "userId" = $1 AND date = $2', [user.id, today]))[0] || null;

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const myWeekRecords = await rows('SELECT * FROM attendance WHERE "userId" = $1 AND date >= $2', [user.id, weekAgo.toISOString().slice(0, 10)]);
  const hoursThisWeek = Math.round(myWeekRecords.reduce((sum, r) => sum + (r.hours || 0), 0) * 10) / 10;

  res.json({
    totalProjects: projects.length,
    activeProjects: projects.filter((p) => p.status === 'active').length,
    pendingTasks: tasks.filter((t) => !['approved', 'completed'].includes(t.status)).length,
    tasksToReview: tasks.filter((t) => t.status === 'submitted').length,
    attendanceToday: attendanceToday.filter((a) => a.checkIn).length,
    pendingAttendance: attendanceToday.filter((a) => a.status === 'pending').length,
    myTasks: tasks.length,
    myTasksCompletedToday: tasks.filter((t) => t.status === 'completed' && t.assignedTo === user.id).length,
    hoursThisWeek,
    checkedInToday: Boolean(myAttendanceToday && !myAttendanceToday.checkOut),
    myAttendanceToday,
  });
});

router.get('/export', requireAuth, async (req, res) => {
  const user = req.user;
  const deptFilter = user.isGlobalAdmin ? '' : 'WHERE department = $1';
  const deptArgs = user.isGlobalAdmin ? [] : [user.department];

  const projects = await rows(`SELECT * FROM projects ${deptFilter}`, deptArgs);
  const tasks = await rows(`SELECT * FROM tasks ${deptFilter}`, deptArgs);
  const attendance = await rows(`SELECT * FROM attendance ${deptFilter}`, deptArgs);

  const lines = ['Type,Name,Department,Status,Detail'];
  projects.forEach((p) => lines.push(`Project,"${p.name}",${p.department},${p.status},progress:${p.progress}%`));
  tasks.forEach((t) => lines.push(`Task,"${t.title}",${t.department},${t.status},priority:${t.priority}`));
  attendance.forEach((a) => lines.push(`Attendance,${a.userId},${a.department},${a.status},${a.date}`));

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="matisan-hr-report.csv"');
  res.send(lines.join('\n'));
});

export default router;
