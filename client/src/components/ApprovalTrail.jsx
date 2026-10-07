import { useEffect, useState } from 'react'
import { CheckCircle2, Circle, CornerUpLeft, Loader2, Banknote, Paperclip } from 'lucide-react'
import api from '../api'

// The paper "critical path" for one week of payroll: Prepared, Checked,
// Re-Checked ... Paid. One line per step, who sits in that position, and
// where it stands (Completed / Pending / Returned). The person whose turn it
// is gets two buttons only: Approve, or Return with a reason.
const STYLE = {
  completed: { icon: CheckCircle2, color: 'text-emerald-500', label: 'Completed' },
  pending: { icon: Circle, color: 'text-slate-300 dark:text-slate-600', label: 'Pending' },
  returned: { icon: CornerUpLeft, color: 'text-rose-500', label: 'Returned' },
}

const money = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })
const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

export default function ApprovalTrail({ periodId, onChange }) {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [returning, setReturning] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [payForm, setPayForm] = useState({ amountPaid: '', paidDate: new Date().toISOString().slice(0, 10), reference: '', method: '', proof: null })

  async function load() {
    const res = await api.get(`/approvals/period/${periodId}`)
    setData(res.data)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodId])

  async function act(kind) {
    setBusy(true)
    setError('')
    try {
      const res = await api.post(`/approvals/period/${periodId}/${kind}`, kind === 'return' ? { comment: reason } : {})
      setData(res.data)
      setReturning(false)
      setReason('')
      onChange?.()
    } catch (e) {
      setError(e.response?.data?.error || 'Could not save that action')
    } finally {
      setBusy(false)
    }
  }

  async function pay(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('paidDate', payForm.paidDate)
      fd.append('amountPaid', payForm.amountPaid === '' ? data.payrollTotal : payForm.amountPaid)
      if (payForm.reference) fd.append('reference', payForm.reference)
      if (payForm.method) fd.append('method', payForm.method)
      if (payForm.proof) fd.append('proof', payForm.proof)
      const res = await api.post(`/approvals/period/${periodId}/pay`, fd)
      setData(res.data)
      onChange?.()
    } catch (e2) {
      setError(e2.response?.data?.error || 'Could not record the payment')
    } finally {
      setBusy(false)
    }
  }

  async function downloadProof() {
    const res = await api.get(`/approvals/period/${periodId}/payment/proof`, { responseType: 'blob' })
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = data.payment?.proofName || 'proof'
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!data) return <p className="py-3 text-xs text-slate-400">Loading...</p>
  const { steps, canAct, canReturn, history, period, payrollTotal, payment } = data
  const current = steps.find((s) => s.current)

  const payStep = current && current.step === steps.length
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        {period.requestNo && <span className="rounded-md bg-brand-50 dark:bg-brand-500/15 px-2 py-0.5 font-bold text-brand-700 dark:text-brand-300">{period.requestNo}</span>}
        <span className="font-semibold text-slate-700 dark:text-slate-200">{period.projectName}</span>
        <span>{fmtDate(period.weekStart)} – {fmtDate(period.weekEnd)}</span>
        {payrollTotal != null && <span>Payroll total <b className="text-slate-700 dark:text-slate-200">{money(payrollTotal)}</b> ETB</span>}
      </div>
      <ol className="space-y-0">
        {steps.map((s, i) => {
          const st = STYLE[s.status]
          const Icon = st.icon
          return (
            <li key={s.step} className="flex gap-3">
              <div className="flex flex-col items-center">
                <Icon size={18} className={`shrink-0 ${st.color}`} />
                {i < steps.length - 1 && <div className="my-0.5 w-px flex-1 bg-slate-200 dark:bg-slate-700" />}
              </div>
              <div className={`min-w-0 flex-1 pb-3 ${s.current ? '' : ''}`}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className={`text-sm font-semibold ${s.current ? 'text-brand-700 dark:text-brand-300' : 'text-slate-700 dark:text-slate-200'}`}>{s.label}</span>
                  <span className="text-xs text-slate-400">{s.positionName}{s.assignee ? ` · ${s.assignee.name}` : ' · not assigned'}</span>
                </div>
                <div className="text-[11px] text-slate-400">
                  {st.label}
                  {s.current && s.status !== 'returned' && ' · current'}
                  {s.actedBy && ` · ${s.actedBy}, ${fmtDate(s.actedAt)}`}
                </div>
                {s.status === 'returned' && (
                  <div className="mt-1 rounded-md bg-rose-50 dark:bg-rose-500/10 px-2 py-1 text-xs text-rose-700 dark:text-rose-300">
                    Returned by {s.returnedBy}: {s.comment}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      {canAct && current && current.step >= 2 && payStep && (
        <form onSubmit={pay} className="mt-1 space-y-2 rounded-lg bg-slate-50 dark:bg-slate-800 p-3">
          <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">Record the payment (calculated total {money(payrollTotal)} ETB)</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="text-[11px] font-medium text-slate-500">Amount paid
              <input type="number" min="0" step="0.01" className="input mt-0.5 text-xs" placeholder={String(payrollTotal)} value={payForm.amountPaid} onChange={(e) => setPayForm({ ...payForm, amountPaid: e.target.value })} />
            </label>
            <label className="text-[11px] font-medium text-slate-500">Payment date
              <input type="date" required className="input mt-0.5 text-xs" value={payForm.paidDate} onChange={(e) => setPayForm({ ...payForm, paidDate: e.target.value })} />
            </label>
            <label className="text-[11px] font-medium text-slate-500">Reference (cheque / transfer no.)
              <input className="input mt-0.5 text-xs" maxLength={100} value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} />
            </label>
            <label className="text-[11px] font-medium text-slate-500">Method
              <input className="input mt-0.5 text-xs" maxLength={40} placeholder="Cash, bank transfer..." value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })} />
            </label>
          </div>
          <label className="block text-[11px] font-medium text-slate-500">Proof of payment (optional)
            <input type="file" className="mt-0.5 block w-full text-xs" onChange={(e) => setPayForm({ ...payForm, proof: e.target.files?.[0] || null })} />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Banknote size={13} />} {current.action} — {current.label}
            </button>
            {canReturn && (
              <button type="button" onClick={() => setReturning(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700"><CornerUpLeft size={13} /> Return</button>
            )}
          </div>
          {returning && (
            <div className="space-y-2">
              <textarea rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is it being returned? (required)" className="input text-xs" />
              <div className="flex gap-2">
                <button type="button" onClick={() => act('return')} disabled={busy || !reason.trim()} className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50">Send back</button>
                <button type="button" onClick={() => { setReturning(false); setReason('') }} className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-500">Cancel</button>
              </div>
            </div>
          )}
          {error && <p className="text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p>}
        </form>
      )}

      {canAct && current && current.step >= 2 && !payStep && (
        <div className="mt-1 rounded-lg bg-slate-50 dark:bg-slate-800 p-3">
          {!returning ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => act('complete')}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} {current.action || 'Approve'} — {current.label}
              </button>
              {canReturn && (
                <button
                  onClick={() => setReturning(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700"
                >
                  <CornerUpLeft size={13} /> Return
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                autoFocus
                rows={2}
                maxLength={300}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is it being returned? (required)"
                className="input text-xs"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => act('return')}
                  disabled={busy || !reason.trim()}
                  className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  Send back
                </button>
                <button onClick={() => { setReturning(false); setReason('') }} className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-white dark:hover:bg-slate-700">Cancel</button>
              </div>
            </div>
          )}
          {error && <p className="mt-2 text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p>}
        </div>
      )}
      {payment && (
        <div className="mt-2 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-300">
          <div className="font-semibold">Paid {money(payment.amountPaid)} ETB on {fmtDate(payment.paidDate)} by {payment.paidByName}</div>
          {(payment.method || payment.reference) && <div>{[payment.method, payment.reference].filter(Boolean).join(' · ')}</div>}
          {payment.differsFromTotal && <div className="font-medium">Differs from the calculated total of {money(payrollTotal)} ETB.</div>}
          {payment.hasProof && (
            <button onClick={downloadProof} className="mt-1 inline-flex items-center gap-1 font-semibold underline"><Paperclip size={12} /> {payment.proofName}</button>
          )}
        </div>
      )}
      {error && !canAct && <p className="mt-2 text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p>}

      {history.length > 0 && (
        <div className="mt-3">
          <button onClick={() => setShowHistory((v) => !v)} className="text-[11px] font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
            {showHistory ? 'Hide history' : `History (${history.length})`}
          </button>
          {showHistory && (
            <ul className="mt-1 space-y-0.5 text-[11px] text-slate-400">
              {history.map((h, i) => (
                <li key={i}>
                  {fmtDate(h.actionDate)} · {h.userName} {h.action === 'completed' ? 'approved' : 'returned'} {h.label || ''}{h.comment ? ` — ${h.comment}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
