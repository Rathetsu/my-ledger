'use client'

import { useActionState } from 'react'
import type { ActionState } from '@/lib/actions/accounts'
import { postTransaction } from '@/lib/actions/transactions'

export interface AccountOption {
  id: string
  name: string
  currency: string
}

export function TransactionForm({
  accounts,
  defaultDate,
}: {
  accounts: AccountOption[]
  defaultDate: string
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    postTransaction,
    null,
  )
  return (
    <form action={formAction} className="space-y-4">
      <h1 className="text-xl font-semibold">New entry</h1>
      <label className="block">
        <span className="text-sm">Type</span>
        <select name="type" className="mt-1 w-full rounded border p-3">
          <option value="expense">expense</option>
          <option value="income">income</option>
        </select>
      </label>
      <label className="block">
        <span className="text-sm">Account</span>
        <select name="accountId" className="mt-1 w-full rounded border p-3">
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.currency})
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-sm">Amount</span>
        <input
          name="amount"
          inputMode="decimal"
          required
          className="mt-1 w-full rounded border p-3"
        />
      </label>
      <label className="block">
        <span className="text-sm">Date</span>
        <input
          type="date"
          name="occurredOn"
          defaultValue={defaultDate}
          required
          className="mt-1 w-full rounded border p-3"
        />
      </label>
      <label className="block">
        <span className="text-sm">Note</span>
        <input name="note" className="mt-1 w-full rounded border p-3" />
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" name="oneOff" className="h-5 w-5" />
        <span className="text-sm">One-off</span>
      </label>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button className="w-full rounded bg-blue-600 py-3 text-white">
        Save
      </button>
    </form>
  )
}
