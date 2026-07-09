'use client'

import { useActionState } from 'react'
import { createAccount, type ActionState } from '@/lib/actions/accounts'
import { CURRENCIES } from '@/lib/money/money'

export default function NewAccountPage() {
  const [state, formAction] = useActionState<ActionState, FormData>(createAccount, null)
  return (
    <form action={formAction} className="space-y-4">
      <h1 className="text-xl font-semibold">New account</h1>
      <label className="block">
        <span className="text-sm">Name</span>
        <input name="name" required className="mt-1 w-full rounded border p-3" />
      </label>
      <label className="block">
        <span className="text-sm">Currency</span>
        <select name="currency" className="mt-1 w-full rounded border p-3">
          {CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-sm">Opening balance</span>
        <input
          name="openingBalance"
          inputMode="decimal"
          placeholder="0.00"
          className="mt-1 w-full rounded border p-3"
        />
      </label>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button className="w-full rounded bg-blue-600 py-3 text-white">
        Create account
      </button>
    </form>
  )
}
