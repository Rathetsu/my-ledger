// Shared scaffolding for the three definition kinds (income sources, bills,
// installments). Extracted so the write-freeze guard and amount parsing live in
// ONE place — a fix here can't land in one kind and silently miss the siblings.
// Not a 'use server' module: it exports helpers/types, not server actions.
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { accounts } from '@/lib/db/schema'
import { parseToMinor } from '@/lib/money/money'
import type { Currency } from '@/lib/money/money'

export type ActionResult = { ok: true } | { ok: false; error: string }

// Thrown inside a definition-update transaction to distinguish "not found" from a
// real error; only the message is surfaced, never the class name.
export class NotFoundError extends Error {}

// The owned, active (non-archived) account, or null. The isNull(archivedAt) clause
// is the write-freeze guard on the create/update paths (spec §3).
export async function ownedActiveAccount(userId: string, accountId: string) {
  const [account] = await db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.id, accountId),
        eq(accounts.userId, userId),
        isNull(accounts.archivedAt),
      ),
    )
  return account ?? null
}

// Positive integer minor units, or null on invalid / non-positive input.
export function parseAmount(amount: string, currency: Currency): number | null {
  try {
    const minor = parseToMinor(amount, currency)
    return minor > 0 ? minor : null
  } catch {
    return null
  }
}
