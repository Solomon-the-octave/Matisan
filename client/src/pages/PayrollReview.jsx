import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Send, RotateCcw, Wallet, Download } from 'lucide-react'
import Layout from '../components/Layout'
import Badge from '../components/Badge'
import api from '../api'
import { useAuth } from '../context/AuthContext'

// Same download helper as Field Attendance — hands over exactly what's on
// screen as a file, column-for-column with the paper sheets.
async function downloadCsv(params, fallbackName) {
  const res = await api.get('/worker-attendance/export', { params, responseType: 'blob' })
  const disposition = res.headers['content-disposition'] || ''
  const match = disposition.match(/filename="([^"]+)"/)
  const filename = match ? match[1] : fallbackName
  const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// Monday-Sunday week containing `d`, as ISO date strings — the same window
// a paper weekly attendance/payroll sheet would cover.
function weekRange(d = new Date()) {
  const date = new Date(d)
  const day = date.getDay() // 0 = Sunday
  const diffToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(date)
  monday.setDate(date.getDate() + diffToMonday)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const iso = (x) => x.toISOString().slice(0, 10)
  return { weekStart: iso(monday), weekEnd: iso(sunday) }
}

function fmt(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const STATUS_LABEL = {
  submitted: 'Submitted — awaiting Finance',
  finance_checked: 'Finance-checked — awaiting approval',
  approved: 'Approved & locked',
}

export default function PayrollReview() {
  const { user } = useAuth()
  const [projects, setProjects] = useState([])
  const [periods, setPeriods] = useState([])
  const [payrollByPeriod, setPayrollByPeriod] = useState({})
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const { weekStart, weekEnd } = useMemo(() => weekRange(), [])

  const canSubmit = user.role === 'supervisor' || user.role === 'admin'
  const canFinanceCheck = user.role === 'finance' || user.role === 'admin'
  const canApprove = user.role === 'admin'

  async function load() {
    const [p, pp] = await Promise.all([api.get('/projects'), api.get('/payroll-periods')])
    setProjects(p.data.projects)
    const sorted = [...pp.data.periods].sort((a, b) => b.weekStart.localeCompare(a.weekStart))
    setPeriods(sorted)
    const entries = await Promise.all(
      sorted.map(async (period) => {
        const res = await api.get('/worker-attendance/payroll', {
          params: { projectId: period.projectId, from: period.weekStart, to: period.weekEnd },
        })
        return [period.id, res.data.totals]
      })
    )
    setPayrollByPeriod(Object.fromEntries(entries))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const projectName = (id) => projects.find((p) => p.id === id)?.name || id
  const periodFor = (projectId) => periods.find((pp) => pp.projectId === projectId && pp.weekStart === weekStart && pp.weekEnd === weekEnd)

  async function submitWeek(projectId) {
    setBusyId(projectId)
    setError('')
    try {
      await api.post('/payroll-periods/submit', { projectId, weekStart, weekEnd })
      await load()
    } catch (e) {
      setError(e.response?.data?.error || 'Could not submit this week')
    } finally {
      setBusyId(null)
    }
  }

  async function act(period, action) {
    setBusyId(period.id)
    setError('')
    try {
      await api.put(`/payroll-periods/${period.id}/${action}`)
      await load()
    } catch (e) {
      setError(e.response?.data?.error || 'Could not update this period')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Layout title="Payroll Review" subtitle="The digital sign-off chain: Submitted -> Finance-checked -> Approved">
      {error && <p className="mb-4 text-sm font-medium text-rose-600">{error}</p>}

      {canSubmit && (
        <div className="mb-6">
          <h3 className="mb-2 text-sm font-bold text-slate-700">This week ({fmt(weekStart)} – {fmt(weekEnd)})</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {projects.map((p) => {
              const period = periodFor(p.id)
              return (
                <div key={p.id} className="surface flex items-center justify-between p-4">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-700">{p.name}</div>
                    {period ? (
                      <Badge value={period.status} />
                    ) : (
                      <span className="text-xs text-slate-400">Not submitted yet</span>
                    )}
                  </div>
                  {!period && (
                    <button
                      onClick={() => submitWeek(p.id)}
                      disabled={busyId === p.id}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                    >
                      <Send size={13} /> Submit week
                    </button>
                  )}
                </div>
              )
            })}
            {projects.length === 0 && <p className="text-sm text-slate-400">No projects to submit for.</p>}
          </div>
        </div>
      )}

      <h3 className="mb-2 text-sm font-bold text-slate-700">All payroll periods</h3>
      <div className="overflow-hidden surface">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-400">
            <tr>
              <th className="px-4 py-3">Project</th>
              <th className="px-4 py-3">Week</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Payroll total</th>
              <th className="px-4 py-3">Download</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {periods.map((period) => {
              const totals = payrollByPeriod[period.id]
              return (
                <tr key={period.id}>
                  <td className="px-4 py-3 font-semibold text-slate-700">{projectName(period.projectId)}</td>
                  <td className="px-4 py-3 text-slate-500">{fmt(period.weekStart)} – {fmt(period.weekEnd)}</td>
                  <td className="px-4 py-3">
                    <Badge value={period.status} />
                    <div className="mt-0.5 text-[11px] text-slate-400">{STATUS_LABEL[period.status]}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {totals ? (
                      <>
                        <Wallet size={12} className="mr-1 inline text-slate-300" />
                        {totals.cost.toLocaleString()} <span className="text-[11px] text-slate-400">({totals.workers} workers)</span>
                        {totals.byLaborType && (
                          <div className="mt-0.5 text-[11px] text-slate-400">
                            Skilled {totals.byLaborType.Skilled.cost.toLocaleString()} · Non-Skilled {totals.byLaborType['Non-Skilled'].cost.toLocaleString()}
                          </div>
                        )}
                      </>
                    ) : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-start gap-1">
                      <button
                        onClick={() => downloadCsv(
                          { projectId: period.projectId, type: 'weekly-sheet', from: period.weekStart, to: period.weekEnd },
                          `weekly-sheet-${period.projectId}-${period.weekStart}-to-${period.weekEnd}.csv`
                        )}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-brand-600"
                      >
                        <Download size={12} /> Weekly sheet
                      </button>
                      <button
                        onClick={() => downloadCsv(
                          { projectId: period.projectId, type: 'payroll', from: period.weekStart, to: period.weekEnd },
                          `payroll-${period.projectId}-${period.weekStart}-to-${period.weekEnd}.csv`
                        )}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-brand-600"
                      >
                        <Download size={12} /> Payroll
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {period.status === 'submitted' && canFinanceCheck && (
                      <button
                        onClick={() => act(period, 'finance-check')}
                        disabled={busyId === period.id}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                      >
                        <CheckCircle2 size={13} /> Mark checked
                      </button>
                    )}
                    {period.status === 'finance_checked' && canApprove && (
                      <button
                        onClick={() => act(period, 'approve')}
                        disabled={busyId === period.id}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                      >
                        <CheckCircle2 size={13} /> Approve
                      </button>
                    )}
                    {period.status === 'approved' && canApprove && (
                      <button
                        onClick={() => act(period, 'reopen')}
                        disabled={busyId === period.id}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-60"
                      >
                        <RotateCcw size={13} /> Reopen
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
            {periods.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">No payroll periods submitted yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Layout>
  )
}
