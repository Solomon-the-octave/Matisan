import { useEffect, useRef, useState } from 'react'
import api from './api'
import { getStoredUser } from './authStorage'

// Offline attendance. When there is no signal the field team keeps recording:
// each change is saved on the phone (in the browser's local storage, so it
// survives closing the page) and uploaded as soon as the signal returns.
// Screens also keep working from the last data they loaded.

const Q = 'matisan.offline.queue.'
const REJ = 'matisan.offline.rejected.'
const listeners = new Set()

const uid = () => getStoredUser()?.id || null
const read = (key) => { try { return JSON.parse(localStorage.getItem(key) || '[]') } catch { return [] } }
const write = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* storage full or blocked */ } }
const emit = () => listeners.forEach((fn) => { try { fn() } catch { /* ignore */ } })

export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
export const pendingEntries = () => (uid() ? read(Q + uid()) : [])
export const pendingCount = () => pendingEntries().length
export const rejectedEntries = () => (uid() ? read(REJ + uid()) : [])
export const clearRejected = () => { if (uid()) { write(REJ + uid(), []); emit() } }

// A failed request that never reached the server (no signal, server asleep).
export function isNetworkError(err) {
  if (!err) return false
  if (!err.response) return true
  return [502, 503, 504].includes(err.response.status)
}

// Keep one entry per worker and day: the latest state wins.
export function enqueue(entry) {
  const id = uid()
  if (!id) return null
  const q = read(Q + id)
  const next = { ...entry, cid: entry.cid || `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, recordedAt: new Date().toISOString() }
  const i = q.findIndex((x) => x.workerId === next.workerId && x.date === next.date)
  if (i >= 0) q[i] = { ...q[i], ...next, cid: q[i].cid }
  else q.push(next)
  write(Q + id, q)
  emit()
  return next
}

let syncing = false
export async function syncQueue() {
  const id = uid()
  if (!id || syncing) return { sent: 0, applied: 0, rejected: 0 }
  const q = read(Q + id)
  if (!q.length) return { sent: 0, applied: 0, rejected: 0 }
  syncing = true
  try {
    const res = await api.post('/worker-attendance/sync', { entries: q.map(({ workerName, ...e }) => e) })
    const done = new Map(res.data.results.map((r) => [r.cid, r]))
    const rejected = []
    const left = []
    for (const e of q) {
      const r = done.get(e.cid)
      if (!r) left.push(e)
      else if (r.status === 'rejected') rejected.push({ ...e, error: r.error })
    }
    write(Q + id, left)
    if (rejected.length) write(REJ + id, [...read(REJ + id), ...rejected])
    emit()
    return { sent: q.length, applied: res.data.results.filter((r) => r.status === 'applied').length, rejected: rejected.length }
  } catch (err) {
    if (!isNetworkError(err)) emit()
    return { sent: 0, applied: 0, rejected: 0, failed: true }
  } finally {
    syncing = false
  }
}

// Upload by itself whenever the signal comes back or the app is opened, and
// retry every half minute while something is waiting.
export function startAutoSync() {
  const tick = () => { if (navigator.onLine && pendingCount()) syncQueue() }
  window.addEventListener('online', tick)
  setInterval(tick, 30000)
  tick()
}

// --- last-known data for screens, used when there is no signal -------------
const CACHE = 'matisan.offline.cache.'
const CACHED = ['/projects', '/workers', '/worker-attendance', '/worker-attendance/payroll', '/payroll-periods', '/attendance-submissions']
export const cacheable = (url) => CACHED.some((p) => url === p || url.startsWith(p + '?'))
export const cacheKey = (config) => `${CACHE}${uid()}.${config.url}?${JSON.stringify(config.params || {})}`

export function cachePut(config, data) {
  if (!uid()) return
  // Photos are large; the cache keeps names and numbers only.
  const slim = JSON.parse(JSON.stringify(data, (k, v) => (k === 'photo' ? undefined : v)))
  try { localStorage.setItem(cacheKey(config), JSON.stringify({ at: Date.now(), data: slim })) } catch { /* storage full */ }
}
export function cacheGet(config) {
  try { return JSON.parse(localStorage.getItem(cacheKey(config)) || 'null') } catch { return null }
}

// --- React hook behind the banner ------------------------------------------
export function useOfflineState(onSynced) {
  const [, tick] = useState(0)
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [busy, setBusy] = useState(false)
  const prev = useRef(pendingCount())
  const callback = useRef(onSynced)
  callback.current = onSynced
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    const un = subscribe(() => tick((n) => n + 1))
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); un() }
  }, [])
  async function syncNow() {
    setBusy(true)
    await syncQueue()
    setBusy(false)
  }
  // When the phone is back online, upload what is waiting.
  useEffect(() => {
    if (online && pendingCount()) syncNow()
  }, [online])
  // When the waiting list empties (uploaded or refused), refresh the screen.
  const pending = pendingCount()
  useEffect(() => {
    if (prev.current > 0 && pending === 0) callback.current?.({ applied: prev.current - rejectedEntries().length, rejected: rejectedEntries().length })
    prev.current = pending
  }, [pending])
  return { online, busy, pending, rejected: rejectedEntries(), syncNow }
}
