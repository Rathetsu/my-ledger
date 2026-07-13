import { describe, expect, it } from 'vitest'
import { buildPlan } from './engine'
import type { PlanInput } from './types'
import type { Rates } from '@/lib/currency/rates'

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

describe('buildPlan: wishlist affordability month math', () => {
  // Unallocated = income 200000 - variable 100000 = 100000/month (no debts).
  // Item W1 costs 250000 EUR:
  // 2026-08: fund 100000 (total 100000)
  // 2026-09: fund 100000 (total 200000)
  // 2026-10: fund 250000 - 200000 = 50000 (total 250000 -> affordable)
  const plan = buildPlan(
    mkInput({
      monthlyIncomeMinor: { EUR: 200000 },
      variableSpendMinor: { EUR: 100000 },
      accountBalancesMinor: { EUR: 1000000 },
      wishlist: [{ id: 'W1', name: 'Chair', costMinor: 250000, currency: 'EUR', priority: 1 }],
    }),
  )

  it('funds monthly and reports the affordability month', () => {
    expect(plan.months[0].wishlistFunding).toEqual([{ itemId: 'W1', amountMinor: 100000, currency: 'EUR' }])
    expect(plan.months[1].wishlistFunding).toEqual([{ itemId: 'W1', amountMinor: 100000, currency: 'EUR' }])
    expect(plan.months[2].wishlistFunding).toEqual([{ itemId: 'W1', amountMinor: 50000, currency: 'EUR' }])
    expect(plan.wishlistAffordablePeriod).toEqual({ W1: '2026-10' })
  })
  it('stops funding a fully funded item and keeps unallocatedMinor pre-wishlist', () => {
    expect(plan.months[3].wishlistFunding).toEqual([])
    expect(plan.months[0].unallocatedMinor).toBe(100000) // funding draws from it, meaning unchanged
  })
})

describe('buildPlan: target-dated item jumps the priority queue', () => {
  // Unallocated = 150000/month.
  // Item T: 300000 EUR, target 2026-10-01 (3 periods incl. start), priority 5.
  // Item P: 100000 EUR, priority 1, no target.
  // 2026-08: T needs ceil(300000/3) = 100000 first; P gets the remaining 50000
  // 2026-09: T needs ceil(200000/2) = 100000; P gets 50000 (total 100000 -> affordable 2026-09)
  // 2026-10: T needs ceil(100000/1) = 100000 (total 300000 -> affordable 2026-10, on target)
  const plan = buildPlan(
    mkInput({
      monthlyIncomeMinor: { EUR: 150000 },
      accountBalancesMinor: { EUR: 2000000 },
      wishlist: [
        { id: 'T', name: 'Laptop', costMinor: 300000, currency: 'EUR', priority: 5, targetDate: '2026-10-01' },
        { id: 'P', name: 'Chair', costMinor: 100000, currency: 'EUR', priority: 1 },
      ],
    }),
  )

  it('funds the target-dated item first despite lower priority', () => {
    expect(plan.months[0].wishlistFunding).toEqual([
      { itemId: 'T', amountMinor: 100000, currency: 'EUR' },
      { itemId: 'P', amountMinor: 50000, currency: 'EUR' },
    ])
    expect(plan.months[1].wishlistFunding).toEqual([
      { itemId: 'T', amountMinor: 100000, currency: 'EUR' },
      { itemId: 'P', amountMinor: 50000, currency: 'EUR' },
    ])
    expect(plan.months[2].wishlistFunding).toEqual([{ itemId: 'T', amountMinor: 100000, currency: 'EUR' }])
  })
  it('makes the target-dated item affordable by its target date', () => {
    expect(plan.wishlistAffordablePeriod).toEqual({ T: '2026-10', P: '2026-09' })
  })
})
