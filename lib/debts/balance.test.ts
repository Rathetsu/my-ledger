import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { accounts, flexibleDebts, transactions } from '@/lib/db/schema'
import { debtBalanceFromRows, debtBalanceMinor } from './balance'

describe('debtBalanceFromRows', () => {
  it('subtracts payments (stored negative) and applies signed adjustments', () => {
    // 100000 - 30000 - 20000 + 5000 = 55000
    expect(
      debtBalanceFromRows(100000, [
        { type: 'debt_payment', amountMinor: -30000 },
        { type: 'debt_payment', amountMinor: -20000 },
        { type: 'adjustment', amountMinor: 5000 },
      ]),
    ).toBe(55000)
  })
  it('ignores unrelated types and handles no rows', () => {
    expect(debtBalanceFromRows(100000, [])).toBe(100000)
    expect(debtBalanceFromRows(100000, [{ type: 'purchase', amountMinor: -500 }])).toBe(100000)
  })
})

describe('debtBalanceMinor', () => {
  it('derives balance from original_minor minus debt_payment transactions', async () => {
    const userId = `test-${randomUUID()}`
    const [account] = await db
      .insert(accounts)
      .values({ userId, name: 'EUR acct', currency: 'EUR' })
      .returning()
    const [debt] = await db
      .insert(flexibleDebts)
      .values({ userId, name: 'Test debt', originalMinor: 100000, currency: 'EUR' })
      .returning()

    await db.insert(transactions).values([
      {
        userId,
        accountId: account.id,
        type: 'debt_payment',
        amountMinor: -30000,
        currency: 'EUR',
        occurredOn: '2026-01-15',
        sourceType: 'flexible_debt',
        sourceId: debt.id,
      },
      {
        userId,
        accountId: account.id,
        type: 'debt_payment',
        amountMinor: -20000,
        currency: 'EUR',
        occurredOn: '2026-02-15',
        sourceType: 'flexible_debt',
        sourceId: debt.id,
      },
    ])

    const result = await debtBalanceMinor(debt.id)

    expect(result).toBe(50000)
  })
})
