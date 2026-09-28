import { useEffect, useMemo, useState } from 'react'
import { UserPlus, Search, Camera, X, Users, Wallet, RefreshCw } from 'lucide-react'
import Layout from '../components/Layout'
import api from '../api'
import { useAuth } from '../context/AuthContext'

const emptyNewWorker = { name: '', trade: '', phone: '', dailyRate: '', photo: '' }

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

  const today = new Date().toISOString().slice(0, 10)

  async function loadProjects() {
    const res = await api.get('/projects')
    setProjects(res.data.projects)
    if (!projectId && res.data.projects.length) setProjectId(res.data.projects[0].id)
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

  useEffect(() => {
    loadProjects()
  }, [])

  useEffect(() => {
    if (projectId) {
      loadRoster(projectId)
      loadPayroll(projectId)
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

  return (
    <Layout title="Field Attendance" subtitle="Register site workers and track who's on the ground today">
      {toast && (
        <div className="mb-4 rounded-lg bg-brand-50 px-4 py-2.5 text-sm font-semibold text-brand-700 ring-1 ring-inset ring-brand-100">
          {toast}
        </div>
      )}

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="input !w-auto min-w-[220px]">
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}{user.isGlobalAdmin ? ` — ${p.site}` : ''}</option>
            ))}
          </select>
          <button onClick={() => { loadRoster(projectId); loadPayroll(projectId) }} className="rounded-lg border border-slate-200 p-2.5 text-slate-500 hover:bg-slate-50">
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
              disabled={!projectId}
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
                <div key={r.id} className="flex items-center gap-3 surface p-3">
                  <Avatar worker={w} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800">{w.name}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{w.id}</span>
                    </div>
                    <p className="text-xs text-slate-400">{w.trade || 'Worker'}{w.phone ? ` · ${w.phone}` : ''}</p>
                  </div>
                  <span className="text-xs font-medium text-slate-400">
                    {new Date(r.registeredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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

      {tab === 'payroll' && payroll && (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <div className="surface p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Workers</div>
              <div className="mt-1 text-2xl font-bold text-slate-800">{payroll.totals.workers}</div>
            </div>
            <div className="surface p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Worker-days</div>
              <div className="mt-1 text-2xl font-bold text-slate-800">{payroll.totals.daysPresent}</div>
            </div>
            <div className="surface p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Estimated cost</div>
              <div className="mt-1 text-2xl font-bold text-slate-800">{payroll.totals.cost.toLocaleString()}</div>
            </div>
          </div>

          <div className="overflow-hidden surface">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-3">Worker</th>
                  <th className="px-4 py-3">Trade</th>
                  <th className="px-4 py-3">Daily Rate</th>
                  <th className="px-4 py-3">Days Present</th>
                  <th className="px-4 py-3">Total</th>
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
                    <td className="px-4 py-3 text-slate-500">{p.dailyRate ?? '-'}</td>
                    <td className="px-4 py-3 text-slate-500">{p.daysPresent}</td>
                    <td className="px-4 py-3 font-semibold text-slate-700">{p.total != null ? p.total.toLocaleString() : '-'}</td>
                  </tr>
                ))}
                {payroll.payroll.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">No attendance recorded yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
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
                <input placeholder="Trade / role (e.g. Mason, Laborer)" value={newWorker.trade} onChange={(e) => setNewWorker({ ...newWorker, trade: e.target.value })} className="input" />
                <input placeholder="Phone (optional)" value={newWorker.phone} onChange={(e) => setNewWorker({ ...newWorker, phone: e.target.value })} className="input" />
                <input type="number" min="0" placeholder="Daily rate (optional, for payroll)" value={newWorker.dailyRate} onChange={(e) => setNewWorker({ ...newWorker, dailyRate: e.target.value })} className="input" />

                <button type="submit" disabled={busy} className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                  {busy ? 'Registering...' : 'Generate ID & Mark Present'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </Layout>
  )
}
