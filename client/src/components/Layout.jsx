import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Building2, Users, FolderKanban, ListChecks,
  CalendarCheck, FileBarChart, UserCircle, LogOut, Bell, Menu, X, HardHat,
} from 'lucide-react'
import { useState } from 'react'
import Logo from './Logo'
import { useAuth } from '../context/AuthContext'

const NAV = {
  admin: [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/departments', label: 'Departments', icon: Building2 },
    { to: '/users', label: 'Users', icon: Users },
    { to: '/projects', label: 'Projects', icon: FolderKanban },
    { to: '/tasks', label: 'Tasks', icon: ListChecks },
    { to: '/attendance', label: 'Attendance', icon: CalendarCheck },
    { to: '/field-attendance', label: 'Field Attendance', icon: HardHat },
    { to: '/reports', label: 'Reports', icon: FileBarChart },
  ],
  supervisor: [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/projects', label: 'Projects', icon: FolderKanban },
    { to: '/tasks', label: 'Tasks', icon: ListChecks },
    { to: '/attendance', label: 'Attendance', icon: CalendarCheck },
    { to: '/field-attendance', label: 'Field Attendance', icon: HardHat },
    { to: '/users', label: 'My Team', icon: Users },
    { to: '/reports', label: 'Reports', icon: FileBarChart },
  ],
  employee: [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/attendance', label: 'Check In', icon: CalendarCheck },
    { to: '/field-attendance', label: 'Field Attendance', icon: HardHat },
    { to: '/tasks', label: 'My Tasks', icon: ListChecks },
    { to: '/profile', label: 'Profile', icon: UserCircle },
  ],
}

const ROLE_LABEL = { admin: 'System Administrator', supervisor: 'Supervisor', employee: 'Employee' }

export default function Layout({ children, title, subtitle }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const items = NAV[user?.role] || NAV.employee

  function handleLogout() {
    logout()
    navigate('/login')
  }

  const SidebarContent = (
    <>
      <div className="border-b border-slate-100 px-4 py-5">
        <Logo />
      </div>
      <div className="px-4 pt-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Main Menu</p>
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
                  ? 'border-brand-600 bg-brand-50 text-brand-700'
                  : 'border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-800'
              }`
            }
          >
            <Icon size={17} strokeWidth={2} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-slate-100 px-4 py-4">
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
            <div className="truncate text-sm font-semibold text-slate-700">{user?.name}</div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-brand-600">
              {ROLE_LABEL[user?.role] || user?.role}
            </div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 py-2 text-sm font-semibold text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
        >
          <LogOut size={15} /> Logout
        </button>
      </div>
    </>
  )

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 flex-col border-r border-slate-100 bg-white md:flex">
        {SidebarContent}
      </aside>

      {/* Mobile sidebar drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setMobileOpen(false)} />
          <aside className="relative flex w-64 flex-col bg-white shadow-xl">
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
        <header className="flex items-center justify-between border-b border-slate-100 bg-white/95 px-4 py-3.5 backdrop-blur md:px-6">
          <div className="flex items-center gap-3">
            <button className="text-slate-500 md:hidden" onClick={() => setMobileOpen(true)}>
              <Menu size={22} />
            </button>
            <div>
              <p className="hidden text-[10px] font-bold uppercase tracking-widest text-slate-300 sm:block">
                Matisan HR Management System
              </p>
              <h1 className="text-lg font-bold text-slate-800">{title}</h1>
              {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden rounded-full bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-500 ring-1 ring-inset ring-slate-200 sm:inline-block">
              {ROLE_LABEL[user?.role] || user?.role}
            </span>
            <button className="rounded-full p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-600">
              <Bell size={18} />
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}
