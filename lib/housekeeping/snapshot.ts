import { eq } from 'drizzle-orm'
import { convert } from '@/lib/currency/convert'
import { getRates } from '@/lib/currency/rates'
import type { Rates } from '@/lib/currency/rates'
import { db } from '@/lib/db/client'
import { totalsByCurrency } from '@/lib/db/queries'
import { flexibleDebts, netWorthSnapshots, settings } from '@/lib/db/schema'
import { debtBalanceMinor } from '@/lib/debts/balance'
import type { Currency } from '@/lib/money/money'
import { CURRENCIES } from '@/lib/money/money'

export interface SnapshotComputeInput {
  userId: string
  date: string
  homeCurrency: Currency
  rates: Rates
  accountTotalsMinor: Partial<Record<Currency, number>>
  debtTotalsMinor: Partial<Record<Currency, number>>
}

export interface SnapshotRow {
  userId: string
  date: string
  perCurrency: Partial<Record<Currency, number>>
  combinedMinor: number
  homeCurrency: Currency
  rates: Rates
  totalDebtMinor: number
}

// Spec §3: convert each per-currency total once, round half-up, then sum.
export function computeSnapshotRow(input: SnapshotComputeInput): SnapshotRow {
  const perCurrency: Partial<Record<Currency, number>> = {}
  let combinedMinor = 0
  let totalDebtMinor = 0
  for (const c of CURRENCIES) {
    const total = input.accountTotalsMinor[c]
    if (total !== undefined) {
      perCurrency[c] = total
      combinedMinor += convert(total, c, input.homeCurrency, input.rates)
    }
    const debt = input.debtTotalsMinor[c]
    if (debt !== undefined) {
      totalDebtMinor += convert(debt, c, input.homeCurrency, input.rates)
    }
  }
  return {
    userId: input.userId,
    date: input.date,
    perCurrency,
    combinedMinor,
    homeCurrency: input.homeCurrency,
    rates: input.rates,
    totalDebtMinor,
  }
}

// Trend charts: past points are re-derived from each snapshot's OWN stored rates,
// never today's rates (ADR: history never rewrites).
export function rederiveNetWorthMinor(
  perCurrency: Partial<Record<Currency, number>>,
  snapshotRates: Rates,
  currentHome: Currency,
): number {
  let combined = 0
  for (const c of CURRENCIES) {
    const total = perCurrency[c]
    if (total !== undefined) combined += convert(total, c, currentHome, snapshotRates)
  }
  return combined
}

export function rederiveDebtMinor(
  totalDebtMinor: number,
  snapshotHome: Currency,
  snapshotRates: Rates,
  currentHome: Currency,
): number {
  return convert(totalDebtMinor, snapshotHome, currentHome, snapshotRates)
}

export async function upsertDailySnapshot(userId: string, date: string): Promise<void> {
  // getRates() is cache-first and refetches when the stored row is older than 24h,
  // which is exactly housekeeping's "refresh stale rates" step (ADR).
  const rates = await getRates()

  const [userSettings] = await db.select().from(settings).where(eq(settings.userId, userId))
  const homeCurrency = (userSettings?.homeCurrency ?? 'EUR') as Currency

  // Per-currency totals in ONE grouped query - the exact query behind the dashboard
  // net-worth number, so the snapshot always matches what the dashboard shows.
  // Never loop accounts calling accountBalanceMinor per account: that is the documented
  // N+1 (one Neon HTTP round trip each; ~500 accumulated dev accounts = ~60s loads).
  const accountTotalsMinor = await totalsByCurrency(userId)

  // Total debt = sum of derived balances via the shipped debtBalanceMinor:
  // originalMinor + SIGNED sum of rows filtered to type IN ('debt_payment','adjustment').
  // Payments are stored negative; adjustments are signed (positive = owe more).
  const debtRows = await db.select().from(flexibleDebts).where(eq(flexibleDebts.userId, userId))
  const debtTotalsMinor: Partial<Record<Currency, number>> = {}
  for (const d of debtRows) {
    // ponytail: two round trips per debt (debt row + its transactions); debts are few per user, so this stays flat
    const balance = await debtBalanceMinor(d.id)
    if (balance > 0) {
      const c = d.currency as Currency
      debtTotalsMinor[c] = (debtTotalsMinor[c] ?? 0) + balance
    }
  }

  const row = computeSnapshotRow({ userId, date, homeCurrency, rates, accountTotalsMinor, debtTotalsMinor })
  await db
    .insert(netWorthSnapshots)
    .values(row)
    .onConflictDoUpdate({
      target: [netWorthSnapshots.userId, netWorthSnapshots.date],
      set: {
        perCurrency: row.perCurrency,
        combinedMinor: row.combinedMinor,
        homeCurrency: row.homeCurrency,
        rates: row.rates,
        totalDebtMinor: row.totalDebtMinor,
      },
    })
}
