'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { deleteWishlistItem } from '@/lib/actions/wishlist'

export function DeleteItemForm({ id }: { id: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      action={async () => {
        try {
          await deleteWishlistItem({ id })
          router.push('/wishlist')
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }}
    >
      <button className="w-full rounded-lg border border-red-300 p-3 text-sm text-red-600">
        Delete item
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}
    </form>
  )
}
