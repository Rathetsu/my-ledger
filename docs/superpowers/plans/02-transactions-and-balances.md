# Phase 02: Transactions and Balances Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Backlinks:** [Master index](README.md) | [Spec](../specs/2026-07-07-my-ledger-design.md) | Prev: [01-accounts-and-currency.md](01-accounts-and-currency.md) | Next: [03-income.md](03-income.md)

**Goal:** The working ledger core: posting income and expenses, two-leg transfers (same and cross currency), reconciliation adjustments, a filterable history screen, and dashboard v1 with the net-worth headline in home currency.

**Architecture:** Everything in this phase writes plain `transactions` rows; the mutability rules (spec §3) are one pure guard function that every edit/delete action consults. Transfers are two explicit legs sharing a `transfer_group_id`, always written and mutated inside one `dbPool` transaction; the live rate only pre-fills the cross-currency suggestion via the pure `convert()`. No new tables: P1's schema already carries every column this phase needs.

**Tech Stack:** Next.js App Router server actions + zod, Drizzle on Neon (`db` reads, `dbPool` transactions), Better Auth (`requireUser()`), Vitest, Playwright, Tailwind (mobile-first).

## Global Constraints

- Money: integer minor units, currencies `EUR|USD|EGP`, round half-up, balances derived ([spec §3](../specs/2026-07-07-my-ledger-design.md)).
- No transaction converts currency; transfer legs mutate as a group; source-linked transactions mutate only via owning flow.
- Day boundaries `Africa/Cairo`; due-date clamp `min(due_day, last_day_of_month)`.
- Occurrences unique per (user, kind, source, period); confirms guard on `status IN ('pending','overdue')`; snapshots unique per (user, date).
- All mutations = zod-validated server actions + `revalidatePath`; every table has `user_id`.
- TDD: failing test → minimal code → pass → commit. Frequent small commits.
- The deterministic engine owns all numbers; the AI only quotes.

**Inherited from P1:** signed `amount_minor` (inflows positive, outflows negative, balance = SUM); `ActionState` + `useActionState` mutation pattern; `parseToMinor` accepts positive decimals and throws on garbage.

## Task 1: Mutability guard (pure)

**Files:**
- Test: `lib/transactions/mutability.test.ts`
- Create: `lib/transactions/mutability.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `directMutability(t: { sourceType: string | null; transferGroupId: string | null }): { ok: true } | { ok: false; reason: string }`. Every direct edit/delete action in this phase (and every later phase) routes through it: plain rows mutate freely; source-linked rows are blocked (un-confirm arrives in P3); transfer legs redirect to the group flow.

**Steps:**

- [ ] Write the failing test `lib/transactions/mutability.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { directMutability } from '@/lib/transactions/mutability'

describe('directMutability (spec §3 Mutability)', () => {
  test('plain row: mutable', () => {
    expect(directMutability({ sourceType: null, transferGroupId: null })).toEqual({
      ok: true,
    })
  })
  test('source-linked row: blocked with a clear error', () => {
    const r = directMutability({ sourceType: 'income', transferGroupId: null })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/confirm flow/i)
  })
  test('transfer leg: blocked, points at the group flow', () => {
    const r = directMutability({ sourceType: null, transferGroupId: 'g-1' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/transfer/i)
  })
  test('source-linked wins over transfer (defensive; should not co-occur)', () => {
    const r = directMutability({ sourceType: 'bill', transferGroupId: 'g-1' })
    expect(r.ok).toBe(false)
  })
})
```

- [ ] Run: `npm run test`. Expected FAIL: `Failed to resolve import "@/lib/transactions/mutability"`.
- [ ] Create `lib/transactions/mutability.ts`:

```ts
export type Mutability = { ok: true } | { ok: false; reason: string }

// Spec §3 Mutability: source-linked transactions mutate only through their
// owning flow; transfer legs mutate as a group; plain rows are free.
export function directMutability(t: {
  sourceType: string | null
  transferGroupId: string | null
}): Mutability {
  if (t.sourceType) {
    return {
      ok: false,
      reason:
        'This entry was posted by a confirm flow. Manage it from its source; un-confirm arrives with income sources.',
    }
  }
  if (t.transferGroupId) {
    return {
      ok: false,
      reason: 'Transfer legs change as a group. Edit or delete the transfer instead.',
    }
  }
  return { ok: true }
}
```

- [ ] Run: `npm run test`. Expected PASS.
- [ ] Commit:

```bash
git add lib/transactions
git commit -m "feat(ledger): pure mutability guard for direct edits"
```

## Task 2: Post income and expense

**Files:**
- Test: `e2e/ledger.spec.ts` (started here, grown through the phase)
- Create: `lib/actions/transactions.ts`, `app/(app)/transactions/new/page.tsx`, `components/transaction-form.tsx`

**Interfaces:**
- Consumes: `requireUser()`, `db`, `accounts`/`transactions` schema, `parseToMinor`, `todayCairo()`, `ActionState` from P1.
- Produces: `postTransaction` server action. Fields per spec §5.2: type (income|expense), account, amount, note, `one_off` tag, `occurred_on` defaulting to `todayCairo()`. `category_id` stays null until P6 adds categories.

**Steps:**

- [ ] Start the failing E2E spec `e2e/ledger.spec.ts` with a shared helper and the expense test (more tests join this file in later tasks):

```ts
import { expect, test, type Page } from '@playwright/test'

async function createAccount(page: Page, name: string, currency: string, opening: string) {
  await page.goto('/accounts/new')
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Currency').selectOption(currency)
  await page.getByLabel('Opening balance').fill(opening)
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.waitForURL('/accounts')
}

test('post an expense and see the balance drop', async ({ page }) => {
  const name = `Spend EUR ${Date.now()}`
  await createAccount(page, name, 'EUR', '100.00')

  await page.goto('/transactions/new')
  await page.getByLabel('Account').selectOption({ label: `${name} (EUR)` })
  await page.getByLabel('Type').selectOption('expense')
  await page.getByLabel('Amount').fill('25.50')
  await page.getByLabel('Note').fill('Groceries')
  await page.getByLabel('One-off').check()
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForURL(/\/transactions/)

  await page.goto('/accounts')
  await expect(page.getByRole('link', { name: new RegExp(name) })).toContainText(
    '€74.50',
  )
})
```

- [ ] Run it: `npx playwright test e2e/ledger.spec.ts`. Expected FAIL: `/transactions/new` 404s.
- [ ] Create `lib/actions/transactions.ts` with `postTransaction` (edit/delete join this file in Task 3):

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { accounts, transactions } from '@/lib/db/schema'
import { parseToMinor } from '@/lib/money/money'
import type { ActionState } from './accounts'

const postSchema = z.object({
  accountId: z.string().uuid(),
  type: z.enum(['income', 'expense']),
  amount: z.string().trim().min(1, 'Amount is required'),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date'),
  note: z.string().trim().max(500).optional(),
})

export async function postTransaction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser()
  const parsed = postSchema.safeParse({
    accountId: formData.get('accountId'),
    type: formData.get('type'),
    amount: formData.get('amount'),
    occurredOn: formData.get('occurredOn'),
    note: formData.get('note') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const d = parsed.data
  const oneOff = formData.get('oneOff') === 'on'

  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, d.accountId), eq(accounts.userId, user.id)))
  if (!account) return { error: 'Account not found' }
  if (account.archivedAt) return { error: 'Account is archived' }

  let amountMinor: number
  try {
    amountMinor = parseToMinor(d.amount, account.currency)
  } catch {
    return { error: 'Amount is not a valid number' }
  }
  if (amountMinor <= 0) return { error: 'Amount must be positive' }

  await db.insert(transactions).values({
    userId: user.id,
    accountId: account.id,
    type: d.type,
    // Sign convention: inflows positive, outflows negative.
    amountMinor: d.type === 'expense' ? -amountMinor : amountMinor,
    currency: account.currency,
    occurredOn: d.occurredOn,
    note: d.note,
    oneOff,
    categoryId: null, // categories arrive in P6
  })
  revalidatePath('/transactions')
  revalidatePath('/accounts')
  revalidatePath('/')
  redirect('/transactions')
}
```

- [ ] Create `components/transaction-form.tsx` (client; server page feeds accounts and the Cairo default date):

```tsx
'use client'

import { useActionState } from 'react'
import type { ActionState } from '@/lib/actions/accounts'
import { postTransaction } from '@/lib/actions/transactions'

export interface AccountOption {
  id: string
  name: string
  currency: string
}

export function TransactionForm({
  accounts,
  defaultDate,
}: {
  accounts: AccountOption[]
  defaultDate: string
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    postTransaction,
    null,
  )
  return (
    <form action={formAction} className="space-y-4">
      <h1 className="text-xl font-semibold">New entry</h1>
      <label className="block">
        <span className="text-sm">Type</span>
        <select name="type" className="mt-1 w-full rounded border p-3">
          <option value="expense">expense</option>
          <option value="income">income</option>
        </select>
      </label>
      <label className="block">
        <span className="text-sm">Account</span>
        <select name="accountId" className="mt-1 w-full rounded border p-3">
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.currency})
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-sm">Amount</span>
        <input
          name="amount"
          inputMode="decimal"
          required
          className="mt-1 w-full rounded border p-3"
        />
      </label>
      <label className="block">
        <span className="text-sm">Date</span>
        <input
          type="date"
          name="occurredOn"
          defaultValue={defaultDate}
          required
          className="mt-1 w-full rounded border p-3"
        />
      </label>
      <label className="block">
        <span className="text-sm">Note</span>
        <input name="note" className="mt-1 w-full rounded border p-3" />
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" name="oneOff" className="h-5 w-5" />
        <span className="text-sm">One-off</span>
      </label>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button className="w-full rounded bg-blue-600 py-3 text-white">Save</button>
    </form>
  )
}
```

- [ ] Create `app/(app)/transactions/new/page.tsx`:

```tsx
import { and, asc, eq, isNull } from 'drizzle-orm'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { accounts } from '@/lib/db/schema'
import { todayCairo } from '@/lib/dates/cairo'
import { TransactionForm } from '@/components/transaction-form'

export default async function NewTransactionPage() {
  const user = await requireUser()
  const rows = await db
    .select({ id: accounts.id, name: accounts.name, currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.userId, user.id), isNull(accounts.archivedAt)))
    .orderBy(asc(accounts.createdAt))
  return <TransactionForm accounts={rows} defaultDate={todayCairo()} />
}
```

- [ ] Run: `npx playwright test e2e/ledger.spec.ts`. Expected: still FAIL, but later: the final `waitForURL(/\/transactions/)` passes yet the balance assertion needs the redirect target to exist. The P0 placeholder at `/transactions` renders, so the spec passes once the action works. Expected PASS: `2 passed` (setup + expense).
- [ ] Commit:

```bash
git add lib/actions/transactions.ts components/transaction-form.tsx app/\(app\)/transactions/new e2e/ledger.spec.ts
git commit -m "feat(ledger): post income and expense with one_off tag and cairo default date"
```

## Task 3: Edit and delete plain rows (guarded)

**Files:**
- Test: `e2e/ledger-edit.spec.ts`
- Modify: `lib/actions/transactions.ts` (add `updateTransaction`, `deleteTransaction`)
- Create: `app/(app)/transactions/[id]/page.tsx`, `components/transaction-edit-form.tsx`

**Interfaces:**
- Consumes: `directMutability` from Task 1; everything Task 2 uses.
- Produces: `updateTransaction`, `deleteTransaction` server actions that refuse source-linked rows and transfer legs with the guard's reason; the row editor page that P3's un-confirm flow will link back to.

**Steps:**

- [ ] Write the failing E2E spec `e2e/ledger-edit.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test'

async function createAccount(page: Page, name: string, currency: string, opening: string) {
  await page.goto('/accounts/new')
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Currency').selectOption(currency)
  await page.getByLabel('Opening balance').fill(opening)
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.waitForURL('/accounts')
}

test('edit then delete a plain expense', async ({ page }) => {
  const name = `Edit EUR ${Date.now()}`
  const note = `note-${Date.now()}`
  await createAccount(page, name, 'EUR', '100.00')

  await page.goto('/transactions/new')
  await page.getByLabel('Account').selectOption({ label: `${name} (EUR)` })
  await page.getByLabel('Type').selectOption('expense')
  await page.getByLabel('Amount').fill('10.00')
  await page.getByLabel('Note').fill(note)
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForURL(/\/transactions/)

  // open the row from history and edit the amount
  await page.getByRole('link', { name: new RegExp(note) }).click()
  await page.getByLabel('Amount').fill('12.00')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.waitForURL(/\/transactions$/)
  await page.goto('/accounts')
  await expect(page.getByRole('link', { name: new RegExp(name) })).toContainText(
    '€88.00',
  )

  // delete it
  await page.goto('/transactions')
  await page.getByRole('link', { name: new RegExp(note) }).click()
  await page.getByRole('button', { name: 'Delete' }).click()
  await page.waitForURL(/\/transactions$/)
  await page.goto('/accounts')
  await expect(page.getByRole('link', { name: new RegExp(name) })).toContainText(
    '€100.00',
  )
})
```

Note: this spec clicks rows in history, which Task 7 builds. Run it now for the red step; it goes fully green after Task 7. The actions and editor page are still built test-first here.

- [ ] Run it: `npx playwright test e2e/ledger-edit.spec.ts`. Expected FAIL: no history rows to click yet.
- [ ] Append to `lib/actions/transactions.ts`:

```ts
import { directMutability } from '@/lib/transactions/mutability' // merge into imports

const updateSchema = z.object({
  transactionId: z.string().uuid(),
  amount: z.string().trim().min(1, 'Amount is required'),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date'),
  note: z.string().trim().max(500).optional(),
})

async function loadOwnedPlainRow(userId: string, transactionId: string) {
  const [txn] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)))
  if (!txn) return { error: 'Entry not found' as const }
  const m = directMutability(txn)
  if (!m.ok) return { error: m.reason }
  return { txn }
}

export async function updateTransaction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser()
  const parsed = updateSchema.safeParse({
    transactionId: formData.get('transactionId'),
    amount: formData.get('amount'),
    occurredOn: formData.get('occurredOn'),
    note: formData.get('note') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const loaded = await loadOwnedPlainRow(user.id, parsed.data.transactionId)
  if ('error' in loaded) return { error: loaded.error }
  const { txn } = loaded

  let amountMinor: number
  try {
    amountMinor = parseToMinor(parsed.data.amount, txn.currency)
  } catch {
    return { error: 'Amount is not a valid number' }
  }
  // Re-apply the sign convention by type; opening/adjustment keep the raw sign.
  const signed =
    txn.type === 'expense'
      ? -Math.abs(amountMinor)
      : txn.type === 'income'
        ? Math.abs(amountMinor)
        : amountMinor

  await db
    .update(transactions)
    .set({
      amountMinor: signed,
      occurredOn: parsed.data.occurredOn,
      note: parsed.data.note ?? null,
      oneOff: formData.get('oneOff') === 'on',
    })
    .where(and(eq(transactions.id, txn.id), eq(transactions.userId, user.id)))
  revalidatePath('/transactions')
  revalidatePath('/accounts')
  revalidatePath('/')
  redirect('/transactions')
}

export async function deleteTransaction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser()
  const parsed = z
    .object({ transactionId: z.string().uuid() })
    .safeParse({ transactionId: formData.get('transactionId') })
  if (!parsed.success) return { error: 'Invalid entry' }
  const loaded = await loadOwnedPlainRow(user.id, parsed.data.transactionId)
  if ('error' in loaded) return { error: loaded.error }

  await db
    .delete(transactions)
    .where(and(eq(transactions.id, loaded.txn.id), eq(transactions.userId, user.id)))
  revalidatePath('/transactions')
  revalidatePath('/accounts')
  revalidatePath('/')
  redirect('/transactions')
}
```

- [ ] Create `components/transaction-edit-form.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import type { ActionState } from '@/lib/actions/accounts'
import { deleteTransaction, updateTransaction } from '@/lib/actions/transactions'

export function TransactionEditForm({
  txn,
}: {
  txn: {
    id: string
    type: string
    amountAbs: string // "12.34", sign handled by type
    occurredOn: string
    note: string
    oneOff: boolean
    accountName: string
    currency: string
  }
}) {
  const [updateState, updateAction] = useActionState<ActionState, FormData>(
    updateTransaction,
    null,
  )
  const [deleteState, deleteAction] = useActionState<ActionState, FormData>(
    deleteTransaction,
    null,
  )
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">
        {txn.type} <span className="text-sm text-gray-500">{txn.accountName}</span>
      </h1>
      <form action={updateAction} className="space-y-4">
        <input type="hidden" name="transactionId" value={txn.id} />
        <label className="block">
          <span className="text-sm">Amount ({txn.currency})</span>
          <input
            name="amount"
            defaultValue={txn.amountAbs}
            inputMode="decimal"
            required
            className="mt-1 w-full rounded border p-3"
          />
        </label>
        <label className="block">
          <span className="text-sm">Date</span>
          <input
            type="date"
            name="occurredOn"
            defaultValue={txn.occurredOn}
            required
            className="mt-1 w-full rounded border p-3"
          />
        </label>
        <label className="block">
          <span className="text-sm">Note</span>
          <input name="note" defaultValue={txn.note} className="mt-1 w-full rounded border p-3" />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="oneOff" defaultChecked={txn.oneOff} className="h-5 w-5" />
          <span className="text-sm">One-off</span>
        </label>
        {updateState?.error && <p className="text-sm text-red-600">{updateState.error}</p>}
        <button className="w-full rounded bg-blue-600 py-3 text-white">Save changes</button>
      </form>
      <form action={deleteAction}>
        <input type="hidden" name="transactionId" value={txn.id} />
        {deleteState?.error && <p className="text-sm text-red-600">{deleteState.error}</p>}
        <button className="w-full rounded border border-red-600 py-3 text-red-600">
          Delete
        </button>
      </form>
    </div>
  )
}
```

- [ ] Create `app/(app)/transactions/[id]/page.tsx`. Transfer legs never reach the editor (redirect to the group), and source-linked rows render read-only with the guard's reason:

```tsx
import { notFound, redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { accounts, transactions } from '@/lib/db/schema'
import { directMutability } from '@/lib/transactions/mutability'
import { formatMoney } from '@/lib/money/money'
import { TransactionEditForm } from '@/components/transaction-edit-form'

export default async function TransactionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireUser()
  const { id } = await params
  const [row] = await db
    .select({ txn: transactions, accountName: accounts.name })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(and(eq(transactions.id, id), eq(transactions.userId, user.id)))
  if (!row) notFound()
  const { txn, accountName } = row

  if (txn.transferGroupId) redirect(`/transfers/${txn.transferGroupId}`)

  const m = directMutability(txn)
  if (!m.ok) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">{txn.type}</h1>
        <p className="rounded border p-3 font-mono">
          {formatMoney({ amountMinor: txn.amountMinor, currency: txn.currency })}
        </p>
        <p className="rounded border border-amber-400 bg-amber-50 p-3 text-sm">
          {m.reason}
        </p>
      </div>
    )
  }

  return (
    <TransactionEditForm
      txn={{
        id: txn.id,
        type: txn.type,
        amountAbs: (Math.abs(txn.amountMinor) / 100).toFixed(2),
        occurredOn: txn.occurredOn,
        note: txn.note ?? '',
        oneOff: txn.oneOff,
        accountName,
        currency: txn.currency,
      }}
    />
  )
}
```

- [ ] Run `npm run test` (guard still green) and re-run the edit spec: `npx playwright test e2e/ledger-edit.spec.ts`. Expected: still FAIL on history clicks (Task 7); the editor page itself can be verified manually by opening `/transactions/<id>` with a real row id.
- [ ] Commit:

```bash
git add lib/actions/transactions.ts components/transaction-edit-form.tsx app/\(app\)/transactions/\[id\] e2e/ledger-edit.spec.ts
git commit -m "feat(ledger): guarded edit and delete for plain rows"
```

## Task 4: Transfers (same-currency and cross-currency)

**Files:**
- Modify: `e2e/ledger.spec.ts` (add the transfer test)
- Create: `lib/actions/transfers.ts`, `app/(app)/transfers/new/page.tsx`, `components/transfer-form.tsx`

**Interfaces:**
- Consumes: `dbPool`, `convert` + `Rates` (pure, imported client-side for the pre-fill), `getRates`, `parseToMinor`, `formatMoney`, `todayCairo`, `ActionState`.
- Produces: `createTransfer` server action: same currency = one amount, two legs; cross currency = both actual amounts entered, legs share a fresh `transfer_group_id`, written atomically. Redirects to `/transfers/[groupId]` where Task 5 shows the effective rate.

**Steps:**

- [ ] Add the failing transfer test to `e2e/ledger.spec.ts`:

```ts
test('cross-currency transfer with both explicit legs', async ({ page }) => {
  const run = Date.now()
  const eur = `From EUR ${run}`
  const egp = `To EGP ${run}`
  await createAccount(page, eur, 'EUR', '1000.00')
  await createAccount(page, egp, 'EGP', '0.00')

  await page.goto('/transfers/new')
  await page.getByLabel('From').selectOption({ label: `${eur} (EUR)` })
  await page.getByLabel('To').selectOption({ label: `${egp} (EGP)` })
  await page.getByLabel(/Amount sent/).fill('100.00')
  // the live-rate suggestion button must exist; we still enter the actual figure
  await expect(page.getByRole('button', { name: /Use live-rate suggestion/ })).toBeVisible()
  await page.getByLabel(/Amount received/).fill('5200.00')
  await page.getByRole('button', { name: 'Create transfer' }).click()
  await page.waitForURL(/\/transfers\//)
  await expect(page.getByText('1 EUR = 52.0000 EGP')).toBeVisible()

  await page.goto('/accounts')
  await expect(page.getByRole('link', { name: new RegExp(eur) })).toContainText('€900.00')
  await expect(page.getByRole('link', { name: new RegExp(egp) })).toContainText(
    'EGP 5,200.00',
  )
})
```

- [ ] Run it: `npx playwright test e2e/ledger.spec.ts`. Expected FAIL: `/transfers/new` 404s.
- [ ] Create `lib/actions/transfers.ts`:

```ts
'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import { db, dbPool } from '@/lib/db/client'
import { accounts, transactions } from '@/lib/db/schema'
import { parseToMinor } from '@/lib/money/money'
import type { ActionState } from './accounts'

const transferSchema = z.object({
  fromAccountId: z.string().uuid(),
  toAccountId: z.string().uuid(),
  amountSent: z.string().trim().min(1, 'Amount sent is required'),
  amountReceived: z.string().trim().optional(),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date'),
  note: z.string().trim().max(500).optional(),
})

export async function createTransfer(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser()
  const parsed = transferSchema.safeParse({
    fromAccountId: formData.get('fromAccountId'),
    toAccountId: formData.get('toAccountId'),
    amountSent: formData.get('amountSent'),
    amountReceived: formData.get('amountReceived') || undefined,
    occurredOn: formData.get('occurredOn'),
    note: formData.get('note') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const d = parsed.data
  if (d.fromAccountId === d.toAccountId) return { error: 'Pick two different accounts' }

  const rows = await db
    .select()
    .from(accounts)
    .where(
      and(
        inArray(accounts.id, [d.fromAccountId, d.toAccountId]),
        eq(accounts.userId, user.id),
      ),
    )
  const from = rows.find((a) => a.id === d.fromAccountId)
  const to = rows.find((a) => a.id === d.toAccountId)
  if (!from || !to) return { error: 'Account not found' }

  const cross = from.currency !== to.currency
  if (cross && !d.amountReceived) {
    return { error: 'Enter the actual amount received (bank spread included)' }
  }

  let sentMinor: number
  let receivedMinor: number
  try {
    sentMinor = parseToMinor(d.amountSent, from.currency)
    receivedMinor = cross ? parseToMinor(d.amountReceived!, to.currency) : sentMinor
  } catch {
    return { error: 'Amounts must be valid numbers' }
  }
  if (sentMinor <= 0 || receivedMinor <= 0) return { error: 'Amounts must be positive' }

  // Two legs, one group, one DB transaction. No conversion happens here:
  // both figures are the user's actuals (ADR: two-leg transfers).
  const groupId = randomUUID()
  await dbPool.transaction(async (tx) => {
    await tx.insert(transactions).values([
      {
        userId: user.id,
        accountId: from.id,
        type: 'transfer_out',
        amountMinor: -sentMinor,
        currency: from.currency,
        occurredOn: d.occurredOn,
        note: d.note,
        transferGroupId: groupId,
      },
      {
        userId: user.id,
        accountId: to.id,
        type: 'transfer_in',
        amountMinor: receivedMinor,
        currency: to.currency,
        occurredOn: d.occurredOn,
        note: d.note,
        transferGroupId: groupId,
      },
    ])
  })
  revalidatePath('/transactions')
  revalidatePath('/accounts')
  revalidatePath('/')
  redirect(`/transfers/${groupId}`)
}
```

- [ ] Create `components/transfer-form.tsx` (client; `convert` is pure so the suggestion never round-trips to the server):

```tsx
'use client'

import { useActionState, useState } from 'react'
import type { ActionState } from '@/lib/actions/accounts'
import { createTransfer } from '@/lib/actions/transfers'
import { convert } from '@/lib/currency/convert'
import type { Rates } from '@/lib/currency/rates'
import { formatMoney, parseToMinor, type Currency } from '@/lib/money/money'

interface AccountOption {
  id: string
  name: string
  currency: Currency
}

export function TransferForm({
  accounts,
  rates,
  defaultDate,
}: {
  accounts: AccountOption[]
  rates: Rates
  defaultDate: string
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(createTransfer, null)
  const [fromId, setFromId] = useState(accounts[0]?.id ?? '')
  const [toId, setToId] = useState(accounts[1]?.id ?? '')
  const [sent, setSent] = useState('')
  const [received, setReceived] = useState('')

  const from = accounts.find((a) => a.id === fromId)
  const to = accounts.find((a) => a.id === toId)
  const cross = !!from && !!to && from.currency !== to.currency

  // Live rate only PRE-FILLS a suggestion; the user enters actuals.
  let suggestionMinor: number | null = null
  if (cross && sent) {
    try {
      suggestionMinor = convert(
        parseToMinor(sent, from.currency),
        from.currency,
        to.currency,
        rates,
      )
    } catch {
      suggestionMinor = null
    }
  }

  const options = accounts.map((a) => (
    <option key={a.id} value={a.id}>
      {a.name} ({a.currency})
    </option>
  ))

  return (
    <form action={formAction} className="space-y-4">
      <h1 className="text-xl font-semibold">Transfer</h1>
      <label className="block">
        <span className="text-sm">From</span>
        <select
          name="fromAccountId"
          value={fromId}
          onChange={(e) => setFromId(e.target.value)}
          className="mt-1 w-full rounded border p-3"
        >
          {options}
        </select>
      </label>
      <label className="block">
        <span className="text-sm">To</span>
        <select
          name="toAccountId"
          value={toId}
          onChange={(e) => setToId(e.target.value)}
          className="mt-1 w-full rounded border p-3"
        >
          {options}
        </select>
      </label>
      <label className="block">
        <span className="text-sm">
          {cross && from ? `Amount sent (${from.currency})` : 'Amount'}
        </span>
        <input
          name="amountSent"
          value={sent}
          onChange={(e) => setSent(e.target.value)}
          inputMode="decimal"
          required
          className="mt-1 w-full rounded border p-3"
        />
      </label>
      {cross && to && (
        <div>
          <label className="block">
            <span className="text-sm">Amount received ({to.currency})</span>
            <input
              name="amountReceived"
              value={received}
              onChange={(e) => setReceived(e.target.value)}
              inputMode="decimal"
              required
              className="mt-1 w-full rounded border p-3"
            />
          </label>
          {suggestionMinor !== null && (
            <button
              type="button"
              className="mt-1 text-sm text-blue-600"
              onClick={() => setReceived((suggestionMinor / 100).toFixed(2))}
            >
              Use live-rate suggestion:{' '}
              {formatMoney({ amountMinor: suggestionMinor, currency: to.currency })}
            </button>
          )}
        </div>
      )}
      <label className="block">
        <span className="text-sm">Date</span>
        <input
          type="date"
          name="occurredOn"
          defaultValue={defaultDate}
          required
          className="mt-1 w-full rounded border p-3"
        />
      </label>
      <label className="block">
        <span className="text-sm">Note</span>
        <input name="note" className="mt-1 w-full rounded border p-3" />
      </label>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button className="w-full rounded bg-blue-600 py-3 text-white">
        Create transfer
      </button>
    </form>
  )
}
```

- [ ] Create `app/(app)/transfers/new/page.tsx`:

```tsx
import { and, asc, eq, isNull } from 'drizzle-orm'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { accounts } from '@/lib/db/schema'
import { getRates } from '@/lib/currency/rates'
import { todayCairo } from '@/lib/dates/cairo'
import { TransferForm } from '@/components/transfer-form'

export default async function NewTransferPage() {
  const user = await requireUser()
  const [rows, rates] = await Promise.all([
    db
      .select({ id: accounts.id, name: accounts.name, currency: accounts.currency })
      .from(accounts)
      .where(and(eq(accounts.userId, user.id), isNull(accounts.archivedAt)))
      .orderBy(asc(accounts.createdAt)),
    getRates(),
  ])
  return <TransferForm accounts={rows} rates={rates} defaultDate={todayCairo()} />
}
```

- [ ] The transfer test still needs the group page (`/transfers/[groupId]`, Task 5) for the effective-rate assertion. Build Task 5, then run: `npx playwright test e2e/ledger.spec.ts`. Expected after Task 5: PASS.
- [ ] Commit:

```bash
git add lib/actions/transfers.ts components/transfer-form.tsx app/\(app\)/transfers/new e2e/ledger.spec.ts
git commit -m "feat(transfers): two-leg same and cross-currency transfers with live-rate pre-fill"
```

## Task 5: Transfer group page: effective rate, edit and delete as a unit

**Files:**
- Modify: `lib/actions/transfers.ts` (add `updateTransferGroup`, `deleteTransferGroup`), `e2e/ledger-edit.spec.ts` (add the group-mutation test)
- Create: `app/(app)/transfers/[groupId]/page.tsx`, `components/transfer-group-form.tsx`

**Interfaces:**
- Consumes: `dbPool`, `formatMoney`, `parseToMinor`, `ActionState`.
- Produces: the `/transfers/[groupId]` page (both legs + derived effective rate, per CONTEXT.md: derived, not applied) and group-level mutations; the only mutation path for transfer legs.

**Steps:**

- [ ] Add the failing group-mutation test to `e2e/ledger-edit.spec.ts` (reuses the `createAccount` helper):

```ts
test('transfer group edits and deletes as a unit; legs are not directly editable', async ({
  page,
}) => {
  const run = Date.now()
  const a = `Grp A ${run}`
  const b = `Grp B ${run}`
  await createAccount(page, a, 'USD', '500.00')
  await createAccount(page, b, 'USD', '0.00')

  // same-currency transfer: one amount, two legs
  await page.goto('/transfers/new')
  await page.getByLabel('From').selectOption({ label: `${a} (USD)` })
  await page.getByLabel('To').selectOption({ label: `${b} (USD)` })
  await page.getByLabel('Amount', { exact: true }).fill('200.00')
  await page.getByRole('button', { name: 'Create transfer' }).click()
  await page.waitForURL(/\/transfers\//)

  // edit the group: both legs move together
  await page.getByLabel(/Amount sent|Amount/).first().fill('250.00')
  await page.getByRole('button', { name: 'Save transfer' }).click()
  await page.goto('/accounts')
  await expect(page.getByRole('link', { name: new RegExp(a) })).toContainText('$250.00')
  await expect(page.getByRole('link', { name: new RegExp(b) })).toContainText('$250.00')

  // a leg opened from history lands on the group page, not the row editor
  await page.goto('/transactions')
  await page.getByRole('link', { name: /transfer_out/ }).first().click()
  await page.waitForURL(/\/transfers\//)

  // delete the group: both legs vanish
  await page.getByRole('button', { name: 'Delete transfer' }).click()
  await page.waitForURL(/\/transactions$/)
  await page.goto('/accounts')
  await expect(page.getByRole('link', { name: new RegExp(a) })).toContainText('$500.00')
  await expect(page.getByRole('link', { name: new RegExp(b) })).toContainText('$0.00')
})
```

- [ ] Run it: `npx playwright test e2e/ledger-edit.spec.ts`. Expected FAIL: `/transfers/<groupId>` 404s after creation.
- [ ] Append to `lib/actions/transfers.ts`:

```ts
const groupUpdateSchema = z.object({
  groupId: z.string().uuid(),
  amountSent: z.string().trim().min(1, 'Amount is required'),
  amountReceived: z.string().trim().optional(),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date'),
  note: z.string().trim().max(500).optional(),
})

async function loadGroupLegs(userId: string, groupId: string) {
  const legs = await db
    .select()
    .from(transactions)
    .where(
      and(eq(transactions.transferGroupId, groupId), eq(transactions.userId, userId)),
    )
  const out = legs.find((l) => l.type === 'transfer_out')
  const inn = legs.find((l) => l.type === 'transfer_in')
  if (!out || !inn) return null
  return { out, inn }
}

export async function updateTransferGroup(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser()
  const parsed = groupUpdateSchema.safeParse({
    groupId: formData.get('groupId'),
    amountSent: formData.get('amountSent'),
    amountReceived: formData.get('amountReceived') || undefined,
    occurredOn: formData.get('occurredOn'),
    note: formData.get('note') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const d = parsed.data
  const group = await loadGroupLegs(user.id, d.groupId)
  if (!group) return { error: 'Transfer not found' }
  const cross = group.out.currency !== group.inn.currency
  if (cross && !d.amountReceived) return { error: 'Enter the actual amount received' }

  let sentMinor: number
  let receivedMinor: number
  try {
    sentMinor = parseToMinor(d.amountSent, group.out.currency)
    receivedMinor = cross
      ? parseToMinor(d.amountReceived!, group.inn.currency)
      : sentMinor
  } catch {
    return { error: 'Amounts must be valid numbers' }
  }
  if (sentMinor <= 0 || receivedMinor <= 0) return { error: 'Amounts must be positive' }

  // Legs mutate as a group, atomically (spec §3).
  await dbPool.transaction(async (tx) => {
    await tx
      .update(transactions)
      .set({ amountMinor: -sentMinor, occurredOn: d.occurredOn, note: d.note ?? null })
      .where(and(eq(transactions.id, group.out.id), eq(transactions.userId, user.id)))
    await tx
      .update(transactions)
      .set({ amountMinor: receivedMinor, occurredOn: d.occurredOn, note: d.note ?? null })
      .where(and(eq(transactions.id, group.inn.id), eq(transactions.userId, user.id)))
  })
  revalidatePath('/transactions')
  revalidatePath('/accounts')
  revalidatePath('/')
  redirect(`/transfers/${d.groupId}`)
}

export async function deleteTransferGroup(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser()
  const parsed = z
    .object({ groupId: z.string().uuid() })
    .safeParse({ groupId: formData.get('groupId') })
  if (!parsed.success) return { error: 'Invalid transfer' }

  await dbPool.transaction(async (tx) => {
    await tx
      .delete(transactions)
      .where(
        and(
          eq(transactions.transferGroupId, parsed.data.groupId),
          eq(transactions.userId, user.id),
        ),
      )
  })
  revalidatePath('/transactions')
  revalidatePath('/accounts')
  revalidatePath('/')
  redirect('/transactions')
}
```

- [ ] Create `app/(app)/transfers/[groupId]/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { accounts, transactions } from '@/lib/db/schema'
import { formatMoney } from '@/lib/money/money'
import { TransferGroupForm } from '@/components/transfer-group-form'

export default async function TransferGroupPage({
  params,
}: {
  params: Promise<{ groupId: string }>
}) {
  const user = await requireUser()
  const { groupId } = await params
  const legs = await db
    .select({
      id: transactions.id,
      type: transactions.type,
      amountMinor: transactions.amountMinor,
      currency: transactions.currency,
      occurredOn: transactions.occurredOn,
      note: transactions.note,
      accountName: accounts.name,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(
      and(eq(transactions.transferGroupId, groupId), eq(transactions.userId, user.id)),
    )
  const out = legs.find((l) => l.type === 'transfer_out')
  const inn = legs.find((l) => l.type === 'transfer_in')
  if (!out || !inn) notFound()

  const sentMinor = -out.amountMinor
  const cross = out.currency !== inn.currency

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Transfer</h1>
      <div className="space-y-1 rounded border p-4 text-sm">
        <p>
          {out.accountName}:{' '}
          <span className="font-mono">
            {formatMoney({ amountMinor: out.amountMinor, currency: out.currency })}
          </span>
        </p>
        <p>
          {inn.accountName}:{' '}
          <span className="font-mono">
            {formatMoney({ amountMinor: inn.amountMinor, currency: inn.currency })}
          </span>
        </p>
        {cross && (
          <p className="text-gray-500">
            {/* Derived from the two actual legs, never applied (CONTEXT.md). */}
            Effective rate: 1 {out.currency} ={' '}
            {(inn.amountMinor / sentMinor).toFixed(4)} {inn.currency}
          </p>
        )}
        <p className="text-gray-500">{out.occurredOn}</p>
      </div>
      <TransferGroupForm
        groupId={groupId}
        cross={cross}
        sent={(sentMinor / 100).toFixed(2)}
        received={(inn.amountMinor / 100).toFixed(2)}
        occurredOn={out.occurredOn}
        note={out.note ?? ''}
        fromCurrency={out.currency}
        toCurrency={inn.currency}
      />
    </div>
  )
}
```

- [ ] Create `components/transfer-group-form.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import type { ActionState } from '@/lib/actions/accounts'
import { deleteTransferGroup, updateTransferGroup } from '@/lib/actions/transfers'

export function TransferGroupForm(props: {
  groupId: string
  cross: boolean
  sent: string
  received: string
  occurredOn: string
  note: string
  fromCurrency: string
  toCurrency: string
}) {
  const [updateState, updateAction] = useActionState<ActionState, FormData>(
    updateTransferGroup,
    null,
  )
  const [deleteState, deleteAction] = useActionState<ActionState, FormData>(
    deleteTransferGroup,
    null,
  )
  return (
    <div className="space-y-6">
      <form action={updateAction} className="space-y-4">
        <input type="hidden" name="groupId" value={props.groupId} />
        <label className="block">
          <span className="text-sm">
            {props.cross ? `Amount sent (${props.fromCurrency})` : 'Amount'}
          </span>
          <input
            name="amountSent"
            defaultValue={props.sent}
            inputMode="decimal"
            required
            className="mt-1 w-full rounded border p-3"
          />
        </label>
        {props.cross && (
          <label className="block">
            <span className="text-sm">Amount received ({props.toCurrency})</span>
            <input
              name="amountReceived"
              defaultValue={props.received}
              inputMode="decimal"
              required
              className="mt-1 w-full rounded border p-3"
            />
          </label>
        )}
        <label className="block">
          <span className="text-sm">Date</span>
          <input
            type="date"
            name="occurredOn"
            defaultValue={props.occurredOn}
            required
            className="mt-1 w-full rounded border p-3"
          />
        </label>
        <label className="block">
          <span className="text-sm">Note</span>
          <input name="note" defaultValue={props.note} className="mt-1 w-full rounded border p-3" />
        </label>
        {updateState?.error && (
          <p className="text-sm text-red-600">{updateState.error}</p>
        )}
        <button className="w-full rounded bg-blue-600 py-3 text-white">
          Save transfer
        </button>
      </form>
      <form action={deleteAction}>
        <input type="hidden" name="groupId" value={props.groupId} />
        {deleteState?.error && (
          <p className="text-sm text-red-600">{deleteState.error}</p>
        )}
        <button className="w-full rounded border border-red-600 py-3 text-red-600">
          Delete transfer
        </button>
      </form>
    </div>
  )
}
```

- [ ] Run: `npx playwright test e2e/ledger.spec.ts`. Expected PASS now that the group page exists (effective-rate assertion included). The group-mutation test in `ledger-edit.spec.ts` still needs history (Task 7) for its leg-click step.
- [ ] Commit:

```bash
git add lib/actions/transfers.ts components/transfer-group-form.tsx app/\(app\)/transfers/\[groupId\] e2e/ledger-edit.spec.ts
git commit -m "feat(transfers): group page with effective rate, edit and delete as a unit"
```

## Task 6: Reconciliation (set actual balance)

**Files:**
- Modify: `lib/actions/transactions.ts` (add `reconcileAccount`), `components/account-settings-form.tsx` (add the form), `app/(app)/accounts/[id]/page.tsx` (pass the current balance), `e2e/ledger.spec.ts` (add the reconcile test)

**Interfaces:**
- Consumes: `accountBalanceMinor`, `parseToMinor`, `todayCairo`, `formatMoney`, `ActionState`.
- Produces: `reconcileAccount` server action: posts an `adjustment` transaction for `actual - derived`; zero delta posts nothing.

**Steps:**

- [ ] Add the failing reconcile test to `e2e/ledger.spec.ts`:

```ts
test('reconciliation posts an adjustment for the delta', async ({ page }) => {
  const name = `Recon EGP ${Date.now()}`
  await createAccount(page, name, 'EGP', '5200.00')

  await page.getByRole('link', { name: new RegExp(name) }).click()
  await page.getByLabel('Actual balance').fill('5150.00')
  await page.getByRole('button', { name: 'Set actual balance' }).click()

  await page.goto('/accounts')
  await expect(page.getByRole('link', { name: new RegExp(name) })).toContainText(
    'EGP 5,150.00',
  )
})
```

- [ ] Run it: `npx playwright test e2e/ledger.spec.ts`. Expected FAIL: no `Actual balance` field on the account page.
- [ ] Append `reconcileAccount` to `lib/actions/transactions.ts`:

```ts
export async function reconcileAccount(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser()
  const parsed = z
    .object({
      accountId: z.string().uuid(),
      actualBalance: z.string().trim().min(1, 'Actual balance is required'),
    })
    .safeParse({
      accountId: formData.get('accountId'),
      actualBalance: formData.get('actualBalance'),
    })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, parsed.data.accountId), eq(accounts.userId, user.id)))
  if (!account) return { error: 'Account not found' }

  let actualMinor: number
  try {
    // Negative allowed: the ledger records reality (ADR: negative balances).
    actualMinor = parseToMinor(parsed.data.actualBalance, account.currency)
  } catch {
    return { error: 'Actual balance is not a valid amount' }
  }

  // ponytail: read-then-insert without a lock; single user, no concurrent writers.
  const { accountBalanceMinor } = await import('@/lib/db/queries')
  const currentMinor = await accountBalanceMinor(account.id)
  const delta = actualMinor - currentMinor
  if (delta !== 0) {
    await db.insert(transactions).values({
      userId: user.id,
      accountId: account.id,
      type: 'adjustment',
      amountMinor: delta,
      currency: account.currency,
      occurredOn: todayCairo(),
      note: 'Reconciliation',
    })
  }
  revalidatePath('/transactions')
  revalidatePath('/accounts')
  revalidatePath('/')
  redirect(`/accounts/${account.id}`)
}
```

Use a top-level import instead of the inline `await import` if there is no circular-import problem (there is not; queries.ts imports only the db client and schema): add `import { accountBalanceMinor } from '@/lib/db/queries'` to the imports and drop the inline line. Also add `import { todayCairo } from '@/lib/dates/cairo'` if Task 2's file does not already have it.

- [ ] Extend `components/account-settings-form.tsx`: widen the prop and add the reconcile form (rename/archive forms unchanged):

```tsx
// prop type gains the current balance for display:
//   account: { id: string; name: string; currency: string; balanceFormatted: string }
// add a third useActionState pair:
const [reconcileState, reconcileAction] = useActionState<ActionState, FormData>(
  reconcileAccount,
  null,
)
// and render, between the rename and archive forms:
<form action={reconcileAction} className="space-y-2">
  <input type="hidden" name="accountId" value={account.id} />
  <p className="text-sm text-gray-500">Ledger balance: {account.balanceFormatted}</p>
  <label className="block">
    <span className="text-sm">Actual balance</span>
    <input
      name="actualBalance"
      inputMode="decimal"
      required
      className="mt-1 w-full rounded border p-3"
    />
  </label>
  {reconcileState?.error && (
    <p className="text-sm text-red-600">{reconcileState.error}</p>
  )}
  <button className="w-full rounded border py-3">Set actual balance</button>
</form>
```

- [ ] Update `app/(app)/accounts/[id]/page.tsx` to pass the balance:

```tsx
// add imports:
import { accountBalanceMinor } from '@/lib/db/queries'
import { formatMoney } from '@/lib/money/money'
// after loading the account:
const balanceMinor = await accountBalanceMinor(account.id)
// pass it down:
<AccountSettingsForm
  account={{
    id: account.id,
    name: account.name,
    currency: account.currency,
    balanceFormatted: formatMoney({ amountMinor: balanceMinor, currency: account.currency }),
  }}
/>
```

- [ ] Run: `npx playwright test e2e/ledger.spec.ts`. Expected PASS: expense + transfer + reconcile all green.
- [ ] Commit:

```bash
git add lib/actions/transactions.ts components/account-settings-form.tsx app/\(app\)/accounts/\[id\] e2e/ledger.spec.ts
git commit -m "feat(ledger): reconciliation posts adjustment for the delta"
```

## Task 7: History screen with filters

**Files:**
- Modify: `app/(app)/transactions/page.tsx` (replace the P0 placeholder)

**Interfaces:**
- Consumes: `db`, `transactions`/`accounts` schema, `TRANSACTION_TYPES`, `formatMoney`.
- Produces: the Ledger tab: newest-first list with account, type, date-range filters via GET query params (native form, no client state); rows link to the editor (plain) or the group page (transfer legs). The spec's category filter joins in P6 when categories exist.

**Steps:**

- [ ] Replace `app/(app)/transactions/page.tsx`:

```tsx
import Link from 'next/link'
import { and, asc, desc, eq, gte, isNull, lte, type SQL } from 'drizzle-orm'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { accounts, transactions, TRANSACTION_TYPES } from '@/lib/db/schema'
import { formatMoney } from '@/lib/money/money'

interface Filters {
  account?: string
  type?: string
  from?: string
  to?: string
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Filters>
}) {
  const user = await requireUser()
  const sp = await searchParams

  const conds: SQL[] = [eq(transactions.userId, user.id)]
  if (sp.account) conds.push(eq(transactions.accountId, sp.account))
  if (sp.type && (TRANSACTION_TYPES as readonly string[]).includes(sp.type)) {
    conds.push(eq(transactions.type, sp.type as (typeof TRANSACTION_TYPES)[number]))
  }
  if (sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from)) {
    conds.push(gte(transactions.occurredOn, sp.from))
  }
  if (sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to)) {
    conds.push(lte(transactions.occurredOn, sp.to))
  }

  const [rows, accountRows] = await Promise.all([
    db
      .select({
        id: transactions.id,
        type: transactions.type,
        amountMinor: transactions.amountMinor,
        currency: transactions.currency,
        occurredOn: transactions.occurredOn,
        note: transactions.note,
        transferGroupId: transactions.transferGroupId,
        accountName: accounts.name,
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .where(and(...conds))
      .orderBy(desc(transactions.occurredOn), desc(transactions.createdAt))
      .limit(100),
    db
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.userId, user.id), isNull(accounts.archivedAt)))
      .orderBy(asc(accounts.createdAt)),
  ])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Ledger</h1>
        <div className="flex gap-2">
          <Link
            href="/transactions/new"
            className="rounded bg-blue-600 px-3 py-2 text-sm text-white"
          >
            Add
          </Link>
          <Link href="/transfers/new" className="rounded border px-3 py-2 text-sm">
            Transfer
          </Link>
        </div>
      </div>

      {/* Native GET form: filters live in the URL, zero client state. */}
      <form method="get" className="grid grid-cols-2 gap-2 rounded border p-3 text-sm">
        <label className="block">
          <span>Account</span>
          <select name="account" defaultValue={sp.account ?? ''} className="mt-1 w-full rounded border p-2">
            <option value="">All</option>
            {accountRows.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span>Type</span>
          <select name="type" defaultValue={sp.type ?? ''} className="mt-1 w-full rounded border p-2">
            <option value="">All</option>
            {TRANSACTION_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span>From</span>
          <input type="date" name="from" defaultValue={sp.from ?? ''} className="mt-1 w-full rounded border p-2" />
        </label>
        <label className="block">
          <span>To</span>
          <input type="date" name="to" defaultValue={sp.to ?? ''} className="mt-1 w-full rounded border p-2" />
        </label>
        <button className="col-span-2 rounded border py-2">Filter</button>
      </form>

      <ul className="divide-y rounded border">
        {rows.map((t) => (
          <li key={t.id}>
            <Link
              href={t.transferGroupId ? `/transfers/${t.transferGroupId}` : `/transactions/${t.id}`}
              className="flex items-center justify-between p-3"
            >
              <span className="min-w-0">
                <span className="block truncate">{t.note || t.type}</span>
                <span className="block text-xs text-gray-500">
                  {t.type} · {t.accountName} · {t.occurredOn}
                </span>
              </span>
              <span
                className={`font-mono ${t.amountMinor < 0 ? 'text-red-600' : 'text-green-700'}`}
              >
                {formatMoney({ amountMinor: t.amountMinor, currency: t.currency })}
              </span>
            </Link>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="p-3 text-sm text-gray-500">Nothing here yet.</li>
        )}
      </ul>
    </div>
  )
}
```

- [ ] Run the whole edit spec, now clickable end to end: `npx playwright test e2e/ledger-edit.spec.ts`. Expected PASS: plain-row edit/delete + transfer group mutations (the leg click lands on the group page via the row's link target; the row editor's own transfer redirect from Task 3 covers deep links).
- [ ] Manual check: filter by account, by type `transfer_out`, and by a date range; the URL carries the filters and reload preserves them.
- [ ] Commit:

```bash
git add app/\(app\)/transactions/page.tsx
git commit -m "feat(ledger): history screen with account, type and date filters"
```

## Task 8: Dashboard v1 (net worth headline, breakdown, recent activity)

**Files:**
- Modify: `app/(app)/page.tsx` (extend P1's placeholder)

**Interfaces:**
- Consumes: `getSettings`, `totalsByCurrency`, `getRates`, `convert`, `formatMoney`, `CURRENCIES`, `db` + schema for the recent list.
- Produces: dashboard v1; P3 adds the attention list on top, P10 adds trend charts. The headline stays the single place the combined figure is computed (convert each total once, round half-up, sum).

**Steps:**

- [ ] Replace `app/(app)/page.tsx`:

```tsx
import Link from 'next/link'
import { desc, eq } from 'drizzle-orm'
import { requireUser } from '@/lib/auth'
import { convert } from '@/lib/currency/convert'
import { getRates } from '@/lib/currency/rates'
import { db } from '@/lib/db/client'
import { accounts, transactions } from '@/lib/db/schema'
import { getSettings, totalsByCurrency } from '@/lib/db/queries'
import { CURRENCIES, formatMoney } from '@/lib/money/money'

const DAY_MS = 24 * 60 * 60 * 1000

export default async function HomePage() {
  const user = await requireUser()
  const [s, totals, rates, recent] = await Promise.all([
    getSettings(user.id),
    totalsByCurrency(user.id),
    getRates(),
    db
      .select({
        id: transactions.id,
        type: transactions.type,
        amountMinor: transactions.amountMinor,
        currency: transactions.currency,
        occurredOn: transactions.occurredOn,
        note: transactions.note,
        transferGroupId: transactions.transferGroupId,
        accountName: accounts.name,
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .where(eq(transactions.userId, user.id))
      .orderBy(desc(transactions.occurredOn), desc(transactions.createdAt))
      .limit(10),
  ])
  const home = s.homeCurrency
  // Convert each per-currency total once, round half-up, then sum (spec §3).
  const netWorth = CURRENCIES.reduce(
    (sum, c) => sum + convert(totals[c] ?? 0, c, home, rates),
    0,
  )
  const stale = Date.now() - new Date(rates.fetchedAt).getTime() > DAY_MS

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">My Ledger</h1>

      <section className="rounded border p-4">
        <p className="text-sm text-gray-500">Total ({home})</p>
        <p className="text-3xl font-bold">
          {formatMoney({ amountMinor: netWorth, currency: home })}
        </p>
        {stale && (
          <p className="text-xs text-amber-600">
            Rates from {new Date(rates.fetchedAt).toLocaleDateString('en-GB')} (stale)
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-gray-500">Per currency</h2>
        <ul className="divide-y rounded border">
          {CURRENCIES.filter((c) => totals[c] !== undefined).map((c) => (
            <li key={c} className="flex justify-between p-3">
              <span>{c}</span>
              <span className="font-mono">
                {formatMoney({ amountMinor: totals[c]!, currency: c })}
              </span>
            </li>
          ))}
          {Object.keys(totals).length === 0 && (
            <li className="p-3 text-sm text-gray-500">
              No money tracked yet. Create an account to start.
            </li>
          )}
        </ul>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-500">Recent activity</h2>
          <Link href="/transactions" className="text-sm text-blue-600">
            See all
          </Link>
        </div>
        <ul className="divide-y rounded border">
          {recent.map((t) => (
            <li key={t.id}>
              <Link
                href={
                  t.transferGroupId
                    ? `/transfers/${t.transferGroupId}`
                    : `/transactions/${t.id}`
                }
                className="flex items-center justify-between p-3"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm">{t.note || t.type}</span>
                  <span className="block text-xs text-gray-500">
                    {t.accountName} · {t.occurredOn}
                  </span>
                </span>
                <span
                  className={`font-mono text-sm ${
                    t.amountMinor < 0 ? 'text-red-600' : 'text-green-700'
                  }`}
                >
                  {formatMoney({ amountMinor: t.amountMinor, currency: t.currency })}
                </span>
              </Link>
            </li>
          ))}
          {recent.length === 0 && (
            <li className="p-3 text-sm text-gray-500">No activity yet.</li>
          )}
        </ul>
      </section>
    </div>
  )
}
```

- [ ] Verify: `npx playwright test e2e/settings.spec.ts` still passes (the `Total (...)` headline survived), and manually confirm recent activity lists the P2 test rows newest-first with signed coloring.
- [ ] Commit:

```bash
git add app/\(app\)/page.tsx
git commit -m "feat(dashboard): net worth headline, per-currency breakdown, recent activity"
```

## Task 9: Phase gate

**Files:**
- Modify: none (run everything); `docs/wiki/status.md`

**Steps:**

- [ ] Full suite:

```bash
npm run lint && npm run format:check && npm run test && npm run build
npm run e2e
```

Expected: unit tests green (money, cairo, convert, rates, queries, mutability); E2E green: setup, unauth redirect, shell, accounts, settings, ledger (expense + cross-currency transfer with both legs + reconcile, balances verified), ledger-edit (plain edit/delete + transfer group as a unit). Paste the output as evidence.

- [ ] Manual mobile-viewport walkthrough: post an expense, make a same-currency and a cross-currency transfer (watch the live-rate suggestion pre-fill and the effective rate afterwards), reconcile an account, filter history, check the dashboard headline changes with the home currency.
- [ ] Update [docs/wiki/status.md](../../wiki/status.md): P2 complete.
- [ ] Commit:

```bash
git add docs/wiki/status.md
git commit -m "docs: mark P2 complete"
```

**Backlinks:** [Master index](README.md) | [Spec](../specs/2026-07-07-my-ledger-design.md) | Prev: [01-accounts-and-currency.md](01-accounts-and-currency.md) | Next: [03-income.md](03-income.md)


