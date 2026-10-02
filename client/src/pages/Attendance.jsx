import { useEffect, useState } from 'react'
import { CheckCircle2, Clock } from 'lucide-react'
import Layout from '../components/Layout'
import Badge from '../components/Badge'
import ScrollHint from '../components/ScrollHint'
import api from '../api'
import { useAuth } from '../context/AuthContext'

export default function Attendance() {
  const { user } = useAuth()
  const [records, setRecords] = useState([])
  const [users, setUsers] = useState([])
  const [busy, setBusy] = useState(false)
  const canApprove = user.role === 'admin' || user.role === 'supervisor'

  async function load() {
    const calls = [api.get('/attendance')]
    if (canApprove) calls.push(api.get('/users'))
    const [a, u] = await Promise.all(calls)
    setRecords(a.data.attendance.slice().reverse())
    if (u) setUsers(u.data.users)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const userName = (id) => users.find((u) => u.id === id)?.name || (id === user.id ? user.name : id)
  const today = new Date().toISOString().slice(0, 10)
  const mine = records.find((r) => r.userId === user.id && r.date === today)

  async function checkIn() {
    setBusy(true)
    try {
      await api.post('/attendance/check-in')
      load()
    } catch (e) {
      alert(e.response?.data?.error || 'Could not check in')
    } finally {
      setBusy(false)
    }
  }

  async function checkOut() {
    setBusy(true)
    try {
      await api.post('/attendance/check-out')
      load()
    } catch (e) {
      alert(e.response?.data?.error || 'Could not check out')
    } finally {
      setBusy(false)
    }
  }

  async function approve(id) {
    await api.put(`/attendance/${id}/approve`)
    load()
  }

  return (
    <Layout title="Attendance" subtitle="Clock in and out, and review field attendance">
      <div className="mb-6 flex flex-col items-start justify-between gap-4 surface p-5 shadow-sm sm:flex-row sm:items-center">
        <div>
          <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Today's status</p>
          <p className="text-xs text-slate-400">
            {mine ? (mine.checkOut ? `Checked out at ${new Date(mine.checkOut).toLocaleTimeString()}` : `Checked in at ${new Date(mine.checkIn).toLocaleTimeString()}`) : 'Not checked in yet'}
          </p>
        </div>
        {!mine && (
          <button onClick={checkIn} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
            <Clock size={15} /> Check In
          </button>
        )}
        {mine && !mine.checkOut && (
          <button onClick={checkOut} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-slate-800 dark:bg-slate-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-900 dark:hover:bg-slate-500 disabled:opacity-60">
            <Clock size={15} /> Check Out
          </button>
        )}
        {mine && mine.checkOut && (
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
            <CheckCircle2 size={16} /> Complete ({mine.hours}h)
          </span>
        )}
      </div>

      <ScrollHint />
      <div className="overflow-x-auto surface shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800 text-xs font-semibold uppercase text-slate-400">
            <tr>
              {canApprove && <th className="px-4 py-3">Employee</th>}
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Check In</th>
              <th className="px-4 py-3">Check Out</th>
              <th className="px-4 py-3">Hours</th>
              <th className="px-4 py-3">Status</th>
              {canApprove && <th className="px-4 py-3"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {records.map((r) => (
              <tr key={r.id}>
                {canApprove && <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-200">{userName(r.userId)}</td>}
                <td className="px-4 py-3 text-slate-500">{r.date}</td>
                <td className="px-4 py-3 text-slate-500">{new Date(r.checkIn).toLocaleTimeString()}</td>
                <td className="px-4 py-3 text-slate-500">{r.checkOut ? new Date(r.checkOut).toLocaleTimeString() : '-'}</td>
                <td className="px-4 py-3 text-slate-500">{r.hours || '-'}</td>
                <td className="px-4 py-3"><Badge value={r.status} /></td>
                {canApprove && (
                  <td className="px-4 py-3 text-right">
                    {r.status === 'pending' && (
                      <button onClick={() => approve(r.id)} className="text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline">Approve</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {records.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">No attendance records yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Layout>
  )
}
