import { neon } from '@neondatabase/serverless'
import { expect, test } from '@playwright/test'

const sql = neon(process.env.DATABASE_URL!)

const RATES = JSON.stringify({
  base: 'USD',
  rates: { USD: 1, EUR: 0.9, EGP: 50 },
  fetchedAt: '2026-07-05T03:00:00.000Z',
})

async function testUserId(): Promise<string> {
  const rows = (await sql`select id from "user" where email = ${process.env.E2E_TEST_EMAIL!}`) as { id: string }[]
  expect(rows.length).toBe(1)
  return rows[0].id
}

test.describe('dashboard trends', () => {
  test('shows the empty state with fewer than two snapshots', async ({ page }) => {
    const userId = await testUserId()
    await sql`delete from net_worth_snapshots where user_id = ${userId}`
    // Dashboard load runs housekeeping, creating exactly one snapshot (today's).
    await page.goto('/')
    await expect(page.getByText('Trends appear once two daily snapshots exist')).toBeVisible()
  })

  test('renders both charts after housekeeping ran with seeded history', async ({ page }) => {
    const userId = await testUserId()
    await sql`delete from net_worth_snapshots where user_id = ${userId}`
    for (const [d, combined, debt] of [
      ['2026-07-04', 100000, 60000],
      ['2026-07-05', 105000, 55000],
      ['2026-07-06', 103000, 50000],
    ] as const) {
      await sql`
        insert into net_worth_snapshots
          (user_id, date, per_currency, combined_minor, home_currency, rates, total_debt_minor)
        values
          (${userId}, ${d}, ${JSON.stringify({ EUR: combined })}::jsonb, ${combined}, 'EUR', ${RATES}::jsonb, ${debt})
        on conflict (user_id, date) do nothing
      `
    }
    await page.goto('/') // housekeeping adds today's point on top of the seeded three
    await expect(page.getByRole('heading', { name: /^Net worth \(/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: /^Total debt \(/ })).toBeVisible()
    await expect(page.getByLabel('Trends').locator('svg').first()).toBeVisible()
  })
})

test.describe('cron route', () => {
  test('rejects requests without the CRON_SECRET bearer', async ({ request }) => {
    const res = await request.get('/api/cron/daily')
    expect(res.status()).toBe(401)
  })
})
