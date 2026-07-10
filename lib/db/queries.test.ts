import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { accounts, transactions } from '@/lib/db/schema'
import { accountBalanceMinor, totalsByCurrency } from './queries'

// DB-backed against real Postgres (§3: balances are derived by summing
// transactions). Previously mock-only, which never exercised the SQL SUM/GROUP BY.
async function seedAccount(userId: string, currency: 'EUR' | 'USD' | 'EGP') {
  const [a] = await db
    .insert(accounts)
    .values({ userId, name: `${currency} acct`, currency })
    .returning()
  return a
}

async function post(
  userId: string,
  accountId: string,
  currency: 'EUR' | 'USD' | 'EGP',
  amountMinor: number,
) {
  await db.insert(transactions).values({
    userId,
    accountId,
    type: 'adjustment',
    amountMinor,
    currency,
    occurredOn: '2026-07-01',
  })
}

describe('accountBalanceMinor', () => {
  it('sums an account transactions as integer minor units, signs included', async () => {
    const userId = `test-${randomUUID()}`
    const a = await seedAccount(userId, 'EUR')
    await post(userId, a.id, 'EUR', 100000)
    await post(userId, a.id, 'EUR', -25000)
    expect(await accountBalanceMinor(a.id)).toBe(75000)
  })

  it('is 0 for an account with no transactions', async () => {
    const userId = `test-${randomUUID()}`
    const a = await seedAccount(userId, 'USD')
    expect(await accountBalanceMinor(a.id)).toBe(0)
  })
})

describe('totalsByCurrency', () => {
  it('groups a user transactions by currency', async () => {
    const userId = `test-${randomUUID()}`
    const eur = await seedAccount(userId, 'EUR')
    const egp = await seedAccount(userId, 'EGP')
    await post(userId, eur.id, 'EUR', 100000)
    await post(userId, eur.id, 'EUR', 50000)
    await post(userId, egp.id, 'EGP', 2000000)
    expect(await totalsByCurrency(userId)).toEqual({ EUR: 150000, EGP: 2000000 })
  })

  it('is scoped to the user', async () => {
    const mine = `test-${randomUUID()}`
    const other = `test-${randomUUID()}`
    const a = await seedAccount(mine, 'EUR')
    const b = await seedAccount(other, 'EUR')
    await post(mine, a.id, 'EUR', 100000)
    await post(other, b.id, 'EUR', 999999)
    expect(await totalsByCurrency(mine)).toEqual({ EUR: 100000 })
  })
})
