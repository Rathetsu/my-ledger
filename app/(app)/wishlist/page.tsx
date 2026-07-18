import Link from 'next/link'
import { and, eq, isNull } from 'drizzle-orm'
import { EmptyState } from '@/components/empty-state'
import { db } from '@/lib/db/client'
import { accountBalancesById } from '@/lib/db/queries'
import { accounts, wishlistItems } from '@/lib/db/schema'
import { requireUser } from '@/lib/auth'
import { buildPlanInput } from '@/lib/planner/input'
import { buildPlan } from '@/lib/planner/engine'
import { unpurchaseWishlistItem } from '@/lib/actions/wishlist'
import { formatMoney, type Currency } from '@/lib/money/money'
import { WishlistItemForm } from '@/components/wishlist/wishlist-item-form'
import { PurchaseSheet } from '@/components/wishlist/purchase-sheet'

export default async function WishlistPage() {
  const user = await requireUser()
  const input = await buildPlanInput(user.id)
  const plan = buildPlan(input)
  const items = await db
    .select()
    .from(wishlistItems)
    .where(eq(wishlistItems.userId, user.id))
    .orderBy(wishlistItems.priority, wishlistItems.name)
  const accountRows = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, user.id), isNull(accounts.archivedAt)))
  const balById = await accountBalancesById(user.id)
  const accountsWithBalances = accountRows.map((a) => ({
    id: a.id,
    name: a.name,
    currency: a.currency,
    balanceMinor: balById[a.id] ?? 0,
  }))
  const planned = items.filter((i) => i.status === 'planned')
  const purchased = items.filter((i) => i.status === 'purchased')

  return (
    <main className="mx-auto max-w-md space-y-4 p-4">
      <h1 className="text-xl font-semibold">Wishlist</h1>
      <WishlistItemForm />
      {planned.length === 0 && purchased.length === 0 && (
        <EmptyState title="Nothing here yet. Add something you are saving for." />
      )}
      {planned.length > 0 && (
        <ul className="space-y-3">
          {planned.map((i) => (
            <li key={i.id} className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <Link href={`/wishlist/${i.id}`} className="font-medium">
                  {i.name}
                </Link>
                <span className="tabular-nums">
                  {formatMoney({
                    amountMinor: i.costMinor,
                    currency: i.currency as Currency,
                  })}
                </span>
              </div>
              <p className="text-xs text-neutral-500">
                Priority {i.priority}
                {i.targetDate ? ` · target ${i.targetDate}` : ''}
              </p>
              <span className="inline-block rounded-full bg-neutral-100 px-2 py-1 text-xs dark:bg-neutral-800">
                {plan.wishlistAffordablePeriod[i.id]
                  ? `Affordable ${plan.wishlistAffordablePeriod[i.id]}`
                  : `Beyond ${input.horizonMonths} months`}
              </span>
              <PurchaseSheet
                item={{
                  id: i.id,
                  name: i.name,
                  costMinor: i.costMinor,
                  currency: i.currency as Currency,
                }}
                accounts={accountsWithBalances
                  .filter((a) => a.currency === i.currency)
                  .map((a) => ({
                    id: a.id,
                    name: a.name,
                    balanceMinor: a.balanceMinor,
                  }))}
              />
            </li>
          ))}
        </ul>
      )}
      {purchased.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Purchased</h2>
          <ul className="divide-y rounded-lg border">
            {purchased.map((i) => (
              <li
                key={i.id}
                className="flex items-center justify-between p-3 text-sm"
              >
                <span>
                  {i.name} ·{' '}
                  {formatMoney({
                    amountMinor: i.costMinor,
                    currency: i.currency as Currency,
                  })}
                </span>
                <form
                  action={async () => {
                    'use server'
                    await unpurchaseWishlistItem({ id: i.id })
                  }}
                >
                  <button className="p-2 text-xs text-red-600">
                    Un-purchase
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
