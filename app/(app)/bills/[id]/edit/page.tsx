import { notFound } from 'next/navigation'
import { and, eq, isNull } from 'drizzle-orm'
import { BillForm } from '@/components/bills/bill-form'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { accounts, bills } from '@/lib/db/schema'

export default async function EditBillPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await requireUser()
  const [bill] = await db
    .select()
    .from(bills)
    .where(and(eq(bills.id, id), eq(bills.userId, user.id)))
  if (!bill) notFound()
  const accountRows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      currency: accounts.currency,
    })
    .from(accounts)
    .where(and(eq(accounts.userId, user.id), isNull(accounts.archivedAt)))
  // The <select> defaults to bill.accountId; if that account is now archived
  // it's missing from the list and the browser would silently retarget the
  // bill on save. Keep the current account present (labelled) so it stays put.
  if (!accountRows.some((a) => a.id === bill.accountId)) {
    const [current] = await db
      .select({
        id: accounts.id,
        name: accounts.name,
        currency: accounts.currency,
      })
      .from(accounts)
      .where(and(eq(accounts.id, bill.accountId), eq(accounts.userId, user.id)))
    if (current)
      accountRows.push({ ...current, name: `${current.name} (archived)` })
  }
  return (
    <main>
      <h1 className="px-4 py-3 text-lg font-semibold">Edit bill</h1>
      <BillForm
        accounts={accountRows}
        bill={{
          id: bill.id,
          name: bill.name,
          amount: (bill.amountMinor / 100).toFixed(2),
          dueDay: bill.dueDay,
          accountId: bill.accountId,
          active: bill.active,
        }}
      />
    </main>
  )
}
