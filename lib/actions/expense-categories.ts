'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import {
  createExpenseCategory,
  deleteExpenseCategory,
  updateExpenseCategory,
} from '@/lib/expense-categories'
import { categoryInput } from './schemas'

const idSchema = z.object({ id: z.string().uuid() })

function revalidateCategories() {
  revalidatePath('/expenses')
  revalidatePath('/expenses/categories')
}

export async function createCategory(raw: unknown) {
  const data = categoryInput.parse(raw)
  const user = await requireUser()
  await createExpenseCategory(user.id, data)
  revalidateCategories()
}

export async function updateCategory(raw: unknown) {
  const data = categoryInput.extend({ id: z.string().uuid() }).parse(raw)
  const user = await requireUser()
  await updateExpenseCategory(user.id, data.id, data)
  revalidateCategories()
}

export async function deleteCategory(raw: unknown) {
  const { id } = idSchema.parse(raw)
  const user = await requireUser()
  await deleteExpenseCategory(user.id, id)
  revalidateCategories()
}
