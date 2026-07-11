import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { accounts, expenseCategories, transactions } from '@/lib/db/schema'
import {
  createExpenseCategory,
  deleteExpenseCategory,
  resolveExpenseCategoryId,
  updateExpenseCategory,
} from '@/lib/expense-categories'

// DB-backed against real Postgres, following lib/db/queries.test.ts. Exercises the
// SHIPPED helper bodies (ownership trust-boundary + cross-user delete isolation) so
// the production write-paths can't break while these tests stay green.
async function seedAccount(userId: string) {
  const [a] = await db
    .insert(accounts)
    .values({ userId, name: 'Main EUR', currency: 'EUR' })
    .returning()
  return a
}

async function seedCategory(userId: string, name = 'Groceries') {
  const [c] = await db
    .insert(expenseCategories)
    .values({ userId, name })
    .returning()
  return c
}

async function seedTaggedExpense(userId: string, accountId: string, categoryId: string) {
  const [t] = await db
    .insert(transactions)
    .values({
      userId,
      accountId,
      type: 'expense',
      amountMinor: -1000,
      currency: 'EUR',
      occurredOn: '2026-07-01',
      categoryId,
    })
    .returning()
  return t
}

function readCategory(id: string) {
  return db
    .select()
    .from(expenseCategories)
    .where(eq(expenseCategories.id, id))
    .then((rows) => rows[0])
}

function readTransactionCategory(id: string) {
  return db
    .select({ categoryId: transactions.categoryId })
    .from(transactions)
    .where(eq(transactions.id, id))
    .then((rows) => rows[0]?.categoryId)
}

describe('resolveExpenseCategoryId', () => {
  it('returns the id for an expense tagged with the user own category', async () => {
    const userId = `test-${randomUUID()}`
    const cat = await seedCategory(userId)
    expect(await resolveExpenseCategoryId(userId, 'expense', cat.id)).toBe(cat.id)
  })

  it('returns null for a categoryId owned by a different user (trust boundary)', async () => {
    const mine = `test-${randomUUID()}`
    const other = `test-${randomUUID()}`
    const otherCat = await seedCategory(other)
    expect(await resolveExpenseCategoryId(mine, 'expense', otherCat.id)).toBeNull()
  })

  it('returns null for a nonexistent categoryId', async () => {
    const userId = `test-${randomUUID()}`
    expect(await resolveExpenseCategoryId(userId, 'expense', randomUUID())).toBeNull()
  })

  it('returns null for income even with an owned categoryId', async () => {
    const userId = `test-${randomUUID()}`
    const cat = await seedCategory(userId)
    expect(await resolveExpenseCategoryId(userId, 'income', cat.id)).toBeNull()
  })

  it('returns null when categoryId is null or undefined', async () => {
    const userId = `test-${randomUUID()}`
    expect(await resolveExpenseCategoryId(userId, 'expense', null)).toBeNull()
    expect(await resolveExpenseCategoryId(userId, 'expense', undefined)).toBeNull()
  })
})

describe('deleteExpenseCategory', () => {
  it('deletes the owner category and nulls its tagged transactions, leaving other users untouched', async () => {
    const userA = `test-${randomUUID()}`
    const userB = `test-${randomUUID()}`
    const accA = await seedAccount(userA)
    const accB = await seedAccount(userB)
    const catA = await seedCategory(userA, 'A cat')
    const catB = await seedCategory(userB, 'B cat')
    const txA = await seedTaggedExpense(userA, accA.id, catA.id)
    const txB = await seedTaggedExpense(userB, accB.id, catB.id)

    await deleteExpenseCategory(userA, catA.id)

    expect(await readCategory(catA.id)).toBeUndefined()
    expect(await readTransactionCategory(txA.id)).toBeNull()
    // Cross-user isolation: B untouched.
    expect(await readCategory(catB.id)).toBeDefined()
    expect(await readTransactionCategory(txB.id)).toBe(catB.id)
  })
})

describe('createExpenseCategory / updateExpenseCategory', () => {
  it('creates a category readable back by its owner', async () => {
    const userId = `test-${randomUUID()}`
    await createExpenseCategory(userId, { name: 'Transport', icon: '🚌' })
    const [row] = await db
      .select()
      .from(expenseCategories)
      .where(eq(expenseCategories.userId, userId))
    expect(row).toMatchObject({ name: 'Transport', icon: '🚌' })
  })

  it('updates name/icon scoped to the owner; a different user is a no-op', async () => {
    const owner = `test-${randomUUID()}`
    const stranger = `test-${randomUUID()}`
    const cat = await seedCategory(owner, 'Old')

    await updateExpenseCategory(owner, cat.id, { name: 'New', icon: '🆕' })
    expect(await readCategory(cat.id)).toMatchObject({ name: 'New', icon: '🆕' })

    // Same id, wrong user: must not change anything (and(id, userId) scoping).
    await updateExpenseCategory(stranger, cat.id, { name: 'Hijacked' })
    expect(await readCategory(cat.id)).toMatchObject({ name: 'New', icon: '🆕' })
  })
})
