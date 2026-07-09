'use client'

import { useActionState } from 'react'
import {
  archiveAccount,
  renameAccount,
  type ActionState,
} from '@/lib/actions/accounts'

export function AccountSettingsForm({
  account,
}: {
  account: { id: string; name: string; currency: string }
}) {
  const [renameState, renameAction] = useActionState<ActionState, FormData>(
    renameAccount,
    null,
  )
  const [archiveState, archiveAction] = useActionState<ActionState, FormData>(
    archiveAccount,
    null,
  )
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
        {renameState?.error && (
          <p className="text-sm text-red-600">{renameState.error}</p>
        )}
        <button className="w-full rounded bg-blue-600 py-3 text-white">Rename</button>
      </form>
      <form action={archiveAction} className="space-y-2">
        <input type="hidden" name="accountId" value={account.id} />
        {archiveState?.error && (
          <p className="text-sm text-red-600">{archiveState.error}</p>
        )}
        <button className="w-full rounded border border-red-600 py-3 text-red-600">
          Archive account
        </button>
      </form>
    </div>
  )
}
