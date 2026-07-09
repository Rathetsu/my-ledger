import Link from 'next/link'
import { and, eq, isNull } from 'drizzle-orm'
import { WindfallForm } from '@/components/income/windfall-form'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { accounts, incomeSources } from '@/lib/db/schema'
import { formatMoney } from '@/lib/money/money'

export default async function IncomePage() {
  const user = await requireUser()
  const sources = await db
    .select()
    .from(incomeSources)
    .where(eq(incomeSources.userId, user.id))
  const accountRows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      currency: accounts.currency,
    })
    .from(accounts)
    .where(and(eq(accounts.userId, user.id), isNull(accounts.archivedAt)))

  return (
    <main className="pb-20">
      <div className="flex items-center justify-between px-4 py-3">
        <h1 className="text-lg font-semibold">Income</h1>
        <Link
          href="/income/new"
          className="rounded bg-black px-3 py-2 text-sm text-white"
        >
          New income source
        </Link>
      </div>
      <ul className="divide-y divide-gray-100">
        {sources.map((s) => (
          <li key={s.id}>
            <Link
              href={`/income/${s.id}/edit`}
              className="flex items-center justify-between px-4 py-3"
            >
              <span>
                <span className="block font-medium">{s.name}</span>
                <span className="block text-sm text-gray-500">
                  Day {s.dayOfMonth} {s.recurring ? 'monthly' : 'once'}
                  {s.active ? '' : ' (inactive)'}
                </span>
              </span>
              <span className="font-medium">
                {formatMoney({
                  amountMinor: s.amountMinor,
                  currency: s.currency,
                })}
              </span>
            </Link>
          </li>
        ))}
        {sources.length === 0 && (
          <li className="px-4 py-6 text-sm text-gray-500">
            No income sources yet.
          </li>
        )}
      </ul>
      <section className="mt-6 px-4">
        <h2 className="mb-2 text-sm font-semibold text-gray-500">
          Add extra income (windfall)
        </h2>
        <WindfallForm accounts={accountRows} />
      </section>
    </main>
  )
}
