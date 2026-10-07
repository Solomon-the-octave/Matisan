import { useEffect, useRef, useState } from 'react'
import { Plus, X, MapPin, UserCog, FileText, Upload, Download, Trash2, Loader2, Network, Pencil } from 'lucide-react'
import Layout from '../components/Layout'
import Badge from '../components/Badge'
import TeamTree from '../components/TeamTree'
import api from '../api'
import { useAuth } from '../context/AuthContext'

const today = () => new Date().toISOString().slice(0, 10)
const emptyForm = { name: '', projectNumber: '', site: '', client: '', contractor: '', consultant: '', department: '', description: '', managerId: '', priority: 'medium', startDate: today(), endDate: '' }
const PRIORITY_STYLE = {
  high: 'bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300',
  medium: 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300',
  low: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300',
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export default function Projects() {
  const { user } = useAuth()
  const [projects, setProjects] = useState([])
  const [departments, setDepartments] = useState([])
  const [users, setUsers] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null) // project being edited in the form (null = creating)
  const [form, setForm] = useState(emptyForm)
  const [assignFor, setAssignFor] = useState(null) // project being edited in the assign panel
  const [docsFor, setDocsFor] = useState(null) // project whose documents panel is open
  const [teamFor, setTeamFor] = useState(null) // project whose Project Team tree is open
  const [teamByProject, setTeamByProject] = useState({})
  const [docsByProject, setDocsByProject] = useState({})
  const [uploadingFor, setUploadingFor] = useState(null)
  const [pendingFiles, setPendingFiles] = useState([])
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const fileInputs = useRef({})
  const canManage = user.role === 'admin' || user.role === 'supervisor'
  const canUploadDocs = canManage

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

  async function toggleTeam(projectId) {
    if (teamFor === projectId) {
      setTeamFor(null)
      return
    }
    setTeamFor(projectId)
    const res = await api.get(`/positions/projects/${projectId}`)
    setTeamByProject((t) => ({ ...t, [projectId]: res.data.team }))
  }

  async function assignPosition(projectId, positionId, userId) {
    try {
      const res = await api.put(`/positions/projects/${projectId}/${positionId}`, { userId })
      setTeamByProject((t) => ({ ...t, [projectId]: res.data.team }))
      load()
    } catch (err) {
      alert(err.response?.data?.error || 'Could not assign that position')
    }
  }

  async function loadDocuments(projectId) {
    const res = await api.get(`/projects/${projectId}/documents`)
    setDocsByProject((d) => ({ ...d, [projectId]: res.data.documents }))
  }

  async function toggleDocs(projectId) {
    if (docsFor === projectId) {
      setDocsFor(null)
      return
    }
    setDocsFor(projectId)
    if (!docsByProject[projectId]) await loadDocuments(projectId)
  }

  async function uploadDocument(projectId, file) {
    if (!file) return
    const formData = new FormData()
    formData.append('file', file)
    setUploadingFor(projectId)
    try {
      await api.post(`/projects/${projectId}/documents`, formData)
      await loadDocuments(projectId)
    } catch (err) {
      alert(err.response?.data?.error || 'Upload failed')
    } finally {
      setUploadingFor(null)
      if (fileInputs.current[projectId]) fileInputs.current[projectId].value = ''
    }
  }

  async function deleteDocument(projectId, docId) {
    await api.delete(`/projects/${projectId}/documents/${docId}`)
    loadDocuments(projectId)
  }

  async function downloadDocument(projectId, doc) {
    const res = await api.get(`/projects/${projectId}/documents/${doc.id}`, { responseType: 'blob' })
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = doc.filename
    a.click()
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    if (!user.isGlobalAdmin) setForm((f) => ({ ...f, department: user.department }))
  }, [user])

  const deptName = (id) => departments.find((d) => d.id === id)?.name || id
  const userName = (id) => users.find((u) => u.id === id)?.name
  const managersFor = (dept) => users.filter((u) => ['supervisor', 'admin'].includes(u.role) && (u.isGlobalAdmin || u.department === dept))

  function openNew() {
    setEditingId(null)
    setForm({ ...emptyForm, department: user.isGlobalAdmin ? '' : user.department })
    setPendingFiles([])
    setFormError('')
    setShowForm(true)
  }

  function openEdit(p) {
    setEditingId(p.id)
    setForm({
      name: p.name || '', projectNumber: p.projectNumber || '', site: p.site || '', client: p.client || '',
      contractor: p.contractor || '', consultant: p.consultant || '', department: p.department,
      description: p.description || '', managerId: p.managerId || '', priority: p.priority || 'medium',
      startDate: p.startDate || today(), endDate: p.endDate || '',
    })
    setPendingFiles([])
    setFormError('')
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
    setFormError('')
  }

  async function removeProject(p) {
    if (!confirm(`Delete "${p.name}"? Its tasks, documents and team assignments will be removed. This cannot be undone.`)) return
    try {
      await api.delete(`/projects/${p.id}`)
      await load()
    } catch (err) {
      alert(err.response?.data?.error || 'Could not delete the project')
    }
  }

  async function submit(e) {
    e.preventDefault()
    setFormError('')
    setSaving(true)
    try {
      if (editingId) {
        const { department, ...rest } = form
        await api.put(`/projects/${editingId}`, { ...rest, managerId: form.managerId || undefined, endDate: form.endDate || undefined })
        closeForm()
        await load()
        return
      }
      const payload = { ...form, managerId: form.managerId || undefined, endDate: form.endDate || undefined }
      const res = await api.post('/projects', payload)
      const failed = []
      for (const file of pendingFiles) {
        const fd = new FormData()
        fd.append('file', file)
        try {
          await api.post(`/projects/${res.data.project.id}/documents`, fd)
        } catch {
          failed.push(file.name)
        }
      }
      setForm({ ...emptyForm, department: user.isGlobalAdmin ? '' : user.department })
      setPendingFiles([])
      setShowForm(false)
      await load()
      if (failed.length) alert(`Project created, but these files didn't upload: ${failed.join(', ')}. Add them from the Documents panel.`)
    } catch (err) {
      setFormError(err.response?.data?.error || (editingId ? 'Could not save the changes' : 'Could not create the project'))
    } finally {
      setSaving(false)
    }
  }

  async function changeManager(id, managerId) {
    try {
      await api.put(`/projects/${id}`, { managerId })
      load()
    } catch (err) {
      alert(err.response?.data?.error || 'Could not change the responsible person')
    }
  }

  function addPendingFiles(fileList) {
    // Copy out of the live FileList first — the input is cleared right after.
    const files = [...fileList]
    const tooBig = files.filter((f) => f.size > 15 * 1024 * 1024)
    if (tooBig.length) alert(`Too large (15MB max): ${tooBig.map((f) => f.name).join(', ')}`)
    setPendingFiles((cur) => [...cur, ...files.filter((f) => f.size <= 15 * 1024 * 1024)])
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
          <button onClick={openNew} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
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
              <div className="flex shrink-0 flex-col items-end gap-1">
                <div className="flex items-center gap-1">
                  {canManage && (
                    <button onClick={() => openEdit(p)} title="Edit project" aria-label="Edit project" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-brand-600">
                      <Pencil size={14} />
                    </button>
                  )}
                  {user.role === 'admin' && (
                    <button onClick={() => removeProject(p)} title="Delete project" aria-label="Delete project" className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 hover:text-rose-600">
                      <Trash2 size={14} />
                    </button>
                  )}
                  <Badge value={p.status} />
                </div>
                {p.priority && (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${PRIORITY_STYLE[p.priority] || PRIORITY_STYLE.medium}`}>
                    {p.priority} priority
                  </span>
                )}
              </div>
            </div>
            <p className="mt-3 text-sm text-slate-500">{p.description}</p>
            <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 text-xs">
              {p.projectNumber && (<><dt className="text-slate-400">Project no.</dt><dd className="text-right text-slate-600 dark:text-slate-300">{p.projectNumber}</dd></>)}
              {p.client && (<><dt className="text-slate-400">Client</dt><dd className="text-right text-slate-600 dark:text-slate-300">{p.client}</dd></>)}
              {p.contractor && (<><dt className="text-slate-400">Contractor</dt><dd className="text-right text-slate-600 dark:text-slate-300">{p.contractor}</dd></>)}
              {p.consultant && (<><dt className="text-slate-400">Consultant</dt><dd className="text-right text-slate-600 dark:text-slate-300">{p.consultant}</dd></>)}
              <dt className="text-slate-400">Starts</dt>
              <dd className="text-right text-slate-600 dark:text-slate-300">{p.startDate || '-'}</dd>
              <dt className="text-slate-400">Planned finish</dt>
              <dd className="text-right text-slate-600 dark:text-slate-300">{p.endDate || '-'}</dd>
              <dt className="text-slate-400">Project manager</dt>
              <dd className="flex min-w-0 justify-end text-right text-slate-600 dark:text-slate-300">
                {canManage ? (
                  <select
                    value={p.managerId || ''}
                    onChange={(e) => changeManager(p.id, e.target.value)}
                    className="input !w-auto max-w-full !py-0.5 text-xs"
                  >
                    {!managersFor(p.department).some((u) => u.id === p.managerId) && <option value={p.managerId || ''}>{userName(p.managerId) || 'Unassigned'}</option>}
                    {managersFor(p.department).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                ) : (
                  p.managerName || '-'
                )}
              </dd>
            </dl>
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

            <div className="mt-3 border-t border-slate-100 dark:border-slate-800 pt-3">
              <button
                onClick={() => toggleTeam(p.id)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:text-brand-700"
              >
                <Network size={13} /> Project team
              </button>
              {teamFor === p.id && teamByProject[p.id] && (
                <div className="mt-3">
                  <TeamTree
                    stacked
                    nodes={teamByProject[p.id]}
                    users={users.filter((u) => u.department === p.department || u.role === 'admin')}
                    onAssign={user.role === 'admin' ? (positionId, userId) => assignPosition(p.id, positionId, userId) : undefined}
                  />
                </div>
              )}
            </div>

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

            {(canManage || p.assignedEmployees?.includes(user.id)) && (
              <div className="mt-3 border-t border-slate-100 dark:border-slate-800 pt-3">
                <button
                  onClick={() => toggleDocs(p.id)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:text-brand-700"
                >
                  <FileText size={13} /> Documents {docsByProject[p.id] ? `(${docsByProject[p.id].length})` : ''}
                </button>
                {docsFor === p.id && (
                  <div className="mt-2 space-y-1.5">
                    {(docsByProject[p.id] || []).map((doc) => (
                      <div key={doc.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-800">
                        <button
                          onClick={() => downloadDocument(p.id, doc)}
                          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-slate-600 dark:text-slate-300 hover:text-brand-600 dark:hover:text-brand-400"
                          title={`Download ${doc.filename}`}
                        >
                          <Download size={12} className="shrink-0" />
                          <span className="truncate">{doc.filename}</span>
                          <span className="shrink-0 text-slate-400">{formatBytes(doc.size)}</span>
                        </button>
                        {canUploadDocs && (
                          <button
                            onClick={() => deleteDocument(p.id, doc.id)}
                            className="shrink-0 text-slate-300 hover:text-rose-500 dark:text-slate-600 dark:hover:text-rose-400"
                            title="Delete document"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    ))}
                    {docsByProject[p.id]?.length === 0 && (
                      <p className="px-2 py-1 text-xs text-slate-400">No documents uploaded yet.</p>
                    )}
                    {canUploadDocs && (
                      <label className="mt-1 flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-slate-200 dark:border-slate-700 px-2 py-2 text-xs font-medium text-slate-500 dark:text-slate-400 hover:border-brand-300 dark:hover:border-brand-500/40 hover:text-brand-600 dark:hover:text-brand-400">
                        {uploadingFor === p.id ? (
                          <><Loader2 size={13} className="animate-spin" /> Uploading...</>
                        ) : (
                          <><Upload size={13} /> Upload document</>
                        )}
                        <input
                          ref={(el) => (fileInputs.current[p.id] = el)}
                          type="file"
                          className="hidden"
                          disabled={uploadingFor === p.id}
                          onChange={(e) => uploadDocument(p.id, e.target.files[0])}
                        />
                      </label>
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
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white dark:bg-slate-900 p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">{editingId ? 'Edit Project' : 'New Project'}</h3>
              <button onClick={closeForm} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <input required placeholder="Project name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input sm:col-span-2" />
                <input placeholder="Project no." value={form.projectNumber} onChange={(e) => setForm({ ...form, projectNumber: e.target.value })} className="input" />
              </div>
              <input placeholder="Site / location" value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })} className="input" />
              <input placeholder="Client" value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} className="input" />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input placeholder="Contractor" value={form.contractor} onChange={(e) => setForm({ ...form, contractor: e.target.value })} className="input" />
                <input placeholder="Consultant" value={form.consultant} onChange={(e) => setForm({ ...form, consultant: e.target.value })} className="input" />
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-500">Department</span>
                <select
                  required
                  disabled={!user.isGlobalAdmin}
                  value={form.department}
                  disabled={!!editingId}
                  onChange={(e) => setForm({ ...form, department: e.target.value, managerId: '' })}
                  className="input"
                >
                  <option value="">Select department...</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-500">Project manager</span>
                <select
                  value={form.managerId}
                  disabled={!form.department}
                  onChange={(e) => setForm({ ...form, managerId: e.target.value })}
                  className="input"
                >
                  <option value="">{form.department ? `Me (${user.name})` : 'Pick a department first'}</option>
                  {managersFor(form.department).filter((u) => u.id !== user.id).map((u) => (
                    <option key={u.id} value={u.id}>{u.name} — {u.role}</option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-500">Priority</span>
                  <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="input">
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-500">Start date</span>
                  <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="input" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-500">Planned finish</span>
                  <input type="date" min={form.startDate} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="input" />
                </label>
              </div>
              <textarea placeholder="Description, scope, notes" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input" rows={3} />

              {!editingId && (
              <div>
                <span className="mb-1 block text-xs font-semibold text-slate-500">Attachments (permits, drawings, scope — 15MB each)</span>
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

              )}

              {formError && <p className="text-sm font-medium text-rose-600 dark:text-rose-400">{formError}</p>}
              <button type="submit" disabled={saving} className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                {saving ? (editingId ? 'Saving...' : 'Creating...') : (editingId ? 'Save changes' : 'Create Project')}
              </button>
            </form>
          </div>
        </div>
      )}
    </Layout>
  )
}
