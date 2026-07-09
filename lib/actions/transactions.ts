'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { accounts, transactions } from '@/lib/db/schema'
import { parseToMinor } from '@/lib/money/money'
import { directMutability } from '@/lib/transactions/mutability'
import { signedAmountForEdit } from '@/lib/transactions/sign'
import type { ActionState } from './accounts'

const postSchema = z.object({
  accountId: z.string().uuid(),
  type: z.enum(['income', 'expense']),
  amount: z.string().trim().min(1, 'Amount is required'),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date'),
  note: z.string().trim().max(500).optional(),
})

export async function postTransaction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser()
  const parsed = postSchema.safeParse({
    accountId: formData.get('accountId'),
    type: formData.get('type'),
    amount: formData.get('amount'),
    occurredOn: formData.get('occurredOn'),
    note: formData.get('note') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const d = parsed.data
  const oneOff = formData.get('oneOff') === 'on'

  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, d.accountId), eq(accounts.userId, user.id)))
  if (!account) return { error: 'Account not found' }
  if (account.archivedAt) return { error: 'Account is archived' }

  let amountMinor: number
  try {
    amountMinor = parseToMinor(d.amount, account.currency)
  } catch {
    return { error: 'Amount is not a valid number' }
  }
  if (amountMinor <= 0) return { error: 'Amount must be positive' }

  await db.insert(transactions).values({
    userId: user.id,
    accountId: account.id,
    type: d.type,
    // Sign convention: inflows positive, outflows negative.
    amountMinor: d.type === 'expense' ? -amountMinor : amountMinor,
    currency: account.currency,
    occurredOn: d.occurredOn,
    note: d.note,
    oneOff,
    categoryId: null, // categories arrive in P6
  })
  revalidatePath('/transactions')
  revalidatePath('/accounts')
  revalidatePath('/')
  redirect('/transactions')
}

const updateSchema = z.object({
  transactionId: z.string().uuid(),
  amount: z.string().trim().min(1, 'Amount is required'),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date'),
  note: z.string().trim().max(500).optional(),
})

// Explicit return type: without it, TS cross-widens the two branches'
// object-literal returns (adding optional `txn`/`error` counterparts),
// which defeats `'error' in loaded` narrowing at the call sites below.
async function loadOwnedPlainRow(
  userId: string,
  transactionId: string,
): Promise<{ error: string } | { txn: typeof transactions.$inferSelect }> {
  const [txn] = await db
    .select()
    .from(transactions)
    .where(
      and(eq(transactions.id, transactionId), eq(transactions.userId, userId)),
    )
  if (!txn) return { error: 'Entry not found' as const }
  const m = directMutability(txn)
  if (!m.ok) return { error: m.reason }
  return { txn }
}

export async function updateTransaction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser()
  const parsed = updateSchema.safeParse({
    transactionId: formData.get('transactionId'),
    amount: formData.get('amount'),
    occurredOn: formData.get('occurredOn'),
    note: formData.get('note') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const loaded = await loadOwnedPlainRow(user.id, parsed.data.transactionId)
  if ('error' in loaded) return { error: loaded.error }
  const { txn } = loaded

  let amountMinor: number
  try {
    amountMinor = parseToMinor(parsed.data.amount, txn.currency)
  } catch {
    return { error: 'Amount is not a valid number' }
  }
  if (amountMinor <= 0) return { error: 'Amount must be positive' }
  // Re-apply the sign convention by type; opening/adjustment keep the raw sign.
  const signed = signedAmountForEdit(txn.type, txn.amountMinor, amountMinor)

  await db
    .update(transactions)
    .set({
      amountMinor: signed,
      occurredOn: parsed.data.occurredOn,
      note: parsed.data.note ?? null,
      oneOff: formData.get('oneOff') === 'on',
    })
    .where(and(eq(transactions.id, txn.id), eq(transactions.userId, user.id)))
  revalidatePath('/transactions')
  revalidatePath('/accounts')
  revalidatePath('/')
  redirect('/transactions')
}

export async function deleteTransaction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser()
  const parsed = z
    .object({ transactionId: z.string().uuid() })
    .safeParse({ transactionId: formData.get('transactionId') })
  if (!parsed.success) return { error: 'Invalid entry' }
  const loaded = await loadOwnedPlainRow(user.id, parsed.data.transactionId)
  if ('error' in loaded) return { error: loaded.error }

  await db
    .delete(transactions)
    .where(
      and(eq(transactions.id, loaded.txn.id), eq(transactions.userId, user.id)),
    )
  revalidatePath('/transactions')
  revalidatePath('/accounts')
  revalidatePath('/')
  redirect('/transactions')
}
