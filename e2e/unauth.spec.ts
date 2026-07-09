import { expect, test } from '@playwright/test'

test('unauthenticated visitor is redirected to sign-in', async ({ page }) => {
  await page.goto('/')
  await page.waitForURL(/\/sign-in/)
  await expect(page.getByLabel('Email')).toBeVisible()
})
