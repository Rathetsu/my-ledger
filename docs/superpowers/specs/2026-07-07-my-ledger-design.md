# My Ledger - Design Spec

Single source of truth for requirements. Terms: [/CONTEXT.md](../../../CONTEXT.md). Rationale + rejected alternatives: [ADRs](../../adr/). How we got here: [stream](../../stream/2026-07-07-grilling-decisions.md). Implementation: [plans master index](../plans/README.md).

## 1. Product

**My Ledger** - a mobile-first personal money ledger + dashboard for a single user (multi-device via email/password sign-in). It tracks money across per-currency accounts (EUR/USD/EGP), confirms expected income, reminds about and confirms bills and installments, tracks flexible debts and everyday expenses, keeps a wishlist, computes a deterministic payoff plan with an AI second opinion, and shows honest net-worth history.

## 2. Stack and platform requirements

- Next.js App Router + TypeScript + Tailwind CSS; **mobile-first** (bottom tab nav, large tap targets); responsive up to desktop.
- Neon Postgres + Drizzle; migrations via drizzle-kit, run in the Vercel build command.
- Self-hosted **Better Auth** (`better-auth`): **email+password only**, one auth config for dev/E2E/prod; auth tables in our Neon DB via Drizzle; open sign-up gated by `ALLOW_SIGNUP` ([ADR](../../adr/2026-07-09-better-auth-email-password.md)).
- Server actions (zod-validated) for all mutations; `revalidatePath` after writes.
- Vitest for pure logic; Playwright for E2E (email+password sign-up/sign-in against the app's own Better Auth).
- Vercel deploy; daily cron via `vercel.json` (`CRON_SECRET`-guarded route).
- Every table carries `user_id` (single user today; future-proof isolation).

## 3. Hard conventions (apply to every feature)

| Rule | Detail |
|---|---|
| Money | Integer minor units + currency code; never floats. Supported currencies: `EUR, USD, EGP` (extensible constant). [ADR](../../adr/2026-07-07-integer-minor-units-derived-balances.md) |
| Balances | Always derived by summing transactions. Never stored. May go negative. |
| Conversion | Live cached rates only, at display/planning time. Convert each per-currency total once, round half-up, then sum. |
| Single-currency txns | No transaction converts currency. [ADR](../../adr/2026-07-07-per-currency-accounts-two-leg-transfers.md) |
| Dates | All day boundaries in `Africa/Cairo` (only `lib/dates/cairo.ts` touches timezones). Due dates clamp: `min(due_day, last_day_of_month)`. |
| Mutability | Source-linked transactions (`source_type` set) mutate only through their owning flow (un-confirm reverses side effects atomically). Transfer legs mutate as a group. Plain rows edit/delete freely. |
| Idempotency | Occurrence generation: `UNIQUE(user_id, kind, source_id, period)` + `ON CONFLICT DO NOTHING`. Confirms: `UPDATE … WHERE status IN ('pending','overdue')` inside a DB transaction (settled occurrences never re-confirm). Snapshots: `UNIQUE(user_id, date)` upsert. |
| Definition edits | Rewrite `pending` occurrences only; never touch `confirmed`/`skipped`. |
| Accounts | Archive (`archived_at`), never delete; archiving blocked while any active definition targets the account. |
| Engine owns numbers | Every displayed figure comes from deterministic code. The AI quotes; it never computes. |

## 4. Data model

```
accounts(id, user_id, name, currency, archived_at?, created_at)
transactions(id, user_id, account_id, type, amount_minor, currency, category_id?,
             occurred_on, note, one_off bool, source_type?, source_id?,
             transfer_group_id?, created_at)
  type ∈ {opening, income, expense, bill_payment, installment_payment,
          debt_payment, purchase, transfer_in, transfer_out, adjustment}
exchange_rates(base, rates jsonb, fetched_at)          -- seeded row in initial migration
income_sources(id, user_id, name, amount_minor, currency, day_of_month,
               account_id, recurring, active)
bills(id, user_id, name, amount_minor, currency, due_day, account_id,
      category_id?, active)
installments(id, user_id, name, monthly_amount_minor, currency, due_day,
             total_count, remaining_count, start_date, account_id, apr?, active)
occurrences(id, user_id, kind ∈ {income, bill, installment}, source_id, period,
            due_date, expected_amount_minor,
            status ∈ {pending, confirmed, skipped, overdue}, transaction_id?)
  UNIQUE(user_id, kind, source_id, period)
flexible_debts(id, user_id, name, original_minor, currency, apr, deadline?,
               min_payment_minor?, created_at)          -- balance derived
expense_categories(id, user_id, name, icon?)
wishlist_items(id, user_id, name, cost_minor, currency, priority, target_date?,
               status ∈ {planned, purchased}, transaction_id?)
net_worth_snapshots(id, user_id, date, per_currency jsonb, combined_minor,
                    home_currency, rates jsonb, total_debt_minor)
  UNIQUE(user_id, date)
settings(user_id, home_currency, essentials_baseline jsonb, ai_enabled bool)
ai_advice_cache(user_id, payload_hash, advice, created_at)   -- one row per user, upserted
```

## 5. Features

### 5.1 Accounts & currency
Create/edit/archive accounts (name + currency); opening balance posts an `opening` transaction. Balance = sum of transactions. Settings row lazily upserted on first authenticated request (defaults: `home_currency = EUR`, `ai_enabled = true`). Home currency switchable (EGP/EUR/USD) anytime; per-item amounts always display natively. Rates fetched from `open.er-api.com`, cached, seeded, last-good fallback; aggregates show staleness when rates are old.

### 5.2 Transactions & transfers
Log income/expense (with category, `one_off` tag, note, date). Same-currency transfers: one amount, two legs. Cross-currency: enter actual sent + actual received (live rate pre-fills the received suggestion); effective rate shown afterwards. Reconciliation: "set actual balance" posts an `adjustment` for the difference. History screen with filters (account, type, category, date range).

### 5.3 Income
Recurring income sources (salary: amount, currency, day-of-month, target account). Occurrences generated by housekeeping; confirm sheet pre-fills expected amount/date, both editable; outcomes: confirm (posts `income` txn with actuals), skip, not-yet (→ overdue past due date). Windfalls: plain `income` transactions, never projected by the plan.

### 5.4 Bills
Recurring bills (name, amount, currency, due day, source account, optional category). Same occurrence + confirm flow; confirming posts **`bill_payment`** (never `expense` - the spend estimate must not double-count).

### 5.5 Installments
Count-based (`total_count`, `remaining_count`); monthly occurrence on due day; confirming posts `installment_payment` and decrements `remaining_count`; completes at 0. Prepay/skip/policy changes: user edits the definition (pending occurrences rewrite). Overdue occurrences surface in the attention list; schedule never slides silently.

### 5.6 Expenses & insights
Expense logging with per-user categories and `one_off` tag. Insights: spend by category/month, shown **natively per currency** (no converted mixing in time-series); combined views only for the live-rate headline.

### 5.7 Flexible debts
Name, original amount, currency, APR (0 allowed), optional **deadline**, optional minimum payment. Balance derived from payments. Payment flow: pick same-currency account, amount; posts `debt_payment`.

### 5.8 Wishlist
Items (name, cost, currency, priority, optional target date). Purchase flow: same-currency account selector, advisory shortfall warning, posts `purchase` and marks item `purchased`.

### 5.9 Planner (deterministic engine)
See [ADR](../../adr/2026-07-07-debt-first-deadline-aware-planner.md). Inputs: guaranteed income, bills, installment obligations, variable spend estimate (baseline → 3-month blend excluding `one_off`), flexible debts (APR, deadline), wishlist, live rates, home currency. Output per month over the horizon: allocations, per-debt payoff month, per-wishlist affordable month, per-currency funding gaps with transfer suggestions. Simple monthly interest (`apr/12`) in projections; flags high-APR installments. Recomputed on every input change; pure and unit-tested.

### 5.10 AI advisor
See [ADR](../../adr/2026-07-07-ai-advisor-contract.md). Sanitized anonymized payload → `gemini-3-flash-preview` (via `GEMINI_MODEL` env) → free-text second opinion beside the algorithm's plan; cached by bucketed-payload hash; "what gets sent" disclosure; app fully functional without it.

### 5.11 Dashboard & attention list
Net worth headline in home currency (live rates, staleness label) + per-currency breakdown; attention list (income to confirm, bills/installments due within 7 days or overdue); recent activity; net-worth and debt trend charts from snapshots (re-derived from `per_currency` + stored `rates` in the current home currency).

### 5.12 Housekeeping & cron
`housekeeping(userId, today)`: generate occurrences for current + next period, flip pending→overdue, upsert today's snapshot, refresh rates older than 24h. Idempotent. Called on dashboard load and by `/api/cron/daily` (vercel.json cron, `CRON_SECRET` Bearer check; Hobby: once daily ±59 min).

### 5.13 First run
After first sign-in: guided empty states - create accounts (with opening balances), add income source, then progressively bills/installments/debts/wishlist. No blocking wizard; the dashboard shows what's missing and links to each setup.

## 6. Out of scope (v1)

Push/email notifications; multi-user sharing; budgets/envelopes; receipt scanning; bank sync; historical FX backfill; AI structured actions ("adopt" buttons); interest-accrual postings; currency support beyond EUR/USD/EGP (constant is extensible).

## 7. Verification

Unit (Vitest): Money format/parse/round-half-up; convert cross-rates; Cairo day boundaries + due-day clamping (Feb, 30-day months); occurrence generation idempotency; planner (surplus blend, deadline just-in-time, avalanche order, funding gaps, windfall acceleration); sanitizer anonymization; cache-key bucketing. E2E (Playwright, email+password): sign-in gate; account + opening balance; expense + transfer (both kinds); income confirm with edited amount; bill + installment confirm and overdue; debt + plan screen; wishlist purchase; AI panel disclosure + graceful degradation (mocked); cron route auth. Manual: mobile viewport walkthrough per phase; final full-scenario walkthrough.
