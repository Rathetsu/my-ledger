import { and, eq, lt } from 'drizzle-orm'
import { db, dbPool } from '@/lib/db/client'
import { bills, incomeSources, occurrences } from '@/lib/db/schema'
import { dueDateFor, periodOf } from '@/lib/dates/cairo'

export function nextPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

type NewOccurrence = typeof occurrences.$inferInsert

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

  const rows: NewOccurrence[] = sources.flatMap((s) => {
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

  // bills (P4): always recurring
  const activeBills = await db
    .select()
    .from(bills)
    .where(and(eq(bills.userId, userId), eq(bills.active, true)))

  rows.push(
    ...activeBills.flatMap((b) =>
      periods.map((period) => ({
        userId,
        kind: 'bill' as const,
        sourceId: b.id,
        period,
        dueDate: dueDateFor(period, b.dueDay),
        expectedAmountMinor: b.amountMinor,
        status: 'pending' as const,
      })),
    ),
  )

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

// Definition-edit rail shared by income, bills, and (P5) installments.
// Bills/income call this outside a transaction (defaults to the http `db`);
// updateIncomeSource calls it with its own `tx` to stay atomic with the source update.
type DbTx = Parameters<Parameters<typeof dbPool.transaction>[0]>[0]
type Executor = typeof db | DbTx

async function loadDefinition(
  kind: 'income' | 'bill' | 'installment',
  sourceId: string,
  executor: Executor,
): Promise<{ amountMinor: number; dueDay: number } | null> {
  switch (kind) {
    case 'income': {
      const [s] = await executor
        .select()
        .from(incomeSources)
        .where(eq(incomeSources.id, sourceId))
      return s ? { amountMinor: s.amountMinor, dueDay: s.dayOfMonth } : null
    }
    case 'bill': {
      const [b] = await executor.select().from(bills).where(eq(bills.id, sourceId))
      return b ? { amountMinor: b.amountMinor, dueDay: b.dueDay } : null
    }
    default:
      return null // installment case lands in P5; unknown definition = no-op
  }
}

export async function rewritePendingOccurrences(
  kind: 'income' | 'bill' | 'installment',
  sourceId: string,
  executor: Executor = db,
): Promise<void> {
  const def = await loadDefinition(kind, sourceId, executor)
  if (!def) return
  const pending = await executor
    .select()
    .from(occurrences)
    .where(
      and(
        eq(occurrences.kind, kind),
        eq(occurrences.sourceId, sourceId),
        eq(occurrences.status, 'pending'),
      ),
    )
  for (const occ of pending) {
    await executor
      .update(occurrences)
      .set({
        expectedAmountMinor: def.amountMinor,
        dueDate: dueDateFor(occ.period, def.dueDay),
      })
      .where(eq(occurrences.id, occ.id))
  }
}
