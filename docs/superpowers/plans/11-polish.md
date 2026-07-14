# Phase 11: Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

Backlinks: [Plans master index](../plans/README.md) | [Design spec](../specs/2026-07-07-my-ledger-design.md) (esp. §5.13, §7) | Previous: [10-cron-and-snapshots.md](10-cron-and-snapshots.md) | Back to: [README.md](README.md)

**Goal:** Ship the finish line: guided first-run empty states on the dashboard (checklist card, no blocking wizard), re-skinned empty states on every list screen (each screen already ships inline copy; Task 3 moves it onto the shared component), route-group error and loading states, an inline form-error pattern for failed server actions, a concrete accessibility pass, a responsive audit (bottom tabs on mobile, sidebar from `md`), and one full-scenario Playwright walkthrough of the spec's top scenario, then the final all-green gate.

**Architecture:** P11 adds thin presentational pieces (EmptyState, SetupChecklist, FormErrors, error/loading boundaries, sidebar) and modifies existing screens from P0-P10; it introduces no new tables, actions with business logic, or engine changes. The walkthrough spec is the phase's real deliverable: it drives the whole app end to end through the browser against the test auth project, with the AI seam mocked exactly as in P9.

**Tech Stack:** Next.js App Router + TypeScript + Tailwind (mobile-first), Playwright, `@neondatabase/serverless` for the walkthrough's snapshot seed, existing Vitest suites (this phase has fewer TDD units; every task instead ends in a concrete verifiable check).

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

- [ ] Verify it compiles: `npm run build`. Expected: exit 0.
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

- [ ] Verify: `npm run build` exits 0; `npm run dev` with an empty user shows the card with "Create your accounts" linked; the card disappears once all four steps are done. (The walkthrough spec in Task 8 asserts both states.)
- [ ] Commit: `git add components/setup-checklist.tsx app/\(app\)/page.tsx && git commit -m "feat(polish): first-run setup checklist card on the dashboard"`

---

### Task 3: re-skin the existing inline empty states with `EmptyState`

**Files:**
- Modify: `app/(app)/accounts/page.tsx`, `app/(app)/transactions/page.tsx`, `app/(app)/income/page.tsx`, `app/(app)/bills/page.tsx`, `app/(app)/installments/page.tsx`, `app/(app)/debts/page.tsx`, `app/(app)/wishlist/page.tsx`, `app/(app)/expenses/page.tsx`, `app/(app)/expenses/categories/page.tsx`, `app/(app)/expenses/insights/page.tsx`, `app/(app)/plan/page.tsx`

**Interfaces:**
- Consumes: `EmptyState` (Task 1); each page's existing list query and existing add control.

Every list screen ALREADY ships an inline empty state with its own copy (a bare `<p>` or `<li>`); this task is not "add empty states", it is "re-skin the existing inline empty states with the shared `EmptyState` component, keeping the existing copy by default" (the walkthrough spec asserts these exact strings). The definitive set:

| Screen | Existing copy (kept) |
|---|---|
| /accounts | No accounts yet. |
| /transactions | Nothing here yet. |
| /income | No income sources yet. |
| /bills | No bills yet. |
| /installments | No installments yet. |
| /debts | No flexible debts. Add one to see it in the plan. |
| /wishlist | Nothing here yet. Add something you are saving for. |
| /expenses | No expenses in {period}. |
| /expenses/categories | No categories yet. Add one above; expenses can also stay uncategorized. |
| /expenses/insights | No expenses yet. Log a few from the Expenses tab and charts appear here. |
| /plan | Two branches: the no-debts message in the Debt payoff section ("No flexible debts. Add one to see a payoff plan.") and the timeline's "Nothing scheduled in the coming months." |

Note: insights is its own route (`/expenses/insights`) with its own empty state; it does not live under `/expenses`.

**Steps:**

- [ ] For each screen above, replace the inline empty-state element with `EmptyState`. Single-sentence copy becomes the `title`; two-sentence copy splits first sentence into `title`, rest into `body`. Example for `/bills`:

```tsx
import { EmptyState } from '@/components/empty-state'

{rows.length === 0 ? (
  <EmptyState title="No bills yet." body="Recurring commitments the plan should expect show up here." />
) : (
  /* existing list rendering, unchanged */
)}
```

- [ ] Where the empty state renders as an `<li>` inside the list today (`/accounts`, `/transactions`, `/income`, `/bills`, `/installments`), move the guard outside so `EmptyState` replaces the empty `<ul>` instead of rendering inside it.
- [ ] `/plan`: re-skin both branches - keep the no-debts message's "Add one" link (pass it as the `action` prop) and keep the timeline's `PlanTimeline` string, either in place or lifted into `EmptyState`.
- [ ] Verify: `npm run build` exits 0. The walkthrough spec (Task 8) asserts each empty state for its fresh first-run user.
- [ ] Commit: `git add app/\(app\)/ && git commit -m "feat(polish): re-skin list empty states with shared EmptyState"`

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

- [ ] Verify: `npm run build` exits 0. Manually confirm the error boundary by temporarily throwing in a page under `(app)` in dev, seeing the boundary render, then reverting the throw.
- [ ] Commit: `git add app/\(app\)/error.tsx app/\(app\)/loading.tsx && git commit -m "feat(polish): error and loading boundaries for the app route group"`

---

### Task 5: form-level error pattern for failed server actions

**Files:**
- Modify: `lib/actions/definitions.ts` (extend the existing `ActionResult` in place)
- Create: `components/form-errors.tsx`
- Modify: `lib/actions/accounts.ts` + `app/(app)/accounts/new/page.tsx` + `components/account-settings-form.tsx` (the reference implementation), plus the wishlist/debt client components that call throwing actions

**Interfaces:**
- `lib/actions/definitions.ts` ALREADY exports `type ActionResult = { ok: true } | { ok: false; error: string }`, consumed by the bills/income/installments actions and read as `.error` in their form components. Do NOT create a second type or a new file; extend the existing one in place, backward compatibly:

```ts
// lib/actions/definitions.ts - existing type, extended in place
export type ActionResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }
```

All existing `.error` call sites keep working unchanged (no new file, no rename). The repo-wide pattern: form actions `safeParse` with their existing zod schema and on validation failure return `{ ok: false, error, fieldErrors }` instead of throwing; clients render the result inline with `FormErrors`. Unexpected (non-validation) errors still throw and land in Task 4's error boundary.

**Steps:**

- [ ] Extend `ActionResult` in `lib/actions/definitions.ts` as above. Verify `npx vitest run` and `npx tsc --noEmit` stay green before touching anything else (the change is additive, so they must).
- [ ] Create `components/form-errors.tsx`, importing from the existing module:

```tsx
import type { ActionResult } from '@/lib/actions/definitions'

export function FormErrors({ result, field }: { result: ActionResult | null | undefined; field?: string }) {
  if (!result || result.ok) return null
  const message = field ? result.fieldErrors?.[field] : result.error
  if (!message) return null
  return (
    <p role="alert" className="mt-1 text-sm text-red-600">
      {message}
    </p>
  )
}
```

- [ ] Reference implementation: `lib/actions/accounts.ts`. Verify its current shape first: it defines its own `ActionState = { error: string } | null`, and `createAccount`, `renameAccount`, and `archiveAccount` all take `(prev, formData)` via `useActionState` and end with `revalidatePath('/accounts')` + `redirect('/accounts')` on success. Convert ALL THREE together (so the file does not end up with two patterns): replace `ActionState` with `ActionResult` from `./definitions`, and on validation failure return the field errors. The shipped redirect-on-success MUST be preserved; a `{ ok: true }` return that leaves the user sitting on the form is a regression:

```ts
import { type ActionResult } from './definitions'

export async function createAccount(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser()
  const parsed = createAccountSchema.safeParse({
    name: formData.get('name'),
    currency: formData.get('currency'),
    openingBalance: formData.get('openingBalance') || '0',
  })
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] = issue.message
    return { ok: false, error: parsed.error.issues[0].message, fieldErrors }
  }
  // existing P1 logic, unchanged: insert account + post the opening transaction
  revalidatePath('/accounts')
  redirect('/accounts') // success still navigates; redirect() throws, so nothing is returned here
}
```

Update the two consumers (`app/(app)/accounts/new/page.tsx`, `components/account-settings-form.tsx`) from `state?.error` to `FormErrors`:

```tsx
'use client'

import { useActionState } from 'react'
import { FormErrors } from '@/components/form-errors'
import { createAccount } from '@/lib/actions/accounts'
import type { ActionResult } from '@/lib/actions/definitions'

const [result, formAction] = useActionState<ActionResult | null, FormData>(createAccount, null)

// in the JSX:
<form action={formAction}>
  {/* existing labelled inputs, unchanged */}
  <FormErrors result={result} field="name" />
  <FormErrors result={result} field="openingBalance" />
  <FormErrors result={result} />
  {/* existing submit button */}
</form>
```

- [ ] Handle the THROWN server-action errors explicitly. `deleteWishlistItem` (its helper throws "Purchased items must be un-purchased before deleting"), `deleteDebt` (throws "This debt has payments; reverse them first"), and the purchase/un-purchase flow (`purchaseItem`/`unpurchaseItem` throw on archived accounts, currency mismatch, concurrent changes) all THROW; today their forms call them with no try/catch, so after Task 4 those throws become full-page error boundaries. Wrap these specific calls in try/catch in a client component and render the caught `error.message` inline via local state:
  - `components/wishlist/purchase-sheet.tsx` (client): wrap the `purchaseWishlistItem` call.
  - `components/wishlist/wishlist-item-form.tsx` (client): wrap the `createWishlistItem`/`updateWishlistItem` calls; note `parseToMinor(cost, currency)` in the action closure also throws client-side on an unparseable cost, so the same try/catch covers bad input.
  - `app/(app)/wishlist/page.tsx` un-purchase form and `app/(app)/wishlist/[id]/page.tsx` delete form: both are inline `'use server'` forms in server components with no client boundary to hold error state; extract each into a small `'use client'` form component with try/catch + inline error.
  - `app/(app)/debts/[id]/page.tsx` "Reverse" form (calls `deleteDebtPayment`, which throws through `reverseDebtPayment`): same inline-server-form situation, same extraction.
  - `deleteDebt` currently has NO UI affordance (verified: nothing in `app/` or `components/` calls it); nothing to wrap today, but if P11 adds a delete affordance it must follow this pattern.
- [ ] Sweep the remaining form actions (transactions, income, bills, installments, settings): any action a user can fail with bad input (unparseable amount, missing name) gets the same treatment. Actions already returning `ActionResult` with `.error` rendered inline (bills, income, installments) are ALREADY correct and stay as they are; `fieldErrors` there is optional polish. Actions unreachable with invalid input (e.g. a confirm button with no free-typed fields) stay as they are.
- [ ] Verify: `npm run build` exits 0; `npx vitest run` stays green; in dev, submitting the account form with an empty name shows the inline zod message instead of crashing to the error boundary, and deleting a purchased wishlist item shows its message inline.
- [ ] Commit: `git add lib/actions components app && git commit -m "feat(polish): inline error pattern for server-action forms"`

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
7. `components/occurrences/confirm-sheet.tsx` has `role="dialog" aria-modal="true"` but NO `aria-labelledby`, no focus trap, and no Escape-to-close; this was explicitly deferred from P3 to P11. Point `aria-labelledby` at the sheet's existing `<h3>` (give it an `id`), trap focus while the sheet is open, and close on Escape.
8. `components/wishlist/purchase-sheet.tsx` is an inline disclosure, not a dialog: verify it does NOT need dialog semantics, just check its labels and roles (its account `<select>` currently has no label; give it one).

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
- [ ] Fix `components/occurrences/confirm-sheet.tsx` per checklist item 7: `id` on the `<h3>`, `aria-labelledby` on the dialog wrapper, focus trapped while open, Escape calls `onClose`. Check `components/wishlist/purchase-sheet.tsx` per item 8 (labels only, no dialog semantics).
- [ ] Verify: `npm run build` exits 0; keyboard-tab through the dashboard, one form, and the plan screen in dev, confirming a visible focus ring on every stop; toggle "reduce motion" in OS settings and confirm no animation remains.
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
- [ ] Verify: `npm run build` exits 0; `npx playwright test` stays green (the existing mobile-viewport specs must be unaffected). Note the stated trade-off: every Playwright project runs `devices['Pixel 7']`, so a green suite cannot exercise the md+ sidebar; the manual desktop pass above is the explicit verification for the sidebar (an optional desktop-viewport project is a stretch goal, not required).
- [ ] Commit: `git add components/sidebar-nav.tsx app/\(app\)/layout.tsx && git commit -m "feat(polish): md+ sidebar nav, bottom tabs mobile-only"`

---

### Task 8: full-scenario walkthrough E2E

**Files:**
- Create: `e2e/walkthrough.spec.ts`

**Interfaces:**
- Consumes: the whole app; a FRESH stamped user signed up through the real `/sign-up` flow (requires `ALLOW_SIGNUP=true`, the same gate `e2e/auth.setup.ts` already relies on); `createAccount` from `e2e/helpers.ts`; `@neondatabase/serverless` raw SQL for the P10 snapshot seed only (env `DATABASE_URL`); `page.route` on `**/api/ai/advice` (the P9 seam, so no Gemini traffic); env `E2E_TEST_PASSWORD` for the fresh user's password.

This is the spec's top scenario (§1, §7) as one Playwright spec. The shared Neon dev DB test user accumulates rows across runs BY DESIGN (every other spec is self-contained and `Date.now()`-stamped, and specs assume prior fixtures persist), so this spec must NOT wipe shared data - a blanket delete can destroy other specs' rows mid-suite, with no run-order guarantee. Instead it signs up a fresh `walkthrough-${Date.now()}@example.com` user at the start, which gives genuine first-run empty states (proving Task 2's checklist and Task 3's empty states) with zero cross-spec interference. Because the `app` Playwright project applies the shared `storageState` to every non-unauth spec, this spec must reset it with `test.use({ storageState: { cookies: [], origins: [] } })` (or an equivalent reset). Every created name is stamped and every list assertion row-scoped. The load-heavy pages (`/plan` and `/wishlist` both run the full planner against live Neon) are slow on the dev DB: the config timeout is 60s, this spec sets its own 240s budget, and the documented policy for transient Neon failures is re-run once. It must run serially with everything else (`workers: 1`).

**Steps:**

- [ ] Write `e2e/walkthrough.spec.ts`. Add-affordances are Next.js `<Link>`s (role "link", NOT buttons) with this real copy: `/accounts` "Add account", `/bills` "New bill", `/income` "New income source", `/installments` "New installment", `/debts` "Add debt". `/wishlist` has NO add button: `WishlistItemForm` renders inline, always visible, submit button "Add". `/expenses` has no add button either: expenses are logged via `/transactions/new` ("New entry" form). Account creation reuses `createAccount` from `e2e/helpers.ts` (drives `/accounts/new` and its real "Create account" button). The income/bill/installment forms have NO Currency field (currency follows the selected account, whose option label is `` `${name} (${currency})` ``) and their create submit button is "Create"; the installment create form has "Total payments" and no remaining-count field (remaining starts at total):

```ts
import { neon } from '@neondatabase/serverless'
import { expect, test } from '@playwright/test'
import { createAccount } from './helpers'

const sql = neon(process.env.DATABASE_URL!)

// Fresh stamped user per run: genuine first-run empty states, zero interference
// with other specs' rows on the shared dev DB (which persist by design).
const stamp = Date.now()
const EMAIL = `walkthrough-${stamp}@example.com`
const PASSWORD = process.env.E2E_TEST_PASSWORD!
const eurAccount = `Revolut EUR ${stamp}`
const usdAccount = `Payoneer USD ${stamp}`
const egpAccount = `CIB EGP ${stamp}`
const salary = `Salary ${stamp}`
const rent = `Rent ${stamp}`
const phone = `Phone installment ${stamp}`
const dadLoan = `Loan from Dad ${stamp}`
const card = `Credit card ${stamp}`
const desk = `Standing desk ${stamp}`

// Do NOT reuse the shared storageState: this spec authenticates its own fresh user.
test.use({ storageState: { cookies: [], origins: [] } })

test('full scenario walkthrough', async ({ page }) => {
  test.setTimeout(240_000) // /plan and /wishlist run the full planner against live Neon

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

  // 1. Sign up a fresh user through the real flow (same shape as e2e/auth.setup.ts,
  //    which proves sign-up works in this env; requires ALLOW_SIGNUP=true).
  await page.goto('/sign-up')
  await page.getByLabel('Email').fill(EMAIL)
  await page.getByLabel('Password').fill(PASSWORD)
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/auth/sign-up/email')),
    page.getByRole('button', { name: /create account/i }).click(),
  ])
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(EMAIL)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL('/')

  // 2. First-run: dashboard shows the setup checklist, list screens show their
  //    existing empty-state copy (Task 3 keeps it).
  await expect(page.getByLabel('Set up My Ledger')).toBeVisible()
  await expect(page.getByRole('link', { name: /create your accounts/i })).toBeVisible()
  await page.goto('/accounts')
  await expect(page.getByText('No accounts yet.')).toBeVisible()
  await page.goto('/transactions')
  await expect(page.getByText('Nothing here yet.')).toBeVisible()
  await page.goto('/income')
  await expect(page.getByText('No income sources yet.')).toBeVisible()
  await page.goto('/bills')
  await expect(page.getByText('No bills yet.')).toBeVisible()
  await page.goto('/installments')
  await expect(page.getByText('No installments yet.')).toBeVisible()
  await page.goto('/debts')
  await expect(page.getByText(/No flexible debts/)).toBeVisible()
  await page.goto('/wishlist')
  await expect(page.getByText('Nothing here yet. Add something you are saving for.')).toBeVisible()
  await page.goto('/expenses')
  await expect(page.getByText(/No expenses in/)).toBeVisible()

  // 3. Create the three per-currency accounts (shared helper: /accounts/new,
  //    "Create account" button, waits for /accounts).
  await createAccount(page, eurAccount, 'EUR', '3400.00')
  await createAccount(page, usdAccount, 'USD', '500.00')
  await createAccount(page, egpAccount, 'EGP', '95000.00')

  // 4. Add the salary income source (link, not button; no Currency field).
  await page.goto('/income')
  await page.getByRole('link', { name: 'New income source' }).click()
  await page.getByLabel('Name').fill(salary)
  await page.getByLabel('Amount').fill('2500.00')
  await page.getByLabel('Account').selectOption({ label: `${eurAccount} (EUR)` })
  await page.getByLabel('Day of month').fill('25')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.waitForURL('/income')
  await expect(page.getByRole('link', { name: new RegExp(salary) })).toBeVisible()

  // 5. Dashboard housekeeping generated the occurrence; confirm the salary.
  //    Attention rows are buttons named by source name; the sheet is the dialog.
  await page.goto('/')
  await page.getByRole('button', { name: new RegExp(salary) }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByRole('button', { name: new RegExp(salary) })).toHaveCount(0)

  // 6. Add the rent bill (due day 1 makes this month's occurrence overdue) and confirm it.
  await page.goto('/bills')
  await page.getByRole('link', { name: 'New bill' }).click()
  await page.getByLabel('Name').fill(rent)
  await page.getByLabel('Amount').fill('12000.00')
  await page.getByLabel('Account').selectOption({ label: `${egpAccount} (EGP)` })
  await page.getByLabel('Due day').fill('1')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.goto('/')
  await expect(page.getByRole('button', { name: new RegExp(`${rent}.*Overdue`) })).toBeVisible()
  await page.getByRole('button', { name: new RegExp(rent) }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByRole('button', { name: new RegExp(rent) })).toHaveCount(0)

  // 7. Add an installment (no remaining-count field on create) and confirm one payment.
  await page.goto('/installments')
  await page.getByRole('link', { name: 'New installment' }).click()
  await page.getByLabel('Name').fill(phone)
  await page.getByLabel('Monthly amount').fill('1500.00')
  await page.getByLabel('Account').selectOption({ label: `${egpAccount} (EGP)` })
  await page.getByLabel('Due day').fill('10')
  await page.getByLabel('Total payments').fill('12')
  await page.getByLabel('Start date').fill('2026-07-10')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.goto('/')
  await page.getByRole('button', { name: new RegExp(phone) }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click()
  await page.goto('/installments')
  await expect(
    page.getByRole('listitem').filter({ hasText: phone }).getByText(/Paid 1 of 12/),
  ).toBeVisible()

  // 8. Add a flexible debt with a deadline plus an ASAP debt (real labels:
  //    "Original amount", "APR % (0 for interest-free)", "Deadline (optional; ...)").
  await page.goto('/debts')
  await page.getByRole('link', { name: 'Add debt' }).click()
  await page.getByLabel('Name').fill(dadLoan)
  await page.getByLabel('Currency').selectOption('EGP')
  await page.getByLabel('Original amount').fill('50000.00')
  await page.getByLabel(/APR/).fill('0')
  await page.getByLabel(/Deadline/).fill('2026-12-31')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForURL('/debts')
  await expect(page.getByRole('link', { name: dadLoan })).toBeVisible()
  await page.getByRole('link', { name: 'Add debt' }).click()
  await page.getByLabel('Name').fill(card)
  await page.getByLabel('Currency').selectOption('USD')
  await page.getByLabel('Original amount').fill('900.00')
  await page.getByLabel(/APR/).fill('24')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForURL('/debts')
  await expect(page.getByRole('link', { name: card })).toBeVisible()

  // 9. Log expenses via /transactions/new ("New entry"; /expenses has no add button).
  //    Type defaults to expense.
  await page.goto('/transactions/new')
  await page.getByLabel('Account').selectOption({ label: `${egpAccount} (EGP)` })
  await page.getByLabel('Amount').fill('850.00')
  await page.getByLabel('Note').fill(`Groceries ${stamp}`)
  await page.getByRole('button', { name: 'Save' }).click()
  await page.goto('/transactions/new')
  await page.getByLabel('Account').selectOption({ label: `${egpAccount} (EGP)` })
  await page.getByLabel('Amount').fill('3000.00')
  await page.getByLabel('Note').fill(`Car repair ${stamp}`)
  await page.getByLabel('One-off').check()
  await page.getByRole('button', { name: 'Save' }).click()
  await page.goto('/expenses')
  await expect(page.getByText(`Groceries ${stamp}`)).toBeVisible()
  await expect(page.getByText(`Car repair ${stamp}`)).toBeVisible()

  // 10. Add a wishlist item: NO add button, the inline form is always visible;
  //     fill Name/Cost and click the "Add" submit directly.
  await page.goto('/wishlist')
  await page.getByLabel('Name').fill(desk)
  await page.getByLabel('Cost').fill('400.00')
  await page.getByLabel('Currency').selectOption('EUR')
  await page.getByLabel(/Priority/).selectOption('1')
  await page.getByLabel(/Target date/).fill('2026-11-01')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('link', { name: desk })).toBeVisible()

  // 11. Plan screen: algorithm numbers, the funding-gap suggestion (900 USD debt vs
  //     500 USD balance; the engine renders "Transfer ~ ... into ..." or
  //     "No other currency can cover ...", never the phrase "funding gap"),
  //     and the mocked AI panel.
  await page.goto('/plan')
  await expect(page.getByRole('heading', { name: 'Debt payoff' })).toBeVisible()
  await expect(
    page.getByRole('listitem').filter({ hasText: card }).getByText(/Paid off 20\d\d-\d\d|Beyond \d+ months/),
  ).toBeVisible()
  await expect(
    page.getByText(/Transfer ~ .* into (EUR|USD|EGP)|No other currency can cover/).first(),
  ).toBeVisible()
  await expect(page.getByText('Mocked second opinion')).toBeVisible()
  await page.getByText('What gets sent').click()
  const payloadText = await page.getByTestId('ai-payload').textContent()
  expect(payloadText).toContain('debtA')
  expect(payloadText).not.toContain(dadLoan)

  // 12. Purchase the wishlist item: "Buy" opens the inline sheet; the single EUR
  //     account is auto-selected; "Confirm purchase" completes it.
  await page.goto('/wishlist')
  await page.getByRole('listitem').filter({ hasText: desk }).getByRole('button', { name: 'Buy' }).click()
  await page.getByRole('button', { name: 'Confirm purchase' }).click()
  await expect(page.getByRole('heading', { name: 'Purchased' })).toBeVisible()
  await expect(
    page.getByRole('listitem').filter({ hasText: desk }).getByRole('button', { name: 'Un-purchase' }),
  ).toBeVisible()

  // 13. Dashboard: attention list has nothing left; trends section renders
  //     (seed one prior-day snapshot for THIS user so two points exist).
  const [{ id: userId }] = (await sql`select id from "user" where email = ${EMAIL}`) as { id: string }[]
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
  // AttentionList renders nothing at all when every occurrence is settled.
  await expect(page.getByText('Needs attention')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: /^Net worth \(/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: /^Total debt \(/ })).toBeVisible()
  // Setup checklist is gone: all four steps are complete.
  await expect(page.getByLabel('Set up My Ledger')).toHaveCount(0)
})
```

- [ ] Run `npx playwright test e2e/walkthrough.spec.ts`. Expected: PASS. Every selector miss means an accessible name drifted from the domain vocabulary; fix the screen, re-run.
- [ ] Commit: `git add e2e/walkthrough.spec.ts && git commit -m "test(polish): full-scenario walkthrough e2e of the spec top scenario"`

---

### Task 9: definition of done (final gate)

**Files:**
- Modify: `docs/wiki/status.md`

Evidence before assertions: run every gate and read the output before claiming anything.

**Steps:**

- [ ] Run the full unit suite: `npx vitest run`. Expected: all suites from P0-P11 green, zero skipped.
- [ ] Run the full E2E suite: `npx playwright test`. Expected: all specs green, including the walkthrough.
- [ ] Run the production build: `npm run build`. Expected: exit 0, no type errors.
- [ ] Manual mobile-viewport (375px) walkthrough mirroring the Task 8 scenario by hand, plus one pass at desktop width for the sidebar.
- [ ] Only after all four checks pass, update `docs/wiki/status.md`: set P11 (and any straggler rows) to `done` and replace the header line "planning complete, no app code yet" with the shipped state, keeping the instruction "Update this page whenever a phase starts or completes."
- [ ] Commit: `git add docs/wiki/status.md && git commit -m "docs(status): P11 polish complete, v1 shipped"`

---

Backlinks: [Plans master index](../plans/README.md) | [Design spec](../specs/2026-07-07-my-ledger-design.md) | Previous: [10-cron-and-snapshots.md](10-cron-and-snapshots.md) | Back to: [README.md](README.md)
