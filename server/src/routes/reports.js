import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/summary', requireAuth, (req, res) => {
  const user = req.user;
  const scoped = (arr, deptField = 'department') =>
    user.isGlobalAdmin ? arr : arr.filter((x) => x[deptField] === user.department);

  const projects = scoped(db.data.projects);
  const tasks = user.role === 'employee' ? db.data.tasks.filter((t) => t.assignedTo === user.id) : scoped(db.data.tasks);
  const today = new Date().toISOString().slice(0, 10);
  const attendanceToday = scoped(db.data.attendance).filter((a) => a.date === today);
  const myAttendanceToday = db.data.attendance.find((a) => a.userId === user.id && a.date === today);

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const myWeekRecords = db.data.attendance.filter((a) => a.userId === user.id && new Date(a.date) >= weekAgo);
  const hoursThisWeek = Math.round(myWeekRecords.reduce((sum, r) => sum + (r.hours || 0), 0) * 10) / 10;

  res.json({
    totalProjects: projects.length,
    activeProjects: projects.filter((p) => p.status === 'active').length,
    pendingTasks: tasks.filter((t) => !['approved', 'completed'].includes(t.status)).length,
    tasksToReview: tasks.filter((t) => t.status === 'submitted').length,
    attendanceToday: attendanceToday.filter((a) => a.checkIn).length,
    pendingAttendance: attendanceToday.filter((a) => a.status === 'pending').length,
    myTasks: tasks.length,
    myTasksCompletedToday: tasks.filter(
      (t) => t.status === 'completed' && t.assignedTo === user.id
    ).length,
    hoursThisWeek,
    checkedInToday: Boolean(myAttendanceToday && !myAttendanceToday.checkOut),
    myAttendanceToday: myAttendanceToday || null,
  });
});

router.get('/export', requireAuth, (req, res) => {
  const user = req.user;
  const scoped = (arr) => (user.isGlobalAdmin ? arr : arr.filter((x) => x.department === user.department));
  const lines = ['Type,Name,Department,Status,Detail'];
  scoped(db.data.projects).forEach((p) =>
    lines.push(`Project,"${p.name}",${p.department},${p.status},progress:${p.progress}%`)
  );
  scoped(db.data.tasks).forEach((t) =>
    lines.push(`Task,"${t.title}",${t.department},${t.status},priority:${t.priority}`)
  );
  scoped(db.data.attendance).forEach((a) =>
    lines.push(`Attendance,${a.userId},${a.department},${a.status},${a.date}`)
  );
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="matisan-hr-report.csv"');
  res.send(lines.join('\n'));
});

export default router;
