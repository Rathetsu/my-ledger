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
