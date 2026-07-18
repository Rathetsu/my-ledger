'use client'

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export interface TrendPoint {
  date: string // YYYY-MM-DD
  netWorth: number // major units, current home currency
  debt: number // major units, current home currency
}

export function TrendCharts({ points, homeCurrency }: { points: TrendPoint[]; homeCurrency: string }) {
  if (points.length < 2) {
    return (
      <section aria-label="Trends" className="mt-6 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="text-base font-semibold">Trends</h2>
        <p className="mt-2 text-sm text-neutral-500">
          Trends appear once two daily snapshots exist. Come back tomorrow.
        </p>
      </section>
    )
  }
  return (
    <section aria-label="Trends" className="mt-6 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 className="text-base font-semibold">Net worth ({homeCurrency})</h2>
      <div className="mt-2 h-48" role="img" aria-label={`Net worth over time in ${homeCurrency}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={24} />
            <YAxis tick={{ fontSize: 11 }} width={56} />
            <Tooltip />
            <Line type="monotone" dataKey="netWorth" name="Net worth" stroke="#2563eb" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <h2 className="mt-6 text-base font-semibold">Total debt ({homeCurrency})</h2>
      <div className="mt-2 h-48" role="img" aria-label={`Total debt over time in ${homeCurrency}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={24} />
            <YAxis tick={{ fontSize: 11 }} width={56} />
            <Tooltip />
            <Line type="monotone" dataKey="debt" name="Total debt" stroke="#dc2626" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
