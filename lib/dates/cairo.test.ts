import { describe, expect, test } from 'vitest'
import { dueDateFor, periodOf, todayCairo } from '@/lib/dates/cairo'

test('todayCairo returns YYYY-MM-DD', () => {
  expect(todayCairo()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
})

test('periodOf truncates to month', () => {
  expect(periodOf('2026-07-07')).toBe('2026-07')
})

describe('dueDateFor clamps min(due_day, last_day_of_month)', () => {
  test('normal day', () => expect(dueDateFor('2026-07', 15)).toBe('2026-07-15'))
  test('31 in a 30-day month', () => expect(dueDateFor('2026-04', 31)).toBe('2026-04-30'))
  test('30 in February (non-leap)', () => expect(dueDateFor('2026-02', 30)).toBe('2026-02-28'))
  test('30 in February (leap year)', () => expect(dueDateFor('2028-02', 30)).toBe('2028-02-29'))
  test('31 in a 31-day month is untouched', () => expect(dueDateFor('2026-08', 31)).toBe('2026-08-31'))
  test('day 1 always works', () => expect(dueDateFor('2026-02', 1)).toBe('2026-02-01'))
})
