import { expect, test } from '@playwright/test'
import { createAccount } from './helpers'

test('salary: create source, occurrence appears, confirm with edited amount, balance reflects actual', async ({
  page,
}) => {
  const stamp = Date.now()
  const accountName = `Payroll ${stamp}`
  const sourceName = `Salary ${stamp}`

  // Account with zero opening balance.
  await createAccount(page, accountName, 'EUR', '0')

  // Income source due on the 28th, non-recurring: housekeeping generates
  // exactly one occurrence (a recurring source would also generate next
  // period's occurrence, breaking the single-row assertions below).
  await page.goto('/income/new')
  await page.getByLabel('Name').fill(sourceName)
  await page.getByLabel('Amount').fill('2500.00')
  await page
    .getByLabel('Account')
    .selectOption({ label: `${accountName} (EUR)` })
  await page.getByLabel('Day of month').fill('28')
  await page.getByLabel('Recurring monthly').uncheck()
  await page.getByRole('button', { name: 'Create' }).click()
  await page.waitForURL('/income')

  // Dashboard load runs housekeeping and generates the occurrence.
  await page.goto('/')
  const row = page.getByRole('button', { name: new RegExp(sourceName) })
  await expect(row).toBeVisible()
  await expect(row).toContainText('confirm arrived')
  await row.click()

  // Sheet is pre-filled with the expected amount; edit it to the actual.
  const amount = page.getByLabel(/^Amount/)
  await expect(amount).toHaveValue('2500.00')
  await amount.fill('2600.00')
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()

  // Item leaves the attention list; balance reflects the ACTUAL amount.
  // Longer timeout: confirm goes through a server action + router.refresh()
  // round trip, which under full-suite load can exceed the 5s default.
  await expect(
    page.getByRole('button', { name: new RegExp(sourceName) }),
  ).toHaveCount(0, { timeout: 15_000 })
  await page.goto('/accounts')
  await expect(
    page.getByRole('link', { name: new RegExp(accountName) }),
  ).toContainText('€2,600.00')
})
