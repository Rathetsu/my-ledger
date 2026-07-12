import { expect, test } from '@playwright/test'
import { createAccount } from './helpers'

test('debt lifecycle and plan screen', async ({ page }) => {
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
  await expect(row.getByText('€300.00')).toBeVisible()

  // Record a payment. The dev DB also accumulates EUR accounts from other specs,
  // so the account select isn't a single-option default: pick ours explicitly.
  await row.getByRole('button', { name: 'Pay' }).click()
  await row.getByRole('combobox').selectOption({ label: accountName })
  await row.getByLabel('Amount').fill('100.00')
  await row.getByRole('button', { name: 'Record payment' }).click()
  await expect(row.getByText('€200.00')).toBeVisible()

  // plan screen: algorithm panel, AI slot in disabled state, payoff badge
  await page.goto('/plan')
  await expect(page.getByText('Algorithm suggests')).toBeVisible()
  await expect(page.getByText('AI advisor is off.')).toBeVisible()
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
  await expect(page.locator('li', { hasText: debtName }).getByText('€300.00')).toBeVisible()
})
