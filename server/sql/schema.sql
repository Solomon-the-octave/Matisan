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

-- Admin-uploaded project files (permits, scopes, drawings) kept as bytea
-- rather than on local disk, since Render's filesystem is ephemeral and
-- wiped on every deploy. Fine for the modest PDF/doc sizes this is for;
-- not meant for large files or many of them — see the 15MB cap in the route.
CREATE TABLE IF NOT EXISTS project_documents (
  id           text PRIMARY KEY,
  "projectId"  text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename     text NOT NULL,
  "mimeType"   text NOT NULL,
  size         integer NOT NULL,
  data         bytea NOT NULL,
  "uploadedBy" text REFERENCES users(id),
  "uploadedAt" timestamptz NOT NULL DEFAULT now()
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

-- Richer project details: planned end date and priority.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS "endDate" text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'medium';

-- Files attached to a task (stored in Postgres like project documents —
-- Render's free disk is ephemeral).
CREATE TABLE IF NOT EXISTS task_documents (
  id           text PRIMARY KEY,
  "taskId"     text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  filename     text NOT NULL,
  "mimeType"   text NOT NULL,
  size         integer NOT NULL,
  data         bytea NOT NULL,
  "uploadedBy" text REFERENCES users(id),
  "uploadedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_documents_task_idx ON task_documents ("taskId");

-- Employee -> supervisor hand-in of the attendance registered on a project,
-- for one day ('daily', periodStart = periodEnd = that date) or a Mon-Sun
-- week ('weekly'). Supervisor/admin acknowledge it or return it for fixes.
CREATE TABLE IF NOT EXISTS attendance_submissions (
  id              text PRIMARY KEY,
  "projectId"     text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  department      text NOT NULL REFERENCES departments(id),
  type            text NOT NULL,
  "periodStart"   text NOT NULL,
  "periodEnd"     text NOT NULL,
  status          text NOT NULL DEFAULT 'submitted',
  "submittedBy"   text NOT NULL REFERENCES users(id),
  "submittedAt"   timestamptz NOT NULL DEFAULT now(),
  "employeeNote"  text,
  "workerCount"   integer NOT NULL DEFAULT 0,
  "daysPresent"   double precision NOT NULL DEFAULT 0,
  "otHours"       double precision NOT NULL DEFAULT 0,
  "reviewedBy"    text REFERENCES users(id),
  "reviewedAt"    timestamptz,
  "reviewNote"    text,
  UNIQUE ("projectId", type, "periodStart")
);
CREATE INDEX IF NOT EXISTS attendance_submissions_dept_idx ON attendance_submissions (department, status);

-- Per-day adjustment the field team can record: hours missed (arrived late /
-- left early) and a short note. Payroll deducts lateHours/8 of a day.
ALTER TABLE worker_attendance ADD COLUMN IF NOT EXISTS "lateHours" double precision NOT NULL DEFAULT 0;
ALTER TABLE worker_attendance ADD COLUMN IF NOT EXISTS "activityNote" text;

-- ---------------------------------------------------------------------------
-- Company structure (paper "Head Office Structure" and "Site Structure").
-- A POSITION is a seat in the structure; a PERSON is a user assigned to it.
-- The system role (admin/supervisor/employee/finance) is unchanged.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS positions (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  type        text NOT NULL CHECK (type IN ('head_office', 'site')),
  level       integer NOT NULL,
  "parentId"  text,
  "sortOrder" integer NOT NULL DEFAULT 0
);

-- Who holds each position on a given project (site positions).
CREATE TABLE IF NOT EXISTS project_position_assignments (
  id           text PRIMARY KEY,
  "projectId"  text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  "positionId" text NOT NULL REFERENCES positions(id),
  "userId"     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE ("projectId", "positionId")
);

-- Who holds each head-office position (company-wide, one person per seat).
CREATE TABLE IF NOT EXISTS head_office_position_assignments (
  id           text PRIMARY KEY,
  "positionId" text NOT NULL UNIQUE REFERENCES positions(id),
  "userId"     text NOT NULL REFERENCES users(id) ON DELETE CASCADE
);

-- Project details from the paper project sheet.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS "projectNumber" text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS client text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS contractor text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS consultant text;

INSERT INTO positions (id, name, type, level, "parentId", "sortOrder") VALUES
  ('ho-gm',                'General Manager',         'head_office', 1, NULL,            1),
  ('ho-dgm',               'Deputy General Manager',  'head_office', 2, 'ho-gm',         2),
  ('ho-core-manager',      'Core Department Manager', 'head_office', 3, 'ho-dgm',        3),
  ('ho-finance',           'Finance',                 'head_office', 3, 'ho-dgm',        4),
  ('ho-administrator',     'Administrator',           'head_office', 3, 'ho-dgm',        5),
  ('ho-contract',          'Contract Department',     'head_office', 4, 'ho-core-manager', 6),
  ('ho-construction',      'Construction Department', 'head_office', 4, 'ho-core-manager', 7),
  ('ho-office-engineer',   'Office Engineer',         'head_office', 5, 'ho-contract',   8),
  ('ho-qs',                'Quantity Surveyor',       'head_office', 5, 'ho-contract',   9),
  ('ho-project-coordinator','Project Coordinator',    'head_office', 5, 'ho-construction', 10),
  ('ho-finance-office',    'Finance (Office)',        'head_office', 4, 'ho-finance',    11),
  ('ho-finance-site',      'Finance (Site)',          'head_office', 4, 'ho-finance',    12),
  ('site-project-manager', 'Project Manager',         'site', 1, NULL,                   1),
  ('site-engineer',        'Site Engineer',           'site', 2, 'site-project-manager', 2),
  ('site-office-engineer', 'Office Engineer',         'site', 2, 'site-project-manager', 3),
  ('site-finance',         'Site Finance',            'site', 2, 'site-project-manager', 4),
  ('foreman',              'Foreman',                 'site', 3, 'site-engineer',        5),
  ('site-qs',              'Quantity Surveyor',       'site', 3, 'site-office-engineer', 6),
  ('data-collector',       'Data Collector',          'site', 3, 'site-office-engineer', 7),
  ('time-keeper',          'Time Keeper',             'site', 3, 'site-finance',         8),
  ('store-keeper',         'Store Keeper',            'site', 3, 'site-finance',         9)
ON CONFLICT (id) DO NOTHING;
