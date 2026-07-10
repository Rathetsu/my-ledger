'use server'

import { and, eq, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { db, dbPool } from '@/lib/db/client'
import { isAccountArchived } from '@/lib/db/queries'
import { accounts, installments } from '@/lib/db/schema'
import {
  clearUnsettledInstallmentOccurrences,
  rewritePendingOccurrences,
} from '@/lib/housekeeping'
import { parseToMinor } from '@/lib/money/money'
import type { Currency } from '@/lib/money/money'
import { installmentInput, installmentUpdateInput, isUuid } from './schemas'

export type ActionResult = { ok: true } | { ok: false; error: string }

class UpdateInstallmentError extends Error {}

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

function revalidateInstallmentScreens() {
  revalidatePath('/installments')
  revalidatePath('/')
}

export async function createInstallment(input: unknown): Promise<ActionResult> {
  const user = await requireUser()
  const parsed = installmentInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid input' }
  const account = await ownedActiveAccount(user.id, parsed.data.accountId)
  if (!account) {
    if (await isAccountArchived(user.id, parsed.data.accountId))
      return { ok: false, error: 'Account is archived — choose an active account' }
    return { ok: false, error: 'Account not found' }
  }
  if (account.currency !== parsed.data.currency)
    return { ok: false, error: 'Account currency must match' }
  const monthlyAmountMinor = parseAmount(
    parsed.data.amount,
    parsed.data.currency as Currency,
  )
  if (monthlyAmountMinor === null) return { ok: false, error: 'Invalid amount' }

  await db.insert(installments).values({
    userId: user.id,
    name: parsed.data.name,
    monthlyAmountMinor,
    currency: parsed.data.currency as Currency,
    dueDay: parsed.data.dueDay,
    totalCount: parsed.data.totalCount,
    remainingCount: parsed.data.totalCount, // creation starts the full countdown
    startDate: parsed.data.startDate,
    accountId: parsed.data.accountId,
    apr: parsed.data.apr,
    active: true,
  })
  revalidateInstallmentScreens()
  return { ok: true }
}

export async function updateInstallment(
  id: string,
  input: unknown,
): Promise<ActionResult> {
  const user = await requireUser()
  if (!isUuid(id)) return { ok: false, error: 'Installment not found' }
  const parsed = installmentUpdateInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid input' }
  const account = await ownedActiveAccount(user.id, parsed.data.accountId)
  if (!account) {
    if (await isAccountArchived(user.id, parsed.data.accountId))
      return { ok: false, error: 'Account is archived — choose an active account' }
    return { ok: false, error: 'Account not found' }
  }
  if (account.currency !== parsed.data.currency)
    return { ok: false, error: 'Account currency must match' }
  const monthlyAmountMinor = parseAmount(
    parsed.data.amount,
    parsed.data.currency as Currency,
  )
  if (monthlyAmountMinor === null) return { ok: false, error: 'Invalid amount' }

  // Definition update + pending-occurrence rewrite land together (atomicity
  // invariant, as updateBill/updateIncomeSource).
  try {
    await dbPool.transaction(async (tx) => {
      const updated = await tx
        .update(installments)
        .set({
          name: parsed.data.name,
          monthlyAmountMinor,
          currency: parsed.data.currency as Currency,
          dueDay: parsed.data.dueDay,
          totalCount: parsed.data.totalCount,
          remainingCount: parsed.data.remainingCount, // editable for prepays/corrections
          startDate: parsed.data.startDate,
          accountId: parsed.data.accountId,
          apr: parsed.data.apr,
          active: parsed.data.remainingCount === 0 ? false : parsed.data.active, // 0 left = complete
        })
        .where(and(eq(installments.id, id), eq(installments.userId, user.id)))
        .returning({ id: installments.id })
      if (updated.length !== 1)
        throw new UpdateInstallmentError('Installment not found')

      // prepay / skip / policy change = definition edit; pending occurrences rewrite (spec §5.5, §3)
      await rewritePendingOccurrences('installment', id, tx)
      // Paid off via edit (0 remaining) = complete: clear leftover unsettled
      // occurrences so they don't linger unconfirmable in Attention (same as the
      // confirm-completion path).
      if (parsed.data.remainingCount === 0) {
        await clearUnsettledInstallmentOccurrences(id, tx)
      }
    })
  } catch (e) {
    if (e instanceof UpdateInstallmentError)
      return { ok: false, error: e.message }
    throw e
  }

  revalidateInstallmentScreens()
  return { ok: true }
}
