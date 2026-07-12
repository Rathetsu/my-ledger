import type { Currency } from '@/lib/money/money'
import { roundHalfUp } from './engine'

export interface SpendActualsRow {
  period: string
  totalMinor: number
}

export function estimateVariableSpend(
  baselineMinor: Partial<Record<Currency, number>>,
  actualsByCurrency: Partial<Record<Currency, SpendActualsRow[]>>,
): { variableSpendMinor: Partial<Record<Currency, number>>; source: 'baseline' | 'blend' } {
  const periodsWithData = new Set<string>()
  for (const rows of Object.values(actualsByCurrency)) {
    for (const r of rows ?? []) if (r.totalMinor > 0) periodsWithData.add(r.period)
  }
  if (periodsWithData.size < 3) {
    return { variableSpendMinor: { ...baselineMinor }, source: 'baseline' }
  }
  const trailing = [...periodsWithData].sort().slice(-3)
  const variableSpendMinor: Partial<Record<Currency, number>> = { ...baselineMinor }
  for (const [currency, rows] of Object.entries(actualsByCurrency) as [Currency, SpendActualsRow[] | undefined][]) {
    const sum = (rows ?? []).filter((r) => trailing.includes(r.period)).reduce((a, r) => a + r.totalMinor, 0)
    if (sum > 0) variableSpendMinor[currency] = roundHalfUp(sum / 3)
  }
  return { variableSpendMinor, source: 'blend' }
}
