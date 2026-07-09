# Status

**Current state: P3 complete.** Income sources generate confirmable occurrences: the shared `occurrences` table + idempotent `housekeeping()` (generation + overdue flip), the shared confirm/skip/un-confirm module (the rail P4/P5 reuse), income source CRUD + windfall, and the dashboard attention list with a pre-filled confirm sheet. Confirming posts the actual figures; the P2 archived-account write-freeze is now enforced across the income flow too. Built on the P2 ledger core. Gated green by Vitest (60, incl. DB-backed against the Neon dev branch) and Playwright (full suite).

| Phase | Scope | Status |
|---|---|---|
| P0 | Foundations: scaffold, tooling, Neon+Drizzle, Better Auth (email+password), protected shell | complete |
| P1 | Accounts & currency engine (Money, rates, convert, settings) | complete |
| P2 | Ledger core: transactions, transfers, reconciliation, dashboard v1 | complete |
| P3 | Income sources + confirmation + housekeeping v1 + attention list | complete |
| P4 | Recurring bills | not started |
| P5 | Installments | not started |
| P6 | Expenses & insights | not started |
| P7 | Flexible debts & deterministic planner | not started |
| P8 | Wishlist | not started |
| P9 | AI advisor (Gemini free tier) | not started |
| P10 | Cron & net-worth snapshots/trends | not started |
| P11 | Polish: onboarding, empty states, a11y, final E2E | not started |

Plans: [superpowers/plans/README.md](../superpowers/plans/README.md). Update this page whenever a phase starts or completes.
