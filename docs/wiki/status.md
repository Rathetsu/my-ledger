# Status

**Current state: P4 complete.** Recurring bills ride the P3 occurrence rails: the `bills` table + CRUD, `housekeeping()` now also generates `kind='bill'` occurrences (current + next period, clamped due dates, idempotent), confirming posts a `bill_payment` transaction (never `expense`, so the P7 spend estimate can't double-count — spec §5.4), and definition edits (income + bills) route through the shared `rewritePendingOccurrences(kind, sourceId, executor = db)` rail — income passes its transaction so the source-update + occurrence-rewrite stay atomic. The dashboard attention list shows bills due within 7 days or overdue; bills get their own screens + a Bills bottom tab. The archived-account write-freeze holds across bill create/edit/confirm, and `archiveBlockers()` now lists active bills so an account with an active bill can't be archived. Built on the P3 income & occurrence machinery. Gated green by Vitest (76, DB-backed against the Neon dev branch) and Playwright (full suite; the sole load-sensitive P2 reconcile flake passes in isolation).

| Phase | Scope | Status |
|---|---|---|
| P0 | Foundations: scaffold, tooling, Neon+Drizzle, Better Auth (email+password), protected shell | complete |
| P1 | Accounts & currency engine (Money, rates, convert, settings) | complete |
| P2 | Ledger core: transactions, transfers, reconciliation, dashboard v1 | complete |
| P3 | Income sources + confirmation + housekeeping v1 + attention list | complete |
| P4 | Recurring bills | complete |
| P5 | Installments | not started |
| P6 | Expenses & insights | not started |
| P7 | Flexible debts & deterministic planner | not started |
| P8 | Wishlist | not started |
| P9 | AI advisor (Gemini free tier) | not started |
| P10 | Cron & net-worth snapshots/trends | not started |
| P11 | Polish: onboarding, empty states, a11y, final E2E | not started |

Plans: [superpowers/plans/README.md](../superpowers/plans/README.md). Update this page whenever a phase starts or completes.
