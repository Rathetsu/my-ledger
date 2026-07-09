import { config } from 'dotenv'

// DB-backed Vitest tests (housekeeping, confirm) run against the Neon dev DB.
config({ path: '.env.local' })
