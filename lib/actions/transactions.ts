'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { accounts, transactions } from '@/lib/db/schema'
import { parseToMinor } from '@/lib/money/money'
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
