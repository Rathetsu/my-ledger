import { notFound } from 'next/navigation'
import { and, eq, isNull } from 'drizzle-orm'
import { IncomeSourceForm } from '@/components/income/income-source-form'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { accounts, incomeSources } from '@/lib/db/schema'

export default async function EditIncomeSourcePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await requireUser()
  const [source] = await db
    .select()
    .from(incomeSources)
    .where(and(eq(incomeSources.id, id), eq(incomeSources.userId, user.id)))
  if (!source) notFound()
  const accountRows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      currency: accounts.currency,
    })
    .from(accounts)
    .where(and(eq(accounts.userId, user.id), isNull(accounts.archivedAt)))
  return (
    <main>
      <h1 className="px-4 py-3 text-lg font-semibold">Edit income source</h1>
      <IncomeSourceForm
        accounts={accountRows}
        source={{
          id: source.id,
          name: source.name,
          amount: (source.amountMinor / 100).toFixed(2),
          dayOfMonth: source.dayOfMonth,
          accountId: source.accountId,
          recurring: source.recurring,
          active: source.active,
        }}
      />
    </main>
  )
}
