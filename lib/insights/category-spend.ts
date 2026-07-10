import { and, eq, gte, lt, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { expenseCategories, transactions } from '@/lib/db/schema'
import type { Currency } from '@/lib/money/money'
import { addPeriods, periodOf, todayCairo } from '@/lib/dates/cairo'
import type { CategorySpendRow } from '@/lib/insights/chart-data'

export async function expensesByCategoryAndPeriod(
  userId: string,
  currency: Currency,
  monthsBack: number,
): Promise<CategorySpendRow[]> {
  const current = periodOf(todayCairo())
  const from = addPeriods(current, -(monthsBack - 1)) // include the current month in insights
  return db
    .select({
      period: sql<string>`to_char(${transactions.occurredOn}, 'YYYY-MM')`,
      category: sql<string>`coalesce(${expenseCategories.name}, 'Uncategorized')`,
      totalMinor: sql<number>`sum(-${transactions.amountMinor})::int`,
    })
    .from(transactions)
    .leftJoin(expenseCategories, eq(transactions.categoryId, expenseCategories.id))
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.type, 'expense'),
        eq(transactions.currency, currency),
        gte(transactions.occurredOn, `${from}-01`),
        lt(transactions.occurredOn, `${addPeriods(current, 1)}-01`),
      ),
    )
    .groupBy(sql`1, 2`)
    .orderBy(sql`1`)
}
