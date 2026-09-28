import { useState } from 'react'
import Layout from '../components/Layout'
import api from '../api'
import { useAuth } from '../context/AuthContext'

export default function Profile() {
  const { user } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setError('')
    setMessage('')
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword })
      setMessage('Password updated successfully')
      setCurrentPassword('')
      setNewPassword('')
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update password')
    }
  }

  return (
    <Layout title="Profile" subtitle="Your account details">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="surface p-5 shadow-sm">
          <h3 className="mb-4 text-sm font-bold text-slate-700">Account Details</h3>
          <dl className="space-y-3 text-sm">
            <Row label="Name" value={user.name} />
            <Row label="Email" value={user.email} />
            <Row label="Role" value={user.role} />
            <Row label="Title" value={user.title || '-'} />
            <Row label="Phone" value={user.phone || '-'} />
          </dl>
        </div>

        <div className="surface p-5 shadow-sm">
          <h3 className="mb-4 text-sm font-bold text-slate-700">Change Password</h3>
          <form onSubmit={submit} className="space-y-3">
            <input type="password" required placeholder="Current password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="input" />
            <input type="password" required placeholder="New password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="input" />
            {error && <p className="text-sm font-medium text-rose-600">{error}</p>}
            {message && <p className="text-sm font-medium text-emerald-600">{message}</p>}
            <button type="submit" className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">Update Password</button>
          </form>
        </div>
      </div>
    </Layout>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between border-b border-slate-50 pb-2">
      <dt className="text-slate-400">{label}</dt>
      <dd className="font-medium capitalize text-slate-700">{value}</dd>
    </div>
  )
}
