import { config } from 'dotenv'

// DB-backed Vitest tests (housekeeping, confirm) run against the Neon dev DB.
// quiet: suppress dotenv's per-file promotional stdout so test output stays pristine.
config({ path: '.env.local', quiet: true })
