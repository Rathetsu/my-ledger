import { describe, expect, it } from 'vitest'
import {
  billInput,
  confirmInput,
  incomeSourceInput,
  installmentInput,
  installmentUpdateInput,
  windfallInput,
} from './schemas'

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

describe('billInput', () => {
  it('accepts a valid bill and rejects out-of-range due days', () => {
    const base = {
      name: 'Rent',
      amount: '15000.00',
      currency: 'EGP',
      dueDay: 1,
      accountId: '4f3c2b1a-0000-4000-8000-000000000001',
      active: true,
    }
    expect(billInput.safeParse(base).success).toBe(true)
    expect(billInput.safeParse({ ...base, dueDay: 0 }).success).toBe(false)
    expect(billInput.safeParse({ ...base, dueDay: 32 }).success).toBe(false)
    expect(billInput.safeParse({ ...base, name: '' }).success).toBe(false)
  })
})

describe('installmentInput', () => {
  const base = {
    name: 'Phone',
    amount: '500.00',
    currency: 'USD',
    dueDay: 15,
    totalCount: 12,
    startDate: '2026-07-01',
    accountId: '4f3c2b1a-0000-4000-8000-000000000001',
    apr: null,
  }

  it('accepts a valid installment, with or without apr', () => {
    expect(installmentInput.safeParse(base).success).toBe(true)
    expect(installmentInput.safeParse({ ...base, apr: 24.5 }).success).toBe(true)
  })

  it('rejects zero counts, bad due days, negative apr', () => {
    expect(installmentInput.safeParse({ ...base, totalCount: 0 }).success).toBe(
      false,
    )
    expect(installmentInput.safeParse({ ...base, dueDay: 32 }).success).toBe(
      false,
    )
    expect(installmentInput.safeParse({ ...base, apr: -1 }).success).toBe(false)
  })

  it('update variant bounds remainingCount to [0, totalCount]', () => {
    const upd = { ...base, remainingCount: 5, active: true }
    expect(installmentUpdateInput.safeParse(upd).success).toBe(true)
    expect(
      installmentUpdateInput.safeParse({ ...upd, remainingCount: -1 }).success,
    ).toBe(false)
    expect(
      installmentUpdateInput.safeParse({ ...upd, remainingCount: 13 }).success,
    ).toBe(false)
  })

  it('rejects a blank remainingCount instead of coercing it to 0', () => {
    const upd = { ...base, active: true }
    expect(
      installmentUpdateInput.safeParse({ ...upd, remainingCount: '' }).success,
    ).toBe(false)
    // an explicit 0 is still valid (marks the installment complete)
    expect(
      installmentUpdateInput.safeParse({ ...upd, remainingCount: 0 }).success,
    ).toBe(true)
  })

  it('rejects an over-long amount string', () => {
    expect(
      installmentInput.safeParse({ ...base, amount: '1'.repeat(25) }).success,
    ).toBe(false)
  })
})
