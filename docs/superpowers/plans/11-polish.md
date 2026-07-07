# Phase 11: Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

Backlinks: [Plans master index](../plans/README.md) | [Design spec](../specs/2026-07-07-my-ledger-design.md) (esp. §5.13, §7) | Previous: [10-cron-and-snapshots.md](10-cron-and-snapshots.md) | Back to: [README.md](README.md)

**Goal:** Ship the finish line: guided first-run empty states on the dashboard (checklist card, no blocking wizard), empty states on every list screen, route-group error and loading states, an inline form-error pattern for failed server actions, a concrete accessibility pass, a responsive audit (bottom tabs on mobile, sidebar from `md`), and one full-scenario Playwright walkthrough of the spec's top scenario, then the final all-green gate.

**Architecture:** P11 adds thin presentational pieces (EmptyState, SetupChecklist, FormErrors, error/loading boundaries, sidebar) and modifies existing screens from P0-P10; it introduces no new tables, actions with business logic, or engine changes. The walkthrough spec is the phase's real deliverable: it drives the whole app end to end through the browser against the test auth project, with the AI seam mocked exactly as in P9.

**Tech Stack:** Next.js App Router + TypeScript + Tailwind (mobile-first), Playwright, `@neondatabase/serverless` for the walkthrough's database reset, existing Vitest suites (this phase has fewer TDD units; every task instead ends in a concrete verifiable check).

**Global Constraints** (from [plans README](../plans/README.md), verbatim):

- Money: integer minor units, currencies `EUR|USD|EGP`, round half-up, balances derived ([spec §3](../specs/2026-07-07-my-ledger-design.md)).
- No transaction converts currency; transfer legs mutate as a group; source-linked transactions mutate only via owning flow.
- Day boundaries `Africa/Cairo`; due-date clamp `min(due_day, last_day_of_month)`.
- Occurrences unique per (user, kind, source, period); confirms guard on `status IN ('pending','overdue')`; snapshots unique per (user, date).
- All mutations = zod-validated server actions + `revalidatePath`; every table has `user_id`.
- TDD: failing test → minimal code → pass → commit. Frequent small commits.
- The deterministic engine owns all numbers; the AI only quotes.

**Phase conventions:** E2E specs in `e2e/`; imports use the `@/` alias. Playwright selectors use the domain vocabulary from [CONTEXT.md](../../../CONTEXT.md); if a built screen names a control differently, fix the screen's accessible name, not the test. The single test database means Playwright must run with `fullyParallel: false` and `workers: 1` (verify `playwright.config.ts`; set both if earlier phases have not).

---

### Task 1: shared `EmptyState` component

**Files:**
- Create: `components/empty-state.tsx`

**Interfaces:**
- Produces: `EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode })`. `action` takes the screen's existing add button or a `Link`, so each screen keeps its own add flow.

**Steps:**

- [ ] Create `components/empty-state.tsx`:

```tsx
import type { ReactNode } from 'react'

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="mt-12 flex flex-col items-center gap-2 px-6 text-center">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="max-w-sm text-sm text-zinc-500">{body}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
```

- [ ] Verify it compiles: `pnpm build`. Expected: exit 0.
- [ ] Commit: `git add components/empty-state.tsx && git commit -m "feat(polish): shared EmptyState component"`

---

### Task 2: first-run setup checklist on the dashboard

**Files:**
- Create: `components/setup-checklist.tsx`
- Modify: `app/(app)/page.tsx` (dashboard)

**Interfaces:**
- Consumes: row counts from `accounts`, `income_sources`, `bills`, `installments`, and `expense`-typed `transactions` (all `user_id`-scoped).
- Produces: `SetupChecklist({ state }: { state: SetupState })` with `interface SetupState { hasAccount: boolean; hasIncomeSource: boolean; hasCommitment: boolean; hasExpense: boolean }`.

Spec §5.13: guided empty states, no blocking wizard. The card lists four steps in order (create accounts, add income source, add bills or installments, log an expense), shows done steps struck through, links each pending step to its screen, and returns `null` (disappears) once all four are complete. The dashboard stays fully usable throughout.

**Steps:**

- [ ] Create `components/setup-checklist.tsx`:

```tsx
import Link from 'next/link'

export interface SetupState {
  hasAccount: boolean
  hasIncomeSource: boolean
  hasCommitment: boolean // any bill or installment
  hasExpense: boolean
}

const STEPS = [
  {
    key: 'hasAccount' as const,
    label: 'Create your accounts',
    href: '/accounts',
    hint: 'Add each wallet with its currency and opening balance.',
  },
  {
    key: 'hasIncomeSource' as const,
    label: 'Add your income source',
    href: '/income',
    hint: 'Your salary: amount, day of month, target account.',
  },
  {
    key: 'hasCommitment' as const,
    label: 'Add bills or installments',
    href: '/bills',
    hint: 'Recurring commitments the plan should expect.',
  },
  {
    key: 'hasExpense' as const,
    label: 'Log your first expense',
    href: '/expenses',
    hint: 'Day-to-day spending builds your real spend estimate.',
  },
]

export function SetupChecklist({ state }: { state: SetupState }) {
  if (STEPS.every((s) => state[s.key])) return null
  return (
    <section aria-label="Set up My Ledger" className="mt-4 rounded-lg border border-zinc-200 p-4">
      <h2 className="text-base font-semibold">Set up My Ledger</h2>
      <ul className="mt-2 flex flex-col">
        {STEPS.map((s) =>
          state[s.key] ? (
            <li key={s.key} className="flex min-h-11 items-center gap-2 text-sm text-zinc-400">
              <span aria-hidden="true">✓</span>
              <span className="line-through">{s.label}</span>
            </li>
          ) : (
            <li key={s.key}>
              <Link href={s.href} className="flex min-h-11 flex-col justify-center rounded px-1 hover:bg-zinc-50">
                <span className="text-sm font-medium">{s.label}</span>
                <span className="text-xs text-zinc-500">{s.hint}</span>
              </Link>
            </li>
          ),
        )}
      </ul>
    </section>
  )
}
```

- [ ] Wire into `app/(app)/page.tsx` above the attention list (the page already has `user` and `db` in scope):

```tsx
import { count, eq, and } from 'drizzle-orm'
import { SetupChecklist } from '@/components/setup-checklist'
import { accounts, bills, incomeSources, installments, transactions } from '@/lib/db/schema'

// inside the page component:
const [[acct], [inc], [bill], [inst], [exp]] = await Promise.all([
  db.select({ n: count() }).from(accounts).where(eq(accounts.userId, user.id)),
  db.select({ n: count() }).from(incomeSources).where(eq(incomeSources.userId, user.id)),
  db.select({ n: count() }).from(bills).where(eq(bills.userId, user.id)),
  db.select({ n: count() }).from(installments).where(eq(installments.userId, user.id)),
  db
    .select({ n: count() })
    .from(transactions)
    .where(and(eq(transactions.userId, user.id), eq(transactions.type, 'expense'))),
])

// in the returned JSX, above the attention list:
<SetupChecklist
  state={{
    hasAccount: acct.n > 0,
    hasIncomeSource: inc.n > 0,
    hasCommitment: bill.n + inst.n > 0,
    hasExpense: exp.n > 0,
  }}
/>
```

- [ ] Verify: `pnpm build` exits 0; `pnpm dev` with an empty user shows the card with "Create your accounts" linked; the card disappears once all four steps are done. (The walkthrough spec in Task 8 asserts both states.)
- [ ] Commit: `git add components/setup-checklist.tsx app/\(app\)/page.tsx && git commit -m "feat(polish): first-run setup checklist card on the dashboard"`

---

### Task 3: empty states on every list screen

**Files:**
- Modify: `app/(app)/transactions/page.tsx`, `app/(app)/bills/page.tsx`, `app/(app)/installments/page.tsx`, `app/(app)/debts/page.tsx`, `app/(app)/wishlist/page.tsx`, `app/(app)/expenses/page.tsx` (insights live here per the module map)

**Interfaces:**
- Consumes: `EmptyState` (Task 1); each page's existing list query and existing add control.

Exact copy per screen:

| Screen | Title | Body |
|---|---|---|
| Transactions | No transactions yet | Money you log or confirm shows up here, newest first. |
| Bills | No bills yet | Add recurring commitments like rent or internet and confirm them each month. |
| Installments | No installments yet | Track fixed monthly payments with a countdown until they are done. |
| Debts | No debts yet | Track money you owe, with or without a deadline, and let the plan pay it down. |
| Wishlist | Nothing on the wishlist | Add things you want to buy and the plan will tell you when you can afford them. |
| Expenses | No expenses yet | Log day-to-day spending to unlock category insights and a real spend estimate. |

**Steps:**

- [ ] In `app/(app)/transactions/page.tsx`, where the list renders, guard on the already-fetched rows:

```tsx
import { EmptyState } from '@/components/empty-state'

{rows.length === 0 ? (
  <EmptyState
    title="No transactions yet"
    body="Money you log or confirm shows up here, newest first."
  />
) : (
  /* existing list rendering, unchanged */
)}
```

- [ ] In `app/(app)/bills/page.tsx` (keep the screen's existing add button visible above or pass it as `action`):

```tsx
import { EmptyState } from '@/components/empty-state'

{rows.length === 0 ? (
  <EmptyState
    title="No bills yet"
    body="Add recurring commitments like rent or internet and confirm them each month."
  />
) : (
  /* existing list rendering, unchanged */
)}
```

- [ ] In `app/(app)/installments/page.tsx`:

```tsx
import { EmptyState } from '@/components/empty-state'

{rows.length === 0 ? (
  <EmptyState
    title="No installments yet"
    body="Track fixed monthly payments with a countdown until they are done."
  />
) : (
  /* existing list rendering, unchanged */
)}
```

- [ ] In `app/(app)/debts/page.tsx`:

```tsx
import { EmptyState } from '@/components/empty-state'

{rows.length === 0 ? (
  <EmptyState
    title="No debts yet"
    body="Track money you owe, with or without a deadline, and let the plan pay it down."
  />
) : (
  /* existing list rendering, unchanged */
)}
```

- [ ] In `app/(app)/wishlist/page.tsx`:

```tsx
import { EmptyState } from '@/components/empty-state'

{rows.length === 0 ? (
  <EmptyState
    title="Nothing on the wishlist"
    body="Add things you want to buy and the plan will tell you when you can afford them."
  />
) : (
  /* existing list rendering, unchanged */
)}
```

- [ ] In `app/(app)/expenses/page.tsx`, guard both the expense list and the insights charts section with the same condition:

```tsx
import { EmptyState } from '@/components/empty-state'

{rows.length === 0 ? (
  <EmptyState
    title="No expenses yet"
    body="Log day-to-day spending to unlock category insights and a real spend estimate."
  />
) : (
  /* existing list + insights charts, unchanged */
)}
```

- [ ] Verify: `pnpm build` exits 0. The walkthrough spec (Task 8) asserts each empty state on a wiped database.
- [ ] Commit: `git add app/\(app\)/transactions/page.tsx app/\(app\)/bills/page.tsx app/\(app\)/installments/page.tsx app/\(app\)/debts/page.tsx app/\(app\)/wishlist/page.tsx app/\(app\)/expenses/page.tsx && git commit -m "feat(polish): empty states for all list screens"`

---

### Task 4: route-group error and loading states

**Files:**
- Create: `app/(app)/error.tsx`, `app/(app)/loading.tsx`

**Steps:**

- [ ] Create `app/(app)/error.tsx`:

```tsx
'use client'

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="mt-16 flex flex-col items-center gap-3 px-6 text-center">
      <h2 className="text-base font-semibold">Something went wrong</h2>
      <p className="max-w-sm text-sm text-zinc-500">
        Your data is safe; nothing was lost. Try again, and if it keeps failing reload the page.
      </p>
      {error.digest ? <p className="text-xs text-zinc-400">Reference: {error.digest}</p> : null}
      <button
        type="button"
        onClick={reset}
        className="min-h-11 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white"
      >
        Try again
      </button>
    </div>
  )
}
```

- [ ] Create `app/(app)/loading.tsx`:

```tsx
export default function AppLoading() {
  return (
    <div className="mt-16 px-6 text-center" role="status" aria-live="polite">
      <p className="text-sm text-zinc-500">Loading...</p>
    </div>
  )
}
```

- [ ] Verify: `pnpm build` exits 0. Manually confirm the error boundary by temporarily throwing in a page under `(app)` in dev, seeing the boundary render, then reverting the throw.
- [ ] Commit: `git add app/\(app\)/error.tsx app/\(app\)/loading.tsx && git commit -m "feat(polish): error and loading boundaries for the app route group"`

---

### Task 5: form-level error pattern for failed server actions

**Files:**
- Create: `lib/actions/result.ts`, `components/form-errors.tsx`
- Modify: the account create form + action (P1) and the wishlist add form + action (P8) as the two reference implementations

**Interfaces:**
- Produces:

```ts
// lib/actions/result.ts
export type ActionResult =
  | { ok: true }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string[]> }
```

The repo-wide pattern: server actions used by forms take `(prev: ActionResult | undefined, formData: FormData)`, `safeParse` with their existing zod schema, and on failure return the flattened issues instead of throwing; clients render them inline with `FormErrors` via `useActionState`. Unexpected (non-validation) errors still throw and land in Task 4's error boundary.

**Steps:**

- [ ] Create `lib/actions/result.ts` with the type above (exactly, nothing more).
- [ ] Create `components/form-errors.tsx`:

```tsx
import type { ActionResult } from '@/lib/actions/result'

export function FormErrors({ result, field }: { result: ActionResult | undefined; field?: string }) {
  if (!result || result.ok) return null
  const messages = field ? (result.fieldErrors?.[field] ?? []) : result.formError ? [result.formError] : []
  if (messages.length === 0) return null
  return (
    <div role="alert" className="mt-1 text-sm text-red-600">
      {messages.map((m) => (
        <p key={m}>{m}</p>
      ))}
    </div>
  )
}
```

- [ ] Reference implementation 1, the account create action (adapt the P1 action in `lib/actions/accounts.ts` to this shape, keeping its schema and insert logic unchanged):

```ts
import type { ActionResult } from '@/lib/actions/result'

export async function createAccount(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser()
  const parsed = createAccountSchema.safeParse({
    name: formData.get('name'),
    currency: formData.get('currency'),
    openingBalance: formData.get('openingBalance'),
  })
  if (!parsed.success) {
    const flat = parsed.error.flatten()
    return { ok: false, formError: flat.formErrors.join(' '), fieldErrors: flat.fieldErrors }
  }
  // existing P1 logic, unchanged: insert account + post the opening transaction
  await insertAccountWithOpeningBalance(user.id, parsed.data)
  revalidatePath('/accounts')
  return { ok: true }
}
```

And in the account form client component:

```tsx
'use client'

import { useActionState } from 'react'
import { FormErrors } from '@/components/form-errors'
import { createAccount } from '@/lib/actions/accounts'

const [result, formAction] = useActionState(createAccount, undefined)

// in the JSX:
<form action={formAction}>
  {/* existing labelled inputs, unchanged */}
  <FormErrors result={result} field="name" />
  <FormErrors result={result} field="openingBalance" />
  <FormErrors result={result} />
  {/* existing submit button */}
</form>
```

- [ ] Reference implementation 2: apply the identical shape to the wishlist add action in `lib/actions/wishlist.ts` (safeParse, return `ActionResult`, `revalidatePath('/wishlist')`, `{ ok: true }`) and render `<FormErrors result={result} field="name" />`, `<FormErrors result={result} field="cost" />`, and `<FormErrors result={result} />` in the wishlist form via `useActionState`.
- [ ] Sweep the remaining form actions (transactions, income, bills, installments, debts, settings): any action a user can fail with bad input (unparseable amount, missing name) gets the same treatment. Actions unreachable with invalid input (e.g. a confirm button with no free-typed fields) stay as they are.
- [ ] Verify: `pnpm build` exits 0; `pnpm test` stays green; in dev, submitting the account form with an empty name shows the inline zod message instead of crashing to the error boundary.
- [ ] Commit: `git add lib/actions/result.ts components/form-errors.tsx lib/actions app components && git commit -m "feat(polish): inline zod error pattern for server-action forms"`

---

### Task 6: accessibility pass

**Files:**
- Modify: `app/globals.css`, `app/(app)/page.tsx` (attention list), plus any screens the checklist below flags

**The concrete checklist** (each item is verified, not assumed):

1. All interactive elements have tap targets of at least 44px: every `button`, `a`, `summary`, and labelled checkbox row carries `min-h-11` (44px) or larger. Verify with `grep -rn "<button\|<Link\|<summary" app components | grep -v "min-h-11"` and fix each hit.
2. Visible focus: a global `:focus-visible` outline so keyboard users always see where they are.
3. Labels on all inputs: every `input`, `select`, `textarea` has a `<label htmlFor>` or `aria-label`. Verified mechanically by the walkthrough spec, which drives every form via `getByLabel` and fails on any unlabeled control.
4. The attention list count announces changes: `aria-live="polite"` on the count element.
5. Chart palette contrast: the trend and insights lines use `#2563eb` (blue) and `#dc2626` (red), both at or above the 3:1 non-text contrast minimum against white (WCAG 1.4.11), with adjacent text in default zinc-900.
6. `prefers-reduced-motion` respected globally, including Recharts (`isAnimationActive={false}` already set in P10; the CSS below covers CSS transitions).

**Steps:**

- [ ] Append to `app/globals.css`:

```css
:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] In `app/(app)/page.tsx`, wrap the attention list count so updates are announced:

```tsx
<h2 className="text-base font-semibold">
  Needs attention{' '}
  <span aria-live="polite" className="text-zinc-500">
    ({attentionItems.length})
  </span>
</h2>
```

- [ ] Run the tap-target grep from checklist item 1; add `min-h-11` (and `min-w-11` on icon-only buttons) to each flagged element.
- [ ] Run the label grep `grep -rn "<input\|<select\|<textarea" app components` and confirm every hit has an associated label; fix any that do not.
- [ ] Verify: `pnpm build` exits 0; keyboard-tab through the dashboard, one form, and the plan screen in dev, confirming a visible focus ring on every stop; toggle "reduce motion" in OS settings and confirm no animation remains.
- [ ] Commit: `git add app components && git commit -m "feat(polish): a11y pass - focus rings, tap targets, labels, aria-live, reduced motion"`

---

### Task 7: responsive audit (bottom tabs mobile, sidebar from md)

**Files:**
- Create: `components/sidebar-nav.tsx`
- Modify: `app/(app)/layout.tsx` (P0 shell)

**Interfaces:**
- Consumes: the P0 bottom tab bar (stays as-is for mobile).
- Produces: a `SidebarNav` listing every destination, hidden below `md`; the bottom tab bar gains `md:hidden`; the content column gains `md:pl-56`.

**Steps:**

- [ ] Create `components/sidebar-nav.tsx`:

```tsx
import Link from 'next/link'

const DESTINATIONS = [
  { href: '/', label: 'Dashboard' },
  { href: '/accounts', label: 'Accounts' },
  { href: '/transactions', label: 'Transactions' },
  { href: '/income', label: 'Income' },
  { href: '/bills', label: 'Bills' },
  { href: '/installments', label: 'Installments' },
  { href: '/expenses', label: 'Expenses' },
  { href: '/debts', label: 'Debts' },
  { href: '/wishlist', label: 'Wishlist' },
  { href: '/plan', label: 'Plan' },
  { href: '/settings', label: 'Settings' },
]

export function SidebarNav() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-y-0 left-0 hidden w-56 flex-col gap-1 border-r border-zinc-200 p-4 md:flex"
    >
      <p className="px-2 pb-2 text-sm font-semibold">My Ledger</p>
      {DESTINATIONS.map((d) => (
        <Link
          key={d.href}
          href={d.href}
          className="flex min-h-11 items-center rounded px-2 text-sm hover:bg-zinc-100"
        >
          {d.label}
        </Link>
      ))}
    </nav>
  )
}
```

- [ ] In `app/(app)/layout.tsx`: render `<SidebarNav />` alongside the existing bottom tab bar, add `md:hidden` to the bottom tab bar's outer element, and add `md:pl-56` to the main content wrapper so content clears the sidebar.
- [ ] Responsive audit in dev at 375px, 768px, and 1280px widths on every screen: no horizontal scroll, bottom tabs only below `md`, sidebar only at `md` and up, charts and tables fit or scroll inside their own container.
- [ ] Verify: `pnpm build` exits 0; `pnpm exec playwright test` stays green (the existing mobile-viewport specs must be unaffected).
- [ ] Commit: `git add components/sidebar-nav.tsx app/\(app\)/layout.tsx && git commit -m "feat(polish): md+ sidebar nav, bottom tabs mobile-only"`

---

### Task 8: full-scenario walkthrough E2E

**Files:**
- Create: `e2e/walkthrough.spec.ts`

**Interfaces:**
- Consumes: the whole app; `@neondatabase/serverless` raw SQL for the initial reset; `page.route` on `**/api/ai/advice` (the P9 seam, so no Gemini traffic); env `E2E_EMAIL` / `E2E_PASSWORD`, `DATABASE_URL`.

This is the spec's top scenario (§1, §7) as one Playwright spec. It intentionally starts from a wiped database, so it also proves Task 2's checklist and Task 3's empty states. It must run serially with everything else (`workers: 1`).

**Steps:**

- [ ] Write `e2e/walkthrough.spec.ts`:

```ts
import { neon } from '@neondatabase/serverless'
import { expect, test, type Page } from '@playwright/test'

const sql = neon(process.env.DATABASE_URL!)

async function signIn(page: Page) {
  await page.goto('/')
  if (await page.getByLabel('Email').isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.getByLabel('Email').fill(process.env.E2E_EMAIL!)
    await page.getByLabel('Password').fill(process.env.E2E_PASSWORD!)
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL('**/')
  }
}

async function wipeUserData() {
  const rows = (await sql`select user_id from settings limit 1`) as { user_id: string }[]
  if (rows.length === 0) return
  const userId = rows[0].user_id
  // Order matters only for readability; every table is user_id-scoped.
  for (const table of [
    'ai_advice_cache',
    'net_worth_snapshots',
    'occurrences',
    'wishlist_items',
    'flexible_debts',
    'installments',
    'bills',
    'income_sources',
    'expense_categories',
    'transactions',
    'accounts',
  ]) {
    await sql.query(`delete from ${table} where user_id = $1`, [userId])
  }
}

async function createAccount(page: Page, name: string, currency: string, opening: string) {
  await page.goto('/accounts')
  await page.getByRole('button', { name: /add account/i }).click()
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Currency').selectOption(currency)
  await page.getByLabel('Opening balance').fill(opening)
  await page.getByRole('button', { name: /save/i }).click()
  await expect(page.getByText(name)).toBeVisible()
}

test.describe.configure({ mode: 'serial' })

test('full scenario walkthrough', async ({ page }) => {
  test.setTimeout(240_000)

  // Mock the AI seam for the whole test: no Gemini traffic, deterministic panel.
  await page.route('**/api/ai/advice', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        advice: 'Mocked second opinion: the payoff order looks right; debtB first.',
      }),
    })
  })

  // 1. Sign in against a wiped database.
  await signIn(page)
  await wipeUserData()

  // 2. First-run: dashboard shows the setup checklist, list screens show empty states.
  await page.goto('/')
  await expect(page.getByLabel('Set up My Ledger')).toBeVisible()
  await expect(page.getByRole('link', { name: /create your accounts/i })).toBeVisible()
  await page.goto('/transactions')
  await expect(page.getByText('No transactions yet')).toBeVisible()
  await page.goto('/bills')
  await expect(page.getByText('No bills yet')).toBeVisible()
  await page.goto('/installments')
  await expect(page.getByText('No installments yet')).toBeVisible()
  await page.goto('/debts')
  await expect(page.getByText('No debts yet')).toBeVisible()
  await page.goto('/wishlist')
  await expect(page.getByText('Nothing on the wishlist')).toBeVisible()
  await page.goto('/expenses')
  await expect(page.getByText('No expenses yet')).toBeVisible()

  // 3. Create the three per-currency accounts with opening balances.
  await createAccount(page, 'Revolut EUR', 'EUR', '3400.00')
  await createAccount(page, 'Payoneer USD', 'USD', '500.00')
  await createAccount(page, 'CIB EGP', 'EGP', '95000.00')

  // 4. Add the salary income source.
  await page.goto('/income')
  await page.getByRole('button', { name: /add income source/i }).click()
  await page.getByLabel('Name').fill('Salary')
  await page.getByLabel('Amount').fill('2500.00')
  await page.getByLabel('Currency').selectOption('EUR')
  await page.getByLabel('Day of month').fill('25')
  await page.getByLabel('Account').selectOption({ label: 'Revolut EUR' })
  await page.getByRole('button', { name: /save/i }).click()
  await expect(page.getByText('Salary')).toBeVisible()

  // 5. Dashboard housekeeping generated the occurrence; confirm the salary.
  await page.goto('/')
  await expect(page.getByText('Salary')).toBeVisible()
  await page.getByRole('button', { name: /confirm/i }).first().click()
  await page.getByRole('button', { name: /confirm/i }).last().click() // pre-filled sheet, accept actuals
  await expect(page.getByText(/confirmed/i).first()).toBeVisible()

  // 6. Add the rent bill (due day 1 makes this month's occurrence overdue) and confirm it.
  await page.goto('/bills')
  await page.getByRole('button', { name: /add bill/i }).click()
  await page.getByLabel('Name').fill('Rent')
  await page.getByLabel('Amount').fill('12000.00')
  await page.getByLabel('Currency').selectOption('EGP')
  await page.getByLabel('Due day').fill('1')
  await page.getByLabel('Account').selectOption({ label: 'CIB EGP' })
  await page.getByRole('button', { name: /save/i }).click()
  await page.goto('/')
  await expect(page.getByText('Rent')).toBeVisible()
  await expect(page.getByText(/overdue/i).first()).toBeVisible()
  await page.getByRole('button', { name: /confirm/i }).first().click()
  await page.getByRole('button', { name: /confirm/i }).last().click()

  // 7. Add an installment and confirm one payment.
  await page.goto('/installments')
  await page.getByRole('button', { name: /add installment/i }).click()
  await page.getByLabel('Name').fill('Phone installment')
  await page.getByLabel('Monthly amount').fill('1500.00')
  await page.getByLabel('Currency').selectOption('EGP')
  await page.getByLabel('Due day').fill('10')
  await page.getByLabel('Total count').fill('12')
  await page.getByLabel('Remaining count').fill('8')
  await page.getByLabel('Start date').fill('2026-03-10')
  await page.getByLabel('Account').selectOption({ label: 'CIB EGP' })
  await page.getByRole('button', { name: /save/i }).click()
  await page.goto('/')
  await expect(page.getByText('Phone installment')).toBeVisible()
  await page.getByRole('button', { name: /confirm/i }).first().click()
  await page.getByRole('button', { name: /confirm/i }).last().click()
  await page.goto('/installments')
  await expect(page.getByText(/7.*remaining|remaining.*7/i)).toBeVisible()

  // 8. Add a flexible debt with a deadline plus an ASAP debt.
  await page.goto('/debts')
  await page.getByRole('button', { name: /add debt/i }).click()
  await page.getByLabel('Name').fill('Loan from Dad')
  await page.getByLabel('Amount').fill('50000.00')
  await page.getByLabel('Currency').selectOption('EGP')
  await page.getByLabel('APR').fill('0')
  await page.getByLabel('Deadline').fill('2026-12-31')
  await page.getByRole('button', { name: /save/i }).click()
  await expect(page.getByText('Loan from Dad')).toBeVisible()
  await page.getByRole('button', { name: /add debt/i }).click()
  await page.getByLabel('Name').fill('Credit card')
  await page.getByLabel('Amount').fill('900.00')
  await page.getByLabel('Currency').selectOption('USD')
  await page.getByLabel('APR').fill('24')
  await page.getByRole('button', { name: /save/i }).click()
  await expect(page.getByText('Credit card')).toBeVisible()

  // 9. Log expenses, including a one_off.
  await page.goto('/expenses')
  await page.getByRole('button', { name: /log expense/i }).click()
  await page.getByLabel('Amount').fill('850.00')
  await page.getByLabel('Account').selectOption({ label: 'CIB EGP' })
  await page.getByLabel('Note').fill('Groceries')
  await page.getByRole('button', { name: /save/i }).click()
  await page.getByRole('button', { name: /log expense/i }).click()
  await page.getByLabel('Amount').fill('3000.00')
  await page.getByLabel('Account').selectOption({ label: 'CIB EGP' })
  await page.getByLabel('Note').fill('Car repair')
  await page.getByLabel('One-off').check()
  await page.getByRole('button', { name: /save/i }).click()

  // 10. Add a wishlist item with a target date.
  await page.goto('/wishlist')
  await page.getByRole('button', { name: /add item/i }).click()
  await page.getByLabel('Name').fill('Standing desk')
  await page.getByLabel('Cost').fill('400.00')
  await page.getByLabel('Currency').selectOption('EUR')
  await page.getByLabel('Priority').fill('1')
  await page.getByLabel('Target date').fill('2026-11-01')
  await page.getByRole('button', { name: /save/i }).click()
  await expect(page.getByText('Standing desk')).toBeVisible()

  // 11. Plan screen: algorithm numbers, funding gap (900 USD debt vs 500 USD balance),
  //     and the mocked AI panel.
  await page.goto('/plan')
  await expect(page.getByText(/payoff/i).first()).toBeVisible()
  await expect(page.getByText(/20\d\d-\d\d/).first()).toBeVisible()
  await expect(page.getByText(/funding gap/i).first()).toBeVisible()
  await expect(page.getByText('Mocked second opinion')).toBeVisible()
  await page.getByText('What gets sent').click()
  const payloadText = await page.getByTestId('ai-payload').textContent()
  expect(payloadText).toContain('debtA')
  expect(payloadText).not.toContain('Loan from Dad')

  // 12. Purchase the wishlist item.
  await page.goto('/wishlist')
  await page.getByRole('button', { name: /purchase/i }).click()
  await page.getByLabel('Account').selectOption({ label: 'Revolut EUR' })
  await page.getByRole('button', { name: /confirm purchase/i }).click()
  await expect(page.getByText(/purchased/i)).toBeVisible()

  // 13. Dashboard: attention list has nothing left; trends section renders
  //     (seed one prior-day snapshot so two points exist).
  const rows = (await sql`select user_id from settings limit 1`) as { user_id: string }[]
  const userId = rows[0].user_id
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  await sql`
    insert into net_worth_snapshots
      (user_id, date, per_currency, combined_minor, home_currency, rates, total_debt_minor)
    values
      (${userId}, ${yesterday}, ${'{"EUR": 340000}'}::jsonb, 340000, 'EUR',
       ${'{"base":"USD","rates":{"USD":1,"EUR":0.9,"EGP":50},"fetchedAt":"2026-07-06T03:00:00.000Z"}'}::jsonb, 0)
    on conflict (user_id, date) do nothing
  `
  await page.goto('/')
  const attention = page.getByLabel(/attention|needs attention/i)
  await expect(attention.getByRole('button', { name: /confirm/i })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: /^Net worth \(/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: /^Total debt \(/ })).toBeVisible()
  // Setup checklist is gone: all four steps are complete.
  await expect(page.getByLabel('Set up My Ledger')).toHaveCount(0)
})
```

- [ ] Run `pnpm exec playwright test e2e/walkthrough.spec.ts`. Expected: PASS. Every selector miss means an accessible name drifted from the domain vocabulary; fix the screen, re-run.
- [ ] Commit: `git add e2e/walkthrough.spec.ts && git commit -m "test(polish): full-scenario walkthrough e2e of the spec top scenario"`

---

### Task 9: definition of done (final gate)

**Files:**
- Modify: `docs/wiki/status.md`

Evidence before assertions: run every gate and read the output before claiming anything.

**Steps:**

- [ ] Run the full unit suite: `pnpm test`. Expected: all suites from P0-P11 green, zero skipped.
- [ ] Run the full E2E suite: `pnpm exec playwright test`. Expected: all specs green, including the walkthrough.
- [ ] Run the production build: `pnpm build`. Expected: exit 0, no type errors.
- [ ] Manual mobile-viewport (375px) walkthrough mirroring the Task 8 scenario by hand, plus one pass at desktop width for the sidebar.
- [ ] Only after all four checks pass, update `docs/wiki/status.md`: set P11 (and any straggler rows) to `done` and replace the header line "planning complete, no app code yet" with the shipped state, keeping the instruction "Update this page whenever a phase starts or completes."
- [ ] Commit: `git add docs/wiki/status.md && git commit -m "docs(status): P11 polish complete, v1 shipped"`

---

Backlinks: [Plans master index](../plans/README.md) | [Design spec](../specs/2026-07-07-my-ledger-design.md) | Previous: [10-cron-and-snapshots.md](10-cron-and-snapshots.md) | Back to: [README.md](README.md)
