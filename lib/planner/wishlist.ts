import type { Currency } from '@/lib/money/money'
import type { PlanInput } from './types'

export interface WishlistRow {
  id: string
  name: string
  costMinor: number
  currency: string
  priority: number
  targetDate: string | null
  status: string
}

export function activeWishlistForPlan(rows: WishlistRow[]): PlanInput['wishlist'] {
  return rows
    .filter((r) => r.status === 'planned')
    .map((r) => ({
      id: r.id,
      name: r.name,
      costMinor: r.costMinor,
      currency: r.currency as Currency,
      priority: r.priority,
      targetDate: r.targetDate ?? undefined,
    }))
}
