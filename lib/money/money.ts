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

// Every *_minor column is Postgres int4; a value beyond this overflows and 500s
// the insert, so reject it here as a clean validation error instead.
const INT4_MAX = 2_147_483_647

export function parseToMinor(input: string, currency: Currency): number {
  const cleaned = input.replace(/\s/g, '')
  // Plain digits OR properly 3-digit-grouped thousands (matching formatMoney's
  // output). A comma that isn't a valid grouping separator — e.g. "1,5" meant as
  // a decimal — is rejected rather than silently read as "15".
  if (!/^-?(\d+|\d{1,3}(,\d{3})+)(\.\d{1,2})?$/.test(cleaned)) {
    throw new Error(`Invalid ${currency} amount: "${input}"`)
  }
  const digits = cleaned.replace(/,/g, '')
  const negative = digits.startsWith('-')
  const [major, minorRaw = ''] = digits.replace('-', '').split('.')
  const value =
    parseInt(major, 10) * 100 + parseInt((minorRaw + '00').slice(0, 2), 10)
  if (Math.abs(value) > INT4_MAX) {
    throw new Error(`${currency} amount out of range: "${input}"`)
  }
  return negative ? -value : value
}
