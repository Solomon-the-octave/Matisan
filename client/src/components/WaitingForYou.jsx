import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronUp, ClipboardCheck } from 'lucide-react'
import ApprovalTrail from './ApprovalTrail'
import api from '../api'

// "Items waiting for your action" — whichever position the signed-in person
// holds, their turn on the weekly sign-off shows up here. Hidden when empty.
export default function WaitingForYou() {
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(null)

  async function load() {
    try {
      const res = await api.get('/approvals/waiting')
      setItems(res.data.items)
    } catch {
      setItems([])
    }
  }

  useEffect(() => {
    load()
  }, [])

  if (items.length === 0) return null

  return (
    <div className="mb-6 surface border-brand-200 dark:border-brand-500/30 p-4 shadow-sm">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">
        <ClipboardCheck size={16} className="text-brand-600 dark:text-brand-400" /> Waiting for your action ({items.length})
      </h3>
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {items.map((it) => (
          <div key={it.periodId} className="py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{it.projectName}</div>
                <div className="text-xs text-slate-400">
                  Week {it.weekStart} – {it.weekEnd} · {it.handIn ? 'Sent back — fix and hand in again' : `${it.label} (${it.positionName})`}
                </div>
                {it.handIn && it.returnNote && <div className="mt-0.5 text-xs text-rose-600 dark:text-rose-400">{it.returnNote}</div>}
              </div>
              {it.handIn ? (
                <button onClick={() => navigate('/field-attendance')} className="shrink-0 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700">
                  Open attendance
                </button>
              ) : (
                <button
                  onClick={() => setOpen(open === it.periodId ? null : it.periodId)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
                >
                  Review {open === it.periodId ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
              )}
            </div>
            {open === it.periodId && (
              <div className="mt-3">
                <ApprovalTrail periodId={it.periodId} onChange={load} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
