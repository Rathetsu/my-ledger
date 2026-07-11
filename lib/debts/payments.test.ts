import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { accounts, flexibleDebts, transactions } from '@/lib/db/schema'
import { debtBalanceMinor } from '@/lib/debts/balance'
import { postDebtPayment, reverseDebtPayment } from './payments'

async function seed(
  opts: { accountCurrency?: 'EUR' | 'USD' | 'EGP'; archived?: boolean } = {},
) {
  const userId = `test-${randomUUID()}`
  const [account] = await db
    .insert(accounts)
    .values({
      userId,
      name: 'Main',
      currency: opts.accountCurrency ?? 'EUR',
      archivedAt: opts.archived ? new Date() : null,
    })
    .returning()
  const [debt] = await db
    .insert(flexibleDebts)
    .values({ userId, name: 'Card', originalMinor: 100000, currency: 'EUR' })
    .returning()
  return { userId, account, debt }
}

async function paymentIdFor(debtId: string) {
  const [row] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.sourceType, 'flexible_debt'),
        eq(transactions.sourceId, debtId),
      ),
    )
  return row.id
}

describe('postDebtPayment', () => {
  it('posts a negative debt_payment and the derived balance drops', async () => {
    const { userId, account, debt } = await seed()
    await postDebtPayment(userId, {
      debtId: debt.id,
      accountId: account.id,
      amountMinor: 30000,
    })
    expect(await debtBalanceMinor(debt.id)).toBe(70000)
  })

  it('rejects a currency-mismatched account', async () => {
    const { userId, account, debt } = await seed({ accountCurrency: 'USD' })
    await expect(
      postDebtPayment(userId, {
        debtId: debt.id,
        accountId: account.id,
        amountMinor: 30000,
      }),
    ).rejects.toThrow('Account must hold the debt currency')
  })

  it('rejects an archived account (write-freeze)', async () => {
    const { userId, account, debt } = await seed({ archived: true })
    await expect(
      postDebtPayment(userId, {
        debtId: debt.id,
        accountId: account.id,
        amountMinor: 30000,
      }),
    ).rejects.toThrow('Account is archived')
  })
})

describe('reverseDebtPayment', () => {
  it('restores the balance', async () => {
    const { userId, account, debt } = await seed()
    await postDebtPayment(userId, {
      debtId: debt.id,
      accountId: account.id,
      amountMinor: 30000,
    })
    const paymentId = await paymentIdFor(debt.id)
    await reverseDebtPayment(userId, paymentId)
    expect(await debtBalanceMinor(debt.id)).toBe(100000)
  })

  it('rejects when the account is archived (write-freeze)', async () => {
    const { userId, account, debt } = await seed()
    await postDebtPayment(userId, {
      debtId: debt.id,
      accountId: account.id,
      amountMinor: 30000,
    })
    const paymentId = await paymentIdFor(debt.id)
    await db
      .update(accounts)
      .set({ archivedAt: new Date() })
      .where(eq(accounts.id, account.id))
    await expect(reverseDebtPayment(userId, paymentId)).rejects.toThrow(
      'Account is archived',
    )
  })
})
