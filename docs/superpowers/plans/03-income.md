# Phase 03: Income Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Backlinks:** [Master index](../plans/README.md) | [Spec](../specs/2026-07-07-my-ledger-design.md) | [Prev: P2 Transactions & Balances](../plans/02-transactions-and-balances.md) | [Next: P4 Bills](../plans/04-bills.md)

**Goal:** Income sources generate confirmable occurrences: schema for `income_sources` and the shared `occurrences` table, income source CRUD, `housekeeping()` v1 (generation + overdue flip), the shared confirm module (confirm / skip / not-yet / un-confirm), the windfall quick action, and attention list v1 on the dashboard, ending with the income E2E flow green.

**Architecture:** Definitions (income sources) generate one `occurrence` per period via the idempotent `housekeeping(userId, today)` routine, called at the top of the dashboard server component. Confirming an occurrence runs one `dbPool` transaction: guard-update the occurrence, insert an `income` transaction with the actual figures, link them. The confirm machinery lives in `lib/occurrences/confirm.ts` and is the shared rail P4 (bills) and P5 (installments) extend, not copy.

**Tech Stack:** Next.js App Router + TypeScript + Tailwind (mobile-first), Neon Postgres + Drizzle (`db` neon-http reads, `dbPool` neon-serverless transactions), drizzle-kit migrations, Better Auth, zod server actions, Vitest + Playwright.

## Global Constraints (from the plans README, verbatim)

- Money: integer minor units, currencies `EUR|USD|EGP`, round half-up, balances derived ([spec §3](../specs/2026-07-07-my-ledger-design.md)).
- No transaction converts currency; transfer legs mutate as a group; source-linked transactions mutate only via owning flow.
- Day boundaries `Africa/Cairo`; due-date clamp `min(due_day, last_day_of_month)`.
- Occurrences unique per (user, kind, source, period); confirms guard on `status IN ('pending','overdue')`; snapshots unique per (user, date).
- All mutations = zod-validated server actions + `revalidatePath`; every table has `user_id`.
- TDD: failing test → minimal code → pass → commit. Frequent small commits.
- The deterministic engine owns all numbers; the AI only quotes.

Clarification (spec §5.3): `overdue` is a pending occurrence past its due date and stays confirmable, so the confirm guard is `status IN ('pending', 'overdue')`. The constraint above is about the guard-based idempotency, which this preserves: a settled (`confirmed`/`skipped`) occurrence can never be confirmed again.

## Conventions consumed from P0-P2 (do not re-implement)

- `todayCairo(): string`, `periodOf(date: string): string`, `dueDateFor(period: string, dueDay: number): string` from `lib/dates/cairo.ts`.
- `Currency`, `CURRENCIES`, `formatMoney(m: Money): string`, `parseToMinor(input: string, currency: Currency): number` from `lib/money/money.ts`.
- `db` (neon-http, reads and single-statement writes) and `dbPool` (neon-serverless Pool, multi-step transactions) from `lib/db/client.ts`; `accounts` and `transactions` tables from `lib/db/schema.ts` per spec §4. Drizzle properties are the spec's snake_case columns camelCased (`amountMinor`, `occurredOn`, `oneOff`, `sourceType`, `sourceId`).
- `transactions.amount_minor` is signed: inflows positive, outflows negative, so `accountBalanceMinor(accountId)` is a plain SUM.
- `requireUser()` from `lib/auth.ts` (redirects unauthenticated requests).
- DB-backed Vitest tests run against `DATABASE_URL` (the dev Neon branch, same one drizzle-kit uses). Every test seeds a fresh random `user_id`, so runs never collide and cleanup is unnecessary.

---

### Task 1: Schema and migration for income_sources and the shared occurrences table

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `drizzle/` migration via drizzle-kit (generated)

**Interfaces:**
- Consumes: `Currency` from `lib/money/money.ts`; existing `accounts`, `transactions` tables in `lib/db/schema.ts`.
- Produces: `incomeSources`, `occurrences` tables and `occurrenceKind`, `occurrenceStatus` pg enums, exported from `lib/db/schema.ts`. The `occurrences` table is shared by P4 (bills) and P5 (installments); its shape is final here.

**Steps:**

- [ ] Add the tables to `lib/db/schema.ts` (append; keep existing exports untouched). Note: if P1 already defined a `currency` pgEnum, use it for the `currency` column instead of `text(...).$type<Currency>()`; the column name stays `currency` either way.

```ts
import { boolean, date, integer, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import type { Currency } from '@/lib/money/money'

export const occurrenceKind = pgEnum('occurrence_kind', ['income', 'bill', 'installment'])
export const occurrenceStatus = pgEnum('occurrence_status', ['pending', 'confirmed', 'skipped', 'overdue'])

export const incomeSources = pgTable('income_sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  amountMinor: integer('amount_minor').notNull(),
  currency: text('currency').$type<Currency>().notNull(),
  dayOfMonth: integer('day_of_month').notNull(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  recurring: boolean('recurring').notNull().default(true),
  active: boolean('active').notNull().default(true),
})

export const occurrences = pgTable(
  'occurrences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    kind: occurrenceKind('kind').notNull(),
    sourceId: uuid('source_id').notNull(),
    period: text('period').notNull(), // 'YYYY-MM'
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    expectedAmountMinor: integer('expected_amount_minor').notNull(),
    status: occurrenceStatus('status').notNull().default('pending'),
    transactionId: uuid('transaction_id').references(() => transactions.id),
  },
  (t) => [uniqueIndex('occurrences_user_kind_source_period').on(t.userId, t.kind, t.sourceId, t.period)],
)
```

`source_id` has no FK because it points at a different table per `kind` (income_sources now, bills in P4, installments in P5); integrity is enforced by the owning flows.

- [ ] Generate and apply the migration:

```bash
npx drizzle-kit generate --name p3-income-occurrences
npx drizzle-kit migrate
```

Expected: one new migration creating both tables, both enums, and the unique index; `migrate` applies cleanly.

- [ ] Commit:

```bash
git add lib/db/schema.ts drizzle && git commit -m "feat(db): income_sources and shared occurrences tables"
```

---

### Task 2: housekeeping v1 (generate income occurrences, flip overdue)

**Files:**
- Create: `lib/housekeeping/index.ts`
- Test: `lib/housekeeping/index.test.ts`

**Interfaces:**
- Consumes: `periodOf(date: string): string`, `dueDateFor(period: string, dueDay: number): string`; `db`; `incomeSources`, `occurrences` schema.
- Produces (canonical, extended in P4/P5/P10): `housekeeping(userId: string, today: string): Promise<void>`; helper `nextPeriod(period: string): string`.

**Steps:**

- [ ] Write the failing test:

```ts
// lib/housekeeping/index.test.ts
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { accounts, incomeSources, occurrences } from '@/lib/db/schema'
import { housekeeping, nextPeriod } from './index'

async function seedIncomeSource(userId: string, dayOfMonth: number, recurring = true) {
  const [account] = await db
    .insert(accounts)
    .values({ userId, name: 'Main EUR', currency: 'EUR' })
    .returning()
  const [source] = await db
    .insert(incomeSources)
    .values({
      userId,
      name: 'Salary',
      amountMinor: 250000,
      currency: 'EUR',
      dayOfMonth,
      accountId: account.id,
      recurring,
      active: true,
    })
    .returning()
  return source
}

function occurrencesFor(userId: string) {
  return db
    .select()
    .from(occurrences)
    .where(and(eq(occurrences.userId, userId), eq(occurrences.kind, 'income')))
}

describe('nextPeriod', () => {
  it('increments within a year and rolls over December', () => {
    expect(nextPeriod('2026-07')).toBe('2026-08')
    expect(nextPeriod('2026-12')).toBe('2027-01')
  })
})

describe('housekeeping v1', () => {
  it('generates current + next period occurrences with clamped due dates', async () => {
    const userId = `test-${randomUUID()}`
    const source = await seedIncomeSource(userId, 31)
    await housekeeping(userId, '2026-02-10')
    const rows = await occurrencesFor(userId)
    expect(rows).toHaveLength(2)
    const byPeriod = Object.fromEntries(rows.map((r) => [r.period, r]))
    expect(byPeriod['2026-02']).toMatchObject({
      sourceId: source.id,
      dueDate: '2026-02-28', // clamped, 2026 is not a leap year
      expectedAmountMinor: 250000,
      status: 'pending',
    })
    expect(byPeriod['2026-03']).toMatchObject({ dueDate: '2026-03-31', status: 'pending' })
  })

  it('is idempotent: a second run creates nothing new', async () => {
    const userId = `test-${randomUUID()}`
    await seedIncomeSource(userId, 25)
    await housekeeping(userId, '2026-07-10')
    await housekeeping(userId, '2026-07-10')
    expect(await occurrencesFor(userId)).toHaveLength(2)
  })

  it('flips pending occurrences past due_date to overdue, leaves future ones pending', async () => {
    const userId = `test-${randomUUID()}`
    await seedIncomeSource(userId, 1)
    await housekeeping(userId, '2026-07-15')
    const rows = await occurrencesFor(userId)
    const byPeriod = Object.fromEntries(rows.map((r) => [r.period, r]))
    expect(byPeriod['2026-07'].status).toBe('overdue') // due 2026-07-01, today is the 15th
    expect(byPeriod['2026-08'].status).toBe('pending')
  })

  it('generates a single current-period occurrence for a non-recurring source, once ever', async () => {
    const userId = `test-${randomUUID()}`
    await seedIncomeSource(userId, 20, false)
    await housekeeping(userId, '2026-07-10')
    await housekeeping(userId, '2026-08-10') // next month: must NOT create a second one
    const rows = await occurrencesFor(userId)
    expect(rows).toHaveLength(1)
    expect(rows[0].period).toBe('2026-07')
  })
})
```

- [ ] Run it and watch it fail:

```bash
npx vitest run lib/housekeeping
```

Expected: FAIL, `Cannot find module './index'` (or equivalent resolution error).

- [ ] Minimal implementation:

```ts
// lib/housekeeping/index.ts
import { and, eq, lt } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { incomeSources, occurrences } from '@/lib/db/schema'
import { dueDateFor, periodOf } from '@/lib/dates/cairo'

export function nextPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

export async function housekeeping(userId: string, today: string): Promise<void> {
  const current = periodOf(today)
  const periods = [current, nextPeriod(current)]

  const sources = await db
    .select()
    .from(incomeSources)
    .where(and(eq(incomeSources.userId, userId), eq(incomeSources.active, true)))

  // ponytail: a non-recurring source gets exactly one occurrence ever; skip it once any exists
  const existing = await db
    .select({ sourceId: occurrences.sourceId })
    .from(occurrences)
    .where(and(eq(occurrences.userId, userId), eq(occurrences.kind, 'income')))
  const hasOccurrence = new Set(existing.map((r) => r.sourceId))

  const rows = sources.flatMap((s) => {
    const target = s.recurring ? periods : hasOccurrence.has(s.id) ? [] : [current]
    return target.map((period) => ({
      userId,
      kind: 'income' as const,
      sourceId: s.id,
      period,
      dueDate: dueDateFor(period, s.dayOfMonth),
      expectedAmountMinor: s.amountMinor,
      status: 'pending' as const,
    }))
  })

  if (rows.length > 0) {
    await db
      .insert(occurrences)
      .values(rows)
      .onConflictDoNothing({
        target: [occurrences.userId, occurrences.kind, occurrences.sourceId, occurrences.period],
      })
  }

  await db
    .update(occurrences)
    .set({ status: 'overdue' })
    .where(and(eq(occurrences.userId, userId), eq(occurrences.status, 'pending'), lt(occurrences.dueDate, today)))
}
```

- [ ] Run again:

```bash
npx vitest run lib/housekeeping
```

Expected: PASS (5 tests).

- [ ] Commit:

```bash
git add lib/housekeeping && git commit -m "feat(housekeeping): generate income occurrences, flip overdue"
```

---

### Task 3: Shared confirm module (confirm / skip / un-confirm)

**Files:**
- Create: `lib/occurrences/confirm.ts`
- Test: `lib/occurrences/confirm.test.ts`

**Interfaces:**
- Consumes: `dbPool`, `db`; `occurrences`, `incomeSources`, `transactions` schema; `Currency`.
- Produces (canonical, reused verbatim by P4 and P5, signatures must not change):
  - `confirmOccurrence(params: { userId: string; occurrenceId: string; actualAmountMinor: number; actualDate: string }): Promise<ConfirmResult>`
  - `skipOccurrence(userId: string, occurrenceId: string): Promise<ConfirmResult>`
  - `unconfirmOccurrence(userId: string, occurrenceId: string): Promise<ConfirmResult>`
  - `type ConfirmResult = { ok: true } | { ok: false; error: string }`

"Not yet" is a pure UI dismiss (no DB write), so it has no function here; housekeeping flips the occurrence to `overdue` once the due date passes.

**Steps:**

- [ ] Write the failing test:

```ts
// lib/occurrences/confirm.test.ts
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { accounts, incomeSources, occurrences, transactions } from '@/lib/db/schema'
import { confirmOccurrence, skipOccurrence, unconfirmOccurrence } from './confirm'

async function seed(status: 'pending' | 'overdue' = 'pending') {
  const userId = `test-${randomUUID()}`
  const [account] = await db
    .insert(accounts)
    .values({ userId, name: 'Main EUR', currency: 'EUR' })
    .returning()
  const [source] = await db
    .insert(incomeSources)
    .values({
      userId,
      name: 'Salary',
      amountMinor: 250000,
      currency: 'EUR',
      dayOfMonth: 25,
      accountId: account.id,
      recurring: true,
      active: true,
    })
    .returning()
  const [occ] = await db
    .insert(occurrences)
    .values({
      userId,
      kind: 'income',
      sourceId: source.id,
      period: '2026-07',
      dueDate: '2026-07-25',
      expectedAmountMinor: 250000,
      status,
    })
    .returning()
  return { userId, account, occ }
}

describe('confirmOccurrence', () => {
  it('posts an income transaction with the actual figures and links it', async () => {
    const { userId, account, occ } = await seed()
    const result = await confirmOccurrence({
      userId,
      occurrenceId: occ.id,
      actualAmountMinor: 260000,
      actualDate: '2026-07-26',
    })
    expect(result).toEqual({ ok: true })
    const [after] = await db.select().from(occurrences).where(eq(occurrences.id, occ.id))
    expect(after.status).toBe('confirmed')
    expect(after.transactionId).not.toBeNull()
    const [txn] = await db.select().from(transactions).where(eq(transactions.id, after.transactionId!))
    expect(txn).toMatchObject({
      accountId: account.id,
      type: 'income',
      amountMinor: 260000, // inflow: positive
      currency: 'EUR',
      occurredOn: '2026-07-26',
      sourceType: 'income_occurrence',
      sourceId: occ.id,
    })
  })

  it('confirms an overdue occurrence too', async () => {
    const { userId, occ } = await seed('overdue')
    const result = await confirmOccurrence({
      userId,
      occurrenceId: occ.id,
      actualAmountMinor: 250000,
      actualDate: '2026-07-30',
    })
    expect(result).toEqual({ ok: true })
  })

  it('rejects a second confirm (guard on status)', async () => {
    const { userId, occ } = await seed()
    await confirmOccurrence({ userId, occurrenceId: occ.id, actualAmountMinor: 250000, actualDate: '2026-07-25' })
    const second = await confirmOccurrence({
      userId,
      occurrenceId: occ.id,
      actualAmountMinor: 250000,
      actualDate: '2026-07-25',
    })
    expect(second.ok).toBe(false)
    expect(await db.select().from(transactions).where(eq(transactions.sourceId, occ.id))).toHaveLength(1)
  })
})

describe('skipOccurrence', () => {
  it('settles the occurrence without posting a transaction', async () => {
    const { userId, occ } = await seed()
    expect(await skipOccurrence(userId, occ.id)).toEqual({ ok: true })
    const [after] = await db.select().from(occurrences).where(eq(occurrences.id, occ.id))
    expect(after.status).toBe('skipped')
    expect(await db.select().from(transactions).where(eq(transactions.sourceId, occ.id))).toHaveLength(0)
  })
})

describe('unconfirmOccurrence', () => {
  it('deletes the linked transaction and resets the occurrence to pending', async () => {
    const { userId, occ } = await seed()
    await confirmOccurrence({ userId, occurrenceId: occ.id, actualAmountMinor: 260000, actualDate: '2026-07-26' })
    expect(await unconfirmOccurrence(userId, occ.id)).toEqual({ ok: true })
    const [after] = await db.select().from(occurrences).where(eq(occurrences.id, occ.id))
    expect(after.status).toBe('pending')
    expect(after.transactionId).toBeNull()
    expect(await db.select().from(transactions).where(eq(transactions.sourceId, occ.id))).toHaveLength(0)
  })

  it('rejects un-confirm of a non-confirmed occurrence', async () => {
    const { userId, occ } = await seed()
    const result = await unconfirmOccurrence(userId, occ.id)
    expect(result.ok).toBe(false)
  })
})
```

- [ ] Run and fail:

```bash
npx vitest run lib/occurrences
```

Expected: FAIL, `Cannot find module './confirm'`.

- [ ] Minimal implementation:

```ts
// lib/occurrences/confirm.ts
import { and, eq, inArray } from 'drizzle-orm'
import { db, dbPool } from '@/lib/db/client'
import { incomeSources, occurrences, transactions } from '@/lib/db/schema'
import type { Currency } from '@/lib/money/money'

export type ConfirmResult = { ok: true } | { ok: false; error: string }

export type OccurrenceKind = 'income' | 'bill' | 'installment'

class ConfirmError extends Error {}

// Per-kind constants come straight from spec §4. bill/installment source lookups land in P4/P5.
const TXN_TYPE = { income: 'income', bill: 'bill_payment', installment: 'installment_payment' } as const
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

async function loadSource(tx: DbTx, kind: OccurrenceKind, sourceId: string): Promise<SourceInfo> {
  switch (kind) {
    case 'income': {
      const [s] = await tx.select().from(incomeSources).where(eq(incomeSources.id, sourceId))
      if (!s) throw new ConfirmError('Income source not found')
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
      if (!occ) throw new ConfirmError('Occurrence not found or already settled')

      const source = await loadSource(tx, occ.kind, occ.sourceId)

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

      await tx.update(occurrences).set({ transactionId: txn.id }).where(eq(occurrences.id, occ.id))
    })
    return { ok: true }
  } catch (e) {
    if (e instanceof ConfirmError) return { ok: false, error: e.message }
    throw e
  }
}

export async function skipOccurrence(userId: string, occurrenceId: string): Promise<ConfirmResult> {
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
  return rows.length === 1 ? { ok: true } : { ok: false, error: 'Occurrence not found or already settled' }
}

export async function unconfirmOccurrence(userId: string, occurrenceId: string): Promise<ConfirmResult> {
  try {
    await dbPool.transaction(async (tx) => {
      const [occ] = await tx
        .select()
        .from(occurrences)
        .where(
          and(eq(occurrences.id, occurrenceId), eq(occurrences.userId, userId), eq(occurrences.status, 'confirmed')),
        )
      if (!occ) throw new ConfirmError('Occurrence is not confirmed')

      const updated = await tx
        .update(occurrences)
        .set({ status: 'pending', transactionId: null })
        .where(and(eq(occurrences.id, occ.id), eq(occurrences.status, 'confirmed')))
        .returning({ id: occurrences.id })
      if (updated.length !== 1) throw new ConfirmError('Occurrence is not confirmed')

      if (occ.transactionId) {
        await tx.delete(transactions).where(eq(transactions.id, occ.transactionId))
      }
    })
    return { ok: true }
  } catch (e) {
    if (e instanceof ConfirmError) return { ok: false, error: e.message }
    throw e
  }
}
```

Un-confirm is the ONLY code path that deletes a source-linked transaction (spec §3 mutability). P2's edit/delete transaction actions must keep refusing rows with `source_type` set.

- [ ] Run again:

```bash
npx vitest run lib/occurrences
```

Expected: PASS (6 tests).

- [ ] Commit:

```bash
git add lib/occurrences && git commit -m "feat(occurrences): shared confirm/skip/unconfirm module"
```

---

### Task 4: Income source CRUD, windfall, and occurrence server actions

**Files:**
- Create: `lib/actions/schemas.ts` (plain module, importable by tests and client code; a `'use server'` file may only export async functions)
- Create: `lib/actions/income.ts`
- Create: `lib/actions/occurrences.ts`
- Test: `lib/actions/schemas.test.ts`

**Interfaces:**
- Consumes: `requireUser()`, `db`, `parseToMinor(input, currency)`, `dueDateFor(period, dueDay)`, `confirmOccurrence(...)`, `skipOccurrence(...)`, `unconfirmOccurrence(...)`, `revalidatePath`.
- Produces:
  - `incomeSourceInput`, `windfallInput`, `confirmInput` zod schemas (`lib/actions/schemas.ts`)
  - `createIncomeSource(input: unknown): Promise<ActionResult>`, `updateIncomeSource(id: string, input: unknown): Promise<ActionResult>`, `setIncomeSourceActive(id: string, active: boolean): Promise<ActionResult>`, `addWindfall(input: unknown): Promise<ActionResult>` (`lib/actions/income.ts`)
  - `confirmOccurrenceAction(input: unknown)`, `skipOccurrenceAction(input: unknown)`, `unconfirmOccurrenceAction(input: unknown)` (`lib/actions/occurrences.ts`)
  - `type ActionResult = { ok: true } | { ok: false; error: string }`

**Steps:**

- [ ] Write the failing schema test:

```ts
// lib/actions/schemas.test.ts
import { describe, expect, it } from 'vitest'
import { confirmInput, incomeSourceInput, windfallInput } from './schemas'

describe('incomeSourceInput', () => {
  it('accepts a valid source', () => {
    const r = incomeSourceInput.safeParse({
      name: 'Salary',
      amount: '2500.00',
      currency: 'EUR',
      dayOfMonth: 25,
      accountId: '4f3c2b1a-0000-4000-8000-000000000001',
      recurring: true,
      active: true,
    })
    expect(r.success).toBe(true)
  })

  it('rejects day 0, day 32, empty name, unknown currency', () => {
    const base = {
      name: 'Salary',
      amount: '2500.00',
      currency: 'EUR',
      dayOfMonth: 25,
      accountId: '4f3c2b1a-0000-4000-8000-000000000001',
      recurring: true,
      active: true,
    }
    expect(incomeSourceInput.safeParse({ ...base, dayOfMonth: 0 }).success).toBe(false)
    expect(incomeSourceInput.safeParse({ ...base, dayOfMonth: 32 }).success).toBe(false)
    expect(incomeSourceInput.safeParse({ ...base, name: '  ' }).success).toBe(false)
    expect(incomeSourceInput.safeParse({ ...base, currency: 'GBP' }).success).toBe(false)
  })
})

describe('windfallInput', () => {
  it('accepts amount + account + date', () => {
    const r = windfallInput.safeParse({
      accountId: '4f3c2b1a-0000-4000-8000-000000000001',
      amount: '150.00',
      date: '2026-07-07',
      note: 'freelance',
    })
    expect(r.success).toBe(true)
  })
})

describe('confirmInput', () => {
  it('requires a YYYY-MM-DD date', () => {
    const base = {
      occurrenceId: '4f3c2b1a-0000-4000-8000-000000000001',
      amount: '2500.00',
      currency: 'EUR',
      date: '2026-07-25',
    }
    expect(confirmInput.safeParse(base).success).toBe(true)
    expect(confirmInput.safeParse({ ...base, date: '25/07/2026' }).success).toBe(false)
  })
})
```

- [ ] Run and fail:

```bash
npx vitest run lib/actions
```

Expected: FAIL, `Cannot find module './schemas'`.

- [ ] Implement the schemas:

```ts
// lib/actions/schemas.ts
import { z } from 'zod'
import { CURRENCIES } from '@/lib/money/money'

const currencySchema = z.enum(CURRENCIES as unknown as [string, ...string[]])
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const incomeSourceInput = z.object({
  name: z.string().trim().min(1).max(100),
  amount: z.string().min(1),
  currency: currencySchema,
  dayOfMonth: z.coerce.number().int().min(1).max(31),
  accountId: z.string().uuid(),
  recurring: z.boolean(),
  active: z.boolean().default(true),
})

export const windfallInput = z.object({
  accountId: z.string().uuid(),
  amount: z.string().min(1),
  date: isoDate,
  note: z.string().trim().max(200).default(''),
})

export const confirmInput = z.object({
  occurrenceId: z.string().uuid(),
  amount: z.string().min(1),
  currency: currencySchema,
  date: isoDate,
})

export const idInput = z.object({ occurrenceId: z.string().uuid() })
```

- [ ] Run again:

```bash
npx vitest run lib/actions
```

Expected: PASS.

- [ ] Implement the income actions (verified by the E2E in Task 7; the DB mechanics they call are already unit-tested):

```ts
// lib/actions/income.ts
'use server'

import { and, eq, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { dueDateFor } from '@/lib/dates/cairo'
import { db } from '@/lib/db/client'
import { accounts, incomeSources, occurrences, transactions } from '@/lib/db/schema'
import { parseToMinor } from '@/lib/money/money'
import type { Currency } from '@/lib/money/money'
import { incomeSourceInput, windfallInput } from './schemas'

export type ActionResult = { ok: true } | { ok: false; error: string }

async function ownedActiveAccount(userId: string, accountId: string) {
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId), isNull(accounts.archivedAt)))
  return account ?? null
}

function parseAmount(amount: string, currency: Currency): number | null {
  try {
    const minor = parseToMinor(amount, currency)
    return minor > 0 ? minor : null
  } catch {
    return null
  }
}

export async function createIncomeSource(input: unknown): Promise<ActionResult> {
  const user = await requireUser()
  const parsed = incomeSourceInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid input' }
  const account = await ownedActiveAccount(user.id, parsed.data.accountId)
  if (!account) return { ok: false, error: 'Account not found' }
  if (account.currency !== parsed.data.currency) return { ok: false, error: 'Account currency must match' }
  const amountMinor = parseAmount(parsed.data.amount, parsed.data.currency as Currency)
  if (amountMinor === null) return { ok: false, error: 'Invalid amount' }

  await db.insert(incomeSources).values({
    userId: user.id,
    name: parsed.data.name,
    amountMinor,
    currency: parsed.data.currency as Currency,
    dayOfMonth: parsed.data.dayOfMonth,
    accountId: parsed.data.accountId,
    recurring: parsed.data.recurring,
    active: parsed.data.active,
  })
  revalidatePath('/income')
  revalidatePath('/')
  return { ok: true }
}

export async function updateIncomeSource(id: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser()
  const parsed = incomeSourceInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid input' }
  const account = await ownedActiveAccount(user.id, parsed.data.accountId)
  if (!account) return { ok: false, error: 'Account not found' }
  if (account.currency !== parsed.data.currency) return { ok: false, error: 'Account currency must match' }
  const amountMinor = parseAmount(parsed.data.amount, parsed.data.currency as Currency)
  if (amountMinor === null) return { ok: false, error: 'Invalid amount' }

  const updated = await db
    .update(incomeSources)
    .set({
      name: parsed.data.name,
      amountMinor,
      currency: parsed.data.currency as Currency,
      dayOfMonth: parsed.data.dayOfMonth,
      accountId: parsed.data.accountId,
      recurring: parsed.data.recurring,
      active: parsed.data.active,
    })
    .where(and(eq(incomeSources.id, id), eq(incomeSources.userId, user.id)))
    .returning({ id: incomeSources.id })
  if (updated.length !== 1) return { ok: false, error: 'Income source not found' }

  // Definition edits rewrite pending occurrences only (spec §3).
  // P4 extracts this loop into rewritePendingOccurrences(kind, sourceId) in lib/housekeeping.
  const pending = await db
    .select()
    .from(occurrences)
    .where(
      and(
        eq(occurrences.userId, user.id),
        eq(occurrences.kind, 'income'),
        eq(occurrences.sourceId, id),
        eq(occurrences.status, 'pending'),
      ),
    )
  for (const occ of pending) {
    await db
      .update(occurrences)
      .set({ expectedAmountMinor: amountMinor, dueDate: dueDateFor(occ.period, parsed.data.dayOfMonth) })
      .where(eq(occurrences.id, occ.id))
  }

  revalidatePath('/income')
  revalidatePath('/')
  return { ok: true }
}

export async function setIncomeSourceActive(id: string, active: boolean): Promise<ActionResult> {
  const user = await requireUser()
  const updated = await db
    .update(incomeSources)
    .set({ active })
    .where(and(eq(incomeSources.id, id), eq(incomeSources.userId, user.id)))
    .returning({ id: incomeSources.id })
  if (updated.length !== 1) return { ok: false, error: 'Income source not found' }
  revalidatePath('/income')
  revalidatePath('/')
  return { ok: true }
}

export async function addWindfall(input: unknown): Promise<ActionResult> {
  const user = await requireUser()
  const parsed = windfallInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid input' }
  const account = await ownedActiveAccount(user.id, parsed.data.accountId)
  if (!account) return { ok: false, error: 'Account not found' }
  const amountMinor = parseAmount(parsed.data.amount, account.currency as Currency)
  if (amountMinor === null) return { ok: false, error: 'Invalid amount' }

  // Plain income transaction: no source_type, never projected by the planner (spec §5.3).
  await db.insert(transactions).values({
    userId: user.id,
    accountId: account.id,
    type: 'income',
    amountMinor,
    currency: account.currency as Currency,
    occurredOn: parsed.data.date,
    note: parsed.data.note,
    oneOff: false,
  })
  revalidatePath('/')
  revalidatePath('/income')
  revalidatePath('/accounts')
  return { ok: true }
}
```

- [ ] Implement the occurrence actions:

```ts
// lib/actions/occurrences.ts
'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { parseToMinor } from '@/lib/money/money'
import type { Currency } from '@/lib/money/money'
import { confirmOccurrence, skipOccurrence, unconfirmOccurrence } from '@/lib/occurrences/confirm'
import type { ConfirmResult } from '@/lib/occurrences/confirm'
import { confirmInput, idInput } from './schemas'

function revalidateOccurrenceScreens() {
  revalidatePath('/')
  revalidatePath('/income')
  revalidatePath('/accounts')
}

export async function confirmOccurrenceAction(input: unknown): Promise<ConfirmResult> {
  const user = await requireUser()
  const parsed = confirmInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid input' }
  let actualAmountMinor: number
  try {
    actualAmountMinor = parseToMinor(parsed.data.amount, parsed.data.currency as Currency)
  } catch {
    return { ok: false, error: 'Invalid amount' }
  }
  if (actualAmountMinor <= 0) return { ok: false, error: 'Amount must be positive' }

  const result = await confirmOccurrence({
    userId: user.id,
    occurrenceId: parsed.data.occurrenceId,
    actualAmountMinor,
    actualDate: parsed.data.date,
  })
  if (result.ok) revalidateOccurrenceScreens()
  return result
}

export async function skipOccurrenceAction(input: unknown): Promise<ConfirmResult> {
  const user = await requireUser()
  const parsed = idInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid input' }
  const result = await skipOccurrence(user.id, parsed.data.occurrenceId)
  if (result.ok) revalidateOccurrenceScreens()
  return result
}

export async function unconfirmOccurrenceAction(input: unknown): Promise<ConfirmResult> {
  const user = await requireUser()
  const parsed = idInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid input' }
  const result = await unconfirmOccurrence(user.id, parsed.data.occurrenceId)
  if (result.ok) revalidateOccurrenceScreens()
  return result
}
```

- [ ] Type-check and run the full unit suite:

```bash
npx tsc --noEmit && npx vitest run
```

Expected: PASS.

- [ ] Commit:

```bash
git add lib/actions && git commit -m "feat(income): income source crud, windfall, occurrence actions"
```

---

### Task 5: Income screens (list, form, windfall quick action)

**Files:**
- Create: `app/(app)/income/page.tsx`
- Create: `app/(app)/income/new/page.tsx`
- Create: `app/(app)/income/[id]/edit/page.tsx`
- Create: `components/income/income-source-form.tsx`
- Create: `components/income/windfall-form.tsx`

**Interfaces:**
- Consumes: `requireUser()`, `db`, `formatMoney(m)`, income actions from Task 4.
- Produces: `/income` routes wired into the existing bottom tab nav (add an Income tab entry in the P0 shell if not present).

**Steps:**

- [ ] Income list page (server component):

```tsx
// app/(app)/income/page.tsx
import Link from 'next/link'
import { and, eq, isNull } from 'drizzle-orm'
import { WindfallForm } from '@/components/income/windfall-form'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { accounts, incomeSources } from '@/lib/db/schema'
import { formatMoney } from '@/lib/money/money'

export default async function IncomePage() {
  const user = await requireUser()
  const sources = await db.select().from(incomeSources).where(eq(incomeSources.userId, user.id))
  const accountRows = await db
    .select({ id: accounts.id, name: accounts.name, currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.userId, user.id), isNull(accounts.archivedAt)))

  return (
    <main className="pb-20">
      <div className="flex items-center justify-between px-4 py-3">
        <h1 className="text-lg font-semibold">Income</h1>
        <Link href="/income/new" className="rounded bg-black px-3 py-2 text-sm text-white">
          New income source
        </Link>
      </div>
      <ul className="divide-y divide-gray-100">
        {sources.map((s) => (
          <li key={s.id}>
            <Link href={`/income/${s.id}/edit`} className="flex items-center justify-between px-4 py-3">
              <span>
                <span className="block font-medium">{s.name}</span>
                <span className="block text-sm text-gray-500">
                  Day {s.dayOfMonth} {s.recurring ? 'monthly' : 'once'}
                  {s.active ? '' : ' (inactive)'}
                </span>
              </span>
              <span className="font-medium">{formatMoney({ amountMinor: s.amountMinor, currency: s.currency })}</span>
            </Link>
          </li>
        ))}
        {sources.length === 0 && <li className="px-4 py-6 text-sm text-gray-500">No income sources yet.</li>}
      </ul>
      <section className="mt-6 px-4">
        <h2 className="mb-2 text-sm font-semibold text-gray-500">Add extra income (windfall)</h2>
        <WindfallForm accounts={accountRows} />
      </section>
    </main>
  )
}
```

- [ ] Income source form (client component, shared by new and edit):

```tsx
// components/income/income-source-form.tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createIncomeSource, setIncomeSourceActive, updateIncomeSource } from '@/lib/actions/income'

interface AccountOption {
  id: string
  name: string
  currency: string
}

interface SourceValues {
  id: string
  name: string
  amount: string // decimal string, e.g. '2500.00'
  dayOfMonth: number
  accountId: string
  recurring: boolean
  active: boolean
}

export function IncomeSourceForm({ accounts, source }: { accounts: AccountOption[]; source?: SourceValues }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const accountId = String(f.get('accountId'))
    const account = accounts.find((a) => a.id === accountId)
    const input = {
      name: String(f.get('name')),
      amount: String(f.get('amount')),
      currency: account?.currency ?? 'EUR', // source currency = target account currency
      dayOfMonth: Number(f.get('dayOfMonth')),
      accountId,
      recurring: f.get('recurring') === 'on',
      active: source?.active ?? true,
    }
    const result = source ? await updateIncomeSource(source.id, input) : await createIncomeSource(input)
    if (result.ok) router.push('/income')
    else setError(result.error)
  }

  async function toggleActive() {
    if (!source) return
    const result = await setIncomeSourceActive(source.id, !source.active)
    if (result.ok) router.push('/income')
    else setError(result.error)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 px-4 py-3">
      <label className="block text-sm">
        Name
        <input name="name" required defaultValue={source?.name} className="mt-1 w-full rounded border px-3 py-2" />
      </label>
      <label className="block text-sm">
        Amount
        <input
          name="amount"
          required
          inputMode="decimal"
          defaultValue={source?.amount}
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        Account
        <select name="accountId" required defaultValue={source?.accountId} className="mt-1 w-full rounded border px-3 py-2">
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.currency})
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        Day of month
        <input
          name="dayOfMonth"
          type="number"
          min={1}
          max={31}
          required
          defaultValue={source?.dayOfMonth ?? 25}
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input name="recurring" type="checkbox" defaultChecked={source?.recurring ?? true} />
        Recurring monthly
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" className="w-full rounded bg-black py-3 text-white">
        {source ? 'Save' : 'Create'}
      </button>
      {source && (
        <button type="button" onClick={toggleActive} className="w-full rounded border py-3">
          {source.active ? 'Deactivate' : 'Reactivate'}
        </button>
      )}
    </form>
  )
}
```

- [ ] New and edit pages (server components):

```tsx
// app/(app)/income/new/page.tsx
import { and, eq, isNull } from 'drizzle-orm'
import { IncomeSourceForm } from '@/components/income/income-source-form'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { accounts } from '@/lib/db/schema'

export default async function NewIncomeSourcePage() {
  const user = await requireUser()
  const accountRows = await db
    .select({ id: accounts.id, name: accounts.name, currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.userId, user.id), isNull(accounts.archivedAt)))
  return (
    <main>
      <h1 className="px-4 py-3 text-lg font-semibold">New income source</h1>
      <IncomeSourceForm accounts={accountRows} />
    </main>
  )
}
```

```tsx
// app/(app)/income/[id]/edit/page.tsx
import { notFound } from 'next/navigation'
import { and, eq, isNull } from 'drizzle-orm'
import { IncomeSourceForm } from '@/components/income/income-source-form'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { accounts, incomeSources } from '@/lib/db/schema'

export default async function EditIncomeSourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()
  const [source] = await db
    .select()
    .from(incomeSources)
    .where(and(eq(incomeSources.id, id), eq(incomeSources.userId, user.id)))
  if (!source) notFound()
  const accountRows = await db
    .select({ id: accounts.id, name: accounts.name, currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.userId, user.id), isNull(accounts.archivedAt)))
  return (
    <main>
      <h1 className="px-4 py-3 text-lg font-semibold">Edit income source</h1>
      <IncomeSourceForm
        accounts={accountRows}
        source={{
          id: source.id,
          name: source.name,
          amount: (source.amountMinor / 100).toFixed(2),
          dayOfMonth: source.dayOfMonth,
          accountId: source.accountId,
          recurring: source.recurring,
          active: source.active,
        }}
      />
    </main>
  )
}
```

- [ ] Windfall quick-action form (client component):

```tsx
// components/income/windfall-form.tsx
'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { addWindfall } from '@/lib/actions/income'
import { todayCairo } from '@/lib/dates/cairo'

interface AccountOption {
  id: string
  name: string
  currency: string
}

export function WindfallForm({ accounts }: { accounts: AccountOption[] }) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const result = await addWindfall({
      accountId: String(f.get('accountId')),
      amount: String(f.get('amount')),
      date: String(f.get('date')),
      note: String(f.get('note') ?? ''),
    })
    if (result.ok) {
      formRef.current?.reset()
      setError(null)
      router.refresh()
    } else {
      setError(result.error)
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-2 rounded border p-3">
      <select name="accountId" required className="w-full rounded border px-3 py-2 text-sm">
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} ({a.currency})
          </option>
        ))}
      </select>
      <input
        name="amount"
        required
        inputMode="decimal"
        placeholder="Amount"
        aria-label="Windfall amount"
        className="w-full rounded border px-3 py-2 text-sm"
      />
      <input name="date" type="date" required defaultValue={todayCairo()} className="w-full rounded border px-3 py-2 text-sm" />
      <input name="note" placeholder="Note (optional)" className="w-full rounded border px-3 py-2 text-sm" />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" className="w-full rounded border py-2 text-sm font-medium">
        Add extra income
      </button>
    </form>
  )
}
```

`todayCairo()` is pure string math over `Date.now()` in the Cairo zone, safe to call client-side; if P1 marked it server-only, pass `todayCairo()` down from `app/(app)/income/page.tsx` as a prop instead.

- [ ] Verify manually:

```bash
npm run dev
```

At 375px viewport: `/income` lists nothing, create a source, it appears with its formatted amount; edit changes persist; windfall form posts and clears. Then commit:

```bash
git add app/\(app\)/income components/income && git commit -m "feat(income): income screens and windfall quick action"
```

---

### Task 6: Dashboard housekeeping call, attention list v1, confirm sheet

**Files:**
- Create: `lib/occurrences/attention.ts`
- Create: `components/dashboard/attention-list.tsx`
- Create: `components/occurrences/confirm-sheet.tsx`
- Modify: `app/(app)/page.tsx` (the P2 dashboard)

**Interfaces:**
- Consumes: `housekeeping(userId, today)`, `todayCairo()`, `requireUser()`, `db`, `formatMoney(m)`, occurrence actions from Task 4.
- Produces (P4/P5 extend the query, the signature is fixed): `getAttentionItems(userId: string, today: string): Promise<AttentionItem[]>` and `interface AttentionItem { occurrenceId: string; kind: 'income' | 'bill' | 'installment'; sourceName: string; expectedAmountMinor: number; currency: Currency; dueDate: string; status: 'pending' | 'overdue' }`.

**Steps:**

- [ ] Attention query helper. `today` is unused until P4's 7-day bill window; it is in the signature now so P4 does not have to change call sites:

```ts
// lib/occurrences/attention.ts
import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { incomeSources, occurrences } from '@/lib/db/schema'
import type { Currency } from '@/lib/money/money'

export interface AttentionItem {
  occurrenceId: string
  kind: 'income' | 'bill' | 'installment'
  sourceName: string
  expectedAmountMinor: number
  currency: Currency
  dueDate: string
  status: 'pending' | 'overdue'
}

export async function getAttentionItems(userId: string, today: string): Promise<AttentionItem[]> {
  void today // used from P4 on (bills due within 7 days)
  const rows = await db
    .select({
      occurrenceId: occurrences.id,
      kind: occurrences.kind,
      sourceName: incomeSources.name,
      expectedAmountMinor: occurrences.expectedAmountMinor,
      currency: incomeSources.currency,
      dueDate: occurrences.dueDate,
      status: occurrences.status,
    })
    .from(occurrences)
    .innerJoin(incomeSources, eq(occurrences.sourceId, incomeSources.id))
    .where(
      and(
        eq(occurrences.userId, userId),
        eq(occurrences.kind, 'income'),
        inArray(occurrences.status, ['pending', 'overdue']),
      ),
    )
    .orderBy(asc(occurrences.dueDate))
  return rows as AttentionItem[]
}
```

- [ ] Confirm sheet (client, bottom sheet, pre-filled and editable):

```tsx
// components/occurrences/confirm-sheet.tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { confirmOccurrenceAction, skipOccurrenceAction } from '@/lib/actions/occurrences'
import type { AttentionItem } from '@/lib/occurrences/attention'

export function ConfirmSheet({ item, onClose }: { item: AttentionItem; onClose: () => void }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onConfirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    const f = new FormData(e.currentTarget)
    const result = await confirmOccurrenceAction({
      occurrenceId: item.occurrenceId,
      amount: String(f.get('amount')),
      currency: item.currency,
      date: String(f.get('date')),
    })
    setBusy(false)
    if (result.ok) {
      onClose()
      router.refresh()
    } else {
      setError(result.error)
    }
  }

  async function onSkip() {
    setBusy(true)
    const result = await skipOccurrenceAction({ occurrenceId: item.occurrenceId })
    setBusy(false)
    if (result.ok) {
      onClose()
      router.refresh()
    } else {
      setError(result.error)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} role="dialog" aria-modal="true">
      <form
        onSubmit={onConfirm}
        onClick={(e) => e.stopPropagation()}
        className="absolute inset-x-0 bottom-0 space-y-3 rounded-t-2xl bg-white p-4"
      >
        <h3 className="font-semibold">{item.sourceName}</h3>
        <label className="block text-sm">
          Amount ({item.currency})
          <input
            name="amount"
            inputMode="decimal"
            defaultValue={(item.expectedAmountMinor / 100).toFixed(2)}
            className="mt-1 w-full rounded border px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          Date
          <input type="date" name="date" defaultValue={item.dueDate} className="mt-1 w-full rounded border px-3 py-2" />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="grid grid-cols-3 gap-2">
          <button type="submit" disabled={busy} className="rounded bg-black py-3 text-white">
            Confirm
          </button>
          <button type="button" disabled={busy} onClick={onSkip} className="rounded border py-3">
            Skip
          </button>
          <button type="button" onClick={onClose} className="rounded border py-3">
            Not yet
          </button>
        </div>
      </form>
    </div>
  )
}
```

- [ ] Attention list (client, opens the sheet):

```tsx
// components/dashboard/attention-list.tsx
'use client'

import { useState } from 'react'
import { ConfirmSheet } from '@/components/occurrences/confirm-sheet'
import type { AttentionItem } from '@/lib/occurrences/attention'
import { formatMoney } from '@/lib/money/money'

const CTA = { income: 'confirm arrived', bill: 'confirm paid', installment: 'confirm paid' } as const

export function AttentionList({ items }: { items: AttentionItem[] }) {
  const [selected, setSelected] = useState<AttentionItem | null>(null)
  if (items.length === 0) return null
  return (
    <section className="mt-4">
      <h2 className="px-4 text-sm font-semibold text-gray-500">Needs attention</h2>
      <ul className="divide-y divide-gray-100">
        {items.map((item) => (
          <li key={item.occurrenceId}>
            <button
              type="button"
              onClick={() => setSelected(item)}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <span>
                <span className="block font-medium">{item.sourceName}</span>
                <span className={`block text-sm ${item.status === 'overdue' ? 'text-red-600' : 'text-gray-500'}`}>
                  {item.status === 'overdue' ? 'Overdue' : 'Due'} {item.dueDate}, {CTA[item.kind]}
                </span>
              </span>
              <span className="font-medium">
                {formatMoney({ amountMinor: item.expectedAmountMinor, currency: item.currency })}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {selected && <ConfirmSheet item={selected} onClose={() => setSelected(null)} />}
    </section>
  )
}
```

- [ ] Wire the dashboard. Modify `app/(app)/page.tsx`: housekeeping runs first, then the attention list renders above the existing P2 sections (net worth, recent activity), which stay untouched:

```tsx
// app/(app)/page.tsx, additions to the existing server component
import { AttentionList } from '@/components/dashboard/attention-list'
import { requireUser } from '@/lib/auth'
import { todayCairo } from '@/lib/dates/cairo'
import { housekeeping } from '@/lib/housekeeping'
import { getAttentionItems } from '@/lib/occurrences/attention'

export default async function DashboardPage() {
  const user = await requireUser()
  const today = todayCairo()
  await housekeeping(user.id, today)
  const attention = await getAttentionItems(user.id, today)
  return (
    <main className="pb-20">
      <AttentionList items={attention} />
      {/* existing P2 dashboard sections render below, unchanged */}
    </main>
  )
}
```

- [ ] Verify manually at 375px: with a source whose day is later this month, the dashboard shows the item with "confirm arrived"; tapping opens the sheet pre-filled with amount and due date; "Not yet" just closes it. Commit:

```bash
git add lib/occurrences/attention.ts components/dashboard components/occurrences app/\(app\)/page.tsx \
  && git commit -m "feat(dashboard): attention list v1 with confirm sheet"
```

---

### Task 7: E2E, salary source to confirmed actual balance

**Files:**
- Test: `tests/e2e/income.spec.ts`

**Interfaces:**
- Consumes: the running app with email+password auth, `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD` env vars. If P0 ships a shared sign-in helper in `tests/e2e/`, import it instead of the inline one below.

**Steps:**

- [ ] Write the spec:

```ts
// tests/e2e/income.spec.ts
import { expect, test, type Page } from '@playwright/test'

async function signIn(page: Page) {
  await page.goto('/sign-in')
  await page.getByLabel(/email/i).fill(process.env.E2E_EMAIL!)
  await page.getByLabel(/password/i).fill(process.env.E2E_PASSWORD!)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL('**/')
}

test('salary: create source, occurrence appears, confirm with edited amount, balance reflects actual', async ({
  page,
}) => {
  await signIn(page)
  const stamp = Date.now()
  const accountName = `Payroll ${stamp}`
  const sourceName = `Salary ${stamp}`

  // Account with zero opening balance (P1 flow)
  await page.goto('/accounts')
  await page.getByRole('link', { name: /new account/i }).click()
  await page.getByLabel(/name/i).fill(accountName)
  await page.getByLabel(/currency/i).selectOption('EUR')
  await page.getByLabel(/opening balance/i).fill('0')
  await page.getByRole('button', { name: /create/i }).click()

  // Income source due on the 28th (within the current period, so it is pending, not overdue)
  await page.goto('/income')
  await page.getByRole('link', { name: /new income source/i }).click()
  await page.getByLabel(/^name/i).fill(sourceName)
  await page.getByLabel(/^amount/i).fill('2500.00')
  await page.getByLabel(/account/i).selectOption({ label: `${accountName} (EUR)` })
  await page.getByLabel(/day of month/i).fill('28')
  await page.getByRole('button', { name: /create/i }).click()

  // Dashboard load runs housekeeping and generates the occurrence
  await page.goto('/')
  const row = page.getByRole('button', { name: new RegExp(sourceName) })
  await expect(row).toBeVisible()
  await expect(row).toContainText('confirm arrived')
  await row.click()

  // Sheet is pre-filled with the expected amount; edit it to the actual
  const amount = page.getByLabel(/amount/i)
  await expect(amount).toHaveValue('2500.00')
  await amount.fill('2600.00')
  await page.getByRole('button', { name: /^confirm$/i }).click()

  // Item leaves the attention list; balance reflects the ACTUAL amount
  await expect(page.getByRole('button', { name: new RegExp(sourceName) })).toHaveCount(0)
  await page.goto('/accounts')
  await expect(page.getByText(accountName).locator('xpath=ancestor::li')).toContainText('2,600.00')
})
```

If today is the 28th-31st, day 28 may already be past and the item shows "Overdue" instead of "Due"; the test only asserts "confirm arrived", which both states render, so it stays green.

- [ ] Run it:

```bash
npx playwright test tests/e2e/income.spec.ts
```

Expected: PASS.

- [ ] Full gate, then commit:

```bash
npx tsc --noEmit && npx vitest run && npx playwright test
git add tests/e2e/income.spec.ts && git commit -m "test(e2e): income confirm flow with edited actual amount"
```

---

**Phase exit criteria:** all Vitest suites green, `tests/e2e/income.spec.ts` green, manual 375px walkthrough of income list, confirm sheet, windfall. Update `docs/wiki/status.md`.

**Backlinks:** [Master index](../plans/README.md) | [Spec](../specs/2026-07-07-my-ledger-design.md) | [Prev: P2 Transactions & Balances](../plans/02-transactions-and-balances.md) | [Next: P4 Bills](../plans/04-bills.md)
