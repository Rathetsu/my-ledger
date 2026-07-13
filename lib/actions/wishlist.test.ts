import { describe, expect, it } from 'vitest'
import { wishlistInput, purchaseInput } from './schemas'

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

describe('purchaseInput', () => {
  it('requires item and account uuids', () => {
    expect(
      purchaseInput.parse({
        itemId: '9f8b7c6d-1234-4abc-9def-0123456789ab',
        accountId: '1f8b7c6d-1234-4abc-9def-0123456789ab',
      }),
    ).toBeTruthy()
    expect(() => purchaseInput.parse({ itemId: 'nope', accountId: 'nope' })).toThrow()
  })
})
