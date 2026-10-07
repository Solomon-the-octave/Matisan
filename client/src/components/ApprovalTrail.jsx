import { useEffect, useState } from 'react'
import { CheckCircle2, Circle, CornerUpLeft, Loader2 } from 'lucide-react'
import api from '../api'

// The paper "critical path" for one week of payroll: Prepared, Checked,
// Re-Checked ... Paid. One line per step, who sits in that position, and
// where it stands (Completed / Pending / Returned). The person whose turn it
// is gets two buttons only: Approve, or Return with a reason.
const STYLE = {
  completed: { icon: CheckCircle2, color: 'text-emerald-500', label: 'Completed' },
  pending: { icon: Circle, color: 'text-slate-300 dark:text-slate-600', label: 'Pending' },
  returned: { icon: CornerUpLeft, color: 'text-rose-500', label: 'Returned' },
}

const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

export default function ApprovalTrail({ periodId, onChange }) {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [returning, setReturning] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [showHistory, setShowHistory] = useState(false)

  async function load() {
    const res = await api.get(`/approvals/period/${periodId}`)
    setData(res.data)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodId])

  async function act(kind) {
    setBusy(true)
    setError('')
    try {
      const res = await api.post(`/approvals/period/${periodId}/${kind}`, kind === 'return' ? { comment: reason } : {})
      setData(res.data)
      setReturning(false)
      setReason('')
      onChange?.()
    } catch (e) {
      setError(e.response?.data?.error || 'Could not save that action')
    } finally {
      setBusy(false)
    }
  }

  if (!data) return <p className="py-3 text-xs text-slate-400">Loading...</p>
  const { steps, canAct, canReturn, history } = data
  const current = steps.find((s) => s.current)

  return (
    <div>
      <ol className="space-y-0">
        {steps.map((s, i) => {
          const st = STYLE[s.status]
          const Icon = st.icon
          return (
            <li key={s.step} className="flex gap-3">
              <div className="flex flex-col items-center">
                <Icon size={18} className={`shrink-0 ${st.color}`} />
                {i < steps.length - 1 && <div className="my-0.5 w-px flex-1 bg-slate-200 dark:bg-slate-700" />}
              </div>
              <div className={`min-w-0 flex-1 pb-3 ${s.current ? '' : ''}`}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className={`text-sm font-semibold ${s.current ? 'text-brand-700 dark:text-brand-300' : 'text-slate-700 dark:text-slate-200'}`}>{s.label}</span>
                  <span className="text-xs text-slate-400">{s.positionName}{s.assignee ? ` · ${s.assignee.name}` : ' · not assigned'}</span>
                </div>
                <div className="text-[11px] text-slate-400">
                  {st.label}
                  {s.current && s.status !== 'returned' && ' · current'}
                  {s.actedBy && ` · ${s.actedBy}, ${fmtDate(s.actedAt)}`}
                </div>
                {s.status === 'returned' && (
                  <div className="mt-1 rounded-md bg-rose-50 dark:bg-rose-500/10 px-2 py-1 text-xs text-rose-700 dark:text-rose-300">
                    Returned by {s.returnedBy}: {s.comment}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      {canAct && current && current.step >= 2 && (
        <div className="mt-1 rounded-lg bg-slate-50 dark:bg-slate-800 p-3">
          {!returning ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => act('complete')}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Approve — {current.label}
              </button>
              {canReturn && (
                <button
                  onClick={() => setReturning(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700"
                >
                  <CornerUpLeft size={13} /> Return
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                autoFocus
                rows={2}
                maxLength={300}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is it being returned? (required)"
                className="input text-xs"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => act('return')}
                  disabled={busy || !reason.trim()}
                  className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  Send back
                </button>
                <button onClick={() => { setReturning(false); setReason('') }} className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-white dark:hover:bg-slate-700">Cancel</button>
              </div>
            </div>
          )}
          {error && <p className="mt-2 text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p>}
        </div>
      )}
      {error && !canAct && <p className="mt-2 text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p>}

      {history.length > 0 && (
        <div className="mt-3">
          <button onClick={() => setShowHistory((v) => !v)} className="text-[11px] font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
            {showHistory ? 'Hide history' : `History (${history.length})`}
          </button>
          {showHistory && (
            <ul className="mt-1 space-y-0.5 text-[11px] text-slate-400">
              {history.map((h, i) => (
                <li key={i}>
                  {fmtDate(h.actionDate)} · {h.userName} {h.action === 'completed' ? 'approved' : 'returned'} {h.label || ''}{h.comment ? ` — ${h.comment}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
