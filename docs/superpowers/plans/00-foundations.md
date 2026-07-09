# Phase 00: Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Backlinks:** [Master index](README.md) | [Spec](../specs/2026-07-07-my-ledger-design.md) | Prev: none (this is the first phase) | Next: [01-accounts-and-currency.md](01-accounts-and-currency.md)

**Goal:** A running, deployable Next.js skeleton in this repo: tooling (Prettier, Vitest, Playwright), Drizzle wired to Neon, Better Auth (email+password), and a protected mobile bottom-tab shell, with the sign-in gate proven green by Playwright.

**Architecture:** Next.js App Router serves everything; self-hosted Better Auth (email+password) guards an `(app)` route group that holds the four-tab mobile shell (Home, Ledger, Plan, More). Drizzle talks to Neon over `neon-http` for reads and a `neon-serverless` Pool for multi-step writes (Better Auth's adapter uses the Pool); migrations run inside the Vercel build command. No domain tables exist yet beyond Better Auth's own: P1 creates the rest, so the app schema here is an empty baseline.

**Tech Stack:** Next.js (App Router, TypeScript, Tailwind, ESLint), Prettier, Vitest, Playwright, Drizzle ORM + drizzle-kit, `@neondatabase/serverless`, Better Auth (`better-auth`), Vercel.

## Global Constraints

- Money: integer minor units, currencies `EUR|USD|EGP`, round half-up, balances derived ([spec §3](../specs/2026-07-07-my-ledger-design.md)).
- No transaction converts currency; transfer legs mutate as a group; source-linked transactions mutate only via owning flow.
- Day boundaries `Africa/Cairo`; due-date clamp `min(due_day, last_day_of_month)`.
- Occurrences unique per (user, kind, source, period); confirms guard on `status IN ('pending','overdue')`; snapshots unique per (user, date).
- All mutations = zod-validated server actions + `revalidatePath`; every table has `user_id`.
- TDD: failing test → minimal code → pass → commit. Frequent small commits.
- The deterministic engine owns all numbers; the AI only quotes.

## Auth: self-hosted Better Auth, email + password (read this before Task 5)

Per the [auth ADR](../../adr/2026-07-09-better-auth-email-password.md), auth is **self-hosted Better Auth** with **email + password only** (no Google, no Stack Auth). There is ONE auth configuration for local dev, Playwright, and production; auth tables live in our own Neon DB via Drizzle. Open sign-up is gated by `ALLOW_SIGNUP` (default off): register the single user once with `ALLOW_SIGNUP=true`, then turn it off in production.

Env vars (already in `.env.example`; local `.env.local` has real values):

```
BETTER_AUTH_SECRET      # openssl rand -base64 32
BETTER_AUTH_URL         # http://localhost:3000 locally; deployed origin in prod
ALLOW_SIGNUP            # true to allow registration (dev + E2E); unset/false in prod
```

The Playwright suite registers then signs in `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD` against the app's own `/sign-up` and `/sign-in` pages (Task 7). No third-party auth service, no prod/test project split.

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

# --- Better Auth (self-hosted, email + password only) ---
BETTER_AUTH_SECRET=          # openssl rand -base64 32
BETTER_AUTH_URL=http://localhost:3000
# Gate open sign-up: true to register the single user (dev + E2E); unset/false in prod.
ALLOW_SIGNUP=false

# --- Cron (P10) ---
# Random secret; /api/cron/daily requires "Authorization: Bearer $CRON_SECRET".
CRON_SECRET=

# --- AI advisor (P9) ---
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3-flash-preview

# --- Playwright E2E (email+password user; the E2E setup registers it when ALLOW_SIGNUP=true) ---
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

## Task 5: Better Auth wiring (email + password)

**Files:**
- Create: `lib/auth.ts`, `lib/auth-client.ts`, `app/api/auth/[...all]/route.ts`, `lib/db/auth-schema.ts` (generated by the Better Auth CLI)
- Modify: `lib/db/schema.ts` (re-export the generated auth tables), `package.json` (dependency), the `drizzle/` migration output

**Interfaces:**
- Consumes: `db`/`dbPool` from `lib/db/client.ts` (Task 4); the `BETTER_AUTH_*` and `ALLOW_SIGNUP` env vars.
- Produces: `auth` (the Better Auth server instance) and `requireUser()` from `lib/auth.ts`; `authClient` (+ `signIn`/`signUp`/`signOut`/`useSession`) from `lib/auth-client.ts`. Every P1+ server action and protected page calls `requireUser()` and uses `user.id` as `user_id`.

**Steps:**

- [ ] Install:

```bash
npm i better-auth
```

- [ ] Create `lib/auth.ts`. Better Auth may run multi-statement operations, so back its Drizzle adapter with the WebSocket pool (`dbPool`, which supports transactions) rather than the neon-http client. `nextCookies()` must be the last plugin so it can set cookies from server actions:

```ts
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { dbPool } from '@/lib/db/client'

export const auth = betterAuth({
  database: drizzleAdapter(dbPool, { provider: 'pg' }),
  emailAndPassword: {
    enabled: true,
    // Single-user app: open sign-up only when ALLOW_SIGNUP=true (dev + E2E).
    disableSignUp: process.env.ALLOW_SIGNUP !== 'true',
  },
  plugins: [nextCookies()],
})

// Server-side gate: redirects to /sign-in when unauthenticated, else returns the user.
export async function requireUser() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/sign-in')
  return session.user
}
```

- [ ] Create `lib/auth-client.ts`:

```ts
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient()
export const { signIn, signUp, signOut, useSession } = authClient
```

- [ ] Create `app/api/auth/[...all]/route.ts`:

```ts
import { toNextJsHandler } from 'better-auth/next-js'
import { auth } from '@/lib/auth'

export const { GET, POST } = toNextJsHandler(auth)
```

- [ ] Generate the auth tables into a Drizzle schema file, then wire them into the schema barrel so drizzle-kit migrates them:

```bash
npx @better-auth/cli@latest generate --output lib/db/auth-schema.ts -y
```

Then replace `lib/db/schema.ts` so the generated tables are part of the schema:

```ts
// Drizzle schema barrel. Better Auth tables live in auth-schema.ts (generated
// by `npx @better-auth/cli generate`). P1 adds accounts, transactions,
// exchange_rates, settings; P3+ add the rest (spec §4).
export * from './auth-schema'
```

- [ ] Create and apply the migration for the auth tables against the Neon dev DB:

```bash
npm run db:generate
# expected: a new migration file in drizzle/ creating user/session/account/verification tables
npm run db:migrate
# expected: applied to Neon, exit 0
```

- [ ] Update `.env.example` if it still lists the old Stack vars: it must list `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ALLOW_SIGNUP` (not `NEXT_PUBLIC_STACK_*`). (Already done in the repo; verify.)
- [ ] Verify the build compiles: `npm run build` (expected: success).
- [ ] Commit:

```bash
git add -A
git commit -m "feat: better auth wiring (email+password, drizzle adapter, next handler)"
```

## Task 6: Sign-in / sign-up pages + protected (app) shell

**Files:**
- Create: `app/sign-in/page.tsx`, `app/sign-up/page.tsx`, `app/(app)/layout.tsx`, `app/(app)/page.tsx`, `app/(app)/transactions/page.tsx`, `app/(app)/plan/page.tsx`, `app/(app)/more/page.tsx`, `components/bottom-tabs.tsx`
- Delete: `app/page.tsx` (the scaffold landing page; the Home placeholder replaces it inside the group)

**Interfaces:**
- Consumes: `requireUser()` from `lib/auth.ts`; `signIn`/`signUp` from `lib/auth-client.ts`.
- Produces: the `(app)` route group every later screen lives in; tab routes `/` (Home), `/transactions` (Ledger), `/plan` (Plan), `/more` (More); the `/sign-in` and `/sign-up` pages the Playwright setup drives.

**Steps:**

- [ ] Delete the scaffold landing page: `rm app/page.tsx` (route groups do not change URLs, so `app/(app)/page.tsx` serves `/`).
- [ ] Create `app/sign-in/page.tsx` (labels are stable Playwright selectors):

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { signIn } from '@/lib/auth-client'

export default function SignInPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    const res = await signIn.email({ email, password })
    setPending(false)
    if (res.error) {
      setError(res.error.message ?? 'Sign in failed')
      return
    }
    router.push('/')
  }

  return (
    <main className="mx-auto max-w-md p-4">
      <h1 className="mb-4 text-xl font-semibold">Sign in</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block">
          <span className="text-sm">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded border p-2"
            required
          />
        </label>
        <label className="block">
          <span className="text-sm">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded border p-2"
            required
          />
        </label>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded bg-blue-600 py-3 font-semibold text-white disabled:opacity-50"
        >
          Sign in
        </button>
      </form>
      <p className="mt-4 text-sm text-gray-500">
        No account? <Link href="/sign-up" className="text-blue-600">Sign up</Link>
      </p>
    </main>
  )
}
```

- [ ] Create `app/sign-up/page.tsx` (Better Auth email sign-up needs a `name`; default it to the email). When `ALLOW_SIGNUP` is off the server rejects sign-up and the error surfaces here:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { signUp } from '@/lib/auth-client'

export default function SignUpPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    const res = await signUp.email({ email, password, name: email })
    setPending(false)
    if (res.error) {
      setError(res.error.message ?? 'Sign up failed')
      return
    }
    router.push('/')
  }

  return (
    <main className="mx-auto max-w-md p-4">
      <h1 className="mb-4 text-xl font-semibold">Create account</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block">
          <span className="text-sm">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded border p-2"
            required
          />
        </label>
        <label className="block">
          <span className="text-sm">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded border p-2"
            minLength={8}
            required
          />
        </label>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded bg-blue-600 py-3 font-semibold text-white disabled:opacity-50"
        >
          Create account
        </button>
      </form>
      <p className="mt-4 text-sm text-gray-500">
        Have an account? <Link href="/sign-in" className="text-blue-600">Sign in</Link>
      </p>
    </main>
  )
}
```

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
import { requireUser } from '@/lib/auth'
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

- [ ] Verify manually (`.env.local` has `ALLOW_SIGNUP=true`): `npm run dev`, then in a private window open `http://localhost:3000/` -> redirects to `/sign-in`. Go to `/sign-up`, register `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD`, land on `/` showing "My Ledger" and the four tabs; tapping each tab navigates.
- [ ] Commit:

```bash
git add -A
git commit -m "feat: sign-in/up pages + protected (app) route group with bottom-tab shell"
```

## Task 7: Playwright E2E (the phase gate)

**Files:**
- Create: `playwright.config.ts`, `e2e/auth.setup.ts`, `e2e/unauth.spec.ts`, `e2e/shell.spec.ts`
- Modify: `package.json` (scripts, devDependencies), `.gitignore`

**Interfaces:**
- Consumes: the sign-in/up pages + shell from Task 6; `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD` and `ALLOW_SIGNUP=true` from `.env.local`.
- Produces: `npm run e2e`; the `setup` project + `storageState` login helper every later phase's specs reuse (authenticated specs just `page.goto('/...')`).

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
    { name: 'setup', testMatch: /auth\.setup\.ts/, use: { ...devices['Pixel 7'] } },
    { name: 'unauth', testMatch: /unauth\.spec\.ts/, use: { ...devices['Pixel 7'] } },
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

- [ ] Create `e2e/auth.setup.ts`. It registers the E2E user (first run, `ALLOW_SIGNUP=true`) then signs in deterministically, and saves cookies as storageState for the whole `app` project. Sign-up is best-effort: on reruns the user already exists, so the sign-in step is what must succeed:

```ts
import { expect, test as setup } from '@playwright/test'

const authFile = 'e2e/.auth/user.json'
const EMAIL = process.env.E2E_TEST_EMAIL!
const PASSWORD = process.env.E2E_TEST_PASSWORD!

setup('register (first run) then sign in', async ({ page }) => {
  // Best-effort registration: succeeds first run, errors harmlessly if the user exists.
  await page.goto('/sign-up')
  await page.getByLabel('Email').fill(EMAIL)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: /create account/i }).click()
  await Promise.race([
    page.waitForURL('/').catch(() => {}),
    page.getByRole('alert').waitFor({ timeout: 5000 }).catch(() => {}),
  ])

  // Deterministic sign-in.
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(EMAIL)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL('/')
  await expect(page.getByRole('heading', { name: 'My Ledger' })).toBeVisible()

  await page.context().storageState({ path: authFile })
})
```

- [ ] Create `e2e/unauth.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

test('unauthenticated visitor is redirected to sign-in', async ({ page }) => {
  await page.goto('/')
  await page.waitForURL(/\/sign-in/)
  await expect(page.getByLabel('Email')).toBeVisible()
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

- [ ] Run the gate: `npm run e2e`. Expected PASS: `3 passed` (setup registers+signs in, unauth redirect, authenticated shell). These specs come after their implementation tasks on purpose: they are the phase gate, not the unit-level red-green loop.
- [ ] Commit:

```bash
git add -A
git commit -m "test: playwright e2e gate (email+password sign-in redirect, authenticated shell)"
```

## Phase done

- [ ] `npm run lint && npm run format:check && npm run test && npm run build && npm run e2e` all green; paste the output as evidence.
- [ ] Manual mobile-viewport walkthrough: sign in, tap all four tabs.
- [ ] Deployment note (no code): on Vercel the committed `vercel.json` sets the build command (`drizzle-kit migrate && next build`). Set production env vars: `DATABASE_URL` (prod branch), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (the deployed origin), `CRON_SECRET`. Register the single user once with `ALLOW_SIGNUP=true`, then remove it (or set false) so production rejects new sign-ups.
- [ ] Update [docs/wiki/status.md](../../wiki/status.md): P0 complete.

**Backlinks:** [Master index](README.md) | [Spec](../specs/2026-07-07-my-ledger-design.md) | Prev: none (first phase) | Next: [01-accounts-and-currency.md](01-accounts-and-currency.md)
