import { and, asc, eq, inArray } from 'drizzle-orm'
import Link from 'next/link'
import { EmptyState } from '@/components/empty-state'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { installments, occurrences } from '@/lib/db/schema'
import { formatMoney } from '@/lib/money/money'

export default async function InstallmentsPage() {
  const user = await requireUser()
  const rows = await db
    .select()
    .from(installments)
    .where(eq(installments.userId, user.id))
  const unsettled = await db
    .select({ sourceId: occurrences.sourceId, dueDate: occurrences.dueDate })
    .from(occurrences)
    .where(
      and(
        eq(occurrences.userId, user.id),
        eq(occurrences.kind, 'installment'),
        inArray(occurrences.status, ['pending', 'overdue']),
      ),
    )
    .orderBy(asc(occurrences.dueDate))
  const nextDue = new Map<string, string>()
  for (const o of unsettled) {
    if (!nextDue.has(o.sourceId)) nextDue.set(o.sourceId, o.dueDate)
  }

  return (
    <main className="pb-20">
      <div className="flex items-center justify-between px-4 py-3">
        <h1 className="text-lg font-semibold">Installments</h1>
        <Link
          href="/installments/new"
          className="rounded bg-black px-3 py-2 text-sm text-white"
        >
          New installment
        </Link>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No installments yet." />
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map((i) => {
            const paid = i.totalCount - i.remainingCount
            return (
              <li key={i.id}>
                <Link
                  href={`/installments/${i.id}/edit`}
                  className="flex items-center justify-between px-4 py-3"
                >
                  <span>
                    <span className="block font-medium">{i.name}</span>
                    <span className="block text-sm text-gray-500">
                      Paid {paid} of {i.totalCount}
                      {i.remainingCount === 0
                        ? ', completed'
                        : nextDue.has(i.id)
                          ? `, next due ${nextDue.get(i.id)}`
                          : ''}
                    </span>
                  </span>
                  <span className="font-medium">
                    {formatMoney({
                      amountMinor: i.monthlyAmountMinor,
                      currency: i.currency,
                    })}
                    /mo
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
