import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import Layout from '../components/Layout'
import Badge from '../components/Badge'
import api from '../api'
import { useAuth } from '../context/AuthContext'

const STATUS_FLOW = ['created', 'in_progress', 'submitted', 'approved', 'completed']
const emptyForm = { title: '', description: '', department: '', assignedTo: '', priority: 'medium', dueDate: '', projectId: '' }

export default function Tasks() {
  const { user } = useAuth()
  const [tasks, setTasks] = useState([])
  const [projects, setProjects] = useState([])
  const [users, setUsers] = useState([])
  const [departments, setDepartments] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const canManage = user.role === 'admin' || user.role === 'supervisor'

  async function load() {
    const calls = [api.get('/tasks'), api.get('/projects'), api.get('/departments')]
    if (canManage) calls.push(api.get('/users'))
    const [t, p, dep, u] = await Promise.all(calls)
    setTasks(t.data.tasks)
    setProjects(p.data.projects)
    setDepartments(dep.data.departments)
    if (u) setUsers(u.data.users)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!user.isGlobalAdmin) setForm((f) => ({ ...f, department: user.department }))
  }, [user])

  async function submit(e) {
    e.preventDefault()
    await api.post('/tasks', form)
    setForm({ ...emptyForm, department: user.isGlobalAdmin ? '' : user.department })
    setShowForm(false)
    load()
  }

  async function advance(task) {
    const idx = STATUS_FLOW.indexOf(task.status)
    const next = STATUS_FLOW[Math.min(idx + 1, STATUS_FLOW.length - 1)]
    await api.put(`/tasks/${task.id}`, { status: next })
    load()
  }

  function nextLabel(status) {
    const map = { created: 'Start', in_progress: 'Submit', submitted: 'Approve', approved: 'Complete' }
    return map[status]
  }

  const projectName = (id) => projects.find((p) => p.id === id)?.name

  return (
    <Layout title={user.role === 'employee' ? 'My Tasks' : 'Tasks'} subtitle="Track and move work through the workflow">
      {canManage && (
        <div className="mb-4 flex justify-end">
          <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
            <Plus size={15} /> New Task
          </button>
        </div>
      )}

      <div className="space-y-3">
        {tasks.map((t) => (
          <div key={t.id} className="flex flex-col justify-between gap-3 surface p-4 shadow-sm sm:flex-row sm:items-center">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">{t.title}</h4>
                <Badge value={t.priority} />
              </div>
              <p className="mt-0.5 truncate text-xs text-slate-400">
                {projectName(t.projectId) || 'No project'}{t.dueDate ? ` · Due ${t.dueDate}` : ''}
              </p>
              {t.description && <p className="mt-1 text-sm text-slate-500">{t.description}</p>}
            </div>
            <div className="flex items-center gap-3">
              <Badge value={t.status} />
              {STATUS_FLOW.indexOf(t.status) < STATUS_FLOW.length - 1 &&
                (t.assignedTo === user.id || canManage) && (
                  <button onClick={() => advance(t)} className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                    {nextLabel(t.status)}
                  </button>
                )}
            </div>
          </div>
        ))}
        {tasks.length === 0 && <p className="text-sm text-slate-400">No tasks assigned.</p>}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white dark:bg-slate-900 p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">New Task</h3>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <input required placeholder="Task title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="input" />
              <textarea placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input" rows={2} />
              <select
                required
                disabled={!user.isGlobalAdmin}
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value, assignedTo: '', projectId: '' })}
                className="input"
              >
                <option value="">Select department...</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <select required value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })} className="input">
                <option value="">Assign to...</option>
                {users.filter((u) => !form.department || u.department === form.department).map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
              <select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} className="input">
                <option value="">No linked project</option>
                {projects.filter((p) => !form.department || p.department === form.department).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-3">
                <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="input">
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
                <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="input" />
              </div>
              <button type="submit" className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">Create Task</button>
            </form>
          </div>
        </div>
      )}
    </Layout>
  )
}
