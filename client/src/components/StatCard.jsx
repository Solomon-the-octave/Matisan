// All stat icons share one neutral treatment — the number carries the
// meaning, not a rainbow of icon-chip colors. `accent="brand"` is the only
// exception, reserved for a single headline metric per page if needed.
export default function StatCard({ label, value, icon: Icon, accent = 'neutral', actionLabel, onAction }) {
  const accents = {
    neutral: 'bg-slate-100 text-slate-500',
    brand: 'bg-brand-50 text-brand-600',
  }
  return (
    <div className="surface p-4 transition hover:shadow-md">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
          <div className="mt-1 text-2xl font-bold text-slate-800">{value}</div>
        </div>
        {Icon && (
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${accents[accent] || accents.neutral}`}>
            <Icon size={18} strokeWidth={2.25} />
          </div>
        )}
      </div>
      {actionLabel && (
        <button onClick={onAction} className="mt-3 text-xs font-semibold text-brand-600 hover:underline">
          {actionLabel} &rarr;
        </button>
      )}
    </div>
  )
}
