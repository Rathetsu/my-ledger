import { and, eq } from 'drizzle-orm'
import { db, dbPool } from '@/lib/db/client'
import { expenseCategories, transactions } from '@/lib/db/schema'

// Plain async DB module (no 'use server'): these helpers take an explicit userId
// so they are unit-testable, while lib/actions/expense-categories.ts wraps them
// with requireUser()/revalidatePath and lib/actions/transactions.ts reuses the
// resolver. Behaviour must stay identical to the former inline action bodies.

export async function createExpenseCategory(
  userId: string,
  input: { name: string; icon?: string },
): Promise<void> {
  await db.insert(expenseCategories).values({ userId, name: input.name, icon: input.icon ?? null })
}

export async function updateExpenseCategory(
  userId: string,
  id: string,
  input: { name: string; icon?: string },
): Promise<void> {
  await db
    .update(expenseCategories)
    .set({ name: input.name, icon: input.icon ?? null })
    .where(and(eq(expenseCategories.id, id), eq(expenseCategories.userId, userId)))
}

export async function deleteExpenseCategory(userId: string, id: string): Promise<void> {
  await dbPool.transaction(async (tx) => {
    // No FK from transactions to expense_categories (tables are created in different phases);
    // clear references in the same transaction instead.
    await tx
      .update(transactions)
      .set({ categoryId: null })
      .where(and(eq(transactions.categoryId, id), eq(transactions.userId, userId)))
    await tx.delete(expenseCategories).where(and(eq(expenseCategories.id, id), eq(expenseCategories.userId, userId)))
  })
}

// Validates a client-supplied categoryId belongs to this user before it is stored
// (unguessable UUID, but this is a stored reference crossing a trust boundary);
// income never carries a category. Returns the owned id, else null.
export async function resolveExpenseCategoryId(
  userId: string,
  type: 'income' | 'expense',
  categoryId: string | null | undefined,
): Promise<string | null> {
  if (type !== 'expense' || !categoryId) return null
  const [cat] = await db
    .select({ id: expenseCategories.id })
    .from(expenseCategories)
    .where(and(eq(expenseCategories.id, categoryId), eq(expenseCategories.userId, userId)))
  return cat?.id ?? null
}
