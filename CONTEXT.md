# My Ledger - Domain Context

Single-context repo. Auth is self-hosted Better Auth, email+password only (see [ADR 2026-07-09](docs/adr/2026-07-09-better-auth-email-password.md)). This glossary is the ubiquitous language: issues, tests, code, and docs use these terms exactly. Architecture lives in [docs/wiki/architecture.md](docs/wiki/architecture.md); rationale lives in [docs/adr/](docs/adr/); full requirements in [the spec](docs/superpowers/specs/2026-07-07-my-ledger-design.md).

## Glossary

- **Account** - a named wallet holding money in exactly one **currency** (EUR, USD, EGP). Multiple accounts per currency are allowed; the UX assumes few. Accounts are archived, never deleted.
- **Transaction** - a single-currency money movement inside one account. The only thing that changes a balance. Types: `opening`, `income`, `expense`, `bill_payment`, `installment_payment`, `debt_payment`, `purchase`, `transfer_in`, `transfer_out`, `adjustment`.
- **Balance** - always derived by summing an account's transactions. Never stored, never accrues interest. May go negative (honesty over enforcement).
- **Transfer** - two linked transactions (`transfer_out` + `transfer_in`) sharing a **transfer group**. Cross-currency transfers have both legs entered explicitly; the implied **effective rate** is derived, not applied.
- **Reconciliation** - "set actual balance" on an account; posts an `adjustment` transaction closing the gap between ledger and reality.
- **Income Source** - a recurring expected income (salary: amount, day-of-month, target account). Generates occurrences needing confirmation.
- **Windfall** - one-off income (freelance) logged directly as an `income` transaction with no source. Never counted on by the plan in advance.
- **Expense Category** - a user-defined label (name + optional icon) for tagging `expense` transactions; optional. Deleting a category leaves its expenses uncategorized — it never deletes the expense. Not used by bills, installments, or income.
- **One-off** - an `expense` tagged `one_off`: a rare, non-recurring outlay excluded from the Variable Spend Estimate. (Distinct from a Windfall, which is one-off *income*.)
- **Bill** - a recurring committed outflow with no end (rent, internet). Generates occurrences; confirming posts a `bill_payment` (never `expense`).
- **Installment** - a fixed monthly debt payment with a countdown (`remaining_count`). Count-based: confirming decrements; irregular events are handled by editing the definition. Fixed obligation - never avalanched.
- **Occurrence** - one period's instance of an income source, bill, or installment. Status: `pending → confirmed | skipped | overdue`. Unique per (kind, source, period). Confirming opens an editable pre-filled sheet and posts the actual figures.
- **Flexible Debt** - money owed with no fixed schedule. Optional **deadline**: none = pay ASAP (avalanche by APR); set = pay just-enough to finish by the deadline, releasing **deadline slack** to the wishlist.
- **Wishlist Item** - something to buy (phone, chair), with cost, currency, priority, optional target date. Funded only by deadline slack and post-debt surplus (strict debt-first).
- **Home Currency** - the single currency for aggregate/headline numbers; switchable (EGP/EUR/USD). Per-item amounts always display natively.
- **Live Rate** - today's cached FX rate from open.er-api.com. Used only for aggregates, transfer pre-fill suggestions, and planner comparisons. Never stored on transactions.
- **Snapshot** - a once-daily record of per-currency totals + that day's rates + combined net worth + total debt. Trend charts read snapshots so history never rewrites.
- **Housekeeping** - the single idempotent routine (generate occurrences, flip overdue, upsert today's snapshot, refresh stale rates) run lazily on dashboard load and by the daily cron.
- **Essentials Baseline** - user-set estimate of *variable* monthly spend (groceries, transport). Bills and installments are not part of it.
- **Variable Spend Estimate** - what the planner subtracts for variable spend: the baseline at first, blending to trailing 3-month `expense` actuals (excluding `one_off`-tagged rows) once ≥3 months exist.
- **Surplus** - guaranteed income − bills − installment obligations − variable spend estimate, in home currency at live rates.
- **Funding Gap** - a month's obligations in a currency exceeding projected balances in that currency; surfaced as an advisory transfer suggestion.
- **Plan** - the deterministic engine's month-by-month projection: debt payoff months, wishlist affordability months, funding gaps. The engine owns 100% of all numbers.
- **AI Advisor** - a free-text second opinion over the engine's numbers ("Algorithm suggests X; AI thinks Y"). Quotes engine figures, never computes new ones. Receives only an anonymized payload. App fully works without it.
- **Attention List** - the dashboard section of things needing action: income to confirm, bills/installments due or overdue.
- **Insights** - the `/expenses/insights` view: per-currency spend-by-category and month-over-month trend charts over `expense` **actuals** (includes `one_off` rows and the current partial month, unlike the Variable Spend Estimate feed). Currencies are never mixed in one chart.

## Domain rules (invariants)

1. No transaction ever converts currency.
2. Every number shown as truth comes from the deterministic engine, never the AI.
3. Confirmations post actuals (editable sheet), and the plan recalculates from actuals.
4. Source-linked transactions are only mutable through their owning flow; transfer legs mutate as a group.
5. All day-boundary logic uses `Africa/Cairo`; due dates clamp to `min(due_day, last_day_of_month)`.
