import { neon } from '@neondatabase/serverless'
import { config } from 'dotenv'

config({ path: '.env.local' })

// Prunes the shared e2e user's accumulated data before every run so the fixture
// stops growing unbounded (the cause of the historical full-suite Neon flakes).
// Auth tables (user/session/account/verification) and the global exchange_rates
// row are never touched; settings is safe to delete (getSettings lazily re-inserts).
export default async function globalSetup() {
  if (process.env.SKIP_E2E_PRUNE === '1') {
    console.log('[e2e prune] skipped (SKIP_E2E_PRUNE=1)')
    return
  }
  const email = process.env.E2E_TEST_EMAIL
  const url = process.env.DATABASE_URL
  if (!email || !url) {
    console.warn('[e2e prune] E2E_TEST_EMAIL or DATABASE_URL unset — skipping')
    return
  }
  const sql = neon(url)
  const rows = await sql`select id from "user" where lower(email) = lower(${email})`
  if (rows.length === 0) {
    console.log('[e2e prune] e2e user does not exist yet — nothing to prune')
    return
  }
  const userId = rows[0].id as string
  // FK order: occurrences -> transactions -> account-referencing definitions -> accounts -> the rest.
  await sql`delete from occurrences where user_id = ${userId}`
  await sql`delete from transactions where user_id = ${userId}`
  await sql`delete from income_sources where user_id = ${userId}`
  await sql`delete from bills where user_id = ${userId}`
  await sql`delete from installments where user_id = ${userId}`
  await sql`delete from accounts where user_id = ${userId}`
  await sql`delete from expense_categories where user_id = ${userId}`
  await sql`delete from flexible_debts where user_id = ${userId}`
  await sql`delete from wishlist_items where user_id = ${userId}`
  await sql`delete from ai_advice_cache where user_id = ${userId}`
  await sql`delete from settings where user_id = ${userId}`
  console.log(`[e2e prune] cleared data for e2e user ${userId}`)
}
