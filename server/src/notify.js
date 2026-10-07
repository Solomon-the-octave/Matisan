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
  } catch (e) {
    console.error('notify failed:', e.message);
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
