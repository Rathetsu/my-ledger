import { describe, expect, test } from 'vitest'
import { CURRENCIES, formatMoney, parseToMinor } from '@/lib/money/money'

test('CURRENCIES is exactly EUR, USD, EGP', () => {
  expect(CURRENCIES).toEqual(['EUR', 'USD', 'EGP'])
})

describe('formatMoney', () => {
  test('EUR: symbol + thousands grouping', () => {
    expect(formatMoney({ amountMinor: 123456, currency: 'EUR' })).toBe(
      '€1,234.56',
    )
  })
  test('USD: cents padded', () => {
    expect(formatMoney({ amountMinor: 50, currency: 'USD' })).toBe('$0.50')
  })
  test('EGP: code prefix', () => {
    expect(formatMoney({ amountMinor: 5230000, currency: 'EGP' })).toBe(
      'EGP 52,300.00',
    )
  })
  test('negative amounts', () => {
    expect(formatMoney({ amountMinor: -123456, currency: 'EUR' })).toBe(
      '-€1,234.56',
    )
  })
})

describe('parseToMinor', () => {
  test('plain decimal', () =>
    expect(parseToMinor('1234.56', 'EUR')).toBe(123456))
  test('grouping commas stripped', () =>
    expect(parseToMinor('1,234.56', 'EUR')).toBe(123456))
  test('one decimal digit pads', () =>
    expect(parseToMinor('10.5', 'USD')).toBe(1050))
  test('integer input', () =>
    expect(parseToMinor('52300', 'EGP')).toBe(5230000))
  test('negative allowed (reconciliation, opening)', () =>
    expect(parseToMinor('-12.34', 'EUR')).toBe(-1234))
  test('throws on three decimals', () =>
    expect(() => parseToMinor('1.234', 'EUR')).toThrow())
  test('throws on garbage', () =>
    expect(() => parseToMinor('abc', 'EUR')).toThrow())
  test('throws on empty', () => expect(() => parseToMinor('', 'EUR')).toThrow())

  test('valid thousands grouping still parses', () => {
    expect(parseToMinor('1,234,567.89', 'EGP')).toBe(123456789)
    expect(parseToMinor('52,300', 'EGP')).toBe(5230000)
  })
  test('throws on ambiguous comma-as-decimal (not 3-digit grouping)', () => {
    expect(() => parseToMinor('1,5', 'EUR')).toThrow() // was silently 15.00
    expect(() => parseToMinor('12,3', 'EUR')).toThrow()
    expect(() => parseToMinor('1,2345', 'EUR')).toThrow()
  })
  test('accepts the int4 boundary, throws just above it', () => {
    expect(parseToMinor('21474836.47', 'USD')).toBe(2147483647) // int4 max
    expect(() => parseToMinor('21474836.48', 'USD')).toThrow()
    expect(() => parseToMinor('25000000', 'EGP')).toThrow() // realistic price, overflows int4
  })
})
