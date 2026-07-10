import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import {
  accounts,
  bills,
  incomeSources,
  installments,
  occurrences,
} from '@/lib/db/schema'
import {
  clearUnsettledInstallmentOccurrences,
  housekeeping,
  nextPeriod,
  rewritePendingOccurrences,
} from './index'

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

async function seedInstallment(
  userId: string,
  overrides: Partial<typeof installments.$inferInsert> = {},
) {
  const [account] = await db
    .insert(accounts)
    .values({ userId, name: 'Main USD', currency: 'USD' })
    .returning()
  const [inst] = await db
    .insert(installments)
    .values({
      userId,
      name: 'Phone',
      monthlyAmountMinor: 50000,
      currency: 'USD',
      dueDay: 15,
      totalCount: 12,
      remainingCount: 12,
      startDate: '2026-01-01',
      accountId: account.id,
      apr: null,
      active: true,
      ...overrides,
    })
    .returning()
  return inst
}

function installmentOccurrencesFor(userId: string) {
  return db
    .select()
    .from(occurrences)
    .where(
      and(eq(occurrences.userId, userId), eq(occurrences.kind, 'installment')),
    )
}

describe('housekeeping installment generation', () => {
  it('generates current + next period while plenty of payments remain', async () => {
    const userId = `test-${randomUUID()}`
    const inst = await seedInstallment(userId)
    await housekeeping(userId, '2026-07-10')
    const rows = await installmentOccurrencesFor(userId)
    expect(rows).toHaveLength(2)
    const byPeriod = Object.fromEntries(rows.map((r) => [r.period, r]))
    expect(byPeriod['2026-07']).toMatchObject({
      sourceId: inst.id,
      dueDate: '2026-07-15',
      expectedAmountMinor: 50000,
      status: 'pending',
    })
    expect(byPeriod['2026-08']).toMatchObject({
      dueDate: '2026-08-15',
      status: 'pending',
    })
  })

  it('clamps due_day 31 to the end of February', async () => {
    const userId = `test-${randomUUID()}`
    await seedInstallment(userId, { dueDay: 31 })
    await housekeeping(userId, '2026-02-10')
    const rows = await installmentOccurrencesFor(userId)
    const byPeriod = Object.fromEntries(rows.map((r) => [r.period, r]))
    expect(byPeriod['2026-02'].dueDate).toBe('2026-02-28') // 2026 is not a leap year
    expect(byPeriod['2026-03'].dueDate).toBe('2026-03-31')
  })

  it('generates only ONE occurrence when a single payment remains', async () => {
    const userId = `test-${randomUUID()}`
    await seedInstallment(userId, { remainingCount: 1 })
    await housekeeping(userId, '2026-07-10')
    const rows = await installmentOccurrencesFor(userId)
    expect(rows).toHaveLength(1)
    expect(rows[0].period).toBe('2026-07')
  })

  it('generates nothing at remaining_count = 0 or when inactive', async () => {
    const userId = `test-${randomUUID()}`
    await seedInstallment(userId, { remainingCount: 0, active: false })
    await seedInstallment(userId, { name: 'Laptop', active: false })
    await housekeeping(userId, '2026-07-10')
    expect(await installmentOccurrencesFor(userId)).toHaveLength(0)
  })

  it('does not generate before the start_date period', async () => {
    const userId = `test-${randomUUID()}`
    await seedInstallment(userId, { startDate: '2026-08-01' })
    await housekeeping(userId, '2026-07-10') // current period 2026-07 is before the start
    const rows = await installmentOccurrencesFor(userId)
    expect(rows).toHaveLength(1)
    expect(rows[0].period).toBe('2026-08')
  })
})

describe('clearUnsettledInstallmentOccurrences', () => {
  it('deletes pending and overdue occurrences, leaving settled ones', async () => {
    const userId = `test-${randomUUID()}`
    const inst = await seedInstallment(userId)
    await db.insert(occurrences).values([
      { userId, kind: 'installment', sourceId: inst.id, period: '2026-06', dueDate: '2026-06-15', expectedAmountMinor: 50000, status: 'overdue' },
      { userId, kind: 'installment', sourceId: inst.id, period: '2026-07', dueDate: '2026-07-15', expectedAmountMinor: 50000, status: 'pending' },
      { userId, kind: 'installment', sourceId: inst.id, period: '2026-05', dueDate: '2026-05-15', expectedAmountMinor: 50000, status: 'confirmed' },
      { userId, kind: 'installment', sourceId: inst.id, period: '2026-04', dueDate: '2026-04-15', expectedAmountMinor: 50000, status: 'skipped' },
    ])
    await clearUnsettledInstallmentOccurrences(inst.id)
    const rows = await installmentOccurrencesFor(userId)
    expect(rows.map((r) => r.status).sort()).toEqual(['confirmed', 'skipped'])
  })
})

describe('rewritePendingOccurrences', () => {
  it('rewrites pending occurrences to the new amount and clamped due day', async () => {
    const userId = `test-${randomUUID()}`
    const bill = await seedBill(userId, 10)
    await housekeeping(userId, '2026-02-05')
    await db
      .update(bills)
      .set({ amountMinor: 1600000, dueDay: 31 })
      .where(eq(bills.id, bill.id))
    await rewritePendingOccurrences('bill', bill.id)
    const rows = await billOccurrencesFor(userId)
    const byPeriod = Object.fromEntries(rows.map((r) => [r.period, r]))
    expect(byPeriod['2026-02']).toMatchObject({
      expectedAmountMinor: 1600000,
      dueDate: '2026-02-28',
    })
    expect(byPeriod['2026-03']).toMatchObject({
      expectedAmountMinor: 1600000,
      dueDate: '2026-03-31',
    })
  })

  it('never touches confirmed occurrences', async () => {
    const userId = `test-${randomUUID()}`
    const bill = await seedBill(userId, 10)
    await housekeeping(userId, '2026-02-05')
    const rows = await billOccurrencesFor(userId)
    const feb = rows.find((r) => r.period === '2026-02')!
    await db
      .update(occurrences)
      .set({ status: 'confirmed' })
      .where(eq(occurrences.id, feb.id))
    await db
      .update(bills)
      .set({ amountMinor: 9999 })
      .where(eq(bills.id, bill.id))
    await rewritePendingOccurrences('bill', bill.id)
    const [after] = await db
      .select()
      .from(occurrences)
      .where(eq(occurrences.id, feb.id))
    expect(after.expectedAmountMinor).toBe(1500000) // untouched
  })

  it('works for income sources too', async () => {
    const userId = `test-${randomUUID()}`
    const source = await seedIncomeSource(userId, 25)
    await housekeeping(userId, '2026-07-10')
    await db
      .update(incomeSources)
      .set({ amountMinor: 300000, dayOfMonth: 1 })
      .where(eq(incomeSources.id, source.id))
    await rewritePendingOccurrences('income', source.id)
    const rows = await occurrencesFor(userId)
    expect(rows.every((r) => r.expectedAmountMinor === 300000)).toBe(true)
    expect(rows.map((r) => r.dueDate).sort()).toEqual([
      '2026-07-01',
      '2026-08-01',
    ])
  })

  it('rewrites pending installment occurrences after a definition edit', async () => {
    const userId = `test-${randomUUID()}`
    const inst = await seedInstallment(userId)
    await housekeeping(userId, '2026-07-10')
    await db
      .update(installments)
      .set({ monthlyAmountMinor: 60000, dueDay: 1 })
      .where(eq(installments.id, inst.id))
    await rewritePendingOccurrences('installment', inst.id)
    const rows = await installmentOccurrencesFor(userId)
    expect(rows.every((r) => r.expectedAmountMinor === 60000)).toBe(true)
    expect(rows.map((r) => r.dueDate).sort()).toEqual([
      '2026-07-01',
      '2026-08-01',
    ])
  })
})
