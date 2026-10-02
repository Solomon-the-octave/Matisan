import { useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { Building2, HardHat, Ruler, ArrowRight } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (user) return <Navigate to="/dashboard" replace />

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password)
      navigate('/dashboard')
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to sign in. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 dark:bg-slate-950 p-4 sm:p-8">
    <div className="flex w-full max-w-7xl overflow-hidden rounded-2xl bg-white dark:bg-slate-900 shadow-xl ring-1 ring-slate-200/70 lg:min-h-[680px]">
      {/* Left brand panel */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-slate-50 dark:bg-slate-800 p-6 lg:flex">
        {/* blueprint grid texture */}
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              'linear-gradient(var(--login-grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--login-grid-line) 1px, transparent 1px)',
            backgroundSize: '36px 36px',
          }}
        />
        <div
          className="absolute inset-0"
          style={{ backgroundImage: 'radial-gradient(circle at 15% 15%, var(--login-grid-glow), transparent 55%)' }}
        />

        {/* decorative rotated squares */}
        <div className="pointer-events-none absolute right-8 top-10 h-64 w-64 rotate-12 rounded-2xl border-2 border-brand-200/70 dark:border-brand-500/40" />
        <div className="pointer-events-none absolute right-28 top-32 h-40 w-40 rotate-[24deg] rounded-2xl border-2 border-brand-100 dark:border-brand-500/40" />

        {/* bottom-left wave accent */}
        <svg className="pointer-events-none absolute bottom-0 left-0 h-24 w-40 opacity-90" viewBox="0 0 160 96" fill="none">
          <path d="M0 96V40C25 65 55 80 90 70C115 63 135 40 160 42V96H0Z" fill="var(--login-wave)" />
        </svg>

        <div className="relative flex flex-col items-center text-center">
          <div className="mb-10 inline-flex w-full max-w-md items-center justify-center rounded-2xl bg-white dark:bg-slate-900 p-8 shadow-sm">
            <img src="/logo-full.png" alt="Matisan Engineering Private Ltd Co." className="w-full" />
          </div>
          <h2 className="text-4xl font-extrabold leading-tight text-slate-800 dark:text-slate-100">
            Human Resources
            <br />
            <span className="text-brand-600 dark:text-brand-400">Management System</span>
          </h2>
          <p className="mt-4 max-w-sm text-slate-500">
            Empowering your workforce with modern HR solutions built for engineering excellence.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-1">
            <span className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-full bg-white dark:bg-slate-900 px-2 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 shadow-sm">
              <Building2 size={11} className="text-brand-600 dark:text-brand-400" /> Project Management
            </span>
            <span className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-full bg-white dark:bg-slate-900 px-2 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 shadow-sm">
              <HardHat size={11} className="text-brand-600 dark:text-brand-400" /> Field Operations
            </span>
            <span className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-full bg-white dark:bg-slate-900 px-2 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 shadow-sm">
              <Ruler size={11} className="text-brand-600 dark:text-brand-400" /> Resource Planning
            </span>
          </div>
        </div>
        <p className="relative text-center text-xs text-slate-400">
          &copy; {new Date().getFullYear()} Matisan Engineering Private Ltd Co. All rights reserved.
        </p>
      </div>

      {/* Right form panel */}
      <div className="flex w-full flex-col justify-center px-6 py-12 sm:px-12 lg:w-1/2 lg:px-20">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex justify-center lg:hidden">
            <img src="/logo-full.png" alt="Matisan Engineering Private Ltd Co." className="w-64" />
          </div>
          <h1 className="text-[2rem] font-extrabold text-slate-800 dark:text-slate-100">Welcome back</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to access your HR dashboard</p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
                Email address <span className="text-rose-500 dark:text-rose-400">*</span>
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Ex. john@matisans.com"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-3 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-brand-500/25"
              />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Password</label>
                <a href="#" className="text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline">
                  Forgot password?
                </a>
              </div>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-3 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-brand-500/25"
              />
            </div>

            {error && (
              <div className="rounded-lg bg-rose-50 dark:bg-rose-500/15 px-3 py-2 text-sm font-medium text-rose-600 dark:text-rose-400">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-60"
            >
              {loading ? 'Signing in...' : 'Sign in to account'}
              {!loading && <ArrowRight size={16} />}
            </button>
          </form>

          <div className="mt-8 border-t border-slate-100 dark:border-slate-800 pt-6 text-center text-sm text-slate-500">
            Need assistance? <a href="#" className="font-semibold text-brand-600 dark:text-brand-400 hover:underline">Contact HR Support</a>
          </div>
        </div>
      </div>
    </div>
    </div>
  )
}
