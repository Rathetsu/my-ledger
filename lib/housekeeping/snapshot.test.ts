import { describe, expect, it } from 'vitest'
import { computeSnapshotRow, rederiveDebtMinor, rederiveNetWorthMinor } from './snapshot'

// Fixture rates: 1 USD = 0.9 EUR = 50 EGP.
const RATES = {
  base: 'USD' as const,
  rates: { USD: 1, EUR: 0.9, EGP: 50 },
  fetchedAt: '2026-07-07T03:00:00.000Z',
}

describe('computeSnapshotRow', () => {
  it('stores per-currency totals and combines them in the home currency', () => {
    const row = computeSnapshotRow({
      userId: 'user-1',
      date: '2026-07-07',
      homeCurrency: 'EUR',
      rates: RATES,
      accountTotalsMinor: { EUR: 100000, USD: 50000, EGP: 2000000 },
      debtTotalsMinor: { EGP: 6000000 },
    })
    expect(row.perCurrency).toEqual({ EUR: 100000, USD: 50000, EGP: 2000000 })
    // EUR 100000 stays; USD 50000 -> 45000 EUR; EGP 2000000 -> 36000 EUR.
    expect(row.combinedMinor).toBe(181000)
    // EGP 6000000 -> 108000 EUR.
    expect(row.totalDebtMinor).toBe(108000)
    expect(row.homeCurrency).toBe('EUR')
    expect(row.rates).toEqual(RATES)
    expect(row.date).toBe('2026-07-07')
  })

  it('handles empty inputs as zeros', () => {
    const row = computeSnapshotRow({
      userId: 'user-1',
      date: '2026-07-07',
      homeCurrency: 'EUR',
      rates: RATES,
      accountTotalsMinor: {},
      debtTotalsMinor: {},
    })
    expect(row.perCurrency).toEqual({})
    expect(row.combinedMinor).toBe(0)
    expect(row.totalDebtMinor).toBe(0)
  })
})

describe('rederiveNetWorthMinor', () => {
  const perCurrency = { EUR: 100000, USD: 50000, EGP: 2000000 }

  it('re-derives the combined value in the current home currency from stored rates', () => {
    // Home EUR: 100000 + 45000 + 36000.
    expect(rederiveNetWorthMinor(perCurrency, RATES, 'EUR')).toBe(181000)
    // Home USD: 100000/0.9 = 111111.11 -> 111111 (half-up); + 50000; + 2000000/50 = 40000.
    expect(rederiveNetWorthMinor(perCurrency, RATES, 'USD')).toBe(201111)
  })

  it('rounds each converted total half-up before summing', () => {
    // EGP 75 -> USD 1.5 -> rounds half-up to 2.
    expect(rederiveNetWorthMinor({ EGP: 75 }, RATES, 'USD')).toBe(2)
  })
})

describe('rederiveDebtMinor', () => {
  it('converts the stored total from the snapshot home to the current home at stored rates', () => {
    // 108000 EUR at 0.9 EUR/USD -> 120000 USD.
    expect(rederiveDebtMinor(108000, 'EUR', RATES, 'USD')).toBe(120000)
    // Same home currency: unchanged.
    expect(rederiveDebtMinor(108000, 'EUR', RATES, 'EUR')).toBe(108000)
  })
})
