import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { exchangeRates } from '@/lib/db/schema'
import { CURRENCIES, type Currency } from '@/lib/money/money'

export interface Rates {
  base: 'USD'
  rates: Record<Currency, number>
  fetchedAt: string
}

const MAX_AGE_MS = 24 * 60 * 60 * 1000

// Cache-first: the single exchange_rates row (seeded by the initial
// migration) is the cache AND the last-good fallback.
export async function getRates(): Promise<Rates> {
  const [row] = await db.select().from(exchangeRates)
  if (!row) throw new Error('exchange_rates row is not seeded')
  const cached: Rates = {
    base: 'USD',
    rates: row.rates,
    fetchedAt: new Date(row.fetchedAt).toISOString(),
  }
  if (Date.now() - new Date(row.fetchedAt).getTime() < MAX_AGE_MS) return cached

  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD')
    if (!res.ok) throw new Error(`rates fetch failed: ${res.status}`)
    const body = (await res.json()) as {
      result?: string
      rates?: Record<string, number>
    }
    // Validate before persisting: a partial/malformed payload must NOT be written
    // (it would NaN-poison every conversion for 24h). Fall back to last-good instead.
    if (body.result !== 'success' || !body.rates) {
      throw new Error('rates payload not usable')
    }
    const fetched = body.rates
    const rates = Object.fromEntries(
      CURRENCIES.map((c) => [c, fetched[c]]),
    ) as Record<Currency, number>
    for (const c of CURRENCIES) {
      if (!Number.isFinite(rates[c]) || rates[c] <= 0) {
        throw new Error(`rates payload missing or invalid ${c}`)
      }
    }
    const fetchedAt = new Date()
    await db
      .update(exchangeRates)
      .set({ rates, fetchedAt })
      .where(eq(exchangeRates.base, 'USD'))
    return { base: 'USD', rates, fetchedAt: fetchedAt.toISOString() }
  } catch {
    // ponytail: last-good fallback; staleness surfaces as a UI label, not an error.
    return cached
  }
}
