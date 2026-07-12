import { describe, expect, it } from 'vitest'
import { buildPlan, interestOn, jitPayment, roundHalfUp } from './engine'
import type { PlanInput } from './types'
import type { Rates } from '@/lib/currency/rates'

describe('roundHalfUp', () => {
  it('rounds .5 up', () => expect(roundHalfUp(2.5)).toBe(3))
  it('rounds below .5 down', () => expect(roundHalfUp(2.49)).toBe(2))
})

describe('interestOn (simple monthly interest, apr/12)', () => {
  // 200000 * 20 / 1200 = 3333.33 -> 3333
  it('computes one month of interest', () => expect(interestOn(200000, 20)).toBe(3333))
  // 53333 * 20 / 1200 = 888.88 -> 889
  it('rounds half-up', () => expect(interestOn(53333, 20)).toBe(889))
  it('zero apr is zero interest', () => expect(interestOn(100000, 0)).toBe(0))
})

describe('jitPayment (level payment clearing balance in n months)', () => {
  // r = 12/1200 = 0.01, n = 3: 30000*0.01 / (1 - 1.01^-3) = 300 / 0.0294099 = 10200.66 -> ceil 10201
  it('annuity payment with interest', () => expect(jitPayment(30000, 12, 3)).toBe(10201))
  // n = 1 degenerates to balance plus one month interest: 10099 * 1.01 = 10199.99 -> ceil 10200
  it('single remaining month', () => expect(jitPayment(10099, 12, 1)).toBe(10200))
  // r = 0: straight division, ceil
  it('zero apr divides evenly', () => expect(jitPayment(30000, 0, 3)).toBe(10000))
})

const rates: Rates = { base: 'USD', rates: { USD: 1, EUR: 0.9, EGP: 50 }, fetchedAt: '2026-08-01T00:00:00Z' }

function mkInput(overrides: Partial<PlanInput>): PlanInput {
  return {
    homeCurrency: 'EUR',
    rates,
    horizonMonths: 12,
    startPeriod: '2026-08',
    monthlyIncomeMinor: {},
    billsMinor: {},
    installments: [],
    variableSpendMinor: {},
    spendEstimateSource: 'baseline',
    debts: [],
    wishlist: [],
    accountBalancesMinor: {},
    ...overrides,
  }
}

describe('buildPlan: zero debts', () => {
  it('reports surplus, no payments, all leftover unallocated', () => {
    const plan = buildPlan(
      mkInput({
        monthlyIncomeMinor: { EUR: 200000 },
        variableSpendMinor: { EUR: 100000 },
        accountBalancesMinor: { EUR: 1000000 },
      }),
    )
    // surplus = 200000 - 100000 = 100000 every month
    expect(plan.months).toHaveLength(12)
    expect(plan.surplusMinorByMonth['2026-08']).toBe(100000)
    expect(plan.months[0].debtPayments).toEqual([])
    expect(plan.months[0].unallocatedMinor).toBe(100000)
    expect(plan.months[0].fundingGaps).toEqual([])
    expect(plan.debtPayoffPeriod).toEqual({})
  })
})

describe('buildPlan: avalanche ordering and payoff months', () => {
  // Surplus: income 300000 - bills 50000 - variable 100000 = 150000/month.
  // Debt A: 200000 @ 20% apr (monthly 20/1200 = 1/60), debt B: 100000 @ 10% apr (monthly 1/120).
  //
  // 2026-08: A: 200000 + 3333 (200000/60 = 3333.33 -> 3333) = 203333; pay 150000 -> 53333
  //          B: 100000 + 833 (100000/120 = 833.33 -> 833) = 100833; untouched
  // 2026-09: A: 53333 + 889 (53333/60 = 888.88 -> 889) = 54222; pay 54222 -> 0 (payoff)
  //          B: 100833 + 840 (100833/120 = 840.275 -> 840) = 101673; pay 150000 - 54222 = 95778 -> 5895
  // 2026-10: B: 5895 + 49 (5895/120 = 49.125 -> 49) = 5944; pay 5944 -> 0 (payoff); leftover 144056
  const plan = buildPlan(
    mkInput({
      monthlyIncomeMinor: { EUR: 300000 },
      billsMinor: { EUR: 50000 },
      variableSpendMinor: { EUR: 100000 },
      accountBalancesMinor: { EUR: 500000 },
      debts: [
        { id: 'A', name: 'Card', balanceMinor: 200000, currency: 'EUR', apr: 20 },
        { id: 'B', name: 'Friend', balanceMinor: 100000, currency: 'EUR', apr: 10 },
      ],
    }),
  )

  it('pays the highest APR debt first', () => {
    expect(plan.months[0].debtPayments).toEqual([{ debtId: 'A', amountMinor: 150000, currency: 'EUR' }])
  })
  it('clears A then overflows into B in the same month', () => {
    expect(plan.months[1].debtPayments).toEqual([
      { debtId: 'A', amountMinor: 54222, currency: 'EUR' },
      { debtId: 'B', amountMinor: 95778, currency: 'EUR' },
    ])
  })
  it('reports payoff periods', () => {
    expect(plan.months[2].debtPayments).toEqual([{ debtId: 'B', amountMinor: 5944, currency: 'EUR' }])
    expect(plan.debtPayoffPeriod).toEqual({ A: '2026-09', B: '2026-10' })
  })
  it('releases post-debt surplus as unallocated', () => {
    expect(plan.months[2].unallocatedMinor).toBe(144056) // 150000 - 5944
    expect(plan.months[3].unallocatedMinor).toBe(150000)
  })
})

describe('buildPlan: minimum payments come before avalanche', () => {
  // Surplus = 20000. Debt M: 100000 @ 5% with min 5000; debt H: 50000 @ 30%.
  // 2026-08: M: 100000 + 417 (100000*5/1200 = 416.67 -> 417) = 100417; minimum 5000 -> 95417
  //          H: 50000 + 1250 (50000*30/1200 = 1250) = 51250; avalanche remainder 15000 -> 36250
  it('pays defined minimums, then avalanches the rest into the highest APR', () => {
    const plan = buildPlan(
      mkInput({
        monthlyIncomeMinor: { EUR: 20000 },
        accountBalancesMinor: { EUR: 500000 },
        debts: [
          { id: 'M', name: 'Loan', balanceMinor: 100000, currency: 'EUR', apr: 5, minPaymentMinor: 5000 },
          { id: 'H', name: 'Card', balanceMinor: 50000, currency: 'EUR', apr: 30 },
        ],
      }),
    )
    expect(plan.months[0].debtPayments).toEqual([
      { debtId: 'M', amountMinor: 5000, currency: 'EUR' },
      { debtId: 'H', amountMinor: 15000, currency: 'EUR' },
    ])
    expect(plan.months[0].unallocatedMinor).toBe(0)
  })
})

describe('buildPlan: debt not cleared within the horizon', () => {
  it('reports null payoff', () => {
    const plan = buildPlan(
      mkInput({
        horizonMonths: 6,
        monthlyIncomeMinor: { EUR: 100000 },
        accountBalancesMinor: { EUR: 10000000 },
        debts: [{ id: 'Z', name: 'Big', balanceMinor: 10000000, currency: 'EUR', apr: 0 }],
      }),
    )
    expect(plan.debtPayoffPeriod).toEqual({ Z: null })
    expect(plan.months[5].debtPayments).toEqual([{ debtId: 'Z', amountMinor: 100000, currency: 'EUR' }])
  })
})
