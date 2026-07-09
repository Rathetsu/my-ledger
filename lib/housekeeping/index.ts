import { and, eq, lt } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { incomeSources, occurrences } from '@/lib/db/schema'
import { dueDateFor, periodOf } from '@/lib/dates/cairo'

export function nextPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

export async function housekeeping(
  userId: string,
  today: string,
): Promise<void> {
  const current = periodOf(today)
  const periods = [current, nextPeriod(current)]

  const sources = await db
    .select()
    .from(incomeSources)
    .where(
      and(eq(incomeSources.userId, userId), eq(incomeSources.active, true)),
    )

  // ponytail: a non-recurring source gets exactly one occurrence ever; skip it once any exists
  const existing = await db
    .select({ sourceId: occurrences.sourceId })
    .from(occurrences)
    .where(and(eq(occurrences.userId, userId), eq(occurrences.kind, 'income')))
  const hasOccurrence = new Set(existing.map((r) => r.sourceId))

  const rows = sources.flatMap((s) => {
    const target = s.recurring
      ? periods
      : hasOccurrence.has(s.id)
        ? []
        : [current]
    return target.map((period) => ({
      userId,
      kind: 'income' as const,
      sourceId: s.id,
      period,
      dueDate: dueDateFor(period, s.dayOfMonth),
      expectedAmountMinor: s.amountMinor,
      status: 'pending' as const,
    }))
  })

  if (rows.length > 0) {
    await db
      .insert(occurrences)
      .values(rows)
      .onConflictDoNothing({
        target: [
          occurrences.userId,
          occurrences.kind,
          occurrences.sourceId,
          occurrences.period,
        ],
      })
  }

  await db
    .update(occurrences)
    .set({ status: 'overdue' })
    .where(
      and(
        eq(occurrences.userId, userId),
        eq(occurrences.status, 'pending'),
        lt(occurrences.dueDate, today),
      ),
    )
}
