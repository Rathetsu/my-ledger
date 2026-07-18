import { EmptyState } from '@/components/empty-state'
import { formatMoney, type Currency } from '@/lib/money/money'
import type { MonthPlan } from '@/lib/planner/types'

export function PlanTimeline({
  months,
  debtNames,
  wishlistNames,
  homeCurrency,
}: {
  months: MonthPlan[]
  debtNames: Record<string, string>
  wishlistNames: Record<string, string>
  homeCurrency: Currency
}) {
  const shown = months
    .filter(
      (m) =>
        m.debtPayments.length > 0 ||
        m.fundingGaps.length > 0 ||
        m.wishlistFunding.length > 0,
    )
    .slice(0, 12)
  if (shown.length === 0) {
    return <EmptyState title="Nothing scheduled in the coming months." />
  }
  return (
    <ol className="space-y-3">
      {shown.map((m) => (
        <li key={m.period} className="rounded-lg border p-3">
          <p className="text-sm font-medium">{m.period}</p>
          {m.fundingGaps.map((g, i) => (
            <p
              key={i}
              className="mt-1 rounded bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300"
            >
              {g.suggestion}
            </p>
          ))}
          <ul className="mt-1 space-y-1 text-sm">
            {m.debtPayments.map((p) => (
              <li key={p.debtId} className="flex justify-between">
                <span>{debtNames[p.debtId] ?? 'Debt'}</span>
                <span className="tabular-nums">
                  {formatMoney({
                    amountMinor: p.amountMinor,
                    currency: p.currency,
                  })}
                </span>
              </li>
            ))}
          </ul>
          {m.wishlistFunding.length > 0 && (
            <>
              <p className="mt-2 text-xs font-medium text-neutral-500">
                Saving toward
              </p>
              <ul className="mt-1 space-y-1 text-sm text-neutral-600 dark:text-neutral-400">
                {m.wishlistFunding.map((f, i) => (
                  <li key={i} className="flex justify-between">
                    <span>
                      {'→ '}
                      {wishlistNames[f.itemId] ?? 'Wishlist'}
                    </span>
                    <span className="tabular-nums">
                      {formatMoney({
                        amountMinor: f.amountMinor,
                        currency: f.currency,
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {m.unallocatedMinor > 0 && (
            <p className="mt-1 text-xs text-neutral-500">
              Unallocated:{' '}
              {formatMoney({
                amountMinor: m.unallocatedMinor,
                currency: homeCurrency,
              })}
            </p>
          )}
        </li>
      ))}
    </ol>
  )
}
