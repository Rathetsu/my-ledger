# Phase 00: Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Backlinks:** [Master index](README.md) | [Spec](../specs/2026-07-07-my-ledger-design.md) | Prev: none (this is the first phase) | Next: [01-accounts-and-currency.md](01-accounts-and-currency.md)

**Goal:** A running, deployable Next.js skeleton in this repo: tooling (Prettier, Vitest, Playwright), Drizzle wired to Neon, Stack Auth, and a protected mobile bottom-tab shell, with the sign-in gate proven green by Playwright.

**Architecture:** Next.js App Router serves everything; Stack Auth guards an `(app)` route group that holds the four-tab mobile shell (Home, Ledger, Plan, More). Drizzle talks to Neon over `neon-http` for reads and a `neon-serverless` Pool for multi-step writes; migrations run inside the Vercel build command. No domain tables exist yet: P1 creates them, so the schema here is an empty baseline.

**Tech Stack:** Next.js (App Router, TypeScript, Tailwind, ESLint), Prettier, Vitest, Playwright, Drizzle ORM + drizzle-kit, `@neondatabase/serverless`, Stack Auth (`@stackframe/stack`), Vercel.

## Global Constraints

- Money: integer minor units, currencies `EUR|USD|EGP`, round half-up, balances derived ([spec §3](../specs/2026-07-07-my-ledger-design.md)).
- No transaction converts currency; transfer legs mutate as a group; source-linked transactions mutate only via owning flow.
- Day boundaries `Africa/Cairo`; due-date clamp `min(due_day, last_day_of_month)`.
- Occurrences unique per (user, kind, source, period); confirms guard on `status IN ('pending','overdue')`; snapshots unique per (user, date).
- All mutations = zod-validated server actions + `revalidatePath`; every table has `user_id`.
- TDD: failing test → minimal code → pass → commit. Frequent small commits.
- The deterministic engine owns all numbers; the AI only quotes.

## The two Stack Auth projects (read this before anything else)

Per the [auth ADR](../../adr/2026-07-07-nextjs-neon-drizzle-stackauth.md) there are **two** Stack Auth projects:

| Project | Sign-in methods | Used by |
|---|---|---|
| **prod** | Google **only** (toggle in the Stack dashboard) | Vercel production deployment |
| **test** | Email + password | Local dev and every Playwright run (Google blocks OAuth in automated browsers) |

The same three env vars select which project the app talks to. Local `.env.local` and CI carry the **test** project's keys; Vercel production env vars carry the **prod** project's keys:

```
NEXT_PUBLIC_STACK_PROJECT_ID
NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY
STACK_SECRET_SERVER_KEY
```

The Playwright suite signs in with `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD`, a user created once in the **test** project (Task 6 has the setup step). Never point Playwright at the prod project.

## Task 1: Scaffold Next.js into the existing repo

**Files:**
- Create: the full create-next-app output at the repo root (`app/`, `next.config.ts`, `tsconfig.json`, `package.json`, `eslint.config.mjs`, `postcss.config.mjs`, `app/globals.css`, `.gitignore`, `public/`)
- Preserve untouched: `docs/`, `CLAUDE.md`, `CONTEXT.md`, `INDEX.md`, `.git/`

**Interfaces:**
- Consumes: nothing (first task of the project).
- Produces: a working `npm run dev` / `npm run lint` / `npm run build` baseline every later task builds on; import alias `@/*` mapped to the repo root (no `src/` dir, so `lib/...` imports as `@/lib/...`).

The repo root already contains `docs/`, `CLAUDE.md`, `CONTEXT.md`, and `.git`. `create-next-app` refuses to scaffold into a directory containing files outside its conflict allowlist (`CLAUDE.md` and `CONTEXT.md` are not on it), so scaffold in a temp directory and move the output in. Newer create-next-app versions may also emit their own `AGENTS.md`/`CLAUDE.md`/`README.md`; delete those before moving so the repo's own `CLAUDE.md` is never clobbered.

**Steps:**

- [ ] Confirm the working tree is committed (`git status`), then scaffold in a temp dir:

```bash
REPO=/Users/ezzat/personal/projects/my-ledger   # adjust to your checkout
SCAFFOLD_DIR=$(mktemp -d)
cd "$SCAFFOLD_DIR"
npx create-next-app@latest scaffold \
  --typescript --tailwind --eslint --app --no-src-dir \
  --import-alias "@/*" --use-npm --disable-git --yes
```

Expected: `Success! Created scaffold at .../scaffold`.

- [ ] Strip files that must not overwrite repo files, then move everything in (exclude `node_modules`, reinstall in place):

```bash
cd "$SCAFFOLD_DIR/scaffold"
rm -f README.md CLAUDE.md AGENTS.md
rsync -a --exclude node_modules ./ "$REPO"/
cd "$REPO"
npm install
```

- [ ] If the repo already had a `.gitignore`, append the scaffold's entries instead of replacing it (this repo starts without one, so the scaffold's copy lands as-is). Verify `node_modules/` and `.next/` are ignored: `git status` must not list them.
- [ ] Verify the app boots and lints:

```bash
npm run dev &
sleep 5
curl -s http://localhost:3000 | grep -o '<title>[^<]*'
# expected: <title>Create Next App
kill %1
npm run lint
# expected: exit 0, no errors
```

- [ ] Commit:

```bash
git add -A
git commit -m "chore: scaffold Next.js app (TypeScript, Tailwind, App Router, ESLint)"
```

## Task 2: Prettier

**Files:**
- Create: `.prettierrc`, `.prettierignore`
- Modify: `package.json` (scripts, devDependencies), `eslint.config.mjs`

**Interfaces:**
- Consumes: the Task 1 scaffold.
- Produces: `npm run format` / `npm run format:check`; the code style every later code sample in these plans follows (no semicolons, single quotes).

**Steps:**

- [ ] Install:

```bash
npm i -D prettier eslint-config-prettier
```

- [ ] Create `.prettierrc`:

```json
{
  "semi": false,
  "singleQuote": true
}
```

- [ ] Create `.prettierignore`:

```
.next/
node_modules/
drizzle/
playwright-report/
test-results/
```

- [ ] Disable ESLint rules that fight Prettier by appending the prettier config as the last entry of the flat-config array in `eslint.config.mjs` (keep whatever the scaffold generated and add the two marked lines):

```js
import { FlatCompat } from '@eslint/eslintrc'
import eslintConfigPrettier from 'eslint-config-prettier/flat' // added

const compat = new FlatCompat({ baseDirectory: import.meta.dirname })

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  eslintConfigPrettier, // added, must stay last
]

export default eslintConfig
```

- [ ] Add scripts to `package.json`:

```json
"format": "prettier --write .",
"format:check": "prettier --check ."
```

- [ ] Run the formatter over the scaffold and verify:

```bash
npm run format
npm run format:check   # expected: All matched files use Prettier code style!
npm run lint           # expected: exit 0
```

- [ ] Commit:

```bash
git add -A
git commit -m "chore: add prettier with eslint integration"
```

## Task 3: Vitest

**Files:**
- Create: `vitest.config.ts`, `tests/unit/vitest-wiring.test.ts`
- Modify: `package.json` (scripts, devDependencies)

**Interfaces:**
- Consumes: Task 1 tsconfig alias `@/*`.
- Produces: `npm run test` (single run) and `npm run test:watch`; the runner every P1+ unit test uses. Test files live next to code (`lib/**/*.test.ts`) or under `tests/`.

**Steps:**

- [ ] Write the failing test first. Create `tests/unit/vitest-wiring.test.ts`:

```ts
import { expect, test } from 'vitest'

test('vitest is wired', () => {
  expect(1 + 1).toBe(2)
})
```

- [ ] Run it: `npm run test`. Expected FAIL: `npm error Missing script: "test"`.
- [ ] Install and configure:

```bash
npm i -D vitest
```

Create `vitest.config.ts` (alias must match tsconfig so `@/lib/...` imports resolve in tests):

```ts
import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'tests/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
```

Add scripts to `package.json`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] Run again: `npm run test`. Expected PASS: `Test Files  1 passed (1)`.
- [ ] Commit:

```bash
git add -A
git commit -m "chore: add vitest with @ alias"
```

## Task 4: Drizzle wired to Neon (empty schema baseline)

**Files:**
- Create: `drizzle.config.ts`, `lib/db/schema.ts`, `lib/db/client.ts`, `.env.example`, `vercel.json`
- Modify: `package.json` (scripts, dependencies)

**Interfaces:**
- Consumes: `DATABASE_URL` from the environment.
- Produces: `db` (neon-http, reads) and `dbPool` (neon-serverless Pool, multi-step writes) exported from `lib/db/client.ts`; `npm run db:generate` / `npm run db:migrate`. P1 fills `lib/db/schema.ts` with the real tables.

**Steps:**

- [ ] Install:

```bash
npm i drizzle-orm @neondatabase/serverless
npm i -D drizzle-kit dotenv
```

- [ ] Create `lib/db/schema.ts` (empty baseline; tables land in later phases):

```ts
// Drizzle schema. Empty baseline: P1 adds accounts, transactions,
// exchange_rates, settings; P3+ add the rest (spec §4).
export {}
```

- [ ] Create `drizzle.config.ts`. drizzle-kit does not load `.env.local` on its own, so load it explicitly (all local secrets live in `.env.local`, which the scaffold's `.gitignore` already ignores):

```ts
import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

config({ path: '.env.local' })

export default defineConfig({
  dialect: 'postgresql',
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL! },
})
```

- [ ] Create `lib/db/client.ts`:

```ts
import { neon, Pool } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { drizzle as drizzlePool } from 'drizzle-orm/neon-serverless'
import * as schema from './schema'

// Reads: one-shot HTTP queries, cheapest on serverless.
const sql = neon(process.env.DATABASE_URL!)
export const db = drizzle(sql, { schema })

// Multi-step writes needing a real DB transaction (opening balances,
// transfer legs, confirms) go through the WebSocket pool.
const pool = new Pool({ connectionString: process.env.DATABASE_URL! })
export const dbPool = drizzlePool(pool, { schema })
```

- [ ] Create `.env.example` (every env var the app will ever need; copy to `.env.local` and fill in):

```bash
# --- Database (Neon Postgres) ---
# Pooled connection string from the Neon dashboard. Use a dev branch locally.
DATABASE_URL=

# --- Stack Auth ---
# TWO Stack projects exist (see the auth ADR):
#   prod: Google sign-in ONLY  -> keys live in Vercel production env vars
#   test: email + password     -> keys live here and in CI (dev + Playwright)
# These three vars select which project the app talks to.
NEXT_PUBLIC_STACK_PROJECT_ID=
NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=
STACK_SECRET_SERVER_KEY=

# --- Cron (P10) ---
# Random secret; /api/cron/daily requires "Authorization: Bearer $CRON_SECRET".
CRON_SECRET=

# --- AI advisor (P9) ---
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3-flash-preview

# --- Playwright E2E (a user created once in the TEST Stack project) ---
E2E_TEST_EMAIL=
E2E_TEST_PASSWORD=
```

- [ ] Create `vercel.json` documenting the build command (migrations run at build time per the stack ADR; P10 adds the cron entry to this same file):

```json
{
  "buildCommand": "drizzle-kit migrate && next build"
}
```

- [ ] Add scripts to `package.json`:

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate"
```

- [ ] Manual setup: create a Neon project (dashboard or Neon MCP), copy the pooled connection string into `.env.local` as `DATABASE_URL`.
- [ ] Verify the wiring end to end:

```bash
npm run db:generate
# expected: "No schema changes, nothing to generate" (schema is an empty baseline)
npm run db:migrate
# expected: exits 0 against the Neon dev database (no migrations to apply yet)
npm run build
# expected: production build succeeds
```

- [ ] Commit:

```bash
git add -A
git commit -m "chore: wire drizzle + neon (empty schema), env template, vercel build command"
```

## Task 5: Stack Auth wiring

**Files:**
- Create: `lib/auth/stack.ts`, `app/handler/[...stack]/page.tsx`
- Modify: `app/layout.tsx`, `package.json` (dependencies)

**Interfaces:**
- Consumes: the three `*STACK*` env vars (test project locally).
- Produces: `stackServerApp` and `requireUser()` from `lib/auth/stack.ts`; every P1+ server action and protected page calls `requireUser()` and uses `user.id` as `user_id`.

**Steps:**

- [ ] Install:

```bash
npm i @stackframe/stack server-only
```

- [ ] Manual setup: in the Stack dashboard create the two projects if they do not exist yet: **prod** with Google as the only enabled sign-in method, **test** with email+password enabled. Copy the **test** project's three keys into `.env.local`.
- [ ] Create `lib/auth/stack.ts`:

```ts
import 'server-only'
import { StackServerApp } from '@stackframe/stack'

export const stackServerApp = new StackServerApp({
  tokenStore: 'nextjs-cookie',
})

// Redirects to /handler/sign-in when unauthenticated.
export async function requireUser() {
  return stackServerApp.getUser({ or: 'redirect' })
}
```

- [ ] Create `app/handler/[...stack]/page.tsx` (Stack renders sign-in, sign-up, account settings, etc. under /handler/*):

```tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import { StackHandler } from '@stackframe/stack'
import { stackServerApp } from '@/lib/auth/stack'

export default function Handler(props: any) {
  return <StackHandler fullPage app={stackServerApp} routeProps={props} />
}
```

- [ ] Modify `app/layout.tsx` to wrap the app in StackProvider + StackTheme (keep the scaffold's font setup; full file shown):

```tsx
import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { StackProvider, StackTheme } from '@stackframe/stack'
import { stackServerApp } from '@/lib/auth/stack'
import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'My Ledger',
  description: 'Personal money ledger',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <StackProvider app={stackServerApp}>
          <StackTheme>{children}</StackTheme>
        </StackProvider>
      </body>
    </html>
  )
}
```

- [ ] Verify manually: `npm run dev`, open `http://localhost:3000/handler/sign-in`. Expected: Stack's sign-in page with email and password fields (test project). No Google button here; that is the prod project's config.
- [ ] Commit:

```bash
git add -A
git commit -m "feat: stack auth wiring (server singleton, provider, handler route)"
```

## Task 6: Protected (app) route group with bottom-tab shell

**Files:**
- Create: `app/(app)/layout.tsx`, `app/(app)/page.tsx`, `app/(app)/transactions/page.tsx`, `app/(app)/plan/page.tsx`, `app/(app)/more/page.tsx`, `components/bottom-tabs.tsx`
- Delete: `app/page.tsx` (the scaffold landing page; the Home placeholder replaces it inside the group)

**Interfaces:**
- Consumes: `requireUser()` from Task 5.
- Produces: the `(app)` route group every later screen lives in; tab routes `/` (Home), `/transactions` (Ledger), `/plan` (Plan), `/more` (More).

**Steps:**

- [ ] Delete the scaffold landing page: `rm app/page.tsx` (route groups do not change URLs, so `app/(app)/page.tsx` will serve `/`).
- [ ] Create `components/bottom-tabs.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/', label: 'Home' },
  { href: '/transactions', label: 'Ledger' },
  { href: '/plan', label: 'Plan' },
  { href: '/more', label: 'More' },
]

export function BottomTabs() {
  const pathname = usePathname()
  return (
    <nav className="fixed inset-x-0 bottom-0 border-t bg-white">
      <ul className="flex">
        {TABS.map((t) => {
          const active =
            t.href === '/' ? pathname === '/' : pathname.startsWith(t.href)
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                className={`block py-3 text-center text-sm ${
                  active ? 'font-semibold text-blue-600' : 'text-gray-500'
                }`}
              >
                {t.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
```

- [ ] Create `app/(app)/layout.tsx` (the auth gate: every page in the group sits behind `requireUser()`):

```tsx
import { requireUser } from '@/lib/auth/stack'
import { BottomTabs } from '@/components/bottom-tabs'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireUser()
  return (
    <div className="min-h-dvh pb-16">
      <main className="mx-auto max-w-md p-4">{children}</main>
      <BottomTabs />
    </div>
  )
}
```

- [ ] Create the four placeholder pages. `app/(app)/page.tsx`:

```tsx
export default function HomePage() {
  return <h1 className="text-xl font-semibold">My Ledger</h1>
}
```

`app/(app)/transactions/page.tsx`:

```tsx
export default function TransactionsPage() {
  return <h1 className="text-xl font-semibold">Ledger</h1>
}
```

`app/(app)/plan/page.tsx`:

```tsx
export default function PlanPage() {
  return <h1 className="text-xl font-semibold">Plan</h1>
}
```

`app/(app)/more/page.tsx`:

```tsx
export default function MorePage() {
  return <h1 className="text-xl font-semibold">More</h1>
}
```

- [ ] Manual setup for E2E (once): open `http://localhost:3000/handler/sign-up` against the test project and register the E2E user; put the same credentials in `.env.local` as `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD`.
- [ ] Verify manually: in a private browser window, `http://localhost:3000/` redirects to `/handler/sign-in`; after signing in with the E2E user, `/` shows "My Ledger" plus the four tabs, and tapping each tab navigates.
- [ ] Commit:

```bash
git add -A
git commit -m "feat: protected (app) route group with bottom-tab shell"
```

## Task 7: Playwright E2E (the phase gate)

**Files:**
- Create: `playwright.config.ts`, `e2e/auth.setup.ts`, `e2e/unauth.spec.ts`, `e2e/shell.spec.ts`
- Modify: `package.json` (scripts, devDependencies), `.gitignore`

**Interfaces:**
- Consumes: the shell from Task 6; `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD` from `.env.local` (test Stack project).
- Produces: `npm run e2e`; the `setup` project + `storageState` login helper every later phase's specs reuse (authenticated specs just start at `page.goto('/...')`).

**Steps:**

- [ ] Install:

```bash
npm i -D @playwright/test
npx playwright install chromium
```

- [ ] Create `playwright.config.ts` (mobile viewport everywhere; the app is mobile-first):

```ts
import { defineConfig, devices } from '@playwright/test'
import { config } from 'dotenv'

config({ path: '.env.local' })

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'unauth',
      testMatch: /unauth\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'app',
      testIgnore: /unauth\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Pixel 7'], storageState: 'e2e/.auth/user.json' },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
})
```

- [ ] Create the login helper `e2e/auth.setup.ts` (signs in once against the TEST Stack project, saves cookies as storageState for the whole `app` project):

```ts
import { expect, test as setup } from '@playwright/test'

const authFile = 'e2e/.auth/user.json'

setup('authenticate with the test Stack project', async ({ page }) => {
  await page.goto('/handler/sign-in')
  await page.locator('input[type="email"]').fill(process.env.E2E_TEST_EMAIL!)
  await page
    .locator('input[type="password"]')
    .fill(process.env.E2E_TEST_PASSWORD!)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL('/')
  await expect(page.getByRole('link', { name: 'Home' })).toBeVisible()
  await page.context().storageState({ path: authFile })
})
```

If Stack's sign-in DOM differs from these selectors (it is a third-party page), run `npx playwright codegen http://localhost:3000/handler/sign-in` once and fix the two locators; everything else stays.

- [ ] Create `e2e/unauth.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

test('unauthenticated visitor is redirected to sign-in', async ({ page }) => {
  await page.goto('/')
  await page.waitForURL(/\/handler\/sign-in/)
  await expect(page.locator('input[type="email"]')).toBeVisible()
})
```

- [ ] Create `e2e/shell.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

test('authenticated user sees the bottom-tab shell', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Ledger' })).toBeVisible()
  for (const tab of ['Home', 'Ledger', 'Plan', 'More']) {
    await expect(page.getByRole('link', { name: tab })).toBeVisible()
  }
})
```

- [ ] Append to `.gitignore`:

```
# playwright
/test-results/
/playwright-report/
/e2e/.auth/
```

- [ ] Add the script to `package.json`:

```json
"e2e": "playwright test"
```

- [ ] Run the gate: `npm run e2e`. Expected PASS: `3 passed` (setup + unauth redirect + authenticated shell). These specs come after their implementation tasks on purpose: they are the phase gate, not the unit-level red-green loop.
- [ ] Commit:

```bash
git add -A
git commit -m "test: playwright e2e gate (sign-in redirect, authenticated shell)"
```

## Phase done

- [ ] `npm run lint && npm run format:check && npm run test && npm run build && npm run e2e` all green; paste the output as evidence.
- [ ] Manual mobile-viewport walkthrough: sign in, tap all four tabs.
- [ ] Deployment note (no code): on Vercel the committed `vercel.json` sets the build command (`drizzle-kit migrate && next build`); set production env vars to the **prod** Stack project keys + production `DATABASE_URL` + `CRON_SECRET`. Dev and Playwright keep the **test** project keys.
- [ ] Update [docs/wiki/status.md](../../wiki/status.md): P0 complete.

**Backlinks:** [Master index](README.md) | [Spec](../specs/2026-07-07-my-ledger-design.md) | Prev: none (first phase) | Next: [01-accounts-and-currency.md](01-accounts-and-currency.md)
