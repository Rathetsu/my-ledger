import { describe, expect, it } from 'vitest'
import { interestOn, jitPayment, roundHalfUp } from './engine'

describe('roundHalfUp', () => {
  it('rounds .5 up', () => expect(roundHalfUp(2.5)).toBe(3))
  it('rounds below .5 down', () => expect(roundHalfUp(2.49)).toBe(2))
})

describe('interestOn (simple monthly interest, apr/12)', () => {
  // 200000 * 20 / 1200 = 3333.33 -> 3333
  it('computes one month of interest', () => expect(interestOn(200000, 20)).toBe(3333))
  // 53333 * 20 / 1200 = 888.88 -> 889
  it('rounds half-up', () => expect(interestOn(53333, 20)).toBe(889))
  it('zero apr is zero interest', () => expect(interestOn(100000, 0)).toBe(0))
})

describe('jitPayment (level payment clearing balance in n months)', () => {
  // r = 12/1200 = 0.01, n = 3: 30000*0.01 / (1 - 1.01^-3) = 300 / 0.0294099 = 10200.66 -> ceil 10201
  it('annuity payment with interest', () => expect(jitPayment(30000, 12, 3)).toBe(10201))
  // n = 1 degenerates to balance plus one month interest: 10099 * 1.01 = 10199.99 -> ceil 10200
  it('single remaining month', () => expect(jitPayment(10099, 12, 1)).toBe(10200))
  // r = 0: straight division, ceil
  it('zero apr divides evenly', () => expect(jitPayment(30000, 0, 3)).toBe(10000))
})
