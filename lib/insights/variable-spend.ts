import { and, eq, gte, lt, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { transactions } from '@/lib/db/schema'
import type { Currency } from '@/lib/money/money'
import { addPeriods, periodOf, todayCairo } from '@/lib/dates/cairo'

export async function variableSpendActuals(
  userId: string,
  currency: Currency,
  monthsBack: number,
): Promise<{ period: string; totalMinor: number }[]> {
  const current = periodOf(todayCairo())
  const from = addPeriods(current, -monthsBack)
  return db
    .select({
      period: sql<string>`to_char(${transactions.occurredOn}, 'YYYY-MM')`,
      totalMinor: sql<number>`sum(-${transactions.amountMinor})::int`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.type, 'expense'),
        eq(transactions.currency, currency),
        eq(transactions.oneOff, false),
        gte(transactions.occurredOn, `${from}-01`),
        lt(transactions.occurredOn, `${current}-01`),
      ),
    )
    .groupBy(sql`1`)
    .orderBy(sql`1`)
}
