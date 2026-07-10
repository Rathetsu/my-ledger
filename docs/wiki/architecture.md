# Architecture

Current truth of the system design. Terms per [/CONTEXT.md](../../CONTEXT.md); requirements per [the spec](../superpowers/specs/2026-07-07-my-ledger-design.md); rationale in [ADRs](../adr/). P0–P5 are implemented (foundations, accounts & currency, ledger core, income & the shared occurrence rails, recurring bills, count-based installments); see [status.md](status.md) for phase status. This page describes the full target design, including modules that later phases (P6+) still build.

## Core model

**One ledger, everything is a transaction** inside a single-currency account. Definitions (income sources, bills, installments, flexible debts, wishlist items) generate occurrences or payments that write transactions when confirmed, atomically. Balances are derived by summing transactions. Conversion exists only at display/planning time (live rates) and in two-leg transfers.

## Stack

Next.js (App Router) + TypeScript + Tailwind, mobile-first (bottom tab nav). Neon Postgres via Drizzle (`neon-http` for reads, `neon-serverless` Pool for multi-step writes). Self-hosted Better Auth (email+password only; open sign-up gated by `ALLOW_SIGNUP`), auth tables in our own Neon DB via Drizzle; one auth config for dev, E2E, and prod. Mutations are zod-validated server actions + `revalidatePath`. Vitest (pure logic) + Playwright (E2E). Vercel deploy; `drizzle-kit migrate` in the build command; daily Vercel cron (Hobby tier: once/day ±59 min).

## Module map

```
app/
  api/auth/[...all]/route.ts      # Better Auth handler (toNextJsHandler)
  sign-in/page.tsx, sign-up/page.tsx  # email+password forms (outside (app))
  (app)/layout.tsx                # protected shell + bottom tabs
  (app)/page.tsx                  # dashboard: attention list, net worth, trends
  (app)/accounts|transactions|income|bills|installments|debts|expenses|wishlist|plan|settings/
  api/cron/daily/route.ts         # CRON_SECRET-guarded → housekeeping()
lib/
  db/{client.ts, schema.ts}       # Drizzle clients + full schema
  auth.ts, auth-client.ts         # betterAuth instance + requireUser(); client for forms
  money/money.ts                  # integer minor units, format/parse, round-half-up
  dates/cairo.ts                  # Africa/Cairo day boundaries, due-day clamping
  currency/{rates.ts, convert.ts} # open.er-api fetch/cache/seed + convert()
  housekeeping/index.ts           # idempotent: occurrences, overdue flips, snapshot, rates
  planner/{types.ts, engine.ts}   # deterministic currency-aware planner (pure)
  ai/{advisor.ts, sanitize.ts, prompt.ts}  # Gemini advisor: anonymize → prompt → cache
  actions/                        # server actions by domain
components/                       # mobile-first UI + charts
```

## Key flows

- **Confirm flow** (income/bill/installment occurrence): editable pre-filled sheet → server action → DB transaction: `UPDATE occurrences … WHERE status='pending'` + insert typed transaction (+ decrement installment count). Un-confirm reverses both.
- **Housekeeping** (`housekeeping(userId, today)`): idempotent; generates current+next-period occurrences (`ON CONFLICT DO NOTHING`), flips overdue, upserts today's snapshot, refreshes stale rates. Called on dashboard load and by the daily cron.
- **Planner**: pure function over engine inputs → monthly allocations, payoff/affordability months, funding-gap transfer suggestions. Simple monthly interest (`apr/12`) in projections only; DB balances never accrue.
- **AI advisor**: sanitized anonymized payload → `gemini-3-flash-preview` (env-configurable) → free-text second opinion, cached by bucketed-payload hash.

## Hard invariants

See [/CONTEXT.md](../../CONTEXT.md) Domain rules. Enforcement points: single-currency transactions (schema + actions), engine-owns-numbers (AI layer quotes only), source-linked mutability (actions layer), Cairo day boundaries (dates module only - nothing else touches timezones).
