import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { accounts, flexibleDebts, transactions } from '@/lib/db/schema'
import { debtBalanceFromRows, debtBalanceMinor, debtBalancesByDebt } from './balance'

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

describe('debtBalancesByDebt', () => {
  it('matches the per-debt derivation, excludes unrelated types, handles no-delta debts', async () => {
    const userId = `test-${randomUUID()}`
    const [account] = await db
      .insert(accounts)
      .values({ userId, name: 'EUR acct', currency: 'EUR' })
      .returning()

    const [debtA] = await db
      .insert(flexibleDebts)
      .values({ userId, name: 'Debt A', originalMinor: 100000, currency: 'EUR' })
      .returning()
    const [debtB] = await db
      .insert(flexibleDebts)
      .values({ userId, name: 'Debt B', originalMinor: 50000, currency: 'EUR' })
      .returning()
    const [debtC] = await db
      .insert(flexibleDebts)
      .values({ userId, name: 'Debt C (no deltas)', originalMinor: 20000, currency: 'EUR' })
      .returning()

    await db.insert(transactions).values([
      // debt A: payment + payment + adjustment => 100000 - 30000 - 20000 + 5000 = 55000
      {
        userId,
        accountId: account.id,
        type: 'debt_payment',
        amountMinor: -30000,
        currency: 'EUR',
        occurredOn: '2026-01-15',
        sourceType: 'flexible_debt',
        sourceId: debtA.id,
      },
      {
        userId,
        accountId: account.id,
        type: 'debt_payment',
        amountMinor: -20000,
        currency: 'EUR',
        occurredOn: '2026-02-15',
        sourceType: 'flexible_debt',
        sourceId: debtA.id,
      },
      {
        userId,
        accountId: account.id,
        type: 'adjustment',
        amountMinor: 5000,
        currency: 'EUR',
        occurredOn: '2026-03-01',
        sourceType: 'flexible_debt',
        sourceId: debtA.id,
      },
      // debt B: one payment plus an unrelated debt-linked row that must be excluded
      {
        userId,
        accountId: account.id,
        type: 'debt_payment',
        amountMinor: -10000,
        currency: 'EUR',
        occurredOn: '2026-01-20',
        sourceType: 'flexible_debt',
        sourceId: debtB.id,
      },
      {
        userId,
        accountId: account.id,
        type: 'purchase',
        amountMinor: -999999,
        currency: 'EUR',
        occurredOn: '2026-01-21',
        sourceType: 'flexible_debt',
        sourceId: debtB.id,
      },
      // debt C: no rows at all, balance must equal originalMinor
    ])

    const expected: Record<string, number> = {}
    for (const d of [debtA, debtB, debtC]) {
      expected[d.id] = await debtBalanceMinor(d.id)
    }

    const actual = await debtBalancesByDebt(userId)

    expect(actual).toEqual(expected)
    expect(actual[debtA.id]).toBe(55000)
    expect(actual[debtB.id]).toBe(40000) // purchase row excluded
    expect(actual[debtC.id]).toBe(20000) // no deltas => originalMinor
  })
})
