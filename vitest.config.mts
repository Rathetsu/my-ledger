import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'tests/**/*.test.ts', 'app/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // ponytail: Neon's WebSocket Pool (dbPool.transaction) cold-connects slower than
    // the 5s default, especially on a suspended dev compute. Bump globally so every
    // future dbPool-backed test (P4/P5 confirm tests reuse this module) isn't flaky.
    testTimeout: 15000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
