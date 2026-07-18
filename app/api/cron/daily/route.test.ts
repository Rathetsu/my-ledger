import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/housekeeping', () => ({
  housekeeping: vi.fn(async () => undefined),
}))
vi.mock('@/lib/dates/cairo', () => ({
  todayCairo: () => '2026-07-07',
}))
vi.mock('@/lib/db/client', () => ({
  db: {
    selectDistinct: () => ({
      from: async () => [{ userId: 'user-1' }],
    }),
  },
}))

import { housekeeping } from '@/lib/housekeeping'
import { GET } from './route'

function get(headers: Record<string, string> = {}) {
  return GET(new Request('http://test/api/cron/daily', { headers }))
}

describe('GET /api/cron/daily', () => {
  beforeEach(() => {
    vi.mocked(housekeeping).mockClear()
    vi.stubEnv('CRON_SECRET', 's3cret')
  })

  it('returns 401 without an Authorization header', async () => {
    const res = await get()
    expect(res.status).toBe(401)
    expect(housekeeping).not.toHaveBeenCalled()
  })

  it('returns 401 with a wrong bearer token', async () => {
    const res = await get({ authorization: 'Bearer wrong' })
    expect(res.status).toBe(401)
  })

  it('returns 401 when CRON_SECRET is unset, even for a literal match attempt', async () => {
    vi.stubEnv('CRON_SECRET', '')
    const res = await get({ authorization: 'Bearer undefined' })
    expect(res.status).toBe(401)
  })

  it('runs housekeeping per user and reports the count with the right secret', async () => {
    const res = await get({ authorization: 'Bearer s3cret' })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, ran: 1 })
    expect(housekeeping).toHaveBeenCalledWith('user-1', '2026-07-07')
  })
})
