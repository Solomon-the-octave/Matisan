// Deliberately restrained palette: neutral slate for most states, brand blue
// for positive/active/approved, amber for "needs attention", rose reserved
// only for genuinely urgent/high-priority items. No rainbow of hues.
const STYLES = {
  active: 'bg-brand-50 text-brand-700 ring-brand-100',
  completed: 'bg-slate-100 text-slate-600 ring-slate-200',
  on_hold: 'bg-slate-100 text-slate-600 ring-slate-200',
  created: 'bg-slate-100 text-slate-600 ring-slate-200',
  in_progress: 'bg-brand-50 text-brand-700 ring-brand-100',
  submitted: 'bg-amber-50 text-amber-700 ring-amber-100',
  approved: 'bg-brand-50 text-brand-700 ring-brand-100',
  pending: 'bg-amber-50 text-amber-700 ring-amber-100',
  high: 'bg-rose-50 text-rose-700 ring-rose-100',
  medium: 'bg-slate-100 text-slate-600 ring-slate-200',
  low: 'bg-slate-100 text-slate-600 ring-slate-200',
  admin: 'bg-slate-800 text-white ring-slate-800',
  supervisor: 'bg-slate-100 text-slate-600 ring-slate-200',
  employee: 'bg-slate-100 text-slate-600 ring-slate-200',
}

export default function Badge({ value, children }) {
  const cls = STYLES[value] || 'bg-slate-100 text-slate-600 ring-slate-200'
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase ring-1 ring-inset ${cls}`}>
      {children || String(value).replace('_', ' ')}
    </span>
  )
}
