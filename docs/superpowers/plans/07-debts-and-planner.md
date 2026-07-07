# Phase 07: Debts and Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

Backlinks: [Plans index](../plans/README.md) | [Design spec](../specs/2026-07-07-my-ledger-design.md) | [Planner ADR](../../adr/2026-07-07-debt-first-deadline-aware-planner.md) | Previous: [06-expenses-and-insights.md](06-expenses-and-insights.md) | Next: [08-wishlist.md](08-wishlist.md)

**Goal:** Flexible debts (table, CRUD, derived balances, payment flow) and the deterministic planner: `buildPlan(input: PlanInput): PlanResult` in `lib/planner/engine.ts`, honoring the [planner ADR](../../adr/2026-07-07-debt-first-deadline-aware-planner.md) - debt-first allocation with deadline just-in-time payments, avalanche by APR, currency-aware funding gaps with live-rate transfer suggestions - plus the plan screen. This is the biggest TDD unit of the project.

**Architecture:** Debt balances are derived (`original_minor` plus adjustments minus `debt_payment` transactions), never stored. The planner is a pure function over a `PlanInput` assembled from the DB by `lib/planner/input.ts`; it owns every displayed number and is exhaustively unit-tested with table-driven cases. Interest (`apr/12`) exists only inside projections; DB balances never accrue.

**Tech Stack:** Next.js App Router + TypeScript + Tailwind, Neon + Drizzle, Vitest + Playwright.

**Global Constraints** (verbatim from [the plans README](../plans/README.md)):

- Money: integer minor units, currencies `EUR|USD|EGP`, round half-up, balances derived ([spec §3](../specs/2026-07-07-my-ledger-design.md)).
- No transaction converts currency; transfer legs mutate as a group; source-linked transactions mutate only via owning flow.
- Day boundaries `Africa/Cairo`; due-date clamp `min(due_day, last_day_of_month)`.
- Occurrences unique per (user, kind, source, period); confirms guard on `status IN ('pending','overdue')`; snapshots unique per (user, date).
- All mutations = zod-validated server actions + `revalidatePath`; every table has `user_id`.
- TDD: failing test → minimal code → pass → commit. Frequent small commits.
- The deterministic engine owns all numbers; the AI only quotes.

**Phase-wide conventions:**

- P2 stores outflows as negative `amount_minor` so `accountBalanceMinor` is a plain sum. Debt payments therefore insert negative amounts, and derived debt balances add the (negative) payment sums to `original_minor`.
- `apr` is percent per year (`12` means 12%); the monthly rate is `apr / 1200`. Installments with `apr >= 15` get flagged, never avalanched (fixed obligations per the ADR).
- Engine allocation order per month: (1) deadline-required just-in-time payments, (2) minimum payments on debts that define one, (3) remaining surplus to ASAP debts by APR descending (avalanche), (4) leftover (deadline slack + post-debt surplus) reported as `MonthPlan.unallocatedMinor` for P8's wishlist. Steps 1 and 2 are obligations and are scheduled even when they exceed the month's surplus; only step 3 requires surplus to remain.
- Windfall behavior is emergent: the plan is recomputed from current balances on every load, so a logged windfall raises `accountBalancesMinor` and next month's avalanche accelerates. No windfall code exists in the engine.
- This phase adds three fields to the canonical interfaces, already reflected in [the plans README](../plans/README.md): `PlanInput.startPeriod` (the engine is pure, so the first planned period is an input), `PlanInput.spendEstimateSource` (computed by the caller alongside `variableSpendMinor`, echoed in `PlanResult`), and `MonthPlan.unallocatedMinor`.

---

### Task 1: flexible_debts table and migration

**Files:**
- Modify: `lib/db/schema.ts`
- Create: generated migration under `drizzle/` (via drizzle-kit)

**Interfaces:**
- Produces: `flexibleDebts` Drizzle table export per spec §4 `flexible_debts(id, user_id, name, original_minor, currency, apr, deadline?, min_payment_minor?, created_at)`.

**Steps:**

- [ ] Append to `lib/db/schema.ts` (reuse P1's currency column helper and money column helper if they exist; shown inline otherwise):

```ts
export const flexibleDebts = pgTable('flexible_debts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  originalMinor: bigint('original_minor', { mode: 'number' }).notNull(),
  currency: text('currency', { enum: ['EUR', 'USD', 'EGP'] }).notNull(),
  apr: doublePrecision('apr').notNull().default(0),
  deadline: date('deadline'),
  minPaymentMinor: bigint('min_payment_minor', { mode: 'number' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})
```

- [ ] Run: `npx drizzle-kit generate --name p7-flexible-debts` - expect a new SQL file containing `CREATE TABLE "flexible_debts"`.
- [ ] Run: `npx drizzle-kit migrate` - expect clean apply.
- [ ] Run: `npx tsc --noEmit` - expect PASS.
- [ ] Commit: `git add lib/db/schema.ts drizzle && git commit -m "P7: flexible_debts table + migration"`

---

### Task 2: periodsBetween helper

**Files:**
- Modify: `lib/dates/cairo.ts`
- Test: `lib/dates/cairo.test.ts` (extend)

**Interfaces:**
- Produces: `function periodsBetween(a: string, b: string): number` - signed whole months from period `a` to period `b`.
- Consumes: nothing (pure string math; pairs with P6's `addPeriods`).

**Steps:**

- [ ] Add failing tests to `lib/dates/cairo.test.ts`:

```ts
import { periodsBetween } from './cairo'

describe('periodsBetween', () => {
  it('same period is zero', () => expect(periodsBetween('2026-08', '2026-08')).toBe(0))
  it('counts forward across years', () => expect(periodsBetween('2026-11', '2027-02')).toBe(3))
  it('is negative when the target is earlier', () => expect(periodsBetween('2026-08', '2026-05')).toBe(-3))
})
```

- [ ] Run: `npx vitest run lib/dates/cairo.test.ts` - expect FAIL: `periodsBetween` is not exported.
- [ ] Implement in `lib/dates/cairo.ts`:

```ts
export function periodsBetween(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number)
  const [yb, mb] = b.split('-').map(Number)
  return (yb - ya) * 12 + (mb - ma)
}
```

- [ ] Run: `npx vitest run lib/dates/cairo.test.ts` - expect PASS.
- [ ] Commit: `git add lib/dates/cairo.ts lib/dates/cairo.test.ts && git commit -m "P7: periodsBetween period arithmetic helper"`

---

### Task 3: derived debt balance

**Files:**
- Create: `lib/debts/balance.ts`
- Test: `lib/debts/balance.test.ts`

**Interfaces:**
- Produces:
  - `function debtBalanceFromRows(originalMinor: number, rows: { type: string; amountMinor: number }[]): number` (pure)
  - `async function debtBalanceMinor(debtId: string): Promise<number>` - `original_minor` + adjustments - sum of `debt_payment` transactions.
- Consumes: `db`, `transactions`, `flexibleDebts` schema.

**Steps:**

- [ ] Write failing test `lib/debts/balance.test.ts`:

```ts
import { debtBalanceFromRows } from './balance'

describe('debtBalanceFromRows', () => {
  it('subtracts payments (stored negative) and applies signed adjustments', () => {
    // 100000 - 30000 - 20000 + 5000 = 55000
    expect(
      debtBalanceFromRows(100000, [
        { type: 'debt_payment', amountMinor: -30000 },
        { type: 'debt_payment', amountMinor: -20000 },
        { type: 'adjustment', amountMinor: 5000 },
      ]),
    ).toBe(55000)
  })
  it('ignores unrelated types and handles no rows', () => {
    expect(debtBalanceFromRows(100000, [])).toBe(100000)
    expect(debtBalanceFromRows(100000, [{ type: 'purchase', amountMinor: -500 }])).toBe(100000)
  })
})
```

- [ ] Run: `npx vitest run lib/debts/balance.test.ts` - expect FAIL: module not found.
- [ ] Implement `lib/debts/balance.ts` (no P7 UI posts debt adjustments; the adjustment term future-proofs corrections without a schema change):

```ts
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { flexibleDebts, transactions } from '@/lib/db/schema'

export function debtBalanceFromRows(
  originalMinor: number,
  rows: { type: string; amountMinor: number }[],
): number {
  // debt_payment rows are stored negative on the paying account (P2 sign convention),
  // so adding them subtracts from the debt; adjustments are signed (positive = owe more)
  return rows
    .filter((r) => r.type === 'debt_payment' || r.type === 'adjustment')
    .reduce((balance, r) => balance + r.amountMinor, originalMinor)
}

export async function debtBalanceMinor(debtId: string): Promise<number> {
  const [debt] = await db.select().from(flexibleDebts).where(eq(flexibleDebts.id, debtId))
  if (!debt) throw new Error('Debt not found')
  const rows = await db
    .select({ type: transactions.type, amountMinor: transactions.amountMinor })
    .from(transactions)
    .where(and(eq(transactions.sourceType, 'flexible_debt'), eq(transactions.sourceId, debtId)))
  return debtBalanceFromRows(debt.originalMinor, rows)
}
```

- [ ] Run: `npx vitest run lib/debts/balance.test.ts` - expect PASS.
- [ ] Commit: `git add lib/debts/balance.ts lib/debts/balance.test.ts && git commit -m "P7: derived debt balance"`

---

### Task 4: debt CRUD actions

**Files:**
- Create: `lib/actions/debts.ts`
- Test: `lib/actions/debts.test.ts`

**Interfaces:**
- Produces: `debtSchema` (zod), server actions `createDebt(raw: unknown)`, `updateDebt(raw: unknown)`, `deleteDebt(raw: unknown)`.
- Consumes: `flexibleDebts`, `transactions` schema; `requireUser`; `db`.

**Steps:**

- [ ] Write failing test `lib/actions/debts.test.ts`:

```ts
import { debtSchema } from './debts'

describe('debtSchema', () => {
  it('accepts a full debt', () => {
    expect(
      debtSchema.parse({
        name: 'Family loan',
        originalMinor: 30000,
        currency: 'EUR',
        apr: 12,
        deadline: '2026-10-15',
        minPaymentMinor: 5000,
      }),
    ).toMatchObject({ name: 'Family loan', apr: 12 })
  })
  it('defaults apr to 0 and allows omitting deadline and minimum', () => {
    expect(debtSchema.parse({ name: 'IOU', originalMinor: 1000, currency: 'EGP' })).toMatchObject({ apr: 0 })
  })
  it('rejects zero or negative amounts', () => {
    expect(() => debtSchema.parse({ name: 'X', originalMinor: 0, currency: 'EUR' })).toThrow()
  })
})
```

- [ ] Run: `npx vitest run lib/actions/debts.test.ts` - expect FAIL: module not found.
- [ ] Implement `lib/actions/debts.ts`:

```ts
'use server'

import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db/client'
import { flexibleDebts, transactions } from '@/lib/db/schema'
import { requireUser } from '@/lib/auth/stack'

export const debtSchema = z.object({
  name: z.string().trim().min(1).max(80),
  originalMinor: z.number().int().positive(),
  currency: z.enum(['EUR', 'USD', 'EGP']),
  apr: z.number().min(0).max(200).default(0),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  minPaymentMinor: z.number().int().positive().optional(),
})

const idSchema = z.object({ id: z.string().uuid() })

function revalidateDebtPaths() {
  revalidatePath('/debts')
  revalidatePath('/plan')
}

export async function createDebt(raw: unknown) {
  const data = debtSchema.parse(raw)
  const user = await requireUser()
  await db.insert(flexibleDebts).values({
    userId: user.id,
    name: data.name,
    originalMinor: data.originalMinor,
    currency: data.currency,
    apr: data.apr,
    deadline: data.deadline ?? null,
    minPaymentMinor: data.minPaymentMinor ?? null,
  })
  revalidateDebtPaths()
}

export async function updateDebt(raw: unknown) {
  const data = debtSchema.extend({ id: z.string().uuid() }).parse(raw)
  const user = await requireUser()
  await db
    .update(flexibleDebts)
    .set({
      name: data.name,
      originalMinor: data.originalMinor,
      apr: data.apr,
      deadline: data.deadline ?? null,
      minPaymentMinor: data.minPaymentMinor ?? null,
      // currency intentionally not editable once created: payments already reference it
    })
    .where(and(eq(flexibleDebts.id, data.id), eq(flexibleDebts.userId, user.id)))
  revalidateDebtPaths()
}

export async function deleteDebt(raw: unknown) {
  const { id } = idSchema.parse(raw)
  const user = await requireUser()
  const linked = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.sourceType, 'flexible_debt'), eq(transactions.sourceId, id)))
    .limit(1)
  if (linked.length > 0) throw new Error('This debt has payments; reverse them first')
  await db.delete(flexibleDebts).where(and(eq(flexibleDebts.id, id), eq(flexibleDebts.userId, user.id)))
  revalidateDebtPaths()
}
```

- [ ] Run: `npx vitest run lib/actions/debts.test.ts` - expect PASS.
- [ ] Commit: `git add lib/actions/debts.ts lib/actions/debts.test.ts && git commit -m "P7: debt CRUD actions"`

---

### Task 5: debt payment flow (record and reverse)

Source-linked mutability: `debt_payment` transactions are created and deleted only through these two actions.

**Files:**
- Modify: `lib/actions/debts.ts`
- Test: `lib/actions/debts.test.ts` (extend)

**Interfaces:**
- Produces: `debtPaymentSchema` (zod), `recordDebtPayment(raw: unknown)`, `deleteDebtPayment(raw: unknown)`.
- Consumes: `dbPool` (neon-serverless, transactions), `accounts` schema, `todayCairo` (P1).

**Steps:**

- [ ] Add failing test to `lib/actions/debts.test.ts`:

```ts
import { debtPaymentSchema } from './debts'

describe('debtPaymentSchema', () => {
  it('requires positive integer minor amount and uuids', () => {
    expect(
      debtPaymentSchema.parse({
        debtId: '9f8b7c6d-1234-4abc-9def-0123456789ab',
        accountId: '1f8b7c6d-1234-4abc-9def-0123456789ab',
        amountMinor: 10000,
      }),
    ).toMatchObject({ amountMinor: 10000 })
    expect(() => debtPaymentSchema.parse({ debtId: 'x', accountId: 'y', amountMinor: -5 })).toThrow()
  })
})
```

- [ ] Run: `npx vitest run lib/actions/debts.test.ts` - expect FAIL: `debtPaymentSchema` is not exported.
- [ ] Add to `lib/actions/debts.ts`:

```ts
import { dbPool } from '@/lib/db/client'
import { accounts } from '@/lib/db/schema'
import { todayCairo } from '@/lib/dates/cairo'

export const debtPaymentSchema = z.object({
  debtId: z.string().uuid(),
  accountId: z.string().uuid(),
  amountMinor: z.number().int().positive(),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export async function recordDebtPayment(raw: unknown) {
  const data = debtPaymentSchema.parse(raw)
  const user = await requireUser()
  await dbPool.transaction(async (tx) => {
    const [debt] = await tx
      .select()
      .from(flexibleDebts)
      .where(and(eq(flexibleDebts.id, data.debtId), eq(flexibleDebts.userId, user.id)))
    if (!debt) throw new Error('Debt not found')
    const [account] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, data.accountId), eq(accounts.userId, user.id)))
    if (!account || account.currency !== debt.currency) throw new Error('Account must hold the debt currency')
    await tx.insert(transactions).values({
      userId: user.id,
      accountId: data.accountId,
      type: 'debt_payment',
      amountMinor: -data.amountMinor, // outflow stored negative: balances stay plain sums
      currency: debt.currency,
      occurredOn: data.occurredOn ?? todayCairo(),
      note: `Payment: ${debt.name}`,
      sourceType: 'flexible_debt',
      sourceId: debt.id,
    })
  })
  revalidateDebtPaths()
  revalidatePath('/accounts')
}

export async function deleteDebtPayment(raw: unknown) {
  const { id } = idSchema.parse(raw)
  const user = await requireUser()
  const deleted = await db
    .delete(transactions)
    .where(
      and(
        eq(transactions.id, id),
        eq(transactions.userId, user.id),
        eq(transactions.type, 'debt_payment'),
        eq(transactions.sourceType, 'flexible_debt'),
      ),
    )
    .returning()
  if (deleted.length === 0) throw new Error('Payment not found')
  revalidateDebtPaths()
  revalidatePath('/accounts')
}
```

- [ ] Run: `npx vitest run lib/actions/debts.test.ts` - expect PASS.
- [ ] Commit: `git add lib/actions/debts.ts lib/actions/debts.test.ts && git commit -m "P7: debt payment flow (record + reverse)"`

---

### Task 6: debts screens

**Files:**
- Create: `components/debts/debt-form.tsx`
- Create: `components/debts/debt-pay-sheet.tsx`
- Create: `app/(app)/debts/page.tsx`
- Create: `app/(app)/debts/new/page.tsx`
- Create: `app/(app)/debts/[id]/page.tsx`

**Interfaces:**
- Consumes: Task 3-5 exports, `parseToMinor`/`formatMoney` (P1), `accounts` schema.

**Steps:**

- [ ] Create `components/debts/debt-form.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createDebt, updateDebt } from '@/lib/actions/debts'
import { parseToMinor, type Currency } from '@/lib/money/money'

type Existing = {
  id: string
  name: string
  originalMinor: number
  currency: Currency
  apr: number
  deadline: string | null
  minPaymentMinor: number | null
}

export function DebtForm({ existing }: { existing?: Existing }) {
  const router = useRouter()
  const [name, setName] = useState(existing?.name ?? '')
  const [currency, setCurrency] = useState<Currency>(existing?.currency ?? 'EUR')
  const [original, setOriginal] = useState(existing ? (existing.originalMinor / 100).toFixed(2) : '')
  const [apr, setApr] = useState(existing ? String(existing.apr) : '0')
  const [deadline, setDeadline] = useState(existing?.deadline ?? '')
  const [minPayment, setMinPayment] = useState(
    existing?.minPaymentMinor ? (existing.minPaymentMinor / 100).toFixed(2) : '',
  )
  return (
    <form
      action={async () => {
        const payload = {
          name,
          originalMinor: parseToMinor(original, currency),
          currency,
          apr: Number(apr),
          deadline: deadline || undefined,
          minPaymentMinor: minPayment ? parseToMinor(minPayment, currency) : undefined,
        }
        if (existing) await updateDebt({ id: existing.id, ...payload })
        else await createDebt(payload)
        router.push('/debts')
      }}
      className="space-y-3"
    >
      <label className="block text-sm">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required className="mt-1 w-full rounded-lg border p-3" />
      </label>
      <label className="block text-sm">
        Currency
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value as Currency)}
          disabled={!!existing}
          className="mt-1 w-full rounded-lg border p-3"
        >
          <option>EUR</option>
          <option>USD</option>
          <option>EGP</option>
        </select>
      </label>
      <label className="block text-sm">
        Original amount
        <input value={original} onChange={(e) => setOriginal(e.target.value)} inputMode="decimal" required className="mt-1 w-full rounded-lg border p-3" />
      </label>
      <label className="block text-sm">
        APR % (0 for interest-free)
        <input value={apr} onChange={(e) => setApr(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-lg border p-3" />
      </label>
      <label className="block text-sm">
        Deadline (optional; empty = pay ASAP)
        <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="mt-1 w-full rounded-lg border p-3" />
      </label>
      <label className="block text-sm">
        Minimum monthly payment (optional)
        <input value={minPayment} onChange={(e) => setMinPayment(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-lg border p-3" />
      </label>
      <button type="submit" className="w-full rounded-lg bg-neutral-900 p-3 text-white dark:bg-neutral-100 dark:text-neutral-900">
        Save
      </button>
    </form>
  )
}
```

- [ ] Create `components/debts/debt-pay-sheet.tsx` (same-currency account selector, defaults to the single match):

```tsx
'use client'

import { useState } from 'react'
import { recordDebtPayment } from '@/lib/actions/debts'
import { parseToMinor, type Currency } from '@/lib/money/money'

export function DebtPaySheet({
  debt,
  accounts,
}: {
  debt: { id: string; name: string; currency: Currency }
  accounts: { id: string; name: string }[]
}) {
  const [open, setOpen] = useState(false)
  const [accountId, setAccountId] = useState(accounts.length === 1 ? accounts[0].id : '')
  const [amount, setAmount] = useState('')
  if (accounts.length === 0) {
    return <p className="text-xs text-neutral-500">No {debt.currency} account to pay from.</p>
  }
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="w-full rounded-lg border p-2 text-sm">
        Pay
      </button>
    )
  }
  return (
    <form
      action={async () => {
        await recordDebtPayment({ debtId: debt.id, accountId, amountMinor: parseToMinor(amount, debt.currency) })
        setOpen(false)
        setAmount('')
      }}
      className="space-y-2"
    >
      <select value={accountId} onChange={(e) => setAccountId(e.target.value)} required className="w-full rounded-lg border p-3">
        {accounts.length > 1 && <option value="">Pay from…</option>}
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        inputMode="decimal"
        placeholder="Amount"
        aria-label="Amount"
        required
        className="w-full rounded-lg border p-3"
      />
      <div className="flex gap-2">
        <button type="submit" className="flex-1 rounded-lg bg-neutral-900 p-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900">
          Record payment
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border px-3 text-sm">
          Cancel
        </button>
      </div>
    </form>
  )
}
```

- [ ] Create `app/(app)/debts/page.tsx`:

```tsx
import Link from 'next/link'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { accounts, flexibleDebts } from '@/lib/db/schema'
import { requireUser } from '@/lib/auth/stack'
import { debtBalanceMinor } from '@/lib/debts/balance'
import { formatMoney, type Currency } from '@/lib/money/money'
import { DebtPaySheet } from '@/components/debts/debt-pay-sheet'

export default async function DebtsPage() {
  const user = await requireUser()
  const debtRows = await db.select().from(flexibleDebts).where(eq(flexibleDebts.userId, user.id)).orderBy(flexibleDebts.name)
  const accountRows = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, user.id), isNull(accounts.archivedAt)))
  const debts = await Promise.all(debtRows.map(async (d) => ({ ...d, balanceMinor: await debtBalanceMinor(d.id) })))

  return (
    <main className="mx-auto max-w-md space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Debts</h1>
        <Link href="/debts/new" className="text-sm underline">
          Add debt
        </Link>
      </div>
      {debts.length === 0 ? (
        <p className="text-sm text-neutral-500">No flexible debts. Add one to see it in the plan.</p>
      ) : (
        <ul className="space-y-3">
          {debts.map((d) => (
            <li key={d.id} className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <Link href={`/debts/${d.id}`} className="font-medium">
                  {d.name}
                </Link>
                <span className="tabular-nums">{formatMoney({ amountMinor: d.balanceMinor, currency: d.currency as Currency })}</span>
              </div>
              <p className="text-xs text-neutral-500">
                {d.apr}% APR{d.deadline ? ` · due by ${d.deadline}` : ' · pay ASAP'}
                {d.minPaymentMinor ? ` · min ${formatMoney({ amountMinor: d.minPaymentMinor, currency: d.currency as Currency })}` : ''}
              </p>
              {d.balanceMinor > 0 && (
                <DebtPaySheet
                  debt={{ id: d.id, name: d.name, currency: d.currency as Currency }}
                  accounts={accountRows.filter((a) => a.currency === d.currency).map((a) => ({ id: a.id, name: a.name }))}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
```

- [ ] Create `app/(app)/debts/new/page.tsx`:

```tsx
import { DebtForm } from '@/components/debts/debt-form'

export default function NewDebtPage() {
  return (
    <main className="mx-auto max-w-md space-y-4 p-4">
      <h1 className="text-xl font-semibold">Add debt</h1>
      <DebtForm />
    </main>
  )
}
```

- [ ] Create `app/(app)/debts/[id]/page.tsx` (edit form + payment history with reversal):

```tsx
import { notFound } from 'next/navigation'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { flexibleDebts, transactions } from '@/lib/db/schema'
import { requireUser } from '@/lib/auth/stack'
import { deleteDebtPayment } from '@/lib/actions/debts'
import { DebtForm } from '@/components/debts/debt-form'
import { formatMoney, type Currency } from '@/lib/money/money'

export default async function DebtDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()
  const [debt] = await db
    .select()
    .from(flexibleDebts)
    .where(and(eq(flexibleDebts.id, id), eq(flexibleDebts.userId, user.id)))
  if (!debt) notFound()
  const payments = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.sourceType, 'flexible_debt'), eq(transactions.sourceId, id)))
    .orderBy(desc(transactions.occurredOn))

  return (
    <main className="mx-auto max-w-md space-y-4 p-4">
      <h1 className="text-xl font-semibold">{debt.name}</h1>
      <DebtForm
        existing={{
          id: debt.id,
          name: debt.name,
          originalMinor: debt.originalMinor,
          currency: debt.currency as Currency,
          apr: debt.apr,
          deadline: debt.deadline,
          minPaymentMinor: debt.minPaymentMinor,
        }}
      />
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Payments</h2>
        {payments.length === 0 ? (
          <p className="text-sm text-neutral-500">No payments yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between p-3 text-sm">
                <span>
                  {p.occurredOn} · {formatMoney({ amountMinor: -p.amountMinor, currency: p.currency as Currency })}
                </span>
                <form
                  action={async () => {
                    'use server'
                    await deleteDebtPayment({ id: p.id })
                  }}
                >
                  <button className="p-2 text-xs text-red-600">Reverse</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
```

- [ ] Run: `npx tsc --noEmit` - expect PASS.
- [ ] Run: `npm run dev` - create a debt, record a payment from a same-currency account, watch the list balance drop and the account balance drop; reverse the payment and watch both restore.
- [ ] Commit: `git add components/debts "app/(app)/debts" && git commit -m "P7: debts screens (list, form, pay sheet, detail)"`

---

### Task 7: planner types

**Files:**
- Create: `lib/planner/types.ts`

**Interfaces:**
- Produces: `PlanInput`, `MonthPlan`, `PlanResult` - **byte-for-byte the canonical interfaces from [the plans README](../plans/README.md)**. Do not drift.

**Steps:**

- [ ] Create `lib/planner/types.ts`:

```ts
import type { Currency } from '@/lib/money/money'
import type { Rates } from '@/lib/currency/rates'

export interface PlanInput {
  homeCurrency: Currency
  rates: Rates
  horizonMonths: number // default 24
  startPeriod: string // "YYYY-MM", first planned month
  monthlyIncomeMinor: Partial<Record<Currency, number>> // guaranteed only
  billsMinor: Partial<Record<Currency, number>>
  installments: { name: string; monthlyMinor: number; currency: Currency; remainingCount: number; apr?: number }[]
  variableSpendMinor: Partial<Record<Currency, number>> // G4 blend, computed by caller
  spendEstimateSource: 'baseline' | 'blend' // how variableSpendMinor was derived; echoed in PlanResult
  debts: { id: string; name: string; balanceMinor: number; currency: Currency; apr: number; deadline?: string; minPaymentMinor?: number }[]
  wishlist: { id: string; name: string; costMinor: number; currency: Currency; priority: number; targetDate?: string }[]
  accountBalancesMinor: Partial<Record<Currency, number>>
}

export interface MonthPlan {
  period: string
  debtPayments: { debtId: string; amountMinor: number; currency: Currency }[]
  wishlistFunding: { itemId: string; amountMinor: number; currency: Currency }[]
  fundingGaps: { currency: Currency; shortfallMinor: number; suggestion: string }[]
  unallocatedMinor: number // home currency; deadline slack + post-debt surplus, before wishlist funding
}

export interface PlanResult {
  months: MonthPlan[]
  debtPayoffPeriod: Record<string, string | null> // debtId -> "YYYY-MM"
  wishlistAffordablePeriod: Record<string, string | null>
  surplusMinorByMonth: Record<string, number> // home currency
  spendEstimateSource: 'baseline' | 'blend'
  highAprInstallmentFlags: string[]
}
```

- [ ] Run: `npx tsc --noEmit` - expect PASS.
- [ ] Commit: `git add lib/planner/types.ts && git commit -m "P7: canonical planner types"`

---

### Task 8: engine math helpers

**Files:**
- Create: `lib/planner/engine.ts` (helpers only; `buildPlan` arrives in Task 10)
- Test: `lib/planner/engine.test.ts`

**Interfaces:**
- Produces: `roundHalfUp(x: number): number`, `interestOn(balanceMinor: number, apr: number): number`, `jitPayment(balanceMinor: number, apr: number, n: number): number` (all exported for tests and for `spend-estimate.ts`).

**Steps:**

- [ ] Write failing tests in `lib/planner/engine.test.ts`:

```ts
import { interestOn, jitPayment, roundHalfUp } from './engine'

describe('roundHalfUp', () => {
  it('rounds .5 up', () => expect(roundHalfUp(2.5)).toBe(3))
  it('rounds below .5 down', () => expect(roundHalfUp(2.49)).toBe(2))
})

describe('interestOn (simple monthly interest, apr/12)', () => {
  // 200000 * 20 / 1200 = 3333.33 -> 3333
  it('computes one month of interest', () => expect(interestOn(200000, 20)).toBe(3333))
  // 53333 * 20 / 1200 = 888.88 -> 889
  it('rounds half-up', () => expect(interestOn(53333, 20)).toBe(889))
  it('zero apr is zero interest', () => expect(interestOn(100000, 0)).toBe(0))
})

describe('jitPayment (level payment clearing balance in n months)', () => {
  // r = 12/1200 = 0.01, n = 3: 30000*0.01 / (1 - 1.01^-3) = 300 / 0.0294099 = 10200.66 -> ceil 10201
  it('annuity payment with interest', () => expect(jitPayment(30000, 12, 3)).toBe(10201))
  // n = 1 degenerates to balance plus one month interest: 10099 * 1.01 = 10199.99 -> ceil 10200
  it('single remaining month', () => expect(jitPayment(10099, 12, 1)).toBe(10200))
  // r = 0: straight division, ceil
  it('zero apr divides evenly', () => expect(jitPayment(30000, 0, 3)).toBe(10000))
})
```

- [ ] Run: `npx vitest run lib/planner/engine.test.ts` - expect FAIL: module not found.
- [ ] Create `lib/planner/engine.ts`:

```ts
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5)
}

export function interestOn(balanceMinor: number, apr: number): number {
  // apr is percent per year (12 = 12%); simple monthly interest apr/12 per the planner ADR
  return roundHalfUp((balanceMinor * apr) / 1200)
}

export function jitPayment(balanceMinor: number, apr: number, n: number): number {
  // smallest level monthly payment that clears balanceMinor in n payments at apr/12;
  // ceil guarantees the deadline is met despite integer rounding (the last payment is capped at the balance)
  const r = apr / 1200
  if (r === 0) return Math.ceil(balanceMinor / n)
  return Math.ceil((balanceMinor * r) / (1 - (1 + r) ** -n))
}
```

- [ ] Run: `npx vitest run lib/planner/engine.test.ts` - expect PASS.
- [ ] Commit: `git add lib/planner/engine.ts lib/planner/engine.test.ts && git commit -m "P7: planner math helpers (interest, just-in-time payment)"`

---

### Task 9: variable spend estimate (the G4 blend)

Essentials baseline seeds the estimate; once at least 3 complete months of non-one_off expense data exist, the estimate blends to the trailing 3-month mean per currency. Consumes P6's `variableSpendActuals` row shape.

**Files:**
- Create: `lib/planner/spend-estimate.ts`
- Test: `lib/planner/spend-estimate.test.ts`

**Interfaces:**
- Produces: `interface SpendActualsRow { period: string; totalMinor: number }`; `function estimateVariableSpend(baselineMinor: Partial<Record<Currency, number>>, actualsByCurrency: Partial<Record<Currency, SpendActualsRow[]>>): { variableSpendMinor: Partial<Record<Currency, number>>; source: 'baseline' | 'blend' }`.
- Consumes: `roundHalfUp` (Task 8); rows produced by `variableSpendActuals` (P6).

**Steps:**

- [ ] Write failing tests `lib/planner/spend-estimate.test.ts`:

```ts
import { estimateVariableSpend } from './spend-estimate'

describe('estimateVariableSpend', () => {
  const baseline = { EUR: 80000, EGP: 500000 }

  it('uses the essentials baseline while fewer than 3 months of actuals exist', () => {
    const { variableSpendMinor, source } = estimateVariableSpend(baseline, {
      EUR: [
        { period: '2026-06', totalMinor: 90000 },
        { period: '2026-07', totalMinor: 110000 },
      ],
    })
    expect(source).toBe('baseline')
    expect(variableSpendMinor).toEqual({ EUR: 80000, EGP: 500000 })
  })

  it('blends to the trailing 3-month mean once 3 months of data exist', () => {
    const { variableSpendMinor, source } = estimateVariableSpend(baseline, {
      EUR: [
        { period: '2026-05', totalMinor: 90000 },
        { period: '2026-06', totalMinor: 110000 },
        { period: '2026-07', totalMinor: 100000 },
      ],
    })
    expect(source).toBe('blend')
    // (90000 + 110000 + 100000) / 3 = 100000
    expect(variableSpendMinor.EUR).toBe(100000)
    // EGP has no actuals in the window: keeps its baseline
    expect(variableSpendMinor.EGP).toBe(500000)
  })

  it('uses only the trailing 3 periods when more exist', () => {
    const { variableSpendMinor } = estimateVariableSpend(baseline, {
      EUR: [
        { period: '2026-03', totalMinor: 900000 }, // outside the trailing window, ignored
        { period: '2026-05', totalMinor: 90000 },
        { period: '2026-06', totalMinor: 110000 },
        { period: '2026-07', totalMinor: 100000 },
      ],
    })
    expect(variableSpendMinor.EUR).toBe(100000)
  })
})
```

- [ ] Run: `npx vitest run lib/planner/spend-estimate.test.ts` - expect FAIL: module not found.
- [ ] Implement `lib/planner/spend-estimate.ts`:

```ts
import type { Currency } from '@/lib/money/money'
import { roundHalfUp } from './engine'

export interface SpendActualsRow {
  period: string
  totalMinor: number
}

export function estimateVariableSpend(
  baselineMinor: Partial<Record<Currency, number>>,
  actualsByCurrency: Partial<Record<Currency, SpendActualsRow[]>>,
): { variableSpendMinor: Partial<Record<Currency, number>>; source: 'baseline' | 'blend' } {
  const periodsWithData = new Set<string>()
  for (const rows of Object.values(actualsByCurrency)) {
    for (const r of rows ?? []) if (r.totalMinor > 0) periodsWithData.add(r.period)
  }
  if (periodsWithData.size < 3) {
    return { variableSpendMinor: { ...baselineMinor }, source: 'baseline' }
  }
  const trailing = [...periodsWithData].sort().slice(-3)
  const variableSpendMinor: Partial<Record<Currency, number>> = { ...baselineMinor }
  for (const [currency, rows] of Object.entries(actualsByCurrency) as [Currency, SpendActualsRow[] | undefined][]) {
    const sum = (rows ?? []).filter((r) => trailing.includes(r.period)).reduce((a, r) => a + r.totalMinor, 0)
    if (sum > 0) variableSpendMinor[currency] = roundHalfUp(sum / 3)
  }
  return { variableSpendMinor, source: 'blend' }
}
```

- [ ] Run: `npx vitest run lib/planner/spend-estimate.test.ts` - expect PASS.
- [ ] Commit: `git add lib/planner/spend-estimate.ts lib/planner/spend-estimate.test.ts && git commit -m "P7: variable spend estimate with baseline-to-blend switchover"`

---

### Task 10: engine core - surplus, avalanche, minimums, payoff reporting

**Files:**
- Modify: `lib/planner/engine.ts`
- Test: `lib/planner/engine.test.ts` (extend)

**Interfaces:**
- Produces: `function buildPlan(input: PlanInput): PlanResult` (canonical signature). This task implements allocation steps 2-4; step 1 (deadlines) lands in Task 11 and funding gaps in Task 12.
- Consumes: `convert` (P1), `formatMoney`/`CURRENCIES` (P1), `addPeriods`/`periodsBetween` (P6/Task 2), types (Task 7).

**Steps:**

- [ ] Add the shared fixture and failing tests to `lib/planner/engine.test.ts`:

```ts
import { buildPlan } from './engine'
import type { PlanInput } from './types'
import type { Rates } from '@/lib/currency/rates'

const rates: Rates = { base: 'USD', rates: { USD: 1, EUR: 0.9, EGP: 50 }, fetchedAt: '2026-08-01T00:00:00Z' }

function mkInput(overrides: Partial<PlanInput>): PlanInput {
  return {
    homeCurrency: 'EUR',
    rates,
    horizonMonths: 12,
    startPeriod: '2026-08',
    monthlyIncomeMinor: {},
    billsMinor: {},
    installments: [],
    variableSpendMinor: {},
    spendEstimateSource: 'baseline',
    debts: [],
    wishlist: [],
    accountBalancesMinor: {},
    ...overrides,
  }
}

describe('buildPlan: zero debts', () => {
  it('reports surplus, no payments, all leftover unallocated', () => {
    const plan = buildPlan(
      mkInput({
        monthlyIncomeMinor: { EUR: 200000 },
        variableSpendMinor: { EUR: 100000 },
        accountBalancesMinor: { EUR: 1000000 },
      }),
    )
    // surplus = 200000 - 100000 = 100000 every month
    expect(plan.months).toHaveLength(12)
    expect(plan.surplusMinorByMonth['2026-08']).toBe(100000)
    expect(plan.months[0].debtPayments).toEqual([])
    expect(plan.months[0].unallocatedMinor).toBe(100000)
    expect(plan.months[0].fundingGaps).toEqual([])
    expect(plan.debtPayoffPeriod).toEqual({})
  })
})

describe('buildPlan: avalanche ordering and payoff months', () => {
  // Surplus: income 300000 - bills 50000 - variable 100000 = 150000/month.
  // Debt A: 200000 @ 20% apr (monthly 20/1200 = 1/60), debt B: 100000 @ 10% apr (monthly 1/120).
  //
  // 2026-08: A: 200000 + 3333 (200000/60 = 3333.33 -> 3333) = 203333; pay 150000 -> 53333
  //          B: 100000 + 833 (100000/120 = 833.33 -> 833) = 100833; untouched
  // 2026-09: A: 53333 + 889 (53333/60 = 888.88 -> 889) = 54222; pay 54222 -> 0 (payoff)
  //          B: 100833 + 840 (100833/120 = 840.275 -> 840) = 101673; pay 150000 - 54222 = 95778 -> 5895
  // 2026-10: B: 5895 + 49 (5895/120 = 49.125 -> 49) = 5944; pay 5944 -> 0 (payoff); leftover 144056
  const plan = buildPlan(
    mkInput({
      monthlyIncomeMinor: { EUR: 300000 },
      billsMinor: { EUR: 50000 },
      variableSpendMinor: { EUR: 100000 },
      accountBalancesMinor: { EUR: 500000 },
      debts: [
        { id: 'A', name: 'Card', balanceMinor: 200000, currency: 'EUR', apr: 20 },
        { id: 'B', name: 'Friend', balanceMinor: 100000, currency: 'EUR', apr: 10 },
      ],
    }),
  )

  it('pays the highest APR debt first', () => {
    expect(plan.months[0].debtPayments).toEqual([{ debtId: 'A', amountMinor: 150000, currency: 'EUR' }])
  })
  it('clears A then overflows into B in the same month', () => {
    expect(plan.months[1].debtPayments).toEqual([
      { debtId: 'A', amountMinor: 54222, currency: 'EUR' },
      { debtId: 'B', amountMinor: 95778, currency: 'EUR' },
    ])
  })
  it('reports payoff periods', () => {
    expect(plan.months[2].debtPayments).toEqual([{ debtId: 'B', amountMinor: 5944, currency: 'EUR' }])
    expect(plan.debtPayoffPeriod).toEqual({ A: '2026-09', B: '2026-10' })
  })
  it('releases post-debt surplus as unallocated', () => {
    expect(plan.months[2].unallocatedMinor).toBe(144056) // 150000 - 5944
    expect(plan.months[3].unallocatedMinor).toBe(150000)
  })
})

describe('buildPlan: minimum payments come before avalanche', () => {
  // Surplus = 20000. Debt M: 100000 @ 5% with min 5000; debt H: 50000 @ 30%.
  // 2026-08: M: 100000 + 417 (100000*5/1200 = 416.67 -> 417) = 100417; minimum 5000 -> 95417
  //          H: 50000 + 1250 (50000*30/1200 = 1250) = 51250; avalanche remainder 15000 -> 36250
  it('pays defined minimums, then avalanches the rest into the highest APR', () => {
    const plan = buildPlan(
      mkInput({
        monthlyIncomeMinor: { EUR: 20000 },
        accountBalancesMinor: { EUR: 500000 },
        debts: [
          { id: 'M', name: 'Loan', balanceMinor: 100000, currency: 'EUR', apr: 5, minPaymentMinor: 5000 },
          { id: 'H', name: 'Card', balanceMinor: 50000, currency: 'EUR', apr: 30 },
        ],
      }),
    )
    expect(plan.months[0].debtPayments).toEqual([
      { debtId: 'M', amountMinor: 5000, currency: 'EUR' },
      { debtId: 'H', amountMinor: 15000, currency: 'EUR' },
    ])
    expect(plan.months[0].unallocatedMinor).toBe(0)
  })
})

describe('buildPlan: debt not cleared within the horizon', () => {
  it('reports null payoff', () => {
    const plan = buildPlan(
      mkInput({
        horizonMonths: 6,
        monthlyIncomeMinor: { EUR: 100000 },
        accountBalancesMinor: { EUR: 10000000 },
        debts: [{ id: 'Z', name: 'Big', balanceMinor: 10000000, currency: 'EUR', apr: 0 }],
      }),
    )
    expect(plan.debtPayoffPeriod).toEqual({ Z: null })
    expect(plan.months[5].debtPayments).toEqual([{ debtId: 'Z', amountMinor: 100000, currency: 'EUR' }])
  })
})
```

- [ ] Run: `npx vitest run lib/planner/engine.test.ts` - expect FAIL: `buildPlan` is not exported.
- [ ] Implement `buildPlan` in `lib/planner/engine.ts` (steps 2-4 real; step 1 and gaps are marked slots filled by Tasks 11-12):

```ts
import { CURRENCIES, formatMoney, type Currency } from '@/lib/money/money'
import { convert } from '@/lib/currency/convert'
import { addPeriods, periodsBetween } from '@/lib/dates/cairo'
import type { MonthPlan, PlanInput, PlanResult } from './types'

export function buildPlan(input: PlanInput): PlanResult {
  const home = input.homeCurrency
  const toHome = (amountMinor: number, c: Currency) => (c === home ? amountMinor : convert(amountMinor, c, home, input.rates))
  const fromHome = (amountMinor: number, c: Currency) => (c === home ? amountMinor : convert(amountMinor, home, c, input.rates))

  const debts = input.debts.map((d) => ({ ...d, balance: d.balanceMinor }))
  const balances = Object.fromEntries(CURRENCIES.map((c) => [c, input.accountBalancesMinor[c] ?? 0])) as Record<Currency, number>

  const months: MonthPlan[] = []
  const debtPayoffPeriod: Record<string, string | null> = Object.fromEntries(input.debts.map((d) => [d.id, null]))
  const wishlistAffordablePeriod: Record<string, string | null> = Object.fromEntries(input.wishlist.map((w) => [w.id, null]))
  const surplusMinorByMonth: Record<string, number> = {}

  for (let i = 0; i < input.horizonMonths; i++) {
    const period = addPeriods(input.startPeriod, i)
    const installmentsDue = input.installments.filter((inst) => i < inst.remainingCount)

    // surplus = guaranteed income - bills - installment obligations - variable spend estimate (home currency)
    let surplus = 0
    for (const c of CURRENCIES) {
      surplus += toHome(input.monthlyIncomeMinor[c] ?? 0, c)
      surplus -= toHome(input.billsMinor[c] ?? 0, c)
      surplus -= toHome(input.variableSpendMinor[c] ?? 0, c)
    }
    for (const inst of installmentsDue) surplus -= toHome(inst.monthlyMinor, inst.currency)
    surplusMinorByMonth[period] = surplus

    const debtPayments: MonthPlan['debtPayments'] = []
    let available = surplus
    const pay = (d: (typeof debts)[number], amountMinor: number) => {
      if (amountMinor <= 0) return
      d.balance -= amountMinor
      available -= toHome(amountMinor, d.currency)
      const existing = debtPayments.find((p) => p.debtId === d.id)
      if (existing) existing.amountMinor += amountMinor
      else debtPayments.push({ debtId: d.id, amountMinor, currency: d.currency })
      if (d.balance <= 0 && debtPayoffPeriod[d.id] === null) debtPayoffPeriod[d.id] = period
    }

    // --- (1) deadline-required just-in-time payments: Task 11 ---

    // (2) minimum payments on ASAP debts that define one (obligations: paid even past surplus)
    for (const d of debts) {
      if (d.balance <= 0 || d.deadline || !d.minPaymentMinor) continue
      d.balance += interestOn(d.balance, d.apr)
      pay(d, Math.min(d.minPaymentMinor, d.balance))
    }

    // (3) accrue interest on the remaining open ASAP debts, then avalanche by APR descending
    for (const d of debts) {
      if (d.balance <= 0 || d.deadline || d.minPaymentMinor) continue // min-payment debts accrued in (2)
      d.balance += interestOn(d.balance, d.apr)
    }
    const asap = debts
      .filter((d) => d.balance > 0 && !d.deadline)
      .sort((a, b) => b.apr - a.apr || a.id.localeCompare(b.id))
    for (const d of asap) {
      if (available <= 0) break
      pay(d, Math.min(d.balance, fromHome(available, d.currency)))
    }

    // (4) leftover = deadline slack + post-debt surplus; P8 draws wishlist funding from this
    const unallocatedMinor = Math.max(0, available)

    // --- wishlist funding: filled by P8 ---
    const wishlistFunding: MonthPlan['wishlistFunding'] = []

    // --- (5) currency-aware funding gaps + balance roll-forward: Task 12 ---
    const fundingGaps: MonthPlan['fundingGaps'] = []

    months.push({ period, debtPayments, wishlistFunding, fundingGaps, unallocatedMinor })
  }

  return {
    months,
    debtPayoffPeriod,
    wishlistAffordablePeriod,
    surplusMinorByMonth,
    spendEstimateSource: input.spendEstimateSource,
    highAprInstallmentFlags: input.installments.filter((inst) => (inst.apr ?? 0) >= 15).map((inst) => inst.name),
  }
}
```

  Note: cross-currency avalanche converts `available` (home) into the debt currency and back; `convert` rounds half-up each way, so `available` can land at -1 minor unit, which `Math.max(0, available)` absorbs.
- [ ] Run: `npx vitest run lib/planner/engine.test.ts` - expect PASS (all Task 8 + Task 10 tests).
- [ ] Commit: `git add lib/planner/engine.ts lib/planner/engine.test.ts && git commit -m "P7: planner engine core (surplus, minimums, avalanche, payoff)"`

---

### Task 11: engine - deadline just-in-time payments and deadline slack

**Files:**
- Modify: `lib/planner/engine.ts`
- Test: `lib/planner/engine.test.ts` (extend)

**Interfaces:**
- Produces: allocation step 1 inside `buildPlan`; deadlined debts are paid the minimum level amount that still clears balance plus `apr/12` interest by the deadline period, releasing deadline slack into `unallocatedMinor`.

**Steps:**

- [ ] Add failing tests:

```ts
describe('buildPlan: deadline just-in-time payments release slack', () => {
  // Surplus = 200000 - 100000 = 100000/month.
  // Debt D: 30000 @ 12% apr (1%/month), deadline 2026-10-15 -> deadline period 2026-10, 3 payments.
  // Level payment: 30000*0.01 / (1 - 1.01^-3) = 300 / 0.0294099 = 10200.66 -> ceil 10201.
  // 2026-08: jit(30000, 12, 3) = 10201; accrue 300 -> 30300; pay 10201 -> 20099; slack 100000 - 10201 = 89799
  // 2026-09: jit(20099, 12, 2) = ceil(200.99 / 0.0197040) = ceil(10200.49) = 10201; accrue 201 -> 20300; pay 10201 -> 10099
  // 2026-10: jit(10099, 12, 1) = ceil(10099 * 1.01) = ceil(10199.99) = 10200; accrue 101 -> 10200; pay 10200 -> 0
  const plan = buildPlan(
    mkInput({
      monthlyIncomeMinor: { EUR: 200000 },
      variableSpendMinor: { EUR: 100000 },
      accountBalancesMinor: { EUR: 1000000 },
      debts: [{ id: 'D', name: 'Family', balanceMinor: 30000, currency: 'EUR', apr: 12, deadline: '2026-10-15' }],
    }),
  )

  it('pays just enough to clear balance plus apr/12 interest by the deadline', () => {
    expect(plan.months[0].debtPayments).toEqual([{ debtId: 'D', amountMinor: 10201, currency: 'EUR' }])
    expect(plan.months[1].debtPayments).toEqual([{ debtId: 'D', amountMinor: 10201, currency: 'EUR' }])
    expect(plan.months[2].debtPayments).toEqual([{ debtId: 'D', amountMinor: 10200, currency: 'EUR' }])
    expect(plan.debtPayoffPeriod).toEqual({ D: '2026-10' })
  })
  it('releases the deadline slack instead of avalanching the deadlined debt', () => {
    expect(plan.months[0].unallocatedMinor).toBe(89799)
    expect(plan.months[2].unallocatedMinor).toBe(89800) // 100000 - 10200
    expect(plan.months[3].unallocatedMinor).toBe(100000) // debt gone
  })
})
```

- [ ] Run: `npx vitest run lib/planner/engine.test.ts` - expect FAIL: month 0 has no debt payment for D.
- [ ] Replace the `// --- (1) deadline-required just-in-time payments: Task 11 ---` line in `buildPlan` with:

```ts
    // (1) deadline-required just-in-time payments (obligations: scheduled even past surplus).
    // jit is recomputed each month from the live balance, so actual-payment drift self-corrects.
    for (const d of debts) {
      if (d.balance <= 0 || !d.deadline) continue
      const n = Math.max(1, periodsBetween(period, d.deadline.slice(0, 7)) + 1) // past-deadline debts pay off now
      const jit = jitPayment(d.balance, d.apr, n)
      d.balance += interestOn(d.balance, d.apr)
      pay(d, Math.min(Math.max(jit, d.minPaymentMinor ?? 0), d.balance))
    }
```

- [ ] Run: `npx vitest run lib/planner/engine.test.ts` - expect PASS.
- [ ] Commit: `git add lib/planner/engine.ts lib/planner/engine.test.ts && git commit -m "P7: deadline just-in-time payments + deadline slack"`

---

### Task 12: engine - currency-aware funding gaps, flags, passthroughs

**Files:**
- Modify: `lib/planner/engine.ts`
- Test: `lib/planner/engine.test.ts` (extend)

**Interfaces:**
- Produces: `MonthPlan.fundingGaps` per month: obligations plus planned payments grouped by currency against projected per-currency balances (seeded from `accountBalancesMinor`, rolled forward), with live-rate transfer suggestions; `highAprInstallmentFlags` and `spendEstimateSource` verified.

**Steps:**

- [ ] Add failing tests:

```ts
describe('buildPlan: currency-aware funding gaps', () => {
  // Home EUR. 1 EGP minor = 0.9/50 = 0.018 EUR minor at the fixture rates.
  // Accounts: EUR 500000, EGP 100000. Income EUR 200000/month. Bills EGP 600000/month.
  // 2026-08: EGP 100000 + 0 - 600000 = -500000 -> gap 500000; 500000 * 0.018 = 9000 -> "€90.00"
  //          EUR 500000 + 200000 = 700000; applying the suggested transfer -> 691000, EGP -> 0
  // 2026-09: EGP 0 - 600000 = -600000 -> gap 600000; 600000 * 0.018 = 10800 -> "€108.00"
  const plan = buildPlan(
    mkInput({
      monthlyIncomeMinor: { EUR: 200000 },
      billsMinor: { EGP: 600000 },
      accountBalancesMinor: { EUR: 500000, EGP: 100000 },
    }),
  )

  it('detects the gap and suggests a live-rate transfer', () => {
    expect(plan.months[0].fundingGaps).toEqual([
      { currency: 'EGP', shortfallMinor: 500000, suggestion: 'Transfer ~ €90.00 into EGP' },
    ])
  })
  it('rolls projected balances forward as if the suggested transfer happened', () => {
    expect(plan.months[1].fundingGaps).toEqual([
      { currency: 'EGP', shortfallMinor: 600000, suggestion: 'Transfer ~ €108.00 into EGP' },
    ])
  })
  it('computes surplus in home currency at live rates', () => {
    // 200000 - convert(600000 EGP) = 200000 - 10800 = 189200
    expect(plan.surplusMinorByMonth['2026-08']).toBe(189200)
    expect(plan.months[0].unallocatedMinor).toBe(189200)
  })
})

describe('buildPlan: flags and passthroughs', () => {
  it('flags installments with apr >= 15 and echoes the spend estimate source', () => {
    const plan = buildPlan(
      mkInput({
        spendEstimateSource: 'blend',
        monthlyIncomeMinor: { EUR: 200000 },
        accountBalancesMinor: { EUR: 1000000 },
        installments: [
          { name: 'Phone', monthlyMinor: 50000, currency: 'EUR', remainingCount: 4, apr: 24 },
          { name: 'Fridge', monthlyMinor: 30000, currency: 'EUR', remainingCount: 2, apr: 14.9 },
          { name: 'Couch', monthlyMinor: 20000, currency: 'EUR', remainingCount: 2 },
        ],
      }),
    )
    expect(plan.highAprInstallmentFlags).toEqual(['Phone'])
    expect(plan.spendEstimateSource).toBe('blend')
  })
  it('drops installment obligations from surplus after remainingCount months', () => {
    const plan = buildPlan(
      mkInput({
        monthlyIncomeMinor: { EUR: 100000 },
        accountBalancesMinor: { EUR: 1000000 },
        installments: [{ name: 'Phone', monthlyMinor: 50000, currency: 'EUR', remainingCount: 2 }],
      }),
    )
    expect(plan.surplusMinorByMonth['2026-08']).toBe(50000)
    expect(plan.surplusMinorByMonth['2026-09']).toBe(50000)
    expect(plan.surplusMinorByMonth['2026-10']).toBe(100000)
  })
})
```

- [ ] Run: `npx vitest run lib/planner/engine.test.ts` - expect FAIL: `months[0].fundingGaps` is `[]`.
- [ ] Replace the `// --- (5) ... Task 12 ---` slot (the line and the `const fundingGaps` placeholder under it) with:

```ts
    // (5) currency-aware funding gaps: group this month's obligations + planned payments by
    // currency against projected balances, then roll balances forward
    const outflow = Object.fromEntries(CURRENCIES.map((c) => [c, 0])) as Record<Currency, number>
    for (const c of CURRENCIES) outflow[c] += (input.billsMinor[c] ?? 0) + (input.variableSpendMinor[c] ?? 0)
    for (const inst of installmentsDue) outflow[inst.currency] += inst.monthlyMinor
    for (const p of debtPayments) outflow[p.currency] += p.amountMinor

    const end = { ...balances }
    for (const c of CURRENCIES) end[c] += (input.monthlyIncomeMinor[c] ?? 0) - outflow[c]

    const fundingGaps: MonthPlan['fundingGaps'] = []
    for (const c of CURRENCIES) {
      if (end[c] >= 0) continue
      const shortfallMinor = -end[c]
      const source = CURRENCIES.filter((s) => s !== c && end[s] > 0).sort((a, b) => toHome(end[b], b) - toHome(end[a], a))[0]
      if (source) {
        const transferMinor = convert(shortfallMinor, c, source, input.rates)
        fundingGaps.push({
          currency: c,
          shortfallMinor,
          suggestion: `Transfer ~ ${formatMoney({ amountMinor: transferMinor, currency: source })} into ${c}`,
        })
        // apply the suggested transfer to the projection so later months stay consistent
        end[source] -= transferMinor
        end[c] = 0
      } else {
        fundingGaps.push({
          currency: c,
          shortfallMinor,
          suggestion: `No other currency can cover ${formatMoney({ amountMinor: shortfallMinor, currency: c })}`,
        })
      }
    }

    // --- wishlist affordability gaps: filled by P8 ---

    for (const c of CURRENCIES) balances[c] = end[c]
```

- [ ] Run: `npx vitest run lib/planner/engine.test.ts` - expect PASS (all engine tests green).
- [ ] Run: `npx vitest run` - expect the whole suite green.
- [ ] Commit: `git add lib/planner/engine.ts lib/planner/engine.test.ts && git commit -m "P7: currency-aware funding gaps + high-APR flags"`

---

### Task 13: plan input assembler

I/O-only glue: every pure piece it delegates to is already unit-tested; this module is exercised end to end by Task 15's Playwright flow.

**Files:**
- Create: `lib/planner/input.ts`

**Interfaces:**
- Produces: `async function buildPlanInput(userId: string): Promise<PlanInput>`.
- Consumes: `settings`, `incomeSources`, `bills`, `installments`, `flexibleDebts`, `accounts` schema; `getRates` (P1); `accountBalanceMinor` (P1); `variableSpendActuals` (P6); `estimateVariableSpend` (Task 9); `debtBalanceMinor` (Task 3); `periodOf`/`todayCairo` (P1).

**Steps:**

- [ ] Create `lib/planner/input.ts`:

```ts
import { and, eq, gt, isNull } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { accountBalanceMinor } from '@/lib/db/queries'
import { accounts, bills, flexibleDebts, incomeSources, installments, settings } from '@/lib/db/schema'
import { getRates } from '@/lib/currency/rates'
import { CURRENCIES, type Currency } from '@/lib/money/money'
import { periodOf, todayCairo } from '@/lib/dates/cairo'
import { variableSpendActuals } from '@/lib/insights/variable-spend'
import { debtBalanceMinor } from '@/lib/debts/balance'
import { estimateVariableSpend, type SpendActualsRow } from './spend-estimate'
import type { PlanInput } from './types'

const HORIZON_MONTHS = 24
const ACTUALS_MONTHS_BACK = 6

function sumByCurrency(rows: { currency: string; amountMinor: number }[]): Partial<Record<Currency, number>> {
  const out: Partial<Record<Currency, number>> = {}
  for (const r of rows) out[r.currency as Currency] = (out[r.currency as Currency] ?? 0) + r.amountMinor
  return out
}

export async function buildPlanInput(userId: string): Promise<PlanInput> {
  const [settingsRow] = await db.select().from(settings).where(eq(settings.userId, userId))
  const homeCurrency = (settingsRow?.homeCurrency ?? 'EUR') as Currency
  const baseline = (settingsRow?.essentialsBaseline ?? {}) as Partial<Record<Currency, number>>

  const [rates, incomeRows, billRows, instRows, debtRows, accountRows] = await Promise.all([
    getRates(),
    db
      .select()
      .from(incomeSources)
      .where(and(eq(incomeSources.userId, userId), eq(incomeSources.active, true), eq(incomeSources.recurring, true))),
    db.select().from(bills).where(and(eq(bills.userId, userId), eq(bills.active, true))),
    db
      .select()
      .from(installments)
      .where(and(eq(installments.userId, userId), eq(installments.active, true), gt(installments.remainingCount, 0))),
    db.select().from(flexibleDebts).where(eq(flexibleDebts.userId, userId)),
    db.select().from(accounts).where(and(eq(accounts.userId, userId), isNull(accounts.archivedAt))),
  ])

  const actualsByCurrency: Partial<Record<Currency, SpendActualsRow[]>> = {}
  for (const c of CURRENCIES) actualsByCurrency[c] = await variableSpendActuals(userId, c, ACTUALS_MONTHS_BACK)
  const { variableSpendMinor, source } = estimateVariableSpend(baseline, actualsByCurrency)

  const debts: PlanInput['debts'] = []
  for (const d of debtRows) {
    const balanceMinor = await debtBalanceMinor(d.id)
    if (balanceMinor > 0) {
      debts.push({
        id: d.id,
        name: d.name,
        balanceMinor,
        currency: d.currency as Currency,
        apr: d.apr,
        deadline: d.deadline ?? undefined,
        minPaymentMinor: d.minPaymentMinor ?? undefined,
      })
    }
  }

  const accountBalancesMinor: Partial<Record<Currency, number>> = {}
  for (const a of accountRows) {
    const bal = await accountBalanceMinor(a.id)
    accountBalancesMinor[a.currency as Currency] = (accountBalancesMinor[a.currency as Currency] ?? 0) + bal
  }

  return {
    homeCurrency,
    rates,
    horizonMonths: HORIZON_MONTHS,
    startPeriod: periodOf(todayCairo()),
    monthlyIncomeMinor: sumByCurrency(incomeRows),
    billsMinor: sumByCurrency(billRows),
    installments: instRows.map((i) => ({
      name: i.name,
      monthlyMinor: i.monthlyAmountMinor,
      currency: i.currency as Currency,
      remainingCount: i.remainingCount,
      apr: i.apr ?? undefined,
    })),
    variableSpendMinor,
    spendEstimateSource: source,
    debts,
    wishlist: [], // P8 fills this from wishlist_items
    accountBalancesMinor,
  }
}
```

  If `accountBalanceMinor` lives at a different path in P1's implementation, import it from there; the signature is canonical.
- [ ] Run: `npx tsc --noEmit` - expect PASS.
- [ ] Commit: `git add lib/planner/input.ts && git commit -m "P7: plan input assembler"`

---

### Task 14: plan screen

**Files:**
- Create: `components/plan/ai-advisor-slot.tsx`
- Create: `components/plan/algorithm-suggests.tsx`
- Create: `components/plan/plan-timeline.tsx`
- Create: `app/(app)/plan/page.tsx`

**Interfaces:**
- Consumes: `buildPlanInput` (Task 13), `buildPlan` (Tasks 10-12), `formatMoney` (P1).
- Produces: the P9 slot component `AiAdvisorSlot()` - a rendered `ai_enabled=false` state ("AI advisor is off."), not a TODO; P9 swaps its body for cached advice and keeps this exact rendering for the disabled/unavailable case.

**Steps:**

- [ ] Create `components/plan/ai-advisor-slot.tsx`:

```tsx
export function AiAdvisorSlot() {
  return (
    <section aria-label="AI second opinion" className="rounded-lg border border-dashed p-4">
      <h2 className="text-sm font-medium">AI second opinion</h2>
      <p className="mt-1 text-sm text-neutral-500">AI advisor is off.</p>
    </section>
  )
}
```

- [ ] Create `components/plan/algorithm-suggests.tsx`:

```tsx
import { formatMoney } from '@/lib/money/money'
import type { MonthPlan } from '@/lib/planner/types'

export function AlgorithmSuggests({ month, debtNames }: { month: MonthPlan | undefined; debtNames: Record<string, string> }) {
  const empty = !month || (month.debtPayments.length === 0 && month.fundingGaps.length === 0)
  return (
    <section className="rounded-lg border p-4">
      <h2 className="text-sm font-medium">Algorithm suggests</h2>
      {empty ? (
        <p className="mt-1 text-sm text-neutral-500">Nothing to do this month.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {month.fundingGaps.map((g, i) => (
            <li key={`gap-${i}`} className="text-amber-700 dark:text-amber-400">
              {g.suggestion}
            </li>
          ))}
          {month.debtPayments.map((p) => (
            <li key={p.debtId}>
              Pay {formatMoney({ amountMinor: p.amountMinor, currency: p.currency })} toward {debtNames[p.debtId] ?? 'debt'}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

- [ ] Create `components/plan/plan-timeline.tsx`:

```tsx
import { formatMoney, type Currency } from '@/lib/money/money'
import type { MonthPlan } from '@/lib/planner/types'

export function PlanTimeline({
  months,
  debtNames,
  homeCurrency,
}: {
  months: MonthPlan[]
  debtNames: Record<string, string>
  homeCurrency: Currency
}) {
  const shown = months.filter((m) => m.debtPayments.length > 0 || m.fundingGaps.length > 0).slice(0, 12)
  if (shown.length === 0) {
    return <p className="text-sm text-neutral-500">No planned payments. Surplus flows to the wishlist (next phase).</p>
  }
  return (
    <ol className="space-y-3">
      {shown.map((m) => (
        <li key={m.period} className="rounded-lg border p-3">
          <p className="text-sm font-medium">{m.period}</p>
          {m.fundingGaps.map((g, i) => (
            <p key={i} className="mt-1 rounded bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              {g.suggestion}
            </p>
          ))}
          <ul className="mt-1 space-y-1 text-sm">
            {m.debtPayments.map((p) => (
              <li key={p.debtId} className="flex justify-between">
                <span>{debtNames[p.debtId] ?? 'Debt'}</span>
                <span className="tabular-nums">{formatMoney({ amountMinor: p.amountMinor, currency: p.currency })}</span>
              </li>
            ))}
          </ul>
          {m.unallocatedMinor > 0 && (
            <p className="mt-1 text-xs text-neutral-500">
              Unallocated: {formatMoney({ amountMinor: m.unallocatedMinor, currency: homeCurrency })}
            </p>
          )}
        </li>
      ))}
    </ol>
  )
}
```

- [ ] Create `app/(app)/plan/page.tsx`:

```tsx
import { requireUser } from '@/lib/auth/stack'
import { buildPlanInput } from '@/lib/planner/input'
import { buildPlan } from '@/lib/planner/engine'
import { AiAdvisorSlot } from '@/components/plan/ai-advisor-slot'
import { AlgorithmSuggests } from '@/components/plan/algorithm-suggests'
import { PlanTimeline } from '@/components/plan/plan-timeline'

export default async function PlanPage() {
  const user = await requireUser()
  const input = await buildPlanInput(user.id)
  const plan = buildPlan(input)
  const debtNames = Object.fromEntries(input.debts.map((d) => [d.id, d.name]))

  return (
    <main className="mx-auto max-w-md space-y-4 p-4">
      <h1 className="text-xl font-semibold">Plan</h1>
      <p className="text-xs text-neutral-500">
        Spend estimate: {plan.spendEstimateSource === 'blend' ? 'trailing 3-month blend' : 'essentials baseline'}
      </p>
      {plan.highAprInstallmentFlags.length > 0 && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
          High-APR installments: {plan.highAprInstallmentFlags.join(', ')}. Fixed obligations, but worth renegotiating.
        </p>
      )}
      <AlgorithmSuggests month={plan.months[0]} debtNames={debtNames} />
      <AiAdvisorSlot />
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Debt payoff</h2>
        {input.debts.length === 0 ? (
          <p className="text-sm text-neutral-500">No flexible debts. Add one from the Debts tab.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {input.debts.map((d) => (
              <li key={d.id} className="flex items-center justify-between p-3 text-sm">
                <span>{d.name}</span>
                <span className="rounded-full bg-neutral-100 px-2 py-1 text-xs dark:bg-neutral-800">
                  {plan.debtPayoffPeriod[d.id] ? `Paid off ${plan.debtPayoffPeriod[d.id]}` : `Beyond ${input.horizonMonths} months`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <PlanTimeline months={plan.months} debtNames={debtNames} homeCurrency={input.homeCurrency} />
    </main>
  )
}
```

- [ ] Run: `npx tsc --noEmit` - expect PASS.
- [ ] Run: `npm run dev`, open `/plan` on a mobile viewport - timeline, payoff badges, funding-gap callouts, and the "AI advisor is off." slot all render; with no debts the empty states show.
- [ ] Commit: `git add components/plan "app/(app)/plan/page.tsx" && git commit -m "P7: plan screen (timeline, badges, gap callouts, AI slot)"`

---

### Task 15: Playwright flow

**Files:**
- Create: `e2e/debts-plan.spec.ts`

**Interfaces:**
- Consumes: P0 Playwright setup; an EUR account with a positive balance from earlier E2E setup.

**Steps:**

- [ ] Create `e2e/debts-plan.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

test('debt lifecycle and plan screen', async ({ page }) => {
  // create a debt with APR and deadline
  await page.goto('/debts/new')
  await page.getByLabel('Name').fill('Family loan')
  await page.getByLabel('Original amount').fill('300.00')
  await page.getByLabel(/APR/).fill('12')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Family loan')).toBeVisible()
  await expect(page.getByText('€300.00')).toBeVisible()

  // record a payment from the same-currency account (selector defaults when only one matches)
  await page.getByRole('button', { name: 'Pay' }).click()
  await page.getByLabel('Amount').fill('100.00')
  await page.getByRole('button', { name: 'Record payment' }).click()
  await expect(page.getByText('€200.00')).toBeVisible()

  // plan screen: algorithm panel, AI slot in disabled state, payoff badge
  await page.goto('/plan')
  await expect(page.getByText('Algorithm suggests')).toBeVisible()
  await expect(page.getByText('AI advisor is off.')).toBeVisible()
  await expect(page.getByText('Family loan')).toBeVisible()
  await expect(page.getByText(/Paid off \d{4}-\d{2}|Beyond 24 months/)).toBeVisible()

  // reverse the payment from the detail page
  await page.getByRole('link', { name: 'Family loan' }).first().click()
  await page.getByRole('button', { name: 'Reverse' }).click()
  await page.goto('/debts')
  await expect(page.getByText('€300.00')).toBeVisible()
})
```

- [ ] Run: `npx playwright test e2e/debts-plan.spec.ts` - expect PASS (fix selectors only if labels differ).
- [ ] Run: `npx vitest run` - expect the full unit suite green.
- [ ] Commit: `git add e2e/debts-plan.spec.ts && git commit -m "P7: debts + plan Playwright flow"`

---

**Phase gate:** `npx vitest run` green (including every engine table case), `npx playwright test e2e/debts-plan.spec.ts` green, manual mobile-viewport walkthrough of `/debts` and `/plan`.

Backlinks: [Plans index](../plans/README.md) | [Design spec](../specs/2026-07-07-my-ledger-design.md) | [Planner ADR](../../adr/2026-07-07-debt-first-deadline-aware-planner.md) | Previous: [06-expenses-and-insights.md](06-expenses-and-insights.md) | Next: [08-wishlist.md](08-wishlist.md)
