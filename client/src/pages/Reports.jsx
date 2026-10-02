import { useEffect, useState } from 'react'
import { Download, FolderKanban, CheckCircle2, ClipboardList, CalendarCheck } from 'lucide-react'
import Layout from '../components/Layout'
import StatCard from '../components/StatCard'
import api from '../api'

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
    </Layout>
  )
}
