'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  createInstallment,
  updateInstallment,
} from '@/lib/actions/installments'

interface AccountOption {
  id: string
  name: string
  currency: string
}

interface InstallmentValues {
  id: string
  name: string
  amount: string // monthly, decimal string
  dueDay: number
  totalCount: number
  remainingCount: number
  startDate: string
  accountId: string
  apr: number | null
  active: boolean
}

export function InstallmentForm({
  accounts,
  installment,
}: {
  accounts: AccountOption[]
  installment?: InstallmentValues
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const accountId = String(f.get('accountId'))
    const account = accounts.find((a) => a.id === accountId)
    const aprRaw = String(f.get('apr') ?? '').trim()
    const base = {
      name: String(f.get('name')),
      amount: String(f.get('amount')),
      currency: account?.currency ?? 'EUR', // installment currency = source account currency
      dueDay: Number(f.get('dueDay')),
      totalCount: Number(f.get('totalCount')),
      startDate: String(f.get('startDate')),
      accountId,
      apr: aprRaw === '' ? null : Number(aprRaw),
    }
    const result = installment
      ? await updateInstallment(installment.id, {
          ...base,
          remainingCount: Number(f.get('remainingCount')),
          active: installment.active,
        })
      : await createInstallment(base)
    if (result.ok) router.push('/installments')
    else setError(result.error)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 px-4 py-3">
      <label className="block text-sm">
        Name
        <input
          name="name"
          required
          defaultValue={installment?.name}
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        Monthly amount
        <input
          name="amount"
          required
          inputMode="decimal"
          defaultValue={installment?.amount}
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        Account
        <select
          name="accountId"
          required
          defaultValue={installment?.accountId}
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
          defaultValue={installment?.dueDay ?? 1}
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        Total payments
        <input
          name="totalCount"
          type="number"
          min={1}
          max={240}
          required
          defaultValue={installment?.totalCount ?? 12}
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </label>
      {installment && (
        <label className="block text-sm">
          Payments remaining
          <input
            name="remainingCount"
            type="number"
            min={0}
            required
            defaultValue={installment.remainingCount}
            className="mt-1 w-full rounded border px-3 py-2"
          />
        </label>
      )}
      <label className="block text-sm">
        Start date
        <input
          name="startDate"
          type="date"
          required
          defaultValue={installment?.startDate}
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        APR % (optional)
        <input
          name="apr"
          type="number"
          step="0.01"
          min={0}
          defaultValue={installment?.apr ?? undefined}
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" className="w-full rounded bg-black py-3 text-white">
        {installment ? 'Save' : 'Create'}
      </button>
    </form>
  )
}
