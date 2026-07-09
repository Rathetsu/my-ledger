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

const groupUpdateSchema = z.object({
  groupId: z.string().uuid(),
  amountSent: z.string().trim().min(1, 'Amount is required'),
  amountReceived: z.string().trim().optional(),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date'),
  note: z.string().trim().max(500).optional(),
})

async function loadGroupLegs(userId: string, groupId: string) {
  const legs = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.transferGroupId, groupId),
        eq(transactions.userId, userId),
      ),
    )
  const out = legs.find((l) => l.type === 'transfer_out')
  const inn = legs.find((l) => l.type === 'transfer_in')
  if (!out || !inn) return null
  return { out, inn }
}

export async function updateTransferGroup(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser()
  const parsed = groupUpdateSchema.safeParse({
    groupId: formData.get('groupId'),
    amountSent: formData.get('amountSent'),
    amountReceived: formData.get('amountReceived') || undefined,
    occurredOn: formData.get('occurredOn'),
    note: formData.get('note') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const d = parsed.data
  const group = await loadGroupLegs(user.id, d.groupId)
  if (!group) return { error: 'Transfer not found' }
  const cross = group.out.currency !== group.inn.currency
  if (cross && !d.amountReceived)
    return { error: 'Enter the actual amount received' }

  let sentMinor: number
  let receivedMinor: number
  try {
    sentMinor = parseToMinor(d.amountSent, group.out.currency)
    receivedMinor = cross
      ? parseToMinor(d.amountReceived!, group.inn.currency)
      : sentMinor
  } catch {
    return { error: 'Amounts must be valid numbers' }
  }
  if (sentMinor <= 0 || receivedMinor <= 0)
    return { error: 'Amounts must be positive' }

  // Legs mutate as a group, atomically (spec §3).
  await dbPool.transaction(async (tx) => {
    await tx
      .update(transactions)
      .set({
        amountMinor: -sentMinor,
        occurredOn: d.occurredOn,
        note: d.note ?? null,
      })
      .where(
        and(
          eq(transactions.id, group.out.id),
          eq(transactions.userId, user.id),
        ),
      )
    await tx
      .update(transactions)
      .set({
        amountMinor: receivedMinor,
        occurredOn: d.occurredOn,
        note: d.note ?? null,
      })
      .where(
        and(
          eq(transactions.id, group.inn.id),
          eq(transactions.userId, user.id),
        ),
      )
  })
  revalidatePath('/transactions')
  revalidatePath('/accounts')
  revalidatePath('/')
  revalidatePath(`/transfers/${d.groupId}`)
  redirect(`/transfers/${d.groupId}`)
}

export async function deleteTransferGroup(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser()
  const parsed = z
    .object({ groupId: z.string().uuid() })
    .safeParse({ groupId: formData.get('groupId') })
  if (!parsed.success) return { error: 'Invalid transfer' }

  await dbPool.transaction(async (tx) => {
    await tx
      .delete(transactions)
      .where(
        and(
          eq(transactions.transferGroupId, parsed.data.groupId),
          eq(transactions.userId, user.id),
        ),
      )
  })
  revalidatePath('/transactions')
  revalidatePath('/accounts')
  revalidatePath('/')
  redirect('/transactions')
}
