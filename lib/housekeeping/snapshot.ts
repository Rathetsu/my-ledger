import { convert } from '@/lib/currency/convert'
import type { Rates } from '@/lib/currency/rates'
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
