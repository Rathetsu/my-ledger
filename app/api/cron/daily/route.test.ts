import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/housekeeping', () => ({
  housekeeping: vi.fn(async () => undefined),
}))
vi.mock('@/lib/dates/cairo', () => ({
  todayCairo: () => '2026-07-07',
}))

const usersToReturn: { userId: string }[] = [{ userId: 'user-1' }]

vi.mock('@/lib/db/client', () => ({
  db: {
    selectDistinct: () => ({
      from: async () => usersToReturn,
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
    vi.mocked(housekeeping).mockImplementation(async () => undefined)
    usersToReturn.length = 0
    usersToReturn.push({ userId: 'user-1' })
    vi.stubEnv('CRON_SECRET', 's3cret')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
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

  it('returns 401 for an equal-length wrong bearer (exercises timingSafeEqual content compare)', async () => {
    const res = await get({ authorization: 'Bearer s3xret' })
    expect(res.status).toBe(401)
    expect(housekeeping).not.toHaveBeenCalled()
  })

  it('returns 401 when CRON_SECRET is unset, even for a literal match attempt', async () => {
    vi.stubEnv('CRON_SECRET', '')
    const res = await get({ authorization: 'Bearer undefined' })
    expect(res.status).toBe(401)
  })

  it('runs housekeeping per user and reports the count with the right secret', async () => {
    const res = await get({ authorization: 'Bearer s3cret' })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, ran: 1, failed: 0 })
    expect(housekeeping).toHaveBeenCalledWith('user-1', '2026-07-07')
  })

  it('isolates a per-user housekeeping failure: other users still run', async () => {
    usersToReturn.length = 0
    usersToReturn.push({ userId: 'user-1' }, { userId: 'user-2' })
    vi.mocked(housekeeping).mockImplementation(async (userId: string) => {
      if (userId === 'user-1') throw new Error('boom')
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await get({ authorization: 'Bearer s3cret' })
    consoleError.mockRestore()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: false, ran: 1, failed: 1 })
    expect(housekeeping).toHaveBeenCalledTimes(2)
  })
})
