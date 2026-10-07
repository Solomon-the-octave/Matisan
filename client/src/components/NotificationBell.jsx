import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCheck } from 'lucide-react'
import api from '../api'

const ago = (d) => {
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  if (m < 1440) return `${Math.floor(m / 60)} h ago`
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// The bell in the top bar: unread count, a list of the latest items, click
// to open what it's about. Refreshes every minute and when the menu opens.
export default function NotificationBell() {
  const navigate = useNavigate()
  const [data, setData] = useState({ items: [], unread: 0 })
  const [open, setOpen] = useState(false)
  const box = useRef(null)

  const load = useCallback(async () => {
    try {
      const res = await api.get('/notifications')
      setData(res.data)
    } catch {
      /* keep what we have */
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    if (!open) return
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  async function openItem(n) {
    setOpen(false)
    if (!n.readAt) {
      await api.put(`/notifications/${n.id}/read`).catch(() => {})
      load()
    }
    if (n.link) navigate(n.link)
  }

  async function readAll() {
    await api.put('/notifications/read-all').catch(() => {})
    load()
  }

  return (
    <div className="relative" ref={box}>
      <button
        onClick={() => { setOpen((v) => !v); if (!open) load() }}
        aria-label={`Notifications${data.unread ? `, ${data.unread} unread` : ''}`}
        className="relative rounded-full p-2 text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-300"
      >
        <Bell size={18} />
        {data.unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {data.unread > 9 ? '9+' : data.unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-4 py-2.5">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Notifications</span>
            {data.unread > 0 && (
              <button onClick={readAll} className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 dark:text-brand-300">
                <CheckCheck size={12} /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {data.items.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">You're all caught up.</p>}
            {data.items.map((n) => (
              <button
                key={n.id}
                onClick={() => openItem(n)}
                className={`block w-full border-b border-slate-50 dark:border-slate-800 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800 ${n.readAt ? '' : 'bg-brand-50/50 dark:bg-brand-500/10'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className={`text-sm ${n.readAt ? 'font-medium text-slate-600 dark:text-slate-300' : 'font-bold text-slate-800 dark:text-slate-100'}`}>{n.title}</span>
                  <span className="shrink-0 text-[10px] text-slate-400">{ago(n.createdAt)}</span>
                </div>
                {n.body && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{n.body}</p>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
