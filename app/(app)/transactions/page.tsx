import Link from 'next/link'
import { and, asc, desc, eq, gte, isNull, lte, type SQL } from 'drizzle-orm'
import { EmptyState } from '@/components/empty-state'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { accounts, transactions, TRANSACTION_TYPES } from '@/lib/db/schema'
import { formatMoney } from '@/lib/money/money'

interface Filters {
  account?: string
  type?: string
  from?: string
  to?: string
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Filters>
}) {
  const user = await requireUser()
  const sp = await searchParams

  const conds: SQL[] = [eq(transactions.userId, user.id)]
  // accountId is a uuid column; guard the raw param so a malformed ?account=
  // degrades to "no filter" instead of a Postgres cast error (like type/date below).
  if (
    sp.account &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      sp.account,
    )
  ) {
    conds.push(eq(transactions.accountId, sp.account))
  }
  if (sp.type && (TRANSACTION_TYPES as readonly string[]).includes(sp.type)) {
    conds.push(
      eq(transactions.type, sp.type as (typeof TRANSACTION_TYPES)[number]),
    )
  }
  if (sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from)) {
    conds.push(gte(transactions.occurredOn, sp.from))
  }
  if (sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to)) {
    conds.push(lte(transactions.occurredOn, sp.to))
  }

  const [rows, accountRows] = await Promise.all([
    db
      .select({
        id: transactions.id,
        type: transactions.type,
        amountMinor: transactions.amountMinor,
        currency: transactions.currency,
        occurredOn: transactions.occurredOn,
        note: transactions.note,
        transferGroupId: transactions.transferGroupId,
        accountName: accounts.name,
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .where(and(...conds))
      .orderBy(desc(transactions.occurredOn), desc(transactions.createdAt))
      .limit(100),
    db
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.userId, user.id), isNull(accounts.archivedAt)))
      .orderBy(asc(accounts.createdAt)),
  ])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Ledger</h1>
        <div className="flex gap-2">
          <Link
            href="/transactions/new"
            className="rounded bg-blue-600 px-3 py-2 text-sm text-white"
          >
            Add
          </Link>
          <Link
            href="/transfers/new"
            className="rounded border px-3 py-2 text-sm"
          >
            Transfer
          </Link>
        </div>
      </div>

      {/* Native GET form: filters live in the URL, zero client state. */}
      <form
        method="get"
        className="grid grid-cols-2 gap-2 rounded border p-3 text-sm"
      >
        <label className="block">
          <span>Account</span>
          <select
            name="account"
            defaultValue={sp.account ?? ''}
            className="mt-1 w-full rounded border p-2"
          >
            <option value="">All</option>
            {accountRows.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span>Type</span>
          <select
            name="type"
            defaultValue={sp.type ?? ''}
            className="mt-1 w-full rounded border p-2"
          >
            <option value="">All</option>
            {TRANSACTION_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span>From</span>
          <input
            type="date"
            name="from"
            defaultValue={sp.from ?? ''}
            className="mt-1 w-full rounded border p-2"
          />
        </label>
        <label className="block">
          <span>To</span>
          <input
            type="date"
            name="to"
            defaultValue={sp.to ?? ''}
            className="mt-1 w-full rounded border p-2"
          />
        </label>
        <button className="col-span-2 rounded border py-2">Filter</button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="Nothing here yet." />
      ) : (
        <ul className="divide-y rounded border">
          {rows.map((t) => (
            <li key={t.id}>
              <Link
                href={
                  t.transferGroupId
                    ? `/transfers/${t.transferGroupId}`
                    : `/transactions/${t.id}`
                }
                className="flex items-center justify-between p-3"
              >
                <span className="min-w-0">
                  <span className="block truncate">{t.note || t.type}</span>
                  <span className="block text-xs text-gray-500">
                    {t.type} · {t.accountName} · {t.occurredOn}
                  </span>
                </span>
                <span
                  className={`font-mono ${t.amountMinor < 0 ? 'text-red-600' : 'text-green-700'}`}
                >
                  {formatMoney({
                    amountMinor: t.amountMinor,
                    currency: t.currency,
                  })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
