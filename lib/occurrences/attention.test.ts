import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { accounts, bills, incomeSources, occurrences } from '@/lib/db/schema'
import { getAttentionItems } from './attention'

async function seedScenario() {
  const userId = `test-${randomUUID()}`
  const [account] = await db
    .insert(accounts)
    .values({ userId, name: 'Main EGP', currency: 'EGP' })
    .returning()

  const [source] = await db
    .insert(incomeSources)
    .values({
      userId,
      name: 'Salary',
      amountMinor: 250000,
      currency: 'EGP',
      dayOfMonth: 20,
      accountId: account.id,
      recurring: true,
      active: true,
    })
    .returning()
  await db.insert(occurrences).values({
    userId,
    kind: 'income',
    sourceId: source.id,
    period: '2026-07',
    dueDate: '2026-07-20',
    expectedAmountMinor: 250000,
    status: 'pending',
  })

  async function seedBill(
    name: string,
    dueDate: string,
    status: 'pending' | 'overdue',
  ) {
    const [bill] = await db
      .insert(bills)
      .values({
        userId,
        name,
        amountMinor: 100000,
        currency: 'EGP',
        dueDay: 1,
        accountId: account.id,
        active: true,
      })
      .returning()
    await db.insert(occurrences).values({
      userId,
      kind: 'bill',
      sourceId: bill.id,
      period: '2026-07',
      dueDate,
      expectedAmountMinor: 100000,
      status,
    })
    return bill
  }

  await seedBill('Overdue', '2026-07-01', 'overdue')
  await seedBill('Soon', '2026-07-18', 'pending')
  await seedBill('Boundary', '2026-07-22', 'pending')
  await seedBill('Far', '2026-07-23', 'pending')

  return { userId }
}

describe('getAttentionItems', () => {
  it('merges pending/overdue income with bills overdue or due within 7 days, sorted by dueDate', async () => {
    const { userId } = await seedScenario()
    const items = await getAttentionItems(userId, '2026-07-15')

    expect(items).toHaveLength(4)
    expect(items.map((i) => i.dueDate)).toEqual([
      '2026-07-01', // Overdue
      '2026-07-18', // Soon
      '2026-07-20', // Salary/income
      '2026-07-22', // Boundary (today + 7, inclusive)
    ])
    expect(items.map((i) => i.sourceName)).not.toContain('Far')

    const income = items.find((i) => i.sourceName === 'Salary')!
    expect(income.kind).toBe('income')
    const bill = items.find((i) => i.sourceName === 'Soon')!
    expect(bill.kind).toBe('bill')
  })

  it('always includes an overdue bill regardless of how far in the past it is due', async () => {
    const userId = `test-${randomUUID()}`
    const [account] = await db
      .insert(accounts)
      .values({ userId, name: 'Main EGP', currency: 'EGP' })
      .returning()
    const [bill] = await db
      .insert(bills)
      .values({
        userId,
        name: 'Ancient',
        amountMinor: 100000,
        currency: 'EGP',
        dueDay: 1,
        accountId: account.id,
        active: true,
      })
      .returning()
    await db.insert(occurrences).values({
      userId,
      kind: 'bill',
      sourceId: bill.id,
      period: '2026-01',
      dueDate: '2026-01-01',
      expectedAmountMinor: 100000,
      status: 'overdue',
    })

    const items = await getAttentionItems(userId, '2026-07-15')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      sourceName: 'Ancient',
      kind: 'bill',
      dueDate: '2026-01-01',
    })
  })

  it('excludes occurrences whose account is archived (confirm would be a dead action)', async () => {
    const userId = `test-${randomUUID()}`
    const [account] = await db
      .insert(accounts)
      .values({ userId, name: 'Frozen EGP', currency: 'EGP' })
      .returning()
    const [bill] = await db
      .insert(bills)
      .values({
        userId,
        name: 'Frozen',
        amountMinor: 100000,
        currency: 'EGP',
        dueDay: 1,
        accountId: account.id,
        active: true,
      })
      .returning()
    await db.insert(occurrences).values({
      userId,
      kind: 'bill',
      sourceId: bill.id,
      period: '2026-07',
      dueDate: '2026-07-01',
      expectedAmountMinor: 100000,
      status: 'overdue',
    })
    await db
      .update(accounts)
      .set({ archivedAt: new Date() })
      .where(eq(accounts.id, account.id))

    const items = await getAttentionItems(userId, '2026-07-15')
    expect(items).toHaveLength(0)
  })
})
