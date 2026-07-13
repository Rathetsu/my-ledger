import { describe, expect, it } from 'vitest'
import { wishlistInput } from './schemas'

describe('wishlistInput', () => {
  it('accepts a full item', () => {
    expect(
      wishlistInput.parse({
        name: 'Desk chair',
        costMinor: 250000,
        currency: 'EUR',
        priority: 1,
        targetDate: '2026-12-01',
      }),
    ).toMatchObject({ name: 'Desk chair', priority: 1 })
  })
  it('defaults priority to 3 and allows omitting targetDate', () => {
    expect(wishlistInput.parse({ name: 'Phone', costMinor: 500000, currency: 'EGP' })).toMatchObject({ priority: 3 })
  })
  it('rejects zero cost and out-of-range priority', () => {
    expect(() => wishlistInput.parse({ name: 'X', costMinor: 0, currency: 'EUR' })).toThrow()
    expect(() => wishlistInput.parse({ name: 'X', costMinor: 100, currency: 'EUR', priority: 0 })).toThrow()
  })
})
