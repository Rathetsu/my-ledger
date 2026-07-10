import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { accounts, bills, incomeSources } from '@/lib/db/schema'
import { archiveBlockers } from './queries'

async function seedAccount(userId: string) {
  const [account] = await db
    .insert(accounts)
    .values({ userId, name: 'Main EUR', currency: 'EUR' })
    .returning()
  return account
}

async function seedBill(
  userId: string,
  accountId: string,
  active: boolean,
  name = 'Rent',
) {
  await db.insert(bills).values({
    userId,
    name,
    amountMinor: 1500000,
    currency: 'EUR',
    dueDay: 1,
    accountId,
    active,
  })
}

async function seedIncomeSource(
  userId: string,
  accountId: string,
  active: boolean,
  name = 'Salary',
) {
  await db.insert(incomeSources).values({
    userId,
    name,
    amountMinor: 250000,
    currency: 'EUR',
    dayOfMonth: 1,
    accountId,
    recurring: true,
    active,
  })
}

describe('archiveBlockers', () => {
  it('includes an active bill targeting the account', async () => {
    const userId = `test-${randomUUID()}`
    const account = await seedAccount(userId)
    await seedBill(userId, account.id, true)
    expect(await archiveBlockers(account.id, userId)).toContain('Rent')
  })

  it('excludes an inactive bill', async () => {
    const userId = `test-${randomUUID()}`
    const account = await seedAccount(userId)
    await seedBill(userId, account.id, false)
    expect(await archiveBlockers(account.id, userId)).not.toContain('Rent')
  })

  it('includes both an active income source and an active bill', async () => {
    const userId = `test-${randomUUID()}`
    const account = await seedAccount(userId)
    await seedIncomeSource(userId, account.id, true)
    await seedBill(userId, account.id, true)
    const blockers = await archiveBlockers(account.id, userId)
    expect(blockers).toContain('Salary')
    expect(blockers).toContain('Rent')
  })

  it('returns an empty list when nothing active targets the account', async () => {
    const userId = `test-${randomUUID()}`
    const account = await seedAccount(userId)
    expect(await archiveBlockers(account.id, userId)).toEqual([])
  })
})
