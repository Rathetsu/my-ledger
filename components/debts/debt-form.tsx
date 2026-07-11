'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createDebt, updateDebt } from '@/lib/actions/debts'
import { parseToMinor, type Currency } from '@/lib/money/money'

type Existing = {
  id: string
  name: string
  originalMinor: number
  currency: Currency
  apr: number
  deadline: string | null
  minPaymentMinor: number | null
}

export function DebtForm({ existing }: { existing?: Existing }) {
  const router = useRouter()
  const [name, setName] = useState(existing?.name ?? '')
  const [currency, setCurrency] = useState<Currency>(existing?.currency ?? 'EUR')
  const [original, setOriginal] = useState(existing ? (existing.originalMinor / 100).toFixed(2) : '')
  const [apr, setApr] = useState(existing ? String(existing.apr) : '0')
  const [deadline, setDeadline] = useState(existing?.deadline ?? '')
  const [minPayment, setMinPayment] = useState(
    existing?.minPaymentMinor ? (existing.minPaymentMinor / 100).toFixed(2) : '',
  )
  return (
    <form
      action={async () => {
        const payload = {
          name,
          originalMinor: parseToMinor(original, currency),
          currency,
          apr: Number(apr),
          deadline: deadline || undefined,
          minPaymentMinor: minPayment ? parseToMinor(minPayment, currency) : undefined,
        }
        if (existing) await updateDebt({ id: existing.id, ...payload })
        else await createDebt(payload)
        router.push('/debts')
      }}
      className="space-y-3"
    >
      <label className="block text-sm">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required className="mt-1 w-full rounded-lg border p-3" />
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
      <label className="block text-sm">
        Original amount
        <input value={original} onChange={(e) => setOriginal(e.target.value)} inputMode="decimal" required className="mt-1 w-full rounded-lg border p-3" />
      </label>
      <label className="block text-sm">
        APR % (0 for interest-free)
        <input value={apr} onChange={(e) => setApr(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-lg border p-3" />
      </label>
      <label className="block text-sm">
        Deadline (optional; empty = pay ASAP)
        <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="mt-1 w-full rounded-lg border p-3" />
      </label>
      <label className="block text-sm">
        Minimum monthly payment (optional)
        <input value={minPayment} onChange={(e) => setMinPayment(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-lg border p-3" />
      </label>
      <button type="submit" className="w-full rounded-lg bg-neutral-900 p-3 text-white dark:bg-neutral-100 dark:text-neutral-900">
        Save
      </button>
    </form>
  )
}
