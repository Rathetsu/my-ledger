# Phase 09: AI Advisor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

Backlinks: [Plans master index](../plans/README.md) | [Design spec](../specs/2026-07-07-my-ledger-design.md) | [AI advisor ADR (binding)](../../adr/2026-07-07-ai-advisor-contract.md) | Previous: [08-wishlist.md](08-wishlist.md) | Next: [10-cron-and-snapshots.md](10-cron-and-snapshots.md)

**Goal:** The plan screen shows an AI second opinion beside the deterministic plan: an anonymized payload goes to Gemini (`gemini-3-flash-preview` via `GEMINI_MODEL` env), the free-text reply is cached by a bucketed-payload hash, a "what gets sent" disclosure shows the exact payload, and the app degrades gracefully (null advice, clear message) whenever AI is disabled, unconfigured, rate-limited, or erroring.

**Architecture:** Three small modules under `lib/ai/`: `sanitize.ts` (PlanInput + PlanResult in, generic-label SanitizedPayload out, plus the bucketed sha256 cache key), `prompt.ts` (the verbatim prompt pack: system prompt, two few-shot examples, contents builder), and `advisor.ts` (`getAdvice`: settings gate, cache lookup, Gemini fetch, upsert, never throws). The browser talks only to our own `POST /api/ai/advice` route, which zod-validates the payload and calls `getAdvice`; that route is the seam Playwright intercepts in E2E, so no test ever reaches the real API.

**Tech Stack:** Next.js App Router + TypeScript + Tailwind, Neon + Drizzle, zod, `node:crypto` sha256, Gemini REST API (`generativelanguage.googleapis.com/v1beta`, verified July 2026: `x-goog-api-key` header, `contents` role turns, `generationConfig.temperature`, response `candidates[0].content.parts[].text`), Vitest, Playwright.

**Global Constraints** (from [plans README](../plans/README.md), verbatim):

- Money: integer minor units, currencies `EUR|USD|EGP`, round half-up, balances derived ([spec §3](../specs/2026-07-07-my-ledger-design.md)).
- No transaction converts currency; transfer legs mutate as a group; source-linked transactions mutate only via owning flow.
- Day boundaries `Africa/Cairo`; due-date clamp `min(due_day, last_day_of_month)`.
- Occurrences unique per (user, kind, source, period); confirms guard on `status IN ('pending','overdue')`; snapshots unique per (user, date).
- All mutations = zod-validated server actions + `revalidatePath`; every table has `user_id`.
- TDD: failing test → minimal code → pass → commit. Frequent small commits.
- The deterministic engine owns all numbers; the AI only quotes.

**Phase conventions:** unit tests colocated as `*.test.ts` next to source; E2E specs in `e2e/`; imports use the `@/` alias. Canonical interfaces consumed exactly as published in the README: `PlanInput`, `PlanResult` from `lib/planner/types` (P7), `Currency`, `CURRENCIES` from `lib/money/money` (P1), `requireUser` from `lib/auth` (P0), `db` from `lib/db/client` and tables from `lib/db/schema`.

---

### Task 1: `ai_advice_cache` table and migration

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `drizzle/` migration (generated)

**Interfaces:**
- Produces: `aiAdviceCache` Drizzle table: `user_id text PRIMARY KEY, payload_hash text NOT NULL, advice text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()`. One row per user, upserted (spec §4).

**Steps:**

- [ ] Add the table to `lib/db/schema.ts` (schema tasks carry no unit test; the generated SQL is the check):

```ts
export const aiAdviceCache = pgTable('ai_advice_cache', {
  userId: text('user_id').primaryKey(),
  payloadHash: text('payload_hash').notNull(),
  advice: text('advice').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

- [ ] Generate and inspect the migration: `pnpm drizzle-kit generate`. Expected: a new file under `drizzle/` containing `CREATE TABLE "ai_advice_cache"` with the four columns and `PRIMARY KEY` on `user_id`.
- [ ] Apply to the dev database: `pnpm drizzle-kit migrate`. Expected: exit 0.
- [ ] Add the phase env vars to `.env.example`:

```
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3-flash-preview
```

- [ ] Commit: `git add lib/db/schema.ts drizzle .env.example && git commit -m "feat(ai): ai_advice_cache table and gemini env vars"`

---

### Task 2: `sanitizePlanPayload` with anonymization tests

**Files:**
- Create: `lib/ai/sanitize.ts`
- Test: `lib/ai/sanitize.test.ts`

**Interfaces:**
- Consumes: `PlanInput`, `PlanResult` from `@/lib/planner/types` (canonical, P7); `Currency`, `CURRENCIES` from `@/lib/money/money` (P1).
- Produces: `sanitizePlanPayload(input: PlanInput, result: PlanResult): SanitizedPayload` (canonical) and the concrete `SanitizedPayload` type below. Also `seqLabel` (exported for tests).

`SanitizedPayload`, defined concretely. It contains generic sequential labels only (`debtA`, `debtB`, `installmentA`, `itemA`, and `category1`, `category2` if categories ever enter the payload; `PlanInput` today carries no category names, so exclusion is by construction), amounts as plain minor-unit numbers with currency codes, APRs, deadlines as `YYYY-MM`, surplus by month, payoff months, and funding gaps. It contains strictly NO account names, NO counterparty names, NO notes, NO category names, NO db ids, and NO funding-gap `suggestion` strings (those may mention account names). Rates are excluded too: the AI must not be able to "compute" conversions.

**Steps:**

- [ ] Write the failing test `lib/ai/sanitize.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { PlanInput, PlanResult } from '@/lib/planner/types'
import { sanitizePlanPayload, seqLabel } from './sanitize'

const RATES = {
  base: 'USD' as const,
  rates: { USD: 1, EUR: 0.9, EGP: 50 },
  fetchedAt: '2026-07-07T03:00:00.000Z',
}

const input: PlanInput = {
  homeCurrency: 'EUR',
  rates: RATES,
  horizonMonths: 24,
  monthlyIncomeMinor: { EUR: 250000 },
  billsMinor: { EGP: 1200000, EUR: 30000 },
  installments: [
    { name: 'iPhone 15 from Amr', monthlyMinor: 150000, currency: 'EGP', remainingCount: 5, apr: 32 },
  ],
  variableSpendMinor: { EGP: 800000 },
  debts: [
    { id: 'debt-uuid-1', name: 'Loan from Dad', balanceMinor: 3000000, currency: 'EGP', apr: 0, deadline: '2026-12-31' },
    { id: 'debt-uuid-2', name: 'CIB credit card', balanceMinor: 90000, currency: 'EUR', apr: 18, minPaymentMinor: 5000 },
  ],
  wishlist: [
    { id: 'wish-uuid-1', name: 'Herman Miller chair from OLX guy', costMinor: 120000, currency: 'EUR', priority: 1, targetDate: '2026-12-01' },
  ],
  accountBalancesMinor: { EUR: 340000, EGP: 9500000 },
}

const result: PlanResult = {
  months: [
    {
      period: '2026-07',
      debtPayments: [{ debtId: 'debt-uuid-2', amountMinor: 45000, currency: 'EUR' }],
      wishlistFunding: [],
      fundingGaps: [
        { currency: 'EGP', shortfallMinor: 950000, suggestion: 'Transfer from Revolut EUR to CIB EGP' },
      ],
    },
  ],
  debtPayoffPeriod: { 'debt-uuid-1': '2026-12', 'debt-uuid-2': '2026-08' },
  wishlistAffordablePeriod: { 'wish-uuid-1': '2027-01' },
  surplusMinorByMonth: { '2026-07': 65000, '2026-08': 65000 },
  spendEstimateSource: 'blend',
  highAprInstallmentFlags: ['iPhone 15 from Amr'],
}

describe('sanitizePlanPayload', () => {
  it('produces output containing no name, id, note, or suggestion string from the input', () => {
    const json = JSON.stringify(sanitizePlanPayload(input, result))
    for (const leaked of [
      'Loan from Dad', 'Dad', 'CIB credit card', 'CIB', 'iPhone', 'Amr',
      'Herman', 'OLX', 'Revolut', 'debt-uuid-1', 'debt-uuid-2', 'wish-uuid-1', 'Transfer from',
    ]) {
      expect(json).not.toContain(leaked)
    }
  })

  it('assigns sequential generic labels in input order', () => {
    const p = sanitizePlanPayload(input, result)
    expect(p.debts.map((d) => d.label)).toEqual(['debtA', 'debtB'])
    expect(p.installments.map((i) => i.label)).toEqual(['installmentA'])
    expect(p.wishlist.map((w) => w.label)).toEqual(['itemA'])
  })

  it('carries amounts, APRs, months, surplus, and funding gaps through untouched', () => {
    const p = sanitizePlanPayload(input, result)
    expect(p.homeCurrency).toBe('EUR')
    expect(p.monthlyIncomeMinor).toEqual({ EUR: 250000 })
    expect(p.debts[0]).toEqual({
      label: 'debtA', balanceMinor: 3000000, currency: 'EGP', apr: 0,
      deadline: '2026-12', payoffPeriod: '2026-12',
    })
    expect(p.debts[1].minPaymentMinor).toBe(5000)
    expect(p.wishlist[0].targetMonth).toBe('2026-12')
    expect(p.wishlist[0].affordablePeriod).toBe('2027-01')
    expect(p.surplusMinorByMonth).toEqual({ '2026-07': 65000, '2026-08': 65000 })
    expect(p.fundingGaps).toEqual([{ period: '2026-07', currency: 'EGP', shortfallMinor: 950000 }])
    expect(p.spendEstimateSource).toBe('blend')
  })

  it('maps highAprInstallmentFlags from names to labels', () => {
    const p = sanitizePlanPayload(input, result)
    expect(p.highAprInstallmentFlags).toEqual(['installmentA'])
  })

  it('excludes rates entirely', () => {
    expect(JSON.stringify(sanitizePlanPayload(input, result))).not.toContain('fetchedAt')
  })
})

describe('seqLabel', () => {
  it('runs A..Z then AA', () => {
    expect(seqLabel('debt', 0)).toBe('debtA')
    expect(seqLabel('debt', 25)).toBe('debtZ')
    expect(seqLabel('debt', 26)).toBe('debtAA')
  })
})
```

- [ ] Run `pnpm vitest run lib/ai/sanitize.test.ts`. Expected: FAIL (module `./sanitize` not found).
- [ ] Implement `lib/ai/sanitize.ts`:

```ts
import type { Currency } from '@/lib/money/money'
import { CURRENCIES } from '@/lib/money/money'
import type { PlanInput, PlanResult } from '@/lib/planner/types'

export interface SanitizedDebt {
  label: string
  balanceMinor: number
  currency: Currency
  apr: number
  deadline?: string // YYYY-MM
  minPaymentMinor?: number
  payoffPeriod: string | null // YYYY-MM
}

export interface SanitizedInstallment {
  label: string
  monthlyMinor: number
  currency: Currency
  remainingCount: number
  apr?: number
}

export interface SanitizedWishlistItem {
  label: string
  costMinor: number
  currency: Currency
  priority: number
  targetMonth?: string // YYYY-MM
  affordablePeriod: string | null // YYYY-MM
}

export interface SanitizedFundingGap {
  period: string // YYYY-MM
  currency: Currency
  shortfallMinor: number
}

export interface SanitizedPayload {
  homeCurrency: Currency
  horizonMonths: number
  spendEstimateSource: 'baseline' | 'blend'
  monthlyIncomeMinor: Partial<Record<Currency, number>>
  billsMinor: Partial<Record<Currency, number>>
  variableSpendMinor: Partial<Record<Currency, number>>
  accountBalancesMinor: Partial<Record<Currency, number>>
  installments: SanitizedInstallment[]
  debts: SanitizedDebt[]
  wishlist: SanitizedWishlistItem[]
  surplusMinorByMonth: Record<string, number>
  fundingGaps: SanitizedFundingGap[]
  highAprInstallmentFlags: string[] // sanitized installment labels, never names
}

// A, B, ..., Z, AA, AB, ... (bijective base 26)
export function seqLabel(prefix: string, index: number): string {
  let n = index
  let suffix = ''
  do {
    suffix = String.fromCharCode(65 + (n % 26)) + suffix
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return prefix + suffix
}

// Rebuild currency records in CURRENCIES order so JSON.stringify is deterministic for hashing.
function byCurrency(source: Partial<Record<Currency, number>>): Partial<Record<Currency, number>> {
  const out: Partial<Record<Currency, number>> = {}
  for (const c of CURRENCIES) {
    if (source[c] !== undefined) out[c] = source[c]
  }
  return out
}

export function sanitizePlanPayload(input: PlanInput, result: PlanResult): SanitizedPayload {
  const debts: SanitizedDebt[] = input.debts.map((d, i) => ({
    label: seqLabel('debt', i),
    balanceMinor: d.balanceMinor,
    currency: d.currency,
    apr: d.apr,
    ...(d.deadline ? { deadline: d.deadline.slice(0, 7) } : {}),
    ...(d.minPaymentMinor !== undefined ? { minPaymentMinor: d.minPaymentMinor } : {}),
    payoffPeriod: result.debtPayoffPeriod[d.id] ?? null,
  }))

  const installmentLabelByName = new Map(
    input.installments.map((inst, i) => [inst.name, seqLabel('installment', i)] as const),
  )
  const installments: SanitizedInstallment[] = input.installments.map((inst, i) => ({
    label: seqLabel('installment', i),
    monthlyMinor: inst.monthlyMinor,
    currency: inst.currency,
    remainingCount: inst.remainingCount,
    ...(inst.apr !== undefined ? { apr: inst.apr } : {}),
  }))

  const wishlist: SanitizedWishlistItem[] = input.wishlist.map((w, i) => ({
    label: seqLabel('item', i),
    costMinor: w.costMinor,
    currency: w.currency,
    priority: w.priority,
    ...(w.targetDate ? { targetMonth: w.targetDate.slice(0, 7) } : {}),
    affordablePeriod: result.wishlistAffordablePeriod[w.id] ?? null,
  }))

  // Funding gaps carry period + currency + shortfall only. The engine's free-text
  // `suggestion` may mention account names, so it never crosses this boundary.
  const fundingGaps: SanitizedFundingGap[] = result.months.flatMap((m) =>
    m.fundingGaps.map((g) => ({ period: m.period, currency: g.currency, shortfallMinor: g.shortfallMinor })),
  )

  return {
    homeCurrency: input.homeCurrency,
    horizonMonths: input.horizonMonths,
    spendEstimateSource: result.spendEstimateSource,
    monthlyIncomeMinor: byCurrency(input.monthlyIncomeMinor),
    billsMinor: byCurrency(input.billsMinor),
    variableSpendMinor: byCurrency(input.variableSpendMinor),
    accountBalancesMinor: byCurrency(input.accountBalancesMinor),
    installments,
    debts,
    wishlist,
    surplusMinorByMonth: result.surplusMinorByMonth,
    fundingGaps,
    highAprInstallmentFlags: result.highAprInstallmentFlags
      .map((name) => installmentLabelByName.get(name))
      .filter((label): label is string => label !== undefined),
  }
}
```

- [ ] Run `pnpm vitest run lib/ai/sanitize.test.ts`. Expected: PASS (6 tests).
- [ ] Commit: `git add lib/ai/sanitize.ts lib/ai/sanitize.test.ts && git commit -m "feat(ai): sanitizePlanPayload with generic labels and anonymization tests"`

---

### Task 3: bucketed cache key (`bucketMinor` + `cacheKey`)

**Files:**
- Modify: `lib/ai/sanitize.ts`
- Test: `lib/ai/sanitize.test.ts`

**Interfaces:**
- Produces: `bucketMinor(amountMinor: number): number` and `cacheKey(payload: SanitizedPayload): string` (sha256 hex).

The one concrete deterministic bucketing function, chosen and fixed: snap each amount to the nearest point on the geometric grid `1.05^n` (n integer), preserving sign, `0 → 0`. Every key whose name contains `Minor` is bucketed recursively before hashing (this catches `balanceMinor`, `costMinor`, `shortfallMinor`, and every value inside `monthlyIncomeMinor`, `surplusMinorByMonth`, etc.). Properties: changes under about 2.5% land in the same bucket (so the hash and cached advice hold), a 10% change moves at least one grid step (so advice regenerates). A tiny change that straddles a grid boundary may flip the bucket; the worst case is one extra API call, which is acceptable.

**Steps:**

- [ ] Append the failing tests to `lib/ai/sanitize.test.ts`:

```ts
import { bucketMinor, cacheKey } from './sanitize'

describe('bucketMinor', () => {
  it('maps a 1% change to the same bucket', () => {
    expect(bucketMinor(101000)).toBe(bucketMinor(100000))
  })
  it('maps a 10% change to a different bucket', () => {
    expect(bucketMinor(110000)).not.toBe(bucketMinor(100000))
  })
  it('handles zero and negatives', () => {
    expect(bucketMinor(0)).toBe(0)
    expect(bucketMinor(-100000)).toBe(-bucketMinor(100000))
  })
})

describe('cacheKey', () => {
  const base = sanitizePlanPayload(input, result)
  const withBalance = (balanceMinor: number) => ({
    ...base,
    debts: [{ ...base.debts[0], balanceMinor }, base.debts[1]],
  })

  it('is stable for identical payloads', () => {
    expect(cacheKey(base)).toBe(cacheKey(sanitizePlanPayload(input, result)))
  })
  it('is a 64-char sha256 hex string', () => {
    expect(cacheKey(base)).toMatch(/^[0-9a-f]{64}$/)
  })
  it('does not change for a small (1%) amount change', () => {
    expect(cacheKey(withBalance(3030000))).toBe(cacheKey(withBalance(3000000)))
  })
  it('changes for a 10% amount change', () => {
    expect(cacheKey(withBalance(3300000))).not.toBe(cacheKey(withBalance(3000000)))
  })
  it('changes when an APR changes', () => {
    const bumped = { ...base, debts: [{ ...base.debts[0], apr: 5 }, base.debts[1]] }
    expect(cacheKey(bumped)).not.toBe(cacheKey(base))
  })
})
```

- [ ] Run `pnpm vitest run lib/ai/sanitize.test.ts`. Expected: FAIL (`bucketMinor` is not exported).
- [ ] Add to `lib/ai/sanitize.ts` (top: `import { createHash } from 'node:crypto'`):

```ts
// Snap to the nearest point on the 1.05^n geometric grid. ~5% wide buckets:
// changes under ~2.5% keep the bucket, a 10% change always moves it.
export function bucketMinor(amountMinor: number): number {
  if (amountMinor === 0) return 0
  const sign = amountMinor < 0 ? -1 : 1
  const step = Math.log(1.05)
  const n = Math.round(Math.log(Math.abs(amountMinor)) / step)
  return sign * Math.round(Math.exp(n * step))
}

// Recursively bucket every number that lives under a key containing "Minor".
function bucketDeep(value: unknown, underMinor: boolean): unknown {
  if (typeof value === 'number') return underMinor ? bucketMinor(value) : value
  if (Array.isArray(value)) return value.map((v) => bucketDeep(v, underMinor))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, bucketDeep(v, underMinor || k.includes('Minor'))]),
    )
  }
  return value
}

export function cacheKey(payload: SanitizedPayload): string {
  return createHash('sha256').update(JSON.stringify(bucketDeep(payload, false))).digest('hex')
}
```

- [ ] Run `pnpm vitest run lib/ai/sanitize.test.ts`. Expected: PASS (all sanitize + bucket + cacheKey tests).
- [ ] Commit: `git add lib/ai/sanitize.ts lib/ai/sanitize.test.ts && git commit -m "feat(ai): 5% geometric bucketing and sha256 cache key"`

---

### Task 4: the prompt pack (`lib/ai/prompt.ts`)

**Files:**
- Create: `lib/ai/prompt.ts`
- Test: `lib/ai/prompt.test.ts`

**Interfaces:**
- Consumes: `SanitizedPayload` from `./sanitize`.
- Produces: `SYSTEM_PROMPT: string`, `FEW_SHOTS: { input: SanitizedPayload; output: string }[]`, `buildContents(payload: SanitizedPayload): { role: 'user' | 'model'; parts: { text: string }[] }[]`.

This prompt pack is the deliverable of the phase; treat it as code. It ships verbatim as written below. The few-shot inputs are typed `SanitizedPayload` so the compiler keeps the examples honest against the real payload shape.

**Steps:**

- [ ] Write the failing test `lib/ai/prompt.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { FEW_SHOTS, SYSTEM_PROMPT, buildContents } from './prompt'

describe('prompt pack', () => {
  it('states the engine-owns-numbers rule verbatim', () => {
    expect(SYSTEM_PROMPT).toContain(
      'You may quote only numbers present in the input. Never perform arithmetic, never invent figures. If you feel a number is missing, say so in words.',
    )
  })

  it('ships exactly two few-shot examples under 200 words each', () => {
    expect(FEW_SHOTS).toHaveLength(2)
    for (const shot of FEW_SHOTS) {
      expect(shot.output.trim().split(/\s+/).length).toBeLessThanOrEqual(200)
    }
  })

  it('few-shot outputs reference only generic labels', () => {
    for (const shot of FEW_SHOTS) {
      expect(shot.output).not.toMatch(/\b(salary|rent|loan|visa|bank)\b/i)
    }
  })

  it('buildContents interleaves shots then appends the live payload as the last user turn', () => {
    const payload = FEW_SHOTS[0].input
    const contents = buildContents(payload)
    expect(contents.map((c) => c.role)).toEqual(['user', 'model', 'user', 'model', 'user'])
    expect(contents[4].parts[0].text).toBe(JSON.stringify(payload))
  })
})
```

- [ ] Run `pnpm vitest run lib/ai/prompt.test.ts`. Expected: FAIL (module `./prompt` not found).
- [ ] Implement `lib/ai/prompt.ts` exactly as follows:

```ts
import type { SanitizedPayload } from './sanitize'

export const SYSTEM_PROMPT = `You are a careful personal finance advisor giving a second opinion on a deterministic payoff plan.

The user has a money app. Its planning engine already computed every number: balances, surpluses, payoff months, affordability months, funding gaps. You receive that data as a JSON object. Your job is to read it and give a short, human second opinion on the strategy. The engine's plan is the source of truth; you comment on it, you never replace it.

Rules you must never break:
1. You may quote only numbers present in the input. Never perform arithmetic, never invent figures. If you feel a number is missing, say so in words.
2. Amounts in the input are integer minor units (cents for EUR and USD, piastres for EGP). When you quote an amount you may restate it in major units by moving the decimal point two places left: 250000 EUR in the input becomes 2500.00 EUR in your reply. That decimal shift is the only transformation allowed. Adding, subtracting, multiplying, dividing, computing differences, percentages, or totals is forbidden.
3. Labels like debtA, installmentA, itemA are anonymized on purpose. Refer to them by these labels exactly. Never guess what they might really be, never invent names for them.
4. Never suggest specific payment amounts of your own. Suggestions are strategy only: ordering, timing, habits, what to watch.
5. Never present anything as a guaranteed outcome, and never give tax, legal, or investment advice.
6. If the data shows nothing noteworthy, say the plan looks reasonable and stop early. Do not pad.

Input shape: JSON with homeCurrency; horizonMonths; spendEstimateSource ("baseline" means a user guess, "blend" means grounded in measured spending); monthlyIncomeMinor, billsMinor, variableSpendMinor, accountBalancesMinor keyed by currency (minor units); installments (label, monthlyMinor, currency, remainingCount, apr); debts (label, balanceMinor, currency, apr, optional deadline YYYY-MM, optional minPaymentMinor, payoffPeriod YYYY-MM or null); wishlist (label, costMinor, currency, priority, optional targetMonth, affordablePeriod YYYY-MM or null); surplusMinorByMonth keyed by YYYY-MM; fundingGaps (period, currency, shortfallMinor); highAprInstallmentFlags (labels the engine flagged as expensive).

Output style: plain language, second person, at most 200 words, no greetings, no sign-off, no markdown headings, no reminders that you are an AI. Structure exactly:
- 1 to 2 sentences: your overall take.
- Up to 4 bullet observations, each grounded in a number or month from the input.
- At most 2 suggestions, phrased as strategy, never as amounts.`

const FEW_SHOT_1_INPUT: SanitizedPayload = {
  homeCurrency: 'EUR',
  horizonMonths: 24,
  spendEstimateSource: 'blend',
  monthlyIncomeMinor: { EUR: 250000 },
  billsMinor: { EUR: 80000 },
  variableSpendMinor: { EUR: 55000 },
  accountBalancesMinor: { EUR: 340000, EGP: 9500000 },
  installments: [
    { label: 'installmentA', monthlyMinor: 150000, currency: 'EGP', remainingCount: 5, apr: 0 },
  ],
  debts: [
    { label: 'debtA', balanceMinor: 3000000, currency: 'EGP', apr: 0, payoffPeriod: '2026-11' },
    { label: 'debtB', balanceMinor: 90000, currency: 'EUR', apr: 18, payoffPeriod: '2026-08' },
  ],
  wishlist: [
    { label: 'itemA', costMinor: 120000, currency: 'EUR', priority: 1, targetMonth: '2026-12', affordablePeriod: '2026-10' },
  ],
  surplusMinorByMonth: { '2026-07': 65000, '2026-08': 65000, '2026-09': 71000 },
  fundingGaps: [],
  highAprInstallmentFlags: [],
}

const FEW_SHOT_1_OUTPUT = `Overall this plan is healthy: a steady surplus, a sensible payoff order, and your wishlist target is met early.

- debtB carries 18% APR and the plan clears it first, by 2026-08. That is the right order.
- debtA sits at 0% APR, so carrying it until 2026-11 costs you nothing.
- Your monthly surplus of 650.00 EUR is stable and rises to 710.00 EUR by 2026-09.
- itemA becomes affordable in 2026-10, ahead of your 2026-12 target.

Two suggestions: keep every spare euro pointed at debtB until it is gone, since it is your only interest-bearing debt. And once debtB clears in 2026-08, take a moment before committing money to itemA; targets set months earlier are worth re-checking.`

const FEW_SHOT_2_INPUT: SanitizedPayload = {
  homeCurrency: 'EGP',
  horizonMonths: 24,
  spendEstimateSource: 'baseline',
  monthlyIncomeMinor: { USD: 180000 },
  billsMinor: { EGP: 1200000 },
  variableSpendMinor: { EGP: 800000 },
  accountBalancesMinor: { USD: 220000, EGP: 500000 },
  installments: [
    { label: 'installmentA', monthlyMinor: 250000, currency: 'EGP', remainingCount: 9, apr: 32 },
  ],
  debts: [
    { label: 'debtA', balanceMinor: 6000000, currency: 'EGP', apr: 0, deadline: '2026-10', payoffPeriod: '2026-10' },
  ],
  wishlist: [
    { label: 'itemA', costMinor: 4500000, currency: 'EGP', priority: 1, affordablePeriod: null },
  ],
  surplusMinorByMonth: { '2026-07': 350000, '2026-08': 350000 },
  fundingGaps: [{ period: '2026-07', currency: 'EGP', shortfallMinor: 950000 }],
  highAprInstallmentFlags: ['installmentA'],
}

const FEW_SHOT_2_OUTPUT = `This plan is under real pressure: your obligations land in EGP while your income arrives in USD, and the numbers show the strain.

- 2026-07 already has a funding gap of 9500.00 EGP, so money must move between currencies before then.
- installmentA is flagged at 32% APR with 9 payments left; it is by far your most expensive obligation.
- debtA meets its 2026-10 deadline exactly, with no slack.
- itemA never becomes affordable inside the horizon, so it is effectively on hold.

Your spend estimate is still the baseline you set, not measured spending, so treat the surplus figures as rough. Two suggestions: make converting part of each USD salary into EGP a monthly habit so funding gaps stop appearing, and treat installmentA as the first thing to renegotiate or clear early if any windfall arrives.`

export const FEW_SHOTS: { input: SanitizedPayload; output: string }[] = [
  { input: FEW_SHOT_1_INPUT, output: FEW_SHOT_1_OUTPUT },
  { input: FEW_SHOT_2_INPUT, output: FEW_SHOT_2_OUTPUT },
]

export function buildContents(
  payload: SanitizedPayload,
): { role: 'user' | 'model'; parts: { text: string }[] }[] {
  const contents: { role: 'user' | 'model'; parts: { text: string }[] }[] = []
  for (const shot of FEW_SHOTS) {
    contents.push({ role: 'user', parts: [{ text: JSON.stringify(shot.input) }] })
    contents.push({ role: 'model', parts: [{ text: shot.output }] })
  }
  contents.push({ role: 'user', parts: [{ text: JSON.stringify(payload) }] })
  return contents
}
```

- [ ] Run `pnpm vitest run lib/ai/prompt.test.ts`. Expected: PASS (4 tests).
- [ ] Commit: `git add lib/ai/prompt.ts lib/ai/prompt.test.ts && git commit -m "feat(ai): prompt pack with system prompt, guardrails, and two few-shot examples"`

---

### Task 5: `getAdvice` (`lib/ai/advisor.ts`)

**Files:**
- Create: `lib/ai/advisor.ts`
- Test: `lib/ai/advisor.test.ts`

**Interfaces:**
- Consumes: `cacheKey`, `SanitizedPayload` from `./sanitize`; `SYSTEM_PROMPT`, `buildContents` from `./prompt`; `requireUser` from `@/lib/auth`; `db` from `@/lib/db/client`; `settings`, `aiAdviceCache` from `@/lib/db/schema`.
- Produces: `getAdvice(payload: SanitizedPayload): Promise<string | null>` (canonical). `null` means unavailable; it NEVER throws to the page.

Behavior: no `GEMINI_API_KEY` → null. `settings.ai_enabled` false → null. Cache hit (stored `payload_hash` equals current bucketed key) → cached advice without any fetch. Miss → `POST https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent` with `x-goog-api-key` header (`GEMINI_MODEL` env, default `gemini-3-flash-preview`), `generationConfig.temperature: 0.3`; map `candidates[0].content.parts[].text`, upsert the single per-user cache row, return the text. Any error at all (429, network, malformed body) → null.

**Steps:**

- [ ] Write the failing test `lib/ai/advisor.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = {
  aiEnabled: true,
  cacheRow: null as { userId: string; payloadHash: string; advice: string } | null,
  upserts: [] as { userId: string; payloadHash: string; advice: string }[],
}

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ id: 'user-1' })),
}))

vi.mock('@/lib/db/client', async () => {
  const schema = await import('@/lib/db/schema')
  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: async () => {
            if (table === schema.settings) return [{ userId: 'user-1', aiEnabled: state.aiEnabled }]
            if (table === schema.aiAdviceCache) return state.cacheRow ? [state.cacheRow] : []
            return []
          },
        }),
      }),
      insert: () => ({
        values: (v: { userId: string; payloadHash: string; advice: string }) => ({
          onConflictDoUpdate: async () => {
            state.upserts.push(v)
          },
        }),
      }),
    },
  }
})

import { FEW_SHOTS } from './prompt'
import { cacheKey } from './sanitize'
import { getAdvice } from './advisor'

const payload = FEW_SHOTS[0].input

function geminiOk(text: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  } as unknown as Response
}

describe('getAdvice', () => {
  beforeEach(() => {
    state.aiEnabled = true
    state.cacheRow = null
    state.upserts = []
    vi.stubEnv('GEMINI_API_KEY', 'test-key')
    vi.stubEnv('GEMINI_MODEL', '')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('happy path: calls gemini, upserts cache, returns text', async () => {
    const fetchMock = vi.fn(async () => geminiOk('Solid plan overall.'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(getAdvice(payload)).resolves.toBe('Solid plan overall.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent',
    )
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key')
    const body = JSON.parse(String(init.body)) as {
      generationConfig: { temperature: number }
      contents: unknown[]
    }
    expect(body.generationConfig.temperature).toBe(0.3)
    expect(body.contents).toHaveLength(5)
    expect(state.upserts).toEqual([
      { userId: 'user-1', payloadHash: cacheKey(payload), advice: 'Solid plan overall.' },
    ])
  })

  it('respects GEMINI_MODEL override', async () => {
    vi.stubEnv('GEMINI_MODEL', 'gemini-4-flash')
    const fetchMock = vi.fn(async () => geminiOk('ok'))
    vi.stubGlobal('fetch', fetchMock)
    await getAdvice(payload)
    expect(String(fetchMock.mock.calls[0][0])).toContain('models/gemini-4-flash:generateContent')
  })

  it('cache hit returns stored advice and skips fetch', async () => {
    state.cacheRow = { userId: 'user-1', payloadHash: cacheKey(payload), advice: 'cached words' }
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(getAdvice(payload)).resolves.toBe('cached words')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stale cache (different hash) refetches', async () => {
    state.cacheRow = { userId: 'user-1', payloadHash: 'old-hash', advice: 'stale' }
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk('fresh advice')))
    await expect(getAdvice(payload)).resolves.toBe('fresh advice')
  })

  it('returns null without fetch when ai_enabled is false', async () => {
    state.aiEnabled = false
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(getAdvice(payload)).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns null without fetch when GEMINI_API_KEY is missing', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(getAdvice(payload)).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns null on 429', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }) as unknown as Response))
    await expect(getAdvice(payload)).resolves.toBeNull()
  })

  it('returns null on network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('ECONNRESET'))))
    await expect(getAdvice(payload)).resolves.toBeNull()
  })

  it('returns null on malformed response body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as unknown as Response))
    await expect(getAdvice(payload)).resolves.toBeNull()
  })
})
```

- [ ] Run `pnpm vitest run lib/ai/advisor.test.ts`. Expected: FAIL (module `./advisor` not found).
- [ ] Implement `lib/ai/advisor.ts`:

```ts
import { eq } from 'drizzle-orm'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { aiAdviceCache, settings } from '@/lib/db/schema'
import { SYSTEM_PROMPT, buildContents } from './prompt'
import { cacheKey, type SanitizedPayload } from './sanitize'

const DEFAULT_MODEL = 'gemini-3-flash-preview'

// null means "advisor unavailable". This function never throws to the page.
export async function getAdvice(payload: SanitizedPayload): Promise<string | null> {
  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return null

    const user = await requireUser()
    const [userSettings] = await db.select().from(settings).where(eq(settings.userId, user.id))
    if (!userSettings?.aiEnabled) return null

    const key = cacheKey(payload)
    const [cached] = await db.select().from(aiAdviceCache).where(eq(aiAdviceCache.userId, user.id))
    if (cached && cached.payloadHash === key) return cached.advice

    const model = process.env.GEMINI_MODEL || DEFAULT_MODEL
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: buildContents(payload),
          generationConfig: { temperature: 0.3 },
        }),
      },
    )
    if (!res.ok) return null

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[]
    }
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim()
    if (!text) return null

    await db
      .insert(aiAdviceCache)
      .values({ userId: user.id, payloadHash: key, advice: text })
      .onConflictDoUpdate({
        target: aiAdviceCache.userId,
        set: { payloadHash: key, advice: text, createdAt: new Date() },
      })
    return text
  } catch {
    return null
  }
}
```

- [ ] Run `pnpm vitest run lib/ai/advisor.test.ts`. Expected: PASS (9 tests).
- [ ] Commit: `git add lib/ai/advisor.ts lib/ai/advisor.test.ts && git commit -m "feat(ai): getAdvice with settings gate, cached hash, gemini call, null on any error"`

---

### Task 6: `POST /api/ai/advice` route

**Files:**
- Create: `app/api/ai/advice/route.ts`
- Test: `app/api/ai/advice/route.test.ts`

**Interfaces:**
- Consumes: `getAdvice` from `@/lib/ai/advisor`; `requireUser`; `db`, `aiAdviceCache`.
- Produces: `POST /api/ai/advice` with body `{ payload: SanitizedPayload, refresh?: boolean }` → `200 { advice: string | null }`, or `400` on invalid payload. `refresh: true` deletes the user's cache row first (manual refresh bypasses the cache).

Why a route instead of rendering advice on the server: `getAdvice` runs server-side, so the browser never talks to Gemini. This route is the only browser-visible seam, which keeps the plan page fast (advice loads after the plan) and gives Playwright a real interception point. The zod schema enforces generic labels (`debtA`, `installmentA`, `itemA`) by regex, so nothing named can even transit this boundary; the payload is the user's own already-anonymized plan data.

**Steps:**

- [ ] Write the failing test `app/api/ai/advice/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const deleted: string[] = []

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ id: 'user-1' })),
}))
vi.mock('@/lib/db/client', () => ({
  db: {
    delete: () => ({
      where: async () => {
        deleted.push('user-1')
      },
    }),
  },
}))
vi.mock('@/lib/ai/advisor', () => ({
  getAdvice: vi.fn(async () => 'advice text'),
}))

import { getAdvice } from '@/lib/ai/advisor'
import { FEW_SHOTS } from '@/lib/ai/prompt'
import { POST } from './route'

function post(body: unknown) {
  return POST(
    new Request('http://test/api/ai/advice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

describe('POST /api/ai/advice', () => {
  beforeEach(() => {
    deleted.length = 0
    vi.mocked(getAdvice).mockClear()
  })

  it('returns advice for a valid sanitized payload', async () => {
    const res = await post({ payload: FEW_SHOTS[0].input })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ advice: 'advice text' })
    expect(deleted).toHaveLength(0)
  })

  it('rejects a payload whose labels are not generic', async () => {
    const bad = {
      ...FEW_SHOTS[0].input,
      debts: [{ ...FEW_SHOTS[0].input.debts[0], label: 'Loan from Dad' }],
    }
    const res = await post({ payload: bad })
    expect(res.status).toBe(400)
    expect(getAdvice).not.toHaveBeenCalled()
  })

  it('rejects a non-JSON body', async () => {
    const res = await POST(new Request('http://test/api/ai/advice', { method: 'POST', body: 'not json' }))
    expect(res.status).toBe(400)
  })

  it('refresh: true clears the cache row before fetching', async () => {
    const res = await post({ payload: FEW_SHOTS[0].input, refresh: true })
    expect(res.status).toBe(200)
    expect(deleted).toEqual(['user-1'])
  })
})
```

- [ ] Run `pnpm vitest run app/api/ai/advice/route.test.ts`. Expected: FAIL (module `./route` not found).
- [ ] Implement `app/api/ai/advice/route.ts`:

```ts
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getAdvice } from '@/lib/ai/advisor'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { aiAdviceCache } from '@/lib/db/schema'

const currency = z.enum(['EUR', 'USD', 'EGP'])
const yyyyMm = z.string().regex(/^\d{4}-\d{2}$/)

const payloadSchema = z.object({
  homeCurrency: currency,
  horizonMonths: z.number().int().positive(),
  spendEstimateSource: z.enum(['baseline', 'blend']),
  monthlyIncomeMinor: z.record(currency, z.number().int()),
  billsMinor: z.record(currency, z.number().int()),
  variableSpendMinor: z.record(currency, z.number().int()),
  accountBalancesMinor: z.record(currency, z.number().int()),
  installments: z.array(
    z.object({
      label: z.string().regex(/^installment[A-Z]+$/),
      monthlyMinor: z.number().int(),
      currency,
      remainingCount: z.number().int(),
      apr: z.number().optional(),
    }),
  ),
  debts: z.array(
    z.object({
      label: z.string().regex(/^debt[A-Z]+$/),
      balanceMinor: z.number().int(),
      currency,
      apr: z.number(),
      deadline: yyyyMm.optional(),
      minPaymentMinor: z.number().int().optional(),
      payoffPeriod: yyyyMm.nullable(),
    }),
  ),
  wishlist: z.array(
    z.object({
      label: z.string().regex(/^item[A-Z]+$/),
      costMinor: z.number().int(),
      currency,
      priority: z.number(),
      targetMonth: yyyyMm.optional(),
      affordablePeriod: yyyyMm.nullable(),
    }),
  ),
  surplusMinorByMonth: z.record(yyyyMm, z.number().int()),
  fundingGaps: z.array(z.object({ period: yyyyMm, currency, shortfallMinor: z.number().int() })),
  highAprInstallmentFlags: z.array(z.string().regex(/^installment[A-Z]+$/)),
})

const bodySchema = z.object({ payload: payloadSchema, refresh: z.boolean().optional() })

export async function POST(req: Request) {
  const user = await requireUser()
  const raw = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return Response.json({ error: 'invalid payload' }, { status: 400 })
  }
  if (parsed.data.refresh) {
    await db.delete(aiAdviceCache).where(eq(aiAdviceCache.userId, user.id))
  }
  const advice = await getAdvice(parsed.data.payload)
  return Response.json({ advice })
}
```

- [ ] Run `pnpm vitest run app/api/ai/advice/route.test.ts`. Expected: PASS (4 tests).
- [ ] Commit: `git add app/api/ai/advice && git commit -m "feat(ai): zod-validated advice route with cache-bypassing refresh"`

---

### Task 7: AI panel on the plan screen + settings toggle

**Files:**
- Create: `components/ai-panel.tsx`
- Modify: `app/(app)/plan/page.tsx` (built in P7), `app/(app)/settings/page.tsx` (built in P1), `lib/actions/settings.ts` (built in P1)

**Interfaces:**
- Consumes: `sanitizePlanPayload` (Task 2); the plan page's existing `PlanInput`/`PlanResult`/settings values, all already in scope from P7.
- Produces: `AiPanel({ payload, aiEnabled }: { payload: SanitizedPayload; aiEnabled: boolean })` client component; `updateAiEnabled(formData: FormData)` server action.

Panel states: loading ("Asking the advisor..."), advice text, and the degraded state, which reads exactly: "AI advisor unavailable, your plan above is complete without it." shown when the route returns `advice: null`, on any fetch failure, or immediately (no request at all) when `ai_enabled` is false. The "what gets sent" disclosure is a native `<details>` element showing the exact sanitized JSON. The Refresh button re-posts with `refresh: true`, bypassing the cache.

**Steps:**

- [ ] Create `components/ai-panel.tsx`:

```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import type { SanitizedPayload } from '@/lib/ai/sanitize'

type PanelState =
  | { status: 'loading' }
  | { status: 'ready'; advice: string }
  | { status: 'unavailable' }

export function AiPanel({ payload, aiEnabled }: { payload: SanitizedPayload; aiEnabled: boolean }) {
  const [state, setState] = useState<PanelState>(
    aiEnabled ? { status: 'loading' } : { status: 'unavailable' },
  )

  const load = useCallback(
    async (refresh: boolean) => {
      setState({ status: 'loading' })
      try {
        const res = await fetch('/api/ai/advice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload, refresh }),
        })
        const data = res.ok ? ((await res.json()) as { advice: string | null }) : { advice: null }
        setState(data.advice ? { status: 'ready', advice: data.advice } : { status: 'unavailable' })
      } catch {
        setState({ status: 'unavailable' })
      }
    },
    [payload],
  )

  useEffect(() => {
    if (aiEnabled) void load(false)
  }, [aiEnabled, load])

  return (
    <section aria-label="AI second opinion" className="mt-6 rounded-lg border border-zinc-200 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">AI second opinion</h2>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={!aiEnabled || state.status === 'loading'}
          className="min-h-11 rounded px-3 text-sm underline disabled:opacity-40"
        >
          Refresh
        </button>
      </div>
      {state.status === 'loading' ? (
        <p className="mt-2 text-sm text-zinc-500">Asking the advisor...</p>
      ) : null}
      {state.status === 'ready' ? (
        <div className="mt-2 whitespace-pre-wrap text-sm">{state.advice}</div>
      ) : null}
      {state.status === 'unavailable' ? (
        <p className="mt-2 text-sm text-zinc-500">
          AI advisor unavailable, your plan above is complete without it.
        </p>
      ) : null}
      <details className="mt-4">
        <summary className="min-h-11 cursor-pointer py-2 text-sm text-zinc-600">What gets sent</summary>
        <pre
          data-testid="ai-payload"
          className="mt-2 overflow-x-auto rounded bg-zinc-100 p-2 text-xs"
        >
          {JSON.stringify(payload, null, 2)}
        </pre>
      </details>
    </section>
  )
}
```

- [ ] Wire it into `app/(app)/plan/page.tsx`. The P7 page already computes `input: PlanInput`, `result: PlanResult`, and the user's settings row; add below the algorithm plan rendering:

```tsx
import { AiPanel } from '@/components/ai-panel'
import { sanitizePlanPayload } from '@/lib/ai/sanitize'

// inside the page component, after buildPlan(input) produced `result`:
const sanitized = sanitizePlanPayload(input, result)

// at the bottom of the returned JSX, after the plan sections:
<AiPanel payload={sanitized} aiEnabled={userSettings.aiEnabled} />
```

- [ ] Add the `ai_enabled` toggle. In `lib/actions/settings.ts` append (all mutations zod-validated + `revalidatePath` per global constraints):

```ts
'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { settings } from '@/lib/db/schema'

const aiEnabledSchema = z.object({ aiEnabled: z.enum(['on']).optional() })

export async function updateAiEnabled(formData: FormData) {
  const user = await requireUser()
  const parsed = aiEnabledSchema.parse({ aiEnabled: formData.get('aiEnabled') ?? undefined })
  await db
    .update(settings)
    .set({ aiEnabled: parsed.aiEnabled === 'on' })
    .where(eq(settings.userId, user.id))
  revalidatePath('/settings')
  revalidatePath('/plan')
}
```

- [ ] In `app/(app)/settings/page.tsx`, add a section to the existing settings form area (the page already loads the settings row as `userSettings`):

```tsx
<section aria-label="AI advisor" className="mt-6">
  <h2 className="text-base font-semibold">AI advisor</h2>
  <form action={updateAiEnabled} className="mt-2 flex items-center gap-3">
    <label htmlFor="aiEnabled" className="flex min-h-11 items-center gap-2 text-sm">
      <input
        id="aiEnabled"
        name="aiEnabled"
        type="checkbox"
        defaultChecked={userSettings.aiEnabled}
        className="h-5 w-5"
      />
      Show an AI second opinion on the plan screen
    </label>
    <button type="submit" className="min-h-11 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white">
      Save
    </button>
  </form>
</section>
```

- [ ] Verify it compiles and renders: `pnpm build`. Expected: exit 0. Then `pnpm dev`, open `/plan` on a mobile viewport: panel shows either advice (if `GEMINI_API_KEY` set) or the degraded message; the disclosure opens and shows only generic labels; `/settings` toggle flips `ai_enabled` and the panel degrades when off.
- [ ] Commit: `git add components/ai-panel.tsx app/\(app\)/plan/page.tsx app/\(app\)/settings/page.tsx lib/actions/settings.ts && git commit -m "feat(ai): plan-screen AI panel with disclosure, refresh, degraded state, and settings toggle"`

---

### Task 8: E2E (Playwright, mocked Gemini seam)

**Files:**
- Create: `e2e/ai-advisor.spec.ts`

**Interfaces:**
- Consumes: the test auth project (email+password, P0), env `E2E_EMAIL` / `E2E_PASSWORD`; the `/plan`, `/debts` screens.

The Gemini call happens inside the Next.js server, so the browser never sees it; the browser-visible seam is our own `POST /api/ai/advice`, and that is what `page.route` intercepts. Belt and braces: the Playwright web server env must NOT define `GEMINI_API_KEY`, so even unintercepted requests can never reach the real API (the server just returns `advice: null`). Do not set `GEMINI_API_KEY` in the E2E environment.

**Steps:**

- [ ] Write `e2e/ai-advisor.spec.ts` (expected to FAIL until run against the app with Tasks 1-7 in place; run once before implementation review to see the failure, then after wiring to see it pass):

```ts
import { expect, test, type Page } from '@playwright/test'

async function signIn(page: Page) {
  await page.goto('/')
  if (await page.getByLabel('Email').isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.getByLabel('Email').fill(process.env.E2E_EMAIL!)
    await page.getByLabel('Password').fill(process.env.E2E_PASSWORD!)
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL('**/')
  }
}

async function ensureDebtExists(page: Page) {
  await page.goto('/debts')
  if (await page.getByText('Loan from Dad').isVisible({ timeout: 2000 }).catch(() => false)) return
  await page.getByRole('button', { name: /add debt/i }).click()
  await page.getByLabel('Name').fill('Loan from Dad')
  await page.getByLabel('Amount').fill('30000.00')
  await page.getByLabel('Currency').selectOption('EGP')
  await page.getByLabel('APR').fill('0')
  await page.getByRole('button', { name: /save/i }).click()
  await expect(page.getByText('Loan from Dad')).toBeVisible()
}

test.describe('AI advisor panel', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await ensureDebtExists(page)
  })

  test('renders mocked advice from the intercepted advice route', async ({ page }) => {
    await page.route('**/api/ai/advice', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          advice: 'Mocked second opinion: debtA at 0% APR is fine to hold until 2026-12.',
        }),
      })
    })
    await page.goto('/plan')
    await expect(page.getByText('Mocked second opinion')).toBeVisible()
  })

  test('disclosure shows the sanitized payload with no real names', async ({ page }) => {
    // No interception and no GEMINI_API_KEY: the server computes the real payload
    // and returns advice: null, exercising the actual sanitizer end to end.
    await page.goto('/plan')
    await page.getByText('What gets sent').click()
    const payloadText = await page.getByTestId('ai-payload').textContent()
    expect(payloadText).toContain('debtA')
    expect(payloadText).not.toContain('Loan from Dad')
    expect(payloadText).not.toContain('Dad')
  })

  test('shows the degraded state on a mocked 429', async ({ page }) => {
    await page.route('**/api/ai/advice', async (route) => {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'rate limited' }),
      })
    })
    await page.goto('/plan')
    await expect(
      page.getByText('AI advisor unavailable, your plan above is complete without it.'),
    ).toBeVisible()
  })
})
```

- [ ] Run `pnpm exec playwright test e2e/ai-advisor.spec.ts`. Expected: PASS (3 tests). If a selector misses, fix the screen's accessible name to match the domain vocabulary (CONTEXT.md), not the test.
- [ ] Commit: `git add e2e/ai-advisor.spec.ts && git commit -m "test(ai): e2e for mocked advice, sanitized disclosure, and 429 degradation"`

---

### Task 9: phase gate

**Files:**
- Modify: `docs/wiki/status.md`

**Steps:**

- [ ] Run the full unit suite: `pnpm test`. Expected: all green, including every earlier phase.
- [ ] Run the full E2E suite: `pnpm exec playwright test`. Expected: all green.
- [ ] Run the production build: `pnpm build`. Expected: exit 0.
- [ ] Manual mobile-viewport pass on `/plan`: advice or degraded message, disclosure, refresh, settings toggle.
- [ ] Update the P9 row in `docs/wiki/status.md` to `done`.
- [ ] Commit: `git add docs/wiki/status.md && git commit -m "docs(status): P9 AI advisor complete"`

---

Backlinks: [Plans master index](../plans/README.md) | [Design spec](../specs/2026-07-07-my-ledger-design.md) | Previous: [08-wishlist.md](08-wishlist.md) | Next: [10-cron-and-snapshots.md](10-cron-and-snapshots.md)
