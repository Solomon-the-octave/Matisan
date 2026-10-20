import { useEffect, useState } from 'react'
import { CheckCircle2, Circle, CornerUpLeft, Loader2, Banknote, Paperclip, Printer } from 'lucide-react'
import PeriodReview from './PeriodReview'
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
const fmtDateTime = (d) => new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

export default function ApprovalTrail({ periodId, onChange }) {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [returning, setReturning] = useState(false)
  const [reason, setReason] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [showHistory, setShowHistory] = useState(true)
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
      const res = await api.post(`/approvals/period/${periodId}/${kind}`, kind === 'return' ? { comment: reason } : { comment: note.trim() || undefined })
      setData(res.data)
      setReturning(false)
      setConfirming(false)
      setReason('')
      setNote('')
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
        <button type="button" onClick={() => window.print()} className="no-print ml-auto inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 font-semibold text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800"><Printer size={12} /> Print</button>
      </div>
      {period.currentStep >= 2 || payment ? <PeriodReview periodId={periodId} defaultOpen={canAct && !payStep} refreshKey={history.length} /> : null}
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
                {s.current && !s.assignee && (
                  <div className="mt-1 rounded-md bg-amber-50 dark:bg-amber-500/10 px-2 py-1 text-xs text-amber-800 dark:text-amber-300">
                    Nobody holds the {s.positionName} seat yet, so this week is waiting here. An admin can assign someone under Organization.
                  </div>
                )}
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
              {confirming ? (
                <div className="w-full space-y-2">
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    You are about to mark <b>{current.label}</b> for <b>{period.requestNo || 'this request'}</b>, {period.projectName}, payroll total <b>{money(payrollTotal)} ETB</b>. This is recorded with your name and the time.
                  </p>
                  <textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (optional)" className="input text-xs" />
                  <div className="flex gap-2">
                    <button onClick={() => act('complete')} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                      {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Confirm
                    </button>
                    <button onClick={() => { setConfirming(false); setNote('') }} className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-white dark:hover:bg-slate-700">Cancel</button>
                  </div>
                </div>
              ) : (
              <>
              <button
                onClick={() => setConfirming(true)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                <CheckCircle2 size={13} /> {current.action || 'Approve'} — {current.label}
              </button>
              {canReturn && (
                <button
                  onClick={() => setReturning(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700"
                >
                  <CornerUpLeft size={13} /> Return
                </button>
              )}
              </>
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
          <a href={`/voucher/${periodId}`} target="_blank" rel="noreferrer" className="no-print mt-1 inline-flex items-center gap-1 font-semibold underline"><Printer size={12} /> Payment voucher</a>
          {payment.hasProof && (
            <button onClick={downloadProof} className="mt-1 inline-flex items-center gap-1 font-semibold underline"><Paperclip size={12} /> {payment.proofName}</button>
          )}
        </div>
      )}
      {error && !canAct && <p className="mt-2 text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p>}

      {history.length > 0 && (
        <div className="mt-3 border-t border-slate-100 dark:border-slate-800 pt-3">
          <button onClick={() => setShowHistory((v) => !v)} className="text-xs font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 no-print">
            {showHistory ? 'Hide full trail' : `Show full trail (${history.length})`}
          </button>
          <div className="print-only text-xs font-bold text-slate-500">Full trail</div>
          <ol className={`${showHistory ? '' : 'hidden print:block'} mt-2 space-y-2.5 border-l-2 border-slate-200 dark:border-slate-700 pl-3`}>
            {history.map((h, i) => {
              const prev = history.slice(0, i).reverse().find((x) => x.snapshot)
              const changed = h.snapshot && prev && Math.abs((h.snapshot.cost || 0) - (prev.snapshot.cost || 0)) > 0.005
              return (
                <li key={i} className="text-xs">
                  <div className="font-semibold text-slate-700 dark:text-slate-200">
                    Step {h.step}, {h.label || h.stepName}: {h.action === 'completed' ? 'Done' : `Returned to step ${h.toStep || h.step - 1}`}
                  </div>
                  <div className="text-slate-500">
                    {h.userName}{h.actorPosition ? `, ${h.actorPosition}` : ''}
                    <span className="text-slate-400"> · {fmtDateTime(h.actionDate)}</span>
                  </div>
                  {h.snapshot && (
                    <div className="text-slate-500">
                      Figures at that time: {h.snapshot.workers} workers, {h.snapshot.daysPresent} days present, {h.snapshot.otHours} OT hours, total {money(h.snapshot.cost)} ETB
                    </div>
                  )}
                  {changed && (
                    <div className="font-medium text-amber-600 dark:text-amber-400">
                      Total changed from {money(prev.snapshot.cost)} to {money(h.snapshot.cost)} ETB since the previous action
                    </div>
                  )}
                  {h.comment && <div className="text-slate-600 dark:text-slate-300">Note: {h.comment}</div>}
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </div>
  )
}
