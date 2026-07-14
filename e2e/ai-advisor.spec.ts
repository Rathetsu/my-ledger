import { expect, test, type Page } from '@playwright/test'
import { createAccount } from './helpers'

// Same-currency non-archived account + a stamped debt, mirroring debts-plan.spec.ts's
// /debts/new flow. Returns the debt's unique name so callers can assert it never
// leaks into the sanitized AI payload.
async function seedDebt(page: Page, stamp: number): Promise<string> {
  const debtName = `AI leak probe ${stamp}`
  await createAccount(page, `AI Acct ${stamp}`, 'EUR', '1000.00')
  await page.goto('/debts/new')
  await page.getByLabel('Name').fill(debtName)
  await page.getByLabel('Original amount').fill('300.00')
  await page.getByLabel(/APR/).fill('12')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForURL('/debts')
  return debtName
}

test.describe('AI advisor panel', () => {
  test('renders mocked advice from the intercepted advice route', async ({ page }) => {
    await seedDebt(page, Date.now())

    await page.route('**/api/ai/advice', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          advice: 'Mocked second opinion: debtA at 0% APR is fine to hold until 2026-12.',
        }),
      })
    })
    await page.goto('/plan')
    await expect(page.getByText('Mocked second opinion')).toBeVisible()
  })

  test('disclosure shows the sanitized payload with no real names', async ({ page }) => {
    // No interception and no GEMINI_API_KEY in the e2e env: the server computes the
    // real payload and returns advice: null, exercising the actual sanitizer end to end.
    const debtName = await seedDebt(page, Date.now())

    await page.goto('/plan')
    await page.getByText('What gets sent').click()
    const payloadText = await page.getByTestId('ai-payload').textContent()
    expect(payloadText).toContain('debtA')
    expect(payloadText).not.toContain(debtName)
  })

  test('shows the degraded state on a mocked 429', async ({ page }) => {
    await seedDebt(page, Date.now())

    await page.route('**/api/ai/advice', async (route) => {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'rate limited' }),
      })
    })
    await page.goto('/plan')
    await expect(
      page.getByText('AI advisor unavailable, your plan above is complete without it.'),
    ).toBeVisible()
  })
})
