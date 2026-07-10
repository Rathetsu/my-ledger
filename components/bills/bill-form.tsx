'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createBill, setBillActive, updateBill } from '@/lib/actions/bills'

interface AccountOption {
  id: string
  name: string
  currency: string
}

interface BillValues {
  id: string
  name: string
  amount: string // decimal string, e.g. '2500.00'
  dueDay: number
  accountId: string
  active: boolean
}

export function BillForm({
  accounts,
  bill,
}: {
  accounts: AccountOption[]
  bill?: BillValues
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
      currency: account?.currency ?? 'EUR', // bill currency = source account currency
      dueDay: Number(f.get('dueDay')),
      accountId,
      active: bill?.active ?? true,
    }
    const result = bill
      ? await updateBill(bill.id, input)
      : await createBill(input)
    if (result.ok) router.push('/bills')
    else setError(result.error)
  }

  async function toggleActive() {
    if (!bill) return
    const result = await setBillActive(bill.id, !bill.active)
    if (result.ok) router.push('/bills')
    else setError(result.error)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 px-4 py-3">
      <label className="block text-sm">
        Name
        <input
          name="name"
          required
          defaultValue={bill?.name}
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        Amount
        <input
          name="amount"
          required
          inputMode="decimal"
          defaultValue={bill?.amount}
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        Account
        <select
          name="accountId"
          required
          defaultValue={bill?.accountId}
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
        Due day
        <input
          name="dueDay"
          type="number"
          min={1}
          max={31}
          required
          defaultValue={bill?.dueDay ?? 1}
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" className="w-full rounded bg-black py-3 text-white">
        {bill ? 'Save' : 'Create'}
      </button>
      {bill && (
        <button
          type="button"
          onClick={toggleActive}
          className="w-full rounded border py-3"
        >
          {bill.active ? 'Deactivate' : 'Reactivate'}
        </button>
      )}
    </form>
  )
}
