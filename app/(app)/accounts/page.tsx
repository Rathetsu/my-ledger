import Link from 'next/link'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { accounts } from '@/lib/db/schema'
import { accountBalanceMinor } from '@/lib/db/queries'
import { formatMoney } from '@/lib/money/money'

export default async function AccountsPage() {
  const user = await requireUser()
  const rows = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, user.id), isNull(accounts.archivedAt)))
    .orderBy(asc(accounts.createdAt))
  const balances = await Promise.all(rows.map((a) => accountBalanceMinor(a.id)))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Accounts</h1>
        <Link
          href="/accounts/new"
          className="rounded bg-blue-600 px-3 py-2 text-sm text-white"
        >
          Add account
        </Link>
      </div>
      <ul className="divide-y rounded border">
        {rows.map((a, i) => (
          <li key={a.id}>
            <Link
              href={`/accounts/${a.id}`}
              className="flex items-center justify-between p-3"
            >
              <span>
                {a.name} <span className="text-xs text-gray-500">({a.currency})</span>
              </span>
              <span className="font-mono">
                {formatMoney({ amountMinor: balances[i], currency: a.currency })}
              </span>
            </Link>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="p-3 text-sm text-gray-500">No accounts yet.</li>
        )}
      </ul>
    </div>
  )
}
