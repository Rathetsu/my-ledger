import { describe, expect, it } from 'vitest'
import type { PlanInput, PlanResult } from '@/lib/planner/types'
import { sanitizePlanPayload, seqLabel } from './sanitize'
import { bucketMinor, cacheKey } from './sanitize'

const RATES = {
  base: 'USD' as const,
  rates: { USD: 1, EUR: 0.9, EGP: 50 },
  fetchedAt: '2026-07-07T03:00:00.000Z',
}

const input: PlanInput = {
  homeCurrency: 'EUR',
  rates: RATES,
  horizonMonths: 24,
  startPeriod: '2026-07',
  monthlyIncomeMinor: { EUR: 250000 },
  billsMinor: { EGP: 1200000, EUR: 30000 },
  installments: [
    { name: 'iPhone 15 from Amr', monthlyMinor: 150000, currency: 'EGP', remainingCount: 5, apr: 32 },
  ],
  variableSpendMinor: { EGP: 800000 },
  spendEstimateSource: 'blend',
  debts: [
    { id: 'debt-uuid-1', name: 'Loan from Dad', balanceMinor: 3000000, currency: 'EGP', apr: 0, deadline: '2026-12-31' },
    { id: 'debt-uuid-2', name: 'CIB credit card', balanceMinor: 90000, currency: 'EUR', apr: 18, minPaymentMinor: 5000 },
  ],
  wishlist: [
    { id: 'wish-uuid-1', name: 'Herman Miller chair from OLX guy', costMinor: 120000, currency: 'EUR', priority: 1, targetDate: '2026-12-01' },
  ],
  accountBalancesMinor: { EUR: 340000, EGP: 9500000 },
}

const result: PlanResult = {
  months: [
    {
      period: '2026-07',
      debtPayments: [{ debtId: 'debt-uuid-2', amountMinor: 45000, currency: 'EUR' }],
      wishlistFunding: [],
      fundingGaps: [
        { currency: 'EGP', shortfallMinor: 950000, suggestion: 'Transfer from Revolut EUR to CIB EGP' },
      ],
      unallocatedMinor: 0,
    },
  ],
  debtPayoffPeriod: { 'debt-uuid-1': '2026-12', 'debt-uuid-2': '2026-08' },
  wishlistAffordablePeriod: { 'wish-uuid-1': '2027-01' },
  surplusMinorByMonth: { '2026-07': 65000, '2026-08': 65000 },
  spendEstimateSource: 'blend',
  highAprInstallmentFlags: ['iPhone 15 from Amr'],
}

describe('sanitizePlanPayload', () => {
  it('produces output containing no name, id, note, or suggestion string from the input', () => {
    const json = JSON.stringify(sanitizePlanPayload(input, result))
    for (const leaked of [
      'Loan from Dad', 'Dad', 'CIB credit card', 'CIB', 'iPhone', 'Amr',
      'Herman', 'OLX', 'Revolut', 'debt-uuid-1', 'debt-uuid-2', 'wish-uuid-1', 'Transfer from',
    ]) {
      expect(json).not.toContain(leaked)
    }
  })

  it('assigns sequential generic labels in input order', () => {
    const p = sanitizePlanPayload(input, result)
    expect(p.debts.map((d) => d.label)).toEqual(['debtA', 'debtB'])
    expect(p.installments.map((i) => i.label)).toEqual(['installmentA'])
    expect(p.wishlist.map((w) => w.label)).toEqual(['itemA'])
  })

  it('carries amounts, APRs, months, surplus, and funding gaps through untouched', () => {
    const p = sanitizePlanPayload(input, result)
    expect(p.homeCurrency).toBe('EUR')
    expect(p.monthlyIncomeMinor).toEqual({ EUR: 250000 })
    expect(p.debts[0]).toEqual({
      label: 'debtA', balanceMinor: 3000000, currency: 'EGP', apr: 0,
      deadline: '2026-12', payoffPeriod: '2026-12',
    })
    expect(p.debts[1].minPaymentMinor).toBe(5000)
    expect(p.wishlist[0].targetMonth).toBe('2026-12')
    expect(p.wishlist[0].affordablePeriod).toBe('2027-01')
    expect(p.surplusMinorByMonth).toEqual({ '2026-07': 65000, '2026-08': 65000 })
    expect(p.fundingGaps).toEqual([{ period: '2026-07', currency: 'EGP', shortfallMinor: 950000 }])
    expect(p.spendEstimateSource).toBe('blend')
  })

  it('maps highAprInstallmentFlags from names to labels', () => {
    const p = sanitizePlanPayload(input, result)
    expect(p.highAprInstallmentFlags).toEqual(['installmentA'])
  })

  it('excludes rates entirely', () => {
    expect(JSON.stringify(sanitizePlanPayload(input, result))).not.toContain('fetchedAt')
  })
})

describe('seqLabel', () => {
  it('runs A..Z then AA', () => {
    expect(seqLabel('debt', 0)).toBe('debtA')
    expect(seqLabel('debt', 25)).toBe('debtZ')
    expect(seqLabel('debt', 26)).toBe('debtAA')
  })
})

describe('bucketMinor', () => {
  it('maps a 1% change to the same bucket', () => {
    expect(bucketMinor(101000)).toBe(bucketMinor(100000))
  })
  it('maps a 10% change to a different bucket', () => {
    expect(bucketMinor(110000)).not.toBe(bucketMinor(100000))
  })
  it('handles zero and negatives', () => {
    expect(bucketMinor(0)).toBe(0)
    expect(bucketMinor(-100000)).toBe(-bucketMinor(100000))
  })
})

describe('cacheKey', () => {
  const base = sanitizePlanPayload(input, result)
  const withBalance = (balanceMinor: number) => ({
    ...base,
    debts: [{ ...base.debts[0], balanceMinor }, base.debts[1]],
  })

  it('is stable for identical payloads', () => {
    expect(cacheKey(base)).toBe(cacheKey(sanitizePlanPayload(input, result)))
  })
  it('is a 64-char sha256 hex string', () => {
    expect(cacheKey(base)).toMatch(/^[0-9a-f]{64}$/)
  })
  it('does not change for a small (1%) amount change', () => {
    expect(cacheKey(withBalance(3030000))).toBe(cacheKey(withBalance(3000000)))
  })
  it('changes for a 10% amount change', () => {
    expect(cacheKey(withBalance(3300000))).not.toBe(cacheKey(withBalance(3000000)))
  })
  it('changes when an APR changes', () => {
    const bumped = { ...base, debts: [{ ...base.debts[0], apr: 5 }, base.debts[1]] }
    expect(cacheKey(bumped)).not.toBe(cacheKey(base))
  })
})
