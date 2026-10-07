import { Router } from 'express';
import multer from 'multer';
import { notify, stepHolderIds, projectLabel } from '../notify.js';
import { computePayroll } from './workerAttendance.js';
import { rows, row, query, generateId } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { APPROVAL_STEPS, LAST_STEP, statusForStep } from '../approvalSteps.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const SYSTEM_VIEW = { isGlobalAdmin: true, role: 'admin' };

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
    `INSERT INTO payroll_periods (id, "projectId", department, "weekStart", "weekEnd", status, "submittedBy", "submittedAt", "currentStep", "requestNo")
     VALUES ($1,$2,$3,$4,$5,'submitted',$6,now(),1, 'PAY-' || lpad(nextval('payroll_request_seq')::text, 4, '0'))`,
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
  const pointer = await syncPeriod(period.id);
  try { await notifyAfter(period, step, action, pointer, userId, comment, toStep); } catch (e) { console.error('notify failed:', e.message); }
  return pointer;
}

async function notifyAfter(period, step, action, pointer, userId, comment, toStep) {
  const project = await projectLabel(period.projectId);
  const week = `${String(period.weekStart).slice(0, 10)} – ${String(period.weekEnd).slice(0, 10)}`;
  const link = `/approvals?period=${period.id}`;
  const ref = period.requestNo ? `${period.requestNo} · ` : '';
  const who = (await row('SELECT name FROM users WHERE id = $1', [userId]))?.name || 'Someone';
  if (action === 'completed' && pointer <= LAST_STEP) {
    const next = APPROVAL_STEPS[pointer - 1];
    const ids = (await stepHolderIds(period, next)).filter((id) => id !== userId);
    await notify(ids, { type: 'approval', title: `${next.action}: ${project}`, body: `${ref}Week ${week} is waiting for your ${next.action.toLowerCase()} (${next.name}).`, link });
  } else if (action === 'completed') {
    const submitter = (await row('SELECT "submittedBy" FROM payroll_periods WHERE id = $1', [period.id]))?.submittedBy;
    const manager = (await row('SELECT "managerId" FROM projects WHERE id = $1', [period.projectId]))?.managerId;
    await notify([submitter, manager].filter((id) => id !== userId), { type: 'paid', title: `Paid: ${project}`, body: `${ref}Week ${week} has been paid.`, link });
  } else if (action === 'returned') {
    const target = Math.max(1, toStep ?? step - 1);
    const def = APPROVAL_STEPS[target - 1];
    let ids = await stepHolderIds(period, def);
    if (target <= 1) ids = [...ids, (await row('SELECT "submittedBy" FROM payroll_periods WHERE id = $1', [period.id]))?.submittedBy];
    await notify(ids.filter((id) => id !== userId), { type: 'returned', title: `Returned: ${project}`, body: `${ref}${who} returned week ${week}${comment ? `: ${comment}` : ''}`, link });
  }
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

// Calculated payroll for the week (Days x Rate + OT x Rate/8), whole project.
async function periodTotal(period) {
  const r = await computePayroll(SYSTEM_VIEW, { projectId: period.projectId, from: String(period.weekStart).slice(0, 10), to: String(period.weekEnd).slice(0, 10) });
  return r.totals?.cost || 0;
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
      action: def.action,
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
  const payrollTotal = await periodTotal(period);
  const pay = await row(
    `SELECT pm.id, pm."amountPaid", pm."paidDate", pm.reference, pm.method, pm."proofName", pm."createdAt", u.name AS "paidByName"
     FROM payroll_payments pm JOIN users u ON u.id = pm."paidBy" WHERE pm."periodId" = $1`,
    [period.id]
  );
  const payment = pay ? { ...pay, amountPaid: Number(pay.amountPaid), hasProof: !!pay.proofName, differsFromTotal: Math.abs(Number(pay.amountPaid) - payrollTotal) > 0.005 } : null;
  return {
    payrollTotal,
    payment,
    period: { requestNo: period.requestNo, id: period.id, projectId: period.projectId, projectName: period.projectName, weekStart: period.weekStart, weekEnd: period.weekEnd, status: period.status, currentStep: pointer },
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
      weekStart: pp.weekStart, weekEnd: pp.weekEnd, step: pp.currentStep, label: def.label, action: def.action,
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
  if (pointer === LAST_STEP) return res.status(409).json({ error: 'The last step is Mark as paid: record the amount and date of payment.' });
  const def = APPROVAL_STEPS[pointer - 1];
  if (!(await canActOnStep(req.user, period, def))) {
    return res.status(403).json({ error: `Only the ${def.name} (${def.label}) can do this step` });
  }
  const comment = req.body.comment ? String(req.body.comment).slice(0, 300) : null;
  await logStep(period, pointer, req.user.id, 'completed', { comment });
  res.json(await buildTrail(req.user, await loadPeriod(period.id)));
});

// Step 10: Finance records the actual payment and the request is closed.
router.post('/period/:id/pay', requireAuth, upload.single('proof'), async (req, res) => {
  const period = await loadPeriod(req.params.id);
  if (!period) return res.status(404).json({ error: 'Payroll period not found' });
  const pointer = pointerFromRecords(await periodRecords(period.id));
  if (pointer !== LAST_STEP) {
    return res.status(409).json({ error: pointer > LAST_STEP ? 'This request is already paid' : 'Payment can only be recorded once every approval step is done' });
  }
  const def = APPROVAL_STEPS[LAST_STEP - 1];
  if (!(await canActOnStep(req.user, period, def))) {
    return res.status(403).json({ error: `Only the ${def.name} (${def.label}) can record the payment` });
  }
  const total = await periodTotal(period);
  const amount = req.body.amountPaid === undefined || req.body.amountPaid === '' ? total : Number(req.body.amountPaid);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Enter the amount paid' });
  const paidDate = String(req.body.paidDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidDate) || Number.isNaN(Date.parse(paidDate))) return res.status(400).json({ error: 'Enter the payment date' });
  const reference = req.body.reference ? String(req.body.reference).trim().slice(0, 100) : null;
  const method = req.body.method ? String(req.body.method).trim().slice(0, 40) : null;
  const f = req.file;
  await query(
    `INSERT INTO payroll_payments (id, "periodId", "amountPaid", "paidDate", reference, method, "proofName", "proofType", "proofData", "paidBy")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [generateId('pay'), period.id, amount, paidDate, reference, method, f?.originalname?.slice(0, 150) || null, f?.mimetype || null, f?.buffer || null, req.user.id]
  );
  const note = Math.abs(amount - total) > 0.005 ? `Paid ${amount.toFixed(2)} (calculated ${total.toFixed(2)})` : null;
  await logStep(period, LAST_STEP, req.user.id, 'completed', { comment: note });
  res.json(await buildTrail(req.user, await loadPeriod(period.id)));
});

router.get('/period/:id/payment/proof', requireAuth, async (req, res) => {
  const period = await loadPeriod(req.params.id);
  if (!period) return res.status(404).json({ error: 'Payroll period not found' });
  if (!(await canViewPeriod(req.user, period))) return res.status(403).json({ error: 'You do not have access to this week' });
  const p = await row('SELECT "proofName", "proofType", "proofData" FROM payroll_payments WHERE "periodId" = $1', [period.id]);
  if (!p?.proofData) return res.status(404).json({ error: 'No proof was attached' });
  res.setHeader('Content-Type', p.proofType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(p.proofName || 'proof')}"`);
  res.send(p.proofData);
});

router.post('/period/:id/return', requireAuth, async (req, res) => {
  const period = await loadPeriod(req.params.id);
  if (!period) return res.status(404).json({ error: 'Payroll period not found' });
  const pointer = pointerFromRecords(await periodRecords(period.id));
  if (pointer < 2 || pointer > LAST_STEP) return res.status(409).json({ error: 'There is nothing to return at this stage' });
  const def = APPROVAL_STEPS[pointer - 1];
  if (!(await canActOnStep(req.user, period, def))) {
    return res.status(403).json({ error: `Only the ${def.name} (${def.label}) can do this step` });
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

// The Foreman's weekly "Acknowledge" is step 2 of the trail ("Checked By").
export async function acknowledgeWeekAsForeman(projectId, weekStart, weekEnd, user) {
  const period = await row('SELECT * FROM payroll_periods WHERE "projectId" = $1 AND "weekStart" = $2 AND "weekEnd" = $3', [projectId, weekStart, weekEnd]);
  if (!period) return { ok: true }; // nothing in the trail yet
  const pointer = pointerFromRecords(await periodRecords(period.id));
  if (pointer !== 2) return { ok: true }; // already past the Foreman's check
  const def = APPROVAL_STEPS[1];
  if (!(await canActOnStep(user, period, def))) {
    return { ok: false, error: `Only the ${def.name} on this project can check this week. Ask the admin to assign a ${def.name} under Projects > Project team.` };
  }
  await logStep(period, 2, user.id, 'completed', {});
  return { ok: true };
}

// Admin correction path: send a signed-off week back to the site checks.
export async function adminReopen(period, userId) {
  const pointer = pointerFromRecords(await periodRecords(period.id));
  if (pointer <= 3) return pointer;
  await query('DELETE FROM payroll_payments WHERE "periodId" = $1', [period.id]); // a reopened week is paid afresh
  return logStep(period, pointer, userId, 'returned', { toStep: 3, comment: 'Reopened by admin' });
}

export default router;
