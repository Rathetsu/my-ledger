import { formatMoney } from '@/lib/money/money'
import type { MonthPlan } from '@/lib/planner/types'

export function AlgorithmSuggests({ month, debtNames }: { month: MonthPlan | undefined; debtNames: Record<string, string> }) {
  const empty = !month || (month.debtPayments.length === 0 && month.fundingGaps.length === 0)
  return (
    <section className="rounded-lg border p-4">
      <h2 className="text-sm font-medium">Algorithm suggests</h2>
      {empty ? (
        <p className="mt-1 text-sm text-neutral-500">Nothing to do this month.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {month.fundingGaps.map((g, i) => (
            <li key={`gap-${i}`} className="text-amber-700 dark:text-amber-400">
              {g.suggestion}
            </li>
          ))}
          {month.debtPayments.map((p) => (
            <li key={p.debtId}>
              Pay {formatMoney({ amountMinor: p.amountMinor, currency: p.currency })} toward {debtNames[p.debtId] ?? 'debt'}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
