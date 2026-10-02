-- Matisan HR Management System — PostgreSQL schema.
-- Mirrors the original lowdb JSON structure field-for-field so behavior is
-- unchanged, just the storage engine. Column names are quoted camelCase to
-- match the API's JSON shape exactly — no translation layer needed.
--
-- Safe to run multiple times (IF NOT EXISTS everywhere).

CREATE TABLE IF NOT EXISTS departments (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  icon        text,
  description text
);

CREATE TABLE IF NOT EXISTS users (
  id              text PRIMARY KEY,
  name            text NOT NULL,
  email           text NOT NULL UNIQUE,
  "passwordHash"  text NOT NULL,
  role            text NOT NULL CHECK (role IN ('admin', 'supervisor', 'employee', 'finance')),
  department      text NOT NULL REFERENCES departments(id),
  title           text,
  phone           text,
  "isGlobalAdmin" boolean NOT NULL DEFAULT false,
  "createdAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  site        text,
  department  text NOT NULL REFERENCES departments(id),
  "managerId" text REFERENCES users(id),
  status      text NOT NULL DEFAULT 'active',
  progress    integer NOT NULL DEFAULT 0,
  "startDate" text,
  description text
);

-- Many-to-many: employees a supervisor has assigned to a project's site team.
CREATE TABLE IF NOT EXISTS project_assignments (
  "projectId" text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  "userId"    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY ("projectId", "userId")
);

CREATE TABLE IF NOT EXISTS tasks (
  id           text PRIMARY KEY,
  title        text NOT NULL,
  description  text,
  "projectId"  text REFERENCES projects(id),
  department   text NOT NULL REFERENCES departments(id),
  "assignedTo" text NOT NULL REFERENCES users(id),
  "createdBy"  text NOT NULL REFERENCES users(id),
  priority     text NOT NULL DEFAULT 'medium',
  status       text NOT NULL DEFAULT 'created',
  "dueDate"    text,
  "createdAt"  timestamptz NOT NULL DEFAULT now()
);

-- Staff (system user) clock-in/clock-out — distinct from worker_attendance,
-- which tracks field laborers who have no login.
CREATE TABLE IF NOT EXISTS attendance (
  id          text PRIMARY KEY,
  "userId"    text NOT NULL REFERENCES users(id),
  department  text NOT NULL REFERENCES departments(id),
  date        text NOT NULL,
  "checkIn"   timestamptz,
  "checkOut"  timestamptz,
  status      text NOT NULL DEFAULT 'pending',
  hours       double precision NOT NULL DEFAULT 0
);

-- A day / casual site laborer — registered on-site, no login. Identified by
-- a human-readable sequential ID (WKR-0001, WKR-0002, ...).
CREATE TABLE IF NOT EXISTS workers (
  id              text PRIMARY KEY,
  name            text NOT NULL,
  trade           text,
  phone           text,
  photo           text,
  "dailyRate"     double precision,
  "bankAccount"   text,
  department      text NOT NULL REFERENCES departments(id),
  "projectId"     text REFERENCES projects(id),
  "registeredBy"  text NOT NULL REFERENCES users(id),
  "createdAt"     timestamptz NOT NULL DEFAULT now()
);

-- Sequential counter behind WKR-0001-style IDs — safe under concurrent
-- registrations (unlike counting rows), unlike the old lowdb approach.
CREATE SEQUENCE IF NOT EXISTS worker_id_seq START 1;

-- One row per worker per day marked present on a project — the digital
-- Daily Attendance Card.
CREATE TABLE IF NOT EXISTS worker_attendance (
  id              text PRIMARY KEY,
  "workerId"      text NOT NULL REFERENCES workers(id),
  "projectId"     text REFERENCES projects(id),
  department      text NOT NULL REFERENCES departments(id),
  date            text NOT NULL,
  am              boolean NOT NULL DEFAULT true,
  pm              boolean NOT NULL DEFAULT true,
  "otHours"       double precision NOT NULL DEFAULT 0,
  "registeredBy"  text NOT NULL REFERENCES users(id),
  "registeredAt"  timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("workerId", date)
);
CREATE INDEX IF NOT EXISTS worker_attendance_project_date_idx ON worker_attendance ("projectId", date);

-- One row per project per week — the digital sign-off chain mirroring the
-- paper sheet: Submitted (supervisor) -> Finance-checked -> Approved
-- (admin, locks that week's attendance from further edits).
CREATE TABLE IF NOT EXISTS payroll_periods (
  id                   text PRIMARY KEY,
  "projectId"          text NOT NULL REFERENCES projects(id),
  department           text NOT NULL REFERENCES departments(id),
  "weekStart"          text NOT NULL,
  "weekEnd"            text NOT NULL,
  status               text NOT NULL DEFAULT 'submitted',
  "submittedBy"        text REFERENCES users(id),
  "submittedAt"        timestamptz,
  "financeCheckedBy"   text REFERENCES users(id),
  "financeCheckedAt"   timestamptz,
  "approvedBy"         text REFERENCES users(id),
  "approvedAt"         timestamptz,
  UNIQUE ("projectId", "weekStart", "weekEnd")
);

CREATE INDEX IF NOT EXISTS tasks_assigned_to_idx ON tasks ("assignedTo");
CREATE INDEX IF NOT EXISTS workers_department_project_idx ON workers (department, "projectId");
CREATE INDEX IF NOT EXISTS payroll_periods_project_idx ON payroll_periods ("projectId");
