import { expect, test } from '@playwright/test'
import { createAccount } from './helpers'

test('wishlist lifecycle: badge, advisory purchase, un-purchase', async ({ page }) => {
  const stamp = Date.now()
  // The shared Neon dev DB accumulates hundreds of EUR accounts across runs, so
  // PurchaseSheet's auto-select (only fires for exactly one match) never kicks in.
  // Create a fresh, uniquely-named account and select it explicitly by its
  // "<name> (<balance>)" option label.
  const accountName = `Wishlist EUR ${stamp}`
  const name = `Desk chair ${stamp}`
  await createAccount(page, accountName, 'EUR', '100.00')

  // create an item costing more than the account holds
  await page.goto('/wishlist')
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Cost').fill('9999.00')
  await page.getByRole('button', { name: 'Add' }).click()

  // Longer timeout: creation goes through a server action + revalidatePath,
  // which under dev-server load takes longer than the default 5s to land
  // (same pattern as bills.spec.ts / income.spec.ts).
  const row = page.locator('li', { hasText: name })
  await expect(row).toBeVisible({ timeout: 15_000 })

  // affordability badge comes from the plan
  await expect(row.getByText(/Affordable \d{4}-\d{2}|Beyond \d+ months/)).toBeVisible()

  // purchase: pick our account explicitly (accumulated EUR accounts defeat
  // auto-select), advisory shortfall warning shows, button still works
  await row.getByRole('button', { name: 'Buy' }).click()
  await row.locator('select').selectOption({ label: `${accountName} (€100.00)` })
  await expect(row.getByText('Purchases are never blocked.')).toBeVisible()
  await row.getByRole('button', { name: 'Confirm purchase' }).click()

  // item moved to the Purchased section (its row now offers Un-purchase, not Buy)
  await expect(
    page.locator('li', { hasText: name }).getByRole('button', { name: 'Un-purchase' }),
  ).toBeVisible({ timeout: 15_000 })

  // account went negative (honesty over enforcement); scope to our account's
  // own row since the accounts list also accumulates hundreds of entries
  await page.goto('/accounts')
  await expect(page.getByRole('link', { name: new RegExp(accountName) })).toContainText('-€')

  // un-purchase restores the item to planned (its Buy button returns)
  await page.goto('/wishlist')
  await page.locator('li', { hasText: name }).getByRole('button', { name: 'Un-purchase' }).click()
  await expect(
    page.locator('li', { hasText: name }).getByRole('button', { name: 'Buy' }),
  ).toBeVisible({ timeout: 15_000 })
})
