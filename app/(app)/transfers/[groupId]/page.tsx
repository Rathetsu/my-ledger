import { notFound } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { accounts, transactions } from '@/lib/db/schema'
import { formatMoney } from '@/lib/money/money'
import { TransferGroupForm } from '@/components/transfer-group-form'

export default async function TransferGroupPage({
  params,
}: {
  params: Promise<{ groupId: string }>
}) {
  const user = await requireUser()
  const { groupId } = await params
  const legs = await db
    .select({
      id: transactions.id,
      type: transactions.type,
      amountMinor: transactions.amountMinor,
      currency: transactions.currency,
      occurredOn: transactions.occurredOn,
      note: transactions.note,
      accountName: accounts.name,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(
      and(
        eq(transactions.transferGroupId, groupId),
        eq(transactions.userId, user.id),
      ),
    )
  const out = legs.find((l) => l.type === 'transfer_out')
  const inn = legs.find((l) => l.type === 'transfer_in')
  if (!out || !inn) notFound()

  const sentMinor = -out.amountMinor
  const cross = out.currency !== inn.currency

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Transfer</h1>
      <div className="space-y-1 rounded border p-4 text-sm">
        <p>
          {out.accountName}:{' '}
          <span className="font-mono">
            {formatMoney({
              amountMinor: out.amountMinor,
              currency: out.currency,
            })}
          </span>
        </p>
        <p>
          {inn.accountName}:{' '}
          <span className="font-mono">
            {formatMoney({
              amountMinor: inn.amountMinor,
              currency: inn.currency,
            })}
          </span>
        </p>
        {cross && (
          <p className="text-gray-500">
            {/* Derived from the two actual legs, never applied (CONTEXT.md). */}
            Effective rate: 1 {out.currency} ={' '}
            {(inn.amountMinor / sentMinor).toFixed(4)} {inn.currency}
          </p>
        )}
        <p className="text-gray-500">{out.occurredOn}</p>
      </div>
      <TransferGroupForm
        groupId={groupId}
        cross={cross}
        sent={(sentMinor / 100).toFixed(2)}
        received={(inn.amountMinor / 100).toFixed(2)}
        occurredOn={out.occurredOn}
        note={out.note ?? ''}
        fromCurrency={out.currency}
        toCurrency={inn.currency}
      />
    </div>
  )
}
