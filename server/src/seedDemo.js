// Full demo dataset (the same accounts/projects/workers the app always
// shipped with in development) — NOT for production. Run this for local
// development or to demo the system; run plain seed.js for a real deploy.
//
// Usage: node src/seedDemo.js
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { pool, generateId } from './db.js';

dotenv.config();

function hash(pw) {
  return bcrypt.hashSync(pw, 10);
}

async function main() {
  const departments = [
    { id: 'dept-admin', name: 'Administration', icon: 'building', description: 'Company-wide oversight, HR & operations' },
    { id: 'dept-eng', name: 'Engineering & Projects', icon: 'drafting-compass', description: 'Design, project management & site delivery' },
    { id: 'dept-field', name: 'Field Operations', icon: 'hard-hat', description: 'Site crews, construction & field execution' },
    { id: 'dept-finance', name: 'Finance & Procurement', icon: 'wallet', description: 'Budgets, payroll & procurement' },
    { id: 'dept-hr', name: 'Human Resources', icon: 'users', description: 'People operations, hiring & compliance' },
  ];
  for (const d of departments) {
    await pool.query(
      'INSERT INTO departments (id, name, icon, description) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING',
      [d.id, d.name, d.icon, d.description]
    );
  }

  const users = [
    { id: 'u-admin', name: 'System Administrator', email: 'admin@matisans.com', role: 'admin', department: 'dept-admin', title: 'System Administrator', phone: '+251 900 000 001', isGlobalAdmin: true },
    { id: 'u-supervisor', name: 'John Supervisor', email: 'supervisor@matisans.com', role: 'supervisor', department: 'dept-eng', title: 'Site Supervisor', phone: '+251 900 000 002', isGlobalAdmin: false },
    { id: 'u-supervisor-field', name: 'Sara Bekele', email: 'sara@matisans.com', role: 'supervisor', department: 'dept-field', title: 'Field Operations Supervisor', phone: '+251 900 000 006', isGlobalAdmin: false },
    { id: 'u-employee', name: 'Jane Employee', email: 'employee@matisans.com', role: 'employee', department: 'dept-field', title: 'Field Engineer', phone: '+251 900 000 003', isGlobalAdmin: false },
    { id: 'u-hr', name: 'Hana HR', email: 'hr@matisans.com', role: 'supervisor', department: 'dept-hr', title: 'HR Lead', phone: '+251 900 000 004', isGlobalAdmin: false },
    { id: 'u-finance', name: 'Frank Finance', email: 'finance@matisans.com', role: 'finance', department: 'dept-finance', title: 'Finance Officer', phone: '+251 900 000 005', isGlobalAdmin: false },
  ];
  for (const u of users) {
    await pool.query(
      `INSERT INTO users (id, name, email, "passwordHash", role, department, title, phone, "isGlobalAdmin")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
      [u.id, u.name, u.email, hash('Admin@123'), u.role, u.department, u.title, u.phone, u.isGlobalAdmin]
    );
  }

  const projects = [
    { id: 'p-1', name: 'G+4 Hotel Building - Assella', site: 'Assella Town', department: 'dept-eng', managerId: 'u-supervisor', status: 'active', progress: 42, startDate: '2026-06-01', description: 'Ground plus four storey hotel building construction supervision.' },
    { id: 'p-2', name: 'Road Access Upgrade - Batu', site: 'Batu', department: 'dept-field', managerId: 'u-supervisor-field', status: 'active', progress: 18, startDate: '2026-08-10', description: 'Access road grading and drainage works for site logistics.' },
  ];
  for (const p of projects) {
    await pool.query(
      `INSERT INTO projects (id, name, site, department, "managerId", status, progress, "startDate", description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
      [p.id, p.name, p.site, p.department, p.managerId, p.status, p.progress, p.startDate, p.description]
    );
  }
  await pool.query(
    `INSERT INTO project_assignments ("projectId", "userId") VALUES ('p-2','u-employee') ON CONFLICT DO NOTHING`
  );

  const tasks = [
    { id: 't-1', title: 'Foundation Inspection', description: 'Inspect and document the foundation work progress.', projectId: 'p-1', department: 'dept-eng', assignedTo: 'u-employee', createdBy: 'u-supervisor', priority: 'high', status: 'created', dueDate: '2026-10-05' },
    { id: 't-2', title: 'Weekly Materials Count', description: 'Count and reconcile cement and rebar stock on site.', projectId: 'p-2', department: 'dept-field', assignedTo: 'u-employee', createdBy: 'u-supervisor', priority: 'medium', status: 'in_progress', dueDate: '2026-10-02' },
  ];
  for (const t of tasks) {
    await pool.query(
      `INSERT INTO tasks (id, title, description, "projectId", department, "assignedTo", "createdBy", priority, status, "dueDate")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
      [t.id, t.title, t.description, t.projectId, t.department, t.assignedTo, t.createdBy, t.priority, t.status, t.dueDate]
    );
  }

  const workers = [
    { id: 'WKR-0001', name: 'Abebe Kebede', trade: 'Mason', phone: '+251 911 111 111', dailyRate: 350, bankAccount: '1000689345868CBE', department: 'dept-eng', projectId: 'p-1', registeredBy: 'u-supervisor' },
    { id: 'WKR-0002', name: 'Chaltu Girma', trade: 'Day Laborer', phone: '+251 922 222 222', dailyRate: 250, bankAccount: '1000064270226CBE', department: 'dept-field', projectId: 'p-2', registeredBy: 'u-employee' },
  ];
  for (const w of workers) {
    await pool.query(
      `INSERT INTO workers (id, name, trade, phone, "dailyRate", "bankAccount", department, "projectId", "registeredBy")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
      [w.id, w.name, w.trade, w.phone, w.dailyRate, w.bankAccount, w.department, w.projectId, w.registeredBy]
    );
  }
  // Keep the WKR-#### sequence ahead of the hand-seeded IDs above.
  await pool.query("SELECT setval('worker_id_seq', 2, true)");

  const today = new Date().toISOString().slice(0, 10);
  await pool.query(
    `INSERT INTO worker_attendance (id, "workerId", "projectId", department, date, am, pm, "otHours", "registeredBy")
     VALUES ($1,'WKR-0001','p-1','dept-eng',$2,true,true,0,'u-supervisor')
     ON CONFLICT ("workerId", date) DO NOTHING`,
    [generateId('wa'), today]
  );

  console.log('Demo seed complete. Logins (all Admin@123):');
  users.forEach((u) => console.log(`  ${u.role.padEnd(10)} ${u.email}`));
  await pool.end();
}

main().catch((err) => {
  console.error('Demo seed failed:', err);
  process.exit(1);
});
