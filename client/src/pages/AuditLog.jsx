import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import Layout from '../components/Layout'
import api from '../api'

const TYPES = [['', 'Everything'], ['user', 'Users'], ['position', 'Positions'], ['worker', 'Workers and rates'], ['project', 'Projects']]
const stamp = (d) => new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const csvCell = (v) => {
  let t = String(v ?? '')
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t
  return `"${t.replace(/"/g, '""')}"`
}

export default function AuditLog() {
  const [entries, setEntries] = useState(null)
  const [type, setType] = useState('')
  const [q, setQ] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const t = setTimeout(() => {
      api.get('/audit', { params: { entityType: type || undefined, q: q || undefined } })
        .then((r) => { setEntries(r.data.entries); setError('') })
        .catch((e) => setError(e.response?.data?.error || 'Could not load the audit log'))
    }, 250)
    return () => clearTimeout(t)
  }, [type, q])

  function download() {
    const lines = [['When', 'Who', 'What', 'Type'].map(csvCell).join(',')]
    for (const e of entries || []) lines.push([stamp(e.createdAt), e.actorName, e.summary, e.entityType].map(csvCell).join(','))
    const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'audit-log.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Layout title="Audit log" subtitle="Who changed a rate, a position, a user or a project, and when">
      <div className="no-print mb-3 flex flex-wrap items-center gap-2">
        <select value={type} onChange={(e) => setType(e.target.value)} className="input !w-auto">
          {TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a name or change" className="input !w-auto min-w-[14rem] flex-1" />
        <button onClick={download} disabled={!entries?.length} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"><Download size={13} /> Download list</button>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {entries && entries.length === 0 && <p className="text-sm text-slate-400">Nothing recorded yet. Changes made from now on appear here.</p>}
      <ul className="surface divide-y divide-slate-100 dark:divide-slate-800">
        {(entries || []).map((e) => (
          <li key={e.id} className="px-4 py-2.5 text-sm">
            <div className="text-slate-700 dark:text-slate-200">{e.summary}</div>
            <div className="text-xs text-slate-400">{e.actorName || 'Unknown'} · {stamp(e.createdAt)}</div>
          </li>
        ))}
      </ul>
    </Layout>
  )
}
