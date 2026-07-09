'use client'

import { useActionState, useState } from 'react'
import type { ActionState } from '@/lib/actions/accounts'
import { createTransfer } from '@/lib/actions/transfers'
import { convert } from '@/lib/currency/convert'
import type { Rates } from '@/lib/currency/rates'
import { formatMoney, parseToMinor, type Currency } from '@/lib/money/money'

interface AccountOption {
  id: string
  name: string
  currency: Currency
}

export function TransferForm({
  accounts,
  rates,
  defaultDate,
}: {
  accounts: AccountOption[]
  rates: Rates
  defaultDate: string
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    createTransfer,
    null,
  )
  const [fromId, setFromId] = useState(accounts[0]?.id ?? '')
  const [toId, setToId] = useState(accounts[1]?.id ?? '')
  const [sent, setSent] = useState('')
  const [received, setReceived] = useState('')

  const from = accounts.find((a) => a.id === fromId)
  const to = accounts.find((a) => a.id === toId)
  const cross = !!from && !!to && from.currency !== to.currency

  // Live rate only PRE-FILLS a suggestion; the user enters actuals.
  let suggestionMinor: number | null = null
  if (cross && sent) {
    try {
      suggestionMinor = convert(
        parseToMinor(sent, from.currency),
        from.currency,
        to.currency,
        rates,
      )
    } catch {
      suggestionMinor = null
    }
  }

  const options = accounts.map((a) => (
    <option key={a.id} value={a.id}>
      {a.name} ({a.currency})
    </option>
  ))

  return (
    <form action={formAction} className="space-y-4">
      <h1 className="text-xl font-semibold">Transfer</h1>
      {/* ponytail: explicit htmlFor/id (not wrapping) keeps the <label>'s
          accessible name to just "From"/"To" — a wrapping label's text
          includes every nested <option>, which collides with the sibling
          select's own option list once accounts share name substrings. */}
      <div className="block">
        <label htmlFor="fromAccountId" className="text-sm">
          From
        </label>
        <select
          id="fromAccountId"
          name="fromAccountId"
          value={fromId}
          onChange={(e) => setFromId(e.target.value)}
          className="mt-1 w-full rounded border p-3"
        >
          {options}
        </select>
      </div>
      <div className="block">
        <label htmlFor="toAccountId" className="text-sm">
          To
        </label>
        <select
          id="toAccountId"
          name="toAccountId"
          value={toId}
          onChange={(e) => setToId(e.target.value)}
          className="mt-1 w-full rounded border p-3"
        >
          {options}
        </select>
      </div>
      <label className="block">
        <span className="text-sm">
          {cross && from ? `Amount sent (${from.currency})` : 'Amount'}
        </span>
        <input
          name="amountSent"
          value={sent}
          onChange={(e) => setSent(e.target.value)}
          inputMode="decimal"
          required
          className="mt-1 w-full rounded border p-3"
        />
      </label>
      {cross && to && (
        <div>
          <label className="block">
            <span className="text-sm">Amount received ({to.currency})</span>
            <input
              name="amountReceived"
              value={received}
              onChange={(e) => setReceived(e.target.value)}
              inputMode="decimal"
              required
              className="mt-1 w-full rounded border p-3"
            />
          </label>
          {suggestionMinor !== null && (
            <button
              type="button"
              className="mt-1 text-sm text-blue-600"
              onClick={() => setReceived((suggestionMinor / 100).toFixed(2))}
            >
              Use live-rate suggestion:{' '}
              {formatMoney({
                amountMinor: suggestionMinor,
                currency: to.currency,
              })}
            </button>
          )}
        </div>
      )}
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
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button className="w-full rounded bg-blue-600 py-3 text-white">
        Create transfer
      </button>
    </form>
  )
}
