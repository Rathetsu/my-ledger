# Phase 10: Cron and Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

Backlinks: [Plans master index](../plans/README.md) | [Design spec](../specs/2026-07-07-my-ledger-design.md) | [Live rates / snapshots / cron ADR (binding)](../../adr/2026-07-07-live-rates-snapshot-history-cron.md) | Previous: [09-ai-advisor.md](09-ai-advisor.md) | Next: [11-polish.md](11-polish.md)

**Goal:** Honest net-worth history: housekeeping upserts one snapshot per Cairo day (per-currency totals, that day's rates, combined value, home currency, total debt), a `CRON_SECRET`-guarded `/api/cron/daily` route plus `vercel.json` cron runs it on days the app is not opened, and the dashboard grows net-worth and total-debt trend charts that re-derive every past point from that day's stored rates, never today's.

**Architecture:** `net_worth_snapshots` (`UNIQUE(user_id, date)`) is written only by `housekeeping(userId, today)`, which gains a final snapshot step after P3's occurrence generation and overdue flips; the snapshot math is a pure `computeSnapshotRow` plus `rederiveNetWorthMinor` / `rederiveDebtMinor` helpers in `lib/housekeeping/snapshot.ts`. The cron route is a thin scheduler: authenticate, find the user(s) from `settings`, call the same idempotent `housekeeping`. Charts read snapshots ordered by date and re-derive each point in the CURRENT home currency from `per_currency` + that snapshot's stored `rates` (per the ADR: history never rewrites when EGP moves or the home currency switches).

**Tech Stack:** Next.js App Router route handler, Neon + Drizzle (`onConflictDoUpdate`), Vercel cron (`vercel.json` `crons`), Recharts (already installed by P6), Vitest, Playwright, `@neondatabase/serverless` for E2E seeding.

**Global Constraints** (from [plans README](../plans/README.md), verbatim):

- Money: integer minor units, currencies `EUR|USD|EGP`, round half-up, balances derived ([spec §3](../specs/2026-07-07-my-ledger-design.md)).
- No transaction converts currency; transfer legs mutate as a group; source-linked transactions mutate only via owning flow.
- Day boundaries `Africa/Cairo`; due-date clamp `min(due_day, last_day_of_month)`.
- Occurrences unique per (user, kind, source, period); confirms guard on `status IN ('pending','overdue')`; snapshots unique per (user, date).
- All mutations = zod-validated server actions + `revalidatePath`; every table has `user_id`.
- TDD: failing test → minimal code → pass → commit. Frequent small commits.
- The deterministic engine owns all numbers; the AI only quotes.

**Phase conventions:** unit tests colocated as `*.test.ts`; E2E specs in `e2e/`; imports use the `@/` alias. Canonical interfaces consumed exactly as published: `housekeeping(userId, today)` (P3), `getRates(): Promise<Rates>` (cache-first, refetches when older than 24h, seed/last-good fallback, P1), `convert(amountMinor, from, to, rates)` (round half-up, base USD cross rates, P1), `accountBalanceMinor(accountId)` (P1, exported from `lib/db`; if P1 placed it in a submodule, re-export it from `lib/db/index.ts` as part of Task 3), `todayCairo()` (P1).

---

### Task 1: `net_worth_snapshots` table and migration

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `drizzle/` migration (generated)

**Interfaces:**
- Produces: `netWorthSnapshots` Drizzle table per spec §4: `id, user_id, date, per_currency jsonb, combined_minor, home_currency, rates jsonb, total_debt_minor`, `UNIQUE(user_id, date)`.

**Steps:**

- [ ] Add the table to `lib/db/schema.ts` (schema tasks carry no unit test; the generated SQL is the check). `bigint` mode `number` for money columns so long-horizon EGP totals cannot overflow int4:

```ts
export const netWorthSnapshots = pgTable(
  'net_worth_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    date: date('date').notNull(), // Cairo calendar day, YYYY-MM-DD
    perCurrency: jsonb('per_currency').notNull().$type<Partial<Record<'EUR' | 'USD' | 'EGP', number>>>(),
    combinedMinor: bigint('combined_minor', { mode: 'number' }).notNull(),
    homeCurrency: text('home_currency').notNull().$type<'EUR' | 'USD' | 'EGP'>(),
    rates: jsonb('rates').notNull().$type<{ base: 'USD'; rates: Record<'EUR' | 'USD' | 'EGP', number>; fetchedAt: string }>(),
    totalDebtMinor: bigint('total_debt_minor', { mode: 'number' }).notNull(),
  },
  (t) => [unique('net_worth_snapshots_user_date').on(t.userId, t.date)],
)
```

- [ ] Generate and inspect the migration: `pnpm drizzle-kit generate`. Expected: SQL containing `CREATE TABLE "net_worth_snapshots"` and a `UNIQUE` constraint on `("user_id","date")`.
- [ ] Apply to the dev database: `pnpm drizzle-kit migrate`. Expected: exit 0.
- [ ] Commit: `git add lib/db/schema.ts drizzle && git commit -m "feat(snapshots): net_worth_snapshots table with UNIQUE(user_id, date)"`

---

### Task 2: pure snapshot math (`computeSnapshotRow`, `rederiveNetWorthMinor`, `rederiveDebtMinor`)

**Files:**
- Create: `lib/housekeeping/snapshot.ts`
- Test: `lib/housekeeping/snapshot.test.ts`

**Interfaces:**
- Consumes: `convert` from `@/lib/currency/convert` (canonical: round half-up, base-USD cross rates), `Rates` from `@/lib/currency/rates`, `Currency`, `CURRENCIES` from `@/lib/money/money`.
- Produces:

```ts
interface SnapshotComputeInput {
  userId: string
  date: string
  homeCurrency: Currency
  rates: Rates
  accountTotalsMinor: Partial<Record<Currency, number>>
  debtTotalsMinor: Partial<Record<Currency, number>>
}
interface SnapshotRow {
  userId: string; date: string
  perCurrency: Partial<Record<Currency, number>>
  combinedMinor: number; homeCurrency: Currency; rates: Rates; totalDebtMinor: number
}
function computeSnapshotRow(input: SnapshotComputeInput): SnapshotRow
function rederiveNetWorthMinor(perCurrency: Partial<Record<Currency, number>>, snapshotRates: Rates, currentHome: Currency): number
function rederiveDebtMinor(totalDebtMinor: number, snapshotHome: Currency, snapshotRates: Rates, currentHome: Currency): number
```

Per spec §3: convert each per-currency total once, round half-up, then sum. Re-derivation always uses the SNAPSHOT's stored rates, never today's.

**Steps:**

- [ ] Write the failing test `lib/housekeeping/snapshot.test.ts` with a concrete fixture:

```ts
import { describe, expect, it } from 'vitest'
import { computeSnapshotRow, rederiveDebtMinor, rederiveNetWorthMinor } from './snapshot'

// Fixture rates: 1 USD = 0.9 EUR = 50 EGP.
const RATES = {
  base: 'USD' as const,
  rates: { USD: 1, EUR: 0.9, EGP: 50 },
  fetchedAt: '2026-07-07T03:00:00.000Z',
}

describe('computeSnapshotRow', () => {
  it('stores per-currency totals and combines them in the home currency', () => {
    const row = computeSnapshotRow({
      userId: 'user-1',
      date: '2026-07-07',
      homeCurrency: 'EUR',
      rates: RATES,
      accountTotalsMinor: { EUR: 100000, USD: 50000, EGP: 2000000 },
      debtTotalsMinor: { EGP: 6000000 },
    })
    expect(row.perCurrency).toEqual({ EUR: 100000, USD: 50000, EGP: 2000000 })
    // EUR 100000 stays; USD 50000 -> 45000 EUR; EGP 2000000 -> 36000 EUR.
    expect(row.combinedMinor).toBe(181000)
    // EGP 6000000 -> 108000 EUR.
    expect(row.totalDebtMinor).toBe(108000)
    expect(row.homeCurrency).toBe('EUR')
    expect(row.rates).toEqual(RATES)
    expect(row.date).toBe('2026-07-07')
  })

  it('handles empty inputs as zeros', () => {
    const row = computeSnapshotRow({
      userId: 'user-1',
      date: '2026-07-07',
      homeCurrency: 'EUR',
      rates: RATES,
      accountTotalsMinor: {},
      debtTotalsMinor: {},
    })
    expect(row.perCurrency).toEqual({})
    expect(row.combinedMinor).toBe(0)
    expect(row.totalDebtMinor).toBe(0)
  })
})

describe('rederiveNetWorthMinor', () => {
  const perCurrency = { EUR: 100000, USD: 50000, EGP: 2000000 }

  it('re-derives the combined value in the current home currency from stored rates', () => {
    // Home EUR: 100000 + 45000 + 36000.
    expect(rederiveNetWorthMinor(perCurrency, RATES, 'EUR')).toBe(181000)
    // Home USD: 100000/0.9 = 111111.11 -> 111111 (half-up); + 50000; + 2000000/50 = 40000.
    expect(rederiveNetWorthMinor(perCurrency, RATES, 'USD')).toBe(201111)
  })

  it('rounds each converted total half-up before summing', () => {
    // EGP 75 -> USD 1.5 -> rounds half-up to 2.
    expect(rederiveNetWorthMinor({ EGP: 75 }, RATES, 'USD')).toBe(2)
  })
})

describe('rederiveDebtMinor', () => {
  it('converts the stored total from the snapshot home to the current home at stored rates', () => {
    // 108000 EUR at 0.9 EUR/USD -> 120000 USD.
    expect(rederiveDebtMinor(108000, 'EUR', RATES, 'USD')).toBe(120000)
    // Same home currency: unchanged.
    expect(rederiveDebtMinor(108000, 'EUR', RATES, 'EUR')).toBe(108000)
  })
})
```

- [ ] Run `pnpm vitest run lib/housekeeping/snapshot.test.ts`. Expected: FAIL (module `./snapshot` not found).
- [ ] Implement the pure part of `lib/housekeeping/snapshot.ts`:

```ts
import { convert } from '@/lib/currency/convert'
import type { Rates } from '@/lib/currency/rates'
import type { Currency } from '@/lib/money/money'
import { CURRENCIES } from '@/lib/money/money'

export interface SnapshotComputeInput {
  userId: string
  date: string
  homeCurrency: Currency
  rates: Rates
  accountTotalsMinor: Partial<Record<Currency, number>>
  debtTotalsMinor: Partial<Record<Currency, number>>
}

export interface SnapshotRow {
  userId: string
  date: string
  perCurrency: Partial<Record<Currency, number>>
  combinedMinor: number
  homeCurrency: Currency
  rates: Rates
  totalDebtMinor: number
}

// Spec §3: convert each per-currency total once, round half-up, then sum.
export function computeSnapshotRow(input: SnapshotComputeInput): SnapshotRow {
  const perCurrency: Partial<Record<Currency, number>> = {}
  let combinedMinor = 0
  let totalDebtMinor = 0
  for (const c of CURRENCIES) {
    const total = input.accountTotalsMinor[c]
    if (total !== undefined) {
      perCurrency[c] = total
      combinedMinor += convert(total, c, input.homeCurrency, input.rates)
    }
    const debt = input.debtTotalsMinor[c]
    if (debt !== undefined) {
      totalDebtMinor += convert(debt, c, input.homeCurrency, input.rates)
    }
  }
  return {
    userId: input.userId,
    date: input.date,
    perCurrency,
    combinedMinor,
    homeCurrency: input.homeCurrency,
    rates: input.rates,
    totalDebtMinor,
  }
}

// Trend charts: past points are re-derived from each snapshot's OWN stored rates,
// never today's rates (ADR: history never rewrites).
export function rederiveNetWorthMinor(
  perCurrency: Partial<Record<Currency, number>>,
  snapshotRates: Rates,
  currentHome: Currency,
): number {
  let combined = 0
  for (const c of CURRENCIES) {
    const total = perCurrency[c]
    if (total !== undefined) combined += convert(total, c, currentHome, snapshotRates)
  }
  return combined
}

export function rederiveDebtMinor(
  totalDebtMinor: number,
  snapshotHome: Currency,
  snapshotRates: Rates,
  currentHome: Currency,
): number {
  return convert(totalDebtMinor, snapshotHome, currentHome, snapshotRates)
}
```

- [ ] Run `pnpm vitest run lib/housekeeping/snapshot.test.ts`. Expected: PASS (6 tests).
- [ ] Commit: `git add lib/housekeeping/snapshot.ts lib/housekeeping/snapshot.test.ts && git commit -m "feat(snapshots): pure snapshot math and stored-rates re-derivation"`

---

### Task 3: housekeeping upserts today's snapshot (idempotent)

**Files:**
- Modify: `lib/housekeeping/snapshot.ts`, `lib/housekeeping/index.ts` (built in P3)
- Test: `lib/housekeeping/upsert-snapshot.test.ts`

**Interfaces:**
- Consumes: `getRates` (P1: cache-first, refetches when the stored row is older than 24h, so calling it here IS the "refresh stale rates" housekeeping step), `accountBalanceMinor` (P1), `db`, schema tables `settings`, `accounts`, `flexibleDebts`, `transactions`, `netWorthSnapshots`.
- Produces: `upsertDailySnapshot(userId: string, date: string): Promise<void>`; `housekeeping(userId, today)` (canonical signature unchanged) now ends with the snapshot step.

**Steps:**

- [ ] Write the failing test `lib/housekeeping/upsert-snapshot.test.ts`. The mock db honors the `onConflictDoUpdate` target semantics with an in-memory map keyed by `(userId, date)`, so running the upsert twice on the same Cairo date must update the same row (the real constraint from Task 1 enforces this in Postgres; the E2E in Task 6 exercises it for real):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const RATES = {
  base: 'USD' as const,
  rates: { USD: 1, EUR: 0.9, EGP: 50 },
  fetchedAt: '2026-07-07T03:00:00.000Z',
}

const state = {
  balances: { a1: 100000, a2: 2000000 } as Record<string, number>,
  paidTotal: -2000000, // debt payments as seen in the ledger
  store: new Map<string, Record<string, unknown>>(),
}

vi.mock('@/lib/currency/rates', () => ({
  getRates: vi.fn(async () => RATES),
}))

vi.mock('@/lib/db', () => ({
  accountBalanceMinor: vi.fn(async (id: string) => state.balances[id]),
}))

vi.mock('@/lib/db/client', async () => {
  const schema = await import('@/lib/db/schema')
  return {
    db: {
      select: (projection?: unknown) => ({
        from: (table: unknown) => ({
          where: async () => {
            if (table === schema.settings) return [{ userId: 'user-1', homeCurrency: 'EUR' }]
            if (table === schema.accounts)
              return [
                { id: 'a1', currency: 'EUR' },
                { id: 'a2', currency: 'EGP' },
              ]
            if (table === schema.flexibleDebts)
              return [{ id: 'd1', userId: 'user-1', currency: 'EGP', originalMinor: 5000000 }]
            if (table === schema.transactions) return [{ total: state.paidTotal }]
            return []
          },
        }),
      }),
      insert: () => ({
        values: (v: { userId: string; date: string }) => ({
          onConflictDoUpdate: async ({ set }: { set: Record<string, unknown> }) => {
            const key = `${v.userId}|${v.date}`
            state.store.set(key, state.store.has(key) ? { ...state.store.get(key), ...set } : { ...v })
          },
        }),
      }),
    },
  }
})

import { upsertDailySnapshot } from './snapshot'

describe('upsertDailySnapshot', () => {
  beforeEach(() => {
    state.store.clear()
    state.balances = { a1: 100000, a2: 2000000 }
  })

  it('writes one row with derived per-currency totals, combined value, and derived debt', async () => {
    await upsertDailySnapshot('user-1', '2026-07-07')
    expect(state.store.size).toBe(1)
    const row = state.store.get('user-1|2026-07-07')!
    expect(row.perCurrency).toEqual({ EUR: 100000, EGP: 2000000 })
    // EUR 100000 + EGP 2000000 -> 36000 EUR = 136000.
    expect(row.combinedMinor).toBe(136000)
    // Debt: 5000000 original - |−2000000| paid = 3000000 EGP -> 54000 EUR.
    expect(row.totalDebtMinor).toBe(54000)
    expect(row.homeCurrency).toBe('EUR')
    expect(row.rates).toEqual(RATES)
  })

  it('re-running on the same Cairo date updates the same row', async () => {
    await upsertDailySnapshot('user-1', '2026-07-07')
    state.balances = { a1: 110000, a2: 2000000 }
    await upsertDailySnapshot('user-1', '2026-07-07')
    expect(state.store.size).toBe(1)
    expect(state.store.get('user-1|2026-07-07')!.combinedMinor).toBe(146000)
  })

  it('a different date creates a second row', async () => {
    await upsertDailySnapshot('user-1', '2026-07-07')
    await upsertDailySnapshot('user-1', '2026-07-08')
    expect(state.store.size).toBe(2)
  })
})
```

- [ ] Run `pnpm vitest run lib/housekeeping/upsert-snapshot.test.ts`. Expected: FAIL (`upsertDailySnapshot` is not exported).
- [ ] Append to `lib/housekeeping/snapshot.ts`:

```ts
import { and, eq, isNull, sql } from 'drizzle-orm'
import { getRates } from '@/lib/currency/rates'
import { accountBalanceMinor } from '@/lib/db'
import { db } from '@/lib/db/client'
import { accounts, flexibleDebts, netWorthSnapshots, settings, transactions } from '@/lib/db/schema'

export async function upsertDailySnapshot(userId: string, date: string): Promise<void> {
  // getRates() is cache-first and refetches when the stored row is older than 24h,
  // which is exactly housekeeping's "refresh stale rates" step (ADR).
  const rates = await getRates()

  const [userSettings] = await db.select().from(settings).where(eq(settings.userId, userId))
  const homeCurrency = (userSettings?.homeCurrency ?? 'EUR') as Currency

  // Per-currency totals across non-archived accounts (balances are always derived).
  const accountRows = await db
    .select({ id: accounts.id, currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), isNull(accounts.archivedAt)))
  const accountTotalsMinor: Partial<Record<Currency, number>> = {}
  for (const a of accountRows) {
    const c = a.currency as Currency
    accountTotalsMinor[c] = (accountTotalsMinor[c] ?? 0) + (await accountBalanceMinor(a.id))
  }
  // ponytail: sequential per-account queries, fine for a single user's handful of accounts

  // Total debt = sum of derived flexible-debt balances (original minus payments).
  const debtRows = await db.select().from(flexibleDebts).where(eq(flexibleDebts.userId, userId))
  const debtTotalsMinor: Partial<Record<Currency, number>> = {}
  for (const d of debtRows) {
    const [paid] = await db
      .select({ total: sql<number>`coalesce(sum(${transactions.amountMinor}), 0)::bigint` })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.sourceType, 'flexible_debt'),
          eq(transactions.sourceId, d.id),
        ),
      )
    // Absolute sum: correct whether P2 stores outflows as negative or positive amounts.
    const remaining = d.originalMinor - Math.abs(Number(paid?.total ?? 0))
    if (remaining > 0) {
      const c = d.currency as Currency
      debtTotalsMinor[c] = (debtTotalsMinor[c] ?? 0) + remaining
    }
  }

  const row = computeSnapshotRow({ userId, date, homeCurrency, rates, accountTotalsMinor, debtTotalsMinor })
  await db
    .insert(netWorthSnapshots)
    .values(row)
    .onConflictDoUpdate({
      target: [netWorthSnapshots.userId, netWorthSnapshots.date],
      set: {
        perCurrency: row.perCurrency,
        combinedMinor: row.combinedMinor,
        homeCurrency: row.homeCurrency,
        rates: row.rates,
        totalDebtMinor: row.totalDebtMinor,
      },
    })
}
```

- [ ] Run `pnpm vitest run lib/housekeeping/upsert-snapshot.test.ts`. Expected: PASS (3 tests).
- [ ] Extend `lib/housekeeping/index.ts`: keep P3's body (occurrence generation, then overdue flips) and append the snapshot as the final step, preserving the canonical signature:

```ts
import { upsertDailySnapshot } from './snapshot'

export async function housekeeping(userId: string, today: string): Promise<void> {
  // P3 steps, unchanged: generate current+next period occurrences (ON CONFLICT DO NOTHING),
  // then flip pending -> overdue for occurrences past their due date.
  await generateOccurrences(userId, today)
  await flipOverdue(userId, today)
  // P10: refresh stale rates + upsert today's snapshot. Idempotent per UNIQUE(user_id, date).
  await upsertDailySnapshot(userId, today)
}
```

(The two P3 function names above must match whatever P3 actually named its internal steps; the contract is only that the P3 behavior runs first and `upsertDailySnapshot(userId, today)` runs last.)

- [ ] Run the whole housekeeping test set to prove P3 behavior is intact: `pnpm vitest run lib/housekeeping`. Expected: PASS (P3 suites plus the two new files).
- [ ] Commit: `git add lib/housekeeping && git commit -m "feat(snapshots): housekeeping upserts today's snapshot with derived totals and current rates"`

---

### Task 4: cron route and `vercel.json`

**Files:**
- Create: `app/api/cron/daily/route.ts`
- Create or Modify: `vercel.json`
- Test: `app/api/cron/daily/route.test.ts`

**Interfaces:**
- Consumes: `housekeeping` (canonical), `todayCairo` (canonical), `db`, `settings`.
- Produces: `GET /api/cron/daily` returning `401` unless `Authorization: Bearer ${CRON_SECRET}` matches, otherwise running housekeeping for every distinct `user_id` in `settings` (a single user today) and returning `{ ok: true, ran: n }`.

**Steps:**

- [ ] Write the failing test `app/api/cron/daily/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/housekeeping', () => ({
  housekeeping: vi.fn(async () => undefined),
}))
vi.mock('@/lib/dates/cairo', () => ({
  todayCairo: () => '2026-07-07',
}))
vi.mock('@/lib/db/client', () => ({
  db: {
    selectDistinct: () => ({
      from: async () => [{ userId: 'user-1' }],
    }),
  },
}))

import { housekeeping } from '@/lib/housekeeping'
import { GET } from './route'

function get(headers: Record<string, string> = {}) {
  return GET(new Request('http://test/api/cron/daily', { headers }))
}

describe('GET /api/cron/daily', () => {
  beforeEach(() => {
    vi.mocked(housekeeping).mockClear()
    vi.stubEnv('CRON_SECRET', 's3cret')
  })

  it('returns 401 without an Authorization header', async () => {
    const res = await get()
    expect(res.status).toBe(401)
    expect(housekeeping).not.toHaveBeenCalled()
  })

  it('returns 401 with a wrong bearer token', async () => {
    const res = await get({ authorization: 'Bearer wrong' })
    expect(res.status).toBe(401)
  })

  it('returns 401 when CRON_SECRET is unset, even for a literal match attempt', async () => {
    vi.stubEnv('CRON_SECRET', '')
    const res = await get({ authorization: 'Bearer undefined' })
    expect(res.status).toBe(401)
  })

  it('runs housekeeping per user and reports the count with the right secret', async () => {
    const res = await get({ authorization: 'Bearer s3cret' })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, ran: 1 })
    expect(housekeeping).toHaveBeenCalledWith('user-1', '2026-07-07')
  })
})
```

- [ ] Run `pnpm vitest run app/api/cron/daily/route.test.ts`. Expected: FAIL (module `./route` not found).
- [ ] Implement `app/api/cron/daily/route.ts`:

```ts
import { todayCairo } from '@/lib/dates/cairo'
import { db } from '@/lib/db/client'
import { settings } from '@/lib/db/schema'
import { housekeeping } from '@/lib/housekeeping'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const users = await db.selectDistinct({ userId: settings.userId }).from(settings)
  const today = todayCairo()
  for (const u of users) {
    await housekeeping(u.userId, today)
  }
  return Response.json({ ok: true, ran: users.length })
}
```

- [ ] Run `pnpm vitest run app/api/cron/daily/route.test.ts`. Expected: PASS (4 tests).
- [ ] Create `vercel.json` at the repo root (or add the `crons` key if P0 already created the file):

```json
{
  "crons": [
    {
      "path": "/api/cron/daily",
      "schedule": "0 3 * * *"
    }
  ]
}
```

Note: Vercel Hobby tier executes daily crons once per day at some point WITHIN the scheduled hour (03:00-03:59 UTC, which is 05:00-06:59 in Cairo depending on DST), not at the exact minute. That is fine: housekeeping is idempotent and also runs lazily on every dashboard load, so the cron only covers days the app is never opened. Vercel invokes the path with `Authorization: Bearer ${CRON_SECRET}` automatically when the `CRON_SECRET` env var is set on the project; set it in the Vercel dashboard and in `.env.example`.

- [ ] Add to `.env.example`:

```
CRON_SECRET=
```

- [ ] Commit: `git add app/api/cron/daily vercel.json .env.example && git commit -m "feat(cron): CRON_SECRET-guarded daily route running housekeeping, vercel cron schedule"`

---

### Task 5: dashboard trend charts (read from snapshots)

**Files:**
- Create: `components/trend-charts.tsx`
- Modify: `app/(app)/page.tsx` (dashboard, built in P2/P3)

**Interfaces:**
- Consumes: `netWorthSnapshots` rows ordered by date; `rederiveNetWorthMinor`, `rederiveDebtMinor` (Task 2); the user's current `home_currency` from settings; Recharts (installed in P6).
- Produces: `TrendCharts({ points, homeCurrency }: { points: TrendPoint[]; homeCurrency: string })` with `interface TrendPoint { date: string; netWorth: number; debt: number }` (major units, for axis readability; display-only division, the engine numbers stay minor units).

Every past point is re-derived in the CURRENT home currency from that snapshot's `per_currency` and its STORED `rates`; today's rates are never applied to past points. Under 2 points the section renders an empty state instead of charts.

**Steps:**

- [ ] Create `components/trend-charts.tsx`:

```tsx
'use client'

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export interface TrendPoint {
  date: string // YYYY-MM-DD
  netWorth: number // major units, current home currency
  debt: number // major units, current home currency
}

export function TrendCharts({ points, homeCurrency }: { points: TrendPoint[]; homeCurrency: string }) {
  if (points.length < 2) {
    return (
      <section aria-label="Trends" className="mt-6 rounded-lg border border-zinc-200 p-4">
        <h2 className="text-base font-semibold">Trends</h2>
        <p className="mt-2 text-sm text-zinc-500">
          Trends appear once two daily snapshots exist. Come back tomorrow.
        </p>
      </section>
    )
  }
  return (
    <section aria-label="Trends" className="mt-6 rounded-lg border border-zinc-200 p-4">
      <h2 className="text-base font-semibold">Net worth ({homeCurrency})</h2>
      <div className="mt-2 h-48" role="img" aria-label={`Net worth over time in ${homeCurrency}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={24} />
            <YAxis tick={{ fontSize: 11 }} width={56} />
            <Tooltip />
            <Line type="monotone" dataKey="netWorth" name="Net worth" stroke="#2563eb" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <h2 className="mt-6 text-base font-semibold">Total debt ({homeCurrency})</h2>
      <div className="mt-2 h-48" role="img" aria-label={`Total debt over time in ${homeCurrency}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={24} />
            <YAxis tick={{ fontSize: 11 }} width={56} />
            <Tooltip />
            <Line type="monotone" dataKey="debt" name="Total debt" stroke="#dc2626" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
```

- [ ] Wire into the dashboard server component `app/(app)/page.tsx` (the page already runs `housekeeping` on load per P3 and has the settings row in scope):

```tsx
import { asc, eq } from 'drizzle-orm'
import { TrendCharts, type TrendPoint } from '@/components/trend-charts'
import { rederiveDebtMinor, rederiveNetWorthMinor } from '@/lib/housekeeping/snapshot'
import { netWorthSnapshots } from '@/lib/db/schema'

// inside the page component, after housekeeping(user.id, todayCairo()):
const snapshotRows = await db
  .select()
  .from(netWorthSnapshots)
  .where(eq(netWorthSnapshots.userId, user.id))
  .orderBy(asc(netWorthSnapshots.date))
const home = userSettings.homeCurrency
const trendPoints: TrendPoint[] = snapshotRows.map((s) => ({
  date: s.date,
  netWorth: rederiveNetWorthMinor(s.perCurrency, s.rates, home) / 100,
  debt: rederiveDebtMinor(s.totalDebtMinor, s.homeCurrency, s.rates, home) / 100,
}))

// in the returned JSX, below the attention list and recent activity:
<TrendCharts points={trendPoints} homeCurrency={home} />
```

- [ ] Verify: `pnpm build`. Expected: exit 0. Then `pnpm dev`, open `/` on a mobile viewport: with fewer than 2 snapshots the empty state shows; after a second day (or after Task 6 seeding) two line charts render.
- [ ] Commit: `git add components/trend-charts.tsx app/\(app\)/page.tsx && git commit -m "feat(trends): dashboard net-worth and debt charts re-derived from stored snapshot rates"`

---

### Task 6: E2E (trends render from seeded snapshots, cron auth)

**Files:**
- Create: `e2e/trends.spec.ts`

**Interfaces:**
- Consumes: `@neondatabase/serverless` `neon()` raw SQL against `DATABASE_URL` (test database) for seeding; the test auth project sign-in (env `E2E_EMAIL` / `E2E_PASSWORD`).

**Steps:**

- [ ] Write `e2e/trends.spec.ts`:

```ts
import { neon } from '@neondatabase/serverless'
import { expect, test, type Page } from '@playwright/test'

const sql = neon(process.env.DATABASE_URL!)

const RATES = JSON.stringify({
  base: 'USD',
  rates: { USD: 1, EUR: 0.9, EGP: 50 },
  fetchedAt: '2026-07-05T03:00:00.000Z',
})

async function signIn(page: Page) {
  await page.goto('/')
  if (await page.getByLabel('Email').isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.getByLabel('Email').fill(process.env.E2E_EMAIL!)
    await page.getByLabel('Password').fill(process.env.E2E_PASSWORD!)
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL('**/')
  }
}

async function testUserId(): Promise<string> {
  const rows = (await sql`select user_id from settings limit 1`) as { user_id: string }[]
  expect(rows.length).toBe(1)
  return rows[0].user_id
}

test.describe('dashboard trends', () => {
  test('shows the empty state with fewer than two snapshots', async ({ page }) => {
    await signIn(page)
    const userId = await testUserId()
    await sql`delete from net_worth_snapshots where user_id = ${userId}`
    // Dashboard load runs housekeeping, creating exactly one snapshot (today's).
    await page.goto('/')
    await expect(page.getByText('Trends appear once two daily snapshots exist')).toBeVisible()
  })

  test('renders both charts after housekeeping ran with seeded history', async ({ page }) => {
    await signIn(page)
    const userId = await testUserId()
    await sql`delete from net_worth_snapshots where user_id = ${userId}`
    for (const [d, combined, debt] of [
      ['2026-07-04', 100000, 60000],
      ['2026-07-05', 105000, 55000],
      ['2026-07-06', 103000, 50000],
    ] as const) {
      await sql`
        insert into net_worth_snapshots
          (user_id, date, per_currency, combined_minor, home_currency, rates, total_debt_minor)
        values
          (${userId}, ${d}, ${JSON.stringify({ EUR: combined })}::jsonb, ${combined}, 'EUR', ${RATES}::jsonb, ${debt})
        on conflict (user_id, date) do nothing
      `
    }
    await page.goto('/') // housekeeping adds today's point on top of the seeded three
    await expect(page.getByRole('heading', { name: /^Net worth \(/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: /^Total debt \(/ })).toBeVisible()
    await expect(page.getByLabel('Trends').locator('svg').first()).toBeVisible()
  })
})

test.describe('cron route', () => {
  test('rejects requests without the CRON_SECRET bearer', async ({ request }) => {
    const res = await request.get('/api/cron/daily')
    expect(res.status()).toBe(401)
  })
})
```

- [ ] Run `pnpm exec playwright test e2e/trends.spec.ts`. Expected: PASS (3 tests). If a selector misses, fix the screen's accessible name, not the test.
- [ ] Commit: `git add e2e/trends.spec.ts && git commit -m "test(trends): e2e for seeded trend charts, empty state, and cron auth"`

---

### Task 7: phase gate

**Files:**
- Modify: `docs/wiki/status.md`

**Steps:**

- [ ] Run the full unit suite: `pnpm test`. Expected: all green.
- [ ] Run the full E2E suite: `pnpm exec playwright test`. Expected: all green.
- [ ] Run the production build: `pnpm build`. Expected: exit 0.
- [ ] Manual mobile-viewport pass on `/`: trends section (charts or empty state), attention list intact, no regression to P3 housekeeping behavior.
- [ ] After deploying: hit `/api/cron/daily` once with `curl -H "Authorization: Bearer $CRON_SECRET" https://<deployment>/api/cron/daily` and expect `{"ok":true,"ran":1}`; confirm a snapshot row exists for today.
- [ ] Update the P10 row in `docs/wiki/status.md` to `done`.
- [ ] Commit: `git add docs/wiki/status.md && git commit -m "docs(status): P10 cron and snapshots complete"`

---

Backlinks: [Plans master index](../plans/README.md) | [Design spec](../specs/2026-07-07-my-ledger-design.md) | Previous: [09-ai-advisor.md](09-ai-advisor.md) | Next: [11-polish.md](11-polish.md)
