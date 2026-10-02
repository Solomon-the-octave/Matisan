import { useEffect, useState } from 'react'
import { Plus, X, MapPin, UserCog } from 'lucide-react'
import Layout from '../components/Layout'
import Badge from '../components/Badge'
import api from '../api'
import { useAuth } from '../context/AuthContext'

const emptyForm = { name: '', site: '', department: '', description: '' }

export default function Projects() {
  const { user } = useAuth()
  const [projects, setProjects] = useState([])
  const [departments, setDepartments] = useState([])
  const [users, setUsers] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [assignFor, setAssignFor] = useState(null) // project being edited in the assign panel
  const canManage = user.role === 'admin' || user.role === 'supervisor'

  async function load() {
    const calls = [api.get('/projects'), api.get('/departments')]
    if (canManage) calls.push(api.get('/users'))
    const [p, d, u] = await Promise.all(calls)
    setProjects(p.data.projects)
    setDepartments(d.data.departments)
    if (u) setUsers(u.data.users)
  }

  async function setAssignment(project, userId, action) {
    await api.put(`/projects/${project.id}/assignments`, { userId, action })
    load()
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    if (!user.isGlobalAdmin) setForm((f) => ({ ...f, department: user.department }))
  }, [user])

  const deptName = (id) => departments.find((d) => d.id === id)?.name || id

  async function submit(e) {
    e.preventDefault()
    await api.post('/projects', form)
    setForm({ ...emptyForm, department: user.isGlobalAdmin ? '' : user.department })
    setShowForm(false)
    load()
  }

  async function updateStatus(id, status) {
    await api.put(`/projects/${id}`, { status })
    load()
  }

  async function updateProgress(id, progress) {
    await api.put(`/projects/${id}`, { progress: Number(progress) })
    load()
  }

  return (
    <Layout title="Projects" subtitle="Track large-scale sites and their progress">
      {canManage && (
        <div className="mb-4 flex justify-end">
          <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
            <Plus size={15} /> New Project
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {projects.map((p) => (
          <div key={p.id} className="surface p-5 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{p.name}</h3>
                <p className="mt-1 inline-flex items-center gap-1 text-xs text-slate-400">
                  <MapPin size={12} /> {p.site || 'No site set'} · {deptName(p.department)}
                </p>
              </div>
              <Badge value={p.status} />
            </div>
            <p className="mt-3 text-sm text-slate-500">{p.description}</p>
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-xs font-medium text-slate-400">
                <span>Progress</span><span>{p.progress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                <div className="h-full rounded-full bg-brand-600" style={{ width: `${p.progress}%` }} />
              </div>
            </div>
            {canManage && (
              <div className="mt-4 flex items-center gap-2">
                <select
                  value={p.status}
                  onChange={(e) => updateStatus(p.id, e.target.value)}
                  className="input !w-auto text-xs"
                >
                  <option value="active">Active</option>
                  <option value="on_hold">On hold</option>
                  <option value="completed">Completed</option>
                </select>
                <input
                  type="range" min="0" max="100" defaultValue={p.progress}
                  onMouseUp={(e) => updateProgress(p.id, e.target.value)}
                  onTouchEnd={(e) => updateProgress(p.id, e.target.value)}
                  className="flex-1"
                />
              </div>
            )}

            {canManage && (
              <div className="mt-3 border-t border-slate-100 dark:border-slate-800 pt-3">
                <button
                  onClick={() => setAssignFor(assignFor === p.id ? null : p.id)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:text-brand-700"
                >
                  <UserCog size={13} /> Assigned team ({(p.assignedEmployees || []).length})
                </button>
                {assignFor === p.id && (
                  <div className="mt-2 space-y-1.5">
                    {users
                      .filter((u) => u.role === 'employee' && u.department === p.department)
                      .map((u) => {
                        const assigned = (p.assignedEmployees || []).includes(u.id)
                        return (
                          <label key={u.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-xs hover:bg-slate-50 dark:hover:bg-slate-800">
                            <span className="text-slate-600 dark:text-slate-300">{u.name}</span>
                            <input
                              type="checkbox"
                              checked={assigned}
                              onChange={() => setAssignment(p, u.id, assigned ? 'remove' : 'add')}
                              className="h-3.5 w-3.5"
                            />
                          </label>
                        )
                      })}
                    {users.filter((u) => u.role === 'employee' && u.department === p.department).length === 0 && (
                      <p className="px-2 py-1 text-xs text-slate-400">No employees in this department yet.</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {projects.length === 0 && <p className="text-sm text-slate-400">No projects yet.</p>}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-900 p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">New Project</h3>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <input required placeholder="Project name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" />
              <input placeholder="Site / location" value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })} className="input" />
              <select
                required
                disabled={!user.isGlobalAdmin}
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
                className="input"
              >
                <option value="">Select department...</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <textarea placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input" rows={3} />
              <button type="submit" className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">Create Project</button>
            </form>
          </div>
        </div>
      )}
    </Layout>
  )
}
