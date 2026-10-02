import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, X, Trash2 } from 'lucide-react'
import Layout from '../components/Layout'
import Badge from '../components/Badge'
import ScrollHint from '../components/ScrollHint'
import api from '../api'
import { useAuth } from '../context/AuthContext'

const emptyForm = { name: '', email: '', password: '', role: 'employee', department: '', title: '', phone: '' }

export default function Users() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [users, setUsers] = useState([])
  const [departments, setDepartments] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')
  const deptFilter = params.get('department') || ''

  async function load() {
    const [u, d] = await Promise.all([api.get('/users'), api.get('/departments')])
    setUsers(u.data.users)
    setDepartments(d.data.departments)
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    if (!user.isGlobalAdmin) setForm((f) => ({ ...f, department: user.department }))
  }, [user])

  const visible = deptFilter ? users.filter((u) => u.department === deptFilter) : users
  const deptName = (id) => departments.find((d) => d.id === id)?.name || id

  async function submit(e) {
    e.preventDefault()
    setError('')
    try {
      await api.post('/users', form)
      setForm({ ...emptyForm, department: user.isGlobalAdmin ? '' : user.department })
      setShowForm(false)
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create user')
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
          onClick={() => setShowForm(true)}
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
                  {user.role === 'admin' && u.id !== user.id && (
                    <button onClick={() => remove(u.id)} className="text-slate-300 dark:text-slate-600 hover:text-rose-500">
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

      {showForm && (
        <Modal onClose={() => setShowForm(false)} title="Add User">
          <form onSubmit={submit} className="space-y-3">
            <Field label="Full name">
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" />
            </Field>
            <Field label="Email">
              <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input" />
            </Field>
            <Field label="Temporary password">
              <input required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="input" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Role">
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="input">
                  <option value="employee">Employee</option>
                  <option value="supervisor">Supervisor</option>
                  {user.isGlobalAdmin && <option value="finance">Finance</option>}
                  {user.isGlobalAdmin && <option value="admin">Admin</option>}
                </select>
              </Field>
              <Field label="Department">
                <select
                  disabled={!user.isGlobalAdmin}
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value })}
                  className="input"
                >
                  <option value="">Select...</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Job title">
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="input" />
            </Field>
            <Field label="Phone">
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="input" />
            </Field>
            {error && <p className="text-sm font-medium text-rose-600 dark:text-rose-400">{error}</p>}
            <button type="submit" className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">
              Create User
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
