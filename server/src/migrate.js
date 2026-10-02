// Applies sql/schema.sql against DATABASE_URL. Plain SQL, no native engine
// binaries required — runs anywhere Node + the `pg` driver run (including
// as a deploy-time build step on a host with no extra CLI tools installed).
// Safe to run on every deploy: every statement in schema.sql is
// `CREATE ... IF NOT EXISTS`, so re-running it against an already-migrated
// database is a no-op.
//
// Usage: node src/migrate.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { pool } from './db.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const sqlPath = path.join(__dirname, '..', 'sql', 'schema.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  console.log('Applying sql/schema.sql ...');
  await pool.query(sql);
  console.log('Schema is up to date.');
  await pool.end();
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
