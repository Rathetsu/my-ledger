import { and, eq, gt } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { accountBalancesByCurrency } from '@/lib/db/queries'
import { bills, flexibleDebts, incomeSources, installments, settings, wishlistItems } from '@/lib/db/schema'
import { getRates } from '@/lib/currency/rates'
import { CURRENCIES, type Currency } from '@/lib/money/money'
import { periodOf, todayCairo } from '@/lib/dates/cairo'
import { variableSpendActuals } from '@/lib/insights/variable-spend'
import { debtBalancesByDebt } from '@/lib/debts/balance'
import { activeWishlistForPlan } from './wishlist'
import { estimateVariableSpend, type SpendActualsRow } from './spend-estimate'
import type { PlanInput } from './types'

const HORIZON_MONTHS = 24
const ACTUALS_MONTHS_BACK = 6

function sumByCurrency(rows: { currency: string; amountMinor: number }[]): Partial<Record<Currency, number>> {
  const out: Partial<Record<Currency, number>> = {}
  for (const r of rows) out[r.currency as Currency] = (out[r.currency as Currency] ?? 0) + r.amountMinor
  return out
}

export async function buildPlanInput(userId: string): Promise<PlanInput> {
  const [settingsRow] = await db.select().from(settings).where(eq(settings.userId, userId))
  const homeCurrency = (settingsRow?.homeCurrency ?? 'EUR') as Currency
  const baseline = (settingsRow?.essentialsBaseline ?? {}) as Partial<Record<Currency, number>>

  const [rates, incomeRows, billRows, instRows, debtRows, wishlistRows] = await Promise.all([
    getRates(),
    db
      .select()
      .from(incomeSources)
      .where(and(eq(incomeSources.userId, userId), eq(incomeSources.active, true), eq(incomeSources.recurring, true))),
    db.select().from(bills).where(and(eq(bills.userId, userId), eq(bills.active, true))),
    db
      .select()
      .from(installments)
      .where(and(eq(installments.userId, userId), eq(installments.active, true), gt(installments.remainingCount, 0))),
    db.select().from(flexibleDebts).where(eq(flexibleDebts.userId, userId)),
    db.select().from(wishlistItems).where(and(eq(wishlistItems.userId, userId), eq(wishlistItems.status, 'planned'))),
  ])

  // variableSpendActuals is one HTTP round trip per currency (neon-http); CURRENCIES is
  // small (3) and Promise.all runs them concurrently. The former per-account and per-debt
  // fan-outs that dominated /plan load are now single grouped queries (see
  // accountBalancesByCurrency and debtBalancesByDebt below / in lib/db + lib/debts).
  const actualsEntries = await Promise.all(
    CURRENCIES.map(async (c) => [c, await variableSpendActuals(userId, c, ACTUALS_MONTHS_BACK)] as const),
  )
  const actualsByCurrency: Partial<Record<Currency, SpendActualsRow[]>> = Object.fromEntries(actualsEntries)
  const { variableSpendMinor, source } = estimateVariableSpend(baseline, actualsByCurrency)

  const balById = await debtBalancesByDebt(userId)
  const debts: PlanInput['debts'] = debtRows
    .map((d) => ({ d, balanceMinor: balById[d.id] ?? 0 }))
    .filter(({ balanceMinor }) => balanceMinor > 0)
    .map(({ d, balanceMinor }) => ({
      id: d.id,
      name: d.name,
      balanceMinor,
      currency: d.currency as Currency,
      apr: d.apr,
      deadline: d.deadline ?? undefined,
      minPaymentMinor: d.minPaymentMinor ?? undefined,
    }))

  const accountBalancesMinor = await accountBalancesByCurrency(userId)

  return {
    homeCurrency,
    rates,
    horizonMonths: HORIZON_MONTHS,
    startPeriod: periodOf(todayCairo()),
    monthlyIncomeMinor: sumByCurrency(incomeRows),
    billsMinor: sumByCurrency(billRows),
    installments: instRows.map((i) => ({
      name: i.name,
      monthlyMinor: i.monthlyAmountMinor,
      currency: i.currency as Currency,
      remainingCount: i.remainingCount,
      apr: i.apr ?? undefined,
    })),
    variableSpendMinor,
    spendEstimateSource: source,
    debts,
    wishlist: activeWishlistForPlan(wishlistRows),
    accountBalancesMinor,
  }
}
