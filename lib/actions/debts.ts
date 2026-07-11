'use server'

import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db/client'
import { flexibleDebts, transactions } from '@/lib/db/schema'
import { requireUser } from '@/lib/auth'
import { debtSchema } from './schemas'

const idSchema = z.object({ id: z.string().uuid() })

function revalidateDebtPaths() {
  revalidatePath('/debts')
  revalidatePath('/plan')
}

export async function createDebt(raw: unknown) {
  const data = debtSchema.parse(raw)
  const user = await requireUser()
  await db.insert(flexibleDebts).values({
    userId: user.id,
    name: data.name,
    originalMinor: data.originalMinor,
    currency: data.currency,
    apr: data.apr,
    deadline: data.deadline ?? null,
    minPaymentMinor: data.minPaymentMinor ?? null,
  })
  revalidateDebtPaths()
}

export async function updateDebt(raw: unknown) {
  const data = debtSchema.extend({ id: z.string().uuid() }).parse(raw)
  const user = await requireUser()
  await db
    .update(flexibleDebts)
    .set({
      name: data.name,
      originalMinor: data.originalMinor,
      apr: data.apr,
      deadline: data.deadline ?? null,
      minPaymentMinor: data.minPaymentMinor ?? null,
      // currency intentionally not editable once created: payments already reference it
    })
    .where(and(eq(flexibleDebts.id, data.id), eq(flexibleDebts.userId, user.id)))
  revalidateDebtPaths()
}

export async function deleteDebt(raw: unknown) {
  const { id } = idSchema.parse(raw)
  const user = await requireUser()
  const linked = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.sourceType, 'flexible_debt'), eq(transactions.sourceId, id)))
    .limit(1)
  if (linked.length > 0) throw new Error('This debt has payments; reverse them first')
  await db.delete(flexibleDebts).where(and(eq(flexibleDebts.id, id), eq(flexibleDebts.userId, user.id)))
  revalidateDebtPaths()
}
