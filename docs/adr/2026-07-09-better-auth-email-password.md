# ADR: Auth is self-hosted Better Auth, email + password only

**Status:** accepted 2026-07-09. Supersedes the auth portion of [2026-07-07-nextjs-neon-drizzle-stackauth.md](2026-07-07-nextjs-neon-drizzle-stackauth.md) (the Next.js / Neon / Drizzle choices there still stand).

## Decision

Authentication is **self-hosted Better Auth** (`better-auth`), not Stack Auth. Sign-in method is **email + password only**; no Google, no other social/OAuth providers. Auth data (user, session, account, verification tables) lives in **our own Neon Postgres** via Better Auth's Drizzle adapter, so it is covered by our normal drizzle-kit migrations. There is a **single auth configuration** used identically in local dev, Playwright E2E, and production (no prod/test project split). Open sign-up is **gated by an `ALLOW_SIGNUP` env flag** (default off): the single user registers once with `ALLOW_SIGNUP=true`, then it is turned off so the internet-exposed deployment will not accept new registrations.

Shape:
- `lib/auth.ts` - `export const auth = betterAuth({ database: drizzleAdapter(db, {provider:'pg'}), emailAndPassword: { enabled: true, disableSignUp: process.env.ALLOW_SIGNUP !== 'true' }, plugins: [nextCookies()] })`, plus `requireUser()` wrapping `auth.api.getSession({ headers: await headers() })` and redirecting to `/sign-in` when null.
- `lib/auth-client.ts` - `createAuthClient()` for the sign-in / sign-up forms.
- `app/api/auth/[...all]/route.ts` - `toNextJsHandler(auth)`.
- Our own `/sign-in` and `/sign-up` pages (outside the protected `(app)` group).
- Auth tables generated via `npx @better-auth/cli generate` into `lib/db/auth-schema.ts`, re-exported from `lib/db/schema.ts`, then migrated with the existing `db:generate` / `db:migrate` flow.
- Env: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ALLOW_SIGNUP`, plus `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD`.

## Why

"Neon Auth" no longer means Stack Auth: Neon's managed auth is now built on Better Auth. The user's original intent was Neon's integrated auth with a single sign-in method, and they chose to drop Google in favour of email + password for simplicity. Self-hosted Better Auth is the most standard and best-documented path, is framework-agnostic and portable (not coupled to a managed service), and stores auth in the Neon database we already run through Drizzle. Email + password needs zero external setup, which removes every external blocker: local dev, the Playwright gate, and production all work without a Google Cloud OAuth app or any third-party dashboard.

## Rejected

- **Stack Auth** (the original plan): no longer what Neon ships; an external service holding our auth data; would have blocked all progress on creating dashboard projects and a Google OAuth app that we no longer need.
- **Neon-managed Better Auth**: closest to the literal "Neon Auth" wording and provisionable via MCP, but couples the app to Neon's managed auth service with a newer, less-documented app integration. Self-hosting keeps control and portability.
- **Keeping Google (social) login**: dropped by the user for setup simplicity; email + password fully serves a single-user private app.
- **Open sign-up**: an internet-exposed personal app must not accept arbitrary registrations; hence the `ALLOW_SIGNUP` gate.
