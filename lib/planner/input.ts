import { and, eq, gt, isNull } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { accountBalanceMinor } from '@/lib/db/queries'
import { accounts, bills, flexibleDebts, incomeSources, installments, settings, wishlistItems } from '@/lib/db/schema'
import { getRates } from '@/lib/currency/rates'
import { CURRENCIES, type Currency } from '@/lib/money/money'
import { periodOf, todayCairo } from '@/lib/dates/cairo'
import { variableSpendActuals } from '@/lib/insights/variable-spend'
import { debtBalanceMinor } from '@/lib/debts/balance'
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

  const [rates, incomeRows, billRows, instRows, debtRows, accountRows, wishlistRows] = await Promise.all([
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
    db.select().from(accounts).where(and(eq(accounts.userId, userId), isNull(accounts.archivedAt))),
    db.select().from(wishlistItems).where(and(eq(wishlistItems.userId, userId), eq(wishlistItems.status, 'planned'))),
  ])

  // Each of these queries is a one-shot HTTP round trip (neon-http, see lib/db/client.ts),
  // so awaiting them one row at a time serializes N round trips end to end. With hundreds of
  // accounts (accumulated e2e/dev accounts never get archived) that turned /plan into a
  // 100+ second load; Promise.all lets the independent per-row lookups run concurrently.
  const actualsEntries = await Promise.all(
    CURRENCIES.map(async (c) => [c, await variableSpendActuals(userId, c, ACTUALS_MONTHS_BACK)] as const),
  )
  const actualsByCurrency: Partial<Record<Currency, SpendActualsRow[]>> = Object.fromEntries(actualsEntries)
  const { variableSpendMinor, source } = estimateVariableSpend(baseline, actualsByCurrency)

  const debtBalances = await Promise.all(
    debtRows.map(async (d) => ({ d, balanceMinor: await debtBalanceMinor(d.id) })),
  )
  const debts: PlanInput['debts'] = debtBalances
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

  const accountBalances = await Promise.all(
    accountRows.map(async (a) => ({ currency: a.currency as Currency, bal: await accountBalanceMinor(a.id) })),
  )
  const accountBalancesMinor: Partial<Record<Currency, number>> = {}
  for (const { currency, bal } of accountBalances) {
    accountBalancesMinor[currency] = (accountBalancesMinor[currency] ?? 0) + bal
  }

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
