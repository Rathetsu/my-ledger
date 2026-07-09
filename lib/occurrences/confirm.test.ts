import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import {
  accounts,
  incomeSources,
  occurrences,
  transactions,
} from '@/lib/db/schema'
import {
  confirmOccurrence,
  skipOccurrence,
  unconfirmOccurrence,
} from './confirm'

async function seed(status: 'pending' | 'overdue' = 'pending') {
  const userId = `test-${randomUUID()}`
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
      dayOfMonth: 25,
      accountId: account.id,
      recurring: true,
      active: true,
    })
    .returning()
  const [occ] = await db
    .insert(occurrences)
    .values({
      userId,
      kind: 'income',
      sourceId: source.id,
      period: '2026-07',
      dueDate: '2026-07-25',
      expectedAmountMinor: 250000,
      status,
    })
    .returning()
  return { userId, account, occ }
}

describe('confirmOccurrence', () => {
  it('posts an income transaction with the actual figures and links it', async () => {
    const { userId, account, occ } = await seed()
    const result = await confirmOccurrence({
      userId,
      occurrenceId: occ.id,
      actualAmountMinor: 260000,
      actualDate: '2026-07-26',
    })
    expect(result).toEqual({ ok: true })
    const [after] = await db
      .select()
      .from(occurrences)
      .where(eq(occurrences.id, occ.id))
    expect(after.status).toBe('confirmed')
    expect(after.transactionId).not.toBeNull()
    const [txn] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, after.transactionId!))
    expect(txn).toMatchObject({
      accountId: account.id,
      type: 'income',
      amountMinor: 260000, // inflow: positive
      currency: 'EUR',
      occurredOn: '2026-07-26',
      sourceType: 'income_occurrence',
      sourceId: occ.id,
    })
  })

  it('confirms an overdue occurrence too', async () => {
    const { userId, occ } = await seed('overdue')
    const result = await confirmOccurrence({
      userId,
      occurrenceId: occ.id,
      actualAmountMinor: 250000,
      actualDate: '2026-07-30',
    })
    expect(result).toEqual({ ok: true })
  })

  it('refuses to post into an archived (write-frozen) account', async () => {
    const { userId, account, occ } = await seed()
    await db
      .update(accounts)
      .set({ archivedAt: new Date() })
      .where(eq(accounts.id, account.id))
    const result = await confirmOccurrence({
      userId,
      occurrenceId: occ.id,
      actualAmountMinor: 250000,
      actualDate: '2026-07-25',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/archived/i)
    // The rollback must leave no transaction behind for this occurrence.
    expect(
      await db
        .select()
        .from(transactions)
        .where(eq(transactions.sourceId, occ.id)),
    ).toHaveLength(0)
  })

  it('rejects a second confirm (guard on status)', async () => {
    const { userId, occ } = await seed()
    await confirmOccurrence({
      userId,
      occurrenceId: occ.id,
      actualAmountMinor: 250000,
      actualDate: '2026-07-25',
    })
    const second = await confirmOccurrence({
      userId,
      occurrenceId: occ.id,
      actualAmountMinor: 250000,
      actualDate: '2026-07-25',
    })
    expect(second.ok).toBe(false)
    expect(
      await db
        .select()
        .from(transactions)
        .where(eq(transactions.sourceId, occ.id)),
    ).toHaveLength(1)
  })
})

describe('skipOccurrence', () => {
  it('settles the occurrence without posting a transaction', async () => {
    const { userId, occ } = await seed()
    expect(await skipOccurrence(userId, occ.id)).toEqual({ ok: true })
    const [after] = await db
      .select()
      .from(occurrences)
      .where(eq(occurrences.id, occ.id))
    expect(after.status).toBe('skipped')
    expect(
      await db
        .select()
        .from(transactions)
        .where(eq(transactions.sourceId, occ.id)),
    ).toHaveLength(0)
  })
})

describe('unconfirmOccurrence', () => {
  it('deletes the linked transaction and resets the occurrence to pending', async () => {
    const { userId, occ } = await seed()
    await confirmOccurrence({
      userId,
      occurrenceId: occ.id,
      actualAmountMinor: 260000,
      actualDate: '2026-07-26',
    })
    expect(await unconfirmOccurrence(userId, occ.id)).toEqual({ ok: true })
    const [after] = await db
      .select()
      .from(occurrences)
      .where(eq(occurrences.id, occ.id))
    expect(after.status).toBe('pending')
    expect(after.transactionId).toBeNull()
    expect(
      await db
        .select()
        .from(transactions)
        .where(eq(transactions.sourceId, occ.id)),
    ).toHaveLength(0)
  })

  it('rejects un-confirm of a non-confirmed occurrence', async () => {
    const { userId, occ } = await seed()
    const result = await unconfirmOccurrence(userId, occ.id)
    expect(result.ok).toBe(false)
  })
})
