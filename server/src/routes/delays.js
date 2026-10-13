import { Router } from 'express';
import { rows, row, query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { notify, stepHolderIds } from '../notify.js';
import { APPROVAL_STEPS, LAST_STEP } from '../approvalSteps.js';

// Requests that have waited too long at one step. The Delayed list is for the
// administrator and the Deputy GM (and GM); the people holding the stuck step
// get a reminder notification, repeated every DELAY_DAYS while it stays stuck.
const router = Router();
export const DELAY_DAYS = Number(process.env.APPROVAL_DELAY_DAYS) || 2;

export async function delayedRequests(days = DELAY_DAYS) {
  const periods = await rows(
    `SELECT pp.id, pp."requestNo", pp."projectId", pp."weekStart", pp."weekEnd", pp."currentStep", p.name AS "projectName",
            COALESCE((SELECT max(r."actionDate") FROM approval_records r WHERE r."periodId" = pp.id), pp."submittedAt", now()) AS "waitingSince"
     FROM payroll_periods pp JOIN projects p ON p.id = pp."projectId"
     WHERE pp."currentStep" <= $1 AND pp.status <> 'paid'`,
    [LAST_STEP]
  );
  const out = [];
  for (const pp of periods) {
    const waitedMs = Date.now() - new Date(pp.waitingSince).getTime();
    const daysWaiting = Math.floor(waitedMs / 86400000);
    if (waitedMs < days * 86400000) continue;
    const def = APPROVAL_STEPS[pp.currentStep - 1];
    const ids = await stepHolderIds(pp, def);
    const holders = ids.length ? (await rows('SELECT name FROM users WHERE id = ANY($1)', [ids])).map((u) => u.name) : [];
    out.push({
      periodId: pp.id, requestNo: pp.requestNo, projectName: pp.projectName, weekStart: pp.weekStart, weekEnd: pp.weekEnd,
      step: pp.currentStep, stepName: def?.name, label: def?.label, waitingSince: pp.waitingSince, daysWaiting, holders,
      unassigned: holders.length === 0,
    });
  }
  return out.sort((a, b) => b.daysWaiting - a.daysWaiting);
}

export async function sendDelayReminders() {
  const delayed = await delayedRequests();
  let sent = 0;
  for (const d of delayed) {
    const last = await row('SELECT "remindedAt" FROM approval_reminders WHERE "periodId" = $1 AND step = $2', [d.periodId, d.step]);
    if (last && Date.now() - new Date(last.remindedAt).getTime() < DELAY_DAYS * 86400000) continue;
    const def = APPROVAL_STEPS[d.step - 1];
    const ids = await stepHolderIds({ projectId: (await row('SELECT "projectId" FROM payroll_periods WHERE id = $1', [d.periodId])).projectId }, def);
    if (ids.length) {
      await notify(ids, {
        type: 'delay', title: `Waiting ${d.daysWaiting} days: ${d.projectName}`,
        body: `${d.requestNo ? d.requestNo + ': ' : ''}Week ${String(d.weekStart).slice(0, 10)} is still waiting for your ${def.action.toLowerCase()} (${def.name}).`,
        link: `/approvals?period=${d.periodId}`,
      });
      sent += 1;
    }
    await query(
      `INSERT INTO approval_reminders ("periodId", step, "remindedAt") VALUES ($1,$2,now())
       ON CONFLICT ("periodId", step) DO UPDATE SET "remindedAt" = now()`,
      [d.periodId, d.step]
    );
  }
  return { delayed: delayed.length, reminded: sent };
}

async function canSeeDelayed(user) {
  if (user.isGlobalAdmin) return true;
  return !!(await row(`SELECT 1 AS x FROM head_office_position_assignments WHERE "userId" = $1 AND "positionId" IN ('ho-dgm','ho-gm')`, [user.id]));
}

router.get('/', requireAuth, async (req, res) => {
  if (!(await canSeeDelayed(req.user))) return res.json({ visible: false });
  res.json({ visible: true, days: DELAY_DAYS, items: await delayedRequests() });
});

// Run the reminder sweep now (it also runs by itself every hour).
router.post('/remind', requireAuth, async (req, res) => {
  if (!req.user.isGlobalAdmin) return res.status(403).json({ error: 'Admins only' });
  res.json(await sendDelayReminders());
});

export default router;
