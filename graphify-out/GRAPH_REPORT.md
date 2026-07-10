# Graph Report - my-ledger  (2026-07-10)

## Corpus Check
- 148 files · ~103,795 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 628 nodes · 752 edges · 76 communities (61 shown, 15 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `3c13b6a8`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 79|Community 79]]

## God Nodes (most connected - your core abstractions)
1. `Phase 07: Debts and Planner Implementation Plan` - 16 edges
2. `compilerOptions` - 16 edges
3. `5. Features` - 14 edges
4. `scripts` - 12 edges
5. `Phase 01: Accounts and Currency Implementation Plan` - 12 edges
6. `ownedActiveAccount()` - 11 edges
7. `parseAmount()` - 11 edges
8. `Phase 00: Foundations Implementation Plan` - 11 edges
9. `Phase 02: Transactions and Balances Implementation Plan` - 11 edges
10. `Phase 09: AI Advisor Implementation Plan` - 10 edges

## Surprising Connections (you probably didn't know these)
- `SignInPage()` --calls--> `redirectIfAuthenticated()`  [EXTRACTED]
  app/sign-in/page.tsx → lib/auth.ts
- `SignUpPage()` --calls--> `redirectIfAuthenticated()`  [EXTRACTED]
  app/sign-up/page.tsx → lib/auth.ts
- `SettingsPage()` --calls--> `getSettings()`  [EXTRACTED]
  app/(app)/settings/page.tsx → lib/db/queries.ts
- `HomePage()` --calls--> `getAttentionItems()`  [EXTRACTED]
  app/(app)/page.tsx → lib/occurrences/attention.ts
- `seedScenario()` --calls--> `seedBill()`  [INFERRED]
  lib/occurrences/attention.test.ts → lib/housekeeping/index.test.ts

## Import Cycles
- None detected.

## Communities (76 total, 15 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.09
Nodes (20): Domain rules (invariants), Glossary, My Ledger - Domain Context, ADR: Live rates for aggregates; daily snapshots for history; one idempotent housekeeping routine, Decision, Rejected, Why, Conventions (+12 more)

### Community 1 - "Community 1"
Cohesion: 0.10
Nodes (21): 1. Product, 2. Stack and platform requirements, 3. Hard conventions (apply to every feature), 4. Data model, 5.10 AI advisor, 5.11 Dashboard & attention list, 5.12 Housekeeping & cron, 5.13 First run (+13 more)

### Community 2 - "Community 2"
Cohesion: 0.12
Nodes (16): Phase 07: Debts and Planner Implementation Plan, Task 10: engine core - surplus, avalanche, minimums, payoff reporting, Task 11: engine - deadline just-in-time payments and deadline slack, Task 12: engine - currency-aware funding gaps, flags, passthroughs, Task 13: plan input assembler, Task 14: plan screen, Task 15: Playwright flow, Task 1: flexible_debts table and migration (+8 more)

### Community 3 - "Community 3"
Cohesion: 0.15
Nodes (12): Global Constraints, Phase 01: Accounts and Currency Implementation Plan, Phase done, Task 1: Schema and migration (accounts, transactions, exchange_rates, settings) with seeded rates, Task 2: Money primitives (lib/money/money.ts), Task 3: Cairo dates (lib/dates/cairo.ts), Task 4: convert() via USD cross-rates (lib/currency/convert.ts), Task 5: getRates() cache-first with last-good fallback (lib/currency/rates.ts) (+4 more)

### Community 5 - "Community 5"
Cohesion: 0.18
Nodes (11): Global Constraints, Phase 02: Transactions and Balances Implementation Plan, Task 1: Mutability guard (pure), Task 2: Post income and expense, Task 3: Edit and delete plain rows (guarded), Task 4: Transfers (same-currency and cross-currency), Task 5: Transfer group page: effective rate, edit and delete as a unit, Task 6: Reconciliation (set actual balance) (+3 more)

### Community 6 - "Community 6"
Cohesion: 0.18
Nodes (11): Global Constraints (from the plans README, verbatim), Interfaces consumed from P3 (do not copy, extend in place), Phase 04: Bills Implementation Plan, Task 1: bills table and migration, Task 2: housekeeping generates bill occurrences, Task 3: rewritePendingOccurrences, the shared definition-edit rail, Task 4: Bill CRUD server actions, Task 5: Confirm module posts bill_payment (never expense) (+3 more)

### Community 7 - "Community 7"
Cohesion: 0.20
Nodes (10): Building, Debugging, Decisions and docs, Finishing, Issue tracker, Meta, my-ledger, Skill routing (+2 more)

### Community 8 - "Community 8"
Cohesion: 0.20
Nodes (10): Conventions consumed from P0-P2 (do not re-implement), Global Constraints (from the plans README, verbatim), Phase 03: Income Implementation Plan, Task 1: Schema and migration for income_sources and the shared occurrences table, Task 2: housekeeping v1 (generate income occurrences, flip overdue), Task 3: Shared confirm module (confirm / skip / un-confirm), Task 4: Income source CRUD, windfall, and occurrence server actions, Task 5: Income screens (list, form, windfall quick action) (+2 more)

### Community 9 - "Community 9"
Cohesion: 0.20
Nodes (10): Global Constraints (from the plans README, verbatim), Interfaces consumed from P3/P4 (do not copy, extend in place), Phase 05: Installments Implementation Plan, Task 1: installments table and migration, Task 2: housekeeping generates installment occurrences while remaining_count > 0, Task 3: Confirm decrements remaining_count atomically; un-confirm increments it back, Task 4: Installment CRUD server actions, Task 5: Attention list shows installments due within 7 days or overdue (+2 more)

### Community 10 - "Community 10"
Cohesion: 0.20
Nodes (10): Phase 09: AI Advisor Implementation Plan, Task 1: `ai_advice_cache` table and migration, Task 2: `sanitizePlanPayload` with anonymization tests, Task 3: bucketed cache key (`bucketMinor` + `cacheKey`), Task 4: the prompt pack (`lib/ai/prompt.ts`), Task 5: `getAdvice` (`lib/ai/advisor.ts`), Task 6: `POST /api/ai/advice` route, Task 7: AI panel on the plan screen + settings toggle (+2 more)

### Community 11 - "Community 11"
Cohesion: 0.20
Nodes (10): Phase 11: Polish Implementation Plan, Task 1: shared `EmptyState` component, Task 2: first-run setup checklist on the dashboard, Task 3: empty states on every list screen, Task 4: route-group error and loading states, Task 5: form-level error pattern for failed server actions, Task 6: accessibility pass, Task 7: responsive audit (bottom tabs mobile, sidebar from md) (+2 more)

### Community 12 - "Community 12"
Cohesion: 0.22
Nodes (9): Phase 06: Expenses and Insights Implementation Plan, Task 1: expense_categories table and migration, Task 2: addPeriods date helper, Task 3: category CRUD actions and categories screen, Task 4: category picker and one_off toggle in the P2 expense form, Task 5: expenses list by month with category filter, Task 6: variableSpendActuals query helper (Produces for P7), Task 7: chart palette tokens and pure chart-data pivots (+1 more)

### Community 13 - "Community 13"
Cohesion: 0.22
Nodes (9): Phase 08: Wishlist Implementation Plan, Task 1: wishlist_items table and migration, Task 2: wishlist CRUD actions, Task 3: plan-input mapper (purchased items excluded), Task 4: engine extension - wishlist funding from unallocated leftover, Task 5: engine extension - affordability transfer suggestion for gapped currencies, Task 6: purchase and un-purchase flow, Task 7: wishlist screen with affordability badges (+1 more)

### Community 14 - "Community 14"
Cohesion: 0.18
Nodes (12): convert(), roundHalfUp(), rates, getRates(), Rates, mockDb, CURRENCIES, Currency (+4 more)

### Community 15 - "Community 15"
Cohesion: 0.07
Nodes (23): SettingsPage(), AccountSettingsForm(), HomeCurrencyForm(), TransactionEditForm(), AccountOption, TransactionForm(), ActionState, archiveAccount() (+15 more)

### Community 16 - "Community 16"
Cohesion: 0.40
Nodes (4): ADR: Integer minor units; balances derived, never stored; round-half-up conversion, Decision, Rejected, Why

### Community 17 - "Community 17"
Cohesion: 0.40
Nodes (3): AccountOption, IncomeSourceForm(), SourceValues

### Community 18 - "Community 18"
Cohesion: 0.40
Nodes (4): ADR: Per-currency accounts; transactions never convert; transfers carry two explicit legs, Decision, Rejected, Why

### Community 19 - "Community 19"
Cohesion: 0.25
Nodes (7): account, accountRelations, session, sessionRelations, user, userRelations, verification

### Community 21 - "Community 21"
Cohesion: 0.40
Nodes (4): ADR: AI advisor contract - free-text second opinion, anonymized payload, Gemini free tier, Decision, Rejected, Why

### Community 22 - "Community 22"
Cohesion: 0.40
Nodes (4): ADR: Deterministic debt-first planner with deadline slack; currency-aware funding gaps, Decision, Rejected, Why

### Community 23 - "Community 23"
Cohesion: 0.29
Nodes (5): ADR: Next.js + Neon Postgres + Drizzle + Stack Auth (Google-only prod, email+password test project), Decision, Rejected, Why, 2026-07-09 - Auth pivot: Stack Auth to self-hosted Better Auth (email+password)

### Community 26 - "Community 26"
Cohesion: 0.25
Nodes (7): Categorization, docs, engineering, Library index, meta, planning, quality

### Community 27 - "Community 27"
Cohesion: 0.33
Nodes (5): Before exploring, read these, Domain Docs, File structure, Flag ADR conflicts, Use the glossary's vocabulary

### Community 28 - "Community 28"
Cohesion: 0.33
Nodes (5): Conventions, Issue tracker: GitHub, Pull requests as a triage surface, When a skill says "fetch the relevant ticket", When a skill says "publish to the issue tracker"

### Community 31 - "Community 31"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 32 - "Community 32"
Cohesion: 0.40
Nodes (3): geistMono, geistSans, metadata

### Community 37 - "Community 37"
Cohesion: 0.18
Nodes (11): Auth: self-hosted Better Auth, email + password (read this before Task 5), Global Constraints, Phase 00: Foundations Implementation Plan, Phase done, Task 1: Scaffold Next.js into the existing repo, Task 2: Prettier, Task 3: Vitest, Task 4: Drizzle wired to Neon (empty schema baseline) (+3 more)

### Community 41 - "Community 41"
Cohesion: 0.22
Nodes (7): { GET, POST }, SignInPage(), SignUpPage(), SignInForm(), SignUpForm(), auth, redirectIfAuthenticated()

### Community 49 - "Community 49"
Cohesion: 0.25
Nodes (8): Phase 10: Cron and Snapshots Implementation Plan, Task 1: `net_worth_snapshots` table and migration, Task 2: pure snapshot math (`computeSnapshotRow`, `rederiveNetWorthMinor`, `rederiveDebtMinor`), Task 3: housekeeping upserts today's snapshot (idempotent), Task 4: cron route and `vercel.json`, Task 5: dashboard trend charts (read from snapshots), Task 6: E2E (trends render from seeded snapshots, cron auth), Task 7: phase gate

### Community 56 - "Community 56"
Cohesion: 0.15
Nodes (9): clearUnsettledInstallmentOccurrences(), DbTx, Executor, housekeeping(), loadDefinition(), NewOccurrence, nextPeriod(), retractSurplusPendingOccurrences() (+1 more)

### Community 57 - "Community 57"
Cohesion: 0.06
Nodes (42): createBill(), revalidateBillScreens(), setBillActive(), updateBill(), ActionResult, NotFoundError, ownedActiveAccount(), parseAmount() (+34 more)

### Community 58 - "Community 58"
Cohesion: 0.18
Nodes (10): AccountOption, TransferForm(), TransferGroupForm(), createTransfer(), deleteTransferGroup(), eitherLegArchived(), groupUpdateSchema, loadGroupLegs() (+2 more)

### Community 62 - "Community 62"
Cohesion: 0.24
Nodes (10): HomePage(), isStale(), AttentionList(), CTA, ConfirmSheet(), seedBill(), AttentionItem, getAttentionItems() (+2 more)

### Community 65 - "Community 65"
Cohesion: 0.05
Nodes (38): dependencies, better-auth, drizzle-orm, @neondatabase/serverless, next, react, react-dom, zod (+30 more)

### Community 66 - "Community 66"
Cohesion: 0.32
Nodes (3): AccountOption, BillForm(), BillValues

### Community 67 - "Community 67"
Cohesion: 0.18
Nodes (14): confirmOccurrenceAction(), revalidateOccurrenceScreens(), skipOccurrenceAction(), unconfirmOccurrenceAction(), amountString, billInput, confirmInput, currencySchema (+6 more)

### Community 74 - "Community 74"
Cohesion: 0.33
Nodes (6): Architecture, Core model, Hard invariants, Key flows, Module map, Stack

### Community 79 - "Community 79"
Cohesion: 0.32
Nodes (3): AccountOption, InstallmentForm(), InstallmentValues

## Knowledge Gaps
- **308 isolated node(s):** `TABS`, `currencyEnum`, `TRANSACTION_TYPES`, `transactionTypeEnum`, `exchangeRates` (+303 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `My Ledger - Design Spec` connect `Community 1` to `Community 0`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Why does `Phase 07: Debts and Planner Implementation Plan` connect `Community 2` to `Community 0`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **What connects `TABS`, `currencyEnum`, `TRANSACTION_TYPES` to the rest of the system?**
  _308 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.08846153846153847 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.09523809523809523 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.125 - nodes in this community are weakly interconnected._
- **Should `Community 15` be split into smaller, more focused modules?**
  _Cohesion score 0.0666049953746531 - nodes in this community are weakly interconnected._