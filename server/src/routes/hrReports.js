import { Router } from 'express';
import { rows, row } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { computePayroll } from './workerAttendance.js';

// HR / payroll reports with filters, as JSON for the screen or CSV to download.
// Who sees what: admin, finance and Head Office seat holders see the whole
// company; supervisors see their own department; employees get none.
const router = Router();

const dayValue = (r) => Math.max(0, (r.am ? 0.5 : 0) + (r.pm ? 0.5 : 0) - (Number(r.lateHours) || 0) / 8);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? '' : String(v).slice(0, 10));
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop spreadsheet formula injection
  return `"${s.replace(/"/g, '""')}"`;
}

const TYPES = {
  employees: 'Employees',
  attendance: 'Staff attendance (clock in/out)',
  workers: 'Field workers',
  'field-attendance': 'Field attendance',
  payroll: 'Payroll by worker',
  payments: 'Payment requests and history',
  workforce: 'Project workforce',
};

async function scopeOf(user) {
  const ho = await row('SELECT 1 AS x FROM head_office_position_assignments WHERE "userId" = $1', [user.id]);
  const company = user.isGlobalAdmin || user.role === 'finance' || !!ho;
  return { company, department: company ? null : user.department };
}

router.get('/types', requireAuth, (req, res) => res.json({ types: TYPES }));

router.get('/', requireAuth, async (req, res) => {
  if (req.user.role === 'employee' && !(await row('SELECT 1 AS x FROM head_office_position_assignments WHERE "userId" = $1', [req.user.id]))) {
    return res.status(403).json({ error: 'Reports are for supervisors, finance and head office' });
  }
  const { type, projectId, from, to, status, department, workerId, userId, format } = req.query;
  if (!TYPES[type]) return res.status(400).json({ error: `type must be one of: ${Object.keys(TYPES).join(', ')}` });
  for (const [k, v] of [['from', from], ['to', to]]) {
    if (v && (!DATE_RE.test(v) || Number.isNaN(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v)) return res.status(400).json({ error: `${k} must be a date like 2026-10-31` });
  }
  if (from && to && from > to) return res.status(400).json({ error: 'The start date is after the end date' });

  const scope = await scopeOf(req.user);
  // A non-company viewer is pinned to their department; others may filter.
  const dept = scope.company ? department || null : scope.department;
  if (projectId) {
    const p = await row('SELECT department FROM projects WHERE id = $1', [projectId]);
    if (!p) return res.status(404).json({ error: 'Project not found' });
    if (!scope.company && p.department !== scope.department) return res.status(403).json({ error: 'Outside your department access point' });
  }

  const add = (clauses, args, sql, val) => { args.push(val); clauses.push(sql.replace('?', `$${args.length}`)); };
  let columns = [];
  let data = [];

  if (type === 'employees') {
    const c = [], a = [];
    if (dept) add(c, a, 'u.department = ?', dept);
    if (userId) add(c, a, 'u.id = ?', userId);
    if (status) add(c, a, 'u.role = ?', status); // "status" doubles as role filter here
    if (projectId) add(c, a, 'u.id IN (SELECT "userId" FROM project_assignments WHERE "projectId" = ?)', projectId);
    const list = await rows(
      `SELECT u.name, u.email, u.role, u.title, u.phone, d.name AS department,
         COALESCE((SELECT string_agg(p.name, '; ' ORDER BY p.name) FROM project_assignments pa JOIN projects p ON p.id = pa."projectId" WHERE pa."userId" = u.id), '') AS projects,
         COALESCE((SELECT string_agg(pos.name, '; ') FROM (
            SELECT po.name FROM project_position_assignments a JOIN positions po ON po.id = a."positionId" WHERE a."userId" = u.id
            UNION ALL SELECT po.name FROM head_office_position_assignments a JOIN positions po ON po.id = a."positionId" WHERE a."userId" = u.id) pos), '') AS positions
       FROM users u JOIN departments d ON d.id = u.department
       ${c.length ? 'WHERE ' + c.join(' AND ') : ''} ORDER BY u.name`, a);
    columns = [['name', 'Name'], ['email', 'Email'], ['role', 'System role'], ['title', 'Title'], ['department', 'Department'], ['positions', 'Positions'], ['projects', 'Projects'], ['phone', 'Phone']];
    data = list;
  } else if (type === 'attendance') {
    const c = [], a = [];
    if (dept) add(c, a, 'a.department = ?', dept);
    if (userId) add(c, a, 'a."userId" = ?', userId);
    if (from) add(c, a, 'a.date >= ?', from);
    if (to) add(c, a, 'a.date <= ?', to);
    if (status) add(c, a, 'a.status = ?', status);
    const list = await rows(
      `SELECT a.date, u.name, d.name AS department, a."checkIn", a."checkOut", a.hours, a.status
       FROM attendance a JOIN users u ON u.id = a."userId" JOIN departments d ON d.id = a.department
       ${c.length ? 'WHERE ' + c.join(' AND ') : ''} ORDER BY a.date DESC, u.name LIMIT 5000`, a);
    columns = [['date', 'Date'], ['name', 'Employee'], ['department', 'Department'], ['checkIn', 'Check in'], ['checkOut', 'Check out'], ['hours', 'Hours'], ['status', 'Status']];
    data = list.map((r) => ({ ...r, checkIn: r.checkIn ? new Date(r.checkIn).toISOString() : '', checkOut: r.checkOut ? new Date(r.checkOut).toISOString() : '', hours: round2(r.hours) }));
  } else if (type === 'workers') {
    const c = [], a = [];
    if (dept) add(c, a, 'w.department = ?', dept);
    if (projectId) add(c, a, 'w."projectId" = ?', projectId);
    if (workerId) add(c, a, 'w.id = ?', workerId);
    const list = await rows(
      `SELECT w.id, w.name, w.trade, w.phone, w."dailyRate", p.name AS project, d.name AS department
       FROM workers w LEFT JOIN projects p ON p.id = w."projectId" JOIN departments d ON d.id = w.department
       ${c.length ? 'WHERE ' + c.join(' AND ') : ''} ORDER BY w.name`, a);
    columns = [['id', 'Worker ID'], ['name', 'Name'], ['trade', 'Trade'], ['project', 'Project'], ['department', 'Department'], ['dailyRate', 'Daily rate'], ['phone', 'Phone']];
    data = list;
  } else if (type === 'field-attendance') {
    const c = [], a = [];
    if (dept) add(c, a, 'wa.department = ?', dept);
    if (projectId) add(c, a, 'wa."projectId" = ?', projectId);
    if (workerId) add(c, a, 'wa."workerId" = ?', workerId);
    if (from) add(c, a, 'wa.date >= ?', from);
    if (to) add(c, a, 'wa.date <= ?', to);
    const list = await rows(
      `SELECT wa.date, w.name AS worker, w.trade, p.name AS project, wa.am, wa.pm, wa."otHours", wa."lateHours", wa."activityNote"
       FROM worker_attendance wa JOIN workers w ON w.id = wa."workerId" LEFT JOIN projects p ON p.id = wa."projectId"
       ${c.length ? 'WHERE ' + c.join(' AND ') : ''} ORDER BY wa.date DESC, w.name LIMIT 5000`, a);
    columns = [['date', 'Date'], ['worker', 'Worker'], ['trade', 'Trade'], ['project', 'Project'], ['morning', 'Morning'], ['afternoon', 'Afternoon'], ['otHours', 'OT hours'], ['lateHours', 'Hours missed'], ['dayValue', 'Day value'], ['activityNote', 'Note']];
    data = list.map((r) => ({ ...r, morning: r.am ? 'Present' : 'Absent', afternoon: r.pm ? 'Present' : 'Absent', dayValue: round2(dayValue(r)) }));
  } else if (type === 'payroll') {
    const p = await computePayroll(dept ? { isGlobalAdmin: false, role: 'supervisor', department: dept } : { isGlobalAdmin: true, role: 'admin' }, { projectId, from, to });
    let list = p.payroll;
    if (workerId) list = list.filter((w) => w.workerId === workerId);
    columns = [['workerId', 'Worker ID'], ['name', 'Name'], ['trade', 'Trade'], ['laborType', 'Labor type'], ['dailyRate', 'Daily rate'], ['daysPresent', 'Days'], ['otHours', 'OT hours'], ['basePay', 'Base pay'], ['otPay', 'OT pay'], ['total', 'Total'], ['bankAccount', 'Bank account']];
    data = list;
  } else if (type === 'payments') {
    const c = [], a = [];
    if (dept) add(c, a, 'pp.department = ?', dept);
    if (projectId) add(c, a, 'pp."projectId" = ?', projectId);
    if (from) add(c, a, 'pp."weekStart" >= ?', from);
    if (to) add(c, a, 'pp."weekEnd" <= ?', to);
    if (status === 'paid') c.push("pp.status = 'paid'");
    else if (status === 'awaiting_payment') c.push("pp.status = 'in_review' AND pp.\"currentStep\" = 10");
    else if (status === 'in_progress') c.push("pp.status <> 'paid'");
    const list = await rows(
      `SELECT pp.id, pp."requestNo", p.name AS project, pp."weekStart", pp."weekEnd", pp.status, pp."currentStep", pp."projectId",
              pm."amountPaid", pm."paidDate", pm.reference, pm.method, u.name AS "paidBy"
       FROM payroll_periods pp JOIN projects p ON p.id = pp."projectId"
       LEFT JOIN payroll_payments pm ON pm."periodId" = pp.id LEFT JOIN users u ON u.id = pm."paidBy"
       ${c.length ? 'WHERE ' + c.join(' AND ') : ''} ORDER BY pp."weekStart" DESC, pp."requestNo" DESC LIMIT 1000`, a);
    columns = [['requestNo', 'Request no.'], ['project', 'Project'], ['week', 'Week'], ['stage', 'Stage'], ['calculated', 'Calculated total'], ['amountPaid', 'Amount paid'], ['paidDate', 'Paid on'], ['method', 'Method'], ['reference', 'Reference'], ['paidBy', 'Paid by']];
    data = [];
    for (const r of list) {
      const c2 = await computePayroll({ isGlobalAdmin: true, role: 'admin' }, { projectId: r.projectId, from: iso(r.weekStart), to: iso(r.weekEnd) });
      data.push({
        requestNo: r.requestNo, project: r.project, week: `${iso(r.weekStart)} to ${iso(r.weekEnd)}`,
        stage: r.status === 'paid' ? 'Paid' : r.currentStep <= 3 ? `Site checks (step ${r.currentStep} of 10)` : `Step ${r.currentStep} of 10`,
        calculated: c2.totals?.cost || 0, amountPaid: r.amountPaid == null ? '' : Number(r.amountPaid), paidDate: iso(r.paidDate), method: r.method || '', reference: r.reference || '', paidBy: r.paidBy || '',
      });
    }
  } else if (type === 'workforce') {
    const c = [], a = [];
    if (dept) add(c, a, 'p.department = ?', dept);
    if (projectId) add(c, a, 'p.id = ?', projectId);
    const projects = await rows(`SELECT p.id, p.name FROM projects p ${c.length ? 'WHERE ' + c.join(' AND ') : ''} ORDER BY p.name`, a);
    columns = [['project', 'Project'], ['registered', 'Workers registered'], ['workedWorkers', 'Workers who worked'], ['days', 'Total days'], ['otHours', 'OT hours'], ['cost', 'Payroll cost']];
    data = [];
    for (const p of projects) {
      const registered = (await row('SELECT count(*)::int AS n FROM workers WHERE "projectId" = $1', [p.id])).n;
      const c2 = await computePayroll({ isGlobalAdmin: true, role: 'admin' }, { projectId: p.id, from, to });
      data.push({ project: p.name, registered, workedWorkers: c2.totals?.workers || 0, days: round2(c2.totals?.daysPresent), otHours: round2(c2.totals?.otHours), cost: round2(c2.totals?.cost) });
    }
  }

  if (format === 'csv') {
    const lines = [columns.map(([, h]) => csvCell(h)).join(',')];
    for (const r of data) lines.push(columns.map(([k]) => csvCell(r[k])).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="matisan-${type}-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send('﻿' + lines.join('\r\n'));
  }
  res.json({ type, title: TYPES[type], columns: columns.map(([key, label]) => ({ key, label })), rows: data, count: data.length });
});

export default router;
