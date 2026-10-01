import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(__dirname, 'data', 'db.json');

const defaultData = {
  departments: [],
  users: [],
  projects: [],
  tasks: [],
  attendance: [],
  // Day / casual site laborers — distinct from `users` (who have logins).
  // Registered on-site by a supervisor/employee via phone or tablet.
  workers: [],
  // One row per worker per day marked present on a project.
  workerAttendance: [],
  // One row per project per week — the digital equivalent of the paper
  // attendance/payroll sheet's sign-off chain: Submitted (supervisor) ->
  // Finance-checked -> Approved (admin). Once approved, the attendance
  // records in that window are locked from further edits.
  payrollPeriods: [],
};

const db = new Low(new JSONFile(file), defaultData);

function hash(pw) {
  return bcrypt.hashSync(pw, 10);
}

export async function initDb() {
  await db.read();
  db.data ||= structuredClone(defaultData);
  // Back-fill collections added after someone may already have a db.json on
  // disk from an earlier version of the app, so an upgrade never crashes.
  db.data.workers ??= [];
  db.data.workerAttendance ??= [];
  db.data.payrollPeriods ??= [];
  for (const p of db.data.projects) {
    p.assignedEmployees ??= [];
  }
  // Older records predate AM/PM/OT tracking — treat them as a full day
  // already marked present, so existing history doesn't silently drop to 0.
  for (const r of db.data.workerAttendance) {
    if (r.am === undefined) r.am = true;
    if (r.pm === undefined) r.pm = true;
    if (r.otHours === undefined) r.otHours = 0;
  }

  if (db.data.departments.length === 0) {
    db.data.departments = [
      { id: 'dept-admin', name: 'Administration', icon: 'building', description: 'Company-wide oversight, HR & operations' },
      { id: 'dept-eng', name: 'Engineering & Projects', icon: 'drafting-compass', description: 'Design, project management & site delivery' },
      { id: 'dept-field', name: 'Field Operations', icon: 'hard-hat', description: 'Site crews, construction & field execution' },
      { id: 'dept-finance', name: 'Finance & Procurement', icon: 'wallet', description: 'Budgets, payroll & procurement' },
      { id: 'dept-hr', name: 'Human Resources', icon: 'users', description: 'People operations, hiring & compliance' },
    ];
  }

  if (db.data.users.length === 0) {
    const now = new Date().toISOString();
    db.data.users = [
      {
        id: 'u-admin',
        name: 'System Administrator',
        email: 'admin@matisans.com',
        passwordHash: hash('Admin@123'),
        role: 'admin',
        department: 'dept-admin',
        title: 'System Administrator',
        phone: '+251 900 000 001',
        isGlobalAdmin: true,
        createdAt: now,
      },
      {
        id: 'u-supervisor',
        name: 'John Supervisor',
        email: 'supervisor@matisans.com',
        passwordHash: hash('Admin@123'),
        role: 'supervisor',
        department: 'dept-eng',
        title: 'Site Supervisor',
        phone: '+251 900 000 002',
        isGlobalAdmin: false,
        createdAt: now,
      },
      {
        id: 'u-supervisor-field',
        name: 'Sara Bekele',
        email: 'sara@matisans.com',
        passwordHash: hash('Admin@123'),
        role: 'supervisor',
        department: 'dept-field',
        title: 'Field Operations Supervisor',
        phone: '+251 900 000 006',
        isGlobalAdmin: false,
        createdAt: now,
      },
      {
        id: 'u-employee',
        name: 'Jane Employee',
        email: 'employee@matisans.com',
        passwordHash: hash('Admin@123'),
        role: 'employee',
        department: 'dept-field',
        title: 'Field Engineer',
        phone: '+251 900 000 003',
        isGlobalAdmin: false,
        createdAt: now,
      },
      {
        id: 'u-hr',
        name: 'Hana HR',
        email: 'hr@matisans.com',
        passwordHash: hash('Admin@123'),
        role: 'supervisor',
        department: 'dept-hr',
        title: 'HR Lead',
        phone: '+251 900 000 004',
        isGlobalAdmin: false,
        createdAt: now,
      },
      {
        id: 'u-finance',
        name: 'Frank Finance',
        email: 'finance@matisans.com',
        passwordHash: hash('Admin@123'),
        role: 'finance',
        department: 'dept-finance',
        title: 'Finance Officer',
        phone: '+251 900 000 005',
        isGlobalAdmin: false,
        createdAt: now,
      },
    ];
  }

  if (db.data.projects.length === 0) {
    db.data.projects = [
      {
        id: 'p-1',
        name: 'G+4 Hotel Building - Assella',
        site: 'Assella Town',
        department: 'dept-eng',
        managerId: 'u-supervisor',
        status: 'active',
        progress: 42,
        startDate: '2026-06-01',
        description: 'Ground plus four storey hotel building construction supervision.',
        // User IDs of employees the supervisor has assigned to this site.
        // An employee only sees/marks attendance for a project they're in.
        assignedEmployees: [],
      },
      {
        id: 'p-2',
        name: 'Road Access Upgrade - Batu',
        site: 'Batu',
        department: 'dept-field',
        managerId: 'u-supervisor-field',
        status: 'active',
        progress: 18,
        startDate: '2026-08-10',
        description: 'Access road grading and drainage works for site logistics.',
        assignedEmployees: ['u-employee'],
      },
    ];
  }

  if (db.data.tasks.length === 0) {
    db.data.tasks = [
      {
        id: 't-1',
        title: 'Foundation Inspection',
        description: 'Inspect and document the foundation work progress.',
        projectId: 'p-1',
        department: 'dept-eng',
        assignedTo: 'u-employee',
        createdBy: 'u-supervisor',
        priority: 'high',
        status: 'created',
        dueDate: '2026-10-05',
        createdAt: new Date().toISOString(),
      },
      {
        id: 't-2',
        title: 'Weekly Materials Count',
        description: 'Count and reconcile cement and rebar stock on site.',
        projectId: 'p-2',
        department: 'dept-field',
        assignedTo: 'u-employee',
        createdBy: 'u-supervisor',
        priority: 'medium',
        status: 'in_progress',
        dueDate: '2026-10-02',
        createdAt: new Date().toISOString(),
      },
    ];
  }

  if (db.data.workers.length === 0) {
    db.data.workers = [
      {
        id: 'WKR-0001',
        name: 'Abebe Kebede',
        trade: 'Mason',
        phone: '+251 911 111 111',
        photo: null,
        dailyRate: 350,
        bankAccount: '1000689345868CBE',
        department: 'dept-eng',
        projectId: 'p-1',
        registeredBy: 'u-supervisor',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'WKR-0002',
        name: 'Chaltu Girma',
        trade: 'Day Laborer',
        phone: '+251 922 222 222',
        photo: null,
        dailyRate: 250,
        bankAccount: '1000064270226CBE',
        department: 'dept-field',
        projectId: 'p-2',
        registeredBy: 'u-employee',
        createdAt: new Date().toISOString(),
      },
    ];
  }

  if (db.data.workerAttendance.length === 0) {
    const today = new Date().toISOString().slice(0, 10);
    db.data.workerAttendance = [
      {
        id: generateId('wa'),
        workerId: 'WKR-0001',
        projectId: 'p-1',
        department: 'dept-eng',
        date: today,
        am: true,
        pm: true,
        otHours: 0,
        registeredBy: 'u-supervisor',
        registeredAt: new Date().toISOString(),
      },
    ];
  }

  await db.write();
  return db;
}

export function generateId(prefix) {
  return `${prefix}-${nanoid(8)}`;
}

// Sequential, human-readable worker IDs (WKR-0001, WKR-0002, ...) so a site
// registrar can read an ID out loud or write it on a paper roster.
export function generateWorkerId() {
  const n = db.data.workers.length + 1;
  return `WKR-${String(n).padStart(4, '0')}`;
}

export default db;
