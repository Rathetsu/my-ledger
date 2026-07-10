'use server'

import { and, eq, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { db, dbPool } from '@/lib/db/client'
import { isAccountArchived } from '@/lib/db/queries'
import { accounts, bills } from '@/lib/db/schema'
import { rewritePendingOccurrences } from '@/lib/housekeeping'
import { parseToMinor } from '@/lib/money/money'
import type { Currency } from '@/lib/money/money'
import { billInput, isUuid } from './schemas'

export type ActionResult = { ok: true } | { ok: false; error: string }

class UpdateBillError extends Error {}

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

function revalidateBillScreens() {
  revalidatePath('/bills')
  revalidatePath('/')
}

export async function createBill(input: unknown): Promise<ActionResult> {
  const user = await requireUser()
  const parsed = billInput.safeParse(input)
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

  await db.insert(bills).values({
    userId: user.id,
    name: parsed.data.name,
    amountMinor,
    currency: parsed.data.currency as Currency,
    dueDay: parsed.data.dueDay,
    accountId: parsed.data.accountId,
    active: parsed.data.active,
  })
  revalidateBillScreens()
  return { ok: true }
}

export async function updateBill(
  id: string,
  input: unknown,
): Promise<ActionResult> {
  const user = await requireUser()
  if (!isUuid(id)) return { ok: false, error: 'Bill not found' }
  const parsed = billInput.safeParse(input)
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

  // Definition update + pending-occurrence rewrite land together (atomicity
  // invariant, as updateIncomeSource).
  try {
    await dbPool.transaction(async (tx) => {
      const updated = await tx
        .update(bills)
        .set({
          name: parsed.data.name,
          amountMinor,
          currency: parsed.data.currency as Currency,
          dueDay: parsed.data.dueDay,
          accountId: parsed.data.accountId,
          active: parsed.data.active,
        })
        .where(and(eq(bills.id, id), eq(bills.userId, user.id)))
        .returning({ id: bills.id })
      if (updated.length !== 1) throw new UpdateBillError('Bill not found')

      // Definition edits rewrite pending occurrences only (spec §3).
      await rewritePendingOccurrences('bill', id, tx)
    })
  } catch (e) {
    if (e instanceof UpdateBillError) return { ok: false, error: e.message }
    throw e
  }

  revalidateBillScreens()
  return { ok: true }
}

export async function setBillActive(
  id: string,
  active: boolean,
): Promise<ActionResult> {
  const user = await requireUser()
  if (!isUuid(id)) return { ok: false, error: 'Bill not found' }
  // Reactivating onto an archived account would re-arm housekeeping to seed
  // unconfirmable occurrences against a write-frozen account (spec §3).
  if (active) {
    const [bill] = await db
      .select({ accountId: bills.accountId })
      .from(bills)
      .where(and(eq(bills.id, id), eq(bills.userId, user.id)))
    if (!bill) return { ok: false, error: 'Bill not found' }
    if (await isAccountArchived(user.id, bill.accountId))
      return { ok: false, error: 'Account is archived' }
  }
  const updated = await db
    .update(bills)
    .set({ active })
    .where(and(eq(bills.id, id), eq(bills.userId, user.id)))
    .returning({ id: bills.id })
  if (updated.length !== 1) return { ok: false, error: 'Bill not found' }
  revalidateBillScreens()
  return { ok: true }
}
