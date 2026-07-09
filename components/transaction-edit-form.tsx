'use client'

import { useActionState } from 'react'
import type { ActionState } from '@/lib/actions/accounts'
import {
  deleteTransaction,
  updateTransaction,
} from '@/lib/actions/transactions'

export function TransactionEditForm({
  txn,
}: {
  txn: {
    id: string
    type: string
    amountAbs: string // "12.34", sign handled by type
    occurredOn: string
    note: string
    oneOff: boolean
    accountName: string
    currency: string
  }
}) {
  const [updateState, updateAction] = useActionState<ActionState, FormData>(
    updateTransaction,
    null,
  )
  const [deleteState, deleteAction] = useActionState<ActionState, FormData>(
    deleteTransaction,
    null,
  )
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">
        {txn.type}{' '}
        <span className="text-sm text-gray-500">{txn.accountName}</span>
      </h1>
      <form action={updateAction} className="space-y-4">
        <input type="hidden" name="transactionId" value={txn.id} />
        <label className="block">
          <span className="text-sm">Amount ({txn.currency})</span>
          <input
            name="amount"
            defaultValue={txn.amountAbs}
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
            defaultValue={txn.occurredOn}
            required
            className="mt-1 w-full rounded border p-3"
          />
        </label>
        <label className="block">
          <span className="text-sm">Note</span>
          <input
            name="note"
            defaultValue={txn.note}
            className="mt-1 w-full rounded border p-3"
          />
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="oneOff"
            defaultChecked={txn.oneOff}
            className="h-5 w-5"
          />
          <span className="text-sm">One-off</span>
        </label>
        {updateState?.error && (
          <p className="text-sm text-red-600">{updateState.error}</p>
        )}
        <button className="w-full rounded bg-blue-600 py-3 text-white">
          Save changes
        </button>
      </form>
      <form action={deleteAction}>
        <input type="hidden" name="transactionId" value={txn.id} />
        {deleteState?.error && (
          <p className="text-sm text-red-600">{deleteState.error}</p>
        )}
        <button className="w-full rounded border border-red-600 py-3 text-red-600">
          Delete
        </button>
      </form>
    </div>
  )
}
