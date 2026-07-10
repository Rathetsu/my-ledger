import { describe, expect, it } from 'vitest'
import { pivotByCategory, trendSeries } from './chart-data'

describe('pivotByCategory', () => {
  const rows = [
    { period: '2026-04', category: 'Groceries', totalMinor: 90000 },
    { period: '2026-04', category: 'Transport', totalMinor: 30000 },
    { period: '2026-05', category: 'Groceries', totalMinor: 110000 },
    { period: '2026-05', category: 'Fun', totalMinor: 20000 },
  ]

  it('pivots rows into one object per period with categories by total desc', () => {
    // Totals: Groceries 200000, Transport 30000, Fun 20000
    expect(pivotByCategory(rows)).toEqual({
      categories: ['Groceries', 'Transport', 'Fun'],
      data: [
        { period: '2026-04', Groceries: 90000, Transport: 30000, Fun: 0 },
        { period: '2026-05', Groceries: 110000, Transport: 0, Fun: 20000 },
      ],
    })
  })

  it('folds categories beyond maxSeries into Other', () => {
    const { categories, data } = pivotByCategory(rows, 2)
    expect(categories).toEqual(['Groceries', 'Transport', 'Other'])
    // Fun (20000 in 2026-05) folds into Other
    expect(data[1]).toEqual({ period: '2026-05', Groceries: 110000, Transport: 0, Other: 20000 })
  })

  it('returns empty shapes for no rows', () => {
    expect(pivotByCategory([])).toEqual({ categories: [], data: [] })
  })
})

describe('trendSeries', () => {
  it('fills missing periods with zero', () => {
    expect(
      trendSeries(
        [
          { period: '2026-04', totalMinor: 120000 },
          { period: '2026-06', totalMinor: 130000 },
        ],
        '2026-04',
        '2026-06',
      ),
    ).toEqual([
      { period: '2026-04', totalMinor: 120000 },
      { period: '2026-05', totalMinor: 0 },
      { period: '2026-06', totalMinor: 130000 },
    ])
  })
})
