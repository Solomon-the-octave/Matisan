# Matisan HR Management System

A full-stack HR platform for Matisan Engineering Private Ltd Co. — role- and
department-based dashboards, project & task tracking, attendance check-in,
and reporting. Installable as a mobile app (PWA) so it works on the phone too.

## Stack

- **Server:** Node.js + Express, JWT auth, JSON file storage (`lowdb`) — no
  database install required.
- **Client:** React + Vite + Tailwind CSS v4, installable PWA
  (`vite-plugin-pwa`).

## First-time setup

From the project root (`Matisan_platf`), in a terminal (VS Code's built-in
terminal works: **Terminal → New Terminal**):

```bash
npm run setup
```

This installs dependencies for both the `server` and `client` folders.

## Running it locally

```bash
npm run dev
```

This starts both the API (http://localhost:4000) and the web app
(http://localhost:5173) together, with live reload — edit any file in
`client/src` or `server/src` and the browser/server updates automatically.

Open **http://localhost:5173** in your browser. On your phone, open the same
address on your computer's local network IP (e.g. `http://192.168.x.x:5173`)
and use "Add to Home Screen" to install it as an app.

## Demo accounts

| Role       | Email                     | Password   |
|------------|---------------------------|------------|
| Admin      | admin@matisans.com        | Admin@123  |
| Supervisor | supervisor@matisans.com   | Admin@123  |
| Employee   | employee@matisans.com     | Admin@123  |
| HR Lead    | hr@matisans.com           | Admin@123  |
| Finance    | finance@matisans.com      | Admin@123  |

Data is stored in `server/src/data/db.json` and seeded automatically the
first time the server starts. Delete that file to reset all data back to the
demo seed.

## Project structure

```
Matisan_platf/
├── server/               Express API
│   └── src/
│       ├── routes/       auth, users, departments, projects, tasks, attendance, reports
│       ├── middleware/   JWT auth + role/department access control
│       └── db.js         JSON storage + seed data
└── client/               React app
    └── src/
        ├── pages/        Login, Dashboard, Departments, Users, Projects, Tasks, Attendance, Reports, Profile
        ├── components/   Layout (sidebar/topbar), StatCard, Badge, ProtectedRoute
        └── context/      Auth context
```

## Access model

- **Departments** (access points): Administration, Engineering & Projects,
  Field Operations, Finance & Procurement, Human Resources.
- **Roles:** Admin (cross-department access), Supervisor (manages their own
  department), Employee (their own tasks & attendance only).

## What's next

This is the first working version. Good next upgrades: persistent database
(Postgres), file/document uploads, push notifications, payroll module, and
deploying the API + client to hosting (e.g. Render + Netlify/Vercel).
