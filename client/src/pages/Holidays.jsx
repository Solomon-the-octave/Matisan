import { useEffect, useState } from 'react'
import { Trash2, Plus } from 'lucide-react'
import Layout from '../components/Layout'
import api from '../api'

const fmt = (d) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

// Company holidays. A holiday marked "paid" credits every worker who has
// attendance that week with one day, unless they worked that day.
export default function Holidays() {
  const [list, setList] = useState([])
  const [date, setDate] = useState('')
  const [name, setName] = useState('')
  const [paid, setPaid] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => api.get('/holidays').then((r) => setList(r.data.holidays))
  useEffect(() => { load() }, [])

  const add = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api.post('/holidays', { date, name, paid })
      setDate(''); setName(''); setPaid(false)
      await load()
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add the holiday')
    } finally {
      setBusy(false)
    }
  }
  const togglePaid = async (h) => { await api.put(`/holidays/${h.id}`, { paid: !h.paid }); load() }
  const remove = async (h) => {
    if (!window.confirm(`Remove ${h.name}?`)) return
    await api.delete(`/holidays/${h.id}`)
    load()
  }

  return (
    <Layout title="Holidays" subtitle="Paid holidays add one day to payroll for workers with attendance that week">
      <form onSubmit={add} className="surface mb-4 flex flex-wrap items-end gap-3 p-4">
        <label className="text-xs font-semibold text-slate-500">Date
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="input mt-1" />
        </label>
        <label className="min-w-[12rem] flex-1 text-xs font-semibold text-slate-500">Holiday name
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. New Year" className="input mt-1" />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} /> Paid
        </label>
        <button disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"><Plus size={14} /> Add</button>
        {error && <p className="w-full text-sm text-rose-600">{error}</p>}
      </form>

      <div className="surface overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800 text-xs text-slate-500">
            <tr><th className="px-4 py-2">Date</th><th className="px-4 py-2">Holiday</th><th className="px-4 py-2">Paid</th><th className="px-4 py-2" /></tr>
          </thead>
          <tbody>
            {list.map((h) => (
              <tr key={h.id} className="border-t border-slate-100 dark:border-slate-700">
                <td className="px-4 py-2">{fmt(h.date)}</td>
                <td className="px-4 py-2">{h.name}</td>
                <td className="px-4 py-2"><input type="checkbox" checked={h.paid} onChange={() => togglePaid(h)} aria-label={`${h.name} paid`} /></td>
                <td className="px-4 py-2 text-right"><button onClick={() => remove(h)} className="text-slate-400 hover:text-rose-600" aria-label={`Remove ${h.name}`}><Trash2 size={15} /></button></td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">No holidays added yet. Payroll counts attendance only.</td></tr>}
          </tbody>
        </table>
      </div>
    </Layout>
  )
}
