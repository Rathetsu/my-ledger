'use client'

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatMoney, type Currency } from '@/lib/money/money'

export function TrendChart({ data, currency }: { data: { period: string; totalMinor: number }[]; currency: Currency }) {
  if (data.every((d) => d.totalMinor === 0)) {
    return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-neutral-500">No {currency} expenses yet.</p>
  }
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="period" tickLine={false} axisLine={{ stroke: 'var(--chart-axis)' }} tick={{ fill: 'var(--chart-muted)', fontSize: 12 }} />
        <YAxis width={56} tickLine={false} axisLine={false} tick={{ fill: 'var(--chart-muted)', fontSize: 12 }} tickFormatter={(v: number) => (v / 100).toLocaleString()} />
        <Tooltip formatter={(v) => formatMoney({ amountMinor: Number(v), currency })} />
        <Line type="monotone" dataKey="totalMinor" stroke="var(--chart-1)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}
