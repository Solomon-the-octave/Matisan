import { rows, row, query, generateId } from './db.js';

// Never lets a notification problem break the real action.
export async function notify(userIds, { type, title, body = null, link = null }) {
  try {
    const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean))];
    for (const userId of ids) {
      await query(
        'INSERT INTO notifications (id, "userId", type, title, body, link) VALUES ($1,$2,$3,$4,$5,$6)',
        [generateId('ntf'), userId, type, String(title).slice(0, 200), body ? String(body).slice(0, 400) : null, link]
      );
    }
    // Copy to email as well, so a person who is not logged in still hears.
    // Off until RESEND_API_KEY and EMAIL_FROM are set; never blocks the action.
    if (emailEnabled()) sendEmails(ids, { title, body, link }).catch((e) => console.error('email failed:', e.message));
  } catch (e) {
    console.error('notify failed:', e.message);
  }
}

export function emailEnabled() {
  return !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function sendEmails(userIds, { title, body, link }) {
  const people = await rows('SELECT name, email FROM users WHERE id = ANY($1) AND COALESCE("isActive", true) = true AND email IS NOT NULL', [userIds]);
  const base = (process.env.APP_URL || '').replace(/\/$/, '');
  const url = link && base ? base + link : base || null;
  for (const u of people) {
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1e293b">
      <p>Hello ${esc(u.name)},</p>
      <p><b>${esc(title)}</b></p>
      ${body ? `<p>${esc(body)}</p>` : ''}
      ${url ? `<p><a href="${esc(url)}" style="background:#1d4ed8;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">Open Matisan HR</a></p>` : ''}
      <p style="color:#94a3b8;font-size:12px">Matisan Engineering Private Ltd Co. This is an automatic message.</p></div>`;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [u.email], subject: String(title).slice(0, 150), html }),
    });
    if (!res.ok) console.error('email to', u.email, 'failed:', res.status, (await res.text()).slice(0, 200));
  }
}

// Whoever sits in the seat for an approval step on this week's project.
export async function stepHolderIds(period, stepDef) {
  if (!stepDef) return [];
  const list = stepDef.scope === 'site'
    ? await rows('SELECT "userId" FROM project_position_assignments WHERE "projectId" = $1 AND "positionId" = $2', [period.projectId, stepDef.positionId])
    : await rows('SELECT "userId" FROM head_office_position_assignments WHERE "positionId" = $1', [stepDef.positionId]);
  return list.map((r) => r.userId);
}

export async function projectLabel(projectId) {
  return (await row('SELECT name FROM projects WHERE id = $1', [projectId]))?.name || 'a project';
}
