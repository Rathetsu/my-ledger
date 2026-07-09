import { notFound } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { accounts } from '@/lib/db/schema'
import { accountBalanceMinor } from '@/lib/db/queries'
import { formatMoney } from '@/lib/money/money'
import { AccountSettingsForm } from '@/components/account-settings-form'

export default async function AccountPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireUser()
  const { id } = await params
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.userId, user.id)))
  if (!account) notFound()
  const balanceMinor = await accountBalanceMinor(account.id)
  return (
    <AccountSettingsForm
      account={{
        id: account.id,
        name: account.name,
        currency: account.currency,
        balanceFormatted: formatMoney({
          amountMinor: balanceMinor,
          currency: account.currency,
        }),
        archived: Boolean(account.archivedAt),
      }}
    />
  )
}
