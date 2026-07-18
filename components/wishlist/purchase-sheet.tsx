'use client'

import { useState } from 'react'
import { purchaseWishlistItem } from '@/lib/actions/wishlist'
import { formatMoney, type Currency } from '@/lib/money/money'

export function PurchaseSheet({
  item,
  accounts,
}: {
  item: { id: string; name: string; costMinor: number; currency: Currency }
  accounts: { id: string; name: string; balanceMinor: number }[]
}) {
  const [open, setOpen] = useState(false)
  const [accountId, setAccountId] = useState(
    accounts.length === 1 ? accounts[0].id : '',
  )
  const [error, setError] = useState<string | null>(null)
  const selected = accounts.find((a) => a.id === accountId)
  const shortfall = selected ? item.costMinor - selected.balanceMinor : 0
  if (accounts.length === 0) {
    return (
      <p className="text-xs text-neutral-500">
        No {item.currency} account to buy from.
      </p>
    )
  }
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex min-h-11 w-full items-center justify-center rounded-lg border p-2 text-sm"
      >
        Buy
      </button>
    )
  }
  return (
    <form
      action={async () => {
        try {
          await purchaseWishlistItem({ itemId: item.id, accountId })
          setOpen(false)
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }}
      className="space-y-2"
    >
      <select
        value={accountId}
        onChange={(e) => setAccountId(e.target.value)}
        required
        aria-label="Buy from account"
        className="w-full rounded-lg border p-3"
      >
        {accounts.length > 1 && <option value="">Buy from…</option>}
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} (
            {formatMoney({
              amountMinor: a.balanceMinor,
              currency: item.currency,
            })}
            )
          </option>
        ))}
      </select>
      {selected && shortfall > 0 && (
        <p
          role="status"
          className="rounded bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300"
        >
          {selected.name} is short{' '}
          {formatMoney({ amountMinor: shortfall, currency: item.currency })};
          its balance will go negative. Purchases are never blocked.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          className="flex min-h-11 flex-1 items-center justify-center rounded-lg bg-neutral-900 p-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
        >
          Confirm purchase
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border px-3 text-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
