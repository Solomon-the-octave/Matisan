import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, X, Trash2, Pencil, Eye, EyeOff, Wand2, Copy, CheckCircle2 } from 'lucide-react'
import Layout from '../components/Layout'
import Badge from '../components/Badge'
import ScrollHint from '../components/ScrollHint'
import api from '../api'
import { useAuth } from '../context/AuthContext'

const emptyForm = { name: '', email: '', password: '', role: 'employee', department: '', title: '', phone: '', projectId: '', positionKey: '' }
const ROLE_INFO = {
  employee: { label: 'Employee', lands: 'Employee dashboard: their project, tasks, and daily field attendance' },
  supervisor: { label: 'Supervisor', lands: 'Supervisor dashboard: their team, projects, tasks, and attendance review' },
  finance: { label: 'Finance', lands: 'Finance dashboard: payroll and the weekly sign-off' },
  admin: { label: 'Admin', lands: 'Admin dashboard: full access across all departments' },
}
function makePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  return Array.from(bytes, (b) => chars[b % chars.length]).join('') + '#7'
}

export default function Users() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [users, setUsers] = useState([])
  const [departments, setDepartments] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [showPw, setShowPw] = useState(false)
  const [saving, setSaving] = useState(false)
  const [created, setCreated] = useState(null) // summary card after a user is created
  const [projects, setProjects] = useState([])
  const [positions, setPositions] = useState([])
  const [error, setError] = useState('')
  const deptFilter = params.get('department') || ''

  async function load() {
    const [u, d, pr, po] = await Promise.all([
      api.get('/users'),
      api.get('/departments'),
      api.get('/projects').catch(() => ({ data: { projects: [] } })),
      api.get('/positions').catch(() => ({ data: { positions: [] } })),
    ])
    setUsers(u.data.users)
    setDepartments(d.data.departments)
    setProjects(pr.data.projects || [])
    setPositions(po.data.positions || [])
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    if (!user.isGlobalAdmin) setForm((f) => ({ ...f, department: user.department }))
  }, [user])

  const visible = deptFilter ? users.filter((u) => u.department === deptFilter) : users
  const deptName = (id) => departments.find((d) => d.id === id)?.name || id

  const closeForm = () => { setShowForm(false); setEditingId(null); setError(''); setShowPw(false) }
  const blankForm = () => ({ ...emptyForm, department: user.isGlobalAdmin ? '' : user.department })

  function openNew() {
    setEditingId(null)
    setForm(blankForm())
    setError('')
    setShowForm(true)
  }

  function openEdit(u) {
    setEditingId(u.id)
    setForm({ ...emptyForm, name: u.name, email: u.email, role: u.role, department: u.department, title: u.title || '', phone: u.phone || '' })
    setError('')
    setShowForm(true)
  }

  const deptProjects = projects.filter((p) => !form.department || p.department === form.department)
  const sitePositions = positions.filter((p) => p.type === 'site' && p.id !== 'site-project-manager')
  const headPositions = positions.filter((p) => p.type === 'head_office')

  async function submit(e) {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      if (editingId) {
        const body = { name: form.name, title: form.title, phone: form.phone }
        if (user.isGlobalAdmin) Object.assign(body, { role: form.role, department: form.department, email: form.email })
        if (user.isGlobalAdmin && form.password) body.password = form.password
        await api.put(`/users/${editingId}`, body)
        closeForm()
        load()
        return
      }
      const { projectId, positionKey, ...account } = form
      const res = await api.post('/users', account)
      const newUser = res.data.user
      const notes = []
      let projectName = ''
      let positionName = ''
      const pos = positions.find((p) => p.id === positionKey)
      try {
        if (pos?.type === 'head_office') {
          await api.put(`/positions/head-office/${pos.id}`, { userId: newUser.id })
          positionName = `${pos.name} (Head Office)`
        } else if (pos && projectId) {
          await api.put(`/positions/projects/${projectId}/${pos.id}`, { userId: newUser.id })
          positionName = pos.name
          projectName = projects.find((p) => p.id === projectId)?.name || ''
        } else if (projectId) {
          await api.put(`/projects/${projectId}/assignments`, { userId: newUser.id, action: 'add' })
          projectName = projects.find((p) => p.id === projectId)?.name || ''
        }
      } catch (err) {
        notes.push(`The account was created, but the assignment failed: ${err.response?.data?.error || 'try again from the project team'}.`)
      }
      setCreated({ user: newUser, password: form.password, projectName, positionName, notes })
      closeForm()
      load()
    } catch (err) {
      setError(err.response?.data?.error || (editingId ? 'Could not save the changes' : 'Could not create user'))
    } finally {
      setSaving(false)
    }
  }

  async function remove(id) {
    if (!confirm('Remove this user?')) return
    await api.delete(`/users/${id}`)
    load()
  }

  return (
    <Layout title={user.role === 'admin' ? 'Users' : 'My Team'} subtitle="Manage people and their department access">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {deptFilter && (
            <span className="rounded-full bg-brand-50 dark:bg-brand-500/15 px-3 py-1 text-xs font-semibold text-brand-700 dark:text-brand-300">
              Filtered: {deptName(deptFilter)}
              <button className="ml-2" onClick={() => setParams({})}>
                <X size={12} className="inline" />
              </button>
            </span>
          )}
        </div>
        <button
          onClick={openNew}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          <Plus size={15} /> Add User
        </button>
      </div>

      <ScrollHint />
      <div className="overflow-x-auto surface shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800 text-xs font-semibold uppercase text-slate-400">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Department</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {visible.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-700 dark:text-slate-200">{u.name}</div>
                  <div className="text-xs text-slate-400">{u.title}</div>
                </td>
                <td className="px-4 py-3 text-slate-500">{deptName(u.department)}</td>
                <td className="px-4 py-3"><Badge value={u.role} /></td>
                <td className="px-4 py-3 text-slate-500">
                  <div>{u.email}</div>
                  <div className="text-xs text-slate-400">{u.phone}</div>
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => openEdit(u)} title="Edit user" aria-label="Edit user" className="mr-2 text-slate-300 dark:text-slate-600 hover:text-brand-600">
                    <Pencil size={15} />
                  </button>
                  {user.role === 'admin' && u.id !== user.id && (
                    <button onClick={() => remove(u.id)} title="Remove user" aria-label="Remove user"  className="text-slate-300 dark:text-slate-600 hover:text-rose-500">
                      <Trash2 size={15} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">No users found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {created && (
        <Modal onClose={() => setCreated(null)} title="User created">
          <div className="space-y-3 text-sm">
            <p className="flex items-center gap-2 font-semibold text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 size={16} /> {created.user.name} can now sign in
            </p>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 p-3 text-xs">
              <dt className="text-slate-400">Email</dt><dd className="break-all text-right font-medium text-slate-700 dark:text-slate-200">{created.user.email}</dd>
              <dt className="text-slate-400">Temporary password</dt><dd className="break-all text-right font-mono font-medium text-slate-700 dark:text-slate-200">{created.password}</dd>
              <dt className="text-slate-400">Role</dt><dd className="text-right text-slate-700 dark:text-slate-200">{ROLE_INFO[created.user.role]?.label}</dd>
              <dt className="text-slate-400">Department</dt><dd className="text-right text-slate-700 dark:text-slate-200">{deptName(created.user.department)}</dd>
              {created.projectName && (<><dt className="text-slate-400">Project</dt><dd className="text-right text-slate-700 dark:text-slate-200">{created.projectName}</dd></>)}
              {created.positionName && (<><dt className="text-slate-400">Position</dt><dd className="text-right text-slate-700 dark:text-slate-200">{created.positionName}</dd></>)}
            </dl>
            <p className="text-xs text-slate-500">They will land on the {ROLE_INFO[created.user.role]?.lands}.</p>
            {created.notes.map((n) => <p key={n} className="text-xs font-medium text-amber-600 dark:text-amber-400">{n}</p>)}
            <div className="flex gap-2">
              <button
                onClick={() => navigator.clipboard?.writeText(`Matisan HR sign-in\nEmail: ${created.user.email}\nTemporary password: ${created.password}`)}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Copy size={13} /> Copy sign-in details
              </button>
              <button onClick={() => setCreated(null)} className="flex-1 rounded-lg bg-brand-600 py-2 text-xs font-semibold text-white hover:bg-brand-700">Done</button>
            </div>
          </div>
        </Modal>
      )}

      {showForm && (
        <Modal onClose={closeForm} title={editingId ? 'Edit User' : 'Add User'}>
          <form onSubmit={submit} className="space-y-3">
            <Field label="Full name">
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" />
            </Field>
            <Field label="Email (used to sign in)">
              <input required type="email" disabled={!!editingId && !user.isGlobalAdmin} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input" />
            </Field>
            {(!editingId || user.isGlobalAdmin) && (
              <Field label={editingId ? 'Reset password (leave empty to keep the current one)' : 'Temporary password (min 8 characters)'}>
                <div className="flex gap-2">
                  <input
                    required={!editingId}
                    minLength={editingId && !form.password ? undefined : 8}
                    type={showPw ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    className="input min-w-0 flex-1"
                  />
                  <button type="button" onClick={() => setShowPw((v) => !v)} title={showPw ? 'Hide' : 'Show'} className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800">
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                  <button type="button" onClick={() => { setForm({ ...form, password: makePassword() }); setShowPw(true) }} title="Generate a password" className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800">
                    <Wand2 size={15} />
                  </button>
                </div>
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Role">
                <select disabled={!!editingId && !user.isGlobalAdmin} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="input">
                  <option value="employee">Employee</option>
                  <option value="supervisor">Supervisor</option>
                  {user.isGlobalAdmin && <option value="finance">Finance</option>}
                  {user.isGlobalAdmin && <option value="admin">Admin</option>}
                </select>
              </Field>
              <Field label="Department">
                <select
                  required
                  disabled={!user.isGlobalAdmin}
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value, projectId: '' })}
                  className="input"
                >
                  <option value="">Select...</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </Field>
            </div>
            <p className="rounded-lg bg-brand-50 dark:bg-brand-500/10 px-3 py-2 text-xs text-brand-700 dark:text-brand-300">
              Signs in to the {ROLE_INFO[form.role]?.lands}{form.department ? ` (${deptName(form.department)})` : ''}.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Job title">
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="input" />
              </Field>
              <Field label="Phone">
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="input" />
              </Field>
            </div>
            {!editingId && (
              <div className="space-y-3 border-t border-slate-100 dark:border-slate-800 pt-3">
                <p className="text-xs font-semibold text-slate-500">Assignment (optional, can be done later)</p>
                <Field label="Project">
                  <select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} className="input" disabled={!form.department}>
                    <option value="">{form.department ? 'No project yet' : 'Pick a department first'}</option>
                    {deptProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
                {user.isGlobalAdmin && (
                  <Field label="Position">
                    <select value={form.positionKey} onChange={(e) => setForm({ ...form, positionKey: e.target.value })} className="input">
                      <option value="">No position yet</option>
                      <optgroup label="Project site (needs a project above)">
                        {sitePositions.map((p) => <option key={p.id} value={p.id} disabled={!form.projectId}>{p.name}</option>)}
                      </optgroup>
                      <optgroup label="Head Office">
                        {headPositions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </optgroup>
                    </select>
                  </Field>
                )}
              </div>
            )}
            {error && <p className="text-sm font-medium text-rose-600 dark:text-rose-400">{error}</p>}
            <button type="submit" disabled={saving} className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
              {saving ? 'Saving...' : editingId ? 'Save changes' : 'Create User'}
            </button>
          </form>
        </Modal>
      )}
    </Layout>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-500">{label}</span>
      {children}
    </label>
  )
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white dark:bg-slate-900 p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
