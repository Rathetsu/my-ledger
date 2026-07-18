import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { buildPlanInput } from '@/lib/planner/input'
import { buildPlan } from '@/lib/planner/engine'
import { getSettings } from '@/lib/db/queries'
import { sanitizePlanPayload } from '@/lib/ai/sanitize'
import { EmptyState } from '@/components/empty-state'
import { AiAdvisorSlot } from '@/components/plan/ai-advisor-slot'
import { AlgorithmSuggests } from '@/components/plan/algorithm-suggests'
import { PlanTimeline } from '@/components/plan/plan-timeline'

export default async function PlanPage() {
  const user = await requireUser()
  const input = await buildPlanInput(user.id)
  const plan = buildPlan(input)
  const s = await getSettings(user.id)
  const sanitized = sanitizePlanPayload(input, plan)
  const debtNames = Object.fromEntries(input.debts.map((d) => [d.id, d.name]))
  const wishlistNames = Object.fromEntries(
    input.wishlist.map((w) => [w.id, w.name]),
  )

  return (
    <main className="mx-auto max-w-md space-y-4 p-4">
      <h1 className="text-xl font-semibold">Plan</h1>
      <p className="text-xs text-neutral-500">
        Spend estimate:{' '}
        {plan.spendEstimateSource === 'blend'
          ? 'trailing 3-month blend'
          : 'essentials baseline'}
      </p>
      {plan.highAprInstallmentFlags.length > 0 && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
          High-APR installments: {plan.highAprInstallmentFlags.join(', ')}.
          Fixed obligations, but worth renegotiating.
        </p>
      )}
      <AlgorithmSuggests month={plan.months[0]} debtNames={debtNames} />
      <AiAdvisorSlot payload={sanitized} aiEnabled={s.aiEnabled} />
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Debt payoff</h2>
        {input.debts.length === 0 ? (
          <EmptyState
            title="No flexible debts."
            action={
              <Link href="/debts" className="underline">
                Add one to see a payoff plan.
              </Link>
            }
          />
        ) : (
          <ul className="divide-y rounded-lg border">
            {input.debts.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between p-3 text-sm"
              >
                <span>{d.name}</span>
                <span className="rounded-full bg-neutral-100 px-2 py-1 text-xs dark:bg-neutral-800">
                  {plan.debtPayoffPeriod[d.id]
                    ? `Paid off ${plan.debtPayoffPeriod[d.id]}`
                    : `Beyond ${input.horizonMonths} months`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <PlanTimeline
        months={plan.months}
        debtNames={debtNames}
        wishlistNames={wishlistNames}
        homeCurrency={input.homeCurrency}
      />
    </main>
  )
}
