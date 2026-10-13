import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FolderClosed, FolderOpen, ArrowLeft, ChevronDown, ChevronUp, Download, Printer, AlertTriangle, XCircle, CheckCircle2, Search } from 'lucide-react'
import Layout from '../components/Layout'
import ApprovalTrail from '../components/ApprovalTrail'
import api from '../api'

const etb = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })
const day = (d) => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '')
const short = (d) => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '')

function Tile({ label, value }) {
  return (
    <div className="surface px-3 py-2">
      <div className="text-lg font-bold text-slate-800 dark:text-slate-100">{value}</div>
      <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{label}</div>
    </div>
  )
}

const FLAG_STYLE = {
  error: { icon: XCircle, cls: 'text-rose-600 dark:text-rose-400' },
  warn: { icon: AlertTriangle, cls: 'text-amber-600 dark:text-amber-400' },
}

// Everything Finance looks at before paying, in one place, followed by the
// normal step-10 form (amount, date, reference, proof).
function FinalCheck({ periodId, onChange }) {
  const [c, setC] = useState(null)
  useEffect(() => {
    api.get(`/finance/period/${periodId}/check`).then((r) => setC(r.data)).catch(() => setC(null))
  }, [periodId])
  return (
    <div className="mt-3 space-y-4 border-t border-slate-100 dark:border-slate-800 pt-3">
      {c && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="Workers" value={c.totals.workers} />
            <Tile label="Days worked" value={c.totals.days} />
            <Tile label="Overtime hours" value={c.totals.otHours} />
            <Tile label="Payroll total (ETB)" value={etb(c.totals.total)} />
          </div>
          <div className="text-xs text-slate-500">
            Skilled {etb(c.totals.byLaborType?.Skilled?.cost)} ETB · Non-Skilled {etb(c.totals.byLaborType?.['Non-Skilled']?.cost)} ETB
          </div>
          <div>
            <h4 className="mb-1 text-xs font-bold text-slate-700 dark:text-slate-200">Checks before payment</h4>
            {c.flags.length === 0 ? (
              <p className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400"><CheckCircle2 size={14} /> Nothing needs attention.</p>
            ) : (
              <ul className="space-y-1">
                {c.flags.map((f, i) => {
                  const S = FLAG_STYLE[f.level]
                  return <li key={i} className={`flex items-start gap-1.5 text-xs font-medium ${S.cls}`}><S.icon size={14} className="mt-0.5 shrink-0" /> {f.text}</li>
                })}
              </ul>
            )}
          </div>
        </>
      )}
      <ApprovalTrail periodId={periodId} onChange={onChange} />
    </div>
  )
}

function csvCell(v) {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

function exportLedger(name, list) {
  const head = ['Request no', 'Project', 'Week start', 'Week end', 'Status', 'Payroll total (ETB)', 'Amount paid (ETB)', 'Paid date', 'Method', 'Reference', 'Paid by']
  const lines = list.map((r) => [r.requestNo, r.projectName, r.weekStart, r.weekEnd, r.status === 'paid' ? 'Paid' : `Awaiting ${r.awaiting || ''}`, r.payrollTotal, r.amountPaid, r.paidDate, r.method, r.reference, r.paidByName])
  const csv = [head, ...lines].map((r) => r.map(csvCell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-finance-ledger.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function Finance() {
  const [params, setParams] = useSearchParams()
  const [folders, setFolders] = useState(null)
  const [denied, setDenied] = useState(false)
  const [totals, setTotals] = useState(null)
  const [queue, setQueue] = useState([])
  const [detail, setDetail] = useState(null)
  const [open, setOpen] = useState(params.get('period'))
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const projectId = params.get('project')

  async function load() {
    const [f, q] = await Promise.all([api.get('/finance/folders'), api.get('/finance/queue')])
    setFolders(f.data.folders)
    setTotals(f.data.totals)
    setQueue(q.data.queue)
    if (projectId) {
      const d = await api.get(`/finance/folders/${projectId}`).catch(() => null)
      setDetail(d ? d.data : null)
    } else setDetail(null)
  }

  useEffect(() => {
    load().catch((e) => { if (e.response?.status === 403) setDenied(true); setFolders([]) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const shownFolders = useMemo(
    () => (folders || []).filter((f) => !search || f.name.toLowerCase().includes(search.toLowerCase())),
    [folders, search]
  )
  const requests = (detail?.requests || []).filter((r) => {
    if (filter === 'paid') return r.status === 'paid'
    if (filter === 'final') return r.status !== 'paid' && r.currentStep === 10
    if (filter === 'approval') return r.status !== 'paid' && r.currentStep < 10
    return true
  })

  const openFolder = (id) => { setFilter('all'); setOpen(null); setParams({ project: id }) }
  const goHome = () => { setOpen(null); setParams({}) }

  return (
    <Layout title="Head Office Finance" subtitle="Final check, payment approval and the record of every payroll, filed by project">
      {denied && <div className="surface p-4 text-sm text-slate-500 dark:text-slate-400">Head Office Finance is for Finance and administrators.</div>}
      {!folders && <p className="text-sm text-slate-400">Loading...</p>}
      {folders && !denied && !projectId && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="Awaiting final check" value={totals.awaitingFinal} />
            <Tile label="Amount awaiting (ETB)" value={etb(totals.amountAwaiting)} />
            <Tile label="Paid requests" value={totals.paid} />
            <Tile label="Total paid (ETB)" value={etb(totals.totalPaid)} />
          </div>

          <section className="mb-6">
            <h3 className="mb-2 text-sm font-bold text-slate-700 dark:text-slate-200">Final check and payment approval ({queue.length})</h3>
            {queue.length === 0 && <div className="surface p-4 text-sm text-slate-500 dark:text-slate-400">Nothing is waiting for the final check. Requests appear here once the General Manager has verified them.</div>}
            <div className="space-y-2">
              {queue.map((r) => (
                <div key={r.id} className="surface p-4">
                  <button onClick={() => setOpen(open === r.id ? null : r.id)} className="flex w-full items-center justify-between gap-3 text-left">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold text-brand-600 dark:text-brand-300">{r.requestNo}</span>
                        <span className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{r.projectName}</span>
                      </div>
                      <div className="text-xs text-slate-400">Week {short(r.weekStart)} – {short(r.weekEnd)} · {r.workers} workers · {etb(r.payrollTotal)} ETB</div>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white">
                      {open === r.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {open === r.id ? 'Close' : 'Review and approve'}
                    </span>
                  </button>
                  {open === r.id && <FinalCheck periodId={r.id} onChange={load} />}
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">Project folders</h3>
              <label className="relative">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a project" className="input !w-56 !pl-8" />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {shownFolders.map((f) => (
                <button key={f.id} onClick={() => openFolder(f.id)} className="surface p-4 text-left shadow-sm hover:border-brand-300 dark:hover:border-brand-500/50">
                  <div className="flex items-center gap-2">
                    <FolderClosed size={18} className="shrink-0 text-brand-600 dark:text-brand-400" />
                    <span className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{f.name}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                    <span>{f.requests} request{f.requests === 1 ? '' : 's'}</span>
                    <span>{f.paid} paid</span>
                    <span>Paid {etb(f.totalPaid)} ETB</span>
                    <span>{f.awaitingFinal ? `${f.awaitingFinal} awaiting final check` : f.inApproval ? `${f.inApproval} in approval` : 'Up to date'}</span>
                  </div>
                  <div className="mt-2 text-[11px] text-slate-400">{f.lastPaid ? `Last payment ${day(f.lastPaid)}` : 'No payments yet'}</div>
                </button>
              ))}
              {shownFolders.length === 0 && <p className="text-sm text-slate-400">No projects match.</p>}
            </div>
          </section>
        </>
      )}

      {folders && !denied && projectId && (
        <>
          <div className="no-print mb-3 flex flex-wrap items-center justify-between gap-2">
            <button onClick={goHome} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 dark:text-brand-300"><ArrowLeft size={15} /> All project folders</button>
            {detail && (
              <div className="flex gap-2">
                <button onClick={() => exportLedger(detail.project.name, detail.requests)} className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"><Download size={13} /> Download ledger</button>
                <button onClick={() => window.print()} className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"><Printer size={13} /> Print</button>
              </div>
            )}
          </div>
          {!detail && <p className="text-sm text-slate-400">That folder could not be opened.</p>}
          {detail && (
            <>
              <h3 className="mb-3 flex items-center gap-2 text-base font-bold text-slate-800 dark:text-slate-100"><FolderOpen size={18} className="text-brand-600 dark:text-brand-400" /> {detail.project.name}</h3>
              <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Tile label="Requests" value={detail.summary.requests} />
                <Tile label="Paid" value={detail.summary.paid} />
                <Tile label="Total paid (ETB)" value={etb(detail.summary.totalPaid)} />
                <Tile label="Awaiting final check (ETB)" value={etb(detail.summary.amountAwaiting)} />
              </div>
              <div className="no-print mb-2 flex flex-wrap gap-1.5">
                {[['all', 'All'], ['paid', 'Paid'], ['final', 'Awaiting final check'], ['approval', 'In approval']].map(([k, l]) => (
                  <button key={k} onClick={() => setFilter(k)} className={`min-h-[36px] rounded-full px-3 text-xs font-semibold ${filter === k ? 'bg-brand-600 text-white' : 'border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>{l}</button>
                ))}
              </div>
              <div className="space-y-2">
                {requests.map((r) => (
                  <div key={r.id} className="surface p-4">
                    <button onClick={() => setOpen(open === r.id ? null : r.id)} className="flex w-full flex-wrap items-center justify-between gap-3 text-left">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold text-brand-600 dark:text-brand-300">{r.requestNo}</span>
                          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Week {short(r.weekStart)} – {short(r.weekEnd)}</span>
                        </div>
                        <div className="text-xs text-slate-400">
                          {r.status === 'paid'
                            ? `Paid ${etb(r.amountPaid)} ETB on ${day(r.paidDate)}${r.method ? ` · ${r.method}` : ''}${r.reference ? ` · Ref ${r.reference}` : ''}${r.paidByName ? ` · by ${r.paidByName}` : ''}`
                            : `Awaiting ${r.awaiting || 'approval'} · ${etb(r.payrollTotal)} ETB`}
                        </div>
                      </div>
                      <span className="text-xs font-semibold text-slate-500">{r.status === 'paid' ? 'Paid' : r.currentStep === 10 ? 'Final check' : `Step ${r.currentStep} of 10`}</span>
                    </button>
                    {open === r.id && (r.status !== 'paid' && r.currentStep === 10 ? <FinalCheck periodId={r.id} onChange={load} /> : <div className="mt-3 border-t border-slate-100 dark:border-slate-800 pt-3"><ApprovalTrail periodId={r.id} onChange={load} /></div>)}
                  </div>
                ))}
                {requests.length === 0 && <p className="text-sm text-slate-400">No requests in this view yet.</p>}
              </div>
            </>
          )}
        </>
      )}
    </Layout>
  )
}
