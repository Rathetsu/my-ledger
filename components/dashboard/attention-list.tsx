'use client'

import { useState } from 'react'
import { ConfirmSheet } from '@/components/occurrences/confirm-sheet'
import type { AttentionItem } from '@/lib/occurrences/attention'
import { formatMoney } from '@/lib/money/money'

const CTA = {
  income: 'confirm arrived',
  bill: 'confirm paid',
  installment: 'confirm paid',
} as const

export function AttentionList({ items }: { items: AttentionItem[] }) {
  const [selected, setSelected] = useState<AttentionItem | null>(null)
  if (items.length === 0) return null
  return (
    <section className="mt-4">
      <h2 className="px-4 text-sm font-semibold text-gray-500">
        Needs attention <span aria-live="polite">({items.length})</span>
      </h2>
      <ul className="divide-y divide-gray-100">
        {items.map((item) => (
          <li key={item.occurrenceId}>
            <button
              type="button"
              onClick={() => setSelected(item)}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <span>
                <span className="block font-medium">{item.sourceName}</span>
                <span
                  className={`block text-sm ${item.status === 'overdue' ? 'text-red-600' : 'text-gray-500'}`}
                >
                  {item.status === 'overdue' ? 'Overdue' : 'Due'} {item.dueDate}
                  , {CTA[item.kind]}
                </span>
              </span>
              <span className="font-medium">
                {formatMoney({
                  amountMinor: item.expectedAmountMinor,
                  currency: item.currency,
                })}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <ConfirmSheet item={selected} onClose={() => setSelected(null)} />
      )}
    </section>
  )
}
