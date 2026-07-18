import { timingSafeEqual } from 'node:crypto'
import { todayCairo } from '@/lib/dates/cairo'
import { db } from '@/lib/db/client'
import { settings } from '@/lib/db/schema'
import { housekeeping } from '@/lib/housekeeping'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false
  const expected = Buffer.from(`Bearer ${secret}`)
  const actual = Buffer.from(header)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export async function GET(req: Request) {
  if (!authorized(req.headers.get('authorization'), process.env.CRON_SECRET)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const users = await db.selectDistinct({ userId: settings.userId }).from(settings)
  const today = todayCairo()
  let ran = 0
  let failed = 0
  for (const u of users) {
    try {
      await housekeeping(u.userId, today)
      ran++
    } catch (err) {
      failed++
      console.error(`cron housekeeping failed for user ${u.userId}`, err)
    }
  }
  return Response.json({ ok: failed === 0, ran, failed })
}
