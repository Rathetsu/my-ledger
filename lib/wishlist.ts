import { and, eq } from 'drizzle-orm'
import { db, dbPool } from '@/lib/db/client'
import { accounts, transactions, wishlistItems } from '@/lib/db/schema'
import { todayCairo } from '@/lib/dates/cairo'
import type { Currency } from '@/lib/money/money'

// Inline type mirrors lib/expense-categories.ts, keeping this module free of a
// dependency on the schema; it matches z.infer<typeof wishlistInput>.
type WishlistData = { name: string; costMinor: number; currency: string; priority: number; targetDate?: string }

export async function createItem(userId: string, data: WishlistData): Promise<void> {
  await db.insert(wishlistItems).values({
    userId,
    name: data.name,
    costMinor: data.costMinor,
    currency: data.currency as Currency,
    priority: data.priority,
    targetDate: data.targetDate ?? null,
  })
}

export async function updateItem(userId: string, id: string, data: WishlistData): Promise<void> {
  // currency is not editable once created; status changes only via the purchase flow;
  // the status='planned' clause keeps a purchased item immutable through this path.
  await db
    .update(wishlistItems)
    .set({
      name: data.name,
      costMinor: data.costMinor,
      priority: data.priority,
      targetDate: data.targetDate ?? null,
    })
    .where(and(eq(wishlistItems.id, id), eq(wishlistItems.userId, userId), eq(wishlistItems.status, 'planned')))
}

export async function deleteItem(userId: string, id: string): Promise<void> {
  const deleted = await db
    .delete(wishlistItems)
    .where(and(eq(wishlistItems.id, id), eq(wishlistItems.userId, userId), eq(wishlistItems.status, 'planned')))
    .returning()
  if (deleted.length === 0) throw new Error('Purchased items must be un-purchased before deleting')
}

export async function purchaseItem(
  userId: string,
  { itemId, accountId }: { itemId: string; accountId: string },
): Promise<void> {
  await dbPool.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(wishlistItems)
      .where(and(eq(wishlistItems.id, itemId), eq(wishlistItems.userId, userId)))
    if (!item || item.status !== 'planned') throw new Error('Item not found or already purchased')
    const [account] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
    // write-freeze guard (mandatory; wishlist has no archiveBlockers clause): account must be
    // owned, the right currency, AND not archived. Row already loaded, so no extra round trip.
    if (!account || account.currency !== item.currency) throw new Error('Account must hold the item currency')
    if (account.archivedAt) throw new Error('Account is archived')
    // shortfall is advisory and lives in the UI: no balance check here, negative balances are allowed
    const [txn] = await tx
      .insert(transactions)
      .values({
        userId,
        accountId,
        type: 'purchase',
        amountMinor: -item.costMinor, // outflow stored negative
        currency: item.currency,
        occurredOn: todayCairo(),
        note: `Wishlist: ${item.name}`,
        sourceType: 'wishlist_item', // free-text source_type; a one-time purchase, not an occurrence
        sourceId: item.id,
      })
      .returning()
    const updated = await tx
      .update(wishlistItems)
      .set({ status: 'purchased', transactionId: txn.id })
      .where(and(eq(wishlistItems.id, itemId), eq(wishlistItems.status, 'planned'))) // concurrency guard
      .returning()
    if (updated.length === 0) throw new Error('Item was purchased concurrently')
  })
}

export async function unpurchaseItem(userId: string, id: string): Promise<void> {
  await dbPool.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(wishlistItems)
      .where(and(eq(wishlistItems.id, id), eq(wishlistItems.userId, userId)))
    if (!item || item.status !== 'purchased') throw new Error('Item is not purchased')
    if (item.transactionId) {
      // deleting a source-linked transaction is a money-write: refuse if that account is now
      // archived (the write-freeze rule for every non-insert write, per the post-P5 remediation).
      const [txn] = await tx
        .select({ accountId: transactions.accountId })
        .from(transactions)
        .where(eq(transactions.id, item.transactionId))
      if (txn) {
        const [acct] = await tx
          .select({ archivedAt: accounts.archivedAt })
          .from(accounts)
          .where(eq(accounts.id, txn.accountId))
        if (acct?.archivedAt) throw new Error('Account is archived')
      }
    }
    const updated = await tx
      .update(wishlistItems)
      .set({ status: 'planned', transactionId: null })
      .where(and(eq(wishlistItems.id, id), eq(wishlistItems.status, 'purchased'))) // concurrency guard
      .returning()
    if (updated.length === 0) throw new Error('Item changed concurrently')
    if (item.transactionId) {
      await tx
        .delete(transactions)
        .where(and(eq(transactions.id, item.transactionId), eq(transactions.sourceType, 'wishlist_item')))
    }
  })
}
