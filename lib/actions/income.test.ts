import { randomUUID } from 'node:crypto'
import { and, eq, gt } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { accounts, incomeSources, occurrences } from '@/lib/db/schema'

// M3: updateIncomeSource can't run under Vitest (it calls requireUser via
// 'use server'), so this exercises the load-bearing part in isolation: the
// recurring true->false retraction query that keeps the earliest pending
// occurrence and deletes the rest. Verifies the string-min + gt('YYYY-MM')
// semantics against real Postgres.
async function seedThreePending() {
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
      recurring: false,
      active: true,
    })
    .returning()
  for (const period of ['2026-08', '2026-07', '2026-09']) {
    await db.insert(occurrences).values({
      userId,
      kind: 'income',
      sourceId: source.id,
      period,
      dueDate: `${period}-25`,
      expectedAmountMinor: 250000,
      status: 'pending',
    })
  }
  return { userId, source }
}

describe('retract surplus pending occurrences (recurring -> false)', () => {
  it('keeps only the earliest pending period', async () => {
    const { userId, source } = await seedThreePending()

    const pending = await db
      .select()
      .from(occurrences)
      .where(
        and(
          eq(occurrences.userId, userId),
          eq(occurrences.kind, 'income'),
          eq(occurrences.sourceId, source.id),
          eq(occurrences.status, 'pending'),
        ),
      )
    const minPeriod = pending.reduce(
      (m, o) => (o.period < m ? o.period : m),
      pending[0].period,
    )
    await db
      .delete(occurrences)
      .where(
        and(
          eq(occurrences.userId, userId),
          eq(occurrences.kind, 'income'),
          eq(occurrences.sourceId, source.id),
          eq(occurrences.status, 'pending'),
          gt(occurrences.period, minPeriod),
        ),
      )

    const remaining = await db
      .select({ period: occurrences.period })
      .from(occurrences)
      .where(
        and(
          eq(occurrences.userId, userId),
          eq(occurrences.sourceId, source.id),
        ),
      )
    expect(remaining.map((r) => r.period)).toEqual(['2026-07'])
  })
})
