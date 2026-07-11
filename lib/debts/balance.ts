import { and, eq } from 'drizzle-orm'
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
