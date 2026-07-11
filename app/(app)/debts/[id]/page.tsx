import { notFound } from 'next/navigation'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { flexibleDebts, transactions } from '@/lib/db/schema'
import { requireUser } from '@/lib/auth'
import { deleteDebtPayment } from '@/lib/actions/debts'
import { DebtForm } from '@/components/debts/debt-form'
import { formatMoney, type Currency } from '@/lib/money/money'

export default async function DebtDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()
  const [debt] = await db
    .select()
    .from(flexibleDebts)
    .where(and(eq(flexibleDebts.id, id), eq(flexibleDebts.userId, user.id)))
  if (!debt) notFound()
  const payments = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.sourceType, 'flexible_debt'), eq(transactions.sourceId, id)))
    .orderBy(desc(transactions.occurredOn))

  return (
    <main className="mx-auto max-w-md space-y-4 p-4">
      <h1 className="text-xl font-semibold">{debt.name}</h1>
      <DebtForm
        existing={{
          id: debt.id,
          name: debt.name,
          originalMinor: debt.originalMinor,
          currency: debt.currency as Currency,
          apr: debt.apr,
          deadline: debt.deadline,
          minPaymentMinor: debt.minPaymentMinor,
        }}
      />
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Payments</h2>
        {payments.length === 0 ? (
          <p className="text-sm text-neutral-500">No payments yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between p-3 text-sm">
                <span>
                  {p.occurredOn} · {formatMoney({ amountMinor: -p.amountMinor, currency: p.currency as Currency })}
                </span>
                <form
                  action={async () => {
                    'use server'
                    await deleteDebtPayment({ id: p.id })
                  }}
                >
                  <button className="p-2 text-xs text-red-600">Reverse</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
