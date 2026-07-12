import { and, eq, gt, isNull } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { accountBalanceMinor } from '@/lib/db/queries'
import { accounts, bills, flexibleDebts, incomeSources, installments, settings } from '@/lib/db/schema'
import { getRates } from '@/lib/currency/rates'
import { CURRENCIES, type Currency } from '@/lib/money/money'
import { periodOf, todayCairo } from '@/lib/dates/cairo'
import { variableSpendActuals } from '@/lib/insights/variable-spend'
import { debtBalanceMinor } from '@/lib/debts/balance'
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

  const [rates, incomeRows, billRows, instRows, debtRows, accountRows] = await Promise.all([
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
  ])

  const actualsByCurrency: Partial<Record<Currency, SpendActualsRow[]>> = {}
  for (const c of CURRENCIES) actualsByCurrency[c] = await variableSpendActuals(userId, c, ACTUALS_MONTHS_BACK)
  const { variableSpendMinor, source } = estimateVariableSpend(baseline, actualsByCurrency)

  const debts: PlanInput['debts'] = []
  for (const d of debtRows) {
    const balanceMinor = await debtBalanceMinor(d.id)
    if (balanceMinor > 0) {
      debts.push({
        id: d.id,
        name: d.name,
        balanceMinor,
        currency: d.currency as Currency,
        apr: d.apr,
        deadline: d.deadline ?? undefined,
        minPaymentMinor: d.minPaymentMinor ?? undefined,
      })
    }
  }

  const accountBalancesMinor: Partial<Record<Currency, number>> = {}
  for (const a of accountRows) {
    const bal = await accountBalanceMinor(a.id)
    accountBalancesMinor[a.currency as Currency] = (accountBalancesMinor[a.currency as Currency] ?? 0) + bal
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
    wishlist: [], // P8 fills this from wishlist_items
    accountBalancesMinor,
  }
}
