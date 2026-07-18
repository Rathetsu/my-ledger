import { notFound } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { wishlistItems } from '@/lib/db/schema'
import { requireUser } from '@/lib/auth'
import { WishlistItemForm } from '@/components/wishlist/wishlist-item-form'
import { DeleteItemForm } from '@/components/wishlist/delete-item-form'
import type { Currency } from '@/lib/money/money'
import { redirect } from 'next/navigation'

export default async function WishlistItemPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await requireUser()
  const [item] = await db
    .select()
    .from(wishlistItems)
    .where(and(eq(wishlistItems.id, id), eq(wishlistItems.userId, user.id)))
  if (!item) notFound()
  if (item.status === 'purchased') redirect('/wishlist') // purchased items are edited by un-purchasing first

  return (
    <main className="mx-auto max-w-md space-y-4 p-4">
      <h1 className="text-xl font-semibold">{item.name}</h1>
      <WishlistItemForm
        existing={{
          id: item.id,
          name: item.name,
          costMinor: item.costMinor,
          currency: item.currency as Currency,
          priority: item.priority,
          targetDate: item.targetDate,
        }}
      />
      <DeleteItemForm id={item.id} />
    </main>
  )
}
