import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Building2, Users, FolderKanban, ListChecks,
  CalendarCheck, FileBarChart, UserCircle, LogOut, Bell, Menu, X, HardHat, ClipboardCheck,
  Sun, Moon, Network, ShieldCheck,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import api from '../api'
import NotificationBell from './NotificationBell'
import Logo from './Logo'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'

const NAV = {
  admin: [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/departments', label: 'Departments', icon: Building2 },
    { to: '/users', label: 'Users', icon: Users },
    { to: '/projects', label: 'Projects', icon: FolderKanban },
    { to: '/tasks', label: 'Tasks', icon: ListChecks },
    { to: '/attendance', label: 'Attendance', icon: CalendarCheck },
    { to: '/field-attendance', label: 'Field Attendance', icon: HardHat },
    { to: '/approvals', label: 'Approvals', icon: ShieldCheck },
    { to: '/payroll-review', label: 'Payroll Review', icon: ClipboardCheck },
    { to: '/reports', label: 'Reports', icon: FileBarChart },
    { to: '/organization', label: 'Head Office', icon: Network },
  ],
  supervisor: [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/projects', label: 'Projects', icon: FolderKanban },
    { to: '/tasks', label: 'Tasks', icon: ListChecks },
    { to: '/attendance', label: 'Attendance', icon: CalendarCheck },
    { to: '/field-attendance', label: 'Field Attendance', icon: HardHat },
    { to: '/approvals', label: 'Approvals', icon: ShieldCheck },
    { to: '/payroll-review', label: 'Payroll Review', icon: ClipboardCheck },
    { to: '/users', label: 'My Team', icon: Users },
    { to: '/reports', label: 'Reports', icon: FileBarChart },
    { to: '/organization', label: 'Head Office', icon: Network },
  ],
  employee: [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/projects', label: 'My Project', icon: FolderKanban },
    { to: '/attendance', label: 'Check In', icon: CalendarCheck },
    { to: '/field-attendance', label: 'Field Attendance', icon: HardHat },
    { to: '/tasks', label: 'My Tasks', icon: ListChecks },
    { to: '/profile', label: 'Profile', icon: UserCircle },
  ],
  finance: [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/approvals', label: 'Approvals', icon: ShieldCheck },
    { to: '/payroll-review', label: 'Payroll Review', icon: ClipboardCheck },
    { to: '/reports', label: 'Reports', icon: FileBarChart },
    { to: '/organization', label: 'Head Office', icon: Network },
    { to: '/profile', label: 'Profile', icon: UserCircle },
  ],
}

const ROLE_LABEL = { admin: 'System Administrator', supervisor: 'Supervisor', employee: 'Employee', finance: 'Finance' }

export default function Layout({ children, title, subtitle }) {
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  // An employee who holds a seat (Time Keeper, Foreman...) also gets Approvals.
  const [hasSeat, setHasSeat] = useState(false)
  useEffect(() => {
    if (user?.role !== 'employee') return
    api.get('/dashboard-context').then((r) => setHasSeat(r.data.seats.length > 0 || r.data.headOffice.length > 0)).catch(() => {})
  }, [user?.role])
  const base = NAV[user?.role] || NAV.employee
  const items = user?.role === 'employee' && hasSeat
    ? [...base.slice(0, 2), { to: '/approvals', label: 'Approvals', icon: ShieldCheck }, ...base.slice(2)]
    : base

  function handleLogout() {
    logout()
    navigate('/login')
  }

  const SidebarContent = (
    <>
      <div className="border-b border-slate-100 dark:border-slate-800 px-4 py-5">
        <Logo />
      </div>
      <div className="px-4 pt-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-300 dark:text-slate-600">Main Menu</p>
      </div>
      <nav className="flex-1 space-y-0.5 px-3 py-2">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg border-l-[3px] px-3 py-2.5 text-sm font-medium transition ${
                isActive
                  ? 'border-brand-600 bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-300'
                  : 'border-transparent text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-100'
              }`
            }
          >
            <Icon size={17} strokeWidth={2} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-slate-100 dark:border-slate-800 px-4 py-4">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-700 text-xs font-bold text-white">
            {(user?.name || '?')
              .split(' ')
              .map((n) => n[0])
              .slice(0, 2)
              .join('')
              .toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{user?.name}</div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">
              {ROLE_LABEL[user?.role] || user?.role}
            </div>
          </div>
        </div>
        <button
          onClick={toggleTheme}
          className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 transition hover:border-brand-200 dark:hover:border-brand-500/40 hover:bg-brand-50 dark:hover:bg-brand-500/15 hover:text-brand-700 dark:hover:text-brand-300"
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
        <button
          onClick={handleLogout}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 transition hover:border-rose-200 dark:hover:border-rose-500/40 hover:bg-rose-50 dark:hover:bg-rose-500/15 hover:text-rose-600 dark:hover:text-rose-400"
        >
          <LogOut size={15} /> Logout
        </button>
      </div>
    </>
  )

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-slate-950">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 flex-col border-r border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 md:flex">
        {SidebarContent}
      </aside>

      {/* Mobile sidebar drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setMobileOpen(false)} />
          <aside className="relative flex w-64 flex-col bg-white dark:bg-slate-900 shadow-xl">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-4 text-slate-400"
            >
              <X size={18} />
            </button>
            {SidebarContent}
          </aside>
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 px-4 py-3.5 backdrop-blur md:px-6">
          <div className="flex items-center gap-3">
            <button className="text-slate-500 md:hidden" onClick={() => setMobileOpen(true)}>
              <Menu size={22} />
            </button>
            <div>
              <p className="hidden text-[10px] font-bold uppercase tracking-widest text-slate-300 dark:text-slate-600 sm:block">
                Matisan HR Management System
              </p>
              <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">{title}</h1>
              {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden rounded-full bg-slate-50 dark:bg-slate-800 px-3 py-1 text-[11px] font-semibold text-slate-500 ring-1 ring-inset ring-slate-200 dark:ring-slate-700 sm:inline-block">
              {ROLE_LABEL[user?.role] || user?.role}
            </span>
            <NotificationBell />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}
