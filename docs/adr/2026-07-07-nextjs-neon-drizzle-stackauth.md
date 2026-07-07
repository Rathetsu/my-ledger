# ADR: Next.js + Neon Postgres + Drizzle + Stack Auth (Google-only prod, email+password test project)

**Status:** accepted 2026-07-07

## Decision

Next.js App Router + TypeScript + Tailwind (mobile-first), Neon Postgres via Drizzle ORM, auth via Neon Auth (Stack Auth). Production allows **Google sign-in only** (Stack dashboard toggle). A **separate Stack test project with email+password** backs dev/E2E, because Google blocks OAuth in automated browsers - Playwright could never log in otherwise. Mutations are zod-validated server actions with `revalidatePath`. Reads use `drizzle-orm/neon-http`; multi-step writes use a `drizzle-orm/neon-serverless` Pool for real transactions. `drizzle-kit migrate` runs in the Vercel build command (single user; no concurrent-deploy risk). Deploy on Vercel.

## Why

- Single user, multi-device → hosted Postgres + real auth with minimal setup; Neon Auth provisions Stack and injects env vars.
- Drizzle over Prisma: lighter serverless cold starts on Vercel, SQL-like TypeScript-native queries, first-class Neon support.
- Server actions over API routes: fewer moving parts for a solo app; validation stays at the boundary via zod.

## Rejected

- **Prisma**: heavier runtime, slower cold starts; Studio GUI not worth it here.
- **Auth.js / single password gate**: more setup or weaker isolation than Neon Auth's built-in pairing.
- **Google-only for E2E too**: impossible to automate; would have silently killed every phase's Playwright gate.
- **localStorage-only storage**: no multi-device sync; data lost on browser clear.
