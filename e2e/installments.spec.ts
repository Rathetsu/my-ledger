import { expect, test } from '@playwright/test'
import { and, eq } from 'drizzle-orm'
import { db } from '../lib/db/client'
import { installments, occurrences } from '../lib/db/schema'
import { createAccount } from './helpers'

test('installment: confirm one payment, progress 1 of 12, overdue styling appears', async ({
  page,
}) => {
  const stamp = Date.now()
  const accountName = `Card USD ${stamp}`
  const instName = `Phone ${stamp}`

  // Account with an opening balance to pay from.
  await createAccount(page, accountName, 'USD', '1000.00')

  // 12-month installment due on the 1st (today-or-past on any calendar day, so it's actionable),
  // starting the 1st of this month so the current period generates.
  const startDate = `${new Date().toISOString().slice(0, 8)}01`
  await page.goto('/installments/new')
  await page.getByLabel('Name').fill(instName)
  await page.getByLabel('Monthly amount').fill('50.00')
  await page.getByLabel('Account').selectOption({ label: `${accountName} (USD)` })
  await page.getByLabel('Due day').fill('1')
  await page.getByLabel('Total payments').fill('12')
  await page.getByLabel('Start date').fill(startDate)
  await page.getByRole('button', { name: 'Create' }).click()
  await page.waitForURL('/installments')
  // The list shows every installment the user owns (unscoped) and accumulates across runs,
  // so scope every list assertion to THIS run's uniquely-stamped row.
  const listRow = page.getByRole('link', { name: new RegExp(instName) })
  await expect(listRow).toContainText('Paid 0 of 12')

  // Dashboard load runs housekeeping and generates the occurrence(s). Like bills, installments
  // seed current + next period, so near month-end BOTH can fall in the 7-day window: scope to
  // this installment's unique name, confirm the earliest, and assert the count drops by one.
  await page.goto('/')
  const rows = page.getByRole('button', { name: new RegExp(instName) })
  const before = await rows.count()
  expect(before).toBeGreaterThan(0)
  await expect(rows.first()).toContainText('confirm paid')
  await rows.first().click()

  const amount = page.getByLabel(/^Amount/)
  await expect(amount).toHaveValue('50.00')
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(rows).toHaveCount(before - 1, { timeout: 15_000 })

  // Progress derived from the countdown: total - remaining = 1.
  await page.goto('/installments')
  await expect(
    page.getByRole('link', { name: new RegExp(instName) }),
  ).toContainText('Paid 1 of 12')

  // Force the remaining pending occurrence past due, then let housekeeping flip it to overdue.
  const [inst] = await db
    .select()
    .from(installments)
    .where(eq(installments.name, instName))
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  await db
    .update(occurrences)
    .set({ dueDate: yesterday })
    .where(
      and(
        eq(occurrences.kind, 'installment'),
        eq(occurrences.sourceId, inst.id),
        eq(occurrences.status, 'pending'),
      ),
    )

  await page.goto('/') // dashboard load runs housekeeping: pending past due -> overdue
  const overdueRow = page.getByRole('button', { name: new RegExp(instName) })
  await expect(overdueRow).toBeVisible()
  await expect(overdueRow).toContainText('Overdue')
  await expect(overdueRow.locator('.text-red-600')).toBeVisible() // overdue styling
})
