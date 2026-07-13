import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { wishlistItems } from '@/lib/db/schema'
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
