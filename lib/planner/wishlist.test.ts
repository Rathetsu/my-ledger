import { describe, expect, it } from 'vitest'
import { activeWishlistForPlan } from './wishlist'

describe('activeWishlistForPlan', () => {
  it('excludes purchased items and maps nullable target dates', () => {
    expect(
      activeWishlistForPlan([
        { id: 'w1', name: 'Chair', costMinor: 250000, currency: 'EUR', priority: 1, targetDate: null, status: 'planned' },
        { id: 'w2', name: 'Phone', costMinor: 500000, currency: 'EGP', priority: 2, targetDate: '2026-12-01', status: 'purchased' },
        { id: 'w3', name: 'Desk', costMinor: 90000, currency: 'EUR', priority: 3, targetDate: '2026-10-15', status: 'planned' },
      ]),
    ).toEqual([
      { id: 'w1', name: 'Chair', costMinor: 250000, currency: 'EUR', priority: 1, targetDate: undefined },
      { id: 'w3', name: 'Desk', costMinor: 90000, currency: 'EUR', priority: 3, targetDate: '2026-10-15' },
    ])
  })
})
