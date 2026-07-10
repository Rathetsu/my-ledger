'use client'

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CHART_OTHER, CHART_SERIES } from '@/components/charts/palette'
import { formatMoney, type Currency } from '@/lib/money/money'

export function SpendByCategoryChart({
  categories,
  data,
  currency,
}: {
  categories: string[]
  data: Record<string, string | number>[]
  currency: Currency
}) {
  if (data.length === 0) {
    return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-neutral-500">No {currency} expenses yet.</p>
  }
  const fmt = (v: number) => formatMoney({ amountMinor: v, currency })
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="period" tickLine={false} axisLine={{ stroke: 'var(--chart-axis)' }} tick={{ fill: 'var(--chart-muted)', fontSize: 12 }} />
        <YAxis width={56} tickLine={false} axisLine={false} tick={{ fill: 'var(--chart-muted)', fontSize: 12 }} tickFormatter={(v: number) => (v / 100).toLocaleString()} />
        <Tooltip formatter={(v) => fmt(Number(v))} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {categories.map((cat, i) => (
          <Bar
            key={cat}
            dataKey={cat}
            stackId="spend"
            fill={cat === 'Other' ? CHART_OTHER : CHART_SERIES[i]}
            stroke="var(--chart-surface)"
            strokeWidth={2}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
