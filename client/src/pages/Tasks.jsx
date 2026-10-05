import { useEffect, useState } from 'react'
import { Plus, X, Paperclip, Download, Trash2, Upload, Loader2, UserRound, Building2, FolderKanban, CalendarDays } from 'lucide-react'
import Layout from '../components/Layout'
import Badge from '../components/Badge'
import api from '../api'
import { useAuth } from '../context/AuthContext'

const STATUS_FLOW = ['created', 'in_progress', 'submitted', 'approved', 'completed']
const emptyForm = { title: '', description: '', department: '', assignedTo: '', priority: 'medium', dueDate: '', projectId: '' }
const MAX_BYTES = 15 * 1024 * 1024

function formatBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export default function Tasks() {
  const { user } = useAuth()
  const [tasks, setTasks] = useState([])
  const [projects, setProjects] = useState([])
  const [users, setUsers] = useState([])
  const [departments, setDepartments] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [pendingFiles, setPendingFiles] = useState([])
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [openDocs, setOpenDocs] = useState(null)
  const [docsByTask, setDocsByTask] = useState({})
  const [uploadingFor, setUploadingFor] = useState(null)
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

  const deptName = (id) => departments.find((d) => d.id === id)?.name || id

  function addPendingFiles(fileList) {
    const files = [...fileList]
    const tooBig = files.filter((f) => f.size > MAX_BYTES)
    if (tooBig.length) alert(`Too large (15MB max): ${tooBig.map((f) => f.name).join(', ')}`)
    setPendingFiles((cur) => [...cur, ...files.filter((f) => f.size <= MAX_BYTES)])
  }

  async function submit(e) {
    e.preventDefault()
    setFormError('')
    setSaving(true)
    try {
      const res = await api.post('/tasks', { ...form, projectId: form.projectId || undefined, dueDate: form.dueDate || undefined })
      const failed = []
      for (const file of pendingFiles) {
        const fd = new FormData()
        fd.append('file', file)
        try {
          await api.post(`/tasks/${res.data.task.id}/documents`, fd)
        } catch {
          failed.push(file.name)
        }
      }
      setForm({ ...emptyForm, department: user.isGlobalAdmin ? '' : user.department })
      setPendingFiles([])
      setShowForm(false)
      await load()
      if (failed.length) alert(`Task created, but these files didn't upload: ${failed.join(', ')}. Add them from the task's attachments.`)
    } catch (err) {
      setFormError(err.response?.data?.error || 'Could not create the task')
    } finally {
      setSaving(false)
    }
  }

  async function advance(task) {
    const idx = STATUS_FLOW.indexOf(task.status)
    const next = STATUS_FLOW[Math.min(idx + 1, STATUS_FLOW.length - 1)]
    try {
      await api.put(`/tasks/${task.id}`, { status: next })
      load()
    } catch (err) {
      alert(err.response?.data?.error || 'Could not update the task')
    }
  }

  async function reassign(task, assignedTo) {
    try {
      await api.put(`/tasks/${task.id}`, { assignedTo })
      load()
    } catch (err) {
      alert(err.response?.data?.error || 'Could not reassign the task')
    }
  }

  async function loadDocs(taskId) {
    const res = await api.get(`/tasks/${taskId}/documents`)
    setDocsByTask((d) => ({ ...d, [taskId]: res.data.documents }))
  }

  async function toggleDocs(taskId) {
    if (openDocs === taskId) return setOpenDocs(null)
    setOpenDocs(taskId)
    await loadDocs(taskId)
  }

  async function uploadDoc(taskId, file) {
    if (!file) return
    if (file.size > MAX_BYTES) return alert('That file is too large (15MB max)')
    const fd = new FormData()
    fd.append('file', file)
    setUploadingFor(taskId)
    try {
      await api.post(`/tasks/${taskId}/documents`, fd)
      await loadDocs(taskId)
      load()
    } catch (err) {
      alert(err.response?.data?.error || 'Upload failed')
    } finally {
      setUploadingFor(null)
    }
  }

  async function deleteDoc(taskId, docId) {
    await api.delete(`/tasks/${taskId}/documents/${docId}`)
    await loadDocs(taskId)
    load()
  }

  async function downloadDoc(taskId, doc) {
    const res = await api.get(`/tasks/${taskId}/documents/${doc.id}`, { responseType: 'blob' })
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = doc.filename
    a.click()
    URL.revokeObjectURL(url)
  }

  function nextLabel(status) {
    const map = { created: 'Start', in_progress: 'Submit', submitted: 'Approve', approved: 'Complete' }
    return map[status]
  }

  // Assignees available when reassigning: same department as the task.
  const teamFor = (dept) => users.filter((u) => u.department === dept && u.role !== 'finance')

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
        {tasks.map((t) => {
          const isOwner = t.assignedTo === user.id
          // Employees can only start/submit their own work; supervisors and
          // admins can move it the rest of the way.
          const canAdvance = STATUS_FLOW.indexOf(t.status) < STATUS_FLOW.length - 1 &&
            (canManage || (isOwner && ['created', 'in_progress'].includes(t.status)))
          return (
            <div key={t.id} className="surface p-4 shadow-sm">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">{t.title}</h4>
                    <Badge value={t.priority} />
                  </div>
                  {t.description && <p className="mt-1 whitespace-pre-line text-sm text-slate-500">{t.description}</p>}
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                    <span className="inline-flex items-center gap-1"><Building2 size={12} /> {deptName(t.department)}</span>
                    <span className="inline-flex items-center gap-1"><FolderKanban size={12} /> {t.projectName || 'No project'}</span>
                    {t.dueDate && <span className="inline-flex items-center gap-1"><CalendarDays size={12} /> Due {t.dueDate}</span>}
                    {t.createdByName && <span>Assigned by {t.createdByName}</span>}
                  </div>
                  <div className="mt-2 flex max-w-full flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    <UserRound size={12} className="text-slate-400" /> Responsible:
                    {canManage ? (
                      <select
                        value={t.assignedTo}
                        onChange={(e) => reassign(t, e.target.value)}
                        className="input !w-auto min-w-0 max-w-[60vw] !py-0.5 text-xs"
                      >
                        {!teamFor(t.department).some((u) => u.id === t.assignedTo) && <option value={t.assignedTo}>{t.assignedToName}</option>}
                        {teamFor(t.department).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    ) : (
                      <span className="font-semibold text-slate-600 dark:text-slate-300">{t.assignedToName}</span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Badge value={t.status} />
                  {canAdvance && (
                    <button onClick={() => advance(t)} className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                      {nextLabel(t.status)}
                    </button>
                  )}
                </div>
              </div>

              {(t.attachmentCount > 0 || canManage) && (
                <div className="mt-3 border-t border-slate-100 dark:border-slate-800 pt-3">
                  <button
                    onClick={() => toggleDocs(t.id)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:text-brand-700"
                  >
                    <Paperclip size={13} /> Attachments ({t.attachmentCount})
                  </button>
                  {openDocs === t.id && (
                    <div className="mt-2 space-y-1.5">
                      {(docsByTask[t.id] || []).map((doc) => (
                        <div key={doc.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-800">
                          <button
                            onClick={() => downloadDoc(t.id, doc)}
                            className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-slate-600 dark:text-slate-300 hover:text-brand-600 dark:hover:text-brand-400"
                            title={`Download ${doc.filename}`}
                          >
                            <Download size={12} className="shrink-0" />
                            <span className="truncate">{doc.filename}</span>
                            <span className="shrink-0 text-slate-400">{formatBytes(doc.size)}</span>
                          </button>
                          {canManage && (
                            <button onClick={() => deleteDoc(t.id, doc.id)} className="shrink-0 text-slate-300 hover:text-rose-500 dark:text-slate-600 dark:hover:text-rose-400" title="Delete attachment">
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      ))}
                      {docsByTask[t.id]?.length === 0 && <p className="px-2 py-1 text-xs text-slate-400">No attachments yet.</p>}
                      {canManage && (
                        <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-slate-200 dark:border-slate-700 px-2 py-2 text-xs font-medium text-slate-500 dark:text-slate-400 hover:border-brand-300 hover:text-brand-600 dark:hover:text-brand-400">
                          {uploadingFor === t.id ? <><Loader2 size={13} className="animate-spin" /> Uploading...</> : <><Upload size={13} /> Add attachment</>}
                          <input type="file" className="hidden" disabled={uploadingFor === t.id} onChange={(e) => { uploadDoc(t.id, e.target.files[0]); e.target.value = '' }} />
                        </label>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {tasks.length === 0 && <p className="text-sm text-slate-400">No tasks assigned.</p>}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white dark:bg-slate-900 p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">New Task</h3>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <input required placeholder="Task title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="input" />
              <textarea placeholder="Details — what needs doing, where, any instructions" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input" rows={3} />
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-500">Department</span>
                <select
                  required
                  disabled={!user.isGlobalAdmin}
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value, assignedTo: '', projectId: '' })}
                  className="input"
                >
                  <option value="">Select department...</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-500">Responsible person</span>
                <select required disabled={!form.department} value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })} className="input">
                  <option value="">{form.department ? 'Select a person...' : 'Pick a department first'}</option>
                  {teamFor(form.department).map((u) => <option key={u.id} value={u.id}>{u.name} — {u.role}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-500">Project</span>
                <select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} className="input">
                  <option value="">No linked project</option>
                  {projects.filter((p) => !form.department || p.department === form.department).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-500">Priority</span>
                  <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="input">
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-500">Due date</span>
                  <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="input" />
                </label>
              </div>

              <div>
                <span className="mb-1 block text-xs font-semibold text-slate-500">Attachments (15MB each)</span>
                <div className="space-y-1">
                  {pendingFiles.map((f, idx) => (
                    <div key={`${f.name}-${idx}`} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 dark:bg-slate-800 px-2 py-1.5 text-xs">
                      <span className="truncate text-slate-600 dark:text-slate-300">{f.name}</span>
                      <span className="flex shrink-0 items-center gap-2 text-slate-400">
                        {formatBytes(f.size)}
                        <button type="button" onClick={() => setPendingFiles((cur) => cur.filter((_, i) => i !== idx))} className="hover:text-rose-500" title="Remove"><X size={13} /></button>
                      </span>
                    </div>
                  ))}
                </div>
                <label className="mt-1 flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-slate-200 dark:border-slate-700 px-2 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:border-brand-300 hover:text-brand-600 dark:hover:text-brand-400">
                  <Upload size={13} /> Attach files
                  <input type="file" multiple className="hidden" onChange={(e) => { addPendingFiles(e.target.files); e.target.value = '' }} />
                </label>
              </div>

              {formError && <p className="text-sm font-medium text-rose-600 dark:text-rose-400">{formError}</p>}
              <button type="submit" disabled={saving} className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                {saving ? 'Creating...' : 'Create Task'}
              </button>
            </form>
          </div>
        </div>
      )}
    </Layout>
  )
}
