import { useEffect, useState } from 'react'
import { Download, FolderKanban, CheckCircle2, ClipboardList, CalendarCheck, FileSpreadsheet } from 'lucide-react'
import Layout from '../components/Layout'
import StatCard from '../components/StatCard'
import api from '../api'
import { useAuth } from '../context/AuthContext'

const REPORT_TYPES = [
  ['payments', 'Payment requests and history'],
  ['payroll', 'Payroll by worker'],
  ['field-attendance', 'Field attendance'],
  ['workforce', 'Project workforce'],
  ['workers', 'Field workers'],
  ['attendance', 'Staff attendance'],
  ['employees', 'Employees'],
]
const STATUS_OPTIONS = {
  payments: [['', 'Any status'], ['in_progress', 'In approval'], ['awaiting_payment', 'Awaiting payment'], ['paid', 'Paid']],
  attendance: [['', 'Any status'], ['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected']],
  employees: [['', 'Any role'], ['admin', 'Admin'], ['supervisor', 'Supervisor'], ['employee', 'Employee'], ['finance', 'Finance']],
}
const USES = {
  payments: ['projectId', 'from', 'to', 'status', 'department'],
  payroll: ['projectId', 'from', 'to', 'department'],
  'field-attendance': ['projectId', 'from', 'to'],
  workforce: ['projectId', 'from', 'to', 'department'],
  workers: ['projectId', 'department'],
  attendance: ['from', 'to', 'status', 'department'],
  employees: ['projectId', 'status', 'department'],
}

function HrReports() {
  const { user } = useAuth()
  const [type, setType] = useState('payments')
  const [f, setF] = useState({ projectId: '', from: '', to: '', status: '', department: '' })
  const [projects, setProjects] = useState([])
  const [departments, setDepartments] = useState([])
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const uses = USES[type]
  const companyWide = user.role !== 'supervisor' || user.isGlobalAdmin

  useEffect(() => {
    api.get('/projects').then((r) => setProjects(r.data.projects)).catch(() => {})
    api.get('/departments').then((r) => setDepartments(r.data.departments)).catch(() => {})
  }, [])

  function params() {
    const p = { type }
    for (const k of uses) if (f[k]) p[k] = f[k]
    return p
  }

  async function run() {
    setBusy(true)
    setError('')
    try {
      const res = await api.get('/hr-reports', { params: params() })
      setResult(res.data)
    } catch (e) {
      setResult(null)
      setError(e.response?.data?.error || 'Could not run this report')
    } finally {
      setBusy(false)
    }
  }

  async function csv() {
    try {
      const res = await api.get('/hr-reports', { params: { ...params(), format: 'csv' }, responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `matisan-${type}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError('Could not download this report')
    }
  }

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  return (
    <div className="mt-6 surface p-5 shadow-sm">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200"><FileSpreadsheet size={16} className="text-brand-600" /> HR and payroll reports</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-[11px] font-medium text-slate-500">Report
          <select className="input mt-0.5" value={type} onChange={(e) => { setType(e.target.value); setResult(null); setF({ ...f, status: '' }) }}>
            {REPORT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        {uses.includes('projectId') && (
          <label className="text-[11px] font-medium text-slate-500">Project
            <select className="input mt-0.5" value={f.projectId} onChange={set('projectId')}>
              <option value="">All projects</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        {uses.includes('department') && companyWide && (
          <label className="text-[11px] font-medium text-slate-500">Department
            <select className="input mt-0.5" value={f.department} onChange={set('department')}>
              <option value="">All departments</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
        )}
        {uses.includes('from') && <label className="text-[11px] font-medium text-slate-500">From<input type="date" className="input mt-0.5" value={f.from} onChange={set('from')} /></label>}
        {uses.includes('to') && <label className="text-[11px] font-medium text-slate-500">To<input type="date" className="input mt-0.5" value={f.to} onChange={set('to')} /></label>}
        {uses.includes('status') && STATUS_OPTIONS[type] && (
          <label className="text-[11px] font-medium text-slate-500">{type === 'employees' ? 'Role' : 'Status'}
            <select className="input mt-0.5" value={f.status} onChange={set('status')}>
              {STATUS_OPTIONS[type].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={run} disabled={busy} className="min-h-[40px] rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">{busy ? 'Loading...' : 'Show report'}</button>
        <button onClick={csv} className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 px-4 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"><Download size={14} /> Download CSV</button>
      </div>
      {error && <p className="mt-3 text-sm font-medium text-rose-600 dark:text-rose-400">{error}</p>}
      {result && (
        <div className="mt-4">
          <p className="mb-2 text-xs text-slate-400">{result.title}: {result.count} row{result.count === 1 ? '' : 's'}</p>
          <div className="overflow-x-auto rounded-lg border border-slate-100 dark:border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800 font-semibold text-slate-400"><tr>{result.columns.map((c) => <th key={c.key} className="whitespace-nowrap px-3 py-2">{c.label}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {result.rows.slice(0, 200).map((r, i) => (
                  <tr key={i}>{result.columns.map((c) => <td key={c.key} className="whitespace-nowrap px-3 py-2 text-slate-600 dark:text-slate-300">{r[c.key] == null ? '' : String(r[c.key])}</td>)}</tr>
                ))}
                {result.rows.length === 0 && <tr><td colSpan={result.columns.length} className="px-3 py-6 text-center text-slate-400">No records match these filters.</td></tr>}
              </tbody>
            </table>
          </div>
          {result.rows.length > 200 && <p className="mt-1 text-[11px] text-slate-400">Showing the first 200 rows. Download the CSV for all of them.</p>}
        </div>
      )}
    </div>
  )
}

export default function Reports() {
  const [summary, setSummary] = useState(null)
  const [tasks, setTasks] = useState([])

  useEffect(() => {
    Promise.all([api.get('/reports/summary'), api.get('/tasks')]).then(([s, t]) => {
      setSummary(s.data)
      setTasks(t.data.tasks)
    })
  }, [])

  async function download() {
    const res = await api.get('/reports/export', { responseType: 'blob' })
    const url = URL.createObjectURL(new Blob([res.data]))
    const a = document.createElement('a')
    a.href = url
    a.download = 'matisan-hr-report.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!summary) return null

  const statuses = ['created', 'in_progress', 'submitted', 'approved', 'completed']
  const counts = statuses.map((s) => tasks.filter((t) => t.status === s).length)
  const max = Math.max(1, ...counts)

  return (
    <Layout title="Reports" subtitle="Company-wide analytics and exports">
      <div className="mb-6 flex justify-end">
        <button onClick={download} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
          <Download size={15} /> Download CSV Report
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total Projects" value={summary.totalProjects} icon={FolderKanban} />
        <StatCard label="Active Projects" value={summary.activeProjects} icon={CheckCircle2} />
        <StatCard label="Pending Tasks" value={summary.pendingTasks} icon={ClipboardList} />
        <StatCard label="Attendance Today" value={summary.attendanceToday} icon={CalendarCheck} />
      </div>

      <div className="mt-6 surface p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-bold text-slate-700 dark:text-slate-200">Tasks by Status</h3>
        <div className="space-y-3">
          {statuses.map((s, i) => (
            <div key={s} className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-xs font-medium capitalize text-slate-500">{s.replace('_', ' ')}</span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                <div className="h-full rounded-full bg-brand-600" style={{ width: `${(counts[i] / max) * 100}%` }} />
              </div>
              <span className="w-6 text-right text-xs font-semibold text-slate-500">{counts[i]}</span>
            </div>
          ))}
        </div>
      </div>
      <HrReports />
    </Layout>
  )
}
