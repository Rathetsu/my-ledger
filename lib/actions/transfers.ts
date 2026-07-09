'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import { db, dbPool } from '@/lib/db/client'
import { accounts, transactions } from '@/lib/db/schema'
import { parseToMinor } from '@/lib/money/money'
import type { ActionState } from './accounts'

const transferSchema = z.object({
  fromAccountId: z.string().uuid(),
  toAccountId: z.string().uuid(),
  amountSent: z.string().trim().min(1, 'Amount sent is required'),
  amountReceived: z.string().trim().optional(),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date'),
  note: z.string().trim().max(500).optional(),
})

export async function createTransfer(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser()
  const parsed = transferSchema.safeParse({
    fromAccountId: formData.get('fromAccountId'),
    toAccountId: formData.get('toAccountId'),
    amountSent: formData.get('amountSent'),
    amountReceived: formData.get('amountReceived') || undefined,
    occurredOn: formData.get('occurredOn'),
    note: formData.get('note') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const d = parsed.data
  if (d.fromAccountId === d.toAccountId)
    return { error: 'Pick two different accounts' }

  const rows = await db
    .select()
    .from(accounts)
    .where(
      and(
        inArray(accounts.id, [d.fromAccountId, d.toAccountId]),
        eq(accounts.userId, user.id),
      ),
    )
  const from = rows.find((a) => a.id === d.fromAccountId)
  const to = rows.find((a) => a.id === d.toAccountId)
  if (!from || !to) return { error: 'Account not found' }

  const cross = from.currency !== to.currency
  if (cross && !d.amountReceived) {
    return { error: 'Enter the actual amount received (bank spread included)' }
  }

  let sentMinor: number
  let receivedMinor: number
  try {
    sentMinor = parseToMinor(d.amountSent, from.currency)
    receivedMinor = cross
      ? parseToMinor(d.amountReceived!, to.currency)
      : sentMinor
  } catch {
    return { error: 'Amounts must be valid numbers' }
  }
  if (sentMinor <= 0 || receivedMinor <= 0)
    return { error: 'Amounts must be positive' }

  // Two legs, one group, one DB transaction. No conversion happens here:
  // both figures are the user's actuals (ADR: two-leg transfers).
  const groupId = randomUUID()
  await dbPool.transaction(async (tx) => {
    await tx.insert(transactions).values([
      {
        userId: user.id,
        accountId: from.id,
        type: 'transfer_out',
        amountMinor: -sentMinor,
        currency: from.currency,
        occurredOn: d.occurredOn,
        note: d.note,
        transferGroupId: groupId,
      },
      {
        userId: user.id,
        accountId: to.id,
        type: 'transfer_in',
        amountMinor: receivedMinor,
        currency: to.currency,
        occurredOn: d.occurredOn,
        note: d.note,
        transferGroupId: groupId,
      },
    ])
  })
  revalidatePath('/transactions')
  revalidatePath('/accounts')
  revalidatePath('/')
  redirect(`/transfers/${groupId}`)
}
