export type Currency = 'EUR' | 'USD' | 'EGP'

export const CURRENCIES: readonly Currency[] = ['EUR', 'USD', 'EGP']

export interface Money {
  amountMinor: number
  currency: Currency
}

// All three currencies use 2-decimal minor units (ADR: integer minor units).
const PREFIX: Record<Currency, string> = { EUR: '€', USD: '$', EGP: 'EGP ' }

export function formatMoney(m: Money): string {
  const sign = m.amountMinor < 0 ? '-' : ''
  const abs = Math.abs(m.amountMinor)
  const major = Math.floor(abs / 100).toLocaleString('en-US')
  const minor = String(abs % 100).padStart(2, '0')
  return `${sign}${PREFIX[m.currency]}${major}.${minor}`
}

export function parseToMinor(input: string, currency: Currency): number {
  const cleaned = input.replace(/[,\s]/g, '')
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new Error(`Invalid ${currency} amount: "${input}"`)
  }
  const negative = cleaned.startsWith('-')
  const [major, minorRaw = ''] = cleaned.replace('-', '').split('.')
  const value = parseInt(major, 10) * 100 + parseInt((minorRaw + '00').slice(0, 2), 10)
  return negative ? -value : value
}
