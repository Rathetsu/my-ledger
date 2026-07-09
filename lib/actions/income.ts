'use server'

import { and, eq, gt, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { dueDateFor } from '@/lib/dates/cairo'
import { db, dbPool } from '@/lib/db/client'
import {
  accounts,
  incomeSources,
  occurrences,
  transactions,
} from '@/lib/db/schema'
import { parseToMinor } from '@/lib/money/money'
import type { Currency } from '@/lib/money/money'
import { incomeSourceInput, windfallInput } from './schemas'

export type ActionResult = { ok: true } | { ok: false; error: string }

class UpdateIncomeSourceError extends Error {}

async function ownedActiveAccount(userId: string, accountId: string) {
  const [account] = await db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.id, accountId),
        eq(accounts.userId, userId),
        isNull(accounts.archivedAt),
      ),
    )
  return account ?? null
}

function parseAmount(amount: string, currency: Currency): number | null {
  try {
    const minor = parseToMinor(amount, currency)
    return minor > 0 ? minor : null
  } catch {
    return null
  }
}

export async function createIncomeSource(
  input: unknown,
): Promise<ActionResult> {
  const user = await requireUser()
  const parsed = incomeSourceInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid input' }
  const account = await ownedActiveAccount(user.id, parsed.data.accountId)
  if (!account) return { ok: false, error: 'Account not found' }
  if (account.currency !== parsed.data.currency)
    return { ok: false, error: 'Account currency must match' }
  const amountMinor = parseAmount(
    parsed.data.amount,
    parsed.data.currency as Currency,
  )
  if (amountMinor === null) return { ok: false, error: 'Invalid amount' }

  await db.insert(incomeSources).values({
    userId: user.id,
    name: parsed.data.name,
    amountMinor,
    currency: parsed.data.currency as Currency,
    dayOfMonth: parsed.data.dayOfMonth,
    accountId: parsed.data.accountId,
    recurring: parsed.data.recurring,
    active: parsed.data.active,
  })
  revalidatePath('/income')
  revalidatePath('/')
  return { ok: true }
}

export async function updateIncomeSource(
  id: string,
  input: unknown,
): Promise<ActionResult> {
  const user = await requireUser()
  const parsed = incomeSourceInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid input' }
  const account = await ownedActiveAccount(user.id, parsed.data.accountId)
  if (!account) return { ok: false, error: 'Account not found' }
  if (account.currency !== parsed.data.currency)
    return { ok: false, error: 'Account currency must match' }
  const amountMinor = parseAmount(
    parsed.data.amount,
    parsed.data.currency as Currency,
  )
  if (amountMinor === null) return { ok: false, error: 'Invalid amount' }

  // Source update + pending-occurrence rewrite must land together.
  try {
    await dbPool.transaction(async (tx) => {
      const updated = await tx
        .update(incomeSources)
        .set({
          name: parsed.data.name,
          amountMinor,
          currency: parsed.data.currency as Currency,
          dayOfMonth: parsed.data.dayOfMonth,
          accountId: parsed.data.accountId,
          recurring: parsed.data.recurring,
          active: parsed.data.active,
        })
        .where(and(eq(incomeSources.id, id), eq(incomeSources.userId, user.id)))
        .returning({ id: incomeSources.id })
      if (updated.length !== 1)
        throw new UpdateIncomeSourceError('Income source not found')

      // Definition edits rewrite pending occurrences only (spec §3).
      // P4 extracts this loop into rewritePendingOccurrences(kind, sourceId) in lib/housekeeping.
      const pending = await tx
        .select()
        .from(occurrences)
        .where(
          and(
            eq(occurrences.userId, user.id),
            eq(occurrences.kind, 'income'),
            eq(occurrences.sourceId, id),
            eq(occurrences.status, 'pending'),
          ),
        )
      for (const occ of pending) {
        await tx
          .update(occurrences)
          .set({
            expectedAmountMinor: amountMinor,
            dueDate: dueDateFor(occ.period, parsed.data.dayOfMonth),
          })
          .where(eq(occurrences.id, occ.id))
      }

      // recurring true->false: a non-recurring source keeps at most one pending
      // occurrence. Housekeeping seeds current + next; drop everything after the
      // earliest period (string min works on 'YYYY-MM'). Deterministic, no "today".
      if (!parsed.data.recurring && pending.length >= 2) {
        const minPeriod = pending.reduce(
          (m, o) => (o.period < m ? o.period : m),
          pending[0].period,
        )
        await tx
          .delete(occurrences)
          .where(
            and(
              eq(occurrences.userId, user.id),
              eq(occurrences.kind, 'income'),
              eq(occurrences.sourceId, id),
              eq(occurrences.status, 'pending'),
              gt(occurrences.period, minPeriod),
            ),
          )
      }
    })
  } catch (e) {
    if (e instanceof UpdateIncomeSourceError)
      return { ok: false, error: e.message }
    throw e
  }

  revalidatePath('/income')
  revalidatePath('/')
  return { ok: true }
}

export async function setIncomeSourceActive(
  id: string,
  active: boolean,
): Promise<ActionResult> {
  const user = await requireUser()
  const updated = await db
    .update(incomeSources)
    .set({ active })
    .where(and(eq(incomeSources.id, id), eq(incomeSources.userId, user.id)))
    .returning({ id: incomeSources.id })
  if (updated.length !== 1)
    return { ok: false, error: 'Income source not found' }
  revalidatePath('/income')
  revalidatePath('/')
  return { ok: true }
}

export async function addWindfall(input: unknown): Promise<ActionResult> {
  const user = await requireUser()
  const parsed = windfallInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid input' }
  const account = await ownedActiveAccount(user.id, parsed.data.accountId)
  if (!account) return { ok: false, error: 'Account not found' }
  const amountMinor = parseAmount(
    parsed.data.amount,
    account.currency as Currency,
  )
  if (amountMinor === null) return { ok: false, error: 'Invalid amount' }

  // Plain income transaction: no source_type, never projected by the planner (spec §5.3).
  await db.insert(transactions).values({
    userId: user.id,
    accountId: account.id,
    type: 'income',
    amountMinor,
    currency: account.currency as Currency,
    occurredOn: parsed.data.date,
    note: parsed.data.note,
    oneOff: false,
  })
  revalidatePath('/')
  revalidatePath('/income')
  revalidatePath('/accounts')
  return { ok: true }
}
