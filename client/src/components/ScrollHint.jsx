import { ArrowLeftRight } from 'lucide-react'

// A table that's wider than the screen scrolls horizontally rather than
// getting clipped, but that's not obvious on a touchscreen without some
// sign there's more off to the side — especially on a phone/tablet where
// this is the main device, not an occasional fallback. Shown up through
// tablet widths (lg:hidden); desktop windows are normally wide enough that
// nothing scrolls, so the hint would be dead weight there.
export default function ScrollHint({ children = 'Swipe sideways to see the rest of the table' }) {
  return (
    <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-400 lg:hidden">
      <ArrowLeftRight size={12} /> {children}
    </p>
  )
}
