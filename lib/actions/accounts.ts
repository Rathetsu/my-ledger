'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import { db, dbPool } from '@/lib/db/client'
import { accounts, transactions } from '@/lib/db/schema'
import { archiveBlockers } from '@/lib/db/queries'
import { todayCairo } from '@/lib/dates/cairo'
import { parseToMinor } from '@/lib/money/money'
import { type ActionResult } from './definitions'

// The shape every mutation in the app returns to useActionState.
export type ActionState = { error: string } | null

const createAccountSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  currency: z.enum(['EUR', 'USD', 'EGP']),
  openingBalance: z.string().trim(),
})

export async function createAccount(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser()
  const parsed = createAccountSchema.safeParse({
    name: formData.get('name'),
    currency: formData.get('currency'),
    openingBalance: formData.get('openingBalance') || '0',
  })
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues)
      fieldErrors[String(issue.path[0])] = issue.message
    return { ok: false, error: parsed.error.issues[0].message, fieldErrors }
  }

  let openingMinor: number
  try {
    openingMinor = parseToMinor(
      parsed.data.openingBalance,
      parsed.data.currency,
    )
  } catch {
    return { ok: false, error: 'Opening balance is not a valid amount' }
  }

  // Account row + opening transaction must land together.
  await dbPool.transaction(async (tx) => {
    const [account] = await tx
      .insert(accounts)
      .values({
        userId: user.id,
        name: parsed.data.name,
        currency: parsed.data.currency,
      })
      .returning()
    if (openingMinor !== 0) {
      await tx.insert(transactions).values({
        userId: user.id,
        accountId: account.id,
        type: 'opening',
        amountMinor: openingMinor,
        currency: parsed.data.currency,
        occurredOn: todayCairo(),
        note: 'Opening balance',
      })
    }
  })
  revalidatePath('/accounts')
  redirect('/accounts')
}

const renameSchema = z.object({
  accountId: z.string().uuid(),
  name: z.string().trim().min(1, 'Name is required').max(100),
})

export async function renameAccount(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser()
  const parsed = renameSchema.safeParse({
    accountId: formData.get('accountId'),
    name: formData.get('name'),
  })
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues)
      fieldErrors[String(issue.path[0])] = issue.message
    return { ok: false, error: parsed.error.issues[0].message, fieldErrors }
  }
  await db
    .update(accounts)
    .set({ name: parsed.data.name })
    .where(
      and(eq(accounts.id, parsed.data.accountId), eq(accounts.userId, user.id)),
    )
  revalidatePath('/accounts')
  redirect('/accounts')
}

export async function archiveAccount(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser()
  const parsed = z
    .object({ accountId: z.string().uuid() })
    .safeParse({ accountId: formData.get('accountId') })
  if (!parsed.success) return { ok: false, error: 'Invalid account' }

  // Archiving is blocked while any active definition targets the account
  // (spec §3). archiveBlockers returns active income sources and bills; P5 extends it.
  const blockers = await archiveBlockers(parsed.data.accountId, user.id)
  if (blockers.length > 0) {
    return {
      ok: false,
      error: `Cannot archive: still targeted by ${blockers.join(', ')}`,
    }
  }
  await db
    .update(accounts)
    .set({ archivedAt: new Date() })
    .where(
      and(eq(accounts.id, parsed.data.accountId), eq(accounts.userId, user.id)),
    )
  revalidatePath('/accounts')
  redirect('/accounts')
}
