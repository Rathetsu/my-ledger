import { describe, expect, test } from 'vitest'
import { convert } from '@/lib/currency/convert'
import type { Rates } from '@/lib/currency/rates'

const rates: Rates = {
  base: 'USD',
  rates: { USD: 1, EUR: 0.92, EGP: 48.5 },
  fetchedAt: '2026-07-07T00:00:00.000Z',
}

describe('convert', () => {
  test('identity', () => {
    expect(convert(12345, 'EUR', 'EUR', rates)).toBe(12345)
  })
  test('USD to EUR (direct rate)', () => {
    expect(convert(10000, 'USD', 'EUR', rates)).toBe(9200)
  })
  test('EUR to EGP via USD cross-rate', () => {
    // 100.00 EUR / 0.92 = 108.695652 USD * 48.5 = 5271.73913 EGP -> 527174 minor
    expect(convert(10000, 'EUR', 'EGP', rates)).toBe(527174)
  })
  test('rounds half-up at exactly .5', () => {
    const r: Rates = { base: 'USD', rates: { USD: 1, EUR: 0.5, EGP: 1 }, fetchedAt: rates.fetchedAt }
    // 5 USD-minor * 0.5 = 2.5 -> 3
    expect(convert(5, 'USD', 'EUR', r)).toBe(3)
  })
  test('negative amounts round half away from zero', () => {
    const r: Rates = { base: 'USD', rates: { USD: 1, EUR: 0.5, EGP: 1 }, fetchedAt: rates.fetchedAt }
    expect(convert(-5, 'USD', 'EUR', r)).toBe(-3)
  })
  test('zero is zero', () => {
    expect(convert(0, 'EGP', 'EUR', rates)).toBe(0)
  })
})
