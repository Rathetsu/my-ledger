# My Ledger - Implementation Plans (Master Index)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement these plans task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build My Ledger end to end per [the spec](../specs/2026-07-07-my-ledger-design.md), in 12 phases that each end green.

**Architecture:** One ledger; every money movement is a single-currency transaction in a per-currency account; definitions generate confirmable occurrences that post transactions; deterministic planner + AI second opinion. See [wiki/architecture.md](../../wiki/architecture.md) and [ADRs](../../adr/).

**Tech stack:** Next.js App Router + TS + Tailwind, Neon + Drizzle, Better Auth (email+password), Vitest + Playwright, Vercel (+cron), Gemini free tier.

## Global constraints (every task inherits these)

- Money: integer minor units, currencies `EUR|USD|EGP`, round half-up, balances derived ([spec §3](../specs/2026-07-07-my-ledger-design.md)).
- No transaction converts currency; transfer legs mutate as a group; source-linked transactions mutate only via owning flow.
- Day boundaries `Africa/Cairo`; due-date clamp `min(due_day, last_day_of_month)`.
- Occurrences unique per (user, kind, source, period); confirms guard on `status IN ('pending','overdue')`; snapshots unique per (user, date).
- All mutations = zod-validated server actions + `revalidatePath`; every table has `user_id`.
- TDD: failing test → minimal code → pass → commit. Frequent small commits.
- The deterministic engine owns all numbers; the AI only quotes.

## Phase plans

| Phase | File | Delivers |
|---|---|---|
| P0 | [00-foundations.md](00-foundations.md) | Scaffold, tooling, DB, Better Auth (email+password), protected shell |
| P1 | [01-accounts-and-currency.md](01-accounts-and-currency.md) | Money, cairo dates, rates+convert, accounts CRUD, settings |
| P2 | [02-transactions-and-balances.md](02-transactions-and-balances.md) | Ledger core, transfers, reconciliation, history, dashboard v1 |
| P3 | [03-income.md](03-income.md) | Income sources, occurrences, confirm flow, housekeeping v1, attention list |
| P4 | [04-bills.md](04-bills.md) | Recurring bills on the occurrence rails |
| P5 | [05-installments.md](05-installments.md) | Count-based installments |
| P6 | [06-expenses-and-insights.md](06-expenses-and-insights.md) | Categories, one-off tag, insights charts |
| P7 | [07-debts-and-planner.md](07-debts-and-planner.md) | Flexible debts, deterministic currency-aware planner, plan screen |
| P8 | [08-wishlist.md](08-wishlist.md) | Wishlist + purchase flow + planner integration |
| P9 | [09-ai-advisor.md](09-ai-advisor.md) | Sanitizer, prompt pack, Gemini call, cached panel |
| P10 | [10-cron-and-snapshots.md](10-cron-and-snapshots.md) | Cron route, snapshots, trend charts |
| P11 | [11-polish.md](11-polish.md) | First-run, empty/error states, a11y, final E2E walkthrough |

Each phase plan is self-contained (an implementer sees only their file + this index + the spec) and ends with the phase's Playwright flow green.

## Canonical interfaces (cross-phase contracts - do not drift)

```ts
// lib/money/money.ts (P1)
type Currency = 'EUR' | 'USD' | 'EGP'
const CURRENCIES: readonly Currency[]
interface Money { amountMinor: number; currency: Currency }
function formatMoney(m: Money): string                       // "€1,234.56", "EGP 52,300.00"
function parseToMinor(input: string, currency: Currency): number  // throws on invalid

// lib/dates/cairo.ts (P1)
function todayCairo(): string                                // "YYYY-MM-DD"
function periodOf(date: string): string                      // "YYYY-MM"
function dueDateFor(period: string, dueDay: number): string  // clamped to month end

// lib/currency/rates.ts + convert.ts (P1)
interface Rates { base: 'USD'; rates: Record<Currency, number>; fetchedAt: string }
async function getRates(): Promise<Rates>                    // cache-first, seed/last-good fallback
function convert(amountMinor: number, from: Currency, to: Currency, rates: Rates): number  // round half-up

// lib/db (P0/P1/P2)
// drizzle schema per spec §4; db (neon-http) for reads, dbPool (neon-serverless) for transactions
async function accountBalanceMinor(accountId: string): Promise<number>   // sum of transactions (P1; transactions table is created in P1 because opening balances post transactions)

// lib/housekeeping/index.ts (P3, extended P10)
async function housekeeping(userId: string, today: string): Promise<void>

// lib/planner/types.ts + engine.ts (P7, extended P8)
interface PlanInput {
  homeCurrency: Currency; rates: Rates; horizonMonths: number   // default 24
  startPeriod: string                                            // "YYYY-MM", first planned month (engine is pure; caller passes periodOf(todayCairo()))
  monthlyIncomeMinor: Partial<Record<Currency, number>>          // guaranteed only
  billsMinor: Partial<Record<Currency, number>>
  installments: { name: string; monthlyMinor: number; currency: Currency; remainingCount: number; apr?: number }[]
  variableSpendMinor: Partial<Record<Currency, number>>          // G4 blend, computed by caller
  spendEstimateSource: 'baseline' | 'blend'                      // how variableSpendMinor was derived; echoed in PlanResult
  debts: { id: string; name: string; balanceMinor: number; currency: Currency; apr: number; deadline?: string; minPaymentMinor?: number }[]
  wishlist: { id: string; name: string; costMinor: number; currency: Currency; priority: number; targetDate?: string }[]
  accountBalancesMinor: Partial<Record<Currency, number>>
}
interface MonthPlan {
  period: string
  debtPayments: { debtId: string; amountMinor: number; currency: Currency }[]
  wishlistFunding: { itemId: string; amountMinor: number; currency: Currency }[]
  fundingGaps: { currency: Currency; shortfallMinor: number; suggestion: string }[]
  unallocatedMinor: number                                       // home currency; deadline slack + post-debt surplus, before wishlist funding (P8 draws wishlistFunding from it)
}
interface PlanResult {
  months: MonthPlan[]
  debtPayoffPeriod: Record<string, string | null>       // debtId → "YYYY-MM"
  wishlistAffordablePeriod: Record<string, string | null>
  surplusMinorByMonth: Record<string, number>            // home currency
  spendEstimateSource: 'baseline' | 'blend'
  highAprInstallmentFlags: string[]
}
function buildPlan(input: PlanInput): PlanResult

// lib/ai (P9)
function sanitizePlanPayload(input: PlanInput, result: PlanResult): SanitizedPayload  // generic labels only
async function getAdvice(payload: SanitizedPayload): Promise<string | null>           // null = unavailable; cached
```

## Verification

Per phase: the plan's own Vitest + Playwright gates, then manual mobile-viewport run. Cross-phase: [spec §7](../specs/2026-07-07-my-ledger-design.md). Update [wiki/status.md](../../wiki/status.md) as phases complete.
