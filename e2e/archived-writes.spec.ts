import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { db } from '../lib/db/client'
import { bills, transactions } from '../lib/db/schema'
import { createAccount } from './helpers'

// Archiving is blocked only by ACTIVE definitions, so an account holding only
// plain transactions (or a deactivated definition) is archivable — after which
// every remaining write path must still refuse (hard invariant #3, spec §3).

test('archived account: editing and deleting a plain transaction are refused', async ({
  page,
}) => {
  const stamp = Date.now()
  const accountName = `Frozen USD ${stamp}`
  const note = `Coffee ${stamp}`
  await createAccount(page, accountName, 'USD', '1000.00')

  // Post a plain expense.
  await page.goto('/transactions/new')
  await page
    .getByLabel('Account')
    .selectOption({ label: `${accountName} (USD)` })
  await page.getByLabel('Type').selectOption('expense')
  await page.getByLabel('Amount').fill('10.00')
  await page.getByLabel('Note').fill(note)
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForURL(/\/transactions$/)

  // Archive the account (no active definitions target it).
  await page.goto('/accounts')
  await page.getByRole('link', { name: new RegExp(accountName) }).click()
  await page.getByRole('button', { name: 'Archive account' }).click()
  await page.waitForURL('/accounts')

  // Deterministic id via DB (avoids the unscoped /transactions list accumulating across runs).
  const [txn] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.note, note))

  // Edit is refused.
  await page.goto(`/transactions/${txn.id}`)
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Account is archived')).toBeVisible()

  // Delete is refused (reload first to clear the update-form error state).
  await page.goto(`/transactions/${txn.id}`)
  await page.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('Account is archived')).toBeVisible()
})

test('archived account: reactivating a bill onto it is refused', async ({
  page,
}) => {
  const stamp = Date.now()
  const accountName = `Frozen EGP ${stamp}`
  const billName = `Rent ${stamp}`
  await createAccount(page, accountName, 'EGP', '5000.00')

  // Create a bill on the account.
  await page.goto('/bills/new')
  await page.getByLabel('Name').fill(billName)
  await page.getByLabel('Amount').fill('1500.00')
  await page
    .getByLabel('Account')
    .selectOption({ label: `${accountName} (EGP)` })
  await page.getByLabel('Due day').fill('1')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.waitForURL('/bills')

  const [bill] = await db.select().from(bills).where(eq(bills.name, billName))

  // Deactivate the bill so archiveBlockers no longer lists it, then archive the account.
  await page.goto(`/bills/${bill.id}/edit`)
  await page.getByRole('button', { name: 'Deactivate' }).click()
  await page.waitForURL('/bills')
  await page.goto('/accounts')
  await page.getByRole('link', { name: new RegExp(accountName) }).click()
  await page.getByRole('button', { name: 'Archive account' }).click()
  await page.waitForURL('/accounts')

  // Reactivating onto the now-archived account must be refused.
  await page.goto(`/bills/${bill.id}/edit`)
  await page.getByRole('button', { name: 'Reactivate' }).click()
  await expect(page.getByText('Account is archived')).toBeVisible()
})
