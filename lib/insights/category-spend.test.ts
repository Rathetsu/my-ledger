import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { accounts, expenseCategories, transactions } from '@/lib/db/schema'
import { addPeriods, periodOf, todayCairo } from '@/lib/dates/cairo'
import { expensesByCategoryAndPeriod } from './category-spend'

async function seedAccount(userId: string, currency: 'EUR' | 'USD' | 'EGP') {
  const [a] = await db
    .insert(accounts)
    .values({ userId, name: `${currency} acct`, currency })
    .returning()
  return a
}

async function seedCategory(userId: string, name: string) {
  const [c] = await db.insert(expenseCategories).values({ userId, name }).returning()
  return c
}

async function seedTx(
  userId: string,
  accountId: string,
  opts: {
    type: 'expense' | 'income'
    currency: 'EUR' | 'USD' | 'EGP'
    amountMinor: number
    occurredOn: string
    categoryId?: string | null
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
    categoryId: opts.categoryId ?? null,
    oneOff: opts.oneOff ?? false,
  })
}

describe('expensesByCategoryAndPeriod', () => {
  it('groups by (period, category) and includes one_off + the current month; coalesces null category and ignores other currencies/income', async () => {
    const userId = `test-${randomUUID()}`
    const a = await seedAccount(userId, 'EUR')
    const usd = await seedAccount(userId, 'USD')
    const groceries = await seedCategory(userId, 'Groceries')
    const current = periodOf(todayCairo())
    const p1 = addPeriods(current, -1)

    // p1: two Groceries expenses, one of them one_off -> both must count (1500 + 500 = 2000)
    await seedTx(userId, a.id, {
      type: 'expense',
      currency: 'EUR',
      amountMinor: -1500,
      occurredOn: `${p1}-05`,
      categoryId: groceries.id,
    })
    await seedTx(userId, a.id, {
      type: 'expense',
      currency: 'EUR',
      amountMinor: -500,
      occurredOn: `${p1}-10`,
      categoryId: groceries.id,
      oneOff: true,
    })

    // p1: uncategorized expense (null category)
    await seedTx(userId, a.id, {
      type: 'expense',
      currency: 'EUR',
      amountMinor: -300,
      occurredOn: `${p1}-12`,
      categoryId: null,
    })

    // current month: Groceries expense -> must be included (unlike variableSpendActuals)
    await seedTx(userId, a.id, {
      type: 'expense',
      currency: 'EUR',
      amountMinor: -700,
      occurredOn: `${current}-01`,
      categoryId: groceries.id,
    })

    // noise: income in EUR, and an expense in USD - must not affect EUR result
    await seedTx(userId, a.id, {
      type: 'income',
      currency: 'EUR',
      amountMinor: 999999,
      occurredOn: `${p1}-15`,
      categoryId: groceries.id,
    })
    await seedTx(userId, usd.id, {
      type: 'expense',
      currency: 'USD',
      amountMinor: -88888,
      occurredOn: `${p1}-15`,
      categoryId: groceries.id,
    })

    const result = await expensesByCategoryAndPeriod(userId, 'EUR', 3)
    // Query only orders by period; sort by category too so this assertion
    // doesn't depend on Postgres's unspecified tie-break order within a period.
    const sorted = [...result].sort((a, b) =>
      a.period === b.period ? a.category.localeCompare(b.category) : a.period.localeCompare(b.period),
    )

    expect(sorted).toEqual([
      { period: p1, category: 'Groceries', totalMinor: 2000 },
      { period: p1, category: 'Uncategorized', totalMinor: 300 },
      { period: current, category: 'Groceries', totalMinor: 700 },
    ])
  })

  it('includes the oldest month in the window (current-2) and excludes the month just outside it', async () => {
    const userId = `test-${randomUUID()}`
    const a = await seedAccount(userId, 'EUR')
    const current = periodOf(todayCairo())
    // monthsBack=3 -> window is [current-2, current]; from = addPeriods(current, -(3-1)).
    const oldestIncluded = addPeriods(current, -2)
    const justOutside = addPeriods(current, -3)

    await seedTx(userId, a.id, {
      type: 'expense',
      currency: 'EUR',
      amountMinor: -4444,
      occurredOn: `${oldestIncluded}-15`,
    })
    await seedTx(userId, a.id, {
      type: 'expense',
      currency: 'EUR',
      amountMinor: -99999,
      occurredOn: `${justOutside}-15`,
    })

    const result = await expensesByCategoryAndPeriod(userId, 'EUR', 3)

    expect(result.find((r) => r.period === oldestIncluded)).toEqual({
      period: oldestIncluded,
      category: 'Uncategorized',
      totalMinor: 4444,
    })
    expect(result.find((r) => r.period === justOutside)).toBeUndefined()
  })
})
