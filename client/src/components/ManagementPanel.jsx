import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2 } from 'lucide-react'
import api from '../api'

const etb = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })

function Stat({ label, value }) {
  return (
    <div className="rounded-lg bg-slate-50 dark:bg-slate-800 px-3 py-2">
      <div className="text-lg font-bold text-slate-800 dark:text-slate-100">{value}</div>
      <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{label}</div>
    </div>
  )
}

// The company-wide view for admin and Head Office seats. Anyone else gets
// `visible: false` from the server and this renders nothing.
export default function ManagementPanel() {
  const navigate = useNavigate()
  const [m, setM] = useState(null)

  useEffect(() => {
    api.get('/dashboard-context/management').then((r) => setM(r.data.visible ? r.data : null)).catch(() => setM(null))
  }, [])

  if (!m) return null
  return (
    <div className="mb-6 surface p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">
          <Building2 size={16} className="text-brand-600 dark:text-brand-400" /> Company overview
        </h3>
        <button onClick={() => navigate('/approvals')} className="text-xs font-semibold text-brand-600 dark:text-brand-300">All payment requests</button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Active projects" value={m.activeProjects} />
        <Stat label="Employees" value={m.totalEmployees} />
        <Stat label="Workers on site today" value={m.workersOnSite} />
        <Stat label="Requests in approval" value={m.pendingApprovals} />
        <Stat label="Awaiting payment (ETB)" value={etb(m.awaitingPaymentAmount)} />
        <Stat label="Paid so far (ETB)" value={etb(m.paidTotal)} />
      </div>
      {m.requests.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800 text-sm">
          {m.requests.map((r) => (
            <li key={r.id}>
              <button onClick={() => navigate(`/approvals?period=${r.id}`)} className="flex w-full flex-wrap items-center justify-between gap-2 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800">
                <span className="min-w-0">
                  <span className="mr-2 text-xs font-bold text-brand-600 dark:text-brand-300">{r.requestNo}</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-200">{r.projectName}</span>
                </span>
                <span className="text-xs text-slate-400">{etb(r.amount)} ETB · Awaiting {r.awaiting}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
