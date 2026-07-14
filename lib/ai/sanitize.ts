import { createHash } from 'node:crypto'
import type { Currency } from '@/lib/money/money'
import { CURRENCIES } from '@/lib/money/money'
import type { PlanInput, PlanResult } from '@/lib/planner/types'

export interface SanitizedDebt {
  label: string
  balanceMinor: number
  currency: Currency
  apr: number
  deadline?: string // YYYY-MM
  minPaymentMinor?: number
  payoffPeriod: string | null // YYYY-MM
}

export interface SanitizedInstallment {
  label: string
  monthlyMinor: number
  currency: Currency
  remainingCount: number
  apr?: number
}

export interface SanitizedWishlistItem {
  label: string
  costMinor: number
  currency: Currency
  priority: number
  targetMonth?: string // YYYY-MM
  affordablePeriod: string | null // YYYY-MM
}

export interface SanitizedFundingGap {
  period: string // YYYY-MM
  currency: Currency
  shortfallMinor: number
}

export interface SanitizedPayload {
  homeCurrency: Currency
  horizonMonths: number
  spendEstimateSource: 'baseline' | 'blend'
  monthlyIncomeMinor: Partial<Record<Currency, number>>
  billsMinor: Partial<Record<Currency, number>>
  variableSpendMinor: Partial<Record<Currency, number>>
  accountBalancesMinor: Partial<Record<Currency, number>>
  installments: SanitizedInstallment[]
  debts: SanitizedDebt[]
  wishlist: SanitizedWishlistItem[]
  surplusMinorByMonth: Record<string, number>
  fundingGaps: SanitizedFundingGap[]
  highAprInstallmentFlags: string[] // sanitized installment labels, never names
}

// A, B, ..., Z, AA, AB, ... (bijective base 26)
export function seqLabel(prefix: string, index: number): string {
  let n = index
  let suffix = ''
  do {
    suffix = String.fromCharCode(65 + (n % 26)) + suffix
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return prefix + suffix
}

// Rebuild currency records in CURRENCIES order so JSON.stringify is deterministic for hashing.
function byCurrency(source: Partial<Record<Currency, number>>): Partial<Record<Currency, number>> {
  const out: Partial<Record<Currency, number>> = {}
  for (const c of CURRENCIES) {
    if (source[c] !== undefined) out[c] = source[c]
  }
  return out
}

export function sanitizePlanPayload(input: PlanInput, result: PlanResult): SanitizedPayload {
  const debts: SanitizedDebt[] = input.debts.map((d, i) => ({
    label: seqLabel('debt', i),
    balanceMinor: d.balanceMinor,
    currency: d.currency,
    apr: d.apr,
    ...(d.deadline ? { deadline: d.deadline.slice(0, 7) } : {}),
    ...(d.minPaymentMinor !== undefined ? { minPaymentMinor: d.minPaymentMinor } : {}),
    payoffPeriod: result.debtPayoffPeriod[d.id] ?? null,
  }))

  const installmentLabelByName = new Map(
    input.installments.map((inst, i) => [inst.name, seqLabel('installment', i)] as const),
  )
  const installments: SanitizedInstallment[] = input.installments.map((inst, i) => ({
    label: seqLabel('installment', i),
    monthlyMinor: inst.monthlyMinor,
    currency: inst.currency,
    remainingCount: inst.remainingCount,
    ...(inst.apr !== undefined ? { apr: inst.apr } : {}),
  }))

  const wishlist: SanitizedWishlistItem[] = input.wishlist.map((w, i) => ({
    label: seqLabel('item', i),
    costMinor: w.costMinor,
    currency: w.currency,
    priority: w.priority,
    ...(w.targetDate ? { targetMonth: w.targetDate.slice(0, 7) } : {}),
    affordablePeriod: result.wishlistAffordablePeriod[w.id] ?? null,
  }))

  // Funding gaps carry period + currency + shortfall only. The engine's free-text
  // `suggestion` may mention account names, so it never crosses this boundary.
  const fundingGaps: SanitizedFundingGap[] = result.months.flatMap((m) =>
    m.fundingGaps.map((g) => ({ period: m.period, currency: g.currency, shortfallMinor: g.shortfallMinor })),
  )

  return {
    homeCurrency: input.homeCurrency,
    horizonMonths: input.horizonMonths,
    spendEstimateSource: result.spendEstimateSource,
    monthlyIncomeMinor: byCurrency(input.monthlyIncomeMinor),
    billsMinor: byCurrency(input.billsMinor),
    variableSpendMinor: byCurrency(input.variableSpendMinor),
    accountBalancesMinor: byCurrency(input.accountBalancesMinor),
    installments,
    debts,
    wishlist,
    surplusMinorByMonth: result.surplusMinorByMonth,
    fundingGaps,
    highAprInstallmentFlags: result.highAprInstallmentFlags
      .map((name) => installmentLabelByName.get(name))
      .filter((label): label is string => label !== undefined),
  }
}

// Snap to the nearest point on the 1.05^n geometric grid. ~5% wide buckets:
// changes under ~2.5% keep the bucket, a 10% change always moves it.
export function bucketMinor(amountMinor: number): number {
  if (amountMinor === 0) return 0
  const sign = amountMinor < 0 ? -1 : 1
  const step = Math.log(1.05)
  const n = Math.round(Math.log(Math.abs(amountMinor)) / step)
  return sign * Math.round(Math.exp(n * step))
}

// Recursively bucket every number that lives under a key containing "Minor".
function bucketDeep(value: unknown, underMinor: boolean): unknown {
  if (typeof value === 'number') return underMinor ? bucketMinor(value) : value
  if (Array.isArray(value)) return value.map((v) => bucketDeep(v, underMinor))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, bucketDeep(v, underMinor || k.includes('Minor'))]),
    )
  }
  return value
}

export function cacheKey(payload: SanitizedPayload): string {
  return createHash('sha256').update(JSON.stringify(bucketDeep(payload, false))).digest('hex')
}
