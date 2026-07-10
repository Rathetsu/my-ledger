import { expect, test } from '@playwright/test'

// These run under the shared authenticated storageState. We deliberately do NOT
// click Sign out here — signOut deletes the session server-side, which would
// invalidate the saved auth state for every other test in the suite.

test('a sign-out control exists in the app shell (More)', async ({ page }) => {
  await page.goto('/more')
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
})

test('authenticated users are redirected off the auth pages', async ({
  page,
}) => {
  await page.goto('/sign-in')
  await expect(page).toHaveURL('/')
  await page.goto('/sign-up')
  await expect(page).toHaveURL('/')
})
