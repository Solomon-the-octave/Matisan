// Idempotent production seed: creates the starting departments and an
// initial admin account if (and only if) the database is empty of them.
// Safe to run on every deploy — ON CONFLICT DO NOTHING means it never
// overwrites real data once the company starts using the system.
//
// Usage: node src/seed.js
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { pool, generateId } from './db.js';

dotenv.config();

function hash(pw) {
  return bcrypt.hashSync(pw, 10);
}

async function main() {
  const { rows: deptRows } = await pool.query('SELECT id FROM departments');
  if (deptRows.length === 0) {
    console.log('Seeding departments...');
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
  }

  const { rows: userRows } = await pool.query('SELECT id FROM users');
  if (userRows.length === 0) {
    console.log('Seeding initial admin account...');
    // In production, only the admin account is seeded — real staff and
    // field data get created through the app itself, not shipped as demo
    // data. The admin should change this password on first login.
    await pool.query(
      `INSERT INTO users (id, name, email, "passwordHash", role, department, title, phone, "isGlobalAdmin")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
      [
        'u-admin',
        'System Administrator',
        process.env.SEED_ADMIN_EMAIL || 'admin@matisans.com',
        hash(process.env.SEED_ADMIN_PASSWORD || 'Admin@123'),
        'admin',
        'dept-admin',
        'System Administrator',
        '+251 900 000 001',
        true,
      ]
    );
    console.log(
      `Admin login: ${process.env.SEED_ADMIN_EMAIL || 'admin@matisans.com'} / ${process.env.SEED_ADMIN_PASSWORD ? '(from SEED_ADMIN_PASSWORD)' : 'Admin@123 (default — change this immediately)'}`
    );
  }

  console.log('Seed complete.');
  await pool.end();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
