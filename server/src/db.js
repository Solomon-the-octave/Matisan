import pg from 'pg';
import { nanoid } from 'nanoid';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Loaded here (not just in index.js) so DATABASE_URL is set before the Pool
// below is constructed, regardless of which module imports db.js first —
// import side effects run before any later dotenv.config() call would.
// Resolved relative to this file (not process.cwd()) so it finds
// server/.env whether the process was started from the repo root, the
// server folder, or anywhere else. In production (Render, etc.) env vars
// come from the host directly and no .env file exists — dotenv just finds
// nothing and moves on.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { Pool } = pg;

// Single shared connection pool for the whole API process. pg pools
// connections automatically (default max 10) and queues requests beyond
// that, so concurrent requests across multiple projects/sites don't
// collide or crash the server the way a single JSON file write would.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // A handful of hosted Postgres providers (Render, Railway, Supabase, ...)
  // require SSL but ship a cert that isn't in Node's default trust store.
  ssl: process.env.PGSSL === 'require' ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (err) => {
  // A dropped idle connection shouldn't crash the whole API process — the
  // pool reconnects on the next query.
  console.error('Unexpected Postgres pool error', err);
});

/**
 * Run a parameterized query. Always use this (never string-concatenate
 * values into SQL) to stay safe from injection.
 */
export function query(text, params) {
  return pool.query(text, params);
}

/** Run a query and return just the rows array. */
export async function rows(text, params) {
  const res = await pool.query(text, params);
  return res.rows;
}

/** Run a query and return the first row, or null if there isn't one. */
export async function row(text, params) {
  const res = await pool.query(text, params);
  return res.rows[0] || null;
}

/** Run a function inside a transaction, committing on success and rolling back on error. */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export function generateId(prefix) {
  return `${prefix}-${nanoid(8)}`;
}

// Sequential, human-readable worker IDs (WKR-0001, WKR-0002, ...) so a site
// registrar can read an ID out loud or write it on a paper roster. Backed
// by a Postgres sequence so it's safe under concurrent registrations
// (unlike the old lowdb "count the array" approach).
export async function generateWorkerId() {
  // Skip any ID already taken (e.g. rows inserted with explicit IDs by the
  // demo seed) so the sequence can never collide with existing workers.
  for (;;) {
    const { rows: r } = await pool.query("SELECT nextval('worker_id_seq') AS n");
    const id = `WKR-${String(r[0].n).padStart(4, '0')}`;
    const taken = await pool.query('SELECT 1 FROM workers WHERE id = $1', [id]);
    if (taken.rowCount === 0) return id;
  }
}

/** Quick connectivity check used at boot so a bad DATABASE_URL fails fast with a clear message. */
export async function assertDbConnection() {
  await pool.query('SELECT 1');
}

export default { pool, query, rows, row, withTransaction, generateId, generateWorkerId, assertDbConnection };
