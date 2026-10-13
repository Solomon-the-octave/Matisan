import { useEffect, useState } from 'react'
import { Download, Loader2, PackageOpen } from 'lucide-react'
import api from '../api'

// One Excel file with everything about a project, for audits.
export default function ProjectExport() {
  const [projects, setProjects] = useState([])
  const [projectId, setProjectId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/projects').then((r) => setProjects(r.data.projects)).catch(() => {})
  }, [])

  async function download() {
    setBusy(true)
    setError('')
    try {
      const res = await api.get(`/project-export/${projectId}`, { params: { from: from || undefined, to: to || undefined }, responseType: 'blob' })
      const name = projects.find((p) => p.id === projectId)?.name || 'project'
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `${name.replace(/[^a-z0-9]+/gi, '-')}-audit-export.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      let msg = 'Could not create the export'
      try { msg = JSON.parse(await e.response.data.text()).error || msg } catch { /* keep default */ }
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="no-print mt-6 surface p-5 shadow-sm">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200"><PackageOpen size={16} className="text-brand-600" /> Full project export for audits</h3>
      <p className="mb-3 text-xs text-slate-400">One Excel file with the project details, workers, daily attendance, weekly payroll, payments and the full approval trail.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <label className="text-[11px] font-medium text-slate-500 sm:col-span-2">Project
          <select className="input mt-0.5" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Choose a project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="text-[11px] font-medium text-slate-500">From (optional)
          <input type="date" className="input mt-0.5" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-[11px] font-medium text-slate-500">To (optional)
          <input type="date" className="input mt-0.5" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button onClick={download} disabled={!projectId || busy} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Download Excel file
        </button>
        {error && <span className="text-xs font-medium text-rose-600">{error}</span>}
      </div>
    </div>
  )
}
