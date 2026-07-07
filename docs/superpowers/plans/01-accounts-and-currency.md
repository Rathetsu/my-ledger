# Phase 01: Accounts and Currency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Backlinks:** [Master index](README.md) | [Spec](../specs/2026-07-07-my-ledger-design.md) | Prev: [00-foundations.md](00-foundations.md) | Next: [02-transactions-and-balances.md](02-transactions-and-balances.md)

**Goal:** The money foundation: schema for accounts/transactions/rates/settings, the Money and Cairo-date primitives, live cached FX rates with conversion, accounts CRUD with opening balances, and a dashboard placeholder showing per-currency totals plus a combined figure at the live rate.

**Architecture:** Pure primitives (`lib/money`, `lib/dates`, `lib/currency`) carry all the numeric rules and are unit-tested in isolation; thin Drizzle queries derive balances by summing transactions; zod-validated server actions are the only write path. The `transactions` table is created in this phase because creating an account posts an `opening` transaction.

**Tech Stack:** Next.js App Router server actions + zod, Drizzle (pgTable/pgEnum) on Neon, Stack Auth (`requireUser()`), Vitest, Playwright, Tailwind (mobile-first).

## Global Constraints

- Money: integer minor units, currencies `EUR|USD|EGP`, round half-up, balances derived ([spec §3](../specs/2026-07-07-my-ledger-design.md)).
- No transaction converts currency; transfer legs mutate as a group; source-linked transactions mutate only via owning flow.
- Day boundaries `Africa/Cairo`; due-date clamp `min(due_day, last_day_of_month)`.
- Occurrences unique per (user, kind, source, period); confirms guard on `status IN ('pending','overdue')`; snapshots unique per (user, date).
- All mutations = zod-validated server actions + `revalidatePath`; every table has `user_id`.
- TDD: failing test → minimal code → pass → commit. Frequent small commits.
- The deterministic engine owns all numbers; the AI only quotes.

**Sign convention (used from here on):** `amount_minor` is signed. Inflows are positive (`income`, `transfer_in`), outflows negative (`expense`, `bill_payment`, `installment_payment`, `debt_payment`, `purchase`, `transfer_out`), and `opening`/`adjustment` carry whatever sign reality has. Balance = plain `SUM(amount_minor)`.

## Task 1: Schema and migration (accounts, transactions, exchange_rates, settings) with seeded rates

**Files:**
- Modify: `lib/db/schema.ts` (replace the empty baseline)
- Create: `drizzle/0000_*.sql` (generated, then hand-edited to append the seed row)

**Interfaces:**
- Consumes: `db`/`dbPool` and drizzle-kit scripts from P0 Task 4.
- Produces: `accounts`, `transactions`, `exchangeRates`, `settings` tables plus `TRANSACTION_TYPES`, `currencyEnum`, `transactionTypeEnum` exports; a seeded `exchange_rates` row every `getRates()` call can fall back to.

**Steps:**

- [ ] Replace `lib/db/schema.ts` with the four P1 tables (spec §4). Note: `category_id` is a plain nullable uuid for now; the `expense_categories` table and its FK arrive in P6.

```ts
import {
  boolean,
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

export const currencyEnum = pgEnum('currency', ['EUR', 'USD', 'EGP'])

export const TRANSACTION_TYPES = [
  'opening',
  'income',
  'expense',
  'bill_payment',
  'installment_payment',
  'debt_payment',
  'purchase',
  'transfer_in',
  'transfer_out',
  'adjustment',
] as const

export const transactionTypeEnum = pgEnum('transaction_type', TRANSACTION_TYPES)

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  currency: currencyEnum('currency').notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  type: transactionTypeEnum('type').notNull(),
  // Signed integer minor units: inflows positive, outflows negative.
  amountMinor: integer('amount_minor').notNull(),
  currency: currencyEnum('currency').notNull(),
  categoryId: uuid('category_id'), // FK to expense_categories lands in P6
  occurredOn: date('occurred_on').notNull(),
  note: text('note'),
  oneOff: boolean('one_off').notNull().default(false),
  sourceType: text('source_type'), // 'income' | 'bill' | 'installment' (P3+); null = plain row
  sourceId: uuid('source_id'),
  transferGroupId: uuid('transfer_group_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Single row, base USD; getRates() refreshes it when older than 24h.
export const exchangeRates = pgTable('exchange_rates', {
  base: text('base').primaryKey(),
  rates: jsonb('rates').$type<Record<'EUR' | 'USD' | 'EGP', number>>().notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
})

export const settings = pgTable('settings', {
  userId: text('user_id').primaryKey(),
  homeCurrency: currencyEnum('home_currency').notNull().default('EUR'),
  essentialsBaseline: jsonb('essentials_baseline').$type<
    Partial<Record<'EUR' | 'USD' | 'EGP', number>>
  >(),
  aiEnabled: boolean('ai_enabled').notNull().default(true),
})
```

ponytail: no indexes yet, personal-scale row counts; add them when a query is measurably slow.

- [ ] Generate the migration: `npm run db:generate`. Expected: a new `drizzle/0000_*.sql` creating both enums and all four tables.
- [ ] Append the hardcoded seed rates row to the END of that generated `.sql` file (editing is safe: this migration has never been applied anywhere). The stale `fetched_at` makes the first real `getRates()` call refresh immediately, while still giving a last-good fallback if that fetch fails:

```sql
--> statement-breakpoint
INSERT INTO "exchange_rates" ("base", "rates", "fetched_at")
VALUES ('USD', '{"USD":1,"EUR":0.92,"EGP":48.5}'::jsonb, '2026-01-01 00:00:00+00')
ON CONFLICT ("base") DO NOTHING;
```

- [ ] Apply: `npm run db:migrate`. Expected: exit 0. Verify the seed with any SQL client: `SELECT * FROM exchange_rates;` returns the USD row.
- [ ] Commit:

```bash
git add lib/db/schema.ts drizzle
git commit -m "feat(db): accounts, transactions, exchange_rates, settings + seeded rates"
```

## Task 2: Money primitives (lib/money/money.ts)

**Files:**
- Test: `lib/money/money.test.ts`
- Create: `lib/money/money.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (canonical, exact): `type Currency = 'EUR' | 'USD' | 'EGP'`; `const CURRENCIES: readonly Currency[]`; `interface Money { amountMinor: number; currency: Currency }`; `function formatMoney(m: Money): string`; `function parseToMinor(input: string, currency: Currency): number` (throws on invalid).

**Steps:**

- [ ] Write the failing test `lib/money/money.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { CURRENCIES, formatMoney, parseToMinor } from '@/lib/money/money'

test('CURRENCIES is exactly EUR, USD, EGP', () => {
  expect(CURRENCIES).toEqual(['EUR', 'USD', 'EGP'])
})

describe('formatMoney', () => {
  test('EUR: symbol + thousands grouping', () => {
    expect(formatMoney({ amountMinor: 123456, currency: 'EUR' })).toBe('€1,234.56')
  })
  test('USD: cents padded', () => {
    expect(formatMoney({ amountMinor: 50, currency: 'USD' })).toBe('$0.50')
  })
  test('EGP: code prefix', () => {
    expect(formatMoney({ amountMinor: 5230000, currency: 'EGP' })).toBe('EGP 52,300.00')
  })
  test('negative amounts', () => {
    expect(formatMoney({ amountMinor: -123456, currency: 'EUR' })).toBe('-€1,234.56')
  })
})

describe('parseToMinor', () => {
  test('plain decimal', () => expect(parseToMinor('1234.56', 'EUR')).toBe(123456))
  test('grouping commas stripped', () => expect(parseToMinor('1,234.56', 'EUR')).toBe(123456))
  test('one decimal digit pads', () => expect(parseToMinor('10.5', 'USD')).toBe(1050))
  test('integer input', () => expect(parseToMinor('52300', 'EGP')).toBe(5230000))
  test('negative allowed (reconciliation, opening)', () =>
    expect(parseToMinor('-12.34', 'EUR')).toBe(-1234))
  test('throws on three decimals', () => expect(() => parseToMinor('1.234', 'EUR')).toThrow())
  test('throws on garbage', () => expect(() => parseToMinor('abc', 'EUR')).toThrow())
  test('throws on empty', () => expect(() => parseToMinor('', 'EUR')).toThrow())
})
```

- [ ] Run: `npm run test`. Expected FAIL: `Failed to resolve import "@/lib/money/money"`.
- [ ] Create `lib/money/money.ts`:

```ts
export type Currency = 'EUR' | 'USD' | 'EGP'

export const CURRENCIES: readonly Currency[] = ['EUR', 'USD', 'EGP']

export interface Money {
  amountMinor: number
  currency: Currency
}

// All three currencies use 2-decimal minor units (ADR: integer minor units).
const PREFIX: Record<Currency, string> = { EUR: '€', USD: '$', EGP: 'EGP ' }

export function formatMoney(m: Money): string {
  const sign = m.amountMinor < 0 ? '-' : ''
  const abs = Math.abs(m.amountMinor)
  const major = Math.floor(abs / 100).toLocaleString('en-US')
  const minor = String(abs % 100).padStart(2, '0')
  return `${sign}${PREFIX[m.currency]}${major}.${minor}`
}

export function parseToMinor(input: string, currency: Currency): number {
  const cleaned = input.replace(/[,\s]/g, '')
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new Error(`Invalid ${currency} amount: "${input}"`)
  }
  const negative = cleaned.startsWith('-')
  const [major, minorRaw = ''] = cleaned.replace('-', '').split('.')
  const value = parseInt(major, 10) * 100 + parseInt((minorRaw + '00').slice(0, 2), 10)
  return negative ? -value : value
}
```

- [ ] Run: `npm run test`. Expected PASS: all money tests green.
- [ ] Delete the P0 wiring test, it has done its job: `rm tests/unit/vitest-wiring.test.ts`.
- [ ] Commit:

```bash
git add lib/money tests
git commit -m "feat(money): integer minor-unit format and parse"
```

## Task 3: Cairo dates (lib/dates/cairo.ts)

**Files:**
- Test: `lib/dates/cairo.test.ts`
- Create: `lib/dates/cairo.ts`

**Interfaces:**
- Consumes: nothing (Intl only; this is the ONLY module in the repo allowed to touch timezones).
- Produces (canonical, exact): `todayCairo(): string` ("YYYY-MM-DD"), `periodOf(date: string): string` ("YYYY-MM"), `dueDateFor(period: string, dueDay: number): string` (clamped to month end).

**Steps:**

- [ ] Write the failing test `lib/dates/cairo.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { dueDateFor, periodOf, todayCairo } from '@/lib/dates/cairo'

test('todayCairo returns YYYY-MM-DD', () => {
  expect(todayCairo()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
})

test('periodOf truncates to month', () => {
  expect(periodOf('2026-07-07')).toBe('2026-07')
})

describe('dueDateFor clamps min(due_day, last_day_of_month)', () => {
  test('normal day', () => expect(dueDateFor('2026-07', 15)).toBe('2026-07-15'))
  test('31 in a 30-day month', () => expect(dueDateFor('2026-04', 31)).toBe('2026-04-30'))
  test('30 in February (non-leap)', () => expect(dueDateFor('2026-02', 30)).toBe('2026-02-28'))
  test('30 in February (leap year)', () => expect(dueDateFor('2028-02', 30)).toBe('2028-02-29'))
  test('31 in a 31-day month is untouched', () => expect(dueDateFor('2026-08', 31)).toBe('2026-08-31'))
  test('day 1 always works', () => expect(dueDateFor('2026-02', 1)).toBe('2026-02-01'))
})
```

- [ ] Run: `npm run test`. Expected FAIL: `Failed to resolve import "@/lib/dates/cairo"`.
- [ ] Create `lib/dates/cairo.ts`:

```ts
// The only module allowed to touch timezones (spec §3).
const CAIRO = 'Africa/Cairo'

// en-CA formats as YYYY-MM-DD.
export function todayCairo(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function periodOf(date: string): string {
  return date.slice(0, 7)
}

export function dueDateFor(period: string, dueDay: number): string {
  const [year, month] = period.split('-').map(Number)
  // Day 0 of the next month = last day of this month. UTC so no TZ leakage.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const day = Math.min(dueDay, lastDay)
  return `${period}-${String(day).padStart(2, '0')}`
}
```

- [ ] Run: `npm run test`. Expected PASS.
- [ ] Commit:

```bash
git add lib/dates
git commit -m "feat(dates): cairo day boundaries and due-day clamping"
```

## Task 4: convert() via USD cross-rates (lib/currency/convert.ts)

**Files:**
- Test: `lib/currency/convert.test.ts`
- Create: `lib/currency/convert.ts`, `lib/currency/rates.ts` (interface only; `getRates()` lands in Task 5)

**Interfaces:**
- Consumes: `Currency` from `@/lib/money/money`.
- Produces (canonical, exact): `interface Rates { base: 'USD'; rates: Record<Currency, number>; fetchedAt: string }`; `function convert(amountMinor: number, from: Currency, to: Currency, rates: Rates): number` (round half-up). `convert` is pure and client-safe (P2's transfer form imports it in the browser).

**Steps:**

- [ ] Create `lib/currency/rates.ts` with just the shared interface (implementation is the next task):

```ts
import type { Currency } from '@/lib/money/money'

export interface Rates {
  base: 'USD'
  rates: Record<Currency, number>
  fetchedAt: string
}
```

- [ ] Write the failing test `lib/currency/convert.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { convert } from '@/lib/currency/convert'
import type { Rates } from '@/lib/currency/rates'

const rates: Rates = {
  base: 'USD',
  rates: { USD: 1, EUR: 0.92, EGP: 48.5 },
  fetchedAt: '2026-07-07T00:00:00.000Z',
}

describe('convert', () => {
  test('identity', () => {
    expect(convert(12345, 'EUR', 'EUR', rates)).toBe(12345)
  })
  test('USD to EUR (direct rate)', () => {
    expect(convert(10000, 'USD', 'EUR', rates)).toBe(9200)
  })
  test('EUR to EGP via USD cross-rate', () => {
    // 100.00 EUR / 0.92 = 108.695652 USD * 48.5 = 5271.73913 EGP -> 527174 minor
    expect(convert(10000, 'EUR', 'EGP', rates)).toBe(527174)
  })
  test('rounds half-up at exactly .5', () => {
    const r: Rates = { base: 'USD', rates: { USD: 1, EUR: 0.5, EGP: 1 }, fetchedAt: rates.fetchedAt }
    // 5 USD-minor * 0.5 = 2.5 -> 3
    expect(convert(5, 'USD', 'EUR', r)).toBe(3)
  })
  test('negative amounts round half away from zero', () => {
    const r: Rates = { base: 'USD', rates: { USD: 1, EUR: 0.5, EGP: 1 }, fetchedAt: rates.fetchedAt }
    expect(convert(-5, 'USD', 'EUR', r)).toBe(-3)
  })
  test('zero is zero', () => {
    expect(convert(0, 'EGP', 'EUR', rates)).toBe(0)
  })
})
```

- [ ] Run: `npm run test`. Expected FAIL: `Failed to resolve import "@/lib/currency/convert"`.
- [ ] Create `lib/currency/convert.ts`:

```ts
import type { Currency } from '@/lib/money/money'
import type { Rates } from './rates'

// Half-up on magnitude (half away from zero); Math.round misbehaves at -0.5.
function roundHalfUp(n: number): number {
  return n < 0 ? -Math.floor(-n + 0.5) : Math.floor(n + 0.5)
}

// One conversion, one rounding. Callers convert each per-currency total
// once, round half-up, then sum (spec §3) so dashboard and snapshots can
// never disagree by cents.
export function convert(
  amountMinor: number,
  from: Currency,
  to: Currency,
  rates: Rates,
): number {
  if (from === to) return amountMinor
  return roundHalfUp((amountMinor / rates.rates[from]) * rates.rates[to])
}
```

- [ ] Run: `npm run test`. Expected PASS.
- [ ] Commit:

```bash
git add lib/currency
git commit -m "feat(currency): convert via USD cross-rates, round half-up"
```

## Task 5: getRates() cache-first with last-good fallback (lib/currency/rates.ts)

**Files:**
- Test: `lib/currency/rates.test.ts`
- Modify: `lib/currency/rates.ts` (add `getRates()` under the interface from Task 4)

**Interfaces:**
- Consumes: `db` from `@/lib/db/client`, `exchangeRates` from `@/lib/db/schema`, `CURRENCIES` from `@/lib/money/money`.
- Produces (canonical, exact): `async function getRates(): Promise<Rates>`. Behavior: return the cached row if fresher than 24h; otherwise fetch `https://open.er-api.com/v6/latest/USD`, persist, return; on any fetch failure return the last-good cached row (which at worst is the migration seed).

**Steps:**

- [ ] Write the failing test `lib/currency/rates.test.ts` (mocks the db module and global fetch; the schema import inside rates.ts is harmless, pgTable definitions open no connection):

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { getRates } from '@/lib/currency/rates'

const mockDb = vi.hoisted(() => ({
  row: {
    base: 'USD',
    rates: { USD: 1, EUR: 0.92, EGP: 48.5 } as Record<string, number>,
    fetchedAt: new Date(),
  },
  updates: [] as { rates: Record<string, number>; fetchedAt: Date }[],
}))

vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({ from: () => Promise.resolve([mockDb.row]) }),
    update: () => ({
      set: (values: { rates: Record<string, number>; fetchedAt: Date }) => ({
        where: () => {
          mockDb.updates.push(values)
          mockDb.row = { ...mockDb.row, ...values }
          return Promise.resolve()
        },
      }),
    }),
  },
}))

const HOURS = 60 * 60 * 1000

describe('getRates', () => {
  beforeEach(() => {
    mockDb.updates.length = 0
    vi.restoreAllMocks()
  })

  test('cache-first: fresh row is returned without fetching', async () => {
    mockDb.row = { base: 'USD', rates: { USD: 1, EUR: 0.92, EGP: 48.5 }, fetchedAt: new Date() }
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const rates = await getRates()
    expect(rates).toEqual({
      base: 'USD',
      rates: { USD: 1, EUR: 0.92, EGP: 48.5 },
      fetchedAt: mockDb.row.fetchedAt.toISOString(),
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('stale row (>24h): fetches, persists only supported currencies, returns fresh', async () => {
    mockDb.row = {
      base: 'USD',
      rates: { USD: 1, EUR: 0.92, EGP: 48.5 },
      fetchedAt: new Date(Date.now() - 25 * HOURS),
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ result: 'success', rates: { USD: 1, EUR: 0.9, EGP: 50.1, JPY: 155 } }),
      ),
    )
    const rates = await getRates()
    expect(rates.rates).toEqual({ USD: 1, EUR: 0.9, EGP: 50.1 })
    expect(mockDb.updates).toHaveLength(1)
  })

  test('fetch failure: falls back to the last-good cached row, persists nothing', async () => {
    const staleDate = new Date(Date.now() - 25 * HOURS)
    mockDb.row = { base: 'USD', rates: { USD: 1, EUR: 0.92, EGP: 48.5 }, fetchedAt: staleDate }
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))
    const rates = await getRates()
    expect(rates.rates.EUR).toBe(0.92)
    expect(rates.fetchedAt).toBe(staleDate.toISOString())
    expect(mockDb.updates).toHaveLength(0)
  })

  test('non-200 response counts as failure', async () => {
    mockDb.row = {
      base: 'USD',
      rates: { USD: 1, EUR: 0.92, EGP: 48.5 },
      fetchedAt: new Date(Date.now() - 25 * HOURS),
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('oops', { status: 500 }))
    const rates = await getRates()
    expect(rates.rates.EGP).toBe(48.5)
    expect(mockDb.updates).toHaveLength(0)
  })
})
```

- [ ] Run: `npm run test`. Expected FAIL: `getRates is not a function` (rates.ts only exports the interface so far).
- [ ] Extend `lib/currency/rates.ts` to its full form:

```ts
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { exchangeRates } from '@/lib/db/schema'
import { CURRENCIES, type Currency } from '@/lib/money/money'

export interface Rates {
  base: 'USD'
  rates: Record<Currency, number>
  fetchedAt: string
}

const MAX_AGE_MS = 24 * 60 * 60 * 1000

// Cache-first: the single exchange_rates row (seeded by the initial
// migration) is the cache AND the last-good fallback.
export async function getRates(): Promise<Rates> {
  const [row] = await db.select().from(exchangeRates)
  const cached: Rates = {
    base: 'USD',
    rates: row.rates,
    fetchedAt: new Date(row.fetchedAt).toISOString(),
  }
  if (Date.now() - new Date(row.fetchedAt).getTime() < MAX_AGE_MS) return cached

  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD')
    if (!res.ok) throw new Error(`rates fetch failed: ${res.status}`)
    const body = (await res.json()) as { rates: Record<string, number> }
    const rates = Object.fromEntries(
      CURRENCIES.map((c) => [c, body.rates[c]]),
    ) as Record<Currency, number>
    const fetchedAt = new Date()
    await db.update(exchangeRates).set({ rates, fetchedAt }).where(eq(exchangeRates.base, 'USD'))
    return { base: 'USD', rates, fetchedAt: fetchedAt.toISOString() }
  } catch {
    // ponytail: last-good fallback; staleness surfaces as a UI label, not an error.
    return cached
  }
}
```

- [ ] Run: `npm run test`. Expected PASS: all four rates tests green.
- [ ] Commit:

```bash
git add lib/currency
git commit -m "feat(currency): getRates cache-first with 24h refresh and last-good fallback"
```

## Task 6: Derived balance queries (lib/db/queries.ts)

**Files:**
- Test: `lib/db/queries.test.ts`
- Create: `lib/db/queries.ts`

**Interfaces:**
- Consumes: `db`, `transactions` from Tasks 1/P0.
- Produces (canonical for `accountBalanceMinor`): `async function accountBalanceMinor(accountId: string): Promise<number>`; plus `async function totalsByCurrency(userId: string): Promise<Partial<Record<Currency, number>>>` and `async function archiveBlockers(accountId: string): Promise<string[]>` (P1 stub that later phases extend).

**Steps:**

- [ ] Write the failing test `lib/db/queries.test.ts`. The real logic worth testing here is the Postgres driver returning `SUM` as `string | null`; everything else is a thin query covered by the phase E2E:

```ts
import { expect, test, vi } from 'vitest'
import { accountBalanceMinor, totalsByCurrency } from '@/lib/db/queries'

const mockDb = vi.hoisted(() => ({
  balanceRows: [{ total: null }] as { total: string | null }[],
  groupedRows: [] as { currency: string; total: string | null }[],
}))

vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => {
          const p = Promise.resolve(mockDb.balanceRows) as Promise<
            { total: string | null }[]
          > & { groupBy: () => Promise<{ currency: string; total: string | null }[]> }
          p.groupBy = () => Promise.resolve(mockDb.groupedRows)
          return p
        },
      }),
    }),
  },
}))

test('empty account balance is 0 (SUM over no rows is NULL)', async () => {
  mockDb.balanceRows = [{ total: null }]
  expect(await accountBalanceMinor('any-id')).toBe(0)
})

test('balance coerces the SUM string to a number', async () => {
  mockDb.balanceRows = [{ total: '123456' }]
  expect(await accountBalanceMinor('any-id')).toBe(123456)
})

test('totalsByCurrency maps grouped rows', async () => {
  mockDb.groupedRows = [
    { currency: 'EUR', total: '85000' },
    { currency: 'EGP', total: '515000' },
  ]
  expect(await totalsByCurrency('user-1')).toEqual({ EUR: 85000, EGP: 515000 })
})
```

- [ ] Run: `npm run test`. Expected FAIL: `Failed to resolve import "@/lib/db/queries"`.
- [ ] Create `lib/db/queries.ts`:

```ts
import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { transactions } from '@/lib/db/schema'
import type { Currency } from '@/lib/money/money'

// Balances are always derived by summing transactions (spec §3).
// Postgres SUM comes back as string, or null over zero rows.
export async function accountBalanceMinor(accountId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string | null>`sum(${transactions.amountMinor})` })
    .from(transactions)
    .where(eq(transactions.accountId, accountId))
  return Number(row?.total ?? 0)
}

export async function totalsByCurrency(
  userId: string,
): Promise<Partial<Record<Currency, number>>> {
  const rows = await db
    .select({
      currency: transactions.currency,
      total: sql<string | null>`sum(${transactions.amountMinor})`,
    })
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .groupBy(transactions.currency)
  return Object.fromEntries(rows.map((r) => [r.currency, Number(r.total ?? 0)]))
}

// Names of active definitions still targeting this account; empty = archivable.
// ponytail: nothing can target an account until P3 (income sources), P4 (bills),
// P5 (installments). Those phases append their checks here; archiveAccount
// already enforces whatever this returns.
export async function archiveBlockers(accountId: string): Promise<string[]> {
  void accountId
  return []
}
```

- [ ] Run: `npm run test`. Expected PASS.
- [ ] Commit:

```bash
git add lib/db/queries.ts lib/db/queries.test.ts
git commit -m "feat(db): derived balance queries and archive-blocker stub"
```

## Task 7: Accounts server actions and screens

**Files:**
- Test: `e2e/accounts.spec.ts`
- Create: `lib/actions/accounts.ts`, `app/(app)/accounts/page.tsx`, `app/(app)/accounts/new/page.tsx`, `app/(app)/accounts/[id]/page.tsx`, `components/account-settings-form.tsx`
- Modify: `package.json` (add zod)

**Interfaces:**
- Consumes: `requireUser()`, `db`/`dbPool`, `accounts`/`transactions` schema, `parseToMinor`/`formatMoney`/`CURRENCIES`, `todayCairo()`, `accountBalanceMinor`, `archiveBlockers`.
- Produces: `createAccount`, `renameAccount`, `archiveAccount` server actions and `type ActionState = { error: string } | null`, the `useActionState`-shaped action signature every later mutation in the app follows.

**Steps:**

- [ ] Install zod (first use): `npm i zod`
- [ ] Write the failing E2E spec `e2e/accounts.spec.ts` (unique names per run; the dev DB persists between runs):

```ts
import { expect, test } from '@playwright/test'

test('create account with opening balance, rename, archive', async ({ page }) => {
  const name = `Main EUR ${Date.now()}`

  await page.goto('/accounts')
  await page.getByRole('link', { name: 'Add account' }).click()
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Currency').selectOption('EUR')
  await page.getByLabel('Opening balance').fill('1,234.56')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.waitForURL('/accounts')

  const row = page.getByRole('link', { name: new RegExp(name) })
  await expect(row).toContainText('€1,234.56')

  // rename
  await row.click()
  await page.getByLabel('Name').fill(`${name} renamed`)
  await page.getByRole('button', { name: 'Rename' }).click()
  await page.waitForURL('/accounts')
  await expect(page.getByText(`${name} renamed`)).toBeVisible()

  // archive (nothing targets accounts yet, so this always succeeds in P1)
  await page.getByRole('link', { name: new RegExp(name) }).click()
  await page.getByRole('button', { name: 'Archive account' }).click()
  await page.waitForURL('/accounts')
  await expect(page.getByText(`${name} renamed`)).not.toBeVisible()
})
```

- [ ] Run it: `npx playwright test e2e/accounts.spec.ts`. Expected FAIL: timeout on `getByRole('link', { name: 'Add account' })` (the page does not exist yet).
- [ ] Create `lib/actions/accounts.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '@/lib/auth/stack'
import { db, dbPool } from '@/lib/db/client'
import { accounts, transactions } from '@/lib/db/schema'
import { archiveBlockers } from '@/lib/db/queries'
import { todayCairo } from '@/lib/dates/cairo'
import { parseToMinor } from '@/lib/money/money'

// The shape every mutation in the app returns to useActionState.
export type ActionState = { error: string } | null

const createAccountSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  currency: z.enum(['EUR', 'USD', 'EGP']),
  openingBalance: z.string().trim(),
})

export async function createAccount(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser()
  const parsed = createAccountSchema.safeParse({
    name: formData.get('name'),
    currency: formData.get('currency'),
    openingBalance: formData.get('openingBalance') || '0',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  let openingMinor: number
  try {
    openingMinor = parseToMinor(parsed.data.openingBalance, parsed.data.currency)
  } catch {
    return { error: 'Opening balance is not a valid amount' }
  }

  // Account row + opening transaction must land together.
  await dbPool.transaction(async (tx) => {
    const [account] = await tx
      .insert(accounts)
      .values({
        userId: user.id,
        name: parsed.data.name,
        currency: parsed.data.currency,
      })
      .returning()
    if (openingMinor !== 0) {
      await tx.insert(transactions).values({
        userId: user.id,
        accountId: account.id,
        type: 'opening',
        amountMinor: openingMinor,
        currency: parsed.data.currency,
        occurredOn: todayCairo(),
        note: 'Opening balance',
      })
    }
  })
  revalidatePath('/accounts')
  redirect('/accounts')
}

const renameSchema = z.object({
  accountId: z.string().uuid(),
  name: z.string().trim().min(1, 'Name is required').max(100),
})

export async function renameAccount(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser()
  const parsed = renameSchema.safeParse({
    accountId: formData.get('accountId'),
    name: formData.get('name'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  await db
    .update(accounts)
    .set({ name: parsed.data.name })
    .where(and(eq(accounts.id, parsed.data.accountId), eq(accounts.userId, user.id)))
  revalidatePath('/accounts')
  redirect('/accounts')
}

export async function archiveAccount(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser()
  const parsed = z
    .object({ accountId: z.string().uuid() })
    .safeParse({ accountId: formData.get('accountId') })
  if (!parsed.success) return { error: 'Invalid account' }

  // Archiving is blocked while any active definition targets the account
  // (spec §3). archiveBlockers is a P1 stub returning []; P3/P4/P5 feed it.
  const blockers = await archiveBlockers(parsed.data.accountId)
  if (blockers.length > 0) {
    return { error: `Cannot archive: still targeted by ${blockers.join(', ')}` }
  }
  await db
    .update(accounts)
    .set({ archivedAt: new Date() })
    .where(and(eq(accounts.id, parsed.data.accountId), eq(accounts.userId, user.id)))
  revalidatePath('/accounts')
  redirect('/accounts')
}
```

- [ ] Create `app/(app)/accounts/page.tsx` (list with native balances):

```tsx
import Link from 'next/link'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { requireUser } from '@/lib/auth/stack'
import { db } from '@/lib/db/client'
import { accounts } from '@/lib/db/schema'
import { accountBalanceMinor } from '@/lib/db/queries'
import { formatMoney } from '@/lib/money/money'

export default async function AccountsPage() {
  const user = await requireUser()
  const rows = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, user.id), isNull(accounts.archivedAt)))
    .orderBy(asc(accounts.createdAt))
  const balances = await Promise.all(rows.map((a) => accountBalanceMinor(a.id)))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Accounts</h1>
        <Link
          href="/accounts/new"
          className="rounded bg-blue-600 px-3 py-2 text-sm text-white"
        >
          Add account
        </Link>
      </div>
      <ul className="divide-y rounded border">
        {rows.map((a, i) => (
          <li key={a.id}>
            <Link
              href={`/accounts/${a.id}`}
              className="flex items-center justify-between p-3"
            >
              <span>
                {a.name} <span className="text-xs text-gray-500">({a.currency})</span>
              </span>
              <span className="font-mono">
                {formatMoney({ amountMinor: balances[i], currency: a.currency })}
              </span>
            </Link>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="p-3 text-sm text-gray-500">No accounts yet.</li>
        )}
      </ul>
    </div>
  )
}
```

- [ ] Create `app/(app)/accounts/new/page.tsx` (client page; no server data needed):

```tsx
'use client'

import { useActionState } from 'react'
import { createAccount, type ActionState } from '@/lib/actions/accounts'
import { CURRENCIES } from '@/lib/money/money'

export default function NewAccountPage() {
  const [state, formAction] = useActionState<ActionState, FormData>(createAccount, null)
  return (
    <form action={formAction} className="space-y-4">
      <h1 className="text-xl font-semibold">New account</h1>
      <label className="block">
        <span className="text-sm">Name</span>
        <input name="name" required className="mt-1 w-full rounded border p-3" />
      </label>
      <label className="block">
        <span className="text-sm">Currency</span>
        <select name="currency" className="mt-1 w-full rounded border p-3">
          {CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-sm">Opening balance</span>
        <input
          name="openingBalance"
          inputMode="decimal"
          placeholder="0.00"
          className="mt-1 w-full rounded border p-3"
        />
      </label>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button className="w-full rounded bg-blue-600 py-3 text-white">
        Create account
      </button>
    </form>
  )
}
```

- [ ] Create `app/(app)/accounts/[id]/page.tsx` (server component loads the account, client form mutates):

```tsx
import { notFound } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { requireUser } from '@/lib/auth/stack'
import { db } from '@/lib/db/client'
import { accounts } from '@/lib/db/schema'
import { AccountSettingsForm } from '@/components/account-settings-form'

export default async function AccountPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireUser()
  const { id } = await params
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.userId, user.id)))
  if (!account) notFound()
  return (
    <AccountSettingsForm
      account={{ id: account.id, name: account.name, currency: account.currency }}
    />
  )
}
```

- [ ] Create `components/account-settings-form.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import {
  archiveAccount,
  renameAccount,
  type ActionState,
} from '@/lib/actions/accounts'

export function AccountSettingsForm({
  account,
}: {
  account: { id: string; name: string; currency: string }
}) {
  const [renameState, renameAction] = useActionState<ActionState, FormData>(
    renameAccount,
    null,
  )
  const [archiveState, archiveAction] = useActionState<ActionState, FormData>(
    archiveAccount,
    null,
  )
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">
        {account.name}{' '}
        <span className="text-sm text-gray-500">({account.currency})</span>
      </h1>
      <form action={renameAction} className="space-y-2">
        <input type="hidden" name="accountId" value={account.id} />
        <label className="block">
          <span className="text-sm">Name</span>
          <input
            name="name"
            defaultValue={account.name}
            required
            className="mt-1 w-full rounded border p-3"
          />
        </label>
        {renameState?.error && (
          <p className="text-sm text-red-600">{renameState.error}</p>
        )}
        <button className="w-full rounded bg-blue-600 py-3 text-white">Rename</button>
      </form>
      <form action={archiveAction} className="space-y-2">
        <input type="hidden" name="accountId" value={account.id} />
        {archiveState?.error && (
          <p className="text-sm text-red-600">{archiveState.error}</p>
        )}
        <button className="w-full rounded border border-red-600 py-3 text-red-600">
          Archive account
        </button>
      </form>
    </div>
  )
}
```

- [ ] Run the spec: `npx playwright test e2e/accounts.spec.ts`. Expected PASS: `2 passed` (setup + accounts flow).
- [ ] Commit:

```bash
git add lib/actions app/\(app\)/accounts components/account-settings-form.tsx e2e/accounts.spec.ts package.json package-lock.json
git commit -m "feat(accounts): create with opening transaction, rename, archive"
```

## Task 8: Settings lazy upsert and home-currency switch

**Files:**
- Test: `e2e/settings.spec.ts`
- Create: `lib/actions/settings.ts`, `app/(app)/settings/page.tsx`, `components/home-currency-form.tsx`
- Modify: `lib/db/queries.ts` (add `getSettings`), `app/(app)/more/page.tsx` (real links)

**Interfaces:**
- Consumes: `settings` schema, `requireUser()`, `ActionState` from Task 7.
- Produces: `getSettings(userId)` (lazy upsert, defaults `home_currency = 'EUR'`, `ai_enabled = true`) and the `setHomeCurrency` action; every aggregate view from here on reads `homeCurrency` through `getSettings`.

**Steps:**

- [ ] Write the failing E2E spec `e2e/settings.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

test('home currency defaults to EUR and is switchable', async ({ page }) => {
  await page.goto('/settings')
  await expect(page.getByLabel('Home currency')).toHaveValue('EUR')

  await page.getByLabel('Home currency').selectOption('EGP')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.goto('/')
  await expect(page.getByText('Total (EGP)')).toBeVisible()

  // restore so other specs see the default
  await page.goto('/settings')
  await page.getByLabel('Home currency').selectOption('EUR')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.goto('/')
  await expect(page.getByText('Total (EUR)')).toBeVisible()
})
```

Note: `Total (...)` is rendered by Task 9's dashboard; this spec goes green only after Task 9. Run it now for the red step, finish it there.

- [ ] Run it: `npx playwright test e2e/settings.spec.ts`. Expected FAIL: `/settings` 404s.
- [ ] Add `getSettings` to `lib/db/queries.ts`:

```ts
import { settings } from '@/lib/db/schema' // merge into the existing import block

// Lazy upsert on first authenticated read (spec §5.1). Defaults come from
// the schema: home_currency EUR, ai_enabled true.
export async function getSettings(userId: string) {
  const [inserted] = await db
    .insert(settings)
    .values({ userId })
    .onConflictDoNothing()
    .returning()
  if (inserted) return inserted
  const [existing] = await db.select().from(settings).where(eq(settings.userId, userId))
  return existing
}
```

Note: `getSettings` writes through `db` (neon-http). Single-statement upserts do not need the pool; `dbPool` stays reserved for multi-statement transactions.

- [ ] Create `lib/actions/settings.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '@/lib/auth/stack'
import { db } from '@/lib/db/client'
import { settings } from '@/lib/db/schema'
import { getSettings } from '@/lib/db/queries'
import type { ActionState } from './accounts'

export async function setHomeCurrency(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser()
  const parsed = z
    .object({ homeCurrency: z.enum(['EUR', 'USD', 'EGP']) })
    .safeParse({ homeCurrency: formData.get('homeCurrency') })
  if (!parsed.success) return { error: 'Pick a valid currency' }
  await getSettings(user.id) // ensure the row exists before updating
  await db
    .update(settings)
    .set({ homeCurrency: parsed.data.homeCurrency })
    .where(eq(settings.userId, user.id))
  revalidatePath('/')
  revalidatePath('/settings')
  return null
}
```

- [ ] Create `components/home-currency-form.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import type { ActionState } from '@/lib/actions/accounts'
import { setHomeCurrency } from '@/lib/actions/settings'
import { CURRENCIES, type Currency } from '@/lib/money/money'

export function HomeCurrencyForm({ current }: { current: Currency }) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    setHomeCurrency,
    null,
  )
  return (
    <form action={formAction} className="space-y-2">
      <label className="block">
        <span className="text-sm">Home currency</span>
        <select
          name="homeCurrency"
          defaultValue={current}
          className="mt-1 w-full rounded border p-3"
        >
          {CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button className="w-full rounded bg-blue-600 py-3 text-white">Save</button>
    </form>
  )
}
```

- [ ] Create `app/(app)/settings/page.tsx`:

```tsx
import { requireUser } from '@/lib/auth/stack'
import { getSettings } from '@/lib/db/queries'
import { HomeCurrencyForm } from '@/components/home-currency-form'

export default async function SettingsPage() {
  const user = await requireUser()
  const s = await getSettings(user.id)
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <HomeCurrencyForm current={s.homeCurrency} />
    </div>
  )
}
```

- [ ] Replace `app/(app)/more/page.tsx` so the tab reaches Accounts and Settings:

```tsx
import Link from 'next/link'

const LINKS = [
  { href: '/accounts', label: 'Accounts' },
  { href: '/settings', label: 'Settings' },
]

export default function MorePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">More</h1>
      <ul className="divide-y rounded border">
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="block p-4">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] Commit (the settings spec goes green after Task 9; commit the implementation now):

```bash
git add lib/actions/settings.ts lib/db/queries.ts app/\(app\)/settings app/\(app\)/more components/home-currency-form.tsx e2e/settings.spec.ts
git commit -m "feat(settings): lazy-upserted settings row and home-currency switch"
```

## Task 9: Dashboard placeholder with per-currency totals and combined at live rate

**Files:**
- Modify: `app/(app)/page.tsx` (replace the P0 placeholder)

**Interfaces:**
- Consumes: `getSettings`, `totalsByCurrency`, `getRates`, `convert`, `formatMoney`, `CURRENCIES`.
- Produces: the dashboard skeleton P2 extends (net worth headline slot, per-currency list, staleness label).

**Steps:**

- [ ] Replace `app/(app)/page.tsx`:

```tsx
import { requireUser } from '@/lib/auth/stack'
import { convert } from '@/lib/currency/convert'
import { getRates } from '@/lib/currency/rates'
import { getSettings, totalsByCurrency } from '@/lib/db/queries'
import { CURRENCIES, formatMoney } from '@/lib/money/money'

const DAY_MS = 24 * 60 * 60 * 1000

export default async function HomePage() {
  const user = await requireUser()
  const [s, totals, rates] = await Promise.all([
    getSettings(user.id),
    totalsByCurrency(user.id),
    getRates(),
  ])
  const home = s.homeCurrency
  // Convert each per-currency total once, round half-up, then sum (spec §3).
  const combined = CURRENCIES.reduce(
    (sum, c) => sum + convert(totals[c] ?? 0, c, home, rates),
    0,
  )
  const stale = Date.now() - new Date(rates.fetchedAt).getTime() > DAY_MS

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">My Ledger</h1>
      <section className="rounded border p-4">
        <p className="text-sm text-gray-500">Total ({home})</p>
        <p className="text-3xl font-bold">
          {formatMoney({ amountMinor: combined, currency: home })}
        </p>
        {stale && (
          <p className="text-xs text-amber-600">
            Rates from {new Date(rates.fetchedAt).toLocaleDateString('en-GB')} (stale)
          </p>
        )}
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-gray-500">Per currency</h2>
        <ul className="divide-y rounded border">
          {CURRENCIES.filter((c) => totals[c] !== undefined).map((c) => (
            <li key={c} className="flex justify-between p-3">
              <span>{c}</span>
              <span className="font-mono">
                {formatMoney({ amountMinor: totals[c]!, currency: c })}
              </span>
            </li>
          ))}
          {Object.keys(totals).length === 0 && (
            <li className="p-3 text-sm text-gray-500">
              No money tracked yet. Create an account to start.
            </li>
          )}
        </ul>
      </section>
    </div>
  )
}
```

- [ ] Run the settings spec (it asserts the `Total (...)` headline): `npx playwright test e2e/settings.spec.ts`. Expected PASS.
- [ ] Manual verification on a mobile viewport: dashboard shows one row per currency you hold, and the combined figure equals the per-currency totals converted at today's rate. The staleness label only appears when the rates row is older than 24h (simulate by setting `fetched_at` back with SQL and killing network access if you want to see it).
- [ ] Commit:

```bash
git add app/\(app\)/page.tsx
git commit -m "feat(dashboard): per-currency totals and combined total at live rate"
```

## Phase done

- [ ] `npm run lint && npm run format:check && npm run test && npm run build && npm run e2e` all green; paste the output as evidence. E2E expected: setup + shell + accounts + settings specs pass.
- [ ] Manual mobile-viewport walkthrough: create EUR and EGP accounts with opening balances, rename one, archive one, switch home currency, watch the dashboard combined figure change.
- [ ] Update [docs/wiki/status.md](../../wiki/status.md): P1 complete.

**Backlinks:** [Master index](README.md) | [Spec](../specs/2026-07-07-my-ledger-design.md) | Prev: [00-foundations.md](00-foundations.md) | Next: [02-transactions-and-balances.md](02-transactions-and-balances.md)

