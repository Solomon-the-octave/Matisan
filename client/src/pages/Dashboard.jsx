import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FolderKanban, CheckCircle2, ClipboardList, CalendarCheck, Plus, Users, Clock, Download,
} from 'lucide-react'
import Layout from '../components/Layout'
import StatCard from '../components/StatCard'
import Badge from '../components/Badge'
import api from '../api'
import { useAuth } from '../context/AuthContext'

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [summary, setSummary] = useState(null)
  const [projects, setProjects] = useState([])
  const [tasks, setTasks] = useState([])
  const [busy, setBusy] = useState(false)

  async function load() {
    const [s, p, t] = await Promise.all([
      api.get('/reports/summary'),
      api.get('/projects'),
      api.get('/tasks'),
    ])
    setSummary(s.data)
    setProjects(p.data.projects)
    setTasks(t.data.tasks)
  }

  useEffect(() => {
    load()
  }, [])

  async function handleCheckIn() {
    setBusy(true)
    try {
      await api.post('/attendance/check-in')
      await load()
    } catch (e) {
      alert(e.response?.data?.error || 'Could not check in')
    } finally {
      setBusy(false)
    }
  }

  async function handleCheckOut() {
    setBusy(true)
    try {
      await api.post('/attendance/check-out')
      await load()
    } catch (e) {
      alert(e.response?.data?.error || 'Could not check out')
    } finally {
      setBusy(false)
    }
  }

  async function downloadReport() {
    const res = await api.get('/reports/export', { responseType: 'blob' })
    const url = URL.createObjectURL(new Blob([res.data]))
    const a = document.createElement('a')
    a.href = url
    a.download = 'matisan-hr-report.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!summary) {
    return (
      <Layout title="Dashboard">
        <div className="text-sm text-slate-400">Loading...</div>
      </Layout>
    )
  }

  if (user.role === 'admin') {
    return (
      <Layout title="Welcome back, System!" subtitle="Here's what's happening across Matisan today">
        <div className="mb-6 flex justify-end gap-2">
          <button onClick={downloadReport} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            <Download size={15} /> Download Report
          </button>
          <button onClick={() => navigate('/projects')} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
            <Plus size={15} /> Create Project
          </button>
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Total Projects" value={summary.totalProjects} icon={FolderKanban} />
          <StatCard label="Active Projects" value={summary.activeProjects} icon={CheckCircle2} />
          <StatCard label="Pending Tasks" value={summary.pendingTasks} icon={ClipboardList} />
          <StatCard label="Attendance Today" value={summary.attendanceToday} icon={CalendarCheck} />
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Panel title="Recent Projects" onSeeAll={() => navigate('/projects')}>
            {projects.slice(0, 4).map((p) => (
              <ListRow key={p.id} title={p.name} subtitle={p.site} right={<Badge value={p.status} />} />
            ))}
            {projects.length === 0 && <Empty text="No projects yet" />}
          </Panel>
          <Panel title="Recent Tasks" onSeeAll={() => navigate('/tasks')}>
            {tasks.slice(0, 4).map((t) => (
              <ListRow key={t.id} title={t.title} subtitle={t.description} right={<Badge value={t.priority} />} />
            ))}
            {tasks.length === 0 && <Empty text="No tasks yet" />}
          </Panel>
        </div>

        <div className="mt-6 surface p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-slate-700">Quick Actions</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <QuickAction icon={Plus} label="New Project" onClick={() => navigate('/projects')} primary />
            <QuickAction icon={Users} label="Manage Users" onClick={() => navigate('/users')} />
            <QuickAction icon={CalendarCheck} label="Check Attendance" onClick={() => navigate('/attendance')} />
          </div>
        </div>
      </Layout>
    )
  }

  if (user.role === 'supervisor') {
    const attention = tasks.filter((t) => t.status === 'submitted')
    return (
      <Layout title="Supervisor Dashboard" subtitle="Manage your team and track project progress.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="My Projects" value={summary.totalProjects} icon={Users} />
          <StatCard label="Tasks to Review" value={summary.tasksToReview} icon={ClipboardList} />
          <StatCard label="Pending Attendance" value={summary.pendingAttendance} icon={Clock} />
        </div>
        <div className="mt-6 surface p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-slate-700">Tasks Requiring Attention</h3>
          {attention.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <CheckCircle2 className="mb-2 text-emerald-400" size={28} />
              <p className="text-sm font-medium text-slate-500">No tasks requiring attention</p>
              <p className="text-xs text-slate-400">Great job! You're all caught up.</p>
            </div>
          ) : (
            attention.map((t) => (
              <ListRow key={t.id} title={t.title} subtitle="Submitted - awaiting your review" right={<Badge value={t.priority} />} />
            ))
          )}
        </div>
      </Layout>
    )
  }

  // employee
  return (
    <Layout title="My Dashboard" subtitle="Track your tasks and attendance.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="My Tasks" value={summary.myTasks} icon={ClipboardList} />
        <StatCard label="Completed Today" value={summary.myTasksCompletedToday} icon={CheckCircle2} />
        <StatCard label="Hours This Week" value={`${summary.hoursThisWeek}h`} icon={Clock} />
      </div>

      <div className="mt-6 surface p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-700">Attendance</h3>
          {summary.checkedInToday ? (
            <button onClick={handleCheckOut} disabled={busy} className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-60">
              Check Out
            </button>
          ) : summary.myAttendanceToday ? (
            <span className="text-xs font-semibold text-slate-500">Checked out for today</span>
          ) : (
            <button onClick={handleCheckIn} disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
              Check In
            </button>
          )}
        </div>
      </div>

      <div className="mt-6 surface p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-bold text-slate-700">My Pending Tasks</h3>
        {tasks.filter((t) => t.status !== 'completed').length === 0 && <Empty text="No pending tasks" />}
        {tasks
          .filter((t) => t.status !== 'completed')
          .map((t) => (
            <ListRow key={t.id} title={t.title} subtitle={t.description} right={<Badge value={t.priority} />} />
          ))}
      </div>
    </Layout>
  )
}

function Panel({ title, onSeeAll, children }) {
  return (
    <div className="surface p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-700">{title}</h3>
        <button onClick={onSeeAll} className="text-xs font-semibold text-brand-600 hover:underline">View All &rarr;</button>
      </div>
      <div className="divide-y divide-slate-100">{children}</div>
    </div>
  )
}

function ListRow({ title, subtitle, right }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <div className="min-w-0 pr-3">
        <div className="truncate text-sm font-semibold text-slate-700">{title}</div>
        {subtitle && <div className="truncate text-xs text-slate-400">{subtitle}</div>}
      </div>
      {right}
    </div>
  )
}

function Empty({ text }) {
  return <p className="py-6 text-center text-sm text-slate-400">{text}</p>
}

function QuickAction({ icon: Icon, label, onClick, primary }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-center gap-2 rounded-lg py-3 text-sm font-semibold transition ${
        primary ? 'bg-brand-600 text-white hover:bg-brand-700' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
      }`}
    >
      <Icon size={16} /> {label}
    </button>
  )
}
