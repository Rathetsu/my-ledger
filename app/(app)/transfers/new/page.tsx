import { and, asc, eq, isNull } from 'drizzle-orm'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { accounts } from '@/lib/db/schema'
import { getRates } from '@/lib/currency/rates'
import { todayCairo } from '@/lib/dates/cairo'
import { TransferForm } from '@/components/transfer-form'

export default async function NewTransferPage() {
  const user = await requireUser()
  const [rows, rates] = await Promise.all([
    db
      .select({
        id: accounts.id,
        name: accounts.name,
        currency: accounts.currency,
      })
      .from(accounts)
      .where(and(eq(accounts.userId, user.id), isNull(accounts.archivedAt)))
      .orderBy(asc(accounts.createdAt)),
    getRates(),
  ])
  return (
    <TransferForm accounts={rows} rates={rates} defaultDate={todayCairo()} />
  )
}
