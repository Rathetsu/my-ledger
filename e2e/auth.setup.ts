import { expect, test as setup } from '@playwright/test'

const authFile = 'e2e/.auth/user.json'
const EMAIL = process.env.E2E_TEST_EMAIL!
const PASSWORD = process.env.E2E_TEST_PASSWORD!

setup('register (first run) then sign in', async ({ page }) => {
  // Best-effort registration: succeeds first run, errors harmlessly if the user exists.
  // Wait on the sign-up API response itself (not a UI signal raced against a timer) so
  // this is robust on a cold run where the first compile + first Neon connection is slow.
  await page.goto('/sign-up')
  await page.getByLabel('Email').fill(EMAIL)
  await page.getByLabel('Password').fill(PASSWORD)
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/auth/sign-up/email')),
    page.getByRole('button', { name: /create account/i }).click(),
  ])

  // Deterministic sign-in.
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(EMAIL)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL('/')
  await expect(page.getByRole('heading', { name: 'My Ledger' })).toBeVisible()

  await page.context().storageState({ path: authFile })
})
