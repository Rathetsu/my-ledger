'use server'

import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db, dbPool } from '@/lib/db/client'
import { expenseCategories, transactions } from '@/lib/db/schema'
import { requireUser } from '@/lib/auth'

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  icon: z.string().trim().min(1).max(8).optional(),
})

const idSchema = z.object({ id: z.string().uuid() })

export async function createCategory(raw: unknown) {
  const data = categorySchema.parse(raw)
  const user = await requireUser()
  await db.insert(expenseCategories).values({ userId: user.id, name: data.name, icon: data.icon ?? null })
  revalidatePath('/expenses')
  revalidatePath('/expenses/categories')
}

export async function updateCategory(raw: unknown) {
  const data = categorySchema.extend({ id: z.string().uuid() }).parse(raw)
  const user = await requireUser()
  await db
    .update(expenseCategories)
    .set({ name: data.name, icon: data.icon ?? null })
    .where(and(eq(expenseCategories.id, data.id), eq(expenseCategories.userId, user.id)))
  revalidatePath('/expenses')
  revalidatePath('/expenses/categories')
}

export async function deleteCategory(raw: unknown) {
  const { id } = idSchema.parse(raw)
  const user = await requireUser()
  await dbPool.transaction(async (tx) => {
    // No FK from transactions to expense_categories (tables are created in different phases);
    // clear references in the same transaction instead.
    await tx
      .update(transactions)
      .set({ categoryId: null })
      .where(and(eq(transactions.categoryId, id), eq(transactions.userId, user.id)))
    await tx.delete(expenseCategories).where(and(eq(expenseCategories.id, id), eq(expenseCategories.userId, user.id)))
  })
  revalidatePath('/expenses')
  revalidatePath('/expenses/categories')
}
