# Phase 06: Expenses and Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

Backlinks: [Plans index](../plans/README.md) | [Design spec](../specs/2026-07-07-my-ledger-design.md) | Previous: [05-installments.md](05-installments.md) | Next: [07-debts-and-planner.md](07-debts-and-planner.md)

**Goal:** Per-user expense categories with CRUD, category picker and `one_off` toggle wired into the P2 expense form, an expenses list filtered by month and category, a native-per-currency insights screen (spend by category, month-over-month trend), and the `variableSpendActuals` query helper that P7's planner consumes.

**Architecture:** Categories are a small lookup table; expenses stay plain `transactions` rows (`type='expense'`) that gain a `category_id` reference and a `one_off` tag through the existing P2 form and action. Insights read grouped SQL into pure, unit-tested pivot functions, then render Recharts client components per currency, never mixing currencies in a time series (spec §5.6).

**Tech Stack:** Next.js App Router + TypeScript + Tailwind, Neon + Drizzle, Recharts 3, Vitest + Playwright.

**Global Constraints** (verbatim from [the plans README](../plans/README.md)):

- Money: integer minor units, currencies `EUR|USD|EGP`, round half-up, balances derived ([spec §3](../specs/2026-07-07-my-ledger-design.md)).
- No transaction converts currency; transfer legs mutate as a group; source-linked transactions mutate only via owning flow.
- Day boundaries `Africa/Cairo`; due-date clamp `min(due_day, last_day_of_month)`.
- Occurrences unique per (user, kind, source, period); confirms guard on `status IN ('pending','overdue')`; snapshots unique per (user, date).
- All mutations = zod-validated server actions + `revalidatePath`; every table has `user_id`.
- TDD: failing test → minimal code → pass → commit. Frequent small commits.
- The deterministic engine owns all numbers; the AI only quotes.

**Phase-wide conventions** (from P1/P2, stated once):

- P2 stores outflows as negative `amount_minor` so `accountBalanceMinor` is a plain sum. Every spend query in this phase therefore sums `-amount_minor`.
- Money columns use the same integer column helper P1 used for `transactions.amount_minor` in `lib/db/schema.ts` (shown below as `bigint(..., { mode: 'number' })`; if P1 chose a different helper, reuse that one).
- `transactions.category_id` and `transactions.one_off` columns already exist per spec §4 (created with the table in P1/P2). P6 adds the `expense_categories` table they point at and the form controls. If the P2 form already added either control, treat that step as verification instead of creation.

---

### Task 1: expense_categories table and migration

**Files:**
- Modify: `lib/db/schema.ts`
- Create: generated migration under `drizzle/` (via drizzle-kit)

**Interfaces:**
- Produces: `expenseCategories` Drizzle table export (`id uuid pk, user_id text, name text, icon text nullable`), per spec §4 `expense_categories(id, user_id, name, icon?)`.

**Steps:**

- [ ] Append to `lib/db/schema.ts`:

```ts
export const expenseCategories = pgTable('expense_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  icon: text('icon'),
})
```

- [ ] Run: `npx drizzle-kit generate --name p6-expense-categories` - expect a new SQL file under `drizzle/` containing `CREATE TABLE "expense_categories"`.
- [ ] Run: `npx drizzle-kit migrate` - expect it to apply cleanly against the dev Neon branch.
- [ ] Run: `npx tsc --noEmit` - expect PASS.
- [ ] Commit: `git add lib/db/schema.ts drizzle && git commit -m "P6: expense_categories table + migration"`

---

### Task 2: addPeriods date helper

Pure period arithmetic ("YYYY-MM" strings). Lives in the dates module (the one home for date math). Consumed by this phase's queries and by P7's engine.

**Files:**
- Modify: `lib/dates/cairo.ts`
- Test: `lib/dates/cairo.test.ts` (extend the existing P1 test file)

**Interfaces:**
- Produces: `function addPeriods(period: string, n: number): string` - e.g. `addPeriods('2026-01', -2) === '2025-11'`.
- Consumes: nothing (pure string math, no timezone access).

**Steps:**

- [ ] Add failing tests to `lib/dates/cairo.test.ts`:

```ts
import { addPeriods } from './cairo'

describe('addPeriods', () => {
  it('adds within a year', () => expect(addPeriods('2026-03', 2)).toBe('2026-05'))
  it('crosses year end forward', () => expect(addPeriods('2026-11', 3)).toBe('2027-02'))
  it('crosses year start backward', () => expect(addPeriods('2026-01', -2)).toBe('2025-11'))
  it('zero is identity', () => expect(addPeriods('2026-07', 0)).toBe('2026-07'))
})
```

- [ ] Run: `npx vitest run lib/dates/cairo.test.ts` - expect FAIL: `addPeriods` is not exported.
- [ ] Implement in `lib/dates/cairo.ts`:

```ts
export function addPeriods(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  const yy = Math.floor(total / 12)
  const mm = (total % 12) + 1
  return `${yy}-${String(mm).padStart(2, '0')}`
}
```

- [ ] Run: `npx vitest run lib/dates/cairo.test.ts` - expect PASS.
- [ ] Commit: `git add lib/dates/cairo.ts lib/dates/cairo.test.ts && git commit -m "P6: addPeriods period arithmetic helper"`

---

### Task 3: category CRUD actions and categories screen

**Files:**
- Create: `lib/actions/expense-categories.ts`
- Create: `app/(app)/expenses/categories/page.tsx`
- Create: `components/expenses/category-form.tsx`
- Test: `lib/actions/expense-categories.test.ts`

**Interfaces:**
- Produces: server actions `createCategory(raw: unknown): Promise<void>`, `updateCategory(raw: unknown): Promise<void>`, `deleteCategory(raw: unknown): Promise<void>`; exported `categorySchema` (zod).
- Consumes: `requireUser()` from `lib/auth` (P0), `db`/`dbPool` from `lib/db/client` (P0), `expenseCategories` (Task 1).

**Steps:**

- [ ] Write failing schema test `lib/actions/expense-categories.test.ts`:

```ts
import { categorySchema } from './expense-categories'

describe('categorySchema', () => {
  it('accepts a name and optional icon', () => {
    expect(categorySchema.parse({ name: 'Groceries', icon: '🛒' })).toEqual({ name: 'Groceries', icon: '🛒' })
    expect(categorySchema.parse({ name: 'Transport' })).toEqual({ name: 'Transport' })
  })
  it('rejects an empty name', () => {
    expect(() => categorySchema.parse({ name: '' })).toThrow()
  })
})
```

- [ ] Run: `npx vitest run lib/actions/expense-categories.test.ts` - expect FAIL: module not found.
- [ ] Implement `lib/actions/expense-categories.ts`:

```ts
'use server'

import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db, dbPool } from '@/lib/db/client'
import { expenseCategories, transactions } from '@/lib/db/schema'
import { requireUser } from '@/lib/auth'

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  icon: z.string().trim().min(1).max(8).optional(),
})

const idSchema = z.object({ id: z.string().uuid() })

export async function createCategory(raw: unknown) {
  const data = categorySchema.parse(raw)
  const user = await requireUser()
  await db.insert(expenseCategories).values({ userId: user.id, name: data.name, icon: data.icon ?? null })
  revalidatePath('/expenses')
  revalidatePath('/expenses/categories')
}

export async function updateCategory(raw: unknown) {
  const data = categorySchema.extend({ id: z.string().uuid() }).parse(raw)
  const user = await requireUser()
  await db
    .update(expenseCategories)
    .set({ name: data.name, icon: data.icon ?? null })
    .where(and(eq(expenseCategories.id, data.id), eq(expenseCategories.userId, user.id)))
  revalidatePath('/expenses')
  revalidatePath('/expenses/categories')
}

export async function deleteCategory(raw: unknown) {
  const { id } = idSchema.parse(raw)
  const user = await requireUser()
  await dbPool.transaction(async (tx) => {
    // No FK from transactions to expense_categories (tables are created in different phases);
    // clear references in the same transaction instead.
    await tx
      .update(transactions)
      .set({ categoryId: null })
      .where(and(eq(transactions.categoryId, id), eq(transactions.userId, user.id)))
    await tx.delete(expenseCategories).where(and(eq(expenseCategories.id, id), eq(expenseCategories.userId, user.id)))
  })
  revalidatePath('/expenses')
  revalidatePath('/expenses/categories')
}
```

- [ ] Run: `npx vitest run lib/actions/expense-categories.test.ts` - expect PASS.
- [ ] Create `components/expenses/category-form.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { createCategory, updateCategory } from '@/lib/actions/expense-categories'

export function CategoryForm({ existing }: { existing?: { id: string; name: string; icon: string | null } }) {
  const [name, setName] = useState(existing?.name ?? '')
  const [icon, setIcon] = useState(existing?.icon ?? '')
  return (
    <form
      action={async () => {
        const payload = { name, icon: icon || undefined }
        if (existing) await updateCategory({ id: existing.id, ...payload })
        else await createCategory(payload)
        setName('')
        setIcon('')
      }}
      className="flex gap-2"
    >
      <input
        value={icon}
        onChange={(e) => setIcon(e.target.value)}
        placeholder="🛒"
        aria-label="Icon (optional)"
        className="w-14 rounded-lg border p-3 text-center"
      />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Category name"
        aria-label="Category name"
        required
        className="min-w-0 flex-1 rounded-lg border p-3"
      />
      <button type="submit" className="rounded-lg bg-neutral-900 px-4 text-white dark:bg-neutral-100 dark:text-neutral-900">
        {existing ? 'Save' : 'Add'}
      </button>
    </form>
  )
}
```

- [ ] Create `app/(app)/expenses/categories/page.tsx`:

```tsx
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { expenseCategories } from '@/lib/db/schema'
import { requireUser } from '@/lib/auth'
import { deleteCategory } from '@/lib/actions/expense-categories'
import { CategoryForm } from '@/components/expenses/category-form'

export default async function CategoriesPage() {
  const user = await requireUser()
  const categories = await db
    .select()
    .from(expenseCategories)
    .where(eq(expenseCategories.userId, user.id))
    .orderBy(expenseCategories.name)
  return (
    <main className="mx-auto max-w-md space-y-4 p-4">
      <h1 className="text-xl font-semibold">Expense categories</h1>
      <CategoryForm />
      {categories.length === 0 ? (
        <p className="text-sm text-neutral-500">No categories yet. Add one above; expenses can also stay uncategorized.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 p-3">
              <span>
                {c.icon ? `${c.icon} ` : ''}
                {c.name}
              </span>
              <form
                action={async () => {
                  'use server'
                  await deleteCategory({ id: c.id })
                }}
              >
                <button className="p-2 text-sm text-red-600" aria-label={`Delete ${c.name}`}>
                  Delete
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
```

- [ ] Run: `npm run dev`, open `/expenses/categories` on a mobile viewport - create, rename, delete a category; deleting a category used by an expense leaves the expense uncategorized.
- [ ] Commit: `git add lib/actions/expense-categories.ts lib/actions/expense-categories.test.ts components/expenses/category-form.tsx "app/(app)/expenses/categories/page.tsx" && git commit -m "P6: category CRUD + categories screen"`

---

### Task 4: category picker and one_off toggle in the P2 expense form

**Files:**
- Create: `components/expenses/category-picker.tsx`
- Modify: `components/transactions/transaction-form.tsx` (P2's form, per the architecture module map)
- Modify: `lib/actions/transactions.ts` (P2's expense action)

**Interfaces:**
- Produces: `CategoryPicker` component `({ categories: { id: string; name: string; icon: string | null }[]; value: string; onChange: (id: string) => void })`.
- Consumes: P2's expense server action and form; `expenseCategories` (Task 1).

**Steps:**

- [ ] Create `components/expenses/category-picker.tsx` (native select, mobile-friendly):

```tsx
'use client'

export function CategoryPicker({
  categories,
  value,
  onChange,
}: {
  categories: { id: string; name: string; icon: string | null }[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <label className="block text-sm">
      Category
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-lg border p-3">
        <option value="">No category</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.icon ? `${c.icon} ` : ''}
            {c.name}
          </option>
        ))}
      </select>
    </label>
  )
}
```

- [ ] In `lib/actions/transactions.ts`, extend the expense input schema with the two optional fields and pass them through to the insert:

```ts
// added to the existing expense zod schema
categoryId: z.string().uuid().nullish(),
oneOff: z.boolean().default(false),
```

```ts
// added to the existing transactions insert values for type 'expense'
categoryId: data.categoryId ?? null,
oneOff: data.oneOff,
```

- [ ] In `components/transactions/transaction-form.tsx`, inside the expense branch, render `CategoryPicker` (categories fetched by the page that renders the form and passed down as a prop) and a one_off checkbox:

```tsx
<CategoryPicker categories={categories} value={categoryId} onChange={setCategoryId} />
<label className="flex items-center gap-2 text-sm">
  <input type="checkbox" checked={oneOff} onChange={(e) => setOneOff(e.target.checked)} className="h-5 w-5" />
  One-off (excluded from the spend estimate)
</label>
```

  with `const [categoryId, setCategoryId] = useState('')` and `const [oneOff, setOneOff] = useState(false)`, both included in the action payload (`categoryId: categoryId || undefined, oneOff`).
- [ ] Run: `npx tsc --noEmit` - expect PASS.
- [ ] Run: `npm run dev`, log an expense with a category and the one_off toggle on - the row persists both fields (verify in the P2 history screen or via `npx drizzle-kit studio`).
- [ ] Commit: `git add components/expenses/category-picker.tsx components/transactions/transaction-form.tsx lib/actions/transactions.ts && git commit -m "P6: category picker + one_off toggle in expense form"`

---

### Task 5: expenses list by month with category filter

**Files:**
- Create: `app/(app)/expenses/page.tsx`

**Interfaces:**
- Consumes: `formatMoney` (P1), `periodOf`/`todayCairo` (P1), `addPeriods` (Task 2), `transactions` + `expenseCategories` schema.
- Produces: `/expenses` route reading `?month=YYYY-MM&category=<id>` search params via a plain GET form (no client JS).

**Steps:**

- [ ] Create `app/(app)/expenses/page.tsx`:

```tsx
import Link from 'next/link'
import { and, desc, eq, gte, lt } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { expenseCategories, transactions } from '@/lib/db/schema'
import { requireUser } from '@/lib/auth'
import { formatMoney } from '@/lib/money/money'
import { addPeriods, periodOf, todayCairo } from '@/lib/dates/cairo'

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; category?: string }>
}) {
  const params = await searchParams
  const user = await requireUser()
  const period = /^\d{4}-\d{2}$/.test(params.month ?? '') ? params.month! : periodOf(todayCairo())
  const categories = await db
    .select()
    .from(expenseCategories)
    .where(eq(expenseCategories.userId, user.id))
    .orderBy(expenseCategories.name)
  const rows = await db
    .select({
      id: transactions.id,
      amountMinor: transactions.amountMinor,
      currency: transactions.currency,
      occurredOn: transactions.occurredOn,
      note: transactions.note,
      oneOff: transactions.oneOff,
      categoryName: expenseCategories.name,
      categoryIcon: expenseCategories.icon,
    })
    .from(transactions)
    .leftJoin(expenseCategories, eq(transactions.categoryId, expenseCategories.id))
    .where(
      and(
        eq(transactions.userId, user.id),
        eq(transactions.type, 'expense'),
        gte(transactions.occurredOn, `${period}-01`),
        lt(transactions.occurredOn, `${addPeriods(period, 1)}-01`),
        params.category ? eq(transactions.categoryId, params.category) : undefined,
      ),
    )
    .orderBy(desc(transactions.occurredOn))

  return (
    <main className="mx-auto max-w-md space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Expenses</h1>
        <Link href="/expenses/insights" className="text-sm underline">
          Insights
        </Link>
      </div>
      <form method="GET" className="flex gap-2">
        <input type="month" name="month" defaultValue={period} className="min-w-0 flex-1 rounded-lg border p-3" />
        <select name="category" defaultValue={params.category ?? ''} className="min-w-0 flex-1 rounded-lg border p-3">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-lg border px-4">
          Go
        </button>
      </form>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500">No expenses in {period}.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 p-3">
              <div className="min-w-0">
                <p className="truncate">{r.note || 'Expense'}</p>
                <p className="text-xs text-neutral-500">
                  {r.occurredOn} · {r.categoryIcon ? `${r.categoryIcon} ` : ''}
                  {r.categoryName ?? 'Uncategorized'}
                  {r.oneOff ? ' · one-off' : ''}
                </p>
              </div>
              <span className="shrink-0 tabular-nums">
                {formatMoney({ amountMinor: -r.amountMinor, currency: r.currency })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
```

- [ ] Run: `npx tsc --noEmit` - expect PASS.
- [ ] Run: `npm run dev`, open `/expenses` - month picker and category filter narrow the list; empty month shows the empty state.
- [ ] Commit: `git add "app/(app)/expenses/page.tsx" && git commit -m "P6: expenses list by month with category filter"`

---

### Task 6: variableSpendActuals query helper (Produces for P7)

Sums `type='expense'` rows excluding `one_off=true`, grouped by period, complete past months only (the current partial month is excluded so P7's blend never averages a half-month).

**Files:**
- Create: `lib/insights/variable-spend.ts`

**Interfaces:**
- Produces: `async function variableSpendActuals(userId: string, currency: Currency, monthsBack: number): Promise<{ period: string; totalMinor: number }[]>` - ascending by period; periods with no rows are simply absent. **P7's `estimateVariableSpend` consumes this exact shape.**
- Consumes: `db`, `transactions`, `periodOf`/`todayCairo` (P1), `addPeriods` (Task 2).

**Steps:**

- [ ] Create `lib/insights/variable-spend.ts` (thin I/O; the pure period math it leans on was TDD'd in Task 2, and its numbers are asserted end to end in Task 9's Playwright flow):

```ts
import { and, eq, gte, lt, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { transactions } from '@/lib/db/schema'
import type { Currency } from '@/lib/money/money'
import { addPeriods, periodOf, todayCairo } from '@/lib/dates/cairo'

export async function variableSpendActuals(
  userId: string,
  currency: Currency,
  monthsBack: number,
): Promise<{ period: string; totalMinor: number }[]> {
  const current = periodOf(todayCairo())
  const from = addPeriods(current, -monthsBack)
  return db
    .select({
      period: sql<string>`to_char(${transactions.occurredOn}, 'YYYY-MM')`,
      totalMinor: sql<number>`sum(-${transactions.amountMinor})::int`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.type, 'expense'),
        eq(transactions.currency, currency),
        eq(transactions.oneOff, false),
        gte(transactions.occurredOn, `${from}-01`),
        lt(transactions.occurredOn, `${current}-01`),
      ),
    )
    .groupBy(sql`1`)
    .orderBy(sql`1`)
}
```

- [ ] Run: `npx tsc --noEmit` - expect PASS.
- [ ] Commit: `git add lib/insights/variable-spend.ts && git commit -m "P6: variableSpendActuals query helper for the planner"`

---

### Task 7: chart palette tokens and pure chart-data pivots

The palette is the pre-validated dataviz reference categorical palette (slots 1-6), stepped separately for light and dark surfaces; hues are assigned to categories in fixed slot order by descending total, never cycled, and categories beyond five fold into a muted-gray "Other". Light-mode aqua/yellow slots sit below 3:1 contrast on the light surface, so the charts always ship a legend, tooltips, and a plain-text totals list under each chart (the relief rule).

**Files:**
- Modify: `app/globals.css`
- Create: `components/charts/palette.ts`
- Create: `lib/insights/chart-data.ts`
- Test: `lib/insights/chart-data.test.ts`

**Interfaces:**
- Produces:
  - `const CHART_SERIES: readonly string[]` (six `var(--chart-N)` references) and `const CHART_OTHER: string` in `components/charts/palette.ts`.
  - `interface CategorySpendRow { period: string; category: string; totalMinor: number }`
  - `function pivotByCategory(rows: CategorySpendRow[], maxSeries?: number): { categories: string[]; data: Record<string, string | number>[] }` - `data` rows are `{ period, [categoryName]: totalMinor }`, one per period, ascending; `categories` ordered by grand total descending with overflow folded into `'Other'`.
  - `function trendSeries(rows: { period: string; totalMinor: number }[], from: string, to: string): { period: string; totalMinor: number }[]` - one point per period from `from` to `to` inclusive, missing periods filled with 0.
- Consumes: `addPeriods` (Task 2).

**Steps:**

- [ ] Append to `app/globals.css` (theme-aware tokens; values are the dataviz reference palette for the light `#fcfcfb` and dark `#1a1a19` surfaces):

```css
:root {
  --chart-1: #2a78d6;
  --chart-2: #1baf7a;
  --chart-3: #eda100;
  --chart-4: #008300;
  --chart-5: #4a3aa7;
  --chart-6: #e34948;
  --chart-other: #898781;
  --chart-grid: #e1e0d9;
  --chart-axis: #c3c2b7;
  --chart-muted: #898781;
  --chart-surface: #fcfcfb;
}
@media (prefers-color-scheme: dark) {
  :root {
    --chart-1: #3987e5;
    --chart-2: #199e70;
    --chart-3: #c98500;
    --chart-4: #008300;
    --chart-5: #9085e9;
    --chart-6: #e66767;
    --chart-grid: #2c2c2a;
    --chart-axis: #383835;
    --chart-surface: #1a1a19;
  }
}
```

- [ ] Create `components/charts/palette.ts`:

```ts
export const CHART_SERIES = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
] as const

export const CHART_OTHER = 'var(--chart-other)'
```

- [ ] Write failing tests `lib/insights/chart-data.test.ts`:

```ts
import { pivotByCategory, trendSeries } from './chart-data'

describe('pivotByCategory', () => {
  const rows = [
    { period: '2026-04', category: 'Groceries', totalMinor: 90000 },
    { period: '2026-04', category: 'Transport', totalMinor: 30000 },
    { period: '2026-05', category: 'Groceries', totalMinor: 110000 },
    { period: '2026-05', category: 'Fun', totalMinor: 20000 },
  ]

  it('pivots rows into one object per period with categories by total desc', () => {
    // Totals: Groceries 200000, Transport 30000, Fun 20000
    expect(pivotByCategory(rows)).toEqual({
      categories: ['Groceries', 'Transport', 'Fun'],
      data: [
        { period: '2026-04', Groceries: 90000, Transport: 30000, Fun: 0 },
        { period: '2026-05', Groceries: 110000, Transport: 0, Fun: 20000 },
      ],
    })
  })

  it('folds categories beyond maxSeries into Other', () => {
    const { categories, data } = pivotByCategory(rows, 2)
    expect(categories).toEqual(['Groceries', 'Transport', 'Other'])
    // Fun (20000 in 2026-05) folds into Other
    expect(data[1]).toEqual({ period: '2026-05', Groceries: 110000, Transport: 0, Other: 20000 })
  })

  it('returns empty shapes for no rows', () => {
    expect(pivotByCategory([])).toEqual({ categories: [], data: [] })
  })
})

describe('trendSeries', () => {
  it('fills missing periods with zero', () => {
    expect(
      trendSeries(
        [
          { period: '2026-04', totalMinor: 120000 },
          { period: '2026-06', totalMinor: 130000 },
        ],
        '2026-04',
        '2026-06',
      ),
    ).toEqual([
      { period: '2026-04', totalMinor: 120000 },
      { period: '2026-05', totalMinor: 0 },
      { period: '2026-06', totalMinor: 130000 },
    ])
  })
})
```

- [ ] Run: `npx vitest run lib/insights/chart-data.test.ts` - expect FAIL: module not found.
- [ ] Implement `lib/insights/chart-data.ts`:

```ts
import { addPeriods } from '@/lib/dates/cairo'

export interface CategorySpendRow {
  period: string
  category: string
  totalMinor: number
}

export function pivotByCategory(
  rows: CategorySpendRow[],
  maxSeries = 5,
): { categories: string[]; data: Record<string, string | number>[] } {
  if (rows.length === 0) return { categories: [], data: [] }
  const totals = new Map<string, number>()
  for (const r of rows) totals.set(r.category, (totals.get(r.category) ?? 0) + r.totalMinor)
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name)
  const kept = ranked.slice(0, maxSeries)
  const hasOther = ranked.length > maxSeries
  const categories = hasOther ? [...kept, 'Other'] : kept
  const periods = [...new Set(rows.map((r) => r.period))].sort()
  const data = periods.map((period) => {
    const row: Record<string, string | number> = { period }
    for (const c of categories) row[c] = 0
    for (const r of rows.filter((x) => x.period === period)) {
      const key = kept.includes(r.category) ? r.category : 'Other'
      row[key] = (row[key] as number) + r.totalMinor
    }
    return row
  })
  return { categories, data }
}

export function trendSeries(
  rows: { period: string; totalMinor: number }[],
  from: string,
  to: string,
): { period: string; totalMinor: number }[] {
  const byPeriod = new Map(rows.map((r) => [r.period, r.totalMinor]))
  const out: { period: string; totalMinor: number }[] = []
  for (let p = from; p <= to; p = addPeriods(p, 1)) {
    out.push({ period: p, totalMinor: byPeriod.get(p) ?? 0 })
  }
  return out
}
```

- [ ] Run: `npx vitest run lib/insights/chart-data.test.ts` - expect PASS.
- [ ] Commit: `git add app/globals.css components/charts/palette.ts lib/insights/chart-data.ts lib/insights/chart-data.test.ts && git commit -m "P6: chart palette tokens + pure chart-data pivots"`

---

### Task 8: insights screen with per-currency Recharts charts

Insights show actual spending, so the category and trend queries include one_off rows (unlike Task 6's planner helper, which excludes them). Each currency renders its own section; no cross-currency series ever share a chart (spec §5.6).

**Files:**
- Create: `lib/insights/category-spend.ts`
- Create: `components/insights/spend-by-category-chart.tsx`
- Create: `components/insights/trend-chart.tsx`
- Create: `app/(app)/expenses/insights/page.tsx`

**Interfaces:**
- Produces: `async function expensesByCategoryAndPeriod(userId: string, currency: Currency, monthsBack: number): Promise<CategorySpendRow[]>`; `SpendByCategoryChart` and `TrendChart` client components.
- Consumes: `pivotByCategory`, `trendSeries`, `CHART_SERIES`, `CHART_OTHER` (Task 7), `formatMoney` (P1), Recharts 3.

**Steps:**

- [ ] Run: `npm install recharts` - expect recharts 3.x added to `package.json`.
- [ ] Create `lib/insights/category-spend.ts`:

```ts
import { and, eq, gte, lt, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { expenseCategories, transactions } from '@/lib/db/schema'
import type { Currency } from '@/lib/money/money'
import { addPeriods, periodOf, todayCairo } from '@/lib/dates/cairo'
import type { CategorySpendRow } from '@/lib/insights/chart-data'

export async function expensesByCategoryAndPeriod(
  userId: string,
  currency: Currency,
  monthsBack: number,
): Promise<CategorySpendRow[]> {
  const current = periodOf(todayCairo())
  const from = addPeriods(current, -(monthsBack - 1)) // include the current month in insights
  return db
    .select({
      period: sql<string>`to_char(${transactions.occurredOn}, 'YYYY-MM')`,
      category: sql<string>`coalesce(${expenseCategories.name}, 'Uncategorized')`,
      totalMinor: sql<number>`sum(-${transactions.amountMinor})::int`,
    })
    .from(transactions)
    .leftJoin(expenseCategories, eq(transactions.categoryId, expenseCategories.id))
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.type, 'expense'),
        eq(transactions.currency, currency),
        gte(transactions.occurredOn, `${from}-01`),
        lt(transactions.occurredOn, `${addPeriods(current, 1)}-01`),
      ),
    )
    .groupBy(sql`1, 2`)
    .orderBy(sql`1`)
}
```

- [ ] Create `components/insights/spend-by-category-chart.tsx` (stacked bar; one series per category in fixed slot order; 'Other' always muted gray; 2px surface-colored stroke separates stacked segments; Recharts 3 keyboard accessibility is on by default):

```tsx
'use client'

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CHART_OTHER, CHART_SERIES } from '@/components/charts/palette'
import { formatMoney, type Currency } from '@/lib/money/money'

export function SpendByCategoryChart({
  categories,
  data,
  currency,
}: {
  categories: string[]
  data: Record<string, string | number>[]
  currency: Currency
}) {
  if (data.length === 0) {
    return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-neutral-500">No {currency} expenses yet.</p>
  }
  const fmt = (v: number) => formatMoney({ amountMinor: v, currency })
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="period" tickLine={false} axisLine={{ stroke: 'var(--chart-axis)' }} tick={{ fill: 'var(--chart-muted)', fontSize: 12 }} />
        <YAxis width={56} tickLine={false} axisLine={false} tick={{ fill: 'var(--chart-muted)', fontSize: 12 }} tickFormatter={(v: number) => (v / 100).toLocaleString()} />
        <Tooltip formatter={(v) => fmt(Number(v))} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {categories.map((cat, i) => (
          <Bar
            key={cat}
            dataKey={cat}
            stackId="spend"
            fill={cat === 'Other' ? CHART_OTHER : CHART_SERIES[i]}
            stroke="var(--chart-surface)"
            strokeWidth={2}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
```

- [ ] Create `components/insights/trend-chart.tsx` (single series per currency, so no legend box; the section heading names it):

```tsx
'use client'

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatMoney, type Currency } from '@/lib/money/money'

export function TrendChart({ data, currency }: { data: { period: string; totalMinor: number }[]; currency: Currency }) {
  if (data.every((d) => d.totalMinor === 0)) {
    return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-neutral-500">No {currency} expenses yet.</p>
  }
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="period" tickLine={false} axisLine={{ stroke: 'var(--chart-axis)' }} tick={{ fill: 'var(--chart-muted)', fontSize: 12 }} />
        <YAxis width={56} tickLine={false} axisLine={false} tick={{ fill: 'var(--chart-muted)', fontSize: 12 }} tickFormatter={(v: number) => (v / 100).toLocaleString()} />
        <Tooltip formatter={(v) => formatMoney({ amountMinor: Number(v), currency })} />
        <Line type="monotone" dataKey="totalMinor" stroke="var(--chart-1)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}
```

- [ ] Create `app/(app)/expenses/insights/page.tsx`:

```tsx
import { CURRENCIES } from '@/lib/money/money'
import { formatMoney } from '@/lib/money/money'
import { addPeriods, periodOf, todayCairo } from '@/lib/dates/cairo'
import { requireUser } from '@/lib/auth'
import { expensesByCategoryAndPeriod } from '@/lib/insights/category-spend'
import { pivotByCategory, trendSeries } from '@/lib/insights/chart-data'
import { SpendByCategoryChart } from '@/components/insights/spend-by-category-chart'
import { TrendChart } from '@/components/insights/trend-chart'

const MONTHS_BACK = 6

export default async function InsightsPage() {
  const user = await requireUser()
  const current = periodOf(todayCairo())
  const from = addPeriods(current, -(MONTHS_BACK - 1))
  const sections = await Promise.all(
    CURRENCIES.map(async (currency) => {
      const rows = await expensesByCategoryAndPeriod(user.id, currency, MONTHS_BACK)
      const perPeriod = new Map<string, number>()
      for (const r of rows) perPeriod.set(r.period, (perPeriod.get(r.period) ?? 0) + r.totalMinor)
      return {
        currency,
        pivot: pivotByCategory(rows),
        trend: trendSeries([...perPeriod].map(([period, totalMinor]) => ({ period, totalMinor })), from, current),
        totalMinor: rows.reduce((a, r) => a + r.totalMinor, 0),
      }
    }),
  )
  const active = sections.filter((s) => s.totalMinor > 0)

  return (
    <main className="mx-auto max-w-md space-y-6 p-4">
      <h1 className="text-xl font-semibold">Insights</h1>
      {active.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-neutral-500">
          No expenses yet. Log a few from the Expenses tab and charts appear here.
        </p>
      ) : (
        active.map((s) => (
          <section key={s.currency} className="space-y-3">
            <h2 className="font-medium">{s.currency} spend by category</h2>
            <SpendByCategoryChart categories={s.pivot.categories} data={s.pivot.data} currency={s.currency} />
            <ul className="text-xs text-neutral-500">
              {s.pivot.categories.map((cat) => (
                <li key={cat} className="flex justify-between">
                  <span>{cat}</span>
                  <span className="tabular-nums">
                    {formatMoney({
                      amountMinor: s.pivot.data.reduce((a, row) => a + Number(row[cat] ?? 0), 0),
                      currency: s.currency,
                    })}
                  </span>
                </li>
              ))}
            </ul>
            <h2 className="font-medium">{s.currency} monthly trend</h2>
            <TrendChart data={s.trend} currency={s.currency} />
          </section>
        ))
      )}
    </main>
  )
}
```

- [ ] Run: `npx tsc --noEmit` - expect PASS.
- [ ] Run: `npm run dev`, open `/expenses/insights` on a mobile viewport in both light and dark themes - per-currency sections render, stacked bars carry a legend and tooltips, the text totals list is present, currencies without data are absent, and with zero expenses the page-level empty state shows. Eyeball for label collisions and overflow.
- [ ] Commit: `git add lib/insights/category-spend.ts components/insights "app/(app)/expenses/insights/page.tsx" package.json package-lock.json && git commit -m "P6: insights screen with per-currency charts"`

---

### Task 9: Playwright flow

**Files:**
- Create: `e2e/expenses-insights.spec.ts`

**Interfaces:**
- Consumes: the P0 Playwright setup (test auth project, signed-in fixture) and an existing account from earlier E2E setup.

**Steps:**

- [ ] Create `e2e/expenses-insights.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

test('categories, tagged expenses, filtered list, insights charts', async ({ page }) => {
  // 1. create a category
  await page.goto('/expenses/categories')
  await page.getByLabel('Category name').fill('Groceries')
  await page.getByRole('button', { name: 'Add' }).click()
  await expect(page.getByText('Groceries')).toBeVisible()

  // 2. log a categorized expense and a one_off expense (P2 form)
  await page.goto('/transactions')
  await page.getByRole('button', { name: /add|new/i }).click()
  await page.getByLabel(/amount/i).fill('50.00')
  await page.getByLabel('Category').selectOption({ label: 'Groceries' })
  await page.getByRole('button', { name: /save|log/i }).click()

  await page.getByRole('button', { name: /add|new/i }).click()
  await page.getByLabel(/amount/i).fill('120.00')
  await page.getByLabel(/one-off/i).check()
  await page.getByRole('button', { name: /save|log/i }).click()

  // 3. expenses list: category filter narrows to one row
  await page.goto('/expenses')
  await expect(page.getByText('one-off')).toBeVisible()
  await page.locator('select[name="category"]').selectOption({ label: 'Groceries' })
  await page.getByRole('button', { name: 'Go' }).click()
  await expect(page.getByText('Groceries')).toBeVisible()
  await expect(page.getByText('one-off')).not.toBeVisible()

  // 4. insights: chart section for the expense currency, legend present
  await page.goto('/expenses/insights')
  await expect(page.getByRole('heading', { name: /spend by category/ })).toBeVisible()
  await expect(page.getByText('Groceries').first()).toBeVisible()
})
```

- [ ] Run: `npx playwright test e2e/expenses-insights.spec.ts` - expect FAIL only if earlier tasks are incomplete; otherwise PASS. Fix selectors to match the P2 form's actual labels if they differ (selector fixes only, no behavior changes).
- [ ] Run: `npx vitest run` - expect all unit tests green.
- [ ] Commit: `git add e2e/expenses-insights.spec.ts && git commit -m "P6: expenses + insights Playwright flow"`

---

**Phase gate:** `npx vitest run` green, `npx playwright test e2e/expenses-insights.spec.ts` green, manual mobile-viewport walkthrough of `/expenses`, `/expenses/categories`, `/expenses/insights` in light and dark themes.

Backlinks: [Plans index](../plans/README.md) | [Design spec](../specs/2026-07-07-my-ledger-design.md) | Previous: [05-installments.md](05-installments.md) | Next: [07-debts-and-planner.md](07-debts-and-planner.md)
