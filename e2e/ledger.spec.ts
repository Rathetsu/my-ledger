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
  await expect(
    page.getByRole('button', { name: /Use live-rate suggestion/ }),
  ).toBeVisible()
  await page.getByLabel(/Amount received/).fill('5200.00')
  await page.getByRole('button', { name: 'Create transfer' }).click()
  await page.waitForURL(/\/transfers\//)
  await expect(page.getByText('1 EUR = 52.0000 EGP')).toBeVisible()

  await page.goto('/accounts')
  await expect(page.getByRole('link', { name: new RegExp(eur) })).toContainText(
    '€900.00',
  )
  await expect(page.getByRole('link', { name: new RegExp(egp) })).toContainText(
    'EGP 5,200.00',
  )
})

test('reconciliation posts an adjustment for the delta', async ({ page }) => {
  const name = `Recon EGP ${Date.now()}`
  await createAccount(page, name, 'EGP', '5200.00')

  await page.getByRole('link', { name: new RegExp(name) }).click()
  await page.getByLabel('Actual balance').fill('5150.00')
  await page.getByRole('button', { name: 'Set actual balance' }).click()

  await page.goto('/accounts')
  await expect(
    page.getByRole('link', { name: new RegExp(name) }),
  ).toContainText('EGP 5,150.00')
})
