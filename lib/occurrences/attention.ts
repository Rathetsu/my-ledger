import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { incomeSources, occurrences } from '@/lib/db/schema'
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

export async function getAttentionItems(
  userId: string,
  today: string,
): Promise<AttentionItem[]> {
  void today // used from P4 on (bills due within 7 days)
  const rows = await db
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
    .orderBy(asc(occurrences.dueDate))
  return rows as AttentionItem[]
}
