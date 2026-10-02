import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { assertDbConnection } from './db.js';

import authRoutes from './routes/auth.js';
import departmentRoutes from './routes/departments.js';
import userRoutes from './routes/users.js';
import projectRoutes from './routes/projects.js';
import taskRoutes from './routes/tasks.js';
import attendanceRoutes from './routes/attendance.js';
import reportRoutes from './routes/reports.js';
import workerRoutes from './routes/workers.js';
import workerAttendanceRoutes from './routes/workerAttendance.js';
import payrollPeriodRoutes from './routes/payrollPeriods.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
// Raised limit so an optional worker photo (base64 data URL) fits in the body.
app.use(express.json({ limit: '6mb' }));
app.use(morgan('dev'));

app.get('/api/health', async (req, res) => {
  try {
    await assertDbConnection();
    res.json({ ok: true, service: 'Matisan HR API', db: 'connected' });
  } catch (err) {
    res.status(503).json({ ok: false, service: 'Matisan HR API', db: 'unreachable' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/users', userRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/workers', workerRoutes);
app.use('/api/worker-attendance', workerAttendanceRoutes);
app.use('/api/payroll-periods', payrollPeriodRoutes);

// In production this one process serves both the API and the built React
// app — one Render service, one URL, no CORS or separate-origin config to
// get wrong. The client's `axios` baseURL is the relative `/api`, which
// resolves correctly either way.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File is too large (15MB max)' });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

assertDbConnection()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Matisan HR API running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Could not connect to the database. Check DATABASE_URL.', err.message);
    process.exit(1);
  });
