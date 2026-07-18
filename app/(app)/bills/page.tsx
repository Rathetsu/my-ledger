import Link from 'next/link'
import { eq } from 'drizzle-orm'
import { EmptyState } from '@/components/empty-state'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { bills } from '@/lib/db/schema'
import { formatMoney } from '@/lib/money/money'

export default async function BillsPage() {
  const user = await requireUser()
  const rows = await db.select().from(bills).where(eq(bills.userId, user.id))
  return (
    <main className="pb-20">
      <div className="flex items-center justify-between px-4 py-3">
        <h1 className="text-lg font-semibold">Bills</h1>
        <Link
          href="/bills/new"
          className="rounded bg-black px-3 py-2 text-sm text-white"
        >
          New bill
        </Link>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No bills yet." />
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map((b) => (
            <li key={b.id}>
              <Link
                href={`/bills/${b.id}/edit`}
                className="flex items-center justify-between px-4 py-3"
              >
                <span>
                  <span className="block font-medium">{b.name}</span>
                  <span className="block text-sm text-gray-500">
                    Due day {b.dueDay}
                    {b.active ? '' : ' (inactive)'}
                  </span>
                </span>
                <span className="font-medium">
                  {formatMoney({
                    amountMinor: b.amountMinor,
                    currency: b.currency,
                  })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
