import { and, eq, inArray } from 'drizzle-orm'
import { db, dbPool } from '@/lib/db/client'
import {
  accounts,
  incomeSources,
  occurrences,
  transactions,
} from '@/lib/db/schema'
import type { Currency } from '@/lib/money/money'

export type ConfirmResult = { ok: true } | { ok: false; error: string }

export type OccurrenceKind = 'income' | 'bill' | 'installment'

class ConfirmError extends Error {}

// Per-kind constants come straight from spec §4. bill/installment source lookups land in P4/P5.
const TXN_TYPE = {
  income: 'income',
  bill: 'bill_payment',
  installment: 'installment_payment',
} as const
const TXN_SIGN = { income: 1, bill: -1, installment: -1 } as const
const SOURCE_TYPE = {
  income: 'income_occurrence',
  bill: 'bill_occurrence',
  installment: 'installment_occurrence',
} as const

type DbTx = Parameters<Parameters<typeof dbPool.transaction>[0]>[0]

interface SourceInfo {
  accountId: string
  currency: Currency
  name: string
}

async function loadSource(
  tx: DbTx,
  kind: OccurrenceKind,
  sourceId: string,
  userId: string,
): Promise<SourceInfo> {
  switch (kind) {
    case 'income': {
      // Join accounts so a stale pending occurrence can never post into a
      // write-frozen (archived) account (P2 invariant). Shared by P4/P5.
      const [s] = await tx
        .select({
          accountId: incomeSources.accountId,
          currency: incomeSources.currency,
          name: incomeSources.name,
          archivedAt: accounts.archivedAt,
        })
        .from(incomeSources)
        .innerJoin(accounts, eq(incomeSources.accountId, accounts.id))
        .where(
          and(eq(incomeSources.id, sourceId), eq(incomeSources.userId, userId)),
        )
      if (!s) throw new ConfirmError('Income source not found')
      if (s.archivedAt) throw new ConfirmError('Account is archived')
      return { accountId: s.accountId, currency: s.currency, name: s.name }
    }
    default:
      // 'bill' is added in P4, 'installment' in P5
      throw new ConfirmError(`Unsupported occurrence kind: ${kind}`)
  }
}

export async function confirmOccurrence(params: {
  userId: string
  occurrenceId: string
  actualAmountMinor: number // positive integer minor units
  actualDate: string // 'YYYY-MM-DD'
}): Promise<ConfirmResult> {
  const { userId, occurrenceId, actualAmountMinor, actualDate } = params
  try {
    await dbPool.transaction(async (tx) => {
      const [occ] = await tx
        .update(occurrences)
        .set({ status: 'confirmed' })
        .where(
          and(
            eq(occurrences.id, occurrenceId),
            eq(occurrences.userId, userId),
            inArray(occurrences.status, ['pending', 'overdue']),
          ),
        )
        .returning()
      if (!occ)
        throw new ConfirmError('Occurrence not found or already settled')

      const source = await loadSource(tx, occ.kind, occ.sourceId, userId)

      const [txn] = await tx
        .insert(transactions)
        .values({
          userId,
          accountId: source.accountId,
          type: TXN_TYPE[occ.kind],
          amountMinor: TXN_SIGN[occ.kind] * actualAmountMinor,
          currency: source.currency,
          occurredOn: actualDate,
          note: source.name,
          oneOff: false,
          sourceType: SOURCE_TYPE[occ.kind],
          sourceId: occ.id,
        })
        .returning({ id: transactions.id })

      await tx
        .update(occurrences)
        .set({ transactionId: txn.id })
        .where(eq(occurrences.id, occ.id))
    })
    return { ok: true }
  } catch (e) {
    if (e instanceof ConfirmError) return { ok: false, error: e.message }
    throw e
  }
}

export async function skipOccurrence(
  userId: string,
  occurrenceId: string,
): Promise<ConfirmResult> {
  const rows = await db
    .update(occurrences)
    .set({ status: 'skipped' })
    .where(
      and(
        eq(occurrences.id, occurrenceId),
        eq(occurrences.userId, userId),
        inArray(occurrences.status, ['pending', 'overdue']),
      ),
    )
    .returning({ id: occurrences.id })
  return rows.length === 1
    ? { ok: true }
    : { ok: false, error: 'Occurrence not found or already settled' }
}

export async function unconfirmOccurrence(
  userId: string,
  occurrenceId: string,
): Promise<ConfirmResult> {
  try {
    await dbPool.transaction(async (tx) => {
      const [occ] = await tx
        .select()
        .from(occurrences)
        .where(
          and(
            eq(occurrences.id, occurrenceId),
            eq(occurrences.userId, userId),
            eq(occurrences.status, 'confirmed'),
          ),
        )
      if (!occ) throw new ConfirmError('Occurrence is not confirmed')

      const updated = await tx
        .update(occurrences)
        .set({ status: 'pending', transactionId: null })
        .where(
          and(eq(occurrences.id, occ.id), eq(occurrences.status, 'confirmed')),
        )
        .returning({ id: occurrences.id })
      if (updated.length !== 1)
        throw new ConfirmError('Occurrence is not confirmed')

      if (occ.transactionId) {
        await tx
          .delete(transactions)
          .where(eq(transactions.id, occ.transactionId))
      }
    })
    return { ok: true }
  } catch (e) {
    if (e instanceof ConfirmError) return { ok: false, error: e.message }
    throw e
  }
}
