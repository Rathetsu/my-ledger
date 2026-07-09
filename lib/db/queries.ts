import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { incomeSources, settings, transactions } from '@/lib/db/schema'
import type { Currency } from '@/lib/money/money'

// Balances are always derived by summing transactions (spec §3).
// Postgres SUM comes back as string, or null over zero rows.
export async function accountBalanceMinor(accountId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string | null>`sum(${transactions.amountMinor})` })
    .from(transactions)
    .where(eq(transactions.accountId, accountId))
  return Number(row?.total ?? 0)
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
// ponytail: P4 (bills) / P5 (installments) append their active targets here.
export async function archiveBlockers(
  accountId: string,
  userId: string,
): Promise<string[]> {
  const rows = await db
    .select({ name: incomeSources.name })
    .from(incomeSources)
    .where(
      and(
        eq(incomeSources.accountId, accountId),
        eq(incomeSources.userId, userId),
        eq(incomeSources.active, true),
      ),
    )
  return rows.map((r) => r.name)
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
