import { expect, test } from '@playwright/test'

test('authenticated user sees the bottom-tab shell', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'My Ledger', exact: true }),
  ).toBeVisible({ timeout: 30_000 })
  for (const tab of ['Home', 'Ledger', 'Plan', 'More']) {
    await expect(page.getByRole('link', { name: tab })).toBeVisible()
  }
})
