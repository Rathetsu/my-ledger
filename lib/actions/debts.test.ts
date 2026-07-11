import { describe, expect, it } from 'vitest'
import { debtSchema } from '@/lib/actions/schemas'

describe('debtSchema', () => {
  it('accepts a full debt', () => {
    expect(
      debtSchema.parse({
        name: 'Family loan',
        originalMinor: 30000,
        currency: 'EUR',
        apr: 12,
        deadline: '2026-10-15',
        minPaymentMinor: 5000,
      }),
    ).toMatchObject({ name: 'Family loan', apr: 12 })
  })
  it('defaults apr to 0 and allows omitting deadline and minimum', () => {
    expect(debtSchema.parse({ name: 'IOU', originalMinor: 1000, currency: 'EGP' })).toMatchObject({ apr: 0 })
  })
  it('rejects zero or negative amounts', () => {
    expect(() => debtSchema.parse({ name: 'X', originalMinor: 0, currency: 'EUR' })).toThrow()
  })
})
