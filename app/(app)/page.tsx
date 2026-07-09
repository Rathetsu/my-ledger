import { requireUser } from '@/lib/auth'
import { convert } from '@/lib/currency/convert'
import { getRates } from '@/lib/currency/rates'
import { getSettings, totalsByCurrency } from '@/lib/db/queries'
import { CURRENCIES, formatMoney } from '@/lib/money/money'

const DAY_MS = 24 * 60 * 60 * 1000

export default async function HomePage() {
  const user = await requireUser()
  const [s, totals, rates] = await Promise.all([
    getSettings(user.id),
    totalsByCurrency(user.id),
    getRates(),
  ])
  const home = s.homeCurrency
  // Convert each per-currency total once, round half-up, then sum (spec §3).
  const combined = CURRENCIES.reduce(
    (sum, c) => sum + convert(totals[c] ?? 0, c, home, rates),
    0,
  )
  const stale = Date.now() - new Date(rates.fetchedAt).getTime() > DAY_MS

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">My Ledger</h1>
      <section className="rounded border p-4">
        <p className="text-sm text-gray-500">Total ({home})</p>
        <p className="text-3xl font-bold">
          {formatMoney({ amountMinor: combined, currency: home })}
        </p>
        {stale && (
          <p className="text-xs text-amber-600">
            Rates from {new Date(rates.fetchedAt).toLocaleDateString('en-GB')} (stale)
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
    </div>
  )
}
