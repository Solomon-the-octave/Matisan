export default function Logo({ compact = false }) {
  return (
    <div className="flex items-center gap-2">
      <img src="/logo-icon.png" alt="Matisan" className="h-9 w-auto shrink-0" />
      {!compact && (
        <div className="leading-tight">
          <div className="text-sm font-extrabold tracking-wide text-brand-700 dark:text-brand-300">MATISAN</div>
          <div className="text-[10px] font-medium text-slate-400">Engineering Private Ltd Co.</div>
        </div>
      )}
    </div>
  )
}
