import { expect, test } from '@playwright/test'

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
