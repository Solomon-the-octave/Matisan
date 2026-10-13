import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Printer } from 'lucide-react'
import Layout from '../components/Layout'
import api from '../api'

const money = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const day = (d) => new Date(String(d).length === 10 ? d + 'T00:00:00' : d).toLocaleDateString(undefined, { dateStyle: 'medium' })
const stamp = (d) => new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

// One printable page for a paid week: what was paid, to whom it applies, and
// who checked and approved every step, ready to be filed.
export default function Voucher() {
  const { periodId } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get(`/approvals/period/${periodId}`).then((r) => setData(r.data)).catch((e) => setError(e.response?.data?.error || 'Could not load this payment'))
  }, [periodId])

  if (error) return <Layout title="Payment voucher"><p className="text-sm text-rose-600">{error}</p></Layout>
  if (!data) return <Layout title="Payment voucher"><p className="text-sm text-slate-400">Loading...</p></Layout>

  const { period, payment, history, payrollTotal } = data
  // The last time each step was completed (a returned week is redone).
  const done = {}
  for (const h of history) if (h.action === 'completed') done[h.step] = h
  const rows = Object.values(done).sort((a, b) => a.step - b.step)
  const fig = (rows[rows.length - 1] || {}).snapshot

  return (
    <Layout title="Payment voucher" subtitle={period.requestNo || ''}>
      {!payment && <p className="mb-3 rounded-lg bg-amber-50 dark:bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">This week has not been paid yet. The voucher is complete once Finance records the payment.</p>}
      <div className="no-print mb-3 flex justify-end">
        <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"><Printer size={15} /> Print voucher</button>
      </div>

      <div className="surface mx-auto max-w-3xl p-6 text-sm">
        <div className="mb-4 flex items-start justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
          <div>
            <div className="text-lg font-bold text-slate-800 dark:text-slate-100">Payment Voucher</div>
            <div className="text-slate-500">Matisan Engineering Private Ltd Co.</div>
          </div>
          <div className="text-right">
            <div className="text-base font-bold text-brand-700 dark:text-brand-300">{period.requestNo}</div>
            <div className="text-xs text-slate-400">Printed {stamp(new Date())}</div>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
          <div><dt className="text-xs text-slate-400">Project</dt><dd className="font-semibold">{period.projectName}</dd></div>
          <div><dt className="text-xs text-slate-400">Pay week</dt><dd className="font-semibold">{day(period.weekStart)} to {day(period.weekEnd)}</dd></div>
          <div><dt className="text-xs text-slate-400">Calculated payroll total</dt><dd className="font-semibold">{money(payrollTotal)} ETB</dd></div>
          {fig && <div><dt className="text-xs text-slate-400">Workers / days present / OT hours</dt><dd className="font-semibold">{fig.workers} / {fig.daysPresent} / {fig.otHours}</dd></div>}
        </dl>

        {payment && (
          <div className="mt-4 rounded-lg border border-emerald-200 dark:border-emerald-500/30 p-3">
            <div className="mb-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">Payment</div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
              <div><dt className="text-xs text-slate-400">Amount paid</dt><dd className="font-bold">{money(payment.amountPaid)} ETB</dd></div>
              <div><dt className="text-xs text-slate-400">Date paid</dt><dd className="font-semibold">{day(payment.paidDate)}</dd></div>
              <div><dt className="text-xs text-slate-400">Method</dt><dd>{payment.method || 'Not stated'}</dd></div>
              <div><dt className="text-xs text-slate-400">Reference</dt><dd>{payment.reference || 'Not stated'}</dd></div>
              <div><dt className="text-xs text-slate-400">Paid by</dt><dd>{payment.paidByName}</dd></div>
              <div><dt className="text-xs text-slate-400">Proof attached</dt><dd>{payment.hasProof ? payment.proofName : 'No'}</dd></div>
            </dl>
            {payment.differsFromTotal && <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-300">The amount paid differs from the calculated total of {money(payrollTotal)} ETB.</p>}
          </div>
        )}

        <div className="mt-5 text-xs font-bold text-slate-500">Approval path</div>
        <table className="mt-1 w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-400">
              <th className="py-1.5 pr-2 font-medium">Step</th><th className="pr-2 font-medium">Name and position</th><th className="pr-2 font-medium">Date and time</th><th className="font-medium">Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <tr key={h.step} className="border-b border-slate-100 dark:border-slate-800 align-top">
                <td className="py-1.5 pr-2 font-semibold">{h.step}. {h.label}</td>
                <td className="pr-2">{h.userName}{h.actorPosition ? `, ${h.actorPosition}` : ''}</td>
                <td className="pr-2">{stamp(h.actionDate)}</td>
                <td>{h.comment || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-8 grid grid-cols-2 gap-8 text-xs text-slate-500">
          <div className="border-t border-slate-300 dark:border-slate-600 pt-1">Received by (signature and date)</div>
          <div className="border-t border-slate-300 dark:border-slate-600 pt-1">Finance stamp</div>
        </div>
      </div>
    </Layout>
  )
}
