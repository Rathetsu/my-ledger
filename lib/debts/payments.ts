import { and, eq } from 'drizzle-orm'
import { db, dbPool } from '@/lib/db/client'
import { todayCairo } from '@/lib/dates/cairo'
import { isAccountArchived } from '@/lib/db/queries'
import { accounts, flexibleDebts, transactions } from '@/lib/db/schema'

// Plain helpers taking an explicit userId so they are unit-testable; the
// 'use server' wrappers in lib/actions/debts.ts delegate here (mirrors
// lib/occurrences/confirm.ts). debt_payment rows are created here and deleted
// only via reverseDebtPayment.

export async function postDebtPayment(
  userId: string,
  data: {
    debtId: string
    accountId: string
    amountMinor: number // validated positive; stored negated as an outflow
    occurredOn?: string
  },
): Promise<void> {
  await dbPool.transaction(async (tx) => {
    const [debt] = await tx
      .select()
      .from(flexibleDebts)
      .where(
        and(
          eq(flexibleDebts.id, data.debtId),
          eq(flexibleDebts.userId, userId),
        ),
      )
    if (!debt) throw new Error('Debt not found')

    const [account] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, data.accountId), eq(accounts.userId, userId)))
    if (!account) throw new Error('Account not found')
    // Write-freeze (invariant #3): never post into an archived account.
    if (account.archivedAt) throw new Error('Account is archived')
    if (account.currency !== debt.currency)
      throw new Error('Account must hold the debt currency')

    await tx.insert(transactions).values({
      userId,
      accountId: data.accountId,
      type: 'debt_payment',
      amountMinor: -data.amountMinor, // outflow stored negative: balances stay plain sums
      currency: debt.currency,
      occurredOn: data.occurredOn ?? todayCairo(),
      note: `Payment: ${debt.name}`,
      sourceType: 'flexible_debt',
      sourceId: debt.id,
    })
  })
}

export async function reverseDebtPayment(
  userId: string,
  paymentId: string,
): Promise<void> {
  const predicate = and(
    eq(transactions.id, paymentId),
    eq(transactions.userId, userId),
    eq(transactions.type, 'debt_payment'),
    eq(transactions.sourceType, 'flexible_debt'),
  )
  const [payment] = await db
    .select({ accountId: transactions.accountId })
    .from(transactions)
    .where(predicate)
  if (!payment) throw new Error('Payment not found')
  // Write-freeze (invariant #3): a reversal mutates the account's balance, so
  // it is also a write and must refuse a frozen (archived) account.
  if (await isAccountArchived(userId, payment.accountId))
    throw new Error('Account is archived')
  await db.delete(transactions).where(predicate)
}
