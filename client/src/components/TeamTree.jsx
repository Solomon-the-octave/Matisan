import { User } from 'lucide-react'

// Simple card tree for the paper "Site Structure" / "Head Office Structure".
// Each card is a POSITION; the person in it can be changed without touching
// the position. Pass `onAssign` to let an admin pick people from `users`.
function initials(name) {
  return name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
}

function PositionCard({ node, users, onAssign }) {
  return (
    <div className="surface flex flex-col gap-2 p-3 shadow-sm">
      <div className="flex items-center gap-2.5">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
            node.userName ? 'bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-300' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'
          }`}
        >
          {node.userName ? initials(node.userName) : <User size={15} />}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[11px] font-semibold text-slate-400">{node.name}</div>
          <div className={`truncate text-sm font-semibold ${node.userName ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400 italic font-normal'}`}>
            {node.userName || 'Not assigned'}
          </div>
        </div>
      </div>
      {onAssign && (
        <select
          aria-label={`Assign ${node.name}`}
          value={node.userId || ''}
          onChange={(e) => onAssign(node.id, e.target.value || null)}
          className="input !py-1 text-xs"
        >
          <option value="">Not assigned</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          {node.userId && !users.some((u) => u.id === node.userId) && <option value={node.userId}>{node.userName}</option>}
        </select>
      )}
    </div>
  )
}

const COLS = { 2: 'md:grid-cols-2', 3: 'md:grid-cols-3' }

function Branch({ node, byParent, depth, users, onAssign, stacked }) {
  const kids = byParent[node.id] || []
  // Wide columns only for the first two levels; deeper levels stack with an
  // indent line so the tree stays readable on a phone.
  const wide = !stacked && depth <= 1 && kids.length > 1
  const chain = depth === 0 && kids.length === 1 // General Manager -> Deputy
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <PositionCard node={node} users={users} onAssign={onAssign} />
      {kids.length > 0 && (
        <div
          className={
            wide
              ? `grid grid-cols-1 gap-3 ${COLS[Math.min(kids.length, 3)]}`
              : chain
                ? 'flex flex-col gap-3'
                : 'ml-4 flex flex-col gap-3 border-l-2 border-slate-200 dark:border-slate-700 pl-3'
          }
        >
          {kids.map((k) => (
            <Branch key={k.id} node={k} byParent={byParent} depth={depth + 1} users={users} onAssign={onAssign} stacked={stacked} />
          ))}
        </div>
      )}
    </div>
  )
}

// `stacked` keeps everything in one column — for narrow places like a card.
export default function TeamTree({ nodes, users = [], onAssign, stacked = false }) {
  const byParent = {}
  nodes.forEach((n) => {
    const key = n.parentId || '__root__'
    ;(byParent[key] ||= []).push(n)
  })
  const roots = byParent.__root__ || []
  return (
    <div className="flex flex-col gap-3">
      {roots.map((r) => (
        <Branch key={r.id} node={r} byParent={byParent} depth={0} users={users} onAssign={onAssign} stacked={stacked} />
      ))}
    </div>
  )
}
