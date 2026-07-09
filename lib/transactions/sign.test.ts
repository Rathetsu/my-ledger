import { describe, expect, test } from 'vitest'
import { signedAmountForEdit } from '@/lib/transactions/sign'

describe('signedAmountForEdit (spec §3: editing preserves sign)', () => {
  test('expense: always negative regardless of current sign', () => {
    expect(signedAmountForEdit('expense', -500, 700)).toBe(-700)
  })
  test('income: always positive regardless of current sign', () => {
    expect(signedAmountForEdit('income', 500, 700)).toBe(700)
  })
  test('negative opening row keeps its negative sign after edit (corruption case)', () => {
    expect(signedAmountForEdit('opening', -10000, 12000)).toBe(-12000)
  })
  test('positive adjustment row stays positive after edit', () => {
    expect(signedAmountForEdit('adjustment', 3000, 4000)).toBe(4000)
  })
  test('magnitude passed already-positive is used as-is', () => {
    expect(signedAmountForEdit('opening', -100, 100)).toBe(-100)
  })
})
