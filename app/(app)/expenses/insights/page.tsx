import { CURRENCIES } from '@/lib/money/money'
import { formatMoney } from '@/lib/money/money'
import { addPeriods, periodOf, todayCairo } from '@/lib/dates/cairo'
import { requireUser } from '@/lib/auth'
import { expensesByCategoryAndPeriod } from '@/lib/insights/category-spend'
import { pivotByCategory, trendSeries } from '@/lib/insights/chart-data'
import { EmptyState } from '@/components/empty-state'
import { SpendByCategoryChart } from '@/components/insights/spend-by-category-chart'
import { TrendChart } from '@/components/insights/trend-chart'

const MONTHS_BACK = 6

export default async function InsightsPage() {
  const user = await requireUser()
  const current = periodOf(todayCairo())
  const from = addPeriods(current, -(MONTHS_BACK - 1))
  const sections = await Promise.all(
    CURRENCIES.map(async (currency) => {
      const rows = await expensesByCategoryAndPeriod(
        user.id,
        currency,
        MONTHS_BACK,
      )
      const perPeriod = new Map<string, number>()
      for (const r of rows)
        perPeriod.set(r.period, (perPeriod.get(r.period) ?? 0) + r.totalMinor)
      return {
        currency,
        pivot: pivotByCategory(rows),
        trend: trendSeries(
          [...perPeriod].map(([period, totalMinor]) => ({
            period,
            totalMinor,
          })),
          from,
          current,
        ),
        totalMinor: rows.reduce((a, r) => a + r.totalMinor, 0),
      }
    }),
  )
  const active = sections.filter((s) => s.totalMinor > 0)

  return (
    <main className="mx-auto max-w-md space-y-6 p-4">
      <h1 className="text-xl font-semibold">Insights</h1>
      {active.length === 0 ? (
        <EmptyState
          title="No expenses yet."
          body="Log a few from the Expenses tab and charts appear here."
        />
      ) : (
        active.map((s) => (
          <section key={s.currency} className="space-y-3">
            <h2 className="font-medium">{s.currency} spend by category</h2>
            <SpendByCategoryChart
              categories={s.pivot.categories}
              data={s.pivot.data}
              currency={s.currency}
            />
            <ul className="text-xs text-neutral-500">
              {s.pivot.categories.map((cat) => (
                <li key={cat} className="flex justify-between">
                  <span>{cat}</span>
                  <span className="tabular-nums">
                    {formatMoney({
                      amountMinor: s.pivot.data.reduce(
                        (a, row) => a + Number(row[cat] ?? 0),
                        0,
                      ),
                      currency: s.currency,
                    })}
                  </span>
                </li>
              ))}
            </ul>
            <h2 className="font-medium">{s.currency} monthly trend</h2>
            <TrendChart data={s.trend} currency={s.currency} />
          </section>
        ))
      )}
    </main>
  )
}
