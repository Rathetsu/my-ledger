import { CURRENCIES, formatMoney, type Currency } from '@/lib/money/money'
import { convert } from '@/lib/currency/convert'
import { addPeriods, periodsBetween } from '@/lib/dates/cairo'
import type { MonthPlan, PlanInput, PlanResult } from './types'

// ponytail: positive-only by construction (interest/means/payments are >= 0); do not reuse on signed values — lib/currency/convert.ts has the half-away-from-zero variant for those.
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5)
}

export function interestOn(balanceMinor: number, apr: number): number {
  // apr is percent per year (12 = 12%); simple monthly interest apr/12 per the planner ADR
  return roundHalfUp((balanceMinor * apr) / 1200)
}

export function jitPayment(balanceMinor: number, apr: number, n: number): number {
  // smallest level monthly payment that clears balanceMinor in n payments at apr/12;
  // ceil guarantees the deadline is met despite integer rounding (the last payment is capped at the balance)
  const r = apr / 1200
  if (r === 0) return Math.ceil(balanceMinor / n)
  return Math.ceil((balanceMinor * r) / (1 - (1 + r) ** -n))
}

export function buildPlan(input: PlanInput): PlanResult {
  const home = input.homeCurrency
  const toHome = (amountMinor: number, c: Currency) => (c === home ? amountMinor : convert(amountMinor, c, home, input.rates))
  const fromHome = (amountMinor: number, c: Currency) => (c === home ? amountMinor : convert(amountMinor, home, c, input.rates))

  const debts = input.debts.map((d) => ({ ...d, balance: d.balanceMinor }))
  const balances = Object.fromEntries(CURRENCIES.map((c) => [c, input.accountBalancesMinor[c] ?? 0])) as Record<Currency, number>

  const months: MonthPlan[] = []
  const debtPayoffPeriod: Record<string, string | null> = Object.fromEntries(input.debts.map((d) => [d.id, null]))
  const wishlistAffordablePeriod: Record<string, string | null> = Object.fromEntries(input.wishlist.map((w) => [w.id, null]))
  const surplusMinorByMonth: Record<string, number> = {}

  for (let i = 0; i < input.horizonMonths; i++) {
    const period = addPeriods(input.startPeriod, i)
    const installmentsDue = input.installments.filter((inst) => i < inst.remainingCount)

    // surplus = guaranteed income - bills - installment obligations - variable spend estimate (home currency)
    let surplus = 0
    for (const c of CURRENCIES) {
      surplus += toHome(input.monthlyIncomeMinor[c] ?? 0, c)
      surplus -= toHome(input.billsMinor[c] ?? 0, c)
      surplus -= toHome(input.variableSpendMinor[c] ?? 0, c)
    }
    for (const inst of installmentsDue) surplus -= toHome(inst.monthlyMinor, inst.currency)
    surplusMinorByMonth[period] = surplus

    const debtPayments: MonthPlan['debtPayments'] = []
    let available = surplus
    const pay = (d: (typeof debts)[number], amountMinor: number) => {
      if (amountMinor <= 0) return
      d.balance -= amountMinor
      available -= toHome(amountMinor, d.currency)
      const existing = debtPayments.find((p) => p.debtId === d.id)
      if (existing) existing.amountMinor += amountMinor
      else debtPayments.push({ debtId: d.id, amountMinor, currency: d.currency })
      if (d.balance <= 0 && debtPayoffPeriod[d.id] === null) debtPayoffPeriod[d.id] = period
    }

    // --- (1) deadline-required just-in-time payments: Task 11 ---

    // (2) minimum payments on ASAP debts that define one (obligations: paid even past surplus)
    for (const d of debts) {
      if (d.balance <= 0 || d.deadline || !d.minPaymentMinor) continue
      d.balance += interestOn(d.balance, d.apr)
      pay(d, Math.min(d.minPaymentMinor, d.balance))
    }

    // (3) accrue interest on the remaining open ASAP debts, then avalanche by APR descending
    for (const d of debts) {
      if (d.balance <= 0 || d.deadline || d.minPaymentMinor) continue // min-payment debts accrued in (2)
      d.balance += interestOn(d.balance, d.apr)
    }
    const asap = debts
      .filter((d) => d.balance > 0 && !d.deadline)
      .sort((a, b) => b.apr - a.apr || a.id.localeCompare(b.id))
    for (const d of asap) {
      if (available <= 0) break
      pay(d, Math.min(d.balance, fromHome(available, d.currency)))
    }

    // (4) leftover = deadline slack + post-debt surplus; P8 draws wishlist funding from this
    const unallocatedMinor = Math.max(0, available)

    // --- wishlist funding: filled by P8 ---
    const wishlistFunding: MonthPlan['wishlistFunding'] = []

    // --- (5) currency-aware funding gaps + balance roll-forward: Task 12 ---
    const fundingGaps: MonthPlan['fundingGaps'] = []

    months.push({ period, debtPayments, wishlistFunding, fundingGaps, unallocatedMinor })
  }

  return {
    months,
    debtPayoffPeriod,
    wishlistAffordablePeriod,
    surplusMinorByMonth,
    spendEstimateSource: input.spendEstimateSource,
    highAprInstallmentFlags: input.installments.filter((inst) => (inst.apr ?? 0) >= 15).map((inst) => inst.name),
  }
}
