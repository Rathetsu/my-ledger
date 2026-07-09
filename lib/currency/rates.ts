import type { Currency } from '@/lib/money/money'

export interface Rates {
  base: 'USD'
  rates: Record<Currency, number>
  fetchedAt: string
}
