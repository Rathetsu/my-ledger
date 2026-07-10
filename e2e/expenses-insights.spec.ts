import { expect, test } from '@playwright/test'
import { createAccount } from './helpers'

test('categories, tagged expenses, filtered list, insights charts', async ({
  page,
}) => {
  const stamp = Date.now()
  const accountName = `Spend EGP ${stamp}`
  const categoryName = `Category ${stamp}`

  // Fresh EGP account: no other spec posts "expense"-type transactions in EGP,
  // so this run's insights section isn't diluted by unrelated test data.
  await createAccount(page, accountName, 'EGP', '0')

  // 1. create a category (unique name — categories accumulate across runs on
  // the shared dev DB, so a fixed name like "Groceries" would pile up).
  await page.goto('/expenses/categories')
  await page.getByLabel('Category name').fill(categoryName)
  await page.getByRole('button', { name: 'Add' }).click()
  await expect(page.getByText(categoryName)).toBeVisible()

  // 2. log a categorized expense and a one-off (uncategorized) expense
  await page.goto('/transactions/new')
  await page
    .getByLabel('Account')
    .selectOption({ label: `${accountName} (EGP)` })
  await page.getByLabel('Type').selectOption('expense')
  // ponytail: a large amount keeps this run's fresh category ranked in the
  // insights top-5-by-total bucketing (lib/insights/chart-data.ts
  // pivotByCategory) against whatever other EGP test categories accumulate in
  // the shared dev DB. Ceiling: once 5+ EGP categories this large pile up, it
  // can lose the rank into "Other" — purge stale EGP expense_categories rows
  // if this ever starts flaking on that.
  await page.getByLabel('Amount').fill('500000.00')
  await page.getByLabel('Category').selectOption({ label: categoryName })
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForURL(/\/transactions$/)

  await page.goto('/transactions/new')
  await page
    .getByLabel('Account')
    .selectOption({ label: `${accountName} (EGP)` })
  await page.getByLabel('Type').selectOption('expense')
  await page.getByLabel('Amount').fill('1000.00')
  await page.getByLabel('One-off').check()
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForURL(/\/transactions$/)

  // 3. expenses list: one-off tag shows unfiltered; category filter narrows to it
  await page.goto('/expenses')
  await expect(page.locator('li', { hasText: 'one-off' }).first()).toBeVisible()
  await page
    .locator('select[name="category"]')
    .selectOption({ label: categoryName })
  await page.getByRole('button', { name: 'Go' }).click()
  const filteredRow = page.locator('li', { hasText: categoryName })
  await expect(filteredRow).toHaveCount(1)
  await expect(filteredRow).not.toContainText('one-off')

  // 4. insights: the EGP section renders with the category present
  await page.goto('/expenses/insights')
  const section = page.locator('section', {
    has: page.getByRole('heading', { name: 'EGP spend by category' }),
  })
  await expect(section).toBeVisible()
  // Scope to the plain-text totals list, not the Recharts legend — both render
  // an <li> containing the category name, which would otherwise be a strict-mode
  // violation (two matches) for a bare `li` locator.
  await expect(
    section.locator('ul.text-xs.text-neutral-500 li', { hasText: categoryName }),
  ).toBeVisible()
})
