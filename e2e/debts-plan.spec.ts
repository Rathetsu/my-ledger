import { expect, test } from '@playwright/test'
import { createAccount } from './helpers'

test('debt lifecycle and plan screen', async ({ page }) => {
  // This lifecycle touches /debts twice; /debts still fans out one balance query
  // per debt (debtBalanceMinor), and the shared e2e user has accumulated many
  // debts across phases, so cumulative render time can exceed the 60s default.
  // Not a P9 concern (P9 fixed the /plan account fan-out); /debts N+1 is a follow-up.
  test.setTimeout(120_000)
  const stamp = Date.now()
  const accountName = `Debt Acct ${stamp}`
  const debtName = `Family loan ${stamp}`

  // Same-currency non-archived account: DebtPaySheet only renders a Pay button
  // when one exists, and its account select needs an unambiguous option.
  await createAccount(page, accountName, 'EUR', '1000.00')

  // create a debt with APR
  await page.goto('/debts/new')
  await page.getByLabel('Name').fill(debtName)
  await page.getByLabel('Original amount').fill('300.00')
  await page.getByLabel(/APR/).fill('12')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForURL('/debts')

  // The /debts list is unscoped and accumulates rows across every prior run,
  // so scope every assertion to this run's uniquely-stamped row.
  const row = page.locator('li', { hasText: debtName })
  // Post-mutation balance assertions wait on a server action + revalidatePath
  // round trip; under dev-server load against the accumulated Neon DB this lands
  // slower than the default 5s, so use the 15s convention (bills/income/wishlist specs).
  await expect(row.getByText('€300.00')).toBeVisible({ timeout: 15_000 })

  // Record a payment. The dev DB also accumulates EUR accounts from other specs,
  // so the account select isn't a single-option default: pick ours explicitly.
  await row.getByRole('button', { name: 'Pay' }).click()
  await row.getByRole('combobox').selectOption({ label: accountName })
  await row.getByLabel('Amount').fill('100.00')
  await row.getByRole('button', { name: 'Record payment' }).click()
  await expect(row.getByText('€200.00')).toBeVisible({ timeout: 15_000 })

  // plan screen: algorithm panel, AI second opinion panel, payoff badge.
  // The panel's advice/degraded text depends on an async fetch resolving; its
  // heading renders synchronously regardless of that state, so assert the heading
  // instead of racing the fetch (no GEMINI_API_KEY in the e2e env, so the route
  // always returns advice: null and the panel settles on the degraded string).
  await page.goto('/plan')
  await expect(page.getByText('Algorithm suggests')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'AI second opinion' })).toBeVisible()
  // The "Debt payoff" section lists every debt the user owns; scope to this
  // debt's row (Algorithm suggests can also mention the name in a payment line).
  const debtPayoffSection = page.locator('section', {
    has: page.getByRole('heading', { name: 'Debt payoff' }),
  })
  const planRow = debtPayoffSection.locator('li', { hasText: debtName })
  await expect(planRow).toBeVisible()
  await expect(planRow.getByText(/Paid off \d{4}-\d{2}|Beyond 24 months/)).toBeVisible()

  // reverse the payment from the detail page
  await page.goto('/debts')
  await page.getByRole('link', { name: debtName }).first().click()
  await page.getByRole('button', { name: 'Reverse' }).click()
  await page.goto('/debts')
  await expect(page.locator('li', { hasText: debtName }).getByText('€300.00')).toBeVisible({ timeout: 15_000 })
})
