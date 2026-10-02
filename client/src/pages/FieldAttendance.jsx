import { Fragment, useEffect, useMemo, useState } from 'react'
import { UserPlus, Search, Camera, X, Users, Wallet, RefreshCw, Lock, Pencil, Download } from 'lucide-react'
import Layout from '../components/Layout'
import api from '../api'
import { useAuth } from '../context/AuthContext'

// Downloads a CSV from the worker-attendance export endpoint — same numbers
// as the screen, handed over as a file a supervisor or admin can print,
// exactly like the paper sheets this whole page is modeled on.
async function downloadCsv(params, fallbackName) {
  const res = await api.get('/worker-attendance/export', { params, responseType: 'blob' })
  const disposition = res.headers['content-disposition'] || ''
  const match = disposition.match(/filename="([^"]+)"/)
  const filename = match ? match[1] : fallbackName
  const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// Monday-Sunday week containing today — matches the payroll period window.
function currentWeekRange() {
  const date = new Date()
  const day = date.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(date)
  monday.setDate(date.getDate() + diffToMonday)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const iso = (x) => x.toISOString().slice(0, 10)
  return { weekStart: iso(monday), weekEnd: iso(sunday) }
}

const emptyNewWorker = { name: '', trade: '', phone: '', dailyRate: '', photo: '', bankAccount: '' }

// Matisan's own Skilled / Non-Skilled labor structure — the same job titles
// as the paper attendance sheets ("D.L" is the single Non-Skilled category).
const SKILLED_TITLES = [
  'Carpenter', 'Assistant Carpenter', 'Mason', 'Assistant Mason', 'Bar-bender',
  'Assistant Bar-bender', 'Chiseler', 'Mixer Operator', 'Vibrator Operator',
  'Winch Operator', 'Electrician Plumber', 'Tiller', 'Painter', 'Driller',
]
const JOB_TITLES = [
  { group: 'Non-Skilled', options: ['Day Laborer'] },
  { group: 'Skilled', options: SKILLED_TITLES },
]

// Downscale a photo client-side before it goes over the wire — a phone
// camera photo can be several MB; nobody needs more than ~480px for a
// worker ID thumbnail.
function resizeImageFile(file, maxDim = 480) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = img.width * scale
        canvas.height = img.height * scale
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.8))
      }
      img.onerror = reject
      img.src = reader.result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function Avatar({ worker, size = 40 }) {
  if (worker.photo) {
    return (
      <img
        src={worker.photo}
        alt={worker.name}
        className="shrink-0 rounded-full object-cover ring-1 ring-slate-200"
        style={{ width: size, height: size }}
      />
    )
  }
  const initials = worker.name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500 ring-1 ring-slate-200"
      style={{ width: size, height: size }}
    >
      {initials}
    </div>
  )
}

export default function FieldAttendance() {
  const { user } = useAuth()
  const [tab, setTab] = useState('roster')
  const [projects, setProjects] = useState([])
  const [projectsLoaded, setProjectsLoaded] = useState(false)
  const [projectId, setProjectId] = useState('')
  const [roster, setRoster] = useState([])
  const [workersById, setWorkersById] = useState({})
  const [payroll, setPayroll] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [mode, setMode] = useState('returning') // 'returning' | 'new'
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [newWorker, setNewWorker] = useState(emptyNewWorker)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [weekLocked, setWeekLocked] = useState(false)

  const today = new Date().toISOString().slice(0, 10)
  const { weekStart, weekEnd } = useMemo(() => currentWeekRange(), [])
  const weekDates = useMemo(() => {
    const dates = []
    const d = new Date(weekStart + 'T00:00:00')
    for (let i = 0; i < 7; i++) {
      dates.push(new Date(d.getFullYear(), d.getMonth(), d.getDate() + i).toISOString().slice(0, 10))
    }
    return dates
  }, [weekStart])
  const [gridWorkers, setGridWorkers] = useState([])
  const [gridData, setGridData] = useState({})
  const [editingWorker, setEditingWorker] = useState(null) // worker object being edited, or null
  const [editForm, setEditForm] = useState(emptyNewWorker)
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState('')

  async function loadProjects() {
    const res = await api.get('/projects')
    setProjects(res.data.projects)
    if (!projectId && res.data.projects.length) setProjectId(res.data.projects[0].id)
    setProjectsLoaded(true)
  }

  async function loadRoster(pid) {
    if (!pid) return
    const [attRes, workersRes] = await Promise.all([
      api.get('/worker-attendance', { params: { date: today, projectId: pid } }),
      api.get('/workers', { params: { projectId: pid } }),
    ])
    setRoster(attRes.data.attendance)
    const map = {}
    workersRes.data.workers.forEach((w) => (map[w.id] = w))
    // also fetch any workers on the roster that aren't tied to this project id (edge case)
    const missingIds = attRes.data.attendance.map((r) => r.workerId).filter((id) => !map[id])
    if (missingIds.length) {
      const all = await api.get('/workers')
      all.data.workers.forEach((w) => (map[w.id] = w))
    }
    setWorkersById(map)
  }

  async function loadPayroll(pid) {
    const res = await api.get('/worker-attendance/payroll', { params: pid ? { projectId: pid } : {} })
    setPayroll(res.data)
  }

  // The literal weekly grid — one row per worker, one M/A/OT box per day of
  // the week, same shape as the paper Daily Labors Attendance Sheet.
  async function loadWeekGrid(pid) {
    if (!pid) return
    const [workersRes, ...dayResults] = await Promise.all([
      api.get('/workers', { params: { projectId: pid } }),
      ...weekDates.map((d) => api.get('/worker-attendance', { params: { date: d, projectId: pid } })),
    ])
    const map = {}
    const byId = {}
    workersRes.data.workers.forEach((w) => (byId[w.id] = w))
    dayResults.forEach((res, i) => {
      const date = weekDates[i]
      res.data.attendance.forEach((rec) => {
        map[rec.workerId] = map[rec.workerId] || {}
        map[rec.workerId][date] = rec
      })
    })
    // A worker marked present this week but not formally tied to this
    // project yet (edge case) still needs to show up as a row.
    const missingIds = Object.keys(map).filter((id) => !byId[id])
    if (missingIds.length) {
      const all = await api.get('/workers')
      all.data.workers.forEach((w) => { if (!byId[w.id]) byId[w.id] = w })
    }
    setGridWorkers(Object.values(byId))
    setGridData(map)
  }

  function gridCellAction(workerId, date, patch) {
    const existing = gridData[workerId]?.[date]
    // A brand-new cell: AM/PM boxes start unmarked unless this click is the
    // one marking them; typing OT hours into a blank day assumes a full day
    // worked (same as a timekeeper writing "P P" before noting OT on paper).
    const freshBase = patch.otHours !== undefined && patch.am === undefined && patch.pm === undefined
      ? { am: true, pm: true, otHours: 0 }
      : { am: false, pm: false, otHours: 0 }
    setGridData((prev) => ({
      ...prev,
      [workerId]: { ...prev[workerId], [date]: { ...(existing || freshBase), ...patch } },
    })) // optimistic
    const run = existing
      ? api.put(`/worker-attendance/${existing.id}`, patch)
      : api.post('/worker-attendance', { workerId, projectId, date, ...freshBase, ...patch })
    run
      .then((res) => {
        setGridData((prev) => ({ ...prev, [workerId]: { ...prev[workerId], [date]: res.data.attendance } }))
        loadPayroll(projectId)
      })
      .catch((e) => {
        setError(e.response?.data?.error || 'Could not update attendance')
        loadWeekGrid(projectId) // roll back
      })
  }

  async function loadPeriodStatus(pid) {
    if (!pid) return
    const res = await api.get('/payroll-periods', { params: { projectId: pid, status: 'approved' } })
    const current = res.data.periods.find((p) => p.weekStart === weekStart && p.weekEnd === weekEnd)
    setWeekLocked(!!current)
  }

  useEffect(() => {
    loadProjects()
  }, [])

  useEffect(() => {
    if (projectId) {
      loadRoster(projectId)
      loadPayroll(projectId)
      loadPeriodStatus(projectId)
      loadWeekGrid(projectId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    if (!query.trim()) {
      setSearchResults([])
      return
    }
    const t = setTimeout(async () => {
      const res = await api.get('/workers', { params: { q: query } })
      setSearchResults(res.data.workers)
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  const currentProject = useMemo(() => projects.find((p) => p.id === projectId), [projects, projectId])

  function openModal(initialMode) {
    setMode(initialMode)
    setQuery('')
    setSearchResults([])
    setNewWorker({ ...emptyNewWorker, department: currentProject?.department || user.department })
    setError('')
    setShowModal(true)
  }

  async function updateAttendance(recordId, patch) {
    setRoster((prev) => prev.map((r) => (r.id === recordId ? { ...r, ...patch } : r))) // optimistic
    try {
      await api.put(`/worker-attendance/${recordId}`, patch)
      loadPayroll(projectId)
    } catch (e) {
      setError(e.response?.data?.error || 'Could not update attendance')
      loadRoster(projectId) // roll back the optimistic change
    }
  }

  async function registerExisting(workerId) {
    setBusy(true)
    setError('')
    try {
      const res = await api.post('/worker-attendance', { workerId, projectId })
      setToast(res.data.alreadyRegistered ? `${workerId} was already marked present today` : `${workerId} marked present`)
      setShowModal(false)
      loadRoster(projectId)
    } catch (e) {
      setError(e.response?.data?.error || 'Could not register attendance')
    } finally {
      setBusy(false)
    }
  }

  async function handlePhotoChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const dataUrl = await resizeImageFile(file)
    setNewWorker((w) => ({ ...w, photo: dataUrl }))
  }

  async function submitNewWorker(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const department = currentProject?.department || user.department
      const createRes = await api.post('/workers', {
        name: newWorker.name,
        trade: newWorker.trade,
        phone: newWorker.phone,
        photo: newWorker.photo || null,
        dailyRate: newWorker.dailyRate || null,
        bankAccount: newWorker.bankAccount || null,
        department,
        projectId,
      })
      const worker = createRes.data.worker
      await api.post('/worker-attendance', { workerId: worker.id, projectId })
      setToast(`${worker.name} registered as ${worker.id} and marked present`)
      setShowModal(false)
      loadRoster(projectId)
      loadPayroll(projectId)
    } catch (e) {
      setError(e.response?.data?.error || 'Could not register worker')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 4000)
    return () => clearTimeout(t)
  }, [toast])

  // Open the edit panel for an already-registered worker — same fields as
  // registration, but for correcting a trade, phone, rate, or bank account
  // after the fact, exactly like crossing out and rewriting a line on the
  // paper roster.
  function openEditWorker(w) {
    setEditingWorker(w)
    setEditForm({
      name: w.name || '',
      trade: w.trade || '',
      phone: w.phone || '',
      dailyRate: w.dailyRate ?? '',
      bankAccount: w.bankAccount || '',
      photo: w.photo || '',
    })
    setEditError('')
    setEditBusy(false)
  }

  async function submitEditWorker(e) {
    e.preventDefault()
    if (!editingWorker) return
    setEditBusy(true)
    setEditError('')
    try {
      await api.put(`/workers/${editingWorker.id}`, {
        name: editForm.name,
        trade: editForm.trade,
        phone: editForm.phone,
        dailyRate: editForm.dailyRate === '' ? null : editForm.dailyRate,
        bankAccount: editForm.bankAccount || null,
        photo: editForm.photo || null,
      })
      setToast(`${editForm.name} updated`)
      setEditingWorker(null)
      loadRoster(projectId)
      loadPayroll(projectId)
      loadWeekGrid(projectId)
    } catch (e2) {
      setEditError(e2.response?.data?.error || 'Could not update worker')
    } finally {
      setEditBusy(false)
    }
  }

  return (
    <Layout title="Field Attendance" subtitle="Register site workers and track who's on the ground today">
      {toast && (
        <div className="mb-4 rounded-lg bg-brand-50 px-4 py-2.5 text-sm font-semibold text-brand-700 ring-1 ring-inset ring-brand-100">
          {toast}
        </div>
      )}

      {weekLocked && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-600 ring-1 ring-inset ring-slate-200">
          <Lock size={14} /> This week has been approved and is locked — attendance can't be changed. Ask an admin to reopen it if something needs fixing.
        </div>
      )}

      {projectsLoaded && projects.length === 0 ? (
        <div className="surface flex flex-col items-center justify-center py-16 text-center">
          <Users className="mb-2 text-slate-300" size={28} />
          <p className="text-sm font-medium text-slate-500">You're not assigned to a project yet</p>
          <p className="max-w-xs text-xs text-slate-400">Ask your supervisor to assign you to a site — it'll show up here as soon as they do.</p>
        </div>
      ) : (
      <>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="input !w-auto min-w-[220px]">
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}{user.isGlobalAdmin ? ` — ${p.site}` : ''}</option>
            ))}
          </select>
          <button onClick={() => { loadRoster(projectId); loadPayroll(projectId); loadWeekGrid(projectId) }} className="rounded-lg border border-slate-200 p-2.5 text-slate-500 hover:bg-slate-50">
            <RefreshCw size={15} />
          </button>
        </div>
        <div className="flex rounded-lg border border-slate-200 p-1 text-sm font-semibold">
          <button
            onClick={() => setTab('roster')}
            className={`rounded-md px-3 py-1.5 ${tab === 'roster' ? 'bg-brand-600 text-white' : 'text-slate-500'}`}
          >
            Today's Roster
          </button>
          <button
            onClick={() => setTab('grid')}
            className={`rounded-md px-3 py-1.5 ${tab === 'grid' ? 'bg-brand-600 text-white' : 'text-slate-500'}`}
          >
            Weekly Sheet
          </button>
          <button
            onClick={() => setTab('payroll')}
            className={`rounded-md px-3 py-1.5 ${tab === 'payroll' ? 'bg-brand-600 text-white' : 'text-slate-500'}`}
          >
            Payroll
          </button>
        </div>
      </div>

      {tab === 'roster' && (
        <>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-slate-500">
              <span className="font-semibold text-slate-700">{roster.length}</span> worker{roster.length === 1 ? '' : 's'} registered today
              {currentProject ? ` on ${currentProject.name}` : ''}
            </p>
            <button
              onClick={() => openModal('returning')}
              disabled={!projectId || weekLocked}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              <UserPlus size={16} /> Register Worker
            </button>
          </div>

          <div className="space-y-2">
            {roster.map((r) => {
              const w = workersById[r.workerId]
              if (!w) return null
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-3 surface p-3">
                  <Avatar worker={w} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800">{w.name}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{w.id}</span>
                    </div>
                    <p className="text-xs text-slate-400">{w.trade || 'Worker'}{w.phone ? ` · ${w.phone}` : ''}{w.bankAccount ? ` · Acct ${w.bankAccount}` : ''}</p>
                  </div>

                  <button
                    onClick={() => openEditWorker(w)}
                    title="Edit worker details"
                    className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  >
                    <Pencil size={14} />
                  </button>

                  {/* AM/PM — same two halves as the paper attendance card */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => updateAttendance(r.id, { am: !r.am })}
                      disabled={weekLocked}
                      className={`rounded-md px-2.5 py-1 text-xs font-bold disabled:opacity-60 ${r.am ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}
                      title="Morning"
                    >
                      AM
                    </button>
                    <button
                      onClick={() => updateAttendance(r.id, { pm: !r.pm })}
                      disabled={weekLocked}
                      className={`rounded-md px-2.5 py-1 text-xs font-bold disabled:opacity-60 ${r.pm ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}
                      title="Afternoon"
                    >
                      PM
                    </button>
                  </div>

                  {/* OT hours */}
                  <div className="flex items-center gap-1">
                    <label className="text-[10px] font-semibold uppercase text-slate-400">OT</label>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      disabled={weekLocked}
                      value={r.otHours || 0}
                      onChange={(e) => updateAttendance(r.id, { otHours: e.target.value })}
                      className="w-14 rounded-md border border-slate-200 px-1.5 py-1 text-xs disabled:opacity-60"
                    />
                    <span className="text-xs text-slate-400">hrs</span>
                  </div>

                  <span className="w-full text-right text-[11px] font-medium text-slate-400 sm:w-auto">
                    marked {new Date(r.registeredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              )
            })}
            {roster.length === 0 && (
              <div className="surface flex flex-col items-center justify-center py-14 text-center">
                <Users className="mb-2 text-slate-300" size={28} />
                <p className="text-sm font-medium text-slate-500">No one registered yet today</p>
                <p className="text-xs text-slate-400">Tap "Register Worker" to add the first one.</p>
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'grid' && (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-500">
              {weekStart} – {weekEnd} · tap a box to mark it, same as filling in the paper sheet by hand.
            </p>
            <button
              onClick={() => downloadCsv(
                { projectId, type: 'weekly-sheet', from: weekStart, to: weekEnd },
                `weekly-sheet-${projectId}-${weekStart}-to-${weekEnd}.csv`
              )}
              disabled={!projectId}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              <Download size={13} /> Download Weekly Sheet (CSV)
            </button>
          </div>
          <div className="overflow-x-auto surface">
            <table className="w-full border-collapse text-center text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th rowSpan={2} className="sticky left-0 z-10 border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left">No.</th>
                  <th rowSpan={2} className="sticky left-8 z-10 border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left">Name</th>
                  <th rowSpan={2} className="border-b border-r border-slate-200 px-3 py-2 text-left">Job Title</th>
                  {weekDates.map((d) => (
                    <th key={d} colSpan={3} className="border-b border-r border-slate-200 px-2 py-1.5 font-semibold">
                      {new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}
                    </th>
                  ))}
                  <th rowSpan={2} className="border-b border-r border-slate-200 px-3 py-2">Total<br />Days</th>
                  <th rowSpan={2} className="border-b border-slate-200 px-3 py-2">Total<br />OT</th>
                </tr>
                <tr>
                  {weekDates.map((d) => (
                    <Fragment key={d}>
                      <th className="border-b border-r border-slate-100 px-1.5 py-1 font-medium">M</th>
                      <th className="border-b border-r border-slate-100 px-1.5 py-1 font-medium">A</th>
                      <th className="border-b border-r border-slate-200 px-1.5 py-1 font-medium">OT</th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {gridWorkers.map((w, idx) => {
                  const days = gridData[w.id] || {}
                  const totals = weekDates.reduce(
                    (acc, d) => {
                      const r = days[d]
                      if (!r) return acc
                      acc.days += (r.am ? 0.5 : 0) + (r.pm ? 0.5 : 0)
                      acc.ot += r.otHours || 0
                      return acc
                    },
                    { days: 0, ot: 0 }
                  )
                  return (
                    <tr key={w.id} className="odd:bg-white even:bg-slate-50/50">
                      <td className="sticky left-0 z-10 border-r border-slate-200 bg-inherit px-3 py-2 text-left text-slate-400">{idx + 1}</td>
                      <td className="sticky left-8 z-10 border-r border-slate-200 bg-inherit px-3 py-2 text-left">
                        <div className="flex items-center gap-1.5">
                          <div>
                            <div className="font-semibold text-slate-700">{w.name}</div>
                            <div className="text-[10px] text-slate-400">{w.id}</div>
                          </div>
                          <button
                            onClick={() => openEditWorker(w)}
                            title="Edit worker details"
                            className="shrink-0 rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600"
                          >
                            <Pencil size={12} />
                          </button>
                        </div>
                      </td>
                      <td className="border-r border-slate-200 px-3 py-2 text-left text-slate-500">{w.trade || '-'}</td>
                      {weekDates.map((d) => {
                        const r = days[d]
                        return (
                          <Fragment key={d}>
                            <td className="border-r border-slate-100 p-1">
                              <button
                                disabled={weekLocked}
                                onClick={() => gridCellAction(w.id, d, { am: !(r?.am) })}
                                className={`h-6 w-6 rounded font-bold disabled:opacity-60 ${r?.am ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-50 text-slate-300 hover:bg-slate-100'}`}
                              >
                                {r?.am ? 'P' : ''}
                              </button>
                            </td>
                            <td className="border-r border-slate-100 p-1">
                              <button
                                disabled={weekLocked}
                                onClick={() => gridCellAction(w.id, d, { pm: !(r?.pm) })}
                                className={`h-6 w-6 rounded font-bold disabled:opacity-60 ${r?.pm ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-50 text-slate-300 hover:bg-slate-100'}`}
                              >
                                {r?.pm ? 'P' : ''}
                              </button>
                            </td>
                            <td className="border-r border-slate-200 p-1">
                              <input
                                type="number"
                                min="0"
                                step="0.5"
                                disabled={weekLocked}
                                defaultValue={r?.otHours || ''}
                                onBlur={(e) => {
                                  const val = e.target.value
                                  if (val !== '' && Number(val) !== (r?.otHours || 0)) gridCellAction(w.id, d, { otHours: val })
                                }}
                                placeholder="-"
                                className="h-6 w-10 rounded border border-slate-200 text-center disabled:opacity-60"
                              />
                            </td>
                          </Fragment>
                        )
                      })}
                      <td className="border-r border-slate-200 px-3 py-2 font-semibold text-slate-700">{totals.days}</td>
                      <td className="px-3 py-2 font-semibold text-slate-700">{totals.ot}</td>
                    </tr>
                  )
                })}
                {gridWorkers.length === 0 && (
                  <tr>
                    <td colSpan={5 + weekDates.length * 3} className="px-4 py-10 text-center text-sm text-slate-400">
                      No workers on this project yet — register one from Today's Roster first.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'payroll' && payroll && (
        <>
          <div className="mb-3 flex justify-end">
            <button
              onClick={() => downloadCsv({ projectId, type: 'payroll' }, `payroll-${projectId}.csv`)}
              disabled={!projectId}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              <Download size={13} /> Download Payroll Report (CSV)
            </button>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="surface p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Workers</div>
              <div className="mt-1 text-2xl font-bold text-slate-800">{payroll.totals.workers}</div>
            </div>
            <div className="surface p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Worker-days</div>
              <div className="mt-1 text-2xl font-bold text-slate-800">{payroll.totals.daysPresent}</div>
            </div>
            <div className="surface p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">OT hours</div>
              <div className="mt-1 text-2xl font-bold text-slate-800">{payroll.totals.otHours}</div>
            </div>
            <div className="surface p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Estimated cost</div>
              <div className="mt-1 text-2xl font-bold text-slate-800">{payroll.totals.cost.toLocaleString()}</div>
            </div>
          </div>

          {/* Skilled vs Non-Skilled — same split as Matisan's Labor Structure
              chart, broken out for headquarters cost reporting. */}
          {payroll.totals.byLaborType && (
            <div className="mb-4 grid grid-cols-2 gap-3">
              {['Skilled', 'Non-Skilled'].map((type) => {
                const b = payroll.totals.byLaborType[type]
                return (
                  <div key={type} className="surface flex items-center justify-between p-4">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{type} labor</div>
                      <div className="text-xs text-slate-400">{b.workers} worker{b.workers === 1 ? '' : 's'} · {b.daysPresent} days · {b.otHours} OT hrs</div>
                    </div>
                    <div className="text-xl font-bold text-slate-800">{b.cost.toLocaleString()}</div>
                  </div>
                )
              })}
            </div>
          )}

          <div className="overflow-hidden surface">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-3">Worker</th>
                  <th className="px-4 py-3">Trade</th>
                  <th className="px-4 py-3">Labor Type</th>
                  <th className="px-4 py-3">Daily Rate</th>
                  <th className="px-4 py-3">Days</th>
                  <th className="px-4 py-3">OT Hrs</th>
                  <th className="px-4 py-3">Total</th>
                  <th className="px-4 py-3">Account</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payroll.payroll.map((p) => (
                  <tr key={p.workerId}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-700">{p.name}</div>
                      <div className="text-xs text-slate-400">{p.workerId}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{p.trade || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${p.laborType === 'Skilled' ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500'}`}>
                        {p.laborType}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{p.dailyRate ?? '-'}</td>
                    <td className="px-4 py-3 text-slate-500">{p.daysPresent}</td>
                    <td className="px-4 py-3 text-slate-500">{p.otHours || 0}</td>
                    <td className="px-4 py-3 font-semibold text-slate-700">{p.total != null ? p.total.toLocaleString() : '-'}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">{p.bankAccount || '-'}</td>
                  </tr>
                ))}
                {payroll.payroll.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-400">No attendance recorded yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
      </>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-800">Register Worker</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>

            <div className="mb-4 flex rounded-lg border border-slate-200 p-1 text-sm font-semibold">
              <button
                onClick={() => setMode('returning')}
                className={`flex-1 rounded-md py-1.5 ${mode === 'returning' ? 'bg-brand-600 text-white' : 'text-slate-500'}`}
              >
                Returning Worker
              </button>
              <button
                onClick={() => setMode('new')}
                className={`flex-1 rounded-md py-1.5 ${mode === 'new' ? 'bg-brand-600 text-white' : 'text-slate-500'}`}
              >
                New Worker
              </button>
            </div>

            {error && <p className="mb-3 text-sm font-medium text-rose-600">{error}</p>}

            {mode === 'returning' ? (
              <div>
                <div className="relative">
                  <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by name or worker ID..."
                    className="input pl-9"
                  />
                </div>
                <div className="mt-3 max-h-72 space-y-1 overflow-y-auto">
                  {searchResults.map((w) => (
                    <button
                      key={w.id}
                      disabled={busy}
                      onClick={() => registerExisting(w.id)}
                      className="flex w-full items-center gap-3 rounded-lg border border-slate-100 p-2.5 text-left hover:border-brand-200 hover:bg-brand-50 disabled:opacity-50"
                    >
                      <Avatar worker={w} size={32} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-700">{w.name}</div>
                        <div className="text-xs text-slate-400">{w.id} · {w.trade || 'Worker'}</div>
                      </div>
                    </button>
                  ))}
                  {query && searchResults.length === 0 && (
                    <p className="py-4 text-center text-sm text-slate-400">No matching worker. Try "New Worker" instead.</p>
                  )}
                </div>
              </div>
            ) : (
              <form onSubmit={submitNewWorker} className="space-y-3">
                <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-500 hover:border-brand-300">
                  {newWorker.photo ? (
                    <img src={newWorker.photo} alt="" className="h-12 w-12 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
                      <Camera size={18} className="text-slate-400" />
                    </div>
                  )}
                  <span>{newWorker.photo ? 'Photo added — tap to retake' : 'Add photo (optional)'}</span>
                  <input type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} className="hidden" />
                </label>

                <input required placeholder="Full name" value={newWorker.name} onChange={(e) => setNewWorker({ ...newWorker, name: e.target.value })} className="input" />
                <select required value={newWorker.trade} onChange={(e) => setNewWorker({ ...newWorker, trade: e.target.value })} className="input">
                  <option value="">Job title...</option>
                  {JOB_TITLES.map((g) => (
                    <optgroup key={g.group} label={g.group}>
                      {g.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                    </optgroup>
                  ))}
                </select>
                <input placeholder="Phone (optional)" value={newWorker.phone} onChange={(e) => setNewWorker({ ...newWorker, phone: e.target.value })} className="input" />
                <input type="number" min="0" placeholder="Daily rate (optional, for payroll)" value={newWorker.dailyRate} onChange={(e) => setNewWorker({ ...newWorker, dailyRate: e.target.value })} className="input" />
                <input placeholder="Bank account number (optional, for payment)" value={newWorker.bankAccount} onChange={(e) => setNewWorker({ ...newWorker, bankAccount: e.target.value })} className="input" />

                <button type="submit" disabled={busy} className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                  {busy ? 'Registering...' : 'Generate ID & Mark Present'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {editingWorker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-800">Edit Worker</h3>
                <p className="text-xs text-slate-400">{editingWorker.id}</p>
              </div>
              <button onClick={() => setEditingWorker(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>

            {editError && <p className="mb-3 text-sm font-medium text-rose-600">{editError}</p>}

            <form onSubmit={submitEditWorker} className="space-y-3">
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-500 hover:border-brand-300">
                {editForm.photo ? (
                  <img src={editForm.photo} alt="" className="h-12 w-12 rounded-full object-cover" />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
                    <Camera size={18} className="text-slate-400" />
                  </div>
                )}
                <span>{editForm.photo ? 'Photo added — tap to retake' : 'Add photo (optional)'}</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    const dataUrl = await resizeImageFile(file)
                    setEditForm((f) => ({ ...f, photo: dataUrl }))
                  }}
                />
              </label>

              <input required placeholder="Full name" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="input" />
              <select required value={editForm.trade} onChange={(e) => setEditForm({ ...editForm, trade: e.target.value })} className="input">
                <option value="">Job title...</option>
                {JOB_TITLES.map((g) => (
                  <optgroup key={g.group} label={g.group}>
                    {g.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                  </optgroup>
                ))}
              </select>
              <input placeholder="Phone (optional)" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} className="input" />
              <input type="number" min="0" placeholder="Daily rate (optional, for payroll)" value={editForm.dailyRate} onChange={(e) => setEditForm({ ...editForm, dailyRate: e.target.value })} className="input" />
              <div>
                <label className="mb-1 flex items-center gap-1 text-xs font-semibold text-slate-500"><Wallet size={12} /> Bank account</label>
                <input placeholder="Bank account number (for payment)" value={editForm.bankAccount} onChange={(e) => setEditForm({ ...editForm, bankAccount: e.target.value })} className="input" />
              </div>

              <button type="submit" disabled={editBusy} className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                {editBusy ? 'Saving...' : 'Save Changes'}
              </button>
            </form>
          </div>
        </div>
      )}
    </Layout>
  )
}
