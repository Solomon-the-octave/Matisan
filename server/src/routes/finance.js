import { Router } from 'express';
import { rows, row } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { APPROVAL_STEPS, LAST_STEP } from '../approvalSteps.js';
import { computePayroll } from './workerAttendance.js';

// Head Office Finance: the permanent record of every payroll request and
// payment, filed in one folder per project, plus the queue of requests that
// have cleared all earlier steps and are waiting for Finance's final check.
// Nothing here adds an approval stage: paying is still step 10 of the path.
const router = Router();
const SYSTEM_VIEW = { isGlobalAdmin: true, role: 'admin' };
const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? null : String(v).slice(0, 10));
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Admin, the Finance role, or whoever sits in the Head Office Finance seat.
async function requireFinance(req, res, next) {
  const u = req.user;
  if (u.isGlobalAdmin || u.role === 'finance') return next();
  const seat = await row(`SELECT 1 AS x FROM head_office_position_assignments WHERE "userId" = $1 AND "positionId" = 'ho-finance'`, [u.id]);
  if (seat) return next();
  return res.status(403).json({ error: 'Head Office Finance is for Finance and administrators' });
}

async function totalFor(period) {
  const c = await computePayroll(SYSTEM_VIEW, { projectId: period.projectId, from: iso(period.weekStart), to: iso(period.weekEnd) });
  return { calc: c, total: round2(c.totals?.cost) };
}

// One row per request, with its payment if there is one.
async function ledger(projectId) {
  const periods = await rows(
    `SELECT pp.*, p.name AS "projectName",
            pay."amountPaid", pay."paidDate", pay.reference, pay.method, pay."proofName",
            (pay."proofData" IS NOT NULL) AS "hasProof", pu.name AS "paidByName"
     FROM payroll_periods pp
     JOIN projects p ON p.id = pp."projectId"
     LEFT JOIN payroll_payments pay ON pay."periodId" = pp.id
     LEFT JOIN users pu ON pu.id = pay."paidBy"
     ${projectId ? 'WHERE pp."projectId" = $1' : ''}
     ORDER BY pp."weekStart" DESC, pp."requestNo" DESC`,
    projectId ? [projectId] : []
  );
  const out = [];
  for (const pp of periods) {
    const { calc, total } = await totalFor(pp);
    out.push({
      id: pp.id, requestNo: pp.requestNo, projectId: pp.projectId, projectName: pp.projectName,
      weekStart: iso(pp.weekStart), weekEnd: iso(pp.weekEnd), status: pp.status, currentStep: pp.currentStep,
      awaiting: pp.status === 'paid' ? null : APPROVAL_STEPS[pp.currentStep - 1]?.name || null,
      workers: calc.totals?.workers || 0, payrollTotal: total,
      amountPaid: pp.amountPaid == null ? null : Number(pp.amountPaid), paidDate: iso(pp.paidDate),
      reference: pp.reference, method: pp.method, hasProof: !!pp.hasProof, paidByName: pp.paidByName,
    });
  }
  return out;
}

const summarize = (list) => ({
  requests: list.length,
  paid: list.filter((r) => r.status === 'paid').length,
  awaitingFinal: list.filter((r) => r.status !== 'paid' && r.currentStep === LAST_STEP).length,
  inApproval: list.filter((r) => r.status !== 'paid' && r.currentStep < LAST_STEP).length,
  totalPaid: round2(list.reduce((s, r) => s + (r.amountPaid || 0), 0)),
  amountAwaiting: round2(list.filter((r) => r.status !== 'paid' && r.currentStep === LAST_STEP).reduce((s, r) => s + r.payrollTotal, 0)),
});

// Every project is a folder, whether or not it has requests yet.
router.get('/folders', requireAuth, requireFinance, async (req, res) => {
  const projects = await rows('SELECT id, name, department, status FROM projects ORDER BY name');
  const all = await ledger(null);
  const folders = projects.map((p) => {
    const mine = all.filter((r) => r.projectId === p.id);
    const lastPaid = mine.map((r) => r.paidDate).filter(Boolean).sort().pop() || null;
    return { id: p.id, name: p.name, department: p.department, status: p.status, lastPaid, ...summarize(mine) };
  });
  res.json({ folders, totals: summarize(all) });
});

router.get('/folders/:projectId', requireAuth, requireFinance, async (req, res) => {
  const project = await row('SELECT id, name, department, status FROM projects WHERE id = $1', [req.params.projectId]);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const list = await ledger(project.id);
  res.json({ project, requests: list, summary: summarize(list) });
});

// Requests that have cleared steps 1-9 and now wait for the final check.
router.get('/queue', requireAuth, requireFinance, async (req, res) => {
  const list = (await ledger(null)).filter((r) => r.status !== 'paid' && r.currentStep === LAST_STEP);
  res.json({ queue: list.sort((a, b) => String(a.weekStart).localeCompare(String(b.weekStart))) });
});

// What Finance checks before paying: who signed each step, the totals, and
// anything in the numbers that looks wrong.
router.get('/period/:id/check', requireAuth, requireFinance, async (req, res) => {
  const period = await row(
    `SELECT pp.*, p.name AS "projectName" FROM payroll_periods pp JOIN projects p ON p.id = pp."projectId" WHERE pp.id = $1`,
    [req.params.id]
  );
  if (!period) return res.status(404).json({ error: 'Payroll request not found' });

  const records = await rows(
    `SELECT r.*, u.name AS "userName" FROM approval_records r JOIN users u ON u.id = r."userId"
     WHERE r."periodId" = $1 ORDER BY r."actionDate", r.id`,
    [period.id]
  );
  let pointer = 1;
  const signed = {};
  for (const r of records) {
    if (r.action === 'completed' && r.step === pointer) { signed[r.step] = r; pointer = r.step + 1; }
    else if (r.action === 'returned' && r.step === pointer) {
      pointer = Math.max(1, r.toStep ?? r.step - 1);
      for (const k of Object.keys(signed)) if (Number(k) >= pointer) delete signed[k];
    }
  }
  const trail = APPROVAL_STEPS.slice(0, LAST_STEP - 1).map((s) => ({
    step: s.step, name: s.name, label: s.label,
    by: signed[s.step]?.userName || null, at: signed[s.step]?.actionDate || null, comment: signed[s.step]?.comment || null,
  }));

  const { calc, total } = await totalFor(period);
  const people = calc.payroll || [];
  const flags = [];
  const noBank = people.filter((w) => !w.bankAccount);
  const noRate = people.filter((w) => !w.dailyRate);
  if (trail.some((t) => !t.by) && period.status !== 'paid') flags.push({ level: 'error', text: 'Not every earlier step is signed.' });
  if (people.length === 0) flags.push({ level: 'error', text: 'No worker attendance is recorded for this week.' });
  if (total <= 0) flags.push({ level: 'error', text: 'The payroll total is zero.' });
  if (noRate.length) flags.push({ level: 'warn', text: `${noRate.length} worker${noRate.length === 1 ? ' has' : 's have'} no daily rate: ${noRate.slice(0, 5).map((w) => w.name).join(', ')}${noRate.length > 5 ? '...' : ''}` });
  if (noBank.length) flags.push({ level: 'warn', text: `${noBank.length} worker${noBank.length === 1 ? ' has' : 's have'} no bank account: ${noBank.slice(0, 5).map((w) => w.name).join(', ')}${noBank.length > 5 ? '...' : ''}` });
  const dup = await row(
    `SELECT pp."requestNo" FROM payroll_periods pp JOIN payroll_payments pay ON pay."periodId" = pp.id
     WHERE pp."projectId" = $1 AND pp.id <> $2 AND pp."weekStart" <= $4 AND pp."weekEnd" >= $3 LIMIT 1`,
    [period.projectId, period.id, iso(period.weekStart), iso(period.weekEnd)]
  );
  if (dup) flags.push({ level: 'error', text: `Another paid request (${dup.requestNo}) already covers part of this week.` });

  res.json({
    period: { id: period.id, requestNo: period.requestNo, projectId: period.projectId, projectName: period.projectName, weekStart: iso(period.weekStart), weekEnd: iso(period.weekEnd), status: period.status, currentStep: period.currentStep },
    trail,
    totals: { workers: calc.totals?.workers || 0, days: calc.totals?.daysPresent || 0, otHours: calc.totals?.otHours || 0, total, byLaborType: calc.totals?.byLaborType || {} },
    flags,
  });
});

export default router;
