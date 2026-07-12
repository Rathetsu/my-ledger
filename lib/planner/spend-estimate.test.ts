import { describe, expect, it } from 'vitest'
import { estimateVariableSpend } from './spend-estimate'

describe('estimateVariableSpend', () => {
  const baseline = { EUR: 80000, EGP: 500000 }

  it('uses the essentials baseline while fewer than 3 months of actuals exist', () => {
    const { variableSpendMinor, source } = estimateVariableSpend(baseline, {
      EUR: [
        { period: '2026-06', totalMinor: 90000 },
        { period: '2026-07', totalMinor: 110000 },
      ],
    })
    expect(source).toBe('baseline')
    expect(variableSpendMinor).toEqual({ EUR: 80000, EGP: 500000 })
  })

  it('blends to the trailing 3-month mean once 3 months of data exist', () => {
    const { variableSpendMinor, source } = estimateVariableSpend(baseline, {
      EUR: [
        { period: '2026-05', totalMinor: 90000 },
        { period: '2026-06', totalMinor: 110000 },
        { period: '2026-07', totalMinor: 100000 },
      ],
    })
    expect(source).toBe('blend')
    // (90000 + 110000 + 100000) / 3 = 100000
    expect(variableSpendMinor.EUR).toBe(100000)
    // EGP has no actuals in the window: keeps its baseline
    expect(variableSpendMinor.EGP).toBe(500000)
  })

  it('uses only the trailing 3 periods when more exist', () => {
    const { variableSpendMinor } = estimateVariableSpend(baseline, {
      EUR: [
        { period: '2026-03', totalMinor: 900000 }, // outside the trailing window, ignored
        { period: '2026-05', totalMinor: 90000 },
        { period: '2026-06', totalMinor: 110000 },
        { period: '2026-07', totalMinor: 100000 },
      ],
    })
    expect(variableSpendMinor.EUR).toBe(100000)
  })
})
