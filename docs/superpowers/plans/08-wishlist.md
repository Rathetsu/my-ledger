# Phase 08: Wishlist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

Backlinks: [Plans index](../plans/README.md) | [Design spec](../specs/2026-07-07-my-ledger-design.md) | Previous: [07-debts-and-planner.md](07-debts-and-planner.md) | Next: [09-ai-advisor.md](09-ai-advisor.md)

**Goal:** Wishlist items (table, CRUD, purchase and un-purchase flows) and the planner extension: `buildPlan` funds wishlist items from each month's unallocated leftover (deadline slack + post-debt surplus), target-dated items first, then by priority, filling `MonthPlan.wishlistFunding` and `PlanResult.wishlistAffordablePeriod`; the wishlist screen shows affordability badges from the plan.

**Architecture:** Wishlist items are definitions; buying one posts a single `purchase` transaction (source-linked, reversible only through the owning flow) and flips `status='purchased'` in one DB transaction. The planner extension is pure: it consumes `MonthPlan.unallocatedMinor` from P7's engine (funding never touches the debt allocation above it) and stays strictly debt-first per the [planner ADR](../../adr/2026-07-07-debt-first-deadline-aware-planner.md).

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

- P2 stores outflows as negative `amount_minor`; purchases insert `-cost_minor`.
- Shortfall warnings are advisory, never blocking: balances may go negative (spec §3, §5.8). The warning lives in the UI; the server action never checks balances.
- `MonthPlan.unallocatedMinor` keeps its P7 meaning (leftover before wishlist funding); `wishlistFunding` shows where it went. Funding is saving, not spending, so it never enters the funding-gap outflow; instead, the month an item becomes affordable, the engine checks the item's currency actually holds the cash and emits an advisory transfer suggestion if not.
- Priority is an int where lower = more important (1 is highest). Target-dated items outrank priority while their target is still ahead.

---

### Task 1: wishlist_items table and migration

**Files:**
- Modify: `lib/db/schema.ts`
- Create: generated migration under `drizzle/` (via drizzle-kit)

**Interfaces:**
- Produces: `wishlistItems` Drizzle table export per spec §4 `wishlist_items(id, user_id, name, cost_minor, currency, priority, target_date?, status ∈ {planned, purchased}, transaction_id?)`.

**Steps:**

- [ ] Append to `lib/db/schema.ts` (reuse P1's currency and money column helpers if they exist):

```ts
export const wishlistItems = pgTable('wishlist_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  costMinor: bigint('cost_minor', { mode: 'number' }).notNull(),
  currency: text('currency', { enum: ['EUR', 'USD', 'EGP'] }).notNull(),
  priority: integer('priority').notNull().default(3),
  targetDate: date('target_date'),
  status: text('status', { enum: ['planned', 'purchased'] }).notNull().default('planned'),
  transactionId: uuid('transaction_id'),
})
```

- [ ] Run: `npx drizzle-kit generate --name p8-wishlist-items` - expect a new SQL file containing `CREATE TABLE "wishlist_items"`.
- [ ] Run: `npx drizzle-kit migrate` - expect clean apply.
- [ ] Run: `npx tsc --noEmit` - expect PASS.
- [ ] Commit: `git add lib/db/schema.ts drizzle && git commit -m "P8: wishlist_items table + migration"`

---

### Task 2: wishlist CRUD actions

**Files:**
- Create: `lib/actions/wishlist.ts`
- Test: `lib/actions/wishlist.test.ts`

**Interfaces:**
- Produces: `wishlistItemSchema` (zod), server actions `createWishlistItem(raw: unknown)`, `updateWishlistItem(raw: unknown)`, `deleteWishlistItem(raw: unknown)`.
- Consumes: `requireUser`, `db`, `wishlistItems` (Task 1).

**Steps:**

- [ ] Write failing test `lib/actions/wishlist.test.ts`:

```ts
import { wishlistItemSchema } from './wishlist'

describe('wishlistItemSchema', () => {
  it('accepts a full item', () => {
    expect(
      wishlistItemSchema.parse({
        name: 'Desk chair',
        costMinor: 250000,
        currency: 'EUR',
        priority: 1,
        targetDate: '2026-12-01',
      }),
    ).toMatchObject({ name: 'Desk chair', priority: 1 })
  })
  it('defaults priority to 3 and allows omitting targetDate', () => {
    expect(wishlistItemSchema.parse({ name: 'Phone', costMinor: 500000, currency: 'EGP' })).toMatchObject({ priority: 3 })
  })
  it('rejects zero cost and out-of-range priority', () => {
    expect(() => wishlistItemSchema.parse({ name: 'X', costMinor: 0, currency: 'EUR' })).toThrow()
    expect(() => wishlistItemSchema.parse({ name: 'X', costMinor: 100, currency: 'EUR', priority: 0 })).toThrow()
  })
})
```

- [ ] Run: `npx vitest run lib/actions/wishlist.test.ts` - expect FAIL: module not found.
- [ ] Implement `lib/actions/wishlist.ts`:

```ts
'use server'

import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db/client'
import { wishlistItems } from '@/lib/db/schema'
import { requireUser } from '@/lib/auth/stack'

export const wishlistItemSchema = z.object({
  name: z.string().trim().min(1).max(80),
  costMinor: z.number().int().positive(),
  currency: z.enum(['EUR', 'USD', 'EGP']),
  priority: z.number().int().min(1).max(9).default(3),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

const idSchema = z.object({ id: z.string().uuid() })

function revalidateWishlistPaths() {
  revalidatePath('/wishlist')
  revalidatePath('/plan')
}

export async function createWishlistItem(raw: unknown) {
  const data = wishlistItemSchema.parse(raw)
  const user = await requireUser()
  await db.insert(wishlistItems).values({
    userId: user.id,
    name: data.name,
    costMinor: data.costMinor,
    currency: data.currency,
    priority: data.priority,
    targetDate: data.targetDate ?? null,
  })
  revalidateWishlistPaths()
}

export async function updateWishlistItem(raw: unknown) {
  const data = wishlistItemSchema.extend({ id: z.string().uuid() }).parse(raw)
  const user = await requireUser()
  await db
    .update(wishlistItems)
    .set({
      name: data.name,
      costMinor: data.costMinor,
      priority: data.priority,
      targetDate: data.targetDate ?? null,
      // currency intentionally not editable once created; status changes only via the purchase flow
    })
    .where(and(eq(wishlistItems.id, data.id), eq(wishlistItems.userId, user.id), eq(wishlistItems.status, 'planned')))
  revalidateWishlistPaths()
}

export async function deleteWishlistItem(raw: unknown) {
  const { id } = idSchema.parse(raw)
  const user = await requireUser()
  const deleted = await db
    .delete(wishlistItems)
    .where(and(eq(wishlistItems.id, id), eq(wishlistItems.userId, user.id), eq(wishlistItems.status, 'planned')))
    .returning()
  if (deleted.length === 0) throw new Error('Purchased items must be un-purchased before deleting')
  revalidateWishlistPaths()
}
```

- [ ] Run: `npx vitest run lib/actions/wishlist.test.ts` - expect PASS.
- [ ] Commit: `git add lib/actions/wishlist.ts lib/actions/wishlist.test.ts && git commit -m "P8: wishlist CRUD actions"`

---

### Task 3: plan-input mapper (purchased items excluded)

**Files:**
- Create: `lib/planner/wishlist.ts`
- Modify: `lib/planner/input.ts` (P7)
- Test: `lib/planner/wishlist.test.ts`

**Interfaces:**
- Produces: `function activeWishlistForPlan(rows: WishlistRow[]): PlanInput['wishlist']` where `interface WishlistRow { id: string; name: string; costMinor: number; currency: string; priority: number; targetDate: string | null; status: string }`.
- Consumes: `PlanInput` (P7 types); `buildPlanInput` (P7) gains the wishlist query.

**Steps:**

- [ ] Write failing test `lib/planner/wishlist.test.ts`:

```ts
import { activeWishlistForPlan } from './wishlist'

describe('activeWishlistForPlan', () => {
  it('excludes purchased items and maps nullable target dates', () => {
    expect(
      activeWishlistForPlan([
        { id: 'w1', name: 'Chair', costMinor: 250000, currency: 'EUR', priority: 1, targetDate: null, status: 'planned' },
        { id: 'w2', name: 'Phone', costMinor: 500000, currency: 'EGP', priority: 2, targetDate: '2026-12-01', status: 'purchased' },
        { id: 'w3', name: 'Desk', costMinor: 90000, currency: 'EUR', priority: 3, targetDate: '2026-10-15', status: 'planned' },
      ]),
    ).toEqual([
      { id: 'w1', name: 'Chair', costMinor: 250000, currency: 'EUR', priority: 1, targetDate: undefined },
      { id: 'w3', name: 'Desk', costMinor: 90000, currency: 'EUR', priority: 3, targetDate: '2026-10-15' },
    ])
  })
})
```

- [ ] Run: `npx vitest run lib/planner/wishlist.test.ts` - expect FAIL: module not found.
- [ ] Implement `lib/planner/wishlist.ts` (own file so unit tests never import the DB client):

```ts
import type { Currency } from '@/lib/money/money'
import type { PlanInput } from './types'

export interface WishlistRow {
  id: string
  name: string
  costMinor: number
  currency: string
  priority: number
  targetDate: string | null
  status: string
}

export function activeWishlistForPlan(rows: WishlistRow[]): PlanInput['wishlist'] {
  return rows
    .filter((r) => r.status === 'planned')
    .map((r) => ({
      id: r.id,
      name: r.name,
      costMinor: r.costMinor,
      currency: r.currency as Currency,
      priority: r.priority,
      targetDate: r.targetDate ?? undefined,
    }))
}
```

- [ ] Run: `npx vitest run lib/planner/wishlist.test.ts` - expect PASS.
- [ ] Modify `lib/planner/input.ts`: add the imports, add the wishlist query to the existing `Promise.all`, and replace the placeholder.

```ts
import { wishlistItems } from '@/lib/db/schema'
import { activeWishlistForPlan } from './wishlist'
```

  Inside the `Promise.all` array, append:

```ts
    db.select().from(wishlistItems).where(eq(wishlistItems.userId, userId)),
```

  (destructure it as `wishlistRows` alongside the existing results), then replace

```ts
    wishlist: [], // P8 fills this from wishlist_items
```

  with

```ts
    wishlist: activeWishlistForPlan(wishlistRows),
```

- [ ] Run: `npx tsc --noEmit` - expect PASS.
- [ ] Commit: `git add lib/planner/wishlist.ts lib/planner/wishlist.test.ts lib/planner/input.ts && git commit -m "P8: wishlist plan-input mapper, purchased items excluded"`

---

### Task 4: engine extension - wishlist funding from unallocated leftover

Funds come only from `unallocatedMinor` (deadline slack + post-debt surplus, home currency). Target-dated items are funded level amounts that make them affordable by their target date; the rest goes to items by priority, greedily to completion. All P7 engine tests must stay green (they all pass `wishlist: []`).

**Files:**
- Modify: `lib/planner/engine.ts` (P7)
- Test: `lib/planner/engine.wishlist.test.ts`

**Interfaces:**
- Produces: `MonthPlan.wishlistFunding` entries `{ itemId, amountMinor, currency }` (item currency) and `PlanResult.wishlistAffordablePeriod` (itemId to "YYYY-MM" or null within the horizon).
- Consumes: `buildPlan` internals from P7 - `unallocatedMinor`, `toHome`/`fromHome`, `periodsBetween` (P7 Task 2), `wishlistAffordablePeriod` (already initialized to nulls in P7 Task 10).

**Steps:**

- [ ] Create `lib/planner/engine.wishlist.test.ts` with failing tests:

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

describe('buildPlan: wishlist affordability month math', () => {
  // Unallocated = income 200000 - variable 100000 = 100000/month (no debts).
  // Item W1 costs 250000 EUR:
  // 2026-08: fund 100000 (total 100000)
  // 2026-09: fund 100000 (total 200000)
  // 2026-10: fund 250000 - 200000 = 50000 (total 250000 -> affordable)
  const plan = buildPlan(
    mkInput({
      monthlyIncomeMinor: { EUR: 200000 },
      variableSpendMinor: { EUR: 100000 },
      accountBalancesMinor: { EUR: 1000000 },
      wishlist: [{ id: 'W1', name: 'Chair', costMinor: 250000, currency: 'EUR', priority: 1 }],
    }),
  )

  it('funds monthly and reports the affordability month', () => {
    expect(plan.months[0].wishlistFunding).toEqual([{ itemId: 'W1', amountMinor: 100000, currency: 'EUR' }])
    expect(plan.months[1].wishlistFunding).toEqual([{ itemId: 'W1', amountMinor: 100000, currency: 'EUR' }])
    expect(plan.months[2].wishlistFunding).toEqual([{ itemId: 'W1', amountMinor: 50000, currency: 'EUR' }])
    expect(plan.wishlistAffordablePeriod).toEqual({ W1: '2026-10' })
  })
  it('stops funding a fully funded item and keeps unallocatedMinor pre-wishlist', () => {
    expect(plan.months[3].wishlistFunding).toEqual([])
    expect(plan.months[0].unallocatedMinor).toBe(100000) // funding draws from it, meaning unchanged
  })
})

describe('buildPlan: target-dated item jumps the priority queue', () => {
  // Unallocated = 150000/month.
  // Item T: 300000 EUR, target 2026-10-01 (3 periods incl. start), priority 5.
  // Item P: 100000 EUR, priority 1, no target.
  // 2026-08: T needs ceil(300000/3) = 100000 first; P gets the remaining 50000
  // 2026-09: T needs ceil(200000/2) = 100000; P gets 50000 (total 100000 -> affordable 2026-09)
  // 2026-10: T needs ceil(100000/1) = 100000 (total 300000 -> affordable 2026-10, on target)
  const plan = buildPlan(
    mkInput({
      monthlyIncomeMinor: { EUR: 150000 },
      accountBalancesMinor: { EUR: 2000000 },
      wishlist: [
        { id: 'T', name: 'Laptop', costMinor: 300000, currency: 'EUR', priority: 5, targetDate: '2026-10-01' },
        { id: 'P', name: 'Chair', costMinor: 100000, currency: 'EUR', priority: 1 },
      ],
    }),
  )

  it('funds the target-dated item first despite lower priority', () => {
    expect(plan.months[0].wishlistFunding).toEqual([
      { itemId: 'T', amountMinor: 100000, currency: 'EUR' },
      { itemId: 'P', amountMinor: 50000, currency: 'EUR' },
    ])
    expect(plan.months[1].wishlistFunding).toEqual([
      { itemId: 'T', amountMinor: 100000, currency: 'EUR' },
      { itemId: 'P', amountMinor: 50000, currency: 'EUR' },
    ])
    expect(plan.months[2].wishlistFunding).toEqual([{ itemId: 'T', amountMinor: 100000, currency: 'EUR' }])
  })
  it('makes the target-dated item affordable by its target date', () => {
    expect(plan.wishlistAffordablePeriod).toEqual({ T: '2026-10', P: '2026-09' })
  })
})
```

- [ ] Run: `npx vitest run lib/planner/engine.wishlist.test.ts` - expect FAIL: `wishlistFunding` is `[]` and `wishlistAffordablePeriod` values are null.
- [ ] Modify `lib/planner/engine.ts`. First, after the `const debts = input.debts.map(...)` line, add:

```ts
  const wishlist = input.wishlist.map((w) => ({ ...w, fundedMinor: 0 }))
```

  Then replace the two P7 placeholder lines

```ts
    // --- wishlist funding: filled by P8 ---
    const wishlistFunding: MonthPlan['wishlistFunding'] = []
```

  with:

```ts
    // wishlist funding: unallocated leftover (deadline slack + post-debt surplus) funds items;
    // unallocatedMinor keeps its pre-wishlist meaning, wishlistFunding shows where it went
    const wishlistFunding: MonthPlan['wishlistFunding'] = []
    let freeMinor = unallocatedMinor // home currency
    const fund = (w: (typeof wishlist)[number], amountMinor: number) => {
      if (amountMinor <= 0) return
      w.fundedMinor += amountMinor
      freeMinor -= toHome(amountMinor, w.currency)
      wishlistFunding.push({ itemId: w.id, amountMinor, currency: w.currency })
      if (w.fundedMinor >= w.costMinor && wishlistAffordablePeriod[w.id] === null) {
        wishlistAffordablePeriod[w.id] = period
      }
    }
    // target-dated first (earliest target, then priority): fund the level amount that
    // makes the item affordable by its target date when possible
    const dated = wishlist
      .filter((w) => w.fundedMinor < w.costMinor && w.targetDate)
      .sort((a, b) => a.targetDate!.localeCompare(b.targetDate!) || a.priority - b.priority || a.id.localeCompare(b.id))
    for (const w of dated) {
      if (freeMinor <= 0) break
      const n = Math.max(1, periodsBetween(period, w.targetDate!.slice(0, 7)) + 1) // past-target items fund now
      const needMinor = Math.ceil((w.costMinor - w.fundedMinor) / n)
      fund(w, Math.min(needMinor, w.costMinor - w.fundedMinor, fromHome(freeMinor, w.currency)))
    }
    // then by priority (lower = more important), greedily to completion
    const byPriority = wishlist
      .filter((w) => w.fundedMinor < w.costMinor && !w.targetDate)
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
    for (const w of byPriority) {
      if (freeMinor <= 0) break
      fund(w, Math.min(w.costMinor - w.fundedMinor, fromHome(freeMinor, w.currency)))
    }
```

- [ ] Run: `npx vitest run lib/planner/engine.wishlist.test.ts` - expect PASS.
- [ ] Run: `npx vitest run lib/planner/engine.test.ts` - expect PASS (P7 tests unaffected: they all pass empty wishlists).
- [ ] Commit: `git add lib/planner/engine.ts lib/planner/engine.wishlist.test.ts && git commit -m "P8: planner funds wishlist from unallocated leftover"`

---

### Task 5: engine extension - affordability transfer suggestion for gapped currencies

An item in a currency whose accounts do not hold the cash still gets its affordability month (funding is tracked in home-currency leftover), plus an advisory transfer suggestion in that month's `fundingGaps`.

**Files:**
- Modify: `lib/planner/engine.ts`
- Test: `lib/planner/engine.wishlist.test.ts` (extend)

**Interfaces:**
- Produces: extra `MonthPlan.fundingGaps` entries in the month an item becomes affordable while `projected end balance in item currency < costMinor`; suggestion uses the same live-rate format as P7 gaps. Advisory only: never applied to the balance roll-forward (the purchase has not happened).

**Steps:**

- [ ] Add failing test to `lib/planner/engine.wishlist.test.ts`:

```ts
describe('buildPlan: item in a gapped currency still gets an affordability month + transfer suggestion', () => {
  // Home EUR. Unallocated = 200000/month. Item G: 500000 EGP minor, priority 1.
  // Funding (home leftover converted to EGP): fromHome(200000 EUR) = 200000 / 0.9 * 50 = 11111111,
  // capped at cost -> fund 500000 EGP in 2026-08 -> affordable immediately.
  // But EGP accounts hold 0: projected EGP end = 0 < 500000 -> shortfall 500000;
  // 500000 EGP * 0.9/50 = 9000 EUR minor -> "Transfer ~ €90.00 into EGP".
  it('reports the affordability month and the advisory transfer', () => {
    const plan = buildPlan(
      mkInput({
        monthlyIncomeMinor: { EUR: 200000 },
        accountBalancesMinor: { EUR: 1000000, EGP: 0 },
        wishlist: [{ id: 'G', name: 'Phone', costMinor: 500000, currency: 'EGP', priority: 1 }],
      }),
    )
    expect(plan.wishlistAffordablePeriod).toEqual({ G: '2026-08' })
    expect(plan.months[0].wishlistFunding).toEqual([{ itemId: 'G', amountMinor: 500000, currency: 'EGP' }])
    expect(plan.months[0].fundingGaps).toEqual([
      { currency: 'EGP', shortfallMinor: 500000, suggestion: 'Transfer ~ €90.00 into EGP' },
    ])
  })
})
```

- [ ] Run: `npx vitest run lib/planner/engine.wishlist.test.ts` - expect FAIL: `months[0].fundingGaps` is `[]` (EGP end balance is 0, not negative, so P7's gap loop stays silent).
- [ ] Replace the P7 placeholder line in `lib/planner/engine.ts`

```ts
    // --- wishlist affordability gaps: filled by P8 ---
```

  with (it sits after the P7 gap loop, before `for (const c of CURRENCIES) balances[c] = end[c]`, so `end` already reflects any applied gap transfers):

```ts
    // wishlist affordability gaps: the month an item becomes affordable, check the item's
    // currency actually holds the cash; advisory only, never applied to the roll-forward
    for (const w of wishlist) {
      if (wishlistAffordablePeriod[w.id] !== period) continue
      if (end[w.currency] >= w.costMinor) continue
      const shortfallMinor = w.costMinor - end[w.currency]
      const source = CURRENCIES.filter((s) => s !== w.currency && end[s] > 0).sort(
        (a, b) => toHome(end[b], b) - toHome(end[a], a),
      )[0]
      fundingGaps.push({
        currency: w.currency,
        shortfallMinor,
        suggestion: source
          ? `Transfer ~ ${formatMoney({ amountMinor: convert(shortfallMinor, w.currency, source, input.rates), currency: source })} into ${w.currency}`
          : `No other currency can cover ${formatMoney({ amountMinor: shortfallMinor, currency: w.currency })}`,
      })
    }
```

- [ ] Run: `npx vitest run lib/planner/engine.wishlist.test.ts` - expect PASS.
- [ ] Run: `npx vitest run` - expect the whole suite green (P6, P7, P8).
- [ ] Commit: `git add lib/planner/engine.ts lib/planner/engine.wishlist.test.ts && git commit -m "P8: affordability transfer suggestions for gapped currencies"`

---

### Task 6: purchase and un-purchase flow

Source-linked mutability: `purchase` transactions are created and deleted only through these two actions, atomically with the item's status flip.

**Files:**
- Modify: `lib/actions/wishlist.ts`
- Test: `lib/actions/wishlist.test.ts` (extend)

**Interfaces:**
- Produces: `purchaseSchema` (zod), `purchaseWishlistItem(raw: unknown)`, `unpurchaseWishlistItem(raw: unknown)`.
- Consumes: `dbPool` (transactions), `accounts`/`transactions` schema, `todayCairo` (P1).

**Steps:**

- [ ] Add failing test to `lib/actions/wishlist.test.ts`:

```ts
import { purchaseSchema } from './wishlist'

describe('purchaseSchema', () => {
  it('requires item and account uuids', () => {
    expect(
      purchaseSchema.parse({
        itemId: '9f8b7c6d-1234-4abc-9def-0123456789ab',
        accountId: '1f8b7c6d-1234-4abc-9def-0123456789ab',
      }),
    ).toBeTruthy()
    expect(() => purchaseSchema.parse({ itemId: 'nope', accountId: 'nope' })).toThrow()
  })
})
```

- [ ] Run: `npx vitest run lib/actions/wishlist.test.ts` - expect FAIL: `purchaseSchema` is not exported.
- [ ] Add to `lib/actions/wishlist.ts`:

```ts
import { dbPool } from '@/lib/db/client'
import { accounts, transactions } from '@/lib/db/schema'
import { todayCairo } from '@/lib/dates/cairo'

export const purchaseSchema = z.object({ itemId: z.string().uuid(), accountId: z.string().uuid() })

export async function purchaseWishlistItem(raw: unknown) {
  const { itemId, accountId } = purchaseSchema.parse(raw)
  const user = await requireUser()
  await dbPool.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(wishlistItems)
      .where(and(eq(wishlistItems.id, itemId), eq(wishlistItems.userId, user.id)))
    if (!item || item.status !== 'planned') throw new Error('Item not found or already purchased')
    const [account] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, user.id)))
    if (!account || account.currency !== item.currency) throw new Error('Account must hold the item currency')
    // shortfall is advisory and lives in the UI: no balance check here, negative balances are allowed
    const [txn] = await tx
      .insert(transactions)
      .values({
        userId: user.id,
        accountId,
        type: 'purchase',
        amountMinor: -item.costMinor, // outflow stored negative
        currency: item.currency,
        occurredOn: todayCairo(),
        note: `Wishlist: ${item.name}`,
        sourceType: 'wishlist_item',
        sourceId: item.id,
      })
      .returning()
    const updated = await tx
      .update(wishlistItems)
      .set({ status: 'purchased', transactionId: txn.id })
      .where(and(eq(wishlistItems.id, itemId), eq(wishlistItems.status, 'planned'))) // concurrency guard
      .returning()
    if (updated.length === 0) throw new Error('Item was purchased concurrently')
  })
  revalidateWishlistPaths()
  revalidatePath('/accounts')
}

export async function unpurchaseWishlistItem(raw: unknown) {
  const { id } = idSchema.parse(raw)
  const user = await requireUser()
  await dbPool.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(wishlistItems)
      .where(and(eq(wishlistItems.id, id), eq(wishlistItems.userId, user.id)))
    if (!item || item.status !== 'purchased') throw new Error('Item is not purchased')
    const updated = await tx
      .update(wishlistItems)
      .set({ status: 'planned', transactionId: null })
      .where(and(eq(wishlistItems.id, id), eq(wishlistItems.status, 'purchased'))) // concurrency guard
      .returning()
    if (updated.length === 0) throw new Error('Item changed concurrently')
    if (item.transactionId) {
      await tx
        .delete(transactions)
        .where(and(eq(transactions.id, item.transactionId), eq(transactions.sourceType, 'wishlist_item')))
    }
  })
  revalidateWishlistPaths()
  revalidatePath('/accounts')
}
```

- [ ] Run: `npx vitest run lib/actions/wishlist.test.ts` - expect PASS.
- [ ] Commit: `git add lib/actions/wishlist.ts lib/actions/wishlist.test.ts && git commit -m "P8: purchase + un-purchase flow"`

---

### Task 7: wishlist screen with affordability badges

**Files:**
- Create: `components/wishlist/wishlist-item-form.tsx`
- Create: `components/wishlist/purchase-sheet.tsx`
- Create: `app/(app)/wishlist/page.tsx`
- Create: `app/(app)/wishlist/[id]/page.tsx`

**Interfaces:**
- Consumes: `buildPlanInput` + `buildPlan` (P7, now wishlist-aware) for `wishlistAffordablePeriod` badges; `accountBalanceMinor` (P1) for the advisory shortfall; Task 2 and Task 6 actions.

**Steps:**

- [ ] Create `components/wishlist/wishlist-item-form.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createWishlistItem, updateWishlistItem } from '@/lib/actions/wishlist'
import { parseToMinor, type Currency } from '@/lib/money/money'

type Existing = { id: string; name: string; costMinor: number; currency: Currency; priority: number; targetDate: string | null }

export function WishlistItemForm({ existing }: { existing?: Existing }) {
  const router = useRouter()
  const [name, setName] = useState(existing?.name ?? '')
  const [currency, setCurrency] = useState<Currency>(existing?.currency ?? 'EUR')
  const [cost, setCost] = useState(existing ? (existing.costMinor / 100).toFixed(2) : '')
  const [priority, setPriority] = useState(existing ? String(existing.priority) : '3')
  const [targetDate, setTargetDate] = useState(existing?.targetDate ?? '')
  return (
    <form
      action={async () => {
        const payload = {
          name,
          costMinor: parseToMinor(cost, currency),
          currency,
          priority: Number(priority),
          targetDate: targetDate || undefined,
        }
        if (existing) {
          await updateWishlistItem({ id: existing.id, ...payload })
          router.push('/wishlist')
        } else {
          await createWishlistItem(payload)
          setName('')
          setCost('')
          setTargetDate('')
        }
      }}
      className="space-y-3"
    >
      <label className="block text-sm">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required className="mt-1 w-full rounded-lg border p-3" />
      </label>
      <div className="flex gap-2">
        <label className="block flex-1 text-sm">
          Cost
          <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" required className="mt-1 w-full rounded-lg border p-3" />
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
      </div>
      <div className="flex gap-2">
        <label className="block flex-1 text-sm">
          Priority (1 = highest)
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className="mt-1 w-full rounded-lg border p-3">
            {['1', '2', '3', '4', '5'].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="block flex-1 text-sm">
          Target date (optional)
          <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="mt-1 w-full rounded-lg border p-3" />
        </label>
      </div>
      <button type="submit" className="w-full rounded-lg bg-neutral-900 p-3 text-white dark:bg-neutral-100 dark:text-neutral-900">
        {existing ? 'Save' : 'Add'}
      </button>
    </form>
  )
}
```

- [ ] Create `components/wishlist/purchase-sheet.tsx` (same-currency selector defaulting to the single match; advisory warning, never blocking):

```tsx
'use client'

import { useState } from 'react'
import { purchaseWishlistItem } from '@/lib/actions/wishlist'
import { formatMoney, type Currency } from '@/lib/money/money'

export function PurchaseSheet({
  item,
  accounts,
}: {
  item: { id: string; name: string; costMinor: number; currency: Currency }
  accounts: { id: string; name: string; balanceMinor: number }[]
}) {
  const [open, setOpen] = useState(false)
  const [accountId, setAccountId] = useState(accounts.length === 1 ? accounts[0].id : '')
  const selected = accounts.find((a) => a.id === accountId)
  const shortfall = selected ? item.costMinor - selected.balanceMinor : 0
  if (accounts.length === 0) {
    return <p className="text-xs text-neutral-500">No {item.currency} account to buy from.</p>
  }
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="w-full rounded-lg border p-2 text-sm">
        Buy
      </button>
    )
  }
  return (
    <form
      action={async () => {
        await purchaseWishlistItem({ itemId: item.id, accountId })
        setOpen(false)
      }}
      className="space-y-2"
    >
      <select value={accountId} onChange={(e) => setAccountId(e.target.value)} required className="w-full rounded-lg border p-3">
        {accounts.length > 1 && <option value="">Buy from…</option>}
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} ({formatMoney({ amountMinor: a.balanceMinor, currency: item.currency })})
          </option>
        ))}
      </select>
      {selected && shortfall > 0 && (
        <p role="status" className="rounded bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {selected.name} is short {formatMoney({ amountMinor: shortfall, currency: item.currency })}; its balance will go
          negative. Purchases are never blocked.
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className="flex-1 rounded-lg bg-neutral-900 p-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900">
          Confirm purchase
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border px-3 text-sm">
          Cancel
        </button>
      </div>
    </form>
  )
}
```

- [ ] Create `app/(app)/wishlist/page.tsx`:

```tsx
import Link from 'next/link'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { accountBalanceMinor } from '@/lib/db/queries'
import { accounts, wishlistItems } from '@/lib/db/schema'
import { requireUser } from '@/lib/auth/stack'
import { buildPlanInput } from '@/lib/planner/input'
import { buildPlan } from '@/lib/planner/engine'
import { unpurchaseWishlistItem } from '@/lib/actions/wishlist'
import { formatMoney, type Currency } from '@/lib/money/money'
import { WishlistItemForm } from '@/components/wishlist/wishlist-item-form'
import { PurchaseSheet } from '@/components/wishlist/purchase-sheet'

export default async function WishlistPage() {
  const user = await requireUser()
  const input = await buildPlanInput(user.id)
  const plan = buildPlan(input)
  const items = await db
    .select()
    .from(wishlistItems)
    .where(eq(wishlistItems.userId, user.id))
    .orderBy(wishlistItems.priority, wishlistItems.name)
  const accountRows = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, user.id), isNull(accounts.archivedAt)))
  const accountsWithBalances = await Promise.all(
    accountRows.map(async (a) => ({
      id: a.id,
      name: a.name,
      currency: a.currency,
      balanceMinor: await accountBalanceMinor(a.id),
    })),
  )
  const planned = items.filter((i) => i.status === 'planned')
  const purchased = items.filter((i) => i.status === 'purchased')

  return (
    <main className="mx-auto max-w-md space-y-4 p-4">
      <h1 className="text-xl font-semibold">Wishlist</h1>
      <WishlistItemForm />
      {planned.length === 0 && purchased.length === 0 && (
        <p className="text-sm text-neutral-500">Nothing here yet. Add something you are saving for.</p>
      )}
      {planned.length > 0 && (
        <ul className="space-y-3">
          {planned.map((i) => (
            <li key={i.id} className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <Link href={`/wishlist/${i.id}`} className="font-medium">
                  {i.name}
                </Link>
                <span className="tabular-nums">{formatMoney({ amountMinor: i.costMinor, currency: i.currency as Currency })}</span>
              </div>
              <p className="text-xs text-neutral-500">
                Priority {i.priority}
                {i.targetDate ? ` · target ${i.targetDate}` : ''}
              </p>
              <span className="inline-block rounded-full bg-neutral-100 px-2 py-1 text-xs dark:bg-neutral-800">
                {plan.wishlistAffordablePeriod[i.id]
                  ? `Affordable ${plan.wishlistAffordablePeriod[i.id]}`
                  : `Beyond ${input.horizonMonths} months`}
              </span>
              <PurchaseSheet
                item={{ id: i.id, name: i.name, costMinor: i.costMinor, currency: i.currency as Currency }}
                accounts={accountsWithBalances
                  .filter((a) => a.currency === i.currency)
                  .map((a) => ({ id: a.id, name: a.name, balanceMinor: a.balanceMinor }))}
              />
            </li>
          ))}
        </ul>
      )}
      {purchased.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Purchased</h2>
          <ul className="divide-y rounded-lg border">
            {purchased.map((i) => (
              <li key={i.id} className="flex items-center justify-between p-3 text-sm">
                <span>
                  {i.name} · {formatMoney({ amountMinor: i.costMinor, currency: i.currency as Currency })}
                </span>
                <form
                  action={async () => {
                    'use server'
                    await unpurchaseWishlistItem({ id: i.id })
                  }}
                >
                  <button className="p-2 text-xs text-red-600">Un-purchase</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
```

  If `accountBalanceMinor` lives at a different path in P1's implementation, import it from there; the signature is canonical.
- [ ] Create `app/(app)/wishlist/[id]/page.tsx` (edit + delete for planned items):

```tsx
import { notFound } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { wishlistItems } from '@/lib/db/schema'
import { requireUser } from '@/lib/auth/stack'
import { deleteWishlistItem } from '@/lib/actions/wishlist'
import { WishlistItemForm } from '@/components/wishlist/wishlist-item-form'
import type { Currency } from '@/lib/money/money'
import { redirect } from 'next/navigation'

export default async function WishlistItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()
  const [item] = await db
    .select()
    .from(wishlistItems)
    .where(and(eq(wishlistItems.id, id), eq(wishlistItems.userId, user.id)))
  if (!item) notFound()
  if (item.status === 'purchased') redirect('/wishlist') // purchased items are edited by un-purchasing first

  return (
    <main className="mx-auto max-w-md space-y-4 p-4">
      <h1 className="text-xl font-semibold">{item.name}</h1>
      <WishlistItemForm
        existing={{
          id: item.id,
          name: item.name,
          costMinor: item.costMinor,
          currency: item.currency as Currency,
          priority: item.priority,
          targetDate: item.targetDate,
        }}
      />
      <form
        action={async () => {
          'use server'
          await deleteWishlistItem({ id: item.id })
          redirect('/wishlist')
        }}
      >
        <button className="w-full rounded-lg border border-red-300 p-3 text-sm text-red-600">Delete item</button>
      </form>
    </main>
  )
}
```

- [ ] Run: `npx tsc --noEmit` - expect PASS.
- [ ] Run: `npm run dev`, open `/wishlist` on a mobile viewport - add an item, see its affordability badge, open Buy with an under-funded account and see the advisory warning without a disabled button, purchase, un-purchase.
- [ ] Commit: `git add components/wishlist "app/(app)/wishlist" && git commit -m "P8: wishlist screen with affordability badges + purchase sheet"`

---

### Task 8: Playwright flow

**Files:**
- Create: `e2e/wishlist.spec.ts`

**Interfaces:**
- Consumes: P0 Playwright setup; an EUR account from earlier E2E setup (any balance: the flow deliberately buys above balance to prove the warning is advisory).

**Steps:**

- [ ] Create `e2e/wishlist.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

test('wishlist lifecycle: badge, advisory purchase, un-purchase', async ({ page }) => {
  // create an item costing more than the account holds
  await page.goto('/wishlist')
  await page.getByLabel('Name').fill('Desk chair')
  await page.getByLabel('Cost').fill('9999.00')
  await page.getByRole('button', { name: 'Add' }).click()
  await expect(page.getByText('Desk chair')).toBeVisible()

  // affordability badge comes from the plan
  await expect(page.getByText(/Affordable \d{4}-\d{2}|Beyond 24 months/)).toBeVisible()

  // purchase: advisory shortfall warning shows, button still works
  await page.getByRole('button', { name: 'Buy' }).click()
  await expect(page.getByText('Purchases are never blocked.')).toBeVisible()
  await page.getByRole('button', { name: 'Confirm purchase' }).click()
  await expect(page.getByRole('heading', { name: 'Purchased' })).toBeVisible()
  await expect(page.getByText('Desk chair')).toBeVisible()

  // account went negative (honesty over enforcement)
  await page.goto('/accounts')
  await expect(page.getByText('-€')).toBeVisible()

  // un-purchase restores the item and the balance
  await page.goto('/wishlist')
  await page.getByRole('button', { name: 'Un-purchase' }).click()
  await expect(page.getByRole('heading', { name: 'Purchased' })).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Buy' })).toBeVisible()
})
```

- [ ] Run: `npx playwright test e2e/wishlist.spec.ts` - expect PASS (adjust the negative-balance assertion to the accounts screen's actual formatting if it differs; assertion fixes only, no behavior changes).
- [ ] Run: `npx vitest run` - expect the full unit suite green.
- [ ] Commit: `git add e2e/wishlist.spec.ts && git commit -m "P8: wishlist Playwright flow"`

---

**Phase gate:** `npx vitest run` green (including both engine test files), `npx playwright test e2e/wishlist.spec.ts` green, manual mobile-viewport walkthrough of `/wishlist` and `/plan` (wishlist funding now visible in the plan's unallocated months).

Backlinks: [Plans index](../plans/README.md) | [Design spec](../specs/2026-07-07-my-ledger-design.md) | Previous: [07-debts-and-planner.md](07-debts-and-planner.md) | Next: [09-ai-advisor.md](09-ai-advisor.md)
