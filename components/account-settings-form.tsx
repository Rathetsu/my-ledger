'use client'

import { useActionState } from 'react'
import { FormErrors } from '@/components/form-errors'
import {
  archiveAccount,
  renameAccount,
  type ActionState,
} from '@/lib/actions/accounts'
import { reconcileAccount } from '@/lib/actions/transactions'
import type { ActionResult } from '@/lib/actions/definitions'

export function AccountSettingsForm({
  account,
}: {
  account: {
    id: string
    name: string
    currency: string
    balanceFormatted: string
    archived: boolean
  }
}) {
  const [renameResult, renameAction] = useActionState<
    ActionResult | null,
    FormData
  >(renameAccount, null)
  const [archiveResult, archiveAction] = useActionState<
    ActionResult | null,
    FormData
  >(archiveAccount, null)
  const [reconcileState, reconcileAction] = useActionState<
    ActionState,
    FormData
  >(reconcileAccount, null)
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">
        {account.name}{' '}
        <span className="text-sm text-gray-500">({account.currency})</span>
      </h1>
      <form action={renameAction} className="space-y-2">
        <input type="hidden" name="accountId" value={account.id} />
        <label className="block">
          <span className="text-sm">Name</span>
          <input
            name="name"
            defaultValue={account.name}
            required
            className="mt-1 w-full rounded border p-3"
          />
        </label>
        <FormErrors result={renameResult} field="name" />
        <FormErrors result={renameResult} />
        <button className="w-full rounded bg-blue-600 py-3 text-white">
          Rename
        </button>
      </form>
      {/* No reconciling an archived (write-frozen) account. */}
      {!account.archived && (
        <form action={reconcileAction} className="space-y-2">
          <input type="hidden" name="accountId" value={account.id} />
          <p className="text-sm text-gray-500">
            Ledger balance: {account.balanceFormatted}
          </p>
          <label className="block">
            <span className="text-sm">Actual balance</span>
            <input
              name="actualBalance"
              inputMode="decimal"
              required
              className="mt-1 w-full rounded border p-3"
            />
          </label>
          {reconcileState?.error && (
            <p className="text-sm text-red-600">{reconcileState.error}</p>
          )}
          <button className="w-full rounded border py-3">
            Set actual balance
          </button>
        </form>
      )}
      <form action={archiveAction} className="space-y-2">
        <input type="hidden" name="accountId" value={account.id} />
        <FormErrors result={archiveResult} />
        <button className="w-full rounded border border-red-600 py-3 text-red-600">
          Archive account
        </button>
      </form>
    </div>
  )
}
