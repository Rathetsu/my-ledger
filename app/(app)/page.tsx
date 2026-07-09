import Link from 'next/link'
import { desc, eq } from 'drizzle-orm'
import { AttentionList } from '@/components/dashboard/attention-list'
import { requireUser } from '@/lib/auth'
import { convert } from '@/lib/currency/convert'
import { getRates } from '@/lib/currency/rates'
import { todayCairo } from '@/lib/dates/cairo'
import { db } from '@/lib/db/client'
import { accounts, transactions } from '@/lib/db/schema'
import { getSettings, totalsByCurrency } from '@/lib/db/queries'
import { housekeeping } from '@/lib/housekeeping'
import { getAttentionItems } from '@/lib/occurrences/attention'
import { CURRENCIES, formatMoney } from '@/lib/money/money'

const DAY_MS = 24 * 60 * 60 * 1000

// Kept out of the component body: eslint's react-hooks/purity rule flags
// impure calls (Date.now()) made directly inside a component function.
function isStale(fetchedAt: string): boolean {
  return Date.now() - new Date(fetchedAt).getTime() > DAY_MS
}

export default async function HomePage() {
  const user = await requireUser()
  const today = todayCairo()
  await housekeeping(user.id, today)
  const [s, totals, rates, recent, attention] = await Promise.all([
    getSettings(user.id),
    totalsByCurrency(user.id),
    getRates(),
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
      .where(eq(transactions.userId, user.id))
      .orderBy(desc(transactions.occurredOn), desc(transactions.createdAt))
      .limit(10),
    getAttentionItems(user.id, today),
  ])
  const home = s.homeCurrency
  // Convert each per-currency total once, round half-up, then sum (spec §3).
  const netWorth = CURRENCIES.reduce(
    (sum, c) => sum + convert(totals[c] ?? 0, c, home, rates),
    0,
  )
  const stale = isStale(rates.fetchedAt)

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">My Ledger</h1>

      <AttentionList items={attention} />

      <section className="rounded border p-4">
        <p className="text-sm text-gray-500">Total ({home})</p>
        <p className="text-3xl font-bold">
          {formatMoney({ amountMinor: netWorth, currency: home })}
        </p>
        {stale && (
          <p className="text-xs text-amber-600">
            Rates from {new Date(rates.fetchedAt).toLocaleDateString('en-GB')}{' '}
            (stale)
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-gray-500">Per currency</h2>
        <ul className="divide-y rounded border">
          {CURRENCIES.filter((c) => totals[c] !== undefined).map((c) => (
            <li key={c} className="flex justify-between p-3">
              <span>{c}</span>
              <span className="font-mono">
                {formatMoney({ amountMinor: totals[c]!, currency: c })}
              </span>
            </li>
          ))}
          {Object.keys(totals).length === 0 && (
            <li className="p-3 text-sm text-gray-500">
              No money tracked yet. Create an account to start.
            </li>
          )}
        </ul>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-500">Recent activity</h2>
          <Link href="/transactions" className="text-sm text-blue-600">
            See all
          </Link>
        </div>
        <ul className="divide-y rounded border">
          {recent.map((t) => (
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
                  <span className="block truncate text-sm">
                    {t.note || t.type}
                  </span>
                  <span className="block text-xs text-gray-500">
                    {t.accountName} · {t.occurredOn}
                  </span>
                </span>
                <span
                  className={`font-mono text-sm ${
                    t.amountMinor < 0 ? 'text-red-600' : 'text-green-700'
                  }`}
                >
                  {formatMoney({
                    amountMinor: t.amountMinor,
                    currency: t.currency,
                  })}
                </span>
              </Link>
            </li>
          ))}
          {recent.length === 0 && (
            <li className="p-3 text-sm text-gray-500">No activity yet.</li>
          )}
        </ul>
      </section>
    </div>
  )
}
