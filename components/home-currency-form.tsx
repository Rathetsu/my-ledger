'use client'

import { useActionState } from 'react'
import type { ActionState } from '@/lib/actions/accounts'
import { setHomeCurrency } from '@/lib/actions/settings'
import { CURRENCIES, type Currency } from '@/lib/money/money'

export function HomeCurrencyForm({ current }: { current: Currency }) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    setHomeCurrency,
    null,
  )
  return (
    <form action={formAction} className="space-y-2">
      <label className="block">
        <span className="text-sm">Home currency</span>
        <select
          name="homeCurrency"
          defaultValue={current}
          className="mt-1 w-full rounded border p-3"
        >
          {CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button className="w-full rounded bg-blue-600 py-3 text-white">Save</button>
    </form>
  )
}
