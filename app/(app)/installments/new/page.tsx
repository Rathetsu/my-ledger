import { and, eq, isNull } from 'drizzle-orm'
import { InstallmentForm } from '@/components/installments/installment-form'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { accounts } from '@/lib/db/schema'

export default async function NewInstallmentPage() {
  const user = await requireUser()
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
      <h1 className="px-4 py-3 text-lg font-semibold">New installment</h1>
      <InstallmentForm accounts={accountRows} />
    </main>
  )
}
