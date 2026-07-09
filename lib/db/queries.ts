import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { transactions } from '@/lib/db/schema'
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
// ponytail: nothing can target an account until P3 (income sources), P4 (bills),
// P5 (installments). Those phases append their checks here; archiveAccount
// already enforces whatever this returns.
export async function archiveBlockers(accountId: string): Promise<string[]> {
  void accountId
  return []
}
