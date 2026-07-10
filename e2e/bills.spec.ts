import { expect, test } from '@playwright/test'
import { createAccount } from './helpers'

test('rent bill: confirm posts a bill_payment (not an expense), balance drops', async ({
  page,
}) => {
  const stamp = Date.now()
  const accountName = `Rent EGP ${stamp}`
  const billName = `Rent ${stamp}`

  // Account with an opening balance to pay the bill from.
  await createAccount(page, accountName, 'EGP', '20000.00')

  // Bill due on the 1st: on any calendar day it's today-or-past, so it lands in the attention window.
  await page.goto('/bills/new')
  await page.getByLabel('Name').fill(billName)
  await page.getByLabel('Amount').fill('15000.00')
  await page
    .getByLabel('Account')
    .selectOption({ label: `${accountName} (EGP)` })
  await page.getByLabel('Due day').fill('1')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.waitForURL('/bills')

  // Dashboard load runs housekeeping and generates the occurrence(s).
  await page.goto('/')
  // Bills are ALWAYS recurring -> housekeeping seeds current + next period. Near month-end BOTH can
  // fall inside the 7-day window, so there may be 1 OR 2 rows for this bill. Scope to this bill's
  // unique name, confirm the earliest (this-period, sorted first), and assert the count drops by one.
  const rows = page.getByRole('button', { name: new RegExp(billName) })
  const before = await rows.count()
  expect(before).toBeGreaterThan(0)
  await expect(rows.first()).toContainText('confirm paid')
  await rows.first().click()

  // Sheet pre-filled with the expected amount; confirm as-is (actual == expected).
  const amount = page.getByLabel(/^Amount/)
  await expect(amount).toHaveValue('15000.00')
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()

  // The confirmed (earliest) occurrence leaves the attention list.
  await expect(rows).toHaveCount(before - 1, { timeout: 15_000 })

  // Balance reflects the payment: 20,000.00 - 15,000.00 = 5,000.00.
  await page.goto('/accounts')
  await expect(
    page.getByRole('link', { name: new RegExp(accountName) }),
  ).toContainText('5,000.00', {
    timeout: 15_000,
  })

  // History shows a bill payment, NOT an expense (spec §5.4: the P7 spend estimate must not double-count).
  // NOTE: the transactions screen renders the RAW enum, so the type text is `bill_payment` (underscore),
  // not "bill payment". Filter the ledger to this run's fresh account (only its opening + this one
  // bill_payment) so the assertion never depends on the row surviving the unfiltered .limit(100).
  await page.goto('/transactions')
  await page.getByLabel('Account').selectOption({ label: accountName })
  await page.getByRole('button', { name: 'Filter' }).click()
  const historyRow = page.locator('li', { hasText: billName })
  await expect(historyRow).toContainText('bill_payment')
  await expect(historyRow).not.toContainText('expense')
})
