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

test('transfer group edits and deletes as a unit; legs are not directly editable', async ({
  page,
}) => {
  const run = Date.now()
  const a = `Grp A ${run}`
  const b = `Grp B ${run}`
  await createAccount(page, a, 'USD', '500.00')
  await createAccount(page, b, 'USD', '0.00')

  // same-currency transfer: one amount, two legs
  await page.goto('/transfers/new')
  await page.getByLabel('From').selectOption({ label: `${a} (USD)` })
  await page.getByLabel('To').selectOption({ label: `${b} (USD)` })
  await page.getByLabel('Amount', { exact: true }).fill('200.00')
  await page.getByRole('button', { name: 'Create transfer' }).click()
  // /transfers/new itself matches /\/transfers\//, so exclude it or this can
  // resolve before the real navigation to /transfers/<groupId> lands.
  await page.waitForURL(/\/transfers\/(?!new)/)

  // edit the group: both legs move together
  await page
    .getByLabel(/Amount sent|Amount/)
    .first()
    .fill('250.00')
  await page.getByRole('button', { name: 'Save transfer' }).click()
  await page.goto('/accounts')
  await expect(page.getByRole('link', { name: new RegExp(a) })).toContainText(
    '$250.00',
  )
  await expect(page.getByRole('link', { name: new RegExp(b) })).toContainText(
    '$250.00',
  )

  // a leg opened from history lands on the group page, not the row editor
  await page.goto('/transactions')
  await page
    .getByRole('link', { name: /transfer_out/ })
    .first()
    .click()
  await page.waitForURL(/\/transfers\//)

  // delete the group: both legs vanish
  await page.getByRole('button', { name: 'Delete transfer' }).click()
  await page.waitForURL(/\/transactions$/)
  await page.goto('/accounts')
  await expect(page.getByRole('link', { name: new RegExp(a) })).toContainText(
    '$500.00',
  )
  await expect(page.getByRole('link', { name: new RegExp(b) })).toContainText(
    '$0.00',
  )
})
