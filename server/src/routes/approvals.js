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

// The figures in front of the person at the moment they act, so the trail
// shows exactly what was checked, approved or returned.
async function figuresSnapshot(period) {
  try {
    const r = await computePayroll(SYSTEM_VIEW, { projectId: period.projectId, from: String(period.weekStart).slice(0, 10), to: String(period.weekEnd).slice(0, 10) });
    return { workers: r.totals?.workers || 0, daysPresent: r.totals?.daysPresent || 0, otHours: r.totals?.otHours || 0, cost: r.totals?.cost || 0 };
  } catch { return null; }
}

// The seat the person acted from: their position on this project, Project
// Manager, a Head Office seat, or Administrator.
async function actorPositionFor(period, userId, step) {
  const u = await row('SELECT role, "isGlobalAdmin" FROM users WHERE id = $1', [userId]);
  const stepPos = APPROVAL_STEPS[step - 1]?.positionId;
  if (stepPos) {
    const held = await row(
      `SELECT pos.name FROM positions pos WHERE pos.id = $3 AND (
         EXISTS (SELECT 1 FROM project_position_assignments a WHERE a."userId" = $1 AND a."projectId" = $2 AND a."positionId" = pos.id)
         OR EXISTS (SELECT 1 FROM head_office_position_assignments h WHERE h."userId" = $1 AND h."positionId" = pos.id)
         OR (pos.id = 'site-project-manager' AND EXISTS (SELECT 1 FROM projects pr WHERE pr.id = $2 AND pr."managerId" = $1)))`,
      [userId, period.projectId, stepPos]
    );
    if (held) return held.name;
    if (u?.isGlobalAdmin || u?.role === 'admin') return 'Administrator';
  }
  const seat = await row(
    `SELECT pos.name FROM project_position_assignments a JOIN positions pos ON pos.id = a."positionId"
     WHERE a."userId" = $1 AND a."projectId" = $2 ORDER BY pos.level LIMIT 1`, [userId, period.projectId]);
  if (seat) return seat.name;
  if ((await row('SELECT 1 AS x FROM projects WHERE id = $1 AND "managerId" = $2', [period.projectId, userId]))) return 'Project Manager';
  const ho = await row(
    `SELECT pos.name FROM head_office_position_assignments h JOIN positions pos ON pos.id = h."positionId"
     WHERE h."userId" = $1 ORDER BY pos.level LIMIT 1`, [userId]);
  if (ho) return ho.name;
  return u?.isGlobalAdmin || u?.role === 'admin' ? 'Administrator' : null;
}

export async function logStep(period, step, userId, action, { toStep = null, comment = null } = {}) {
  const snapshot = await figuresSnapshot(period);
  const actorPosition = await actorPositionFor(period, userId, step);
  await query(
    `INSERT INTO approval_records (id, "periodId", step, "positionId", "userId", action, "toStep", comment, snapshot, "actorPosition")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [generateId('apr'), period.id, step, APPROVAL_STEPS[step - 1]?.positionId || null, userId, action, toStep, comment, snapshot ? JSON.stringify(snapshot) : null, actorPosition]
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
      toStep: r.toStep, stepName: APPROVAL_STEPS[r.step - 1]?.name, actorPosition: r.actorPosition || null, snapshot: r.snapshot || null,
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

// Everything a reviewer needs to judge a week before approving it: the
// project, the payroll line by line, the day-by-day attendance behind it, the
// field hand-in notes, and plain-language flags for things worth a second look.
// Read-only; it adds no step and blocks nothing.
router.get('/period/:id/review', requireAuth, async (req, res) => {
  const period = await loadPeriod(req.params.id);
  if (!period) return res.status(404).json({ error: 'Payroll period not found' });
  if (!(await canViewPeriod(req.user, period))) return res.status(403).json({ error: 'You do not have access to this week' });

  const from = String(period.weekStart).slice(0, 10);
  const to = String(period.weekEnd).slice(0, 10);
  const calc = await computePayroll(SYSTEM_VIEW, { projectId: period.projectId, from, to });
  const project = await row(
    `SELECT p.name, p."projectNumber", p.client, p.site, p.status, m.name AS "managerName"
     FROM projects p LEFT JOIN users m ON m.id = p."managerId" WHERE p.id = $1`, [period.projectId]);

  const days = [];
  for (let d = new Date(from + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= to; d = new Date(d.getTime() + 86400000)) days.push(d.toISOString().slice(0, 10));
  const att = await rows(
    `SELECT "workerId", date, am, pm, "otHours", "lateHours", "offlineRecordedAt" FROM worker_attendance
     WHERE "projectId" = $1 AND date >= $2 AND date <= $3`, [period.projectId, from, to]);
  const grid = {};
  const missed = {};
  let offlineCount = 0;
  for (const a of att) {
    (grid[a.workerId] ||= {})[String(a.date).slice(0, 10)] = { am: a.am, pm: a.pm, ot: Number(a.otHours) || 0, late: Number(a.lateHours) || 0 };
    missed[a.workerId] = (missed[a.workerId] || 0) + (Number(a.lateHours) || 0);
    if (a.offlineRecordedAt) offlineCount += 1;
  }
  const dayTotals = days.map((d) => ({
    date: d,
    present: att.filter((a) => String(a.date).slice(0, 10) === d && (a.am || a.pm)).length,
    ot: att.filter((a) => String(a.date).slice(0, 10) === d).reduce((t, a) => t + (Number(a.otHours) || 0), 0),
  }));

  const payroll = calc.payroll.map((w) => ({
    workerId: w.workerId, name: w.name, trade: w.trade, laborType: w.laborType, dailyRate: w.dailyRate, hasBank: !!w.bankAccount,
    daysPresent: w.daysPresent, otHours: w.otHours, hoursMissed: missed[w.workerId] || 0, basePay: w.basePay, otPay: w.otPay, total: w.total,
  }));

  const handIn = await rows(
    `SELECT s.type, s.status, s."periodStart", s."submittedAt", s."employeeNote", s."reviewNote", s."reviewedAt", u.name AS "submittedByName", r.name AS "reviewedByName"
     FROM attendance_submissions s JOIN users u ON u.id = s."submittedBy" LEFT JOIN users r ON r.id = s."reviewedBy"
     WHERE s."projectId" = $1 AND s."periodStart" >= $2 AND s."periodStart" <= $3 ORDER BY s."periodStart", s.type`, [period.projectId, from, to]);

  // Plain-language things worth a second look. They never block anything.
  const flags = [];
  const warn = (text) => flags.push({ level: 'warn', text });
  const info = (text) => flags.push({ level: 'info', text });
  for (const w of payroll) {
    if (!w.dailyRate) warn(`${w.name} has no daily rate, so their pay cannot be calculated.`);
    if (!w.hasBank) info(`${w.name} has no bank account on file.`);
    const g = grid[w.workerId] || {};
    const maxOt = Math.max(0, ...Object.values(g).map((x) => x.ot));
    if (maxOt > 4) warn(`${w.name} has ${maxOt} OT hours on one day, which is high.`);
    else if (w.otHours > 20) warn(`${w.name} has ${w.otHours} OT hours this week, which is high.`);
    if (Object.values(g).filter((x) => x.am || x.pm).length >= 7) info(`${w.name} worked all 7 days with no rest day.`);
  }
  const seen = {};
  for (const w of payroll) {
    const k = String(w.name).trim().toLowerCase();
    if (seen[k]) warn(`Two workers are named "${w.name}". Check it is not a duplicate registration.`);
    seen[k] = true;
  }
  const registered = await rows('SELECT id, name FROM workers WHERE "projectId" = $1', [period.projectId]);
  const idle = registered.filter((w) => !grid[w.id]);
  if (idle.length) info(`${idle.length} registered ${idle.length === 1 ? 'worker has' : 'workers have'} no attendance this week: ${idle.slice(0, 5).map((w) => w.name).join(', ')}${idle.length > 5 ? ' and more' : ''}.`);
  if (!payroll.length) warn('No attendance was recorded for this week.');
  if (offlineCount) info(`${offlineCount} attendance ${offlineCount === 1 ? 'entry was' : 'entries were'} recorded offline and uploaded later.`);

  // Did the figures change since the last person acted?
  const records = await periodRecords(period.id);
  const lastWithFigures = [...records].reverse().find((r) => r.snapshot);
  const total = calc.totals?.cost || 0;
  let sinceLast = null;
  if (lastWithFigures) {
    const before = Number(lastWithFigures.snapshot.cost) || 0;
    if (Math.abs(before - total) > 0.005) {
      sinceLast = { from: before, to: total, by: lastWithFigures.userName, at: lastWithFigures.actionDate };
      warn(`The total changed from ${before.toLocaleString()} to ${total.toLocaleString()} ETB since ${lastWithFigures.userName} last acted.`);
    }
  }
  const lastReturnIdx = records.map((r) => r.action).lastIndexOf('returned');
  // Only worth showing while nothing has been completed since it was sent back.
  const lastReturn = lastReturnIdx >= 0 && !records.slice(lastReturnIdx + 1).some((r) => r.action === 'completed') ? records[lastReturnIdx] : null;

  res.json({
    project, period: { requestNo: period.requestNo, weekStart: from, weekEnd: to, currentStep: period.currentStep },
    totals: { workers: calc.totals?.workers || 0, daysPresent: calc.totals?.daysPresent || 0, otHours: calc.totals?.otHours || 0, cost: total, byLaborType: calc.totals?.byLaborType || {} },
    payroll, days, grid, dayTotals, handIn, flags, sinceLast,
    lastReturn: lastReturn ? { by: lastReturn.userName, at: lastReturn.actionDate, note: lastReturn.comment } : null,
  });
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
