import { and, eq, isNull } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { InstallmentForm } from '@/components/installments/installment-form'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { accounts, installments } from '@/lib/db/schema'

export default async function EditInstallmentPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await requireUser()
  const [inst] = await db
    .select()
    .from(installments)
    .where(and(eq(installments.id, id), eq(installments.userId, user.id)))
  if (!inst) notFound()
  const accountRows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      currency: accounts.currency,
    })
    .from(accounts)
    .where(and(eq(accounts.userId, user.id), isNull(accounts.archivedAt)))
  // The <select> defaults to inst.accountId; if that account is now archived
  // it's missing from the list and the browser would silently retarget the
  // installment on save. Keep the current account present (labelled) so it stays put.
  if (!accountRows.some((a) => a.id === inst.accountId)) {
    const [current] = await db
      .select({
        id: accounts.id,
        name: accounts.name,
        currency: accounts.currency,
      })
      .from(accounts)
      .where(and(eq(accounts.id, inst.accountId), eq(accounts.userId, user.id)))
    if (current)
      accountRows.push({ ...current, name: `${current.name} (archived)` })
  }
  return (
    <main>
      <h1 className="px-4 py-3 text-lg font-semibold">Edit installment</h1>
      <InstallmentForm
        accounts={accountRows}
        installment={{
          id: inst.id,
          name: inst.name,
          amount: (inst.monthlyAmountMinor / 100).toFixed(2),
          dueDay: inst.dueDay,
          totalCount: inst.totalCount,
          remainingCount: inst.remainingCount,
          startDate: inst.startDate,
          accountId: inst.accountId,
          apr: inst.apr,
          active: inst.active,
        }}
      />
    </main>
  )
}
