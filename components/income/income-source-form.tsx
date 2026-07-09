'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  createIncomeSource,
  setIncomeSourceActive,
  updateIncomeSource,
} from '@/lib/actions/income'

interface AccountOption {
  id: string
  name: string
  currency: string
}

interface SourceValues {
  id: string
  name: string
  amount: string // decimal string, e.g. '2500.00'
  dayOfMonth: number
  accountId: string
  recurring: boolean
  active: boolean
}

export function IncomeSourceForm({
  accounts,
  source,
}: {
  accounts: AccountOption[]
  source?: SourceValues
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const accountId = String(f.get('accountId'))
    const account = accounts.find((a) => a.id === accountId)
    const input = {
      name: String(f.get('name')),
      amount: String(f.get('amount')),
      currency: account?.currency ?? 'EUR', // source currency = target account currency
      dayOfMonth: Number(f.get('dayOfMonth')),
      accountId,
      recurring: f.get('recurring') === 'on',
      active: source?.active ?? true,
    }
    const result = source
      ? await updateIncomeSource(source.id, input)
      : await createIncomeSource(input)
    if (result.ok) router.push('/income')
    else setError(result.error)
  }

  async function toggleActive() {
    if (!source) return
    const result = await setIncomeSourceActive(source.id, !source.active)
    if (result.ok) router.push('/income')
    else setError(result.error)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 px-4 py-3">
      <label className="block text-sm">
        Name
        <input
          name="name"
          required
          defaultValue={source?.name}
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        Amount
        <input
          name="amount"
          required
          inputMode="decimal"
          defaultValue={source?.amount}
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        Account
        <select
          name="accountId"
          required
          defaultValue={source?.accountId}
          className="mt-1 w-full rounded border px-3 py-2"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.currency})
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        Day of month
        <input
          name="dayOfMonth"
          type="number"
          min={1}
          max={31}
          required
          defaultValue={source?.dayOfMonth ?? 25}
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          name="recurring"
          type="checkbox"
          defaultChecked={source?.recurring ?? true}
        />
        Recurring monthly
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" className="w-full rounded bg-black py-3 text-white">
        {source ? 'Save' : 'Create'}
      </button>
      {source && (
        <button
          type="button"
          onClick={toggleActive}
          className="w-full rounded border py-3"
        >
          {source.active ? 'Deactivate' : 'Reactivate'}
        </button>
      )}
    </form>
  )
}
