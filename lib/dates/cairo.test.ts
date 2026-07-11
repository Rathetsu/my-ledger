import { describe, expect, it, test } from 'vitest'
import { addPeriods, dueDateFor, periodOf, periodsBetween, todayCairo } from '@/lib/dates/cairo'

test('todayCairo returns YYYY-MM-DD', () => {
  expect(todayCairo()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
})

test('periodOf truncates to month', () => {
  expect(periodOf('2026-07-07')).toBe('2026-07')
})

describe('dueDateFor clamps min(due_day, last_day_of_month)', () => {
  test('normal day', () => expect(dueDateFor('2026-07', 15)).toBe('2026-07-15'))
  test('31 in a 30-day month', () =>
    expect(dueDateFor('2026-04', 31)).toBe('2026-04-30'))
  test('30 in February (non-leap)', () =>
    expect(dueDateFor('2026-02', 30)).toBe('2026-02-28'))
  test('30 in February (leap year)', () =>
    expect(dueDateFor('2028-02', 30)).toBe('2028-02-29'))
  test('31 in a 31-day month is untouched', () =>
    expect(dueDateFor('2026-08', 31)).toBe('2026-08-31'))
  test('day 1 always works', () =>
    expect(dueDateFor('2026-02', 1)).toBe('2026-02-01'))
})

describe('addPeriods', () => {
  test('adds within a year', () => expect(addPeriods('2026-03', 2)).toBe('2026-05'))
  test('crosses year end forward', () => expect(addPeriods('2026-11', 3)).toBe('2027-02'))
  test('crosses year start backward', () => expect(addPeriods('2026-01', -2)).toBe('2025-11'))
  test('zero is identity', () => expect(addPeriods('2026-07', 0)).toBe('2026-07'))
})

describe('periodsBetween', () => {
  it('same period is zero', () => expect(periodsBetween('2026-08', '2026-08')).toBe(0))
  it('counts forward across years', () => expect(periodsBetween('2026-11', '2027-02')).toBe(3))
  it('is negative when the target is earlier', () => expect(periodsBetween('2026-08', '2026-05')).toBe(-3))
})
