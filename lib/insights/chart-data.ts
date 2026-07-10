import { addPeriods } from '@/lib/dates/cairo'

export interface CategorySpendRow {
  period: string
  category: string
  totalMinor: number
}

export function pivotByCategory(
  rows: CategorySpendRow[],
  maxSeries = 5,
): { categories: string[]; data: Record<string, string | number>[] } {
  if (rows.length === 0) return { categories: [], data: [] }
  const totals = new Map<string, number>()
  for (const r of rows) totals.set(r.category, (totals.get(r.category) ?? 0) + r.totalMinor)
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name)
  const kept = ranked.slice(0, maxSeries)
  const hasOther = ranked.length > maxSeries
  const categories = hasOther ? [...kept, 'Other'] : kept
  const periods = [...new Set(rows.map((r) => r.period))].sort()
  const data = periods.map((period) => {
    const row: Record<string, string | number> = { period }
    for (const c of categories) row[c] = 0
    for (const r of rows.filter((x) => x.period === period)) {
      const key = kept.includes(r.category) ? r.category : 'Other'
      row[key] = (row[key] as number) + r.totalMinor
    }
    return row
  })
  return { categories, data }
}

export function trendSeries(
  rows: { period: string; totalMinor: number }[],
  from: string,
  to: string,
): { period: string; totalMinor: number }[] {
  const byPeriod = new Map(rows.map((r) => [r.period, r.totalMinor]))
  const out: { period: string; totalMinor: number }[] = []
  for (let p = from; p <= to; p = addPeriods(p, 1)) {
    out.push({ period: p, totalMinor: byPeriod.get(p) ?? 0 })
  }
  return out
}
