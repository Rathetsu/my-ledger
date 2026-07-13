'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createWishlistItem, updateWishlistItem } from '@/lib/actions/wishlist'
import { parseToMinor, type Currency } from '@/lib/money/money'

type Existing = { id: string; name: string; costMinor: number; currency: Currency; priority: number; targetDate: string | null }

export function WishlistItemForm({ existing }: { existing?: Existing }) {
  const router = useRouter()
  const [name, setName] = useState(existing?.name ?? '')
  const [currency, setCurrency] = useState<Currency>(existing?.currency ?? 'EUR')
  const [cost, setCost] = useState(existing ? (existing.costMinor / 100).toFixed(2) : '')
  const [priority, setPriority] = useState(existing ? String(existing.priority) : '3')
  const [targetDate, setTargetDate] = useState(existing?.targetDate ?? '')
  return (
    <form
      action={async () => {
        const payload = {
          name,
          costMinor: parseToMinor(cost, currency),
          currency,
          priority: Number(priority),
          targetDate: targetDate || undefined,
        }
        if (existing) {
          await updateWishlistItem({ id: existing.id, ...payload })
          router.push('/wishlist')
        } else {
          await createWishlistItem(payload)
          setName('')
          setCost('')
          setTargetDate('')
        }
      }}
      className="space-y-3"
    >
      <label className="block text-sm">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required className="mt-1 w-full rounded-lg border p-3" />
      </label>
      <div className="flex gap-2">
        <label className="block flex-1 text-sm">
          Cost
          <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" required className="mt-1 w-full rounded-lg border p-3" />
        </label>
        <label className="block text-sm">
          Currency
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as Currency)}
            disabled={!!existing}
            className="mt-1 w-full rounded-lg border p-3"
          >
            <option>EUR</option>
            <option>USD</option>
            <option>EGP</option>
          </select>
        </label>
      </div>
      <div className="flex gap-2">
        <label className="block flex-1 text-sm">
          Priority (1 = highest)
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className="mt-1 w-full rounded-lg border p-3">
            {['1', '2', '3', '4', '5'].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="block flex-1 text-sm">
          Target date (optional)
          <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="mt-1 w-full rounded-lg border p-3" />
        </label>
      </div>
      <button type="submit" className="w-full rounded-lg bg-neutral-900 p-3 text-white dark:bg-neutral-100 dark:text-neutral-900">
        {existing ? 'Save' : 'Add'}
      </button>
    </form>
  )
}
