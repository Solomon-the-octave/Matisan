import { Router } from 'express';
import { rows, row } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { computePayroll } from './workerAttendance.js';
import { buildXlsx } from '../xlsx.js';
import { audit } from '../audit.js';
import { laborType } from '../laborStructure.js';
import { APPROVAL_STEPS } from '../approvalSteps.js';

// One Excel file with everything about a project, for audits: project
// details, workers, daily attendance, weekly payroll, payments and the full
// approval trail. Same visibility as Reports: admin, finance and Head Office
// see any project; a supervisor sees their own department's projects.
const router = Router();
const SYSTEM_VIEW = { isGlobalAdmin: true, role: 'admin' };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? '' : String(v).slice(0, 10));
const stamp = (v) => (v ? new Date(v).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '');

router.get('/:projectId', requireAuth, async (req, res) => {
  const { from, to } = req.query;
  for (const [k, v] of [['from', from], ['to', to]]) {
    if (v && (!DATE_RE.test(v) || Number.isNaN(Date.parse(v)))) return res.status(400).json({ error: `${k} must be a date like 2026-10-31` });
  }
  if (from && to && from > to) return res.status(400).json({ error: 'The start date is after the end date' });

  const project = await row(
    `SELECT p.*, d.name AS "departmentName", m.name AS "managerName" FROM projects p
     JOIN departments d ON d.id = p.department LEFT JOIN users m ON m.id = p."managerId" WHERE p.id = $1`, [req.params.projectId]);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const ho = await row('SELECT 1 AS x FROM head_office_position_assignments WHERE "userId" = $1', [req.user.id]);
  const company = req.user.isGlobalAdmin || req.user.role === 'finance' || !!ho;
  if (req.user.role === 'employee' && !ho) return res.status(403).json({ error: 'Exports are for supervisors, finance and head office' });
  if (!company && project.department !== req.user.department) return res.status(403).json({ error: 'Outside your department access point' });

  const inRange = (d) => (!from || d >= from) && (!to || d <= to);

  const workers = await rows('SELECT * FROM workers WHERE "projectId" = $1 ORDER BY name', [project.id]);
  const att = (await rows(
    `SELECT a.*, w.name AS "workerName", u.name AS "recordedBy" FROM worker_attendance a
     JOIN workers w ON w.id = a."workerId" LEFT JOIN users u ON u.id = a."registeredBy"
     WHERE a."projectId" = $1 ORDER BY a.date, w.name`, [project.id])).filter((r) => inRange(r.date));
  const periods = (await rows('SELECT pp.* FROM payroll_periods pp WHERE pp."projectId" = $1 ORDER BY pp."weekStart"', [project.id]))
    .filter((p) => inRange(iso(p.weekStart)) || inRange(iso(p.weekEnd)));

  const payrollRows = [['Request no.', 'Week start', 'Week end', 'Worker', 'Trade', 'Labor type', 'Daily rate', 'Days present', 'OT hours', 'Base pay', 'OT pay', 'Total']];
  const paymentRows = [['Request no.', 'Week start', 'Week end', 'Stage', 'Calculated total', 'Amount paid', 'Paid on', 'Method', 'Reference', 'Paid by', 'Proof attached']];
  const trailRows = [['Request no.', 'Week start', 'Week end', 'Step', 'Step name', 'Position', 'Result', 'Person', 'Acting position', 'Date and time', 'Note', 'Workers', 'Days present', 'OT hours', 'Total at that time']];
  let calcTotal = 0;
  let paidTotal = 0;
  for (const pp of periods) {
    const calc = await computePayroll(SYSTEM_VIEW, { projectId: project.id, from: iso(pp.weekStart), to: iso(pp.weekEnd) });
    for (const w of calc.payroll) {
      payrollRows.push([pp.requestNo, iso(pp.weekStart), iso(pp.weekEnd), w.name, w.trade, w.laborType, w.dailyRate, w.daysPresent, w.otHours, w.basePay, w.otPay, w.total]);
    }
    const total = calc.totals?.cost || 0;
    calcTotal += total;
    const pay = await row('SELECT pm.*, u.name AS "paidByName" FROM payroll_payments pm JOIN users u ON u.id = pm."paidBy" WHERE pm."periodId" = $1', [pp.id]);
    if (pay) paidTotal += Number(pay.amountPaid);
    paymentRows.push([pp.requestNo, iso(pp.weekStart), iso(pp.weekEnd), pp.status === 'paid' ? 'Paid' : `Step ${pp.currentStep} of 10`, total,
      pay ? Number(pay.amountPaid) : '', pay ? iso(pay.paidDate) : '', pay?.method || '', pay?.reference || '', pay?.paidByName || '', pay ? (pay.proofName ? 'Yes' : 'No') : '']);
    const recs = await rows(
      `SELECT r.*, u.name AS "userName" FROM approval_records r JOIN users u ON u.id = r."userId" WHERE r."periodId" = $1 ORDER BY r."actionDate", r.id`, [pp.id]);
    const posNames = Object.fromEntries((await rows('SELECT id, name FROM positions')).map((p) => [p.id, p.name]));
    for (const r of recs) {
      const def = APPROVAL_STEPS[r.step - 1];
      trailRows.push([pp.requestNo, iso(pp.weekStart), iso(pp.weekEnd), r.step, def?.label || '', posNames[r.positionId] || '',
        r.action === 'completed' ? 'Done' : `Returned to step ${r.toStep || r.step - 1}`, r.userName, r.actorPosition || '', stamp(r.actionDate), r.comment || '',
        r.snapshot?.workers ?? '', r.snapshot?.daysPresent ?? '', r.snapshot?.otHours ?? '', r.snapshot?.cost ?? '']);
    }
  }

  const summary = [
    ['Item', 'Value'],
    ['Project', project.name], ['Project number', project.projectNumber || ''], ['Department', project.departmentName], ['Site', project.site || ''],
    ['Client', project.client || ''], ['Contractor', project.contractor || ''], ['Consultant', project.consultant || ''],
    ['Project manager', project.managerName || ''], ['Status', project.status], ['Start date', project.startDate || ''], ['End date', project.endDate || ''],
    ['Period covered', from || to ? `${from || 'start'} to ${to || 'today'}` : 'All records'],
    ['Registered workers', workers.length], ['Attendance entries', att.length], ['Payroll weeks', periods.length],
    ['Calculated payroll total (ETB)', Math.round(calcTotal * 100) / 100], ['Total paid (ETB)', Math.round(paidTotal * 100) / 100],
    ['Exported by', (await row('SELECT name FROM users WHERE id = $1', [req.user.id]))?.name || ''], ['Exported at', stamp(new Date())],
  ];
  const workerRows = [['Name', 'Trade', 'Labor type', 'Daily rate', 'Phone', 'Bank account', 'Registered on']];
  for (const w of workers) workerRows.push([w.name, w.trade || '', laborType(w.trade), w.dailyRate, w.phone || '', w.bankAccount || '', iso(w.createdAt)]);
  const attRows = [['Date', 'Worker', 'Morning', 'Afternoon', 'Late hours', 'OT hours', 'Recorded by', 'Recorded at']];
  for (const r of att) attRows.push([r.date, r.workerName, r.am ? 'Present' : 'Absent', r.pm ? 'Present' : 'Absent', Number(r.lateHours) || 0, r.otHours || 0, r.recordedBy || '', stamp(r.registeredAt)]);

  const file = buildXlsx([
    { name: 'Summary', rows: summary }, { name: 'Workers', rows: workerRows }, { name: 'Attendance', rows: attRows },
    { name: 'Weekly payroll', rows: payrollRows }, { name: 'Payments', rows: paymentRows }, { name: 'Approval trail', rows: trailRows },
  ]);
  await audit(req.user, 'project.export', 'project', project.id, `Downloaded the full audit export for ${project.name}`);
  const filename = `${project.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'project'}-audit-export.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(file);
});

export default router;
