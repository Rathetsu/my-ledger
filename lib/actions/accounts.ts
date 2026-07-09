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

// The shape every mutation in the app returns to useActionState.
export type ActionState = { error: string } | null

const createAccountSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  currency: z.enum(['EUR', 'USD', 'EGP']),
  openingBalance: z.string().trim(),
})

export async function createAccount(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser()
  const parsed = createAccountSchema.safeParse({
    name: formData.get('name'),
    currency: formData.get('currency'),
    openingBalance: formData.get('openingBalance') || '0',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  let openingMinor: number
  try {
    openingMinor = parseToMinor(parsed.data.openingBalance, parsed.data.currency)
  } catch {
    return { error: 'Opening balance is not a valid amount' }
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
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser()
  const parsed = renameSchema.safeParse({
    accountId: formData.get('accountId'),
    name: formData.get('name'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  await db
    .update(accounts)
    .set({ name: parsed.data.name })
    .where(and(eq(accounts.id, parsed.data.accountId), eq(accounts.userId, user.id)))
  revalidatePath('/accounts')
  redirect('/accounts')
}

export async function archiveAccount(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser()
  const parsed = z
    .object({ accountId: z.string().uuid() })
    .safeParse({ accountId: formData.get('accountId') })
  if (!parsed.success) return { error: 'Invalid account' }

  // Archiving is blocked while any active definition targets the account
  // (spec §3). archiveBlockers is a P1 stub returning []; P3/P4/P5 feed it.
  const blockers = await archiveBlockers(parsed.data.accountId)
  if (blockers.length > 0) {
    return { error: `Cannot archive: still targeted by ${blockers.join(', ')}` }
  }
  await db
    .update(accounts)
    .set({ archivedAt: new Date() })
    .where(and(eq(accounts.id, parsed.data.accountId), eq(accounts.userId, user.id)))
  revalidatePath('/accounts')
  redirect('/accounts')
}
