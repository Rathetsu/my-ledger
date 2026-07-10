import Link from 'next/link'
import { and, desc, eq, gte, lt } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { expenseCategories, transactions } from '@/lib/db/schema'
import { requireUser } from '@/lib/auth'
import { formatMoney } from '@/lib/money/money'
import { addPeriods, periodOf, todayCairo } from '@/lib/dates/cairo'

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; category?: string }>
}) {
  const params = await searchParams
  const user = await requireUser()
  const period = /^\d{4}-\d{2}$/.test(params.month ?? '') ? params.month! : periodOf(todayCairo())
  const categories = await db
    .select()
    .from(expenseCategories)
    .where(eq(expenseCategories.userId, user.id))
    .orderBy(expenseCategories.name)
  const rows = await db
    .select({
      id: transactions.id,
      amountMinor: transactions.amountMinor,
      currency: transactions.currency,
      occurredOn: transactions.occurredOn,
      note: transactions.note,
      oneOff: transactions.oneOff,
      categoryName: expenseCategories.name,
      categoryIcon: expenseCategories.icon,
    })
    .from(transactions)
    .leftJoin(expenseCategories, eq(transactions.categoryId, expenseCategories.id))
    .where(
      and(
        eq(transactions.userId, user.id),
        eq(transactions.type, 'expense'),
        gte(transactions.occurredOn, `${period}-01`),
        lt(transactions.occurredOn, `${addPeriods(period, 1)}-01`),
        params.category ? eq(transactions.categoryId, params.category) : undefined,
      ),
    )
    .orderBy(desc(transactions.occurredOn))

  return (
    <main className="mx-auto max-w-md space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Expenses</h1>
        <Link href="/expenses/insights" className="text-sm underline">
          Insights
        </Link>
      </div>
      <form method="GET" className="flex gap-2">
        <input type="month" name="month" defaultValue={period} className="min-w-0 flex-1 rounded-lg border p-3" />
        <select name="category" defaultValue={params.category ?? ''} className="min-w-0 flex-1 rounded-lg border p-3">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-lg border px-4">
          Go
        </button>
      </form>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500">No expenses in {period}.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 p-3">
              <div className="min-w-0">
                <p className="truncate">{r.note || 'Expense'}</p>
                <p className="text-xs text-neutral-500">
                  {r.occurredOn} · {r.categoryIcon ? `${r.categoryIcon} ` : ''}
                  {r.categoryName ?? 'Uncategorized'}
                  {r.oneOff ? ' · one-off' : ''}
                </p>
              </div>
              <span className="shrink-0 tabular-nums">
                {formatMoney({ amountMinor: -r.amountMinor, currency: r.currency })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
