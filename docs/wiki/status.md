# Status

**Current state: P2 complete.** The ledger core is live: posting income/expense, guarded edit/delete, two-leg same- and cross-currency transfers with a derived effective rate, reconciliation adjustments, a filterable history screen, and dashboard v1 (net-worth headline, per-currency breakdown, recent activity). Built on P1's accounts & currency engine. Gated green by Vitest (43) and Playwright (full suite).

| Phase | Scope | Status |
|---|---|---|
| P0 | Foundations: scaffold, tooling, Neon+Drizzle, Better Auth (email+password), protected shell | complete |
| P1 | Accounts & currency engine (Money, rates, convert, settings) | complete |
| P2 | Ledger core: transactions, transfers, reconciliation, dashboard v1 | complete |
| P3 | Income sources + confirmation + housekeeping v1 + attention list | not started |
| P4 | Recurring bills | not started |
| P5 | Installments | not started |
| P6 | Expenses & insights | not started |
| P7 | Flexible debts & deterministic planner | not started |
| P8 | Wishlist | not started |
| P9 | AI advisor (Gemini free tier) | not started |
| P10 | Cron & net-worth snapshots/trends | not started |
| P11 | Polish: onboarding, empty states, a11y, final E2E | not started |

Plans: [superpowers/plans/README.md](../superpowers/plans/README.md). Update this page whenever a phase starts or completes.
