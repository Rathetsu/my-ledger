import { notFound, redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { accounts, transactions } from '@/lib/db/schema'
import { directMutability } from '@/lib/transactions/mutability'
import { formatMoney } from '@/lib/money/money'
import { TransactionEditForm } from '@/components/transaction-edit-form'

export default async function TransactionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireUser()
  const { id } = await params
  const [row] = await db
    .select({ txn: transactions, accountName: accounts.name })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(and(eq(transactions.id, id), eq(transactions.userId, user.id)))
  if (!row) notFound()
  const { txn, accountName } = row

  if (txn.transferGroupId) redirect(`/transfers/${txn.transferGroupId}`)

  const m = directMutability(txn)
  if (!m.ok) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">{txn.type}</h1>
        <p className="rounded border p-3 font-mono">
          {formatMoney({
            amountMinor: txn.amountMinor,
            currency: txn.currency,
          })}
        </p>
        <p className="rounded border border-amber-400 bg-amber-50 p-3 text-sm">
          {m.reason}
        </p>
      </div>
    )
  }

  return (
    <TransactionEditForm
      txn={{
        id: txn.id,
        type: txn.type,
        amountAbs: (Math.abs(txn.amountMinor) / 100).toFixed(2),
        occurredOn: txn.occurredOn,
        note: txn.note ?? '',
        oneOff: txn.oneOff,
        accountName,
        currency: txn.currency,
      }}
    />
  )
}
