import type { Page } from '@playwright/test'

export async function createAccount(
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
