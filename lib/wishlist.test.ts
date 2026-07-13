import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { accounts, transactions, wishlistItems } from '@/lib/db/schema'
import { purchaseItem, unpurchaseItem } from './wishlist'

async function seedAccount(userId: string, currency: 'EUR' | 'USD', archived = false) {
  const [account] = await db
    .insert(accounts)
    .values({ userId, name: `Acct ${randomUUID()}`, currency, ...(archived ? { archivedAt: new Date() } : {}) })
    .returning()
  return account
}

async function seedItem(userId: string, currency: 'EUR' | 'USD') {
  const [item] = await db
    .insert(wishlistItems)
    .values({ userId, name: `Item ${randomUUID()}`, costMinor: 12345, currency })
    .returning()
  return item
}

describe('purchaseItem', () => {
  it('happy path: marks purchased, links the transaction, posts the outflow', async () => {
    const userId = `test-${randomUUID()}`
    const account = await seedAccount(userId, 'EUR')
    const item = await seedItem(userId, 'EUR')

    await purchaseItem(userId, { itemId: item.id, accountId: account.id })

    const [updated] = await db.select().from(wishlistItems).where(eq(wishlistItems.id, item.id))
    expect(updated.status).toBe('purchased')
    expect(updated.transactionId).not.toBeNull()

    const txns = await db.select().from(transactions).where(eq(transactions.sourceId, item.id))
    expect(txns).toHaveLength(1)
    expect(txns[0].amountMinor).toBe(-item.costMinor)
    expect(txns[0].type).toBe('purchase')
    expect(txns[0].sourceType).toBe('wishlist_item')
  })

  it('refuses an archived account, leaving the item planned and no transaction posted', async () => {
    const userId = `test-${randomUUID()}`
    const account = await seedAccount(userId, 'EUR', true)
    const item = await seedItem(userId, 'EUR')

    await expect(purchaseItem(userId, { itemId: item.id, accountId: account.id })).rejects.toThrow(/archived/i)

    const [updated] = await db.select().from(wishlistItems).where(eq(wishlistItems.id, item.id))
    expect(updated.status).toBe('planned')
    const txns = await db.select().from(transactions).where(eq(transactions.sourceId, item.id))
    expect(txns).toHaveLength(0)
  })

  it('refuses a currency mismatch, leaving the item planned and no transaction posted', async () => {
    const userId = `test-${randomUUID()}`
    const account = await seedAccount(userId, 'USD')
    const item = await seedItem(userId, 'EUR')

    await expect(purchaseItem(userId, { itemId: item.id, accountId: account.id })).rejects.toThrow()

    const [updated] = await db.select().from(wishlistItems).where(eq(wishlistItems.id, item.id))
    expect(updated.status).toBe('planned')
    const txns = await db.select().from(transactions).where(eq(transactions.sourceId, item.id))
    expect(txns).toHaveLength(0)
  })
})

describe('unpurchaseItem', () => {
  it('happy path: reverts to planned, clears transactionId, deletes the transaction', async () => {
    const userId = `test-${randomUUID()}`
    const account = await seedAccount(userId, 'EUR')
    const item = await seedItem(userId, 'EUR')
    await purchaseItem(userId, { itemId: item.id, accountId: account.id })

    await unpurchaseItem(userId, item.id)

    const [updated] = await db.select().from(wishlistItems).where(eq(wishlistItems.id, item.id))
    expect(updated.status).toBe('planned')
    expect(updated.transactionId).toBeNull()
    const txns = await db.select().from(transactions).where(eq(transactions.sourceId, item.id))
    expect(txns).toHaveLength(0)
  })

  it('refuses when the account was archived after purchase, leaving the item purchased and the transaction intact', async () => {
    const userId = `test-${randomUUID()}`
    const account = await seedAccount(userId, 'EUR')
    const item = await seedItem(userId, 'EUR')
    await purchaseItem(userId, { itemId: item.id, accountId: account.id })
    await db.update(accounts).set({ archivedAt: new Date() }).where(eq(accounts.id, account.id))

    await expect(unpurchaseItem(userId, item.id)).rejects.toThrow(/archived/i)

    const [updated] = await db.select().from(wishlistItems).where(eq(wishlistItems.id, item.id))
    expect(updated.status).toBe('purchased')
    expect(updated.transactionId).not.toBeNull()
    const txns = await db.select().from(transactions).where(eq(transactions.sourceId, item.id))
    expect(txns).toHaveLength(1)
  })
})
