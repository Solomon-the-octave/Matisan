import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { HardHat, Briefcase, Building2, AlertCircle } from 'lucide-react'
import api from '../api'
import { useAuth } from '../context/AuthContext'

// The adaptive part of /dashboard: who you are on the company structure
// (position + project) and, for people who work on a project, today's site
// attendance at a glance. Role + position + project decide what shows up.
// Renders nothing when the person has no seat or project, so admin and
// finance dashboards stay as they were.

const SUBMISSION_LABEL = {
  submitted: { text: 'Handed in', cls: 'text-amber-600 dark:text-amber-400' },
  acknowledged: { text: 'Acknowledged', cls: 'text-emerald-600 dark:text-emerald-400' },
  returned: { text: 'Returned', cls: 'text-rose-600 dark:text-rose-400' },
}
const submissionLabel = (status) => SUBMISSION_LABEL[status] || { text: 'Not handed in', cls: 'text-slate-500 dark:text-slate-400' }

function Stat({ label, value }) {
  return (
    <div className="rounded-lg bg-slate-50 dark:bg-slate-800 px-3 py-2">
      <div className="text-lg font-bold text-slate-800 dark:text-slate-100">{value}</div>
      <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{label}</div>
    </div>
  )
}

export default function WorkplacePanel() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [ctx, setCtx] = useState(null)

  useEffect(() => {
    api
      .get('/dashboard-context')
      .then((res) => setCtx(res.data))
      .catch(() => setCtx(null))
  }, [])

  if (!ctx) return null
  const { seats, headOffice, projects } = ctx
  if (seats.length === 0 && headOffice.length === 0 && projects.length === 0) return null

  const isEmployee = user.role === 'employee'

  return (
    <div className="mb-6 space-y-3">
      {(seats.length > 0 || headOffice.length > 0) && (
        <div className="surface p-4 shadow-sm">
          <div className="mb-2 text-xs font-semibold text-slate-400">My position</div>
          <div className="flex flex-wrap gap-2">
            {seats.map((s) => (
              <span key={`${s.projectId}-${s.positionId}`} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-50 dark:bg-brand-500/15 px-3 py-1.5 text-sm font-semibold text-brand-700 dark:text-brand-300">
                <Briefcase size={14} /> {s.positionName}
                <span className="font-normal text-brand-600/80 dark:text-brand-300/70">· {s.projectName}</span>
              </span>
            ))}
            {headOffice.map((s) => (
              <span key={s.positionId} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-50 dark:bg-brand-500/15 px-3 py-1.5 text-sm font-semibold text-brand-700 dark:text-brand-300">
                <Building2 size={14} /> {s.positionName}
                <span className="font-normal text-brand-600/80 dark:text-brand-300/70">· Head Office</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {projects.map((p) => {
        const daily = submissionLabel(p.dailyStatus)
        const weekly = submissionLabel(p.weeklyStatus)
        return (
          <div key={p.projectId} className="surface p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-sm font-bold text-slate-800 dark:text-slate-100">{p.projectName}</div>
                <div className="text-xs text-slate-400">
                  {p.positions.length ? p.positions.join(', ') : 'Project team'} · today's site attendance
                </div>
              </div>
              {p.returned > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 dark:bg-rose-500/15 px-2.5 py-1 text-xs font-semibold text-rose-700 dark:text-rose-300">
                  <AlertCircle size={12} /> {p.returned} returned
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Workers registered" value={p.registered} />
              <Stat label="Present AM" value={p.presentAM} />
              <Stat label="Present PM" value={p.presentPM} />
              <Stat label="Absent" value={p.absent} />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5 text-xs">
                <div className="text-slate-500 dark:text-slate-400">Today's sheet: <span className={`font-semibold ${daily.cls}`}>{daily.text}</span></div>
                <div className="text-slate-500 dark:text-slate-400">This week: <span className={`font-semibold ${weekly.cls}`}>{weekly.text}</span></div>
              </div>
              {user.role !== 'finance' && (
              <button
                onClick={() => navigate('/field-attendance')}
                className={`inline-flex min-h-[44px] items-center gap-2 rounded-lg px-4 text-sm font-semibold ${
                  isEmployee
                    ? 'bg-brand-600 text-white hover:bg-brand-700'
                    : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <HardHat size={15} /> {isEmployee ? 'Open Field Attendance' : 'View Field Attendance'}
              </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
