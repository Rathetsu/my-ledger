'use client'

import { useState } from 'react'
import { deleteDebtPayment } from '@/lib/actions/debts'

export function ReversePaymentForm({ id }: { id: string }) {
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      action={async () => {
        try {
          await deleteDebtPayment({ id })
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }}
    >
      <button className="p-2 text-xs text-red-600">Reverse</button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}
    </form>
  )
}
