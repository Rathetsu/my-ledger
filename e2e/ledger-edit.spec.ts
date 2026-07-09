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
  await expect(
    page.getByRole('link', { name: new RegExp(name) }),
  ).toContainText('€88.00')

  // delete it
  await page.goto('/transactions')
  await page.getByRole('link', { name: new RegExp(note) }).click()
  await page.getByRole('button', { name: 'Delete' }).click()
  await page.waitForURL(/\/transactions$/)
  await page.goto('/accounts')
  await expect(
    page.getByRole('link', { name: new RegExp(name) }),
  ).toContainText('€100.00')
})
