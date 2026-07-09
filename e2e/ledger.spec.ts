import { expect, test, type Page } from '@playwright/test'

async function createAccount(
  page: Page,
  name: string,
  currency: string,
  opening: string,
) {
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
  await expect(
    page.getByRole('link', { name: new RegExp(name) }),
  ).toContainText('€74.50')
})
