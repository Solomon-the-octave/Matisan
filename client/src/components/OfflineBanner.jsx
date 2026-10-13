import { WifiOff, UploadCloud, Loader2, X } from 'lucide-react'
import { clearRejected } from '../offline'

// Tells the field team where their attendance stands when there is no
// signal: what is saved on the phone, what uploaded, and anything refused.
export default function OfflineBanner({ state, notice }) {
  const { online, busy, pending, rejected, syncNow } = state
  if (online && !pending && !rejected.length && !notice) return null
  return (
    <div className="no-print mb-4 space-y-2">
      {!online && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
          <WifiOff size={16} className="mt-0.5 shrink-0" />
          <div>
            <b>No signal.</b> Keep recording attendance. Each change is saved on this phone and uploads by itself when the signal returns. Registering a new worker needs signal.
          </div>
        </div>
      )}
      {pending > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-brand-50 dark:bg-brand-500/10 p-3 text-sm text-brand-800 dark:text-brand-200">
          <span><b>{pending}</b> {pending === 1 ? 'change is' : 'changes are'} saved on this phone and not uploaded yet.</span>
          {online && (
            <button onClick={syncNow} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <UploadCloud size={13} />} Upload now
            </button>
          )}
        </div>
      )}
      {notice && <div className="rounded-lg bg-emerald-50 dark:bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-300">{notice}</div>}
      {rejected.length > 0 && (
        <div className="rounded-lg bg-rose-50 dark:bg-rose-500/10 p-3 text-sm text-rose-800 dark:text-rose-300">
          <div className="flex items-start justify-between gap-2">
            <b>{rejected.length} {rejected.length === 1 ? 'change was' : 'changes were'} not accepted</b>
            <button onClick={clearRejected} className="shrink-0" title="Dismiss"><X size={14} /></button>
          </div>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {rejected.slice(0, 8).map((r) => <li key={r.cid}>{r.workerName || r.workerId}, {r.date}: {r.error}</li>)}
          </ul>
          <div className="mt-1 text-xs">Tell your supervisor so the day can be corrected.</div>
        </div>
      )}
    </div>
  )
}
