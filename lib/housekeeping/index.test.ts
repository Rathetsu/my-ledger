import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { accounts, bills, incomeSources, occurrences } from '@/lib/db/schema'
import { housekeeping, nextPeriod } from './index'

async function seedIncomeSource(
  userId: string,
  dayOfMonth: number,
  recurring = true,
) {
  const [account] = await db
    .insert(accounts)
    .values({ userId, name: 'Main EUR', currency: 'EUR' })
    .returning()
  const [source] = await db
    .insert(incomeSources)
    .values({
      userId,
      name: 'Salary',
      amountMinor: 250000,
      currency: 'EUR',
      dayOfMonth,
      accountId: account.id,
      recurring,
      active: true,
    })
    .returning()
  return source
}

function occurrencesFor(userId: string) {
  return db
    .select()
    .from(occurrences)
    .where(and(eq(occurrences.userId, userId), eq(occurrences.kind, 'income')))
}

describe('nextPeriod', () => {
  it('increments within a year and rolls over December', () => {
    expect(nextPeriod('2026-07')).toBe('2026-08')
    expect(nextPeriod('2026-12')).toBe('2027-01')
  })
})

describe('housekeeping v1', () => {
  it('generates current + next period occurrences with clamped due dates', async () => {
    const userId = `test-${randomUUID()}`
    const source = await seedIncomeSource(userId, 31)
    await housekeeping(userId, '2026-02-10')
    const rows = await occurrencesFor(userId)
    expect(rows).toHaveLength(2)
    const byPeriod = Object.fromEntries(rows.map((r) => [r.period, r]))
    expect(byPeriod['2026-02']).toMatchObject({
      sourceId: source.id,
      dueDate: '2026-02-28', // clamped, 2026 is not a leap year
      expectedAmountMinor: 250000,
      status: 'pending',
    })
    expect(byPeriod['2026-03']).toMatchObject({
      dueDate: '2026-03-31',
      status: 'pending',
    })
  })

  it('is idempotent: a second run creates nothing new', async () => {
    const userId = `test-${randomUUID()}`
    await seedIncomeSource(userId, 25)
    await housekeeping(userId, '2026-07-10')
    await housekeeping(userId, '2026-07-10')
    expect(await occurrencesFor(userId)).toHaveLength(2)
  })

  it('flips pending occurrences past due_date to overdue, leaves future ones pending', async () => {
    const userId = `test-${randomUUID()}`
    await seedIncomeSource(userId, 1)
    await housekeeping(userId, '2026-07-15')
    const rows = await occurrencesFor(userId)
    const byPeriod = Object.fromEntries(rows.map((r) => [r.period, r]))
    expect(byPeriod['2026-07'].status).toBe('overdue') // due 2026-07-01, today is the 15th
    expect(byPeriod['2026-08'].status).toBe('pending')
  })

  it('generates a single current-period occurrence for a non-recurring source, once ever', async () => {
    const userId = `test-${randomUUID()}`
    await seedIncomeSource(userId, 20, false)
    await housekeeping(userId, '2026-07-10')
    await housekeeping(userId, '2026-08-10') // next month: must NOT create a second one
    const rows = await occurrencesFor(userId)
    expect(rows).toHaveLength(1)
    expect(rows[0].period).toBe('2026-07')
  })
})

async function seedBill(userId: string, dueDay: number) {
  const [account] = await db
    .insert(accounts)
    .values({ userId, name: 'Main EGP', currency: 'EGP' })
    .returning()
  const [bill] = await db
    .insert(bills)
    .values({
      userId,
      name: 'Rent',
      amountMinor: 1500000,
      currency: 'EGP',
      dueDay,
      accountId: account.id,
      active: true,
    })
    .returning()
  return bill
}

function billOccurrencesFor(userId: string) {
  return db
    .select()
    .from(occurrences)
    .where(and(eq(occurrences.userId, userId), eq(occurrences.kind, 'bill')))
}

describe('housekeeping bill generation', () => {
  it('generates current + next period bill occurrences with clamped due dates', async () => {
    const userId = `test-${randomUUID()}`
    const bill = await seedBill(userId, 31)
    await housekeeping(userId, '2026-04-10')
    const rows = await billOccurrencesFor(userId)
    expect(rows).toHaveLength(2)
    const byPeriod = Object.fromEntries(rows.map((r) => [r.period, r]))
    expect(byPeriod['2026-04']).toMatchObject({
      sourceId: bill.id,
      dueDate: '2026-04-30', // clamped, April has 30 days
      expectedAmountMinor: 1500000,
      status: 'pending',
    })
    expect(byPeriod['2026-05']).toMatchObject({
      dueDate: '2026-05-31',
      status: 'pending',
    })
  })

  it('is idempotent and flips past-due bill occurrences to overdue', async () => {
    const userId = `test-${randomUUID()}`
    await seedBill(userId, 1)
    await housekeeping(userId, '2026-07-15')
    await housekeeping(userId, '2026-07-15')
    const rows = await billOccurrencesFor(userId)
    expect(rows).toHaveLength(2)
    const byPeriod = Object.fromEntries(rows.map((r) => [r.period, r]))
    expect(byPeriod['2026-07'].status).toBe('overdue') // due 2026-07-01
    expect(byPeriod['2026-08'].status).toBe('pending')
  })

  it('skips inactive bills', async () => {
    const userId = `test-${randomUUID()}`
    const bill = await seedBill(userId, 10)
    await db.update(bills).set({ active: false }).where(eq(bills.id, bill.id))
    await housekeeping(userId, '2026-07-15')
    expect(await billOccurrencesFor(userId)).toHaveLength(0)
  })
})
