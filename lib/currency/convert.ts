import type { Currency } from '@/lib/money/money'
import type { Rates } from './rates'

// Half-up on magnitude (half away from zero); Math.round misbehaves at -0.5.
function roundHalfUp(n: number): number {
  return n < 0 ? -Math.floor(-n + 0.5) : Math.floor(n + 0.5)
}

// One conversion, one rounding. Callers convert each per-currency total
// once, round half-up, then sum (spec §3) so dashboard and snapshots can
// never disagree by cents.
export function convert(
  amountMinor: number,
  from: Currency,
  to: Currency,
  rates: Rates,
): number {
  if (from === to) return amountMinor
  return roundHalfUp((amountMinor / rates.rates[from]) * rates.rates[to])
}
