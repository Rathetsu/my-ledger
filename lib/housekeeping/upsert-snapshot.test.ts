import { beforeEach, describe, expect, it, vi } from 'vitest'

const RATES = {
  base: 'USD' as const,
  rates: { USD: 1, EUR: 0.9, EGP: 50 },
  fetchedAt: '2026-07-07T03:00:00.000Z',
}

const state = {
  totals: { EUR: 100000, EGP: 2000000 } as Record<string, number>,
  // Payments stored negative; adjustments SIGNED (positive = owe more).
  debtTransactions: [
    { type: 'debt_payment', amountMinor: -500000 },
    { type: 'adjustment', amountMinor: 1000000 },
  ] as { type: string; amountMinor: number }[],
  store: new Map<string, Record<string, unknown>>(),
}

vi.mock('@/lib/currency/rates', () => ({
  getRates: vi.fn(async () => RATES),
}))

vi.mock('@/lib/db/queries', () => ({
  totalsByCurrency: vi.fn(async () => state.totals),
}))

vi.mock('@/lib/db/client', async () => {
  const schema = await import('@/lib/db/schema')
  return {
    db: {
      select: (projection?: unknown) => ({
        from: (table: unknown) => ({
          where: async () => {
            if (table === schema.settings) return [{ userId: 'user-1', homeCurrency: 'EUR' }]
            if (table === schema.flexibleDebts)
              return [{ id: 'd1', userId: 'user-1', currency: 'EGP', originalMinor: 5000000 }]
            if (table === schema.transactions) return state.debtTransactions
            return []
          },
        }),
      }),
      insert: () => ({
        values: (v: { userId: string; date: string }) => ({
          onConflictDoUpdate: async ({ set }: { set: Record<string, unknown> }) => {
            const key = `${v.userId}|${v.date}`
            state.store.set(key, state.store.has(key) ? { ...state.store.get(key), ...set } : { ...v })
          },
        }),
      }),
    },
  }
})

import { upsertDailySnapshot } from './snapshot'

describe('upsertDailySnapshot', () => {
  beforeEach(() => {
    state.store.clear()
    state.totals = { EUR: 100000, EGP: 2000000 }
  })

  it('writes one row with per-currency totals, combined value, and the derived signed debt', async () => {
    await upsertDailySnapshot('user-1', '2026-07-07')
    expect(state.store.size).toBe(1)
    const row = state.store.get('user-1|2026-07-07')!
    expect(row.perCurrency).toEqual({ EUR: 100000, EGP: 2000000 })
    // EUR 100000 + EGP 2000000 -> 36000 EUR = 136000.
    expect(row.combinedMinor).toBe(136000)
    // Debt: 5000000 - 500000 paid + 1000000 adjustment = 5500000 EGP -> 99000 EUR.
    // An abs-based derivation would give 5000000 - |−500000 + 1000000| = 4500000 (wrong).
    expect(row.totalDebtMinor).toBe(99000)
    expect(row.homeCurrency).toBe('EUR')
    expect(row.rates).toEqual(RATES)
  })

  it('re-running on the same Cairo date updates the same row', async () => {
    await upsertDailySnapshot('user-1', '2026-07-07')
    state.totals = { EUR: 110000, EGP: 2000000 }
    await upsertDailySnapshot('user-1', '2026-07-07')
    expect(state.store.size).toBe(1)
    expect(state.store.get('user-1|2026-07-07')!.combinedMinor).toBe(146000)
  })

  it('a different date creates a second row', async () => {
    await upsertDailySnapshot('user-1', '2026-07-07')
    await upsertDailySnapshot('user-1', '2026-07-08')
    expect(state.store.size).toBe(2)
  })
})
