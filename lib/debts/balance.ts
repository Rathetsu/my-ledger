import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { flexibleDebts, transactions } from '@/lib/db/schema'

export function debtBalanceFromRows(
  originalMinor: number,
  rows: { type: string; amountMinor: number }[],
): number {
  // debt_payment rows are stored negative on the paying account (P2 sign convention),
  // so adding them subtracts from the debt; adjustments are signed (positive = owe more)
  return rows
    .filter((r) => r.type === 'debt_payment' || r.type === 'adjustment')
    .reduce((balance, r) => balance + r.amountMinor, originalMinor)
}

export async function debtBalanceMinor(debtId: string): Promise<number> {
  const [debt] = await db.select().from(flexibleDebts).where(eq(flexibleDebts.id, debtId))
  if (!debt) throw new Error('Debt not found')
  const rows = await db
    .select({ type: transactions.type, amountMinor: transactions.amountMinor })
    .from(transactions)
    .where(and(eq(transactions.sourceType, 'flexible_debt'), eq(transactions.sourceId, debtId)))
  return debtBalanceFromRows(debt.originalMinor, rows)
}

// Batched form of debtBalanceMinor (fixes the /debts + /plan N+1: one grouped
// query for the payment/adjustment deltas instead of one per debt). Must stay
// exactly equivalent to debtBalanceMinor per debt — see balance.test.ts.
export async function debtBalancesByDebt(userId: string): Promise<Record<string, number>> {
  const debtRows = await db
    .select({ id: flexibleDebts.id, originalMinor: flexibleDebts.originalMinor })
    .from(flexibleDebts)
    .where(eq(flexibleDebts.userId, userId))
  const deltaRows = await db
    .select({
      sourceId: transactions.sourceId,
      delta: sql<string | null>`sum(${transactions.amountMinor})`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.sourceType, 'flexible_debt'),
        inArray(transactions.type, ['debt_payment', 'adjustment']),
      ),
    )
    .groupBy(transactions.sourceId)
  const deltaById = new Map(deltaRows.map((r) => [r.sourceId, Number(r.delta ?? 0)]))
  const out: Record<string, number> = {}
  for (const d of debtRows) out[d.id] = d.originalMinor + (deltaById.get(d.id) ?? 0)
  return out
}
