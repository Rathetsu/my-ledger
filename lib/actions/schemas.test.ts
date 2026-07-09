import { describe, expect, it } from 'vitest'
import { confirmInput, incomeSourceInput, windfallInput } from './schemas'

describe('incomeSourceInput', () => {
  it('accepts a valid source', () => {
    const r = incomeSourceInput.safeParse({
      name: 'Salary',
      amount: '2500.00',
      currency: 'EUR',
      dayOfMonth: 25,
      accountId: '4f3c2b1a-0000-4000-8000-000000000001',
      recurring: true,
      active: true,
    })
    expect(r.success).toBe(true)
  })

  it('rejects day 0, day 32, empty name, unknown currency', () => {
    const base = {
      name: 'Salary',
      amount: '2500.00',
      currency: 'EUR',
      dayOfMonth: 25,
      accountId: '4f3c2b1a-0000-4000-8000-000000000001',
      recurring: true,
      active: true,
    }
    expect(
      incomeSourceInput.safeParse({ ...base, dayOfMonth: 0 }).success,
    ).toBe(false)
    expect(
      incomeSourceInput.safeParse({ ...base, dayOfMonth: 32 }).success,
    ).toBe(false)
    expect(incomeSourceInput.safeParse({ ...base, name: '  ' }).success).toBe(
      false,
    )
    expect(
      incomeSourceInput.safeParse({ ...base, currency: 'GBP' }).success,
    ).toBe(false)
  })
})

describe('windfallInput', () => {
  it('accepts amount + account + date', () => {
    const r = windfallInput.safeParse({
      accountId: '4f3c2b1a-0000-4000-8000-000000000001',
      amount: '150.00',
      date: '2026-07-07',
      note: 'freelance',
    })
    expect(r.success).toBe(true)
  })
})

describe('confirmInput', () => {
  it('requires a YYYY-MM-DD date', () => {
    const base = {
      occurrenceId: '4f3c2b1a-0000-4000-8000-000000000001',
      amount: '2500.00',
      currency: 'EUR',
      date: '2026-07-25',
    }
    expect(confirmInput.safeParse(base).success).toBe(true)
    expect(
      confirmInput.safeParse({ ...base, date: '25/07/2026' }).success,
    ).toBe(false)
  })
})
