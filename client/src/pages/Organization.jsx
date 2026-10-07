import { useEffect, useState } from 'react'
import Layout from '../components/Layout'
import TeamTree from '../components/TeamTree'
import api from '../api'
import { useAuth } from '../context/AuthContext'

// The paper "Head Office Structure" as a card tree. Admin picks who sits in
// each seat; everyone else just sees the chart.
export default function Organization() {
  const { user } = useAuth()
  const [nodes, setNodes] = useState([])
  const [users, setUsers] = useState([])
  const [error, setError] = useState('')
  const isAdmin = user.role === 'admin'

  async function load() {
    const calls = [api.get('/positions'), api.get('/positions/head-office')]
    if (isAdmin) calls.push(api.get('/users'))
    const [p, a, u] = await Promise.all(calls)
    const byPos = new Map(a.data.assignments.map((x) => [x.positionId, x]))
    setNodes(
      p.data.positions
        .filter((x) => x.type === 'head_office')
        .map((x) => ({ ...x, userId: byPos.get(x.id)?.userId || null, userName: byPos.get(x.id)?.userName || null }))
    )
    if (u) setUsers(u.data.users)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function assign(positionId, userId) {
    setError('')
    try {
      await api.put(`/positions/head-office/${positionId}`, { userId })
      await load()
    } catch (e) {
      setError(e.response?.data?.error || 'Could not assign that position')
    }
  }

  return (
    <Layout title="Head Office" subtitle="Who holds each position at head office">
      {error && <p className="mb-3 text-sm font-medium text-rose-600 dark:text-rose-400">{error}</p>}
      {isAdmin && (
        <p className="mb-4 text-xs text-slate-400">
          Pick a person for each position. The position stays when the person changes. Project teams are set inside each project.
        </p>
      )}
      <TeamTree nodes={nodes} users={users} onAssign={isAdmin ? assign : undefined} />
    </Layout>
  )
}
