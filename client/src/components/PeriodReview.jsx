import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, AlertTriangle, Info, Loader2 } from 'lucide-react'
import ScrollHint from './ScrollHint'
import api from '../api'

// What a reviewer needs in front of them before approving a week: the
// project, the payroll line by line, the attendance behind it, the field
// team's hand-in notes and anything worth a second look.
const money = (n) => (n == null ? '-' : Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const num = (n) => (Number.isInteger(n) ? n : Number(n).toFixed(2).replace(/\.?0+$/, ''))
const short = (d) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })
const when = (d) => new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function Stat({ label, value, sub }) {
  return (
    <div className="rounded-lg bg-slate-50 dark:bg-slate-800 px-3 py-2">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="text-sm font-bold text-slate-800 dark:text-slate-100">{value}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  )
}

function cell(r) {
  if (!r) return { text: '·', cls: 'text-slate-300 dark:text-slate-600' }
  const part = r.am && r.pm ? '✓' : r.am ? 'AM' : r.pm ? 'PM' : 'Absent'
  const extra = `${r.ot ? ` +${num(r.ot)}` : ''}${r.late ? ` -${num(r.late)}h` : ''}`
  const cls = part === 'Absent' ? 'text-rose-500' : part === '✓' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
  return { text: part + extra, cls }
}

export default function PeriodReview({ periodId, defaultOpen = false, refreshKey = 0 }) {
  const [open, setOpen] = useState(defaultOpen)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('payroll')

  useEffect(() => {
    if (!open) return
    api.get(`/approvals/period/${periodId}/review`).then((r) => { setData(r.data); setError('') }).catch((e) => setError(e.response?.data?.error || 'Could not load the review details'))
  }, [open, periodId, refreshKey])

  const warns = data?.flags.filter((f) => f.level === 'warn') || []
  return (
    <div className="mb-3 rounded-lg border border-slate-200 dark:border-slate-700">
      <button type="button" onClick={() => setOpen((v) => !v)} className="no-print flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-bold text-slate-600 dark:text-slate-300">
        <span>Review details: payroll, attendance and notes{data && warns.length > 0 ? ` (${warns.length} to check)` : ''}</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && (
        <div className="space-y-3 border-t border-slate-100 dark:border-slate-800 p-3">
          {error && <p className="text-xs text-rose-600">{error}</p>}
          {!data && !error && <p className="flex items-center gap-1.5 text-xs text-slate-400"><Loader2 size={12} className="animate-spin" /> Loading...</p>}
          {data && (
            <>
              <div className="text-xs text-slate-500">
                <b className="text-slate-700 dark:text-slate-200">{data.project?.name}</b>
                {data.project?.projectNumber ? ` · ${data.project.projectNumber}` : ''}
                {data.project?.client ? ` · Client: ${data.project.client}` : ''}
                {data.project?.site ? ` · Site: ${data.project.site}` : ''}
                {data.project?.managerName ? ` · Manager: ${data.project.managerName}` : ''}
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Workers paid" value={data.totals.workers} sub={`Skilled ${data.totals.byLaborType?.Skilled?.workers ?? 0}, Non-Skilled ${data.totals.byLaborType?.['Non-Skilled']?.workers ?? 0}`} />
                <Stat label="Days present" value={num(data.totals.daysPresent)} />
                <Stat label="OT hours" value={num(data.totals.otHours)} />
                <Stat label="Payroll total" value={`${money(data.totals.cost)} ETB`} sub={`Skilled ${money(data.totals.byLaborType?.Skilled?.cost || 0)}, Non-Skilled ${money(data.totals.byLaborType?.['Non-Skilled']?.cost || 0)}`} />
              </div>

              {data.lastReturn && (
                <div className="rounded-md bg-rose-50 dark:bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-700 dark:text-rose-300">
                  Last returned by {data.lastReturn.by} on {when(data.lastReturn.at)}: {data.lastReturn.note}
                </div>
              )}

              {data.flags.length > 0 ? (
                <ul className="space-y-1">
                  {data.flags.map((f, i) => (
                    <li key={i} className={`flex items-start gap-1.5 text-xs ${f.level === 'warn' ? 'text-amber-700 dark:text-amber-300' : 'text-slate-500 dark:text-slate-400'}`}>
                      {f.level === 'warn' ? <AlertTriangle size={13} className="mt-0.5 shrink-0" /> : <Info size={13} className="mt-0.5 shrink-0" />}
                      {f.text}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-emerald-600 dark:text-emerald-400">Nothing unusual found in this week.</p>
              )}

              <div className="flex gap-1.5">
                {[['payroll', 'Payroll'], ['attendance', 'Attendance'], ['handin', 'Hand-in notes']].map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setTab(k)} className={`min-h-[34px] rounded-full px-3 text-xs font-semibold ${tab === k ? 'bg-brand-600 text-white' : 'border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-300'}`}>{l}</button>
                ))}
              </div>

              {tab === 'payroll' && (
                <><ScrollHint />
<div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-400">
                        {['Worker', 'Trade', 'Rate', 'Days', 'OT hrs', 'Hrs missed', 'Base pay', 'OT pay', 'Total'].map((h, i) => <th key={h} className={`py-1.5 pr-2 font-medium ${i >= 2 ? 'text-right' : ''}`}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {data.payroll.map((w) => (
                        <tr key={w.workerId} className="border-b border-slate-100 dark:border-slate-800">
                          <td className="py-1.5 pr-2 font-semibold text-slate-700 dark:text-slate-200">{w.name}<div className="text-[10px] font-normal text-slate-400">{w.workerId}</div></td>
                          <td className="pr-2 text-slate-500">{w.trade || '-'}<div className="text-[10px] text-slate-400">{w.laborType}</div></td>
                          <td className="pr-2 text-right">{w.dailyRate ? money(w.dailyRate) : <span className="text-amber-600">none</span>}</td>
                          <td className="pr-2 text-right">{num(w.daysPresent)}</td>
                          <td className="pr-2 text-right">{num(w.otHours)}</td>
                          <td className="pr-2 text-right">{w.hoursMissed ? num(w.hoursMissed) : '-'}</td>
                          <td className="pr-2 text-right">{money(w.basePay)}</td>
                          <td className="pr-2 text-right">{money(w.otPay)}</td>
                          <td className="py-1.5 text-right font-bold text-slate-800 dark:text-slate-100">{money(w.total)}</td>
                        </tr>
                      ))}
                      <tr className="font-bold text-slate-800 dark:text-slate-100">
                        <td className="py-1.5 pr-2" colSpan={3}>Total</td>
                        <td className="pr-2 text-right">{num(data.totals.daysPresent)}</td>
                        <td className="pr-2 text-right">{num(data.totals.otHours)}</td>
                        <td colSpan={3} />
                        <td className="text-right">{money(data.totals.cost)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div></>
              )}

              {tab === 'attendance' && (
                <>
                  <><ScrollHint />
<div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-400">
                          <th className="py-1.5 pr-2 font-medium">Worker</th>
                          {data.days.map((d) => <th key={d} className="px-1 text-center font-medium">{short(d)}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {data.payroll.map((w) => (
                          <tr key={w.workerId} className="border-b border-slate-100 dark:border-slate-800">
                            <td className="py-1.5 pr-2 font-semibold text-slate-700 dark:text-slate-200">{w.name}</td>
                            {data.days.map((d) => {
                              const c = cell(data.grid[w.workerId]?.[d])
                              return <td key={d} className={`px-1 text-center ${c.cls}`}>{c.text}</td>
                            })}
                          </tr>
                        ))}
                        <tr className="font-semibold text-slate-600 dark:text-slate-300">
                          <td className="py-1.5 pr-2">Present that day</td>
                          {data.dayTotals.map((t) => <td key={t.date} className="px-1 text-center">{t.present}</td>)}
                        </tr>
                      </tbody>
                    </table>
                  </div></>
                  <p className="text-[11px] text-slate-400">✓ full day, AM or PM half day, +n OT hours, -nh hours missed, · nothing recorded.</p>
                </>
              )}

              {tab === 'handin' && (
                data.handIn.length === 0 ? <p className="text-xs text-slate-400">No hand-in notes for this week.</p> : (
                  <ul className="space-y-2">
                    {data.handIn.map((h, i) => (
                      <li key={i} className="rounded-md bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs">
                        <div className="font-semibold text-slate-700 dark:text-slate-200">{h.type === 'weekly' ? 'Week' : `Day ${h.periodStart}`} handed in by {h.submittedByName}, {when(h.submittedAt)}</div>
                        <div className="text-slate-500">{h.employeeNote ? `Note: ${h.employeeNote}` : 'No note.'}</div>
                        {h.reviewedByName && <div className="text-slate-500">{h.status === 'returned' ? 'Returned' : 'Reviewed'} by {h.reviewedByName}{h.reviewNote ? `: ${h.reviewNote}` : ''}</div>}
                      </li>
                    ))}
                  </ul>
                )
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
