'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { wishlistInput, purchaseInput } from './schemas'
import { createItem, updateItem, deleteItem, purchaseItem, unpurchaseItem } from '@/lib/wishlist'

const idSchema = z.object({ id: z.string().uuid() })

function revalidateWishlistPaths() {
  revalidatePath('/wishlist')
  revalidatePath('/plan')
}

export async function createWishlistItem(raw: unknown) {
  const data = wishlistInput.parse(raw)
  const user = await requireUser()
  await createItem(user.id, data)
  revalidateWishlistPaths()
}

export async function updateWishlistItem(raw: unknown) {
  const { id, ...data } = wishlistInput.extend({ id: z.string().uuid() }).parse(raw)
  const user = await requireUser()
  await updateItem(user.id, id, data)
  revalidateWishlistPaths()
}

export async function deleteWishlistItem(raw: unknown) {
  const { id } = idSchema.parse(raw)
  const user = await requireUser()
  await deleteItem(user.id, id)
  revalidateWishlistPaths()
}

export async function purchaseWishlistItem(raw: unknown) {
  const data = purchaseInput.parse(raw)
  const user = await requireUser()
  await purchaseItem(user.id, data)
  revalidateWishlistPaths()
  revalidatePath('/accounts')
}

export async function unpurchaseWishlistItem(raw: unknown) {
  const { id } = idSchema.parse(raw)
  const user = await requireUser()
  await unpurchaseItem(user.id, id)
  revalidateWishlistPaths()
  revalidatePath('/accounts')
}
