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
        advice:
          'Mocked second opinion: the payoff order looks right; debtB first.',
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
  // A fresh sign-up auto-authenticates (Better Auth sets the session) and the
  // form redirects to the dashboard. Unlike auth.setup.ts — whose fixed user
  // pre-exists, so its sign-up errors and a separate /sign-in is required — this
  // fresh user is already signed in, and /sign-in would redirect back to '/'.
  await page.waitForURL('/')

  // 2. First-run: dashboard shows the setup checklist, list screens show their
  //    existing empty-state copy (Task 3 keeps it).
  await expect(page.getByLabel('Set up My Ledger')).toBeVisible()
  await expect(
    page.getByRole('link', { name: /create your accounts/i }),
  ).toBeVisible()
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
  await expect(
    page.getByText('Nothing here yet. Add something you are saving for.'),
  ).toBeVisible()
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
  await page
    .getByLabel('Account')
    .selectOption({ label: `${eurAccount} (EUR)` })
  await page.getByLabel('Day of month').fill('25')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.waitForURL('/income')
  await expect(
    page.getByRole('link', { name: new RegExp(salary) }),
  ).toBeVisible()

  // 5. Dashboard housekeeping generated the occurrence; confirm the salary.
  //    Attention rows are buttons named by source name; the sheet is the dialog.
  //    Income has NO 7-day attention window (unlike bills/installments) and
  //    housekeeping seeds this month AND next, so BOTH salary occurrences show;
  //    confirm each so nothing income-related lingers into step 13's settled state.
  await page.goto('/')
  const salaryRows = page.getByRole('button', { name: new RegExp(salary) })
  for (let n = await salaryRows.count(); n > 0; n = await salaryRows.count()) {
    await salaryRows.first().click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Confirm', exact: true })
      .click()
    // Confirm goes through a server action + router.refresh() round trip against
    // live Neon; under load that can exceed the 5s default (see income.spec).
    await expect(salaryRows).toHaveCount(n - 1, { timeout: 15_000 })
  }

  // 6. Add the rent bill (due day 1 makes this month's occurrence overdue) and confirm it.
  await page.goto('/bills')
  await page.getByRole('link', { name: 'New bill' }).click()
  await page.getByLabel('Name').fill(rent)
  await page.getByLabel('Amount').fill('12000.00')
  await page
    .getByLabel('Account')
    .selectOption({ label: `${egpAccount} (EGP)` })
  await page.getByLabel('Due day').fill('1')
  await page.getByRole('button', { name: 'Create' }).click()
  // Wait for the create to commit (redirect) before '/' runs housekeeping —
  // otherwise the occurrence isn't generated yet and Attention stays empty.
  await page.waitForURL('/bills')
  await page.goto('/')
  await expect(
    page.getByRole('button', { name: new RegExp(`${rent}.*Overdue`) }),
  ).toBeVisible()
  await page.getByRole('button', { name: new RegExp(rent) }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: new RegExp(rent) }),
  ).toHaveCount(0, { timeout: 15_000 })

  // 7. Add an installment (no remaining-count field on create) and confirm one payment.
  await page.goto('/installments')
  await page.getByRole('link', { name: 'New installment' }).click()
  await page.getByLabel('Name').fill(phone)
  await page.getByLabel('Monthly amount').fill('1500.00')
  await page
    .getByLabel('Account')
    .selectOption({ label: `${egpAccount} (EGP)` })
  await page.getByLabel('Due day').fill('10')
  await page.getByLabel('Total payments').fill('12')
  await page.getByLabel('Start date').fill('2026-07-10')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.waitForURL('/installments')
  await page.goto('/')
  await page.getByRole('button', { name: new RegExp(phone) }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm', exact: true })
    .click()
  // Let the confirm + refresh settle (attention row clears) before navigating.
  await expect(
    page.getByRole('button', { name: new RegExp(phone) }),
  ).toHaveCount(0, { timeout: 15_000 })
  await page.goto('/installments')
  await expect(
    page
      .getByRole('listitem')
      .filter({ hasText: phone })
      .getByText(/Paid 1 of 12/),
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
  await page
    .getByLabel('Account')
    .selectOption({ label: `${egpAccount} (EGP)` })
  await page.getByLabel('Amount').fill('850.00')
  await page.getByLabel('Note').fill(`Groceries ${stamp}`)
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForURL('/transactions')
  await page.goto('/transactions/new')
  await page
    .getByLabel('Account')
    .selectOption({ label: `${egpAccount} (EGP)` })
  await page.getByLabel('Amount').fill('3000.00')
  await page.getByLabel('Note').fill(`Car repair ${stamp}`)
  await page.getByLabel('One-off').check()
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForURL('/transactions')
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
    page
      .getByRole('listitem')
      .filter({ hasText: card })
      .getByText(/Paid off 20\d\d-\d\d|Beyond \d+ months/),
  ).toBeVisible()
  await expect(
    page
      .getByText(/Transfer ~ .* into (EUR|USD|EGP)|No other currency can cover/)
      .first(),
  ).toBeVisible()
  await expect(page.getByText('Mocked second opinion')).toBeVisible()
  await page.getByText('What gets sent').click()
  const payloadText = await page.getByTestId('ai-payload').textContent()
  expect(payloadText).toContain('debtA')
  expect(payloadText).not.toContain(dadLoan)

  // 12. Purchase the wishlist item: "Buy" opens the inline sheet; the single EUR
  //     account is auto-selected; "Confirm purchase" completes it.
  await page.goto('/wishlist')
  await page
    .getByRole('listitem')
    .filter({ hasText: desk })
    .getByRole('button', { name: 'Buy' })
    .click()
  await page.getByRole('button', { name: 'Confirm purchase' }).click()
  // Purchase posts a source-linked transaction + revalidates; the RSC re-render
  // moving the item into "Purchased" is a round trip that can exceed 5s under load.
  await expect(page.getByRole('heading', { name: 'Purchased' })).toBeVisible({
    timeout: 15_000,
  })
  await expect(
    page
      .getByRole('listitem')
      .filter({ hasText: desk })
      .getByRole('button', { name: 'Un-purchase' }),
  ).toBeVisible()

  // 13. Dashboard: attention list has nothing left; trends section renders
  //     (seed one prior-day snapshot for THIS user so two points exist).
  const [{ id: userId }] =
    (await sql`select id from "user" where email = ${EMAIL}`) as {
      id: string
    }[]
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
  await sql`
    insert into net_worth_snapshots
      (user_id, date, per_currency, combined_minor, home_currency, rates, total_debt_minor)
    values
      (${userId}, ${yesterday}, ${'{"EUR": 340000}'}::jsonb, 340000, 'EUR',
       ${'{"base":"USD","rates":{"USD":1,"EUR":0.9,"EGP":50},"fetchedAt":"2026-07-06T03:00:00.000Z"}'}::jsonb, 0)
    on conflict (user_id, date) do nothing
  `
  await page.goto('/')
  // Assert the dashboard actually rendered (past the loading boundary +
  // housekeeping) BEFORE checking absences, so "gone" means settled rather than
  // still-loading. Two snapshots (seeded yesterday + today) make trends render.
  await expect(
    page.getByRole('heading', { name: /^Net worth \(/ }),
  ).toBeVisible({ timeout: 15_000 })
  await expect(
    page.getByRole('heading', { name: /^Total debt \(/ }),
  ).toBeVisible({ timeout: 15_000 })
  // AttentionList renders nothing at all when every occurrence is settled.
  await expect(page.getByText('Needs attention')).toHaveCount(0)
  // Setup checklist is gone: all four steps are complete.
  await expect(page.getByLabel('Set up My Ledger')).toHaveCount(0)
})
