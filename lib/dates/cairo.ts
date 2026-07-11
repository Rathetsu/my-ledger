// The only module allowed to touch timezones (spec §3).
const CAIRO = 'Africa/Cairo'

// en-CA formats as YYYY-MM-DD.
export function todayCairo(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function periodOf(date: string): string {
  return date.slice(0, 7)
}

export function dueDateFor(period: string, dueDay: number): string {
  const [year, month] = period.split('-').map(Number)
  // Day 0 of the next month = last day of this month. UTC so no TZ leakage.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const day = Math.min(dueDay, lastDay)
  return `${period}-${String(day).padStart(2, '0')}`
}

export function addPeriods(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  const yy = Math.floor(total / 12)
  const mm = (total % 12) + 1
  return `${yy}-${String(mm).padStart(2, '0')}`
}

export function periodsBetween(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number)
  const [yb, mb] = b.split('-').map(Number)
  return (yb - ya) * 12 + (mb - ma)
}
