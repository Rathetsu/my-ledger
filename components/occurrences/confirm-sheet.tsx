'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  confirmOccurrenceAction,
  skipOccurrenceAction,
} from '@/lib/actions/occurrences'
import type { AttentionItem } from '@/lib/occurrences/attention'

export function ConfirmSheet({
  item,
  onClose,
}: {
  item: AttentionItem
  onClose: () => void
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onConfirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    const f = new FormData(e.currentTarget)
    const result = await confirmOccurrenceAction({
      occurrenceId: item.occurrenceId,
      amount: String(f.get('amount')),
      currency: item.currency,
      date: String(f.get('date')),
    })
    setBusy(false)
    if (result.ok) {
      onClose()
      router.refresh()
    } else {
      setError(result.error)
    }
  }

  async function onSkip() {
    setBusy(true)
    const result = await skipOccurrenceAction({
      occurrenceId: item.occurrenceId,
    })
    setBusy(false)
    if (result.ok) {
      onClose()
      router.refresh()
    } else {
      setError(result.error)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <form
        onSubmit={onConfirm}
        onClick={(e) => e.stopPropagation()}
        className="absolute inset-x-0 bottom-0 space-y-3 rounded-t-2xl bg-white p-4"
      >
        <h3 className="font-semibold">{item.sourceName}</h3>
        <label className="block text-sm">
          Amount ({item.currency})
          <input
            name="amount"
            inputMode="decimal"
            defaultValue={(item.expectedAmountMinor / 100).toFixed(2)}
            className="mt-1 w-full rounded border px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          Date
          <input
            type="date"
            name="date"
            defaultValue={item.dueDate}
            className="mt-1 w-full rounded border px-3 py-2"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="grid grid-cols-3 gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-black py-3 text-white"
          >
            Confirm
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onSkip}
            className="rounded border py-3"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border py-3"
          >
            Not yet
          </button>
        </div>
      </form>
    </div>
  )
}
