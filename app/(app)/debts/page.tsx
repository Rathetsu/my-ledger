import Link from 'next/link'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { accounts, flexibleDebts } from '@/lib/db/schema'
import { requireUser } from '@/lib/auth'
import { debtBalanceMinor } from '@/lib/debts/balance'
import { formatMoney, type Currency } from '@/lib/money/money'
import { DebtPaySheet } from '@/components/debts/debt-pay-sheet'

export default async function DebtsPage() {
  const user = await requireUser()
  const debtRows = await db.select().from(flexibleDebts).where(eq(flexibleDebts.userId, user.id)).orderBy(flexibleDebts.name)
  const accountRows = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, user.id), isNull(accounts.archivedAt)))
  const debts = await Promise.all(debtRows.map(async (d) => ({ ...d, balanceMinor: await debtBalanceMinor(d.id) })))

  return (
    <main className="mx-auto max-w-md space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Debts</h1>
        <Link href="/debts/new" className="text-sm underline">
          Add debt
        </Link>
      </div>
      {debts.length === 0 ? (
        <p className="text-sm text-neutral-500">No flexible debts. Add one to see it in the plan.</p>
      ) : (
        <ul className="space-y-3">
          {debts.map((d) => (
            <li key={d.id} className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <Link href={`/debts/${d.id}`} className="font-medium">
                  {d.name}
                </Link>
                <span className="tabular-nums">{formatMoney({ amountMinor: d.balanceMinor, currency: d.currency as Currency })}</span>
              </div>
              <p className="text-xs text-neutral-500">
                {d.apr}% APR{d.deadline ? ` · due by ${d.deadline}` : ' · pay ASAP'}
                {d.minPaymentMinor ? ` · min ${formatMoney({ amountMinor: d.minPaymentMinor, currency: d.currency as Currency })}` : ''}
              </p>
              {d.balanceMinor > 0 && (
                <DebtPaySheet
                  debt={{ id: d.id, name: d.name, currency: d.currency as Currency }}
                  accounts={accountRows.filter((a) => a.currency === d.currency).map((a) => ({ id: a.id, name: a.name }))}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
