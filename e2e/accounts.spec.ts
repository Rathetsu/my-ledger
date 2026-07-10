import { expect, test } from '@playwright/test'
import { createAccount } from './helpers'

test('cannot archive an account still targeted by an active bill', async ({
  page,
}) => {
  const stamp = Date.now()
  const accountName = `Blocked EGP ${stamp}`
  const billName = `Rent ${stamp}`
  await createAccount(page, accountName, 'EGP', '5000.00')

  // Active bill on the account.
  await page.goto('/bills/new')
  await page.getByLabel('Name').fill(billName)
  await page.getByLabel('Amount').fill('1500.00')
  await page
    .getByLabel('Account')
    .selectOption({ label: `${accountName} (EGP)` })
  await page.getByLabel('Due day').fill('1')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.waitForURL('/bills')

  // Archival is blocked and names the offending bill; the account stays active.
  await page.goto('/accounts')
  await page.getByRole('link', { name: new RegExp(accountName) }).click()
  await page.getByRole('button', { name: 'Archive account' }).click()
  await expect(
    page.getByText(new RegExp(`Cannot archive: still targeted by .*${billName}`)),
  ).toBeVisible()
})

test('create account with opening balance, rename, archive', async ({
  page,
}) => {
  const name = `Main EUR ${Date.now()}`

  await page.goto('/accounts')
  await page.getByRole('link', { name: 'Add account' }).click()
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Currency').selectOption('EUR')
  await page.getByLabel('Opening balance').fill('1,234.56')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.waitForURL('/accounts')

  const row = page.getByRole('link', { name: new RegExp(name) })
  await expect(row).toContainText('€1,234.56')

  // rename
  await row.click()
  await page.getByLabel('Name').fill(`${name} renamed`)
  await page.getByRole('button', { name: 'Rename' }).click()
  await page.waitForURL('/accounts')
  await expect(page.getByText(`${name} renamed`)).toBeVisible()

  // archive (nothing targets accounts yet, so this always succeeds in P1)
  await page.getByRole('link', { name: new RegExp(name) }).click()
  await page.getByRole('button', { name: 'Archive account' }).click()
  await page.waitForURL('/accounts')
  await expect(page.getByText(`${name} renamed`)).not.toBeVisible()
})
