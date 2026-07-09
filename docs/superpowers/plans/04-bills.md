# Phase 04: Bills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Backlinks:** [Master index](../plans/README.md) | [Spec](../specs/2026-07-07-my-ledger-design.md) | [Prev: P3 Income](../plans/03-income.md) | [Next: P5 Installments](../plans/05-installments.md)

**Goal:** Recurring bills ride the P3 occurrence rails: `bills` table and CRUD, housekeeping generates `kind='bill'` occurrences, confirming posts a `bill_payment` transaction (NEVER `expense`, spec §5.4, so the P7 spend estimate cannot double-count), definition edits rewrite pending occurrences via a new shared `rewritePendingOccurrences(kind, sourceId)`, and the attention list shows bills due within 7 days or overdue.

**Architecture:** Bills reuse the shared machinery P3 built: the `occurrences` table, `housekeeping(userId, today)`, and `lib/occurrences/confirm.ts` (confirm / skip / un-confirm). This phase only adds the `bills` definition table, a `bill` branch in the confirm module's source lookup, a bill block in housekeeping generation, and extracts P3's inline pending-rewrite loop into `rewritePendingOccurrences` so income, bills, and (in P5) installments share one definition-edit rail.

**Tech Stack:** Next.js App Router + TypeScript + Tailwind (mobile-first), Neon Postgres + Drizzle (`db` neon-http reads, `dbPool` neon-serverless transactions), drizzle-kit migrations, Better Auth, zod server actions, Vitest + Playwright.

## Global Constraints (from the plans README, verbatim)

- Money: integer minor units, currencies `EUR|USD|EGP`, round half-up, balances derived ([spec §3](../specs/2026-07-07-my-ledger-design.md)).
- No transaction converts currency; transfer legs mutate as a group; source-linked transactions mutate only via owning flow.
- Day boundaries `Africa/Cairo`; due-date clamp `min(due_day, last_day_of_month)`.
- Occurrences unique per (user, kind, source, period); confirms guard on `status IN ('pending','overdue')`; snapshots unique per (user, date).
- All mutations = zod-validated server actions + `revalidatePath`; every table has `user_id`.
- TDD: failing test → minimal code → pass → commit. Frequent small commits.
- The deterministic engine owns all numbers; the AI only quotes.

Clarification (as in P3): `overdue` stays confirmable, so the confirm guard is `status IN ('pending', 'overdue')`; settled occurrences can never be confirmed again.

## Interfaces consumed from P3 (do not copy, extend in place)

- `housekeeping(userId: string, today: string): Promise<void>` and `nextPeriod(period: string): string` in `lib/housekeeping/index.ts`.
- `confirmOccurrence({ userId, occurrenceId, actualAmountMinor, actualDate }): Promise<ConfirmResult>`, `skipOccurrence(userId, occurrenceId)`, `unconfirmOccurrence(userId, occurrenceId)` in `lib/occurrences/confirm.ts`. Its `TXN_TYPE` / `TXN_SIGN` / `SOURCE_TYPE` maps already contain the `bill` entries (`bill_payment`, `-1`, `bill_occurrence`); only the `loadSource` switch gains a case here.
- `getAttentionItems(userId: string, today: string): Promise<AttentionItem[]>` in `lib/occurrences/attention.ts` (signature fixed, query extended here).
- `confirmOccurrenceAction` / `skipOccurrenceAction` / `unconfirmOccurrenceAction`, `ConfirmSheet`, `AttentionList`: reused untouched, they are kind-agnostic.
- `incomeSourceInput` etc. in `lib/actions/schemas.ts`; `todayCairo()`, `periodOf()`, `dueDateFor()`, `parseToMinor()`, `formatMoney()`, `requireUser()`, `db`, `dbPool` as in P3.

---

### Task 1: bills table and migration

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `drizzle/` migration via drizzle-kit (generated)

**Interfaces:**
- Consumes: existing `accounts` table, `Currency` type.
- Produces: `bills` table exported from `lib/db/schema.ts` per spec §4: `bills(id, user_id, name, amount_minor, currency, due_day, account_id, category_id?, active)`.

**Steps:**

- [ ] Append to `lib/db/schema.ts` (same conventions as `incomeSources`; if P1 defined a `currency` pgEnum, use it for the `currency` column):

```ts
export const bills = pgTable('bills', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  amountMinor: integer('amount_minor').notNull(),
  currency: text('currency').$type<Currency>().notNull(),
  dueDay: integer('due_day').notNull(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  categoryId: uuid('category_id'), // FK to expense_categories added in P6 when that table exists
  active: boolean('active').notNull().default(true),
})
```

- [ ] Generate and apply:

```bash
npx drizzle-kit generate --name p4-bills
npx drizzle-kit migrate
```

Expected: one migration creating `bills`; applies cleanly.

- [ ] Commit:

```bash
git add lib/db/schema.ts drizzle && git commit -m "feat(db): bills table"
```

---

### Task 2: housekeeping generates bill occurrences

**Files:**
- Modify: `lib/housekeeping/index.ts`
- Test: `lib/housekeeping/index.test.ts` (extend)

**Interfaces:**
- Consumes: `bills` table, `dueDateFor(period, dueDay)`, `periodOf(date)`.
- Produces: `housekeeping(userId: string, today: string): Promise<void>` now also generates `kind='bill'` occurrences for current + next period for active bills. Signature unchanged; call sites (dashboard, later cron) untouched.

**Steps:**

- [ ] Add failing tests to `lib/housekeeping/index.test.ts`:

```ts
// append to lib/housekeeping/index.test.ts
import { bills } from '@/lib/db/schema'

async function seedBill(userId: string, dueDay: number) {
  const [account] = await db
    .insert(accounts)
    .values({ userId, name: 'Main EGP', currency: 'EGP' })
    .returning()
  const [bill] = await db
    .insert(bills)
    .values({ userId, name: 'Rent', amountMinor: 1500000, currency: 'EGP', dueDay, accountId: account.id, active: true })
    .returning()
  return bill
}

function billOccurrencesFor(userId: string) {
  return db
    .select()
    .from(occurrences)
    .where(and(eq(occurrences.userId, userId), eq(occurrences.kind, 'bill')))
}

describe('housekeeping bill generation', () => {
  it('generates current + next period bill occurrences with clamped due dates', async () => {
    const userId = `test-${randomUUID()}`
    const bill = await seedBill(userId, 31)
    await housekeeping(userId, '2026-04-10')
    const rows = await billOccurrencesFor(userId)
    expect(rows).toHaveLength(2)
    const byPeriod = Object.fromEntries(rows.map((r) => [r.period, r]))
    expect(byPeriod['2026-04']).toMatchObject({
      sourceId: bill.id,
      dueDate: '2026-04-30', // clamped, April has 30 days
      expectedAmountMinor: 1500000,
      status: 'pending',
    })
    expect(byPeriod['2026-05']).toMatchObject({ dueDate: '2026-05-31', status: 'pending' })
  })

  it('is idempotent and flips past-due bill occurrences to overdue', async () => {
    const userId = `test-${randomUUID()}`
    await seedBill(userId, 1)
    await housekeeping(userId, '2026-07-15')
    await housekeeping(userId, '2026-07-15')
    const rows = await billOccurrencesFor(userId)
    expect(rows).toHaveLength(2)
    const byPeriod = Object.fromEntries(rows.map((r) => [r.period, r]))
    expect(byPeriod['2026-07'].status).toBe('overdue') // due 2026-07-01
    expect(byPeriod['2026-08'].status).toBe('pending')
  })

  it('skips inactive bills', async () => {
    const userId = `test-${randomUUID()}`
    const bill = await seedBill(userId, 10)
    await db.update(bills).set({ active: false }).where(eq(bills.id, bill.id))
    await housekeeping(userId, '2026-07-15')
    expect(await billOccurrencesFor(userId)).toHaveLength(0)
  })
})
```

- [ ] Run and fail:

```bash
npx vitest run lib/housekeeping
```

Expected: FAIL, the three new tests find zero bill occurrences.

- [ ] Extend `housekeeping` in `lib/housekeeping/index.ts`. Full function after the change (the income block and overdue flip are P3 code, unchanged):

```ts
// lib/housekeeping/index.ts
import { and, eq, lt } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { bills, incomeSources, occurrences } from '@/lib/db/schema'
import { dueDateFor, periodOf } from '@/lib/dates/cairo'

export function nextPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

type NewOccurrence = typeof occurrences.$inferInsert

export async function housekeeping(userId: string, today: string): Promise<void> {
  const current = periodOf(today)
  const periods = [current, nextPeriod(current)]
  const rows: NewOccurrence[] = []

  // income sources (P3)
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

  for (const s of sources) {
    const target = s.recurring ? periods : hasOccurrence.has(s.id) ? [] : [current]
    for (const period of target) {
      rows.push({
        userId,
        kind: 'income',
        sourceId: s.id,
        period,
        dueDate: dueDateFor(period, s.dayOfMonth),
        expectedAmountMinor: s.amountMinor,
        status: 'pending',
      })
    }
  }

  // bills (P4): always recurring
  const activeBills = await db
    .select()
    .from(bills)
    .where(and(eq(bills.userId, userId), eq(bills.active, true)))
  for (const b of activeBills) {
    for (const period of periods) {
      rows.push({
        userId,
        kind: 'bill',
        sourceId: b.id,
        period,
        dueDate: dueDateFor(period, b.dueDay),
        expectedAmountMinor: b.amountMinor,
        status: 'pending',
      })
    }
  }

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

Expected: PASS (P3 tests plus the three new ones).

- [ ] Commit:

```bash
git add lib/housekeeping && git commit -m "feat(housekeeping): generate bill occurrences"
```

---

### Task 3: rewritePendingOccurrences, the shared definition-edit rail

**Files:**
- Modify: `lib/housekeeping/index.ts`
- Modify: `lib/actions/income.ts` (replace the P3 inline rewrite loop)
- Test: `lib/housekeeping/index.test.ts` (extend)

**Interfaces:**
- Consumes: `incomeSources`, `bills`, `occurrences` tables; `dueDateFor(period, dueDay)`.
- Produces (canonical, P5 adds the installment case, signature must not change): `rewritePendingOccurrences(kind: 'income' | 'bill' | 'installment', sourceId: string): Promise<void>`, exported from `lib/housekeeping/index.ts`. Rewrites `pending` occurrences of the definition to its current amount and clamped due day, and only `pending` ones, per spec §3: "Definition edits rewrite `pending` occurrences only; never touch `confirmed`/`skipped`".

**Steps:**

- [ ] Add failing tests:

```ts
// append to lib/housekeeping/index.test.ts
import { rewritePendingOccurrences } from './index'

describe('rewritePendingOccurrences', () => {
  it('rewrites pending occurrences to the new amount and clamped due day', async () => {
    const userId = `test-${randomUUID()}`
    const bill = await seedBill(userId, 10)
    await housekeeping(userId, '2026-02-05')
    await db.update(bills).set({ amountMinor: 1600000, dueDay: 31 }).where(eq(bills.id, bill.id))
    await rewritePendingOccurrences('bill', bill.id)
    const rows = await billOccurrencesFor(userId)
    const byPeriod = Object.fromEntries(rows.map((r) => [r.period, r]))
    expect(byPeriod['2026-02']).toMatchObject({ expectedAmountMinor: 1600000, dueDate: '2026-02-28' })
    expect(byPeriod['2026-03']).toMatchObject({ expectedAmountMinor: 1600000, dueDate: '2026-03-31' })
  })

  it('never touches confirmed occurrences', async () => {
    const userId = `test-${randomUUID()}`
    const bill = await seedBill(userId, 10)
    await housekeeping(userId, '2026-02-05')
    const rows = await billOccurrencesFor(userId)
    const feb = rows.find((r) => r.period === '2026-02')!
    await db.update(occurrences).set({ status: 'confirmed' }).where(eq(occurrences.id, feb.id))
    await db.update(bills).set({ amountMinor: 9999 }).where(eq(bills.id, bill.id))
    await rewritePendingOccurrences('bill', bill.id)
    const [after] = await db.select().from(occurrences).where(eq(occurrences.id, feb.id))
    expect(after.expectedAmountMinor).toBe(1500000) // untouched
  })

  it('works for income sources too', async () => {
    const userId = `test-${randomUUID()}`
    const source = await seedIncomeSource(userId, 25)
    await housekeeping(userId, '2026-07-10')
    await db.update(incomeSources).set({ amountMinor: 300000, dayOfMonth: 1 }).where(eq(incomeSources.id, source.id))
    await rewritePendingOccurrences('income', source.id)
    const rows = await occurrencesFor(userId)
    expect(rows.every((r) => r.expectedAmountMinor === 300000)).toBe(true)
    expect(rows.map((r) => r.dueDate).sort()).toEqual(['2026-07-01', '2026-08-01'])
  })
})
```

- [ ] Run and fail:

```bash
npx vitest run lib/housekeeping
```

Expected: FAIL, `rewritePendingOccurrences` is not exported.

- [ ] Implement in `lib/housekeeping/index.ts`:

```ts
// append to lib/housekeeping/index.ts

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
    default:
      return null // installment case lands in P5; unknown definition = no-op
  }
}

export async function rewritePendingOccurrences(
  kind: 'income' | 'bill' | 'installment',
  sourceId: string,
): Promise<void> {
  const def = await loadDefinition(kind, sourceId)
  if (!def) return
  const pending = await db
    .select()
    .from(occurrences)
    .where(and(eq(occurrences.kind, kind), eq(occurrences.sourceId, sourceId), eq(occurrences.status, 'pending')))
  for (const occ of pending) {
    await db
      .update(occurrences)
      .set({ expectedAmountMinor: def.amountMinor, dueDate: dueDateFor(occ.period, def.dueDay) })
      .where(eq(occurrences.id, occ.id))
  }
}
```

- [ ] Run again:

```bash
npx vitest run lib/housekeeping
```

Expected: PASS.

- [ ] Rewire `updateIncomeSource` in `lib/actions/income.ts`: delete the P3 inline pending-rewrite loop (the `const pending = ...` block and its `for` loop) and replace it with:

```ts
import { rewritePendingOccurrences } from '@/lib/housekeeping'

// inside updateIncomeSource, where the inline loop was:
await rewritePendingOccurrences('income', id)
```

Also remove the now-unused `dueDateFor` and `occurrences` imports from `lib/actions/income.ts`.

- [ ] Full unit suite still green:

```bash
npx tsc --noEmit && npx vitest run
```

Expected: PASS.

- [ ] Commit:

```bash
git add lib/housekeeping lib/actions/income.ts \
  && git commit -m "feat(housekeeping): shared rewritePendingOccurrences for definition edits"
```

---

### Task 4: Bill CRUD server actions

**Files:**
- Modify: `lib/actions/schemas.ts`
- Create: `lib/actions/bills.ts`
- Test: `lib/actions/schemas.test.ts` (extend)

**Interfaces:**
- Consumes: `requireUser()`, `db`, `parseToMinor(input, currency)`, `rewritePendingOccurrences('bill', id)`, `revalidatePath`.
- Produces: `billInput` zod schema; `createBill(input: unknown): Promise<ActionResult>`, `updateBill(id: string, input: unknown): Promise<ActionResult>`, `setBillActive(id: string, active: boolean): Promise<ActionResult>`.

**Steps:**

- [ ] Add the failing schema test:

```ts
// append to lib/actions/schemas.test.ts
import { billInput } from './schemas'

describe('billInput', () => {
  it('accepts a valid bill and rejects out-of-range due days', () => {
    const base = {
      name: 'Rent',
      amount: '15000.00',
      currency: 'EGP',
      dueDay: 1,
      accountId: '4f3c2b1a-0000-4000-8000-000000000001',
      active: true,
    }
    expect(billInput.safeParse(base).success).toBe(true)
    expect(billInput.safeParse({ ...base, dueDay: 0 }).success).toBe(false)
    expect(billInput.safeParse({ ...base, dueDay: 32 }).success).toBe(false)
    expect(billInput.safeParse({ ...base, name: '' }).success).toBe(false)
  })
})
```

- [ ] Run and fail:

```bash
npx vitest run lib/actions
```

Expected: FAIL, `billInput` is not exported.

- [ ] Add to `lib/actions/schemas.ts` (`categoryId` joins in P6 when `expense_categories` exists; the column is already nullable):

```ts
export const billInput = z.object({
  name: z.string().trim().min(1).max(100),
  amount: z.string().min(1),
  currency: currencySchema,
  dueDay: z.coerce.number().int().min(1).max(31),
  accountId: z.string().uuid(),
  active: z.boolean().default(true),
})
```

- [ ] Run again:

```bash
npx vitest run lib/actions
```

Expected: PASS.

- [ ] Implement the actions (verified by the housekeeping/confirm unit tests they compose and the E2E in Task 8):

```ts
// lib/actions/bills.ts
'use server'

import { and, eq, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { accounts, bills } from '@/lib/db/schema'
import { rewritePendingOccurrences } from '@/lib/housekeeping'
import { parseToMinor } from '@/lib/money/money'
import type { Currency } from '@/lib/money/money'
import { billInput } from './schemas'

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

function revalidateBillScreens() {
  revalidatePath('/bills')
  revalidatePath('/')
}

export async function createBill(input: unknown): Promise<ActionResult> {
  const user = await requireUser()
  const parsed = billInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid input' }
  const account = await ownedActiveAccount(user.id, parsed.data.accountId)
  if (!account) return { ok: false, error: 'Account not found' }
  if (account.currency !== parsed.data.currency) return { ok: false, error: 'Account currency must match' }
  const amountMinor = parseAmount(parsed.data.amount, parsed.data.currency as Currency)
  if (amountMinor === null) return { ok: false, error: 'Invalid amount' }

  await db.insert(bills).values({
    userId: user.id,
    name: parsed.data.name,
    amountMinor,
    currency: parsed.data.currency as Currency,
    dueDay: parsed.data.dueDay,
    accountId: parsed.data.accountId,
    active: parsed.data.active,
  })
  revalidateBillScreens()
  return { ok: true }
}

export async function updateBill(id: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser()
  const parsed = billInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid input' }
  const account = await ownedActiveAccount(user.id, parsed.data.accountId)
  if (!account) return { ok: false, error: 'Account not found' }
  if (account.currency !== parsed.data.currency) return { ok: false, error: 'Account currency must match' }
  const amountMinor = parseAmount(parsed.data.amount, parsed.data.currency as Currency)
  if (amountMinor === null) return { ok: false, error: 'Invalid amount' }

  const updated = await db
    .update(bills)
    .set({
      name: parsed.data.name,
      amountMinor,
      currency: parsed.data.currency as Currency,
      dueDay: parsed.data.dueDay,
      accountId: parsed.data.accountId,
      active: parsed.data.active,
    })
    .where(and(eq(bills.id, id), eq(bills.userId, user.id)))
    .returning({ id: bills.id })
  if (updated.length !== 1) return { ok: false, error: 'Bill not found' }

  await rewritePendingOccurrences('bill', id) // definition edits rewrite pending occurrences only (spec §3)
  revalidateBillScreens()
  return { ok: true }
}

export async function setBillActive(id: string, active: boolean): Promise<ActionResult> {
  const user = await requireUser()
  const updated = await db
    .update(bills)
    .set({ active })
    .where(and(eq(bills.id, id), eq(bills.userId, user.id)))
    .returning({ id: bills.id })
  if (updated.length !== 1) return { ok: false, error: 'Bill not found' }
  revalidateBillScreens()
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
git add lib/actions && git commit -m "feat(bills): bill crud actions with pending-occurrence rewrite"
```

---

### Task 5: Confirm module posts bill_payment (never expense)

**Files:**
- Modify: `lib/occurrences/confirm.ts`
- Test: `lib/occurrences/confirm.test.ts` (extend)

**Interfaces:**
- Consumes: `bills` table; existing `TXN_TYPE` / `TXN_SIGN` / `SOURCE_TYPE` maps (already contain `bill` entries from P3).
- Produces: `confirmOccurrence(...)` / `unconfirmOccurrence(...)` now handle `kind='bill'`; signatures unchanged, all P3 call sites (actions, sheet) work as-is.

**Steps:**

- [ ] Add failing tests:

```ts
// append to lib/occurrences/confirm.test.ts
import { bills } from '@/lib/db/schema'

async function seedBillOccurrence(status: 'pending' | 'overdue' = 'pending') {
  const userId = `test-${randomUUID()}`
  const [account] = await db
    .insert(accounts)
    .values({ userId, name: 'Main EGP', currency: 'EGP' })
    .returning()
  const [bill] = await db
    .insert(bills)
    .values({ userId, name: 'Rent', amountMinor: 1500000, currency: 'EGP', dueDay: 1, accountId: account.id, active: true })
    .returning()
  const [occ] = await db
    .insert(occurrences)
    .values({
      userId,
      kind: 'bill',
      sourceId: bill.id,
      period: '2026-07',
      dueDate: '2026-07-01',
      expectedAmountMinor: 1500000,
      status,
    })
    .returning()
  return { userId, account, occ }
}

describe('bill confirm', () => {
  it('posts a bill_payment transaction, NEVER expense, with a negative amount', async () => {
    const { userId, account, occ } = await seedBillOccurrence()
    const result = await confirmOccurrence({
      userId,
      occurrenceId: occ.id,
      actualAmountMinor: 1550000, // actual differed from expected
      actualDate: '2026-07-02',
    })
    expect(result).toEqual({ ok: true })
    const [after] = await db.select().from(occurrences).where(eq(occurrences.id, occ.id))
    const [txn] = await db.select().from(transactions).where(eq(transactions.id, after.transactionId!))
    expect(txn.type).toBe('bill_payment')
    expect(txn.type).not.toBe('expense') // spec §5.4: the P7 spend estimate must not double-count bills
    expect(txn).toMatchObject({
      accountId: account.id,
      amountMinor: -1550000, // outflow: negative
      currency: 'EGP',
      occurredOn: '2026-07-02',
      sourceType: 'bill_occurrence',
      sourceId: occ.id,
    })
  })

  it('un-confirm deletes the bill_payment and resets the occurrence', async () => {
    const { userId, occ } = await seedBillOccurrence('overdue')
    await confirmOccurrence({ userId, occurrenceId: occ.id, actualAmountMinor: 1500000, actualDate: '2026-07-05' })
    expect(await unconfirmOccurrence(userId, occ.id)).toEqual({ ok: true })
    const [after] = await db.select().from(occurrences).where(eq(occurrences.id, occ.id))
    expect(after.status).toBe('pending')
    expect(await db.select().from(transactions).where(eq(transactions.sourceId, occ.id))).toHaveLength(0)
  })
})
```

- [ ] Run and fail:

```bash
npx vitest run lib/occurrences
```

Expected: FAIL with `Unsupported occurrence kind: bill` (the P3 `loadSource` default case).

- [ ] Add the `bill` case to `loadSource` in `lib/occurrences/confirm.ts`. Full function after the change:

```ts
import { bills, incomeSources, occurrences, transactions } from '@/lib/db/schema'

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
    default:
      // 'installment' is added in P5
      throw new ConfirmError(`Unsupported occurrence kind: ${kind}`)
  }
}
```

No other change: `TXN_TYPE.bill = 'bill_payment'`, `TXN_SIGN.bill = -1`, and `SOURCE_TYPE.bill = 'bill_occurrence'` have been in the maps since P3.

- [ ] Run again:

```bash
npx vitest run lib/occurrences
```

Expected: PASS (P3 income tests plus the two bill tests).

- [ ] Commit:

```bash
git add lib/occurrences && git commit -m "feat(occurrences): bill confirm posts bill_payment"
```

---

### Task 6: Bills screens

**Files:**
- Create: `app/(app)/bills/page.tsx`
- Create: `app/(app)/bills/new/page.tsx`
- Create: `app/(app)/bills/[id]/edit/page.tsx`
- Create: `components/bills/bill-form.tsx`

**Interfaces:**
- Consumes: `requireUser()`, `db`, `formatMoney(m)`, bill actions from Task 4.
- Produces: `/bills` routes wired into the bottom tab nav (add a Bills tab entry in the P0 shell if not present).

**Steps:**

- [ ] Bills list page:

```tsx
// app/(app)/bills/page.tsx
import Link from 'next/link'
import { eq } from 'drizzle-orm'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { bills } from '@/lib/db/schema'
import { formatMoney } from '@/lib/money/money'

export default async function BillsPage() {
  const user = await requireUser()
  const rows = await db.select().from(bills).where(eq(bills.userId, user.id))
  return (
    <main className="pb-20">
      <div className="flex items-center justify-between px-4 py-3">
        <h1 className="text-lg font-semibold">Bills</h1>
        <Link href="/bills/new" className="rounded bg-black px-3 py-2 text-sm text-white">
          New bill
        </Link>
      </div>
      <ul className="divide-y divide-gray-100">
        {rows.map((b) => (
          <li key={b.id}>
            <Link href={`/bills/${b.id}/edit`} className="flex items-center justify-between px-4 py-3">
              <span>
                <span className="block font-medium">{b.name}</span>
                <span className="block text-sm text-gray-500">
                  Due day {b.dueDay}
                  {b.active ? '' : ' (inactive)'}
                </span>
              </span>
              <span className="font-medium">{formatMoney({ amountMinor: b.amountMinor, currency: b.currency })}</span>
            </Link>
          </li>
        ))}
        {rows.length === 0 && <li className="px-4 py-6 text-sm text-gray-500">No bills yet.</li>}
      </ul>
    </main>
  )
}
```

- [ ] Bill form (client, shared by new and edit):

```tsx
// components/bills/bill-form.tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createBill, setBillActive, updateBill } from '@/lib/actions/bills'

interface AccountOption {
  id: string
  name: string
  currency: string
}

interface BillValues {
  id: string
  name: string
  amount: string // decimal string
  dueDay: number
  accountId: string
  active: boolean
}

export function BillForm({ accounts, bill }: { accounts: AccountOption[]; bill?: BillValues }) {
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
      currency: account?.currency ?? 'EUR', // bill currency = source account currency
      dueDay: Number(f.get('dueDay')),
      accountId,
      active: bill?.active ?? true,
    }
    const result = bill ? await updateBill(bill.id, input) : await createBill(input)
    if (result.ok) router.push('/bills')
    else setError(result.error)
  }

  async function toggleActive() {
    if (!bill) return
    const result = await setBillActive(bill.id, !bill.active)
    if (result.ok) router.push('/bills')
    else setError(result.error)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 px-4 py-3">
      <label className="block text-sm">
        Name
        <input name="name" required defaultValue={bill?.name} className="mt-1 w-full rounded border px-3 py-2" />
      </label>
      <label className="block text-sm">
        Amount
        <input
          name="amount"
          required
          inputMode="decimal"
          defaultValue={bill?.amount}
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        Account
        <select name="accountId" required defaultValue={bill?.accountId} className="mt-1 w-full rounded border px-3 py-2">
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
          defaultValue={bill?.dueDay ?? 1}
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" className="w-full rounded bg-black py-3 text-white">
        {bill ? 'Save' : 'Create'}
      </button>
      {bill && (
        <button type="button" onClick={toggleActive} className="w-full rounded border py-3">
          {bill.active ? 'Deactivate' : 'Reactivate'}
        </button>
      )}
    </form>
  )
}
```

- [ ] New and edit pages:

```tsx
// app/(app)/bills/new/page.tsx
import { and, eq, isNull } from 'drizzle-orm'
import { BillForm } from '@/components/bills/bill-form'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { accounts } from '@/lib/db/schema'

export default async function NewBillPage() {
  const user = await requireUser()
  const accountRows = await db
    .select({ id: accounts.id, name: accounts.name, currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.userId, user.id), isNull(accounts.archivedAt)))
  return (
    <main>
      <h1 className="px-4 py-3 text-lg font-semibold">New bill</h1>
      <BillForm accounts={accountRows} />
    </main>
  )
}
```

```tsx
// app/(app)/bills/[id]/edit/page.tsx
import { notFound } from 'next/navigation'
import { and, eq, isNull } from 'drizzle-orm'
import { BillForm } from '@/components/bills/bill-form'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { accounts, bills } from '@/lib/db/schema'

export default async function EditBillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()
  const [bill] = await db
    .select()
    .from(bills)
    .where(and(eq(bills.id, id), eq(bills.userId, user.id)))
  if (!bill) notFound()
  const accountRows = await db
    .select({ id: accounts.id, name: accounts.name, currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.userId, user.id), isNull(accounts.archivedAt)))
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
```

- [ ] Verify manually at 375px: create a rent bill, it lists with the formatted amount; edit persists and pending occurrences pick up the change on the next dashboard view. Commit:

```bash
git add app/\(app\)/bills components/bills && git commit -m "feat(bills): bill screens"
```

---

### Task 7: Attention list shows bills due within 7 days or overdue

**Files:**
- Modify: `lib/occurrences/attention.ts`

**Interfaces:**
- Consumes: `bills` table; the `today` parameter P3 already threaded through.
- Produces: `getAttentionItems(userId: string, today: string): Promise<AttentionItem[]>`, same signature and item shape; now returns income items (always, while unsettled) plus bill items only when `due_date <= today + 7 days` or overdue. `AttentionList` and `ConfirmSheet` need zero changes: the `CTA` map already says "confirm paid" for bills.

**Steps:**

- [ ] Replace the body of `lib/occurrences/attention.ts`. Full file after the change:

```ts
// lib/occurrences/attention.ts
import { and, eq, inArray, lte, or } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { bills, incomeSources, occurrences } from '@/lib/db/schema'
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

function plusDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export async function getAttentionItems(userId: string, today: string): Promise<AttentionItem[]> {
  const soon = plusDays(today, 7)

  const incomeRows = await db
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

  const billRows = await db
    .select({
      occurrenceId: occurrences.id,
      kind: occurrences.kind,
      sourceName: bills.name,
      expectedAmountMinor: occurrences.expectedAmountMinor,
      currency: bills.currency,
      dueDate: occurrences.dueDate,
      status: occurrences.status,
    })
    .from(occurrences)
    .innerJoin(bills, eq(occurrences.sourceId, bills.id))
    .where(
      and(
        eq(occurrences.userId, userId),
        eq(occurrences.kind, 'bill'),
        or(
          eq(occurrences.status, 'overdue'),
          and(eq(occurrences.status, 'pending'), lte(occurrences.dueDate, soon)), // due within 7 days
        ),
      ),
    )

  // ponytail: two queries + JS sort beats a cross-table SQL union; n is tiny (one user's month)
  return [...incomeRows, ...billRows].sort((a, b) => a.dueDate.localeCompare(b.dueDate)) as AttentionItem[]
}
```

- [ ] Type-check and run everything:

```bash
npx tsc --noEmit && npx vitest run
```

Expected: PASS.

- [ ] Verify manually: a bill due day within the next week appears on the dashboard with "confirm paid"; one due three weeks out does not; the sheet confirms it and it leaves the list. Commit:

```bash
git add lib/occurrences/attention.ts && git commit -m "feat(dashboard): bills in attention list within 7-day window"
```

---

### Task 8: E2E, rent bill confirm posts bill_payment

**Files:**
- Test: `tests/e2e/bills.spec.ts`

**Interfaces:**
- Consumes: the running app with email+password auth; the same `signIn` helper as `tests/e2e/income.spec.ts` (extract it to `tests/e2e/helpers.ts` now that two specs share it, and update the income spec's import).

**Steps:**

- [ ] Extract the shared helper:

```ts
// tests/e2e/helpers.ts
import type { Page } from '@playwright/test'

export async function signIn(page: Page) {
  await page.goto('/sign-in')
  await page.getByLabel(/email/i).fill(process.env.E2E_EMAIL!)
  await page.getByLabel(/password/i).fill(process.env.E2E_PASSWORD!)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL('**/')
}
```

Update `tests/e2e/income.spec.ts` to `import { signIn } from './helpers'` and delete its inline copy.

- [ ] Write the spec:

```ts
// tests/e2e/bills.spec.ts
import { expect, test } from '@playwright/test'
import { signIn } from './helpers'

test('rent bill: confirm posts a bill_payment (not an expense), balance drops', async ({ page }) => {
  await signIn(page)
  const stamp = Date.now()
  const accountName = `Rent EGP ${stamp}`
  const billName = `Rent ${stamp}`

  // Account with an opening balance to pay from (P1 flow)
  await page.goto('/accounts')
  await page.getByRole('link', { name: /new account/i }).click()
  await page.getByLabel(/name/i).fill(accountName)
  await page.getByLabel(/currency/i).selectOption('EGP')
  await page.getByLabel(/opening balance/i).fill('20000.00')
  await page.getByRole('button', { name: /create/i }).click()

  // Bill due on the 1st: already past (or today), so due within the window on any calendar day
  await page.goto('/bills')
  await page.getByRole('link', { name: /new bill/i }).click()
  await page.getByLabel(/^name/i).fill(billName)
  await page.getByLabel(/^amount/i).fill('15000.00')
  await page.getByLabel(/account/i).selectOption({ label: `${accountName} (EGP)` })
  await page.getByLabel(/due day/i).fill('1')
  await page.getByRole('button', { name: /create/i }).click()

  // Dashboard: housekeeping generates the occurrence; due day 1 is today or overdue, so it shows
  await page.goto('/')
  const row = page.getByRole('button', { name: new RegExp(billName) })
  await expect(row).toBeVisible()
  await expect(row).toContainText('confirm paid')
  await row.click()

  // Confirm with the expected figures
  await expect(page.getByLabel(/amount/i)).toHaveValue('15000.00')
  await page.getByRole('button', { name: /^confirm$/i }).click()
  await expect(page.getByRole('button', { name: new RegExp(billName) })).toHaveCount(0)

  // History shows a bill payment, NOT an expense (spec §5.4: spend estimate must not double-count)
  await page.goto('/transactions')
  const historyRow = page.locator('li', { hasText: billName })
  await expect(historyRow).toContainText(/bill payment/i)
  await expect(historyRow).not.toContainText(/expense/i)

  // Balance reflects the payment: 20,000.00 - 15,000.00
  await page.goto('/accounts')
  await expect(page.getByText(accountName).locator('xpath=ancestor::li')).toContainText('5,000.00')
})
```

The essentials baseline (settings jsonb) is a planner input that nothing in this flow reads or writes; posting `bill_payment` instead of `expense` is exactly what keeps the P7 spend estimate (trailing `expense` actuals) untouched, and the history assertion above is the guard for that.

- [ ] Run it:

```bash
npx playwright test tests/e2e/bills.spec.ts
```

Expected: PASS.

- [ ] Full gate, then commit:

```bash
npx tsc --noEmit && npx vitest run && npx playwright test
git add tests/e2e && git commit -m "test(e2e): rent bill confirm posts bill_payment"
```

---

**Phase exit criteria:** all Vitest suites green, `tests/e2e/bills.spec.ts` and the P3 income spec green, manual 375px walkthrough of bills list, 7-day attention window, confirm sheet. Update `docs/wiki/status.md`.

**Backlinks:** [Master index](../plans/README.md) | [Spec](../specs/2026-07-07-my-ledger-design.md) | [Prev: P3 Income](../plans/03-income.md) | [Next: P5 Installments](../plans/05-installments.md)
