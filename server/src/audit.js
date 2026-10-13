import { query, row } from './db.js';

// Never lets a logging problem break the real action.
export async function audit(user, action, entityType, entityId, summary, detail = null) {
  try {
    const actorName = user?.name || (user?.id ? (await row('SELECT name FROM users WHERE id = $1', [user.id]))?.name : null) || null;
    await query(
      'INSERT INTO audit_log ("actorId","actorName",action,"entityType","entityId",summary,detail) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [user?.id || null, actorName, action, entityType, entityId || null, String(summary).slice(0, 500), detail ? JSON.stringify(detail) : null]
    );
  } catch (e) {
    console.error('audit failed:', e.message);
  }
}

// [{ field, from, to }] for the listed fields whose value really changed.
export function changes(before, after, fields) {
  const out = [];
  for (const f of fields) {
    if (after[f] === undefined) continue;
    const a = before[f] ?? null;
    const b = after[f] ?? null;
    if (String(a ?? '') !== String(b ?? '')) out.push({ field: f, from: a, to: b });
  }
  return out;
}

export const describe = (list) => list.map((c) => `${c.field}: ${c.from ?? 'none'} to ${c.to ?? 'none'}`).join('; ');
