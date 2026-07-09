import { expect, test as setup } from '@playwright/test'

const authFile = 'e2e/.auth/user.json'
const EMAIL = process.env.E2E_TEST_EMAIL!
const PASSWORD = process.env.E2E_TEST_PASSWORD!

setup('register (first run) then sign in', async ({ page }) => {
  // Best-effort registration: succeeds first run, errors harmlessly if the user exists.
  await page.goto('/sign-up')
  await page.getByLabel('Email').fill(EMAIL)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: /create account/i }).click()
  await Promise.race([
    page.waitForURL('/').catch(() => {}),
    page.getByRole('alert').waitFor({ timeout: 5000 }).catch(() => {}),
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
