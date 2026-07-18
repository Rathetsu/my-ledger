'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { addWindfall } from '@/lib/actions/income'
import { todayCairo } from '@/lib/dates/cairo'

interface AccountOption {
  id: string
  name: string
  currency: string
}

export function WindfallForm({ accounts }: { accounts: AccountOption[] }) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const result = await addWindfall({
      accountId: String(f.get('accountId')),
      amount: String(f.get('amount')),
      date: String(f.get('date')),
      note: String(f.get('note') ?? ''),
    })
    if (result.ok) {
      formRef.current?.reset()
      setError(null)
      router.refresh()
    } else {
      setError(result.error)
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      className="space-y-2 rounded border p-3"
    >
      <select
        name="accountId"
        required
        className="w-full rounded border px-3 py-2 text-sm"
      >
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} ({a.currency})
          </option>
        ))}
      </select>
      <input
        name="amount"
        required
        inputMode="decimal"
        placeholder="Amount"
        aria-label="Windfall amount"
        className="w-full rounded border px-3 py-2 text-sm"
      />
      <input
        name="date"
        type="date"
        required
        defaultValue={todayCairo()}
        className="w-full rounded border px-3 py-2 text-sm"
      />
      <input
        name="note"
        placeholder="Note (optional)"
        className="w-full rounded border px-3 py-2 text-sm"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        className="min-h-11 w-full rounded border py-2 text-sm font-medium"
      >
        Add extra income
      </button>
    </form>
  )
}
