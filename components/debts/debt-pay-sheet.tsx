'use client'

import { useState } from 'react'
import { recordDebtPayment } from '@/lib/actions/debts'
import { parseToMinor, type Currency } from '@/lib/money/money'

export function DebtPaySheet({
  debt,
  accounts,
}: {
  debt: { id: string; name: string; currency: Currency }
  accounts: { id: string; name: string }[]
}) {
  const [open, setOpen] = useState(false)
  const [accountId, setAccountId] = useState(
    accounts.length === 1 ? accounts[0].id : '',
  )
  const [amount, setAmount] = useState('')
  if (accounts.length === 0) {
    return (
      <p className="text-xs text-neutral-500">
        No {debt.currency} account to pay from.
      </p>
    )
  }
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex min-h-11 w-full items-center justify-center rounded-lg border p-2 text-sm"
      >
        Pay
      </button>
    )
  }
  return (
    <form
      action={async () => {
        await recordDebtPayment({
          debtId: debt.id,
          accountId,
          amountMinor: parseToMinor(amount, debt.currency),
        })
        setOpen(false)
        setAmount('')
      }}
      className="space-y-2"
    >
      <select
        value={accountId}
        onChange={(e) => setAccountId(e.target.value)}
        required
        aria-label="Pay from account"
        className="w-full rounded-lg border p-3"
      >
        {accounts.length > 1 && <option value="">Pay from…</option>}
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        inputMode="decimal"
        placeholder="Amount"
        aria-label="Amount"
        required
        className="w-full rounded-lg border p-3"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          className="flex min-h-11 flex-1 items-center justify-center rounded-lg bg-neutral-900 p-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
        >
          Record payment
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border px-3 text-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
