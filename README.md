# Matisan HR Management System

A digital replacement for Matisan Engineering PLC's paper-based site
attendance and payroll process — built to match the existing paper forms
exactly (the Daily Attendance Card, the Daily Labors Attendance Sheet, and
the Daily Labors Payroll Sheet) so field teams can adopt it with no
retraining, plus general HR features (departments, users, projects, tasks,
staff attendance, reports). Installable as a mobile app (PWA) so it works on
the phone on-site.

See `claude/system-design.md` in the project for the full design spec
(roles, data model, paper-to-digital mapping).

## Stack

- **Server:** Node.js + Express, JWT auth, **PostgreSQL** (via the `pg`
  driver — plain parameterized SQL, no ORM).
- **Client:** React + Vite + Tailwind CSS v4, installable PWA
  (`vite-plugin-pwa`).

In production, one Node process serves both the API and the built React app
(see `server/src/index.js`) — one URL, no separate hosting or CORS config
needed. See `DEPLOYMENT.md` for putting this live.

## First-time setup (local development)

1. **Install dependencies:**
   ```bash
   npm run setup
   ```
2. **Set up a local Postgres database** matching `server/.env.example`:
   ```bash
   createdb matisan_hr
   psql matisan_hr -c "CREATE ROLE matisan WITH LOGIN PASSWORD 'matisan_dev_pw';"
   psql matisan_hr -c "GRANT ALL PRIVILEGES ON DATABASE matisan_hr TO matisan;"
   ```
   (Exact commands vary slightly by OS/Postgres install — the goal is a
   database reachable at the connection string in `server/.env.example`.)
3. **Copy the env file and apply the schema:**
   ```bash
   cp server/.env.example server/.env
   npm run db:migrate
   ```
4. **Seed demo data** (local dev only — creates demo accounts, two sample
   projects, and sample workers):
   ```bash
   npm run db:seed:demo
   ```
   For a real deployment, use `npm run db:seed` instead (production seed —
   creates only the starting departments and one admin account; see
   `DEPLOYMENT.md`).

## Running it locally

```bash
npm run dev
```

Starts both the API (http://localhost:4000) and the web app
(http://localhost:5173) together, with live reload. Open
**http://localhost:5173** in your browser, or on your phone via your
computer's local network IP (e.g. `http://192.168.x.x:5173`) and "Add to
Home Screen" to install it as an app.

## Demo accounts (after `npm run db:seed:demo`)

| Role                | Email                       | Password   |
|---------------------|------------------------------|-----------|
| Admin               | admin@matisans.com          | Admin@123  |
| Supervisor          | supervisor@matisans.com     | Admin@123  |
| Supervisor (field)  | sara@matisans.com           | Admin@123  |
| Employee            | employee@matisans.com       | Admin@123  |
| HR Lead             | hr@matisans.com             | Admin@123  |
| Finance             | finance@matisans.com        | Admin@123  |

## Project structure

```
Matisan_platf/
├── render.yaml            Render deployment blueprint (see DEPLOYMENT.md)
├── DEPLOYMENT.md           Step-by-step guide to putting this live
├── server/                 Express API
│   ├── sql/schema.sql       Postgres schema (idempotent — safe to re-run)
│   └── src/
│       ├── routes/          auth, users, departments, projects, tasks,
│       │                    attendance, reports, workers, worker-attendance,
│       │                    payroll-periods
│       ├── middleware/      JWT auth + role/department access control
│       ├── db.js            Postgres connection pool + query helpers
│       ├── migrate.js       applies sql/schema.sql — run on every deploy
│       ├── seed.js          production seed (departments + 1 admin)
│       └── seedDemo.js      local/demo seed (full demo dataset)
└── client/                  React app
    └── src/
        ├── pages/            Dashboard, FieldAttendance (Weekly Sheet),
        │                     PayrollReview, Departments, Users, Projects,
        │                     Tasks, Attendance, Reports, Profile
        ├── components/       Layout, StatCard, Badge, ProtectedRoute
        └── context/          Auth context
```

## Access model

- **Roles:** Admin (cross-department, cross-project access + final payroll
  sign-off), Supervisor (manages their project's field attendance, creates
  tasks, submits payroll), Employee (assigned tasks, field attendance for
  their project), Finance (reviews submitted payroll before admin approval).
- **Departments** (access points): Administration, Engineering & Projects,
  Field Operations, Finance & Procurement, Human Resources.
- **Payroll sign-off chain:** Submitted (supervisor) → Finance-checked
  (finance) → Approved (admin — locks that week's attendance from further
  edits) → Reopen (admin, if a correction is needed).

## What's next

The core system (attendance, payroll, roles, reports) is built and running
on Postgres. See `claude/system-design.md` for open design questions still
being decided with the client (e.g. a broader document sign-off feature
beyond payroll, PDF exports matching the paper layout visually, custom
domain).
