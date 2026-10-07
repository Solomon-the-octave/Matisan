// Deliberately restrained palette: neutral slate for most states, brand blue
// for positive/active/approved, amber for "needs attention", rose reserved
// only for genuinely urgent/high-priority items. No rainbow of hues.
const STYLES = {
  active: 'bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-300 ring-brand-100 dark:ring-brand-500/25',
  completed: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700',
  on_hold: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700',
  created: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700',
  in_progress: 'bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-300 ring-brand-100 dark:ring-brand-500/25',
  submitted: 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 ring-amber-100 dark:ring-amber-500/25',
  finance_checked: 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 ring-amber-100 dark:ring-amber-500/25',
  in_review: 'bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-300 ring-brand-100 dark:ring-brand-500/25',
  paid: 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 ring-emerald-100 dark:ring-emerald-500/25',
  approved: 'bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-300 ring-brand-100 dark:ring-brand-500/25',
  acknowledged: 'bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-300 ring-brand-100 dark:ring-brand-500/25',
  returned: 'bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 ring-rose-100 dark:ring-rose-500/25',
  pending: 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 ring-amber-100 dark:ring-amber-500/25',
  high: 'bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 ring-rose-100 dark:ring-rose-500/25',
  medium: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700',
  low: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700',
  admin: 'bg-slate-800 dark:bg-slate-600 text-white ring-slate-800 dark:ring-slate-300',
  supervisor: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700',
  employee: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700',
  finance: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700',
}

export default function Badge({ value, children }) {
  const cls = STYLES[value] || 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700'
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase ring-1 ring-inset ${cls}`}>
      {children || String(value).replace('_', ' ')}
    </span>
  )
}
