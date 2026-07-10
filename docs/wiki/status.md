# Status

**Current state: P5 complete.** Count-based installments are the third and last occurrence kind, riding the same P3/P4 rails: the `installments` table + CRUD (create sets `remaining_count = total_count`; edits rewrite pending occurrences atomically and force `active=false` at 0 remaining), `housekeeping()` now also generates `kind='installment'` occurrences but only while `active` and `remaining_count > 0`, never before `start_date`, and never more future occurrences than payments left. Confirming posts an `installment_payment` (outflow) AND decrements `remaining_count` in the same DB transaction — the payment and the countdown move together or not at all; hitting 0 flips `active=false` and deletes leftover pending occurrences, and un-confirm increments the count back and reactivates. The dashboard attention list shows installments due within 7 days or overdue; installments get their own screens (progress derived as `total − remaining`, next due date) + an "Inst" bottom tab (now 7 tabs). The archived-account write-freeze holds across installment create/edit/confirm (`loadSource` joins `accounts` and rejects `archivedAt`), and `archiveBlockers()` now lists active installments too. Gated green by Vitest (91, DB-backed against the Neon dev branch) and Playwright (full 15-spec suite; the load-sensitive ledger/income flakes pass on re-run/in isolation).

**Plan drift note (P5):** the written plan ([05-installments.md](../superpowers/plans/05-installments.md)) predated the P3/P4 executor-param and archived-guard refactors. Three verbatim blocks would have regressed known invariants and were reconciled against current code: `loadDefinition`/`updateInstallment` keep the 3-arg atomic `rewritePendingOccurrences(..., tx)`; `loadSource` mirrors the bill case's account-join + archived guard; and `archiveBlockers` (omitted entirely from the plan's tasks) gained its active-installments clause.

| Phase | Scope | Status |
|---|---|---|
| P0 | Foundations: scaffold, tooling, Neon+Drizzle, Better Auth (email+password), protected shell | complete |
| P1 | Accounts & currency engine (Money, rates, convert, settings) | complete |
| P2 | Ledger core: transactions, transfers, reconciliation, dashboard v1 | complete |
| P3 | Income sources + confirmation + housekeeping v1 + attention list | complete |
| P4 | Recurring bills | complete |
| P5 | Installments | complete |
| P6 | Expenses & insights | not started |
| P7 | Flexible debts & deterministic planner | not started |
| P8 | Wishlist | not started |
| P9 | AI advisor (Gemini free tier) | not started |
| P10 | Cron & net-worth snapshots/trends | not started |
| P11 | Polish: onboarding, empty states, a11y, final E2E | not started |

Plans: [superpowers/plans/README.md](../superpowers/plans/README.md). Update this page whenever a phase starts or completes.
