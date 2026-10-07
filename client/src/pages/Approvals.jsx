import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronDown, ChevronUp } from 'lucide-react'
import Layout from '../components/Layout'
import Badge from '../components/Badge'
import ApprovalTrail from '../components/ApprovalTrail'
import api from '../api'

const fmt = (d) => new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

// One place for the payment-approval path: what needs *you*, and every
// request you are allowed to see, each with its 10-step timeline.
export default function Approvals() {
  const [params] = useSearchParams()
  const [waiting, setWaiting] = useState(null)
  const [periods, setPeriods] = useState([])
  const [steps, setSteps] = useState([])
  const [open, setOpen] = useState(params.get('period'))
  const [filter, setFilter] = useState('all')

  async function load() {
    const [w, p] = await Promise.all([api.get('/approvals/waiting'), api.get('/payroll-periods')])
    setWaiting(w.data.items)
    setPeriods([...p.data.periods].sort((a, b) => String(b.weekStart).localeCompare(String(a.weekStart))))
    setSteps(p.data.steps || [])
  }

  useEffect(() => {
    load().catch(() => setWaiting([]))
  }, [])

  const waitingIds = new Set((waiting || []).filter((w) => !w.handIn).map((w) => w.periodId))
  const shown = periods.filter((p) => filter === 'all' || (filter === 'mine' && waitingIds.has(p.id)) || (filter === 'paid' && p.status === 'paid') || (filter === 'open' && p.status !== 'paid'))
  const awaiting = (p) => {
    if (p.status === 'paid') return 'Paid'
    const def = steps[p.currentStep - 1]
    return def ? `Awaiting ${def.name}` : ''
  }

  return (
    <Layout title="Approvals" subtitle="Weekly payment requests and where each one stands">
      {waiting && waiting.length === 0 && (
        <div className="mb-6 surface p-4 text-sm text-slate-500 dark:text-slate-400">No approvals currently require your attention.</div>
      )}
      {waiting && waiting.length > 0 && (
        <div className="mb-6 surface border-brand-200 dark:border-brand-500/30 p-4">
          <h3 className="mb-2 text-sm font-bold text-slate-700 dark:text-slate-200">Waiting for your action ({waiting.length})</h3>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {waiting.map((w) => (
              <li key={w.periodId} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{w.projectName}</div>
                  <div className="text-xs text-slate-400">Week {fmt(w.weekStart)} – {fmt(w.weekEnd)} · {w.handIn ? 'Sent back to the field' : `${w.label} (${w.positionName})`}</div>
                </div>
                {!w.handIn && <button onClick={() => setOpen(w.periodId)} className="shrink-0 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700">Review</button>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">Requests</h3>
        <div className="flex flex-wrap gap-1.5">
          {[['all', 'All'], ['mine', 'Waiting for me'], ['open', 'In progress'], ['paid', 'Paid']].map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} className={`min-h-[36px] rounded-full px-3 text-xs font-semibold ${filter === k ? 'bg-brand-600 text-white' : 'border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>{l}</button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        {shown.map((p) => (
          <div key={p.id} className="surface p-4">
            <button onClick={() => setOpen(open === p.id ? null : p.id)} className="flex w-full items-center justify-between gap-3 text-left">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {p.requestNo && <span className="text-xs font-bold text-brand-600 dark:text-brand-300">{p.requestNo}</span>}
                  <span className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{p.projectName}</span>
                </div>
                <div className="text-xs text-slate-400">
                  Week {fmt(p.weekStart)} – {fmt(p.weekEnd)}
                  {p.payrollTotal !== undefined && ` · ${p.payrollTotal.toLocaleString()} ETB`} · {awaiting(p)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge value={p.status} />
                {open === p.id ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
              </div>
            </button>
            {open === p.id && (
              <div className="mt-3 border-t border-slate-100 dark:border-slate-800 pt-3">
                <ApprovalTrail periodId={p.id} onChange={load} />
              </div>
            )}
          </div>
        ))}
        {shown.length === 0 && <p className="surface p-6 text-center text-sm text-slate-400">{periods.length === 0 ? 'No payment requests yet. They appear once a site hands in its weekly attendance.' : 'Nothing matches this filter.'}</p>}
      </div>
    </Layout>
  )
}
