import { Router } from 'express';
import { rows, row, query, generateId } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { APPROVAL_STEPS, LAST_STEP, statusForStep } from '../approvalSteps.js';

const router = Router();

// --- shared helpers (also used by payrollPeriods / attendanceSubmissions) ---

// Replay the log: completing the current step moves forward; returning moves
// back (to the previous step unless `toStep` says otherwise).
export function pointerFromRecords(records) {
  let pointer = 1;
  for (const r of records) {
    if (r.action === 'completed' && r.step === pointer) pointer = r.step + 1;
    else if (r.action === 'returned' && r.step === pointer) pointer = Math.max(1, r.toStep ?? r.step - 1);
  }
  return pointer;
}

async function periodRecords(periodId) {
  return rows(
    `SELECT r.*, u.name AS "userName" FROM approval_records r JOIN users u ON u.id = r."userId"
     WHERE r."periodId" = $1 ORDER BY r."actionDate", r.id`,
    [periodId]
  );
}

async function syncPeriod(periodId) {
  const records = await periodRecords(periodId);
  const pointer = pointerFromRecords(records);
  await query('UPDATE payroll_periods SET "currentStep" = $1, status = $2 WHERE id = $3', [pointer, statusForStep(pointer), periodId]);
  return pointer;
}

// Does this person sit in the seat for this step (on this project)?
export async function holdsStepPosition(user, period, stepDef) {
  if (stepDef.scope === 'site') {
    const hit = await row(
      'SELECT 1 AS x FROM project_position_assignments WHERE "projectId" = $1 AND "positionId" = $2 AND "userId" = $3',
      [period.projectId, stepDef.positionId, user.id]
    );
    return !!hit;
  }
  const hit = await row('SELECT 1 AS x FROM head_office_position_assignments WHERE "positionId" = $1 AND "userId" = $2', [stepDef.positionId, user.id]);
  return !!hit;
}

export async function canActOnStep(user, period, stepDef) {
  if (user.isGlobalAdmin) return true; // admin can act on any step
  return holdsStepPosition(user, period, stepDef);
}

export async function ensurePeriod(projectId, weekStart, weekEnd, userId) {
  const existing = await row('SELECT * FROM payroll_periods WHERE "projectId" = $1 AND "weekStart" = $2 AND "weekEnd" = $3', [projectId, weekStart, weekEnd]);
  if (existing) return existing;
  const project = await row('SELECT department FROM projects WHERE id = $1', [projectId]);
  const id = generateId('pp');
  await query(
    `INSERT INTO payroll_periods (id, "projectId", department, "weekStart", "weekEnd", status, "submittedBy", "submittedAt", "currentStep")
     VALUES ($1,$2,$3,$4,$5,'submitted',$6,now(),1)`,
    [id, projectId, project.department, weekStart, weekEnd, userId]
  );
  return row('SELECT * FROM payroll_periods WHERE id = $1', [id]);
}

export async function logStep(period, step, userId, action, { toStep = null, comment = null } = {}) {
  await query(
    `INSERT INTO approval_records (id, "periodId", step, "positionId", "userId", action, "toStep", comment)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [generateId('apr'), period.id, step, APPROVAL_STEPS[step - 1]?.positionId || null, userId, action, toStep, comment]
  );
  return syncPeriod(period.id);
}

// Step 1 (Prepared By): the field team handing in the week.
export async function recordWeeklyHandIn(projectId, weekStart, weekEnd, userId) {
  const period = await ensurePeriod(projectId, weekStart, weekEnd, userId);
  const pointer = pointerFromRecords(await periodRecords(period.id));
  if (pointer === 1) await logStep(period, 1, userId, 'completed');
  return period;
}

// A supervisor returning a week's hand-in sends it back to step 1 — only
// possible while it's still at the site checks.
export async function returnWeekToField(projectId, weekStart, weekEnd, userId, comment) {
  const period = await row('SELECT * FROM payroll_periods WHERE "projectId" = $1 AND "weekStart" = $2 AND "weekEnd" = $3', [projectId, weekStart, weekEnd]);
  if (!period) return { ok: true };
  const pointer = pointerFromRecords(await periodRecords(period.id));
  if (pointer > 3) return { ok: false, error: 'This week is already with head office. Return it from Payroll Review instead.' };
  if (pointer >= 2) await logStep(period, pointer, userId, 'returned', { toStep: 1, comment });
  return { ok: true };
}

// --- reads ---------------------------------------------------------------

async function loadPeriod(id) {
  return row(
    `SELECT pp.*, p.name AS "projectName" FROM payroll_periods pp JOIN projects p ON p.id = pp."projectId" WHERE pp.id = $1`,
    [id]
  );
}

async function canViewPeriod(user, period) {
  if (user.isGlobalAdmin || user.role === 'finance') return true;
  if (user.role === 'supervisor' && period.department === user.department) return true;
  const ho = await row('SELECT 1 AS x FROM head_office_position_assignments WHERE "userId" = $1', [user.id]);
  if (ho) return true;
  const mine = await row(
    `SELECT 1 AS x FROM project_assignments WHERE "projectId" = $1 AND "userId" = $2
     UNION SELECT 1 FROM project_position_assignments WHERE "projectId" = $1 AND "userId" = $2`,
    [period.projectId, user.id]
  );
  return !!mine;
}

async function assigneeFor(period, stepDef) {
  if (stepDef.scope === 'site') {
    return row(
      `SELECT u.id AS "userId", u.name FROM project_position_assignments a JOIN users u ON u.id = a."userId"
       WHERE a."projectId" = $1 AND a."positionId" = $2`,
      [period.projectId, stepDef.positionId]
    );
  }
  return row(
    `SELECT u.id AS "userId", u.name FROM head_office_position_assignments a JOIN users u ON u.id = a."userId"
     WHERE a."positionId" = $1`,
    [stepDef.positionId]
  );
}

async function buildTrail(user, period) {
  const records = await periodRecords(period.id);
  const pointer = pointerFromRecords(records);
  const positions = await rows('SELECT id, name FROM positions');
  const posName = Object.fromEntries(positions.map((p) => [p.id, p.name]));
  const steps = [];
  for (const def of APPROVAL_STEPS) {
    const forStep = records.filter((r) => r.step === def.step);
    const lastDone = [...forStep].reverse().find((r) => r.action === 'completed');
    // "Returned" shows on the step that was sent back to, with the reason.
    const sentBack = [...records].reverse().find((r) => r.action === 'returned' && (r.toStep ?? r.step - 1) === def.step);
    let status = 'pending';
    if (pointer > def.step) status = 'completed';
    else if (pointer === def.step && sentBack && records.indexOf(sentBack) > records.findLastIndex((r) => r.action === 'completed' && r.step === def.step)) status = 'returned';
    const assignee = await assigneeFor(period, def);
    steps.push({
      step: def.step,
      label: def.label,
      positionId: def.positionId,
      positionName: posName[def.positionId] || def.positionId,
      scope: def.scope,
      assignee: assignee ? { userId: assignee.userId, name: assignee.name } : null,
      status,
      current: pointer === def.step,
      actedBy: status === 'completed' && lastDone ? lastDone.userName : null,
      actedAt: status === 'completed' && lastDone ? lastDone.actionDate : null,
      comment: status === 'returned' ? sentBack.comment : null,
      returnedBy: status === 'returned' ? sentBack.userName : null,
    });
  }
  let canAct = false;
  if (pointer <= LAST_STEP) canAct = await canActOnStep(user, period, APPROVAL_STEPS[pointer - 1]);
  return {
    period: { id: period.id, projectId: period.projectId, projectName: period.projectName, weekStart: period.weekStart, weekEnd: period.weekEnd, status: period.status, currentStep: pointer },
    steps,
    history: records.map((r) => ({
      step: r.step, label: APPROVAL_STEPS[r.step - 1]?.label, positionName: posName[r.positionId] || r.positionId,
      action: r.action, comment: r.comment, userName: r.userName, actionDate: r.actionDate,
    })),
    canAct,
    // Step 1 is the field's hand-in; it can't be "returned" (nobody before it)
    canReturn: canAct && pointer >= 2 && pointer <= LAST_STEP,
  };
}

// Items waiting for the signed-in person to act on.
router.get('/waiting', requireAuth, async (req, res) => {
  const periods = await rows(
    `SELECT pp.*, p.name AS "projectName" FROM payroll_periods pp JOIN projects p ON p.id = pp."projectId"
     WHERE pp."currentStep" <= $1 ORDER BY pp."weekStart" DESC`,
    [LAST_STEP]
  );
  const items = [];
  for (const pp of periods) {
    const def = APPROVAL_STEPS[pp.currentStep - 1];
    // Step 1 is the field's own hand-in; the admin isn't asked to do it.
    if (pp.currentStep === 1 && req.user.isGlobalAdmin) continue;
    if (!(await canActOnStep(req.user, pp, def))) continue;
    let returnNote = null;
    if (pp.currentStep === 1) {
      const last = await row(`SELECT comment FROM approval_records WHERE "periodId" = $1 AND action = 'returned' ORDER BY "actionDate" DESC LIMIT 1`, [pp.id]);
      returnNote = last?.comment || null;
    }
    items.push({
      periodId: pp.id, projectId: pp.projectId, projectName: pp.projectName,
      weekStart: pp.weekStart, weekEnd: pp.weekEnd, step: pp.currentStep, label: def.label,
      positionName: (await row('SELECT name FROM positions WHERE id = $1', [def.positionId]))?.name,
      handIn: pp.currentStep === 1, returnNote,
    });
  }
  res.json({ items });
});

router.get('/period/:id', requireAuth, async (req, res) => {
  const period = await loadPeriod(req.params.id);
  if (!period) return res.status(404).json({ error: 'Payroll period not found' });
  if (!(await canViewPeriod(req.user, period))) return res.status(403).json({ error: 'You do not have access to this week' });
  res.json(await buildTrail(req.user, period));
});

// --- actions -------------------------------------------------------------

router.post('/period/:id/complete', requireAuth, async (req, res) => {
  const period = await loadPeriod(req.params.id);
  if (!period) return res.status(404).json({ error: 'Payroll period not found' });
  const pointer = pointerFromRecords(await periodRecords(period.id));
  if (pointer > LAST_STEP) return res.status(409).json({ error: 'This week is already fully signed off' });
  if (pointer === 1) return res.status(409).json({ error: 'Step 1 is the weekly hand-in. Submit the week from Field Attendance.' });
  const def = APPROVAL_STEPS[pointer - 1];
  if (!(await canActOnStep(req.user, period, def))) {
    return res.status(403).json({ error: `Only the ${def.label.replace(' By', '')} position holder can do this step` });
  }
  const comment = req.body.comment ? String(req.body.comment).slice(0, 300) : null;
  await logStep(period, pointer, req.user.id, 'completed', { comment });
  res.json(await buildTrail(req.user, await loadPeriod(period.id)));
});

router.post('/period/:id/return', requireAuth, async (req, res) => {
  const period = await loadPeriod(req.params.id);
  if (!period) return res.status(404).json({ error: 'Payroll period not found' });
  const pointer = pointerFromRecords(await periodRecords(period.id));
  if (pointer < 2 || pointer > LAST_STEP) return res.status(409).json({ error: 'There is nothing to return at this stage' });
  const def = APPROVAL_STEPS[pointer - 1];
  if (!(await canActOnStep(req.user, period, def))) {
    return res.status(403).json({ error: `Only the ${def.label.replace(' By', '')} position holder can do this step` });
  }
  const comment = req.body.comment ? String(req.body.comment).trim().slice(0, 300) : '';
  if (!comment) return res.status(400).json({ error: 'Add a short reason so the previous person knows what to fix' });
  await logStep(period, pointer, req.user.id, 'returned', { toStep: pointer - 1, comment });
  // Back at step 1 means the field team must fix and hand in again, so the
  // weekly hand-in is released for editing.
  if (pointer - 1 === 1) {
    await query(
      `UPDATE attendance_submissions SET status = 'returned', "reviewedBy" = $1, "reviewedAt" = now(), "reviewNote" = $2
       WHERE "projectId" = $3 AND type = 'weekly' AND "periodStart" = $4`,
      [req.user.id, comment, period.projectId, period.weekStart]
    );
  }
  res.json(await buildTrail(req.user, await loadPeriod(period.id)));
});

// Admin correction path: send a signed-off week back to the site checks.
export async function adminReopen(period, userId) {
  const pointer = pointerFromRecords(await periodRecords(period.id));
  if (pointer <= 3) return pointer;
  return logStep(period, pointer, userId, 'returned', { toStep: 3, comment: 'Reopened by admin' });
}

export default router;
