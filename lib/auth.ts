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
