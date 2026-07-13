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
  const wishlist = input.wishlist.map((w) => ({ ...w, fundedMinor: 0 }))
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

    // (1) deadline-required just-in-time payments (obligations: scheduled even past surplus).
    // jit is recomputed each month from the live balance, so actual-payment drift self-corrects.
    for (const d of debts) {
      if (d.balance <= 0 || !d.deadline) continue
      const n = Math.max(1, periodsBetween(period, d.deadline.slice(0, 7)) + 1) // past-deadline debts pay off now
      const jit = jitPayment(d.balance, d.apr, n)
      d.balance += interestOn(d.balance, d.apr)
      pay(d, Math.min(Math.max(jit, d.minPaymentMinor ?? 0), d.balance))
    }

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

    // wishlist funding: unallocated leftover (deadline slack + post-debt surplus) funds items;
    // unallocatedMinor keeps its pre-wishlist meaning, wishlistFunding shows where it went
    const wishlistFunding: MonthPlan['wishlistFunding'] = []
    let freeMinor = unallocatedMinor // home currency
    const fund = (w: (typeof wishlist)[number], amountMinor: number) => {
      if (amountMinor <= 0) return
      w.fundedMinor += amountMinor
      freeMinor -= toHome(amountMinor, w.currency)
      wishlistFunding.push({ itemId: w.id, amountMinor, currency: w.currency })
      if (w.fundedMinor >= w.costMinor && wishlistAffordablePeriod[w.id] === null) {
        wishlistAffordablePeriod[w.id] = period
      }
    }
    // target-dated first (earliest target, then priority): fund the level amount that
    // makes the item affordable by its target date when possible
    const dated = wishlist
      .filter((w) => w.fundedMinor < w.costMinor && w.targetDate)
      .sort((a, b) => a.targetDate!.localeCompare(b.targetDate!) || a.priority - b.priority || a.id.localeCompare(b.id))
    for (const w of dated) {
      if (freeMinor <= 0) break
      const n = Math.max(1, periodsBetween(period, w.targetDate!.slice(0, 7)) + 1) // past-target items fund now
      const needMinor = Math.ceil((w.costMinor - w.fundedMinor) / n)
      fund(w, Math.min(needMinor, w.costMinor - w.fundedMinor, fromHome(freeMinor, w.currency)))
    }
    // then by priority (lower = more important), greedily to completion
    const byPriority = wishlist
      .filter((w) => w.fundedMinor < w.costMinor && !w.targetDate)
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
    for (const w of byPriority) {
      if (freeMinor <= 0) break
      fund(w, Math.min(w.costMinor - w.fundedMinor, fromHome(freeMinor, w.currency)))
    }

    // (5) currency-aware funding gaps: group this month's obligations + planned payments by
    // currency against projected balances, then roll balances forward
    const outflow = Object.fromEntries(CURRENCIES.map((c) => [c, 0])) as Record<Currency, number>
    for (const c of CURRENCIES) outflow[c] += (input.billsMinor[c] ?? 0) + (input.variableSpendMinor[c] ?? 0)
    for (const inst of installmentsDue) outflow[inst.currency] += inst.monthlyMinor
    for (const p of debtPayments) outflow[p.currency] += p.amountMinor

    const end = { ...balances }
    for (const c of CURRENCIES) end[c] += (input.monthlyIncomeMinor[c] ?? 0) - outflow[c]

    const fundingGaps: MonthPlan['fundingGaps'] = []
    for (const c of CURRENCIES) {
      if (end[c] >= 0) continue
      const shortfallMinor = -end[c]
      const source = CURRENCIES.filter((s) => s !== c && end[s] > 0).sort((a, b) => toHome(end[b], b) - toHome(end[a], a))[0]
      if (source) {
        const transferMinor = convert(shortfallMinor, c, source, input.rates)
        fundingGaps.push({
          currency: c,
          shortfallMinor,
          suggestion: `Transfer ~ ${formatMoney({ amountMinor: transferMinor, currency: source })} into ${c}`,
        })
        // apply the suggested transfer to the projection so later months stay consistent
        end[source] -= transferMinor
        end[c] = 0
      } else {
        fundingGaps.push({
          currency: c,
          shortfallMinor,
          suggestion: `No other currency can cover ${formatMoney({ amountMinor: shortfallMinor, currency: c })}`,
        })
      }
    }

    // wishlist affordability gaps: the month an item becomes affordable, check the item's
    // currency actually holds the cash; advisory only, never applied to the roll-forward
    for (const w of wishlist) {
      if (wishlistAffordablePeriod[w.id] !== period) continue
      if (end[w.currency] >= w.costMinor) continue
      const shortfallMinor = w.costMinor - end[w.currency]
      const source = CURRENCIES.filter((s) => s !== w.currency && end[s] > 0).sort(
        (a, b) => toHome(end[b], b) - toHome(end[a], a),
      )[0]
      fundingGaps.push({
        currency: w.currency,
        shortfallMinor,
        suggestion: source
          ? `Transfer ~ ${formatMoney({ amountMinor: convert(shortfallMinor, w.currency, source, input.rates), currency: source })} into ${w.currency}`
          : `No other currency can cover ${formatMoney({ amountMinor: shortfallMinor, currency: w.currency })}`,
      })
    }

    for (const c of CURRENCIES) balances[c] = end[c]

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
