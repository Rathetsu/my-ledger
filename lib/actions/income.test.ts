import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { accounts, incomeSources, occurrences } from '@/lib/db/schema'
import { retractSurplusPendingOccurrences } from '@/lib/housekeeping'

// Exercises the SHIPPED retraction path (the recurring true->false rule that keeps
// only the earliest pending occurrence). Previously this test re-implemented the
// query in its body, so the production code could break while the test stayed green.
async function seedPending(periods: string[]) {
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
  for (const period of periods) {
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

function pendingPeriods(userId: string, sourceId: string) {
  return db
    .select({ period: occurrences.period })
    .from(occurrences)
    .where(
      and(eq(occurrences.userId, userId), eq(occurrences.sourceId, sourceId)),
    )
    .then((rows) => rows.map((r) => r.period).sort())
}

describe('retractSurplusPendingOccurrences (recurring -> false)', () => {
  it('keeps only the earliest pending period, deletes the rest', async () => {
    const { userId, source } = await seedPending(['2026-08', '2026-07', '2026-09'])
    await retractSurplusPendingOccurrences(source.id)
    expect(await pendingPeriods(userId, source.id)).toEqual(['2026-07'])
  })

  it('is a no-op with fewer than two pending occurrences', async () => {
    const { userId, source } = await seedPending(['2026-07'])
    await retractSurplusPendingOccurrences(source.id)
    expect(await pendingPeriods(userId, source.id)).toEqual(['2026-07'])
  })

  it('never deletes confirmed occurrences', async () => {
    const { userId, source } = await seedPending(['2026-07', '2026-08'])
    await db
      .update(occurrences)
      .set({ status: 'confirmed' })
      .where(
        and(
          eq(occurrences.sourceId, source.id),
          eq(occurrences.period, '2026-08'),
        ),
      )
    await retractSurplusPendingOccurrences(source.id)
    // 2026-07 pending is the only pending (so no-op), 2026-08 confirmed untouched
    expect(await pendingPeriods(userId, source.id)).toEqual(['2026-07', '2026-08'])
  })
})
