// Drizzle schema barrel. Better Auth tables live in auth-schema.ts (generated
// by `npx @better-auth/cli generate`). P1 adds accounts, transactions,
// exchange_rates, settings; P3+ add the rest (spec §4).
export * from './auth-schema'
