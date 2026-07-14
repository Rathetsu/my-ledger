import { expect, test } from '@playwright/test'

test('home currency defaults to EUR and is switchable', async ({ page }) => {
  await page.goto('/settings')
  await expect(page.getByLabel('Home currency')).toHaveValue('EUR')

  await page.getByLabel('Home currency').selectOption('EGP')
  // The settings page now has multiple Save buttons (home currency + AI advisor
  // toggle, added in P9), so scope to the home-currency form specifically.
  await page
    .locator('form', { has: page.getByLabel('Home currency') })
    .getByRole('button', { name: 'Save' })
    .click()
  // The Save button submits via a Next.js server action (client-side fetch,
  // not a blocking form POST), so click() can resolve before the mutation
  // lands; wait for that in-flight request to settle before navigating away.
  await page.waitForLoadState('networkidle')
  await page.goto('/')
  await expect(page.getByText('Total (EGP)')).toBeVisible()

  // restore so other specs see the default
  await page.goto('/settings')
  await page.getByLabel('Home currency').selectOption('EUR')
  // The settings page now has multiple Save buttons (home currency + AI advisor
  // toggle, added in P9), so scope to the home-currency form specifically.
  await page
    .locator('form', { has: page.getByLabel('Home currency') })
    .getByRole('button', { name: 'Save' })
    .click()
  await page.waitForLoadState('networkidle')
  await page.goto('/')
  await expect(page.getByText('Total (EUR)')).toBeVisible()
})
