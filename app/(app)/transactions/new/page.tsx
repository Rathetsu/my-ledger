import { and, asc, eq, isNull } from 'drizzle-orm'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { accounts } from '@/lib/db/schema'
import { todayCairo } from '@/lib/dates/cairo'
import { TransactionForm } from '@/components/transaction-form'

export default async function NewTransactionPage() {
  const user = await requireUser()
  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      currency: accounts.currency,
    })
    .from(accounts)
    .where(and(eq(accounts.userId, user.id), isNull(accounts.archivedAt)))
    .orderBy(asc(accounts.createdAt))
  return <TransactionForm accounts={rows} defaultDate={todayCairo()} />
}
