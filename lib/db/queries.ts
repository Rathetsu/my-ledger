import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  accounts,
  bills,
  incomeSources,
  installments,
  settings,
  transactions,
} from '@/lib/db/schema'
import type { Currency } from '@/lib/money/money'

// The archived-account write-freeze primitive (spec §3, invariant #3): true when
// the user's account is archived. Every money-write path (edit/delete/reverse/
// reactivate) guards on this, mirroring the inline checks on the insert paths.
export async function isAccountArchived(
  userId: string,
  accountId: string,
): Promise<boolean> {
  const [a] = await db
    .select({ archivedAt: accounts.archivedAt })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
  return a?.archivedAt != null
}

// Balances are always derived by summing transactions (spec §3).
// Postgres SUM comes back as string, or null over zero rows.
export async function accountBalanceMinor(accountId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string | null>`sum(${transactions.amountMinor})` })
    .from(transactions)
    .where(eq(transactions.accountId, accountId))
  return Number(row?.total ?? 0)
}

// Batched form of accountBalanceMinor, grouped by currency (fixes the /plan N+1:
// one Neon HTTP round trip instead of one per account). LEFT JOIN + COALESCE so
// a non-archived account with zero transactions still contributes its currency at 0.
export async function accountBalancesByCurrency(
  userId: string,
): Promise<Partial<Record<Currency, number>>> {
  const rows = await db
    .select({
      currency: accounts.currency,
      total: sql<string | null>`coalesce(sum(${transactions.amountMinor}), 0)`,
    })
    .from(accounts)
    .leftJoin(transactions, eq(transactions.accountId, accounts.id))
    .where(and(eq(accounts.userId, userId), isNull(accounts.archivedAt)))
    .groupBy(accounts.currency)
  return Object.fromEntries(rows.map((r) => [r.currency as Currency, Number(r.total ?? 0)]))
}

export async function totalsByCurrency(
  userId: string,
): Promise<Partial<Record<Currency, number>>> {
  const rows = await db
    .select({
      currency: transactions.currency,
      total: sql<string | null>`sum(${transactions.amountMinor})`,
    })
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .groupBy(transactions.currency)
  return Object.fromEntries(rows.map((r) => [r.currency, Number(r.total ?? 0)]))
}

// Names of active definitions still targeting this account; empty = archivable.
// ponytail: P5 (installments) appends its active targets here too.
export async function archiveBlockers(
  accountId: string,
  userId: string,
): Promise<string[]> {
  const incomeRows = await db
    .select({ name: incomeSources.name })
    .from(incomeSources)
    .where(
      and(
        eq(incomeSources.accountId, accountId),
        eq(incomeSources.userId, userId),
        eq(incomeSources.active, true),
      ),
    )
  const billRows = await db
    .select({ name: bills.name })
    .from(bills)
    .where(
      and(
        eq(bills.accountId, accountId),
        eq(bills.userId, userId),
        eq(bills.active, true),
      ),
    )
  const installmentRows = await db
    .select({ name: installments.name })
    .from(installments)
    .where(
      and(
        eq(installments.accountId, accountId),
        eq(installments.userId, userId),
        eq(installments.active, true),
      ),
    )
  return [
    ...incomeRows.map((r) => r.name),
    ...billRows.map((r) => r.name),
    ...installmentRows.map((r) => r.name),
  ]
}

// Lazy upsert on first authenticated read (spec §5.1). Defaults come from
// the schema: home_currency EUR, ai_enabled true.
export async function getSettings(userId: string) {
  const [inserted] = await db
    .insert(settings)
    .values({ userId })
    .onConflictDoNothing()
    .returning()
  if (inserted) return inserted
  const [existing] = await db
    .select()
    .from(settings)
    .where(eq(settings.userId, userId))
  return existing
}
