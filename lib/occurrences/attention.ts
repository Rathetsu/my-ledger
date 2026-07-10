import { and, eq, inArray, lte, or } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { bills, incomeSources, occurrences } from '@/lib/db/schema'
import type { Currency } from '@/lib/money/money'

export interface AttentionItem {
  occurrenceId: string
  kind: 'income' | 'bill' | 'installment'
  sourceName: string
  expectedAmountMinor: number
  currency: Currency
  dueDate: string
  status: 'pending' | 'overdue'
}

function plusDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export async function getAttentionItems(
  userId: string,
  today: string,
): Promise<AttentionItem[]> {
  const soon = plusDays(today, 7)

  const incomeRows = await db
    .select({
      occurrenceId: occurrences.id,
      kind: occurrences.kind,
      sourceName: incomeSources.name,
      expectedAmountMinor: occurrences.expectedAmountMinor,
      currency: incomeSources.currency,
      dueDate: occurrences.dueDate,
      status: occurrences.status,
    })
    .from(occurrences)
    .innerJoin(incomeSources, eq(occurrences.sourceId, incomeSources.id))
    .where(
      and(
        eq(occurrences.userId, userId),
        eq(occurrences.kind, 'income'),
        inArray(occurrences.status, ['pending', 'overdue']),
      ),
    )

  const billRows = await db
    .select({
      occurrenceId: occurrences.id,
      kind: occurrences.kind,
      sourceName: bills.name,
      expectedAmountMinor: occurrences.expectedAmountMinor,
      currency: bills.currency,
      dueDate: occurrences.dueDate,
      status: occurrences.status,
    })
    .from(occurrences)
    .innerJoin(bills, eq(occurrences.sourceId, bills.id))
    .where(
      and(
        eq(occurrences.userId, userId),
        eq(occurrences.kind, 'bill'),
        or(
          eq(occurrences.status, 'overdue'),
          and(
            eq(occurrences.status, 'pending'),
            lte(occurrences.dueDate, soon),
          ), // due within 7 days
        ),
      ),
    )

  // ponytail: two queries + JS sort beats a cross-table SQL union; n is tiny (one user's month)
  return [...incomeRows, ...billRows].sort((a, b) =>
    a.dueDate.localeCompare(b.dueDate),
  ) as AttentionItem[]
}
