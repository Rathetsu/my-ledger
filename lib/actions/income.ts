'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { db, dbPool } from '@/lib/db/client'
import { isAccountArchived } from '@/lib/db/queries'
import { incomeSources, transactions } from '@/lib/db/schema'
import {
  retractSurplusPendingOccurrences,
  rewritePendingOccurrences,
} from '@/lib/housekeeping'
import type { Currency } from '@/lib/money/money'
import {
  type ActionResult,
  NotFoundError,
  ownedActiveAccount,
  parseAmount,
} from './definitions'
import { incomeSourceInput, isUuid, windfallInput } from './schemas'

export async function createIncomeSource(
  input: unknown,
): Promise<ActionResult> {
  const user = await requireUser()
  const parsed = incomeSourceInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid input' }
  const account = await ownedActiveAccount(user.id, parsed.data.accountId)
  if (!account) {
    if (await isAccountArchived(user.id, parsed.data.accountId))
      return { ok: false, error: 'Account is archived — choose an active account' }
    return { ok: false, error: 'Account not found' }
  }
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
  if (!isUuid(id)) return { ok: false, error: 'Income source not found' }
  const parsed = incomeSourceInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid input' }
  const account = await ownedActiveAccount(user.id, parsed.data.accountId)
  if (!account) {
    if (await isAccountArchived(user.id, parsed.data.accountId))
      return { ok: false, error: 'Account is archived — choose an active account' }
    return { ok: false, error: 'Account not found' }
  }
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
        throw new NotFoundError('Income source not found')

      // Definition edits rewrite pending occurrences only (spec §3).
      await rewritePendingOccurrences('income', id, tx)

      // A non-recurring source keeps at most one pending occurrence.
      if (!parsed.data.recurring) {
        await retractSurplusPendingOccurrences(id, tx)
      }
    })
  } catch (e) {
    if (e instanceof NotFoundError) return { ok: false, error: e.message }
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
  if (!isUuid(id)) return { ok: false, error: 'Income source not found' }
  // Reactivating onto an archived account would re-arm housekeeping to seed
  // unconfirmable occurrences against a write-frozen account (spec §3).
  if (active) {
    const [source] = await db
      .select({ accountId: incomeSources.accountId })
      .from(incomeSources)
      .where(and(eq(incomeSources.id, id), eq(incomeSources.userId, user.id)))
    if (!source) return { ok: false, error: 'Income source not found' }
    if (await isAccountArchived(user.id, source.accountId))
      return { ok: false, error: 'Account is archived' }
  }
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
  if (!account) {
    if (await isAccountArchived(user.id, parsed.data.accountId))
      return { ok: false, error: 'Account is archived — choose an active account' }
    return { ok: false, error: 'Account not found' }
  }
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
