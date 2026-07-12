import type { Currency } from '@/lib/money/money'
import type { Rates } from '@/lib/currency/rates'

export interface PlanInput {
  homeCurrency: Currency
  rates: Rates
  horizonMonths: number // default 24
  startPeriod: string // "YYYY-MM", first planned month
  monthlyIncomeMinor: Partial<Record<Currency, number>> // guaranteed only
  billsMinor: Partial<Record<Currency, number>>
  installments: { name: string; monthlyMinor: number; currency: Currency; remainingCount: number; apr?: number }[]
  variableSpendMinor: Partial<Record<Currency, number>> // G4 blend, computed by caller
  spendEstimateSource: 'baseline' | 'blend' // how variableSpendMinor was derived; echoed in PlanResult
  debts: { id: string; name: string; balanceMinor: number; currency: Currency; apr: number; deadline?: string; minPaymentMinor?: number }[]
  wishlist: { id: string; name: string; costMinor: number; currency: Currency; priority: number; targetDate?: string }[]
  accountBalancesMinor: Partial<Record<Currency, number>>
}

export interface MonthPlan {
  period: string
  debtPayments: { debtId: string; amountMinor: number; currency: Currency }[]
  wishlistFunding: { itemId: string; amountMinor: number; currency: Currency }[]
  fundingGaps: { currency: Currency; shortfallMinor: number; suggestion: string }[]
  unallocatedMinor: number // home currency; deadline slack + post-debt surplus, before wishlist funding
}

export interface PlanResult {
  months: MonthPlan[]
  debtPayoffPeriod: Record<string, string | null> // debtId -> "YYYY-MM"
  wishlistAffordablePeriod: Record<string, string | null>
  surplusMinorByMonth: Record<string, number> // home currency
  spendEstimateSource: 'baseline' | 'blend'
  highAprInstallmentFlags: string[]
}
