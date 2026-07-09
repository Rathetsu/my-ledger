'use client'

import { useActionState } from 'react'
import type { ActionState } from '@/lib/actions/accounts'
import {
  deleteTransferGroup,
  updateTransferGroup,
} from '@/lib/actions/transfers'

export function TransferGroupForm(props: {
  groupId: string
  cross: boolean
  sent: string
  received: string
  occurredOn: string
  note: string
  fromCurrency: string
  toCurrency: string
}) {
  const [updateState, updateAction] = useActionState<ActionState, FormData>(
    updateTransferGroup,
    null,
  )
  const [deleteState, deleteAction] = useActionState<ActionState, FormData>(
    deleteTransferGroup,
    null,
  )
  return (
    <div className="space-y-6">
      <form action={updateAction} className="space-y-4">
        <input type="hidden" name="groupId" value={props.groupId} />
        <label className="block">
          <span className="text-sm">
            {props.cross ? `Amount sent (${props.fromCurrency})` : 'Amount'}
          </span>
          <input
            name="amountSent"
            defaultValue={props.sent}
            inputMode="decimal"
            required
            className="mt-1 w-full rounded border p-3"
          />
        </label>
        {props.cross && (
          <label className="block">
            <span className="text-sm">
              Amount received ({props.toCurrency})
            </span>
            <input
              name="amountReceived"
              defaultValue={props.received}
              inputMode="decimal"
              required
              className="mt-1 w-full rounded border p-3"
            />
          </label>
        )}
        <label className="block">
          <span className="text-sm">Date</span>
          <input
            type="date"
            name="occurredOn"
            defaultValue={props.occurredOn}
            required
            className="mt-1 w-full rounded border p-3"
          />
        </label>
        <label className="block">
          <span className="text-sm">Note</span>
          <input
            name="note"
            defaultValue={props.note}
            className="mt-1 w-full rounded border p-3"
          />
        </label>
        {updateState?.error && (
          <p className="text-sm text-red-600">{updateState.error}</p>
        )}
        <button className="w-full rounded bg-blue-600 py-3 text-white">
          Save transfer
        </button>
      </form>
      <form action={deleteAction}>
        <input type="hidden" name="groupId" value={props.groupId} />
        {deleteState?.error && (
          <p className="text-sm text-red-600">{deleteState.error}</p>
        )}
        <button className="w-full rounded border border-red-600 py-3 text-red-600">
          Delete transfer
        </button>
      </form>
    </div>
  )
}
