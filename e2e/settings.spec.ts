import { expect, test } from '@playwright/test'

test('home currency defaults to EUR and is switchable', async ({ page }) => {
  await page.goto('/settings')
  await expect(page.getByLabel('Home currency')).toHaveValue('EUR')

  await page.getByLabel('Home currency').selectOption('EGP')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.goto('/')
  await expect(page.getByText('Total (EGP)')).toBeVisible()

  // restore so other specs see the default
  await page.goto('/settings')
  await page.getByLabel('Home currency').selectOption('EUR')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.goto('/')
  await expect(page.getByText('Total (EUR)')).toBeVisible()
})
