# 2026-07-09 - Auth pivot: Stack Auth to self-hosted Better Auth (email+password)

While starting P0 implementation, provisioning auth via the Neon MCP revealed that **Neon Auth is now built on Better Auth, not Stack Auth** (the [2026-07-07 stack ADR](../adr/2026-07-07-nextjs-neon-drizzle-stackauth.md) had assumed Stack Auth, correct at the planning model's training cutoff but now stale). Surfaced to the user rather than silently overriding the ADR.

Decision (user): **self-hosted Better Auth, email + password only, drop Google.** Rationale and rejected alternatives in [ADR 2026-07-09](../adr/2026-07-09-better-auth-email-password.md).

Consequences applied this session:
- New ADR supersedes the auth portion of the stack ADR; Next.js/Neon/Drizzle choices unchanged.
- Spec, CONTEXT, wiki architecture, plans README, and P0 Tasks 5-7 rewritten off Stack Auth onto Better Auth. The prod/test two-project split is gone (one email+password config for dev, E2E, prod); open sign-up gated by `ALLOW_SIGNUP`.
- P0 Tasks 1-4 (scaffold, Prettier, Vitest, Drizzle+Neon) were already complete and are unaffected (Better Auth also uses Postgres+Drizzle).
- Neon dev project "my-ledger" (jolly-flower-52846334) provisioned earlier stands; auth tables will be added to it via the existing migration flow.

Verified against current docs (Context7) during the pivot: Better Auth Next.js integration (`betterAuth` + `drizzleAdapter`, `toNextJsHandler` at `app/api/auth/[...all]`, `auth.api.getSession`, `nextCookies` plugin, `@better-auth/cli generate` for the Drizzle schema).
