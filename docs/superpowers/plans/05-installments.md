# Phase 05: Installments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Backlinks:** [Master index](../plans/README.md) | [Spec](../specs/2026-07-07-my-ledger-design.md) | [Prev: P4 Bills](../plans/04-bills.md) | [Next: P6 Expenses & Insights](../plans/06-expenses-and-insights.md)

**Goal:** Count-based installments on the shared occurrence rails: `installments` table and CRUD (create sets `remaining_count = total_count`, edits rewrite pending occurrences), housekeeping generates `kind='installment'` occurrences only while `active` and `remaining_count > 0`, confirming posts an `installment_payment` AND decrements `remaining_count` atomically (un-confirm increments it back), completion at 0 flips `active=false`, plus an installments list screen showing progress and next due date.

**Architecture:** Installments are the third and last occurrence kind. Everything rides P3/P4 machinery: `housekeeping(userId, today)` gains an installment generation block, `lib/occurrences/confirm.ts` gains an installment source lookup plus a count decrement/increment inside the existing `dbPool` transaction, and `rewritePendingOccurrences` gains its installment case. The only new invariant: the countdown and the payment move together or not at all, and generation stops the moment the countdown hits zero.

**Tech Stack:** Next.js App Router + TypeScript + Tailwind (mobile-first), Neon Postgres + Drizzle (`db` neon-http reads, `dbPool` neon-serverless transactions), drizzle-kit migrations, Stack Auth, zod server actions, Vitest + Playwright.

## Global Constraints (from the plans README, verbatim)

- Money: integer minor units, currencies `EUR|USD|EGP`, round half-up, balances derived ([spec §3](../specs/2026-07-07-my-ledger-design.md)).
- No transaction converts currency; transfer legs mutate as a group; source-linked transactions mutate only via owning flow.
- Day boundaries `Africa/Cairo`; due-date clamp `min(due_day, last_day_of_month)`.
- Occurrences unique per (user, kind, source, period); confirms guard on `status IN ('pending','overdue')`; snapshots unique per (user, date).
- All mutations = zod-validated server actions + `revalidatePath`; every table has `user_id`.
- TDD: failing test → minimal code → pass → commit. Frequent small commits.
- The deterministic engine owns all numbers; the AI only quotes.

Clarification (as in P3/P4): `overdue` stays confirmable, so the confirm guard is `status IN ('pending', 'overdue')`; settled occurrences can never be confirmed again.

## Interfaces consumed from P3/P4 (do not copy, extend in place)

- `housekeeping(userId: string, today: string): Promise<void>`, `nextPeriod(period: string): string`, `rewritePendingOccurrences(kind: 'income' | 'bill' | 'installment', sourceId: string): Promise<void>` in `lib/housekeeping/index.ts`.
- `confirmOccurrence({ userId, occurrenceId, actualAmountMinor, actualDate }): Promise<ConfirmResult>`, `skipOccurrence(userId, occurrenceId)`, `unconfirmOccurrence(userId, occurrenceId)` in `lib/occurrences/confirm.ts`. The `TXN_TYPE` / `TXN_SIGN` / `SOURCE_TYPE` maps already contain the `installment` entries (`installment_payment`, `-1`, `installment_occurrence`) since P3.
- `getAttentionItems(userId: string, today: string): Promise<AttentionItem[]>` in `lib/occurrences/attention.ts`; `AttentionList` / `ConfirmSheet` components are kind-agnostic and need zero changes.
- `confirmOccurrenceAction` / `skipOccurrenceAction` / `unconfirmOccurrenceAction` in `lib/actions/occurrences.ts`; `currencySchema` / `isoDate` in `lib/actions/schemas.ts`; `todayCairo()`, `periodOf()`, `dueDateFor()`, `parseToMinor()`, `formatMoney()`, `requireUser()`, `db`, `dbPool`.

---

### Task 1: installments table and migration

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `drizzle/` migration via drizzle-kit (generated)

**Interfaces:**
- Consumes: existing `accounts` table, `Currency` type.
- Produces: `installments` table exported from `lib/db/schema.ts` per spec §4: `installments(id, user_id, name, monthly_amount_minor, currency, due_day, total_count, remaining_count, start_date, account_id, apr?, active)`.

**Steps:**

- [ ] Append to `lib/db/schema.ts` (add `doublePrecision` to the drizzle-orm/pg-core import; if P1 defined a `currency` pgEnum, use it for the `currency` column):

```ts
export const installments = pgTable('installments', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  monthlyAmountMinor: integer('monthly_amount_minor').notNull(),
  currency: text('currency').$type<Currency>().notNull(),
  dueDay: integer('due_day').notNull(),
  totalCount: integer('total_count').notNull(),
  remainingCount: integer('remaining_count').notNull(),
  startDate: date('start_date', { mode: 'string' }).notNull(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  apr: doublePrecision('apr'), // nullable; a rate, not money, so float is fine
  active: boolean('active').notNull().default(true),
})
```

- [ ] Generate and apply:

```bash
npx drizzle-kit generate --name p5-installments
npx drizzle-kit migrate
```

Expected: one migration creating `installments`; applies cleanly.

- [ ] Commit:

```bash
git add lib/db/schema.ts drizzle && git commit -m "feat(db): installments table"
```

---

### Task 2: housekeeping generates installment occurrences while remaining_count > 0

**Files:**
- Modify: `lib/housekeeping/index.ts`
- Test: `lib/housekeeping/index.test.ts` (extend)

**Interfaces:**
- Consumes: `installments` table, `periodOf(date)`, `dueDateFor(period, dueDay)`.
- Produces: `housekeeping(userId, today)` now also generates `kind='installment'` occurrences for current + next period, but only while `active = true` AND `remaining_count > 0`, never before the `start_date` period, and never more future occurrences than payments remaining. Signature unchanged.

**Steps:**

- [ ] Add failing tests:

```ts
// append to lib/housekeeping/index.test.ts
import { installments } from '@/lib/db/schema'

async function seedInstallment(
  userId: string,
  overrides: Partial<typeof installments.$inferInsert> = {},
) {
  const [account] = await db
    .insert(accounts)
    .values({ userId, name: 'Main USD', currency: 'USD' })
    .returning()
  const [inst] = await db
    .insert(installments)
    .values({
      userId,
      name: 'Phone',
      monthlyAmountMinor: 50000,
      currency: 'USD',
      dueDay: 15,
      totalCount: 12,
      remainingCount: 12,
      startDate: '2026-01-01',
      accountId: account.id,
      apr: null,
      active: true,
      ...overrides,
    })
    .returning()
  return inst
}

function installmentOccurrencesFor(userId: string) {
  return db
    .select()
    .from(occurrences)
    .where(and(eq(occurrences.userId, userId), eq(occurrences.kind, 'installment')))
}

describe('housekeeping installment generation', () => {
  it('generates current + next period while plenty of payments remain', async () => {
    const userId = `test-${randomUUID()}`
    const inst = await seedInstallment(userId)
    await housekeeping(userId, '2026-07-10')
    const rows = await installmentOccurrencesFor(userId)
    expect(rows).toHaveLength(2)
    const byPeriod = Object.fromEntries(rows.map((r) => [r.period, r]))
    expect(byPeriod['2026-07']).toMatchObject({
      sourceId: inst.id,
      dueDate: '2026-07-15',
      expectedAmountMinor: 50000,
      status: 'pending',
    })
    expect(byPeriod['2026-08']).toMatchObject({ dueDate: '2026-08-15', status: 'pending' })
  })

  it('clamps due_day 31 to the end of February', async () => {
    const userId = `test-${randomUUID()}`
    await seedInstallment(userId, { dueDay: 31 })
    await housekeeping(userId, '2026-02-10')
    const rows = await installmentOccurrencesFor(userId)
    const byPeriod = Object.fromEntries(rows.map((r) => [r.period, r]))
    expect(byPeriod['2026-02'].dueDate).toBe('2026-02-28') // 2026 is not a leap year
    expect(byPeriod['2026-03'].dueDate).toBe('2026-03-31')
  })

  it('generates only ONE occurrence when a single payment remains', async () => {
    const userId = `test-${randomUUID()}`
    await seedInstallment(userId, { remainingCount: 1 })
    await housekeeping(userId, '2026-07-10')
    const rows = await installmentOccurrencesFor(userId)
    expect(rows).toHaveLength(1)
    expect(rows[0].period).toBe('2026-07')
  })

  it('generates nothing at remaining_count = 0 or when inactive', async () => {
    const userId = `test-${randomUUID()}`
    await seedInstallment(userId, { remainingCount: 0, active: false })
    await seedInstallment(userId, { name: 'Laptop', active: false })
    await housekeeping(userId, '2026-07-10')
    expect(await installmentOccurrencesFor(userId)).toHaveLength(0)
  })

  it('does not generate before the start_date period', async () => {
    const userId = `test-${randomUUID()}`
    await seedInstallment(userId, { startDate: '2026-08-01' })
    await housekeeping(userId, '2026-07-10') // current period 2026-07 is before the start
    const rows = await installmentOccurrencesFor(userId)
    expect(rows).toHaveLength(1)
    expect(rows[0].period).toBe('2026-08')
  })
})
```

- [ ] Run and fail:

```bash
npx vitest run lib/housekeeping
```

Expected: FAIL, the five new tests find zero installment occurrences.

- [ ] Add the installment block to `housekeeping` in `lib/housekeeping/index.ts`, after the bills block and before the `if (rows.length > 0)` insert (add `gt` to the drizzle-orm import and `installments` to the schema import):

```ts
  // installments (P5): only while active and payments remain, never before start_date,
  // and never more future occurrences than payments left
  const activeInstallments = await db
    .select()
    .from(installments)
    .where(and(eq(installments.userId, userId), eq(installments.active, true), gt(installments.remainingCount, 0)))
  for (const inst of activeInstallments) {
    const startPeriod = periodOf(inst.startDate)
    // ponytail: slice caps NEW periods per run, not total unsettled rows; with a 2-period
    // horizon and confirm cleaning up at zero (Task 3) that is exact for this app
    const target = periods.filter((p) => p >= startPeriod).slice(0, inst.remainingCount)
    for (const period of target) {
      rows.push({
        userId,
        kind: 'installment',
        sourceId: inst.id,
        period,
        dueDate: dueDateFor(period, inst.dueDay),
        expectedAmountMinor: inst.monthlyAmountMinor,
        status: 'pending',
      })
    }
  }
```

- [ ] Also add the installment case to `loadDefinition` (used by `rewritePendingOccurrences`), replacing the P4 `default: return null` fall-through for installments. Full function after the change:

```ts
async function loadDefinition(
  kind: 'income' | 'bill' | 'installment',
  sourceId: string,
): Promise<{ amountMinor: number; dueDay: number } | null> {
  switch (kind) {
    case 'income': {
      const [s] = await db.select().from(incomeSources).where(eq(incomeSources.id, sourceId))
      return s ? { amountMinor: s.amountMinor, dueDay: s.dayOfMonth } : null
    }
    case 'bill': {
      const [b] = await db.select().from(bills).where(eq(bills.id, sourceId))
      return b ? { amountMinor: b.amountMinor, dueDay: b.dueDay } : null
    }
    case 'installment': {
      const [i] = await db.select().from(installments).where(eq(installments.id, sourceId))
      return i ? { amountMinor: i.monthlyAmountMinor, dueDay: i.dueDay } : null
    }
  }
}
```

- [ ] Add a failing-then-passing rewrite test alongside the P4 ones:

```ts
// append to the rewritePendingOccurrences describe block in lib/housekeeping/index.test.ts
it('rewrites pending installment occurrences after a definition edit', async () => {
  const userId = `test-${randomUUID()}`
  const inst = await seedInstallment(userId)
  await housekeeping(userId, '2026-07-10')
  await db.update(installments).set({ monthlyAmountMinor: 60000, dueDay: 1 }).where(eq(installments.id, inst.id))
  await rewritePendingOccurrences('installment', inst.id)
  const rows = await installmentOccurrencesFor(userId)
  expect(rows.every((r) => r.expectedAmountMinor === 60000)).toBe(true)
  expect(rows.map((r) => r.dueDate).sort()).toEqual(['2026-07-01', '2026-08-01'])
})
```

- [ ] Run again:

```bash
npx vitest run lib/housekeeping
```

Expected: PASS (all P3/P4 tests plus the six new ones).

- [ ] Commit:

```bash
git add lib/housekeeping && git commit -m "feat(housekeeping): installment generation gated on remaining_count"
```

---

### Task 3: Confirm decrements remaining_count atomically; un-confirm increments it back

**Files:**
- Modify: `lib/occurrences/confirm.ts`
- Test: `lib/occurrences/confirm.test.ts` (extend)

**Interfaces:**
- Consumes: `installments` table; `dbPool` transactions; drizzle `sql` template and `gt`.
- Produces: `confirmOccurrence(...)` for `kind='installment'` posts `installment_payment` AND decrements `remaining_count` in the same DB transaction; at 0 it sets `active=false` and deletes leftover pending occurrences of that installment. `unconfirmOccurrence(...)` deletes the payment, increments `remaining_count`, and reactivates. Signatures unchanged.

**Steps:**

- [ ] Add failing tests:

```ts
// append to lib/occurrences/confirm.test.ts
import { installments } from '@/lib/db/schema'

async function seedInstallmentOccurrence(remainingCount = 12) {
  const userId = `test-${randomUUID()}`
  const [account] = await db
    .insert(accounts)
    .values({ userId, name: 'Main USD', currency: 'USD' })
    .returning()
  const [inst] = await db
    .insert(installments)
    .values({
      userId,
      name: 'Phone',
      monthlyAmountMinor: 50000,
      currency: 'USD',
      dueDay: 15,
      totalCount: 12,
      remainingCount,
      startDate: '2026-01-01',
      accountId: account.id,
      apr: null,
      active: true,
    })
    .returning()
  const [occ] = await db
    .insert(occurrences)
    .values({
      userId,
      kind: 'installment',
      sourceId: inst.id,
      period: '2026-07',
      dueDate: '2026-07-15',
      expectedAmountMinor: 50000,
      status: 'pending',
    })
    .returning()
  return { userId, account, inst, occ }
}

async function remainingOf(id: string) {
  const [row] = await db.select().from(installments).where(eq(installments.id, id))
  return row
}

describe('installment confirm', () => {
  it('posts installment_payment and decrements remaining_count in the same transaction', async () => {
    const { userId, account, inst, occ } = await seedInstallmentOccurrence(12)
    const result = await confirmOccurrence({
      userId,
      occurrenceId: occ.id,
      actualAmountMinor: 50000,
      actualDate: '2026-07-15',
    })
    expect(result).toEqual({ ok: true })
    const [after] = await db.select().from(occurrences).where(eq(occurrences.id, occ.id))
    const [txn] = await db.select().from(transactions).where(eq(transactions.id, after.transactionId!))
    expect(txn).toMatchObject({
      accountId: account.id,
      type: 'installment_payment',
      amountMinor: -50000, // outflow: negative
      currency: 'USD',
      sourceType: 'installment_occurrence',
      sourceId: occ.id,
    })
    expect((await remainingOf(inst.id)).remainingCount).toBe(11)
  })

  it('double confirm is rejected and decrements exactly once (atomicity guard)', async () => {
    const { userId, inst, occ } = await seedInstallmentOccurrence(12)
    await confirmOccurrence({ userId, occurrenceId: occ.id, actualAmountMinor: 50000, actualDate: '2026-07-15' })
    const second = await confirmOccurrence({
      userId,
      occurrenceId: occ.id,
      actualAmountMinor: 50000,
      actualDate: '2026-07-15',
    })
    expect(second.ok).toBe(false)
    expect((await remainingOf(inst.id)).remainingCount).toBe(11) // not 10
    expect(await db.select().from(transactions).where(eq(transactions.sourceId, occ.id))).toHaveLength(1)
  })

  it('un-confirm deletes the payment and increments remaining_count back', async () => {
    const { userId, inst, occ } = await seedInstallmentOccurrence(12)
    await confirmOccurrence({ userId, occurrenceId: occ.id, actualAmountMinor: 50000, actualDate: '2026-07-15' })
    expect(await unconfirmOccurrence(userId, occ.id)).toEqual({ ok: true })
    const after = await remainingOf(inst.id)
    expect(after.remainingCount).toBe(12)
    expect(after.active).toBe(true)
    expect(await db.select().from(transactions).where(eq(transactions.sourceId, occ.id))).toHaveLength(0)
  })

  it('confirming the last payment completes: active=false, leftover pending occurrences removed', async () => {
    const { userId, inst, occ } = await seedInstallmentOccurrence(1)
    // a stale next-period pending occurrence, as generation could have left before an edit
    await db.insert(occurrences).values({
      userId,
      kind: 'installment',
      sourceId: inst.id,
      period: '2026-08',
      dueDate: '2026-08-15',
      expectedAmountMinor: 50000,
      status: 'pending',
    })
    const result = await confirmOccurrence({
      userId,
      occurrenceId: occ.id,
      actualAmountMinor: 50000,
      actualDate: '2026-07-15',
    })
    expect(result).toEqual({ ok: true })
    const after = await remainingOf(inst.id)
    expect(after.remainingCount).toBe(0)
    expect(after.active).toBe(false)
    const leftovers = await db
      .select()
      .from(occurrences)
      .where(and(eq(occurrences.sourceId, inst.id), eq(occurrences.status, 'pending')))
    expect(leftovers).toHaveLength(0)
  })
})
```

Add `and` to the drizzle-orm import in the test file if not already there.

- [ ] Run and fail:

```bash
npx vitest run lib/occurrences
```

Expected: FAIL with `Unsupported occurrence kind: installment`.

- [ ] Extend `lib/occurrences/confirm.ts`. Add `gt` and `sql` to the drizzle-orm import and `installments` to the schema import. `loadSource` gains the installment case; full function after the change:

```ts
async function loadSource(tx: DbTx, kind: OccurrenceKind, sourceId: string): Promise<SourceInfo> {
  switch (kind) {
    case 'income': {
      const [s] = await tx.select().from(incomeSources).where(eq(incomeSources.id, sourceId))
      if (!s) throw new ConfirmError('Income source not found')
      return { accountId: s.accountId, currency: s.currency, name: s.name }
    }
    case 'bill': {
      const [b] = await tx.select().from(bills).where(eq(bills.id, sourceId))
      if (!b) throw new ConfirmError('Bill not found')
      return { accountId: b.accountId, currency: b.currency, name: b.name }
    }
    case 'installment': {
      const [i] = await tx.select().from(installments).where(eq(installments.id, sourceId))
      if (!i) throw new ConfirmError('Installment not found')
      return { accountId: i.accountId, currency: i.currency, name: i.name }
    }
  }
}
```

- [ ] `confirmOccurrence` gains the countdown inside the existing transaction. Full function after the change:

```ts
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

      // P5: the payment and the countdown move together or not at all
      if (occ.kind === 'installment') {
        const [inst] = await tx
          .update(installments)
          .set({ remainingCount: sql`${installments.remainingCount} - 1` })
          .where(and(eq(installments.id, occ.sourceId), gt(installments.remainingCount, 0)))
          .returning({ remainingCount: installments.remainingCount })
        if (!inst) throw new ConfirmError('No payments remaining')
        if (inst.remainingCount === 0) {
          await tx.update(installments).set({ active: false }).where(eq(installments.id, occ.sourceId))
          await tx
            .delete(occurrences)
            .where(
              and(
                eq(occurrences.kind, 'installment'),
                eq(occurrences.sourceId, occ.sourceId),
                eq(occurrences.status, 'pending'),
              ),
            )
        }
      }
    })
    return { ok: true }
  } catch (e) {
    if (e instanceof ConfirmError) return { ok: false, error: e.message }
    throw e
  }
}
```

- [ ] `unconfirmOccurrence` gains the increment inside its transaction. Full function after the change:

```ts
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

      // P5: reverse the countdown; reactivation lets housekeeping regenerate what completion removed
      if (occ.kind === 'installment') {
        await tx
          .update(installments)
          .set({ remainingCount: sql`${installments.remainingCount} + 1`, active: true })
          .where(eq(installments.id, occ.sourceId))
      }
    })
    return { ok: true }
  } catch (e) {
    if (e instanceof ConfirmError) return { ok: false, error: e.message }
    throw e
  }
}
```

- [ ] Run again:

```bash
npx vitest run lib/occurrences
```

Expected: PASS (P3 income, P4 bill, and the four new installment tests).

- [ ] Commit:

```bash
git add lib/occurrences && git commit -m "feat(occurrences): installment confirm decrements remaining_count atomically"
```

---

### Task 4: Installment CRUD server actions

**Files:**
- Modify: `lib/actions/schemas.ts`
- Create: `lib/actions/installments.ts`
- Test: `lib/actions/schemas.test.ts` (extend)

**Interfaces:**
- Consumes: `requireUser()`, `db`, `parseToMinor(input, currency)`, `rewritePendingOccurrences('installment', id)`, `revalidatePath`.
- Produces: `installmentInput`, `installmentUpdateInput` zod schemas; `createInstallment(input: unknown): Promise<ActionResult>` (sets `remaining_count = total_count`), `updateInstallment(id: string, input: unknown): Promise<ActionResult>` (rewrites pending occurrences; `remainingCount` editable for prepays and corrections; 0 forces `active=false`).

**Steps:**

- [ ] Add the failing schema test:

```ts
// append to lib/actions/schemas.test.ts
import { installmentInput, installmentUpdateInput } from './schemas'

describe('installmentInput', () => {
  const base = {
    name: 'Phone',
    amount: '500.00',
    currency: 'USD',
    dueDay: 15,
    totalCount: 12,
    startDate: '2026-07-01',
    accountId: '4f3c2b1a-0000-4000-8000-000000000001',
    apr: null,
  }

  it('accepts a valid installment, with or without apr', () => {
    expect(installmentInput.safeParse(base).success).toBe(true)
    expect(installmentInput.safeParse({ ...base, apr: 24.5 }).success).toBe(true)
  })

  it('rejects zero counts, bad due days, negative apr', () => {
    expect(installmentInput.safeParse({ ...base, totalCount: 0 }).success).toBe(false)
    expect(installmentInput.safeParse({ ...base, dueDay: 32 }).success).toBe(false)
    expect(installmentInput.safeParse({ ...base, apr: -1 }).success).toBe(false)
  })

  it('update variant bounds remainingCount to [0, totalCount]', () => {
    const upd = { ...base, remainingCount: 5, active: true }
    expect(installmentUpdateInput.safeParse(upd).success).toBe(true)
    expect(installmentUpdateInput.safeParse({ ...upd, remainingCount: -1 }).success).toBe(false)
    expect(installmentUpdateInput.safeParse({ ...upd, remainingCount: 13 }).success).toBe(false)
  })
})
```

- [ ] Run and fail:

```bash
npx vitest run lib/actions
```

Expected: FAIL, `installmentInput` is not exported.

- [ ] Add to `lib/actions/schemas.ts`:

```ts
export const installmentInput = z.object({
  name: z.string().trim().min(1).max(100),
  amount: z.string().min(1), // monthly amount, decimal string
  currency: currencySchema,
  dueDay: z.coerce.number().int().min(1).max(31),
  totalCount: z.coerce.number().int().min(1).max(240),
  startDate: isoDate,
  accountId: z.string().uuid(),
  apr: z.coerce.number().min(0).max(200).nullable().default(null),
})

export const installmentUpdateInput = installmentInput
  .extend({
    remainingCount: z.coerce.number().int().min(0),
    active: z.boolean(),
  })
  .refine((v) => v.remainingCount <= v.totalCount, { message: 'remainingCount cannot exceed totalCount' })
```

- [ ] Run again:

```bash
npx vitest run lib/actions
```

Expected: PASS.

- [ ] Implement the actions (composition of already-unit-tested pieces; behavior locked by the E2E in Task 7):

```ts
// lib/actions/installments.ts
'use server'

import { and, eq, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth/stack'
import { db } from '@/lib/db/client'
import { accounts, installments } from '@/lib/db/schema'
import { rewritePendingOccurrences } from '@/lib/housekeeping'
import { parseToMinor } from '@/lib/money/money'
import type { Currency } from '@/lib/money/money'
import { installmentInput, installmentUpdateInput } from './schemas'

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

function revalidateInstallmentScreens() {
  revalidatePath('/installments')
  revalidatePath('/')
}

export async function createInstallment(input: unknown): Promise<ActionResult> {
  const user = await requireUser()
  const parsed = installmentInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid input' }
  const account = await ownedActiveAccount(user.id, parsed.data.accountId)
  if (!account) return { ok: false, error: 'Account not found' }
  if (account.currency !== parsed.data.currency) return { ok: false, error: 'Account currency must match' }
  const monthlyAmountMinor = parseAmount(parsed.data.amount, parsed.data.currency as Currency)
  if (monthlyAmountMinor === null) return { ok: false, error: 'Invalid amount' }

  await db.insert(installments).values({
    userId: user.id,
    name: parsed.data.name,
    monthlyAmountMinor,
    currency: parsed.data.currency as Currency,
    dueDay: parsed.data.dueDay,
    totalCount: parsed.data.totalCount,
    remainingCount: parsed.data.totalCount, // creation starts the full countdown
    startDate: parsed.data.startDate,
    accountId: parsed.data.accountId,
    apr: parsed.data.apr,
    active: true,
  })
  revalidateInstallmentScreens()
  return { ok: true }
}

export async function updateInstallment(id: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser()
  const parsed = installmentUpdateInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid input' }
  const account = await ownedActiveAccount(user.id, parsed.data.accountId)
  if (!account) return { ok: false, error: 'Account not found' }
  if (account.currency !== parsed.data.currency) return { ok: false, error: 'Account currency must match' }
  const monthlyAmountMinor = parseAmount(parsed.data.amount, parsed.data.currency as Currency)
  if (monthlyAmountMinor === null) return { ok: false, error: 'Invalid amount' }

  const updated = await db
    .update(installments)
    .set({
      name: parsed.data.name,
      monthlyAmountMinor,
      currency: parsed.data.currency as Currency,
      dueDay: parsed.data.dueDay,
      totalCount: parsed.data.totalCount,
      remainingCount: parsed.data.remainingCount,
      startDate: parsed.data.startDate,
      accountId: parsed.data.accountId,
      apr: parsed.data.apr,
      active: parsed.data.remainingCount === 0 ? false : parsed.data.active, // 0 left = complete
    })
    .where(and(eq(installments.id, id), eq(installments.userId, user.id)))
    .returning({ id: installments.id })
  if (updated.length !== 1) return { ok: false, error: 'Installment not found' }

  // prepay / skip / policy change = definition edit; pending occurrences rewrite (spec §5.5, §3)
  await rewritePendingOccurrences('installment', id)
  revalidateInstallmentScreens()
  return { ok: true }
}
```

- [ ] Type-check:

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] Commit:

```bash
git add lib/actions && git commit -m "feat(installments): crud actions with countdown and pending rewrite"
```

---

### Task 5: Attention list shows installments due within 7 days or overdue

**Files:**
- Modify: `lib/occurrences/attention.ts`

**Interfaces:**
- Consumes: `installments` table; the P4 `plusDays` helper and 7-day window pattern.
- Produces: `getAttentionItems(userId: string, today: string): Promise<AttentionItem[]>`, same signature; installment occurrences appear under the same window rule as bills. `AttentionList` / `ConfirmSheet` are untouched (the `CTA` map has said "confirm paid" for installments since P3).

**Steps:**

- [ ] Add `installments` to the schema import and insert this block after the `billRows` query in `getAttentionItems`:

```ts
  const installmentRows = await db
    .select({
      occurrenceId: occurrences.id,
      kind: occurrences.kind,
      sourceName: installments.name,
      expectedAmountMinor: occurrences.expectedAmountMinor,
      currency: installments.currency,
      dueDate: occurrences.dueDate,
      status: occurrences.status,
    })
    .from(occurrences)
    .innerJoin(installments, eq(occurrences.sourceId, installments.id))
    .where(
      and(
        eq(occurrences.userId, userId),
        eq(occurrences.kind, 'installment'),
        or(
          eq(occurrences.status, 'overdue'),
          and(eq(occurrences.status, 'pending'), lte(occurrences.dueDate, soon)), // due within 7 days
        ),
      ),
    )
```

- [ ] Update the return statement to include them:

```ts
  return [...incomeRows, ...billRows, ...installmentRows].sort((a, b) =>
    a.dueDate.localeCompare(b.dueDate),
  ) as AttentionItem[]
```

- [ ] Type-check and run everything:

```bash
npx tsc --noEmit && npx vitest run
```

Expected: PASS.

- [ ] Commit:

```bash
git add lib/occurrences/attention.ts && git commit -m "feat(dashboard): installments in attention list within 7-day window"
```

---

### Task 6: Installments screens with progress and next due date

**Files:**
- Create: `app/(app)/installments/page.tsx`
- Create: `app/(app)/installments/new/page.tsx`
- Create: `app/(app)/installments/[id]/edit/page.tsx`
- Create: `components/installments/installment-form.tsx`

**Interfaces:**
- Consumes: `requireUser()`, `db`, `formatMoney(m)`, installment actions from Task 4.
- Produces: `/installments` routes wired into the bottom tab nav (add a tab entry in the P0 shell if not present). Progress is DERIVED: paid = `total_count - remaining_count`, never stored.

**Steps:**

- [ ] List page with progress and next due date:

```tsx
// app/(app)/installments/page.tsx
import Link from 'next/link'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { requireUser } from '@/lib/auth/stack'
import { db } from '@/lib/db/client'
import { installments, occurrences } from '@/lib/db/schema'
import { formatMoney } from '@/lib/money/money'

export default async function InstallmentsPage() {
  const user = await requireUser()
  const rows = await db.select().from(installments).where(eq(installments.userId, user.id))
  const unsettled = await db
    .select({ sourceId: occurrences.sourceId, dueDate: occurrences.dueDate })
    .from(occurrences)
    .where(
      and(
        eq(occurrences.userId, user.id),
        eq(occurrences.kind, 'installment'),
        inArray(occurrences.status, ['pending', 'overdue']),
      ),
    )
    .orderBy(asc(occurrences.dueDate))
  const nextDue = new Map<string, string>()
  for (const o of unsettled) {
    if (!nextDue.has(o.sourceId)) nextDue.set(o.sourceId, o.dueDate)
  }

  return (
    <main className="pb-20">
      <div className="flex items-center justify-between px-4 py-3">
        <h1 className="text-lg font-semibold">Installments</h1>
        <Link href="/installments/new" className="rounded bg-black px-3 py-2 text-sm text-white">
          New installment
        </Link>
      </div>
      <ul className="divide-y divide-gray-100">
        {rows.map((i) => {
          const paid = i.totalCount - i.remainingCount
          return (
            <li key={i.id}>
              <Link href={`/installments/${i.id}/edit`} className="flex items-center justify-between px-4 py-3">
                <span>
                  <span className="block font-medium">{i.name}</span>
                  <span className="block text-sm text-gray-500">
                    Paid {paid} of {i.totalCount}
                    {i.remainingCount === 0
                      ? ', completed'
                      : nextDue.has(i.id)
                        ? `, next due ${nextDue.get(i.id)}`
                        : ''}
                  </span>
                </span>
                <span className="font-medium">
                  {formatMoney({ amountMinor: i.monthlyAmountMinor, currency: i.currency })}/mo
                </span>
              </Link>
            </li>
          )
        })}
        {rows.length === 0 && <li className="px-4 py-6 text-sm text-gray-500">No installments yet.</li>}
      </ul>
    </main>
  )
}
```

- [ ] Installment form (client, shared by new and edit; edit exposes the countdown for prepays):

```tsx
// components/installments/installment-form.tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createInstallment, updateInstallment } from '@/lib/actions/installments'

interface AccountOption {
  id: string
  name: string
  currency: string
}

interface InstallmentValues {
  id: string
  name: string
  amount: string // monthly, decimal string
  dueDay: number
  totalCount: number
  remainingCount: number
  startDate: string
  accountId: string
  apr: number | null
  active: boolean
}

export function InstallmentForm({
  accounts,
  installment,
}: {
  accounts: AccountOption[]
  installment?: InstallmentValues
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const accountId = String(f.get('accountId'))
    const account = accounts.find((a) => a.id === accountId)
    const aprRaw = String(f.get('apr') ?? '').trim()
    const base = {
      name: String(f.get('name')),
      amount: String(f.get('amount')),
      currency: account?.currency ?? 'EUR', // installment currency = source account currency
      dueDay: Number(f.get('dueDay')),
      totalCount: Number(f.get('totalCount')),
      startDate: String(f.get('startDate')),
      accountId,
      apr: aprRaw === '' ? null : Number(aprRaw),
    }
    const result = installment
      ? await updateInstallment(installment.id, {
          ...base,
          remainingCount: Number(f.get('remainingCount')),
          active: installment.active,
        })
      : await createInstallment(base)
    if (result.ok) router.push('/installments')
    else setError(result.error)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 px-4 py-3">
      <label className="block text-sm">
        Name
        <input name="name" required defaultValue={installment?.name} className="mt-1 w-full rounded border px-3 py-2" />
      </label>
      <label className="block text-sm">
        Monthly amount
        <input
          name="amount"
          required
          inputMode="decimal"
          defaultValue={installment?.amount}
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        Account
        <select
          name="accountId"
          required
          defaultValue={installment?.accountId}
          className="mt-1 w-full rounded border px-3 py-2"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.currency})
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        Due day
        <input
          name="dueDay"
          type="number"
          min={1}
          max={31}
          required
          defaultValue={installment?.dueDay ?? 1}
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        Total payments
        <input
          name="totalCount"
          type="number"
          min={1}
          max={240}
          required
          defaultValue={installment?.totalCount ?? 12}
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </label>
      {installment && (
        <label className="block text-sm">
          Payments remaining
          <input
            name="remainingCount"
            type="number"
            min={0}
            required
            defaultValue={installment.remainingCount}
            className="mt-1 w-full rounded border px-3 py-2"
          />
        </label>
      )}
      <label className="block text-sm">
        Start date
        <input
          name="startDate"
          type="date"
          required
          defaultValue={installment?.startDate}
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        APR % (optional)
        <input
          name="apr"
          type="number"
          step="0.01"
          min={0}
          defaultValue={installment?.apr ?? undefined}
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" className="w-full rounded bg-black py-3 text-white">
        {installment ? 'Save' : 'Create'}
      </button>
    </form>
  )
}
```

- [ ] New and edit pages:

```tsx
// app/(app)/installments/new/page.tsx
import { and, eq, isNull } from 'drizzle-orm'
import { InstallmentForm } from '@/components/installments/installment-form'
import { requireUser } from '@/lib/auth/stack'
import { db } from '@/lib/db/client'
import { accounts } from '@/lib/db/schema'

export default async function NewInstallmentPage() {
  const user = await requireUser()
  const accountRows = await db
    .select({ id: accounts.id, name: accounts.name, currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.userId, user.id), isNull(accounts.archivedAt)))
  return (
    <main>
      <h1 className="px-4 py-3 text-lg font-semibold">New installment</h1>
      <InstallmentForm accounts={accountRows} />
    </main>
  )
}
```

```tsx
// app/(app)/installments/[id]/edit/page.tsx
import { notFound } from 'next/navigation'
import { and, eq, isNull } from 'drizzle-orm'
import { InstallmentForm } from '@/components/installments/installment-form'
import { requireUser } from '@/lib/auth/stack'
import { db } from '@/lib/db/client'
import { accounts, installments } from '@/lib/db/schema'

export default async function EditInstallmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()
  const [inst] = await db
    .select()
    .from(installments)
    .where(and(eq(installments.id, id), eq(installments.userId, user.id)))
  if (!inst) notFound()
  const accountRows = await db
    .select({ id: accounts.id, name: accounts.name, currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.userId, user.id), isNull(accounts.archivedAt)))
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
```

- [ ] Verify manually at 375px: create a 12-month installment, list shows "Paid 0 of 12" and the next due date; edit the monthly amount, the pending occurrence amounts follow on the next dashboard view. Commit:

```bash
git add app/\(app\)/installments components/installments && git commit -m "feat(installments): screens with derived progress"
```

---

### Task 7: E2E, 12-month installment: confirm, progress, overdue styling

**Files:**
- Test: `tests/e2e/installments.spec.ts`

**Interfaces:**
- Consumes: `signIn` from `tests/e2e/helpers.ts` (P4); direct `db` access from the Playwright process (node) to force a deterministic overdue occurrence; `DATABASE_URL` must be loaded by the Playwright config (same env the dev server uses).

**Steps:**

- [ ] Write the spec:

```ts
// tests/e2e/installments.spec.ts
import { expect, test } from '@playwright/test'
import { and, eq } from 'drizzle-orm'
import { db } from '../../lib/db/client'
import { installments, occurrences } from '../../lib/db/schema'
import { signIn } from './helpers'

test('installment: confirm one payment, progress 1 of 12, overdue styling appears', async ({ page }) => {
  await signIn(page)
  const stamp = Date.now()
  const accountName = `Card USD ${stamp}`
  const instName = `Phone ${stamp}`

  // Account with an opening balance to pay from (P1 flow)
  await page.goto('/accounts')
  await page.getByRole('link', { name: /new account/i }).click()
  await page.getByLabel(/name/i).fill(accountName)
  await page.getByLabel(/currency/i).selectOption('USD')
  await page.getByLabel(/opening balance/i).fill('1000.00')
  await page.getByRole('button', { name: /create/i }).click()

  // 12-month installment due on the 1st (today or past on any calendar day, so it is actionable)
  await page.goto('/installments')
  await page.getByRole('link', { name: /new installment/i }).click()
  await page.getByLabel(/^name/i).fill(instName)
  await page.getByLabel(/monthly amount/i).fill('50.00')
  await page.getByLabel(/account/i).selectOption({ label: `${accountName} (USD)` })
  await page.getByLabel(/due day/i).fill('1')
  await page.getByLabel(/total payments/i).fill('12')
  await page.getByLabel(/start date/i).fill(new Date().toISOString().slice(0, 8) + '01')
  await page.getByRole('button', { name: /create/i }).click()
  await expect(page.getByText(`Paid 0 of 12`)).toBeVisible()

  // Dashboard: housekeeping generates the occurrence; confirm it
  await page.goto('/')
  const row = page.getByRole('button', { name: new RegExp(instName) })
  await expect(row).toBeVisible()
  await expect(row).toContainText('confirm paid')
  await row.click()
  await expect(page.getByLabel(/amount/i)).toHaveValue('50.00')
  await page.getByRole('button', { name: /^confirm$/i }).click()
  await expect(page.getByRole('button', { name: new RegExp(instName) })).toHaveCount(0)

  // Progress derived from the countdown
  await page.goto('/installments')
  await expect(page.getByText('Paid 1 of 12')).toBeVisible()

  // Force the remaining pending occurrence past due, deterministically, then let housekeeping flip it
  const [inst] = await db.select().from(installments).where(eq(installments.name, instName))
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  await db
    .update(occurrences)
    .set({ dueDate: yesterday })
    .where(
      and(eq(occurrences.kind, 'installment'), eq(occurrences.sourceId, inst.id), eq(occurrences.status, 'pending')),
    )
  await page.goto('/') // dashboard load runs housekeeping: pending past due flips to overdue
  const overdueRow = page.getByRole('button', { name: new RegExp(instName) })
  await expect(overdueRow).toBeVisible()
  await expect(overdueRow).toContainText('Overdue')
  await expect(overdueRow.locator('.text-red-600')).toBeVisible() // overdue styling
})
```

- [ ] Run it:

```bash
npx playwright test tests/e2e/installments.spec.ts
```

Expected: PASS.

- [ ] Full gate, then commit:

```bash
npx tsc --noEmit && npx vitest run && npx playwright test
git add tests/e2e/installments.spec.ts && git commit -m "test(e2e): installment confirm, progress, overdue styling"
```

---

**Phase exit criteria:** all Vitest suites green (housekeeping generation gates, countdown atomicity, clamped Feb due dates, rewrite on edit), all three occurrence E2E specs green, manual 375px walkthrough of installments list, prepay via edit, completion at zero. Update `docs/wiki/status.md`.

**Backlinks:** [Master index](../plans/README.md) | [Spec](../specs/2026-07-07-my-ledger-design.md) | [Prev: P4 Bills](../plans/04-bills.md) | [Next: P6 Expenses & Insights](../plans/06-expenses-and-insights.md)
