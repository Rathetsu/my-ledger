import { todayCairo } from '@/lib/dates/cairo'
import { db } from '@/lib/db/client'
import { settings } from '@/lib/db/schema'
import { housekeeping } from '@/lib/housekeeping'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const users = await db.selectDistinct({ userId: settings.userId }).from(settings)
  const today = todayCairo()
  for (const u of users) {
    await housekeeping(u.userId, today)
  }
  return Response.json({ ok: true, ran: users.length })
}
