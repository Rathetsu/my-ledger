import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { accounts, transactions } from '@/lib/db/schema'
import { addPeriods, periodOf, todayCairo } from '@/lib/dates/cairo'
import { variableSpendActuals } from './variable-spend'

async function seedAccount(userId: string, currency: 'EUR' | 'USD' | 'EGP') {
  const [a] = await db
    .insert(accounts)
    .values({ userId, name: `${currency} acct`, currency })
    .returning()
  return a
}

async function seedTx(
  userId: string,
  accountId: string,
  opts: {
    type: 'expense' | 'income'
    currency: 'EUR' | 'USD' | 'EGP'
    amountMinor: number
    occurredOn: string
    oneOff?: boolean
  },
) {
  await db.insert(transactions).values({
    userId,
    accountId,
    type: opts.type,
    amountMinor: opts.amountMinor,
    currency: opts.currency,
    occurredOn: opts.occurredOn,
    oneOff: opts.oneOff ?? false,
  })
}

describe('variableSpendActuals', () => {
  it('sums expenses per past complete month ascending, excluding one_off rows', async () => {
    const userId = `test-${randomUUID()}`
    const a = await seedAccount(userId, 'EUR')
    const current = periodOf(todayCairo())
    const p1 = addPeriods(current, -1)
    const p2 = addPeriods(current, -2)

    // p2: two ordinary expenses (-30000, -20000) -> 50000 positive total
    await seedTx(userId, a.id, {
      type: 'expense',
      currency: 'EUR',
      amountMinor: -30000,
      occurredOn: `${p2}-15`,
    })
    await seedTx(userId, a.id, {
      type: 'expense',
      currency: 'EUR',
      amountMinor: -20000,
      occurredOn: `${p2}-15`,
    })
    // one_off expense in the same period must not count
    await seedTx(userId, a.id, {
      type: 'expense',
      currency: 'EUR',
      amountMinor: -99999,
      occurredOn: `${p2}-15`,
      oneOff: true,
    })

    // p1: one expense -> 10000
    await seedTx(userId, a.id, {
      type: 'expense',
      currency: 'EUR',
      amountMinor: -10000,
      occurredOn: `${p1}-15`,
    })

    const result = await variableSpendActuals(userId, 'EUR', 3)

    expect(result).toEqual([
      { period: p2, totalMinor: 50000 },
      { period: p1, totalMinor: 10000 },
    ])
  })

  it('excludes the current partial month', async () => {
    const userId = `test-${randomUUID()}`
    const a = await seedAccount(userId, 'EUR')
    const current = periodOf(todayCairo())

    await seedTx(userId, a.id, {
      type: 'expense',
      currency: 'EUR',
      amountMinor: -70000,
      occurredOn: `${current}-01`,
    })

    const result = await variableSpendActuals(userId, 'EUR', 3)

    expect(result.find((r) => r.period === current)).toBeUndefined()
  })

  it('ignores income rows and other currencies', async () => {
    const userId = `test-${randomUUID()}`
    const eur = await seedAccount(userId, 'EUR')
    const usd = await seedAccount(userId, 'USD')
    const current = periodOf(todayCairo())
    const p1 = addPeriods(current, -1)

    await seedTx(userId, eur.id, {
      type: 'expense',
      currency: 'EUR',
      amountMinor: -15000,
      occurredOn: `${p1}-10`,
    })
    // income noise in the same period/currency
    await seedTx(userId, eur.id, {
      type: 'income',
      currency: 'EUR',
      amountMinor: 100000,
      occurredOn: `${p1}-10`,
    })
    // different-currency expense noise in the same period
    await seedTx(userId, usd.id, {
      type: 'expense',
      currency: 'USD',
      amountMinor: -40000,
      occurredOn: `${p1}-10`,
    })

    const result = await variableSpendActuals(userId, 'EUR', 3)

    expect(result).toEqual([{ period: p1, totalMinor: 15000 }])
  })

  it('includes the oldest month in the window and excludes the month just outside it', async () => {
    const userId = `test-${randomUUID()}`
    const a = await seedAccount(userId, 'EUR')
    const current = periodOf(todayCairo())
    // monthsBack=3 -> window is [current-3, current-1]; from = addPeriods(current, -3).
    const oldestIncluded = addPeriods(current, -3)
    const justOutside = addPeriods(current, -4)

    await seedTx(userId, a.id, {
      type: 'expense',
      currency: 'EUR',
      amountMinor: -12345,
      occurredOn: `${oldestIncluded}-15`,
    })
    await seedTx(userId, a.id, {
      type: 'expense',
      currency: 'EUR',
      amountMinor: -99999,
      occurredOn: `${justOutside}-15`,
    })

    const result = await variableSpendActuals(userId, 'EUR', 3)

    expect(result.find((r) => r.period === oldestIncluded)).toEqual({
      period: oldestIncluded,
      totalMinor: 12345,
    })
    expect(result.find((r) => r.period === justOutside)).toBeUndefined()
  })
})
