import { beforeEach, describe, expect, test, vi } from 'vitest'
import { getRates } from '@/lib/currency/rates'

const mockDb = vi.hoisted(() => ({
  row: {
    base: 'USD',
    rates: { USD: 1, EUR: 0.92, EGP: 48.5 } as Record<string, number>,
    fetchedAt: new Date(),
  },
  updates: [] as { rates: Record<string, number>; fetchedAt: Date }[],
}))

vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({ from: () => Promise.resolve([mockDb.row]) }),
    update: () => ({
      set: (values: { rates: Record<string, number>; fetchedAt: Date }) => ({
        where: () => {
          mockDb.updates.push(values)
          mockDb.row = { ...mockDb.row, ...values }
          return Promise.resolve()
        },
      }),
    }),
  },
}))

const HOURS = 60 * 60 * 1000

describe('getRates', () => {
  beforeEach(() => {
    mockDb.updates.length = 0
    vi.restoreAllMocks()
  })

  test('cache-first: fresh row is returned without fetching', async () => {
    mockDb.row = { base: 'USD', rates: { USD: 1, EUR: 0.92, EGP: 48.5 }, fetchedAt: new Date() }
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const rates = await getRates()
    expect(rates).toEqual({
      base: 'USD',
      rates: { USD: 1, EUR: 0.92, EGP: 48.5 },
      fetchedAt: mockDb.row.fetchedAt.toISOString(),
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('stale row (>24h): fetches, persists only supported currencies, returns fresh', async () => {
    mockDb.row = {
      base: 'USD',
      rates: { USD: 1, EUR: 0.92, EGP: 48.5 },
      fetchedAt: new Date(Date.now() - 25 * HOURS),
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ result: 'success', rates: { USD: 1, EUR: 0.9, EGP: 50.1, JPY: 155 } }),
      ),
    )
    const rates = await getRates()
    expect(rates.rates).toEqual({ USD: 1, EUR: 0.9, EGP: 50.1 })
    expect(mockDb.updates).toHaveLength(1)
  })

  test('fetch failure: falls back to the last-good cached row, persists nothing', async () => {
    const staleDate = new Date(Date.now() - 25 * HOURS)
    mockDb.row = { base: 'USD', rates: { USD: 1, EUR: 0.92, EGP: 48.5 }, fetchedAt: staleDate }
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))
    const rates = await getRates()
    expect(rates.rates.EUR).toBe(0.92)
    expect(rates.fetchedAt).toBe(staleDate.toISOString())
    expect(mockDb.updates).toHaveLength(0)
  })

  test('non-200 response counts as failure', async () => {
    mockDb.row = {
      base: 'USD',
      rates: { USD: 1, EUR: 0.92, EGP: 48.5 },
      fetchedAt: new Date(Date.now() - 25 * HOURS),
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('oops', { status: 500 }))
    const rates = await getRates()
    expect(rates.rates.EGP).toBe(48.5)
    expect(mockDb.updates).toHaveLength(0)
  })
})
