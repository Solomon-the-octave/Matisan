import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { initDb } from './db.js';

import authRoutes from './routes/auth.js';
import departmentRoutes from './routes/departments.js';
import userRoutes from './routes/users.js';
import projectRoutes from './routes/projects.js';
import taskRoutes from './routes/tasks.js';
import attendanceRoutes from './routes/attendance.js';
import reportRoutes from './routes/reports.js';
import workerRoutes from './routes/workers.js';
import workerAttendanceRoutes from './routes/workerAttendance.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
// Raised limit so an optional worker photo (base64 data URL) fits in the body.
app.use(express.json({ limit: '6mb' }));
app.use(morgan('dev'));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'Matisan HR API' }));

app.use('/api/auth', authRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/users', userRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/workers', workerRoutes);
app.use('/api/worker-attendance', workerAttendanceRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Matisan HR API running on http://localhost:${PORT}`);
  });
});
