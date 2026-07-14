import { beforeEach, describe, expect, it, vi } from 'vitest'

const deleted: string[] = []

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ id: 'user-1' })),
}))
vi.mock('@/lib/db/client', () => ({
  db: {
    delete: () => ({
      where: async () => {
        deleted.push('user-1')
      },
    }),
  },
}))
vi.mock('@/lib/ai/advisor', () => ({
  getAdvice: vi.fn(async () => 'advice text'),
}))

import { getAdvice } from '@/lib/ai/advisor'
import { FEW_SHOTS } from '@/lib/ai/prompt'
import { POST } from './route'

function post(body: unknown) {
  return POST(
    new Request('http://test/api/ai/advice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

describe('POST /api/ai/advice', () => {
  beforeEach(() => {
    deleted.length = 0
    vi.mocked(getAdvice).mockClear()
  })

  it('returns advice for a valid sanitized payload', async () => {
    const res = await post({ payload: FEW_SHOTS[0].input })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ advice: 'advice text' })
    expect(deleted).toHaveLength(0)
  })

  it('accepts a partial per-currency record (only currencies the user holds)', async () => {
    const partial = { ...FEW_SHOTS[0].input, monthlyIncomeMinor: { EUR: 250000 } }
    const res = await post({ payload: partial })
    expect(res.status).toBe(200)
  })

  it('rejects a payload whose labels are not generic', async () => {
    const bad = {
      ...FEW_SHOTS[0].input,
      debts: [{ ...FEW_SHOTS[0].input.debts[0], label: 'Loan from Dad' }],
    }
    const res = await post({ payload: bad })
    expect(res.status).toBe(400)
    expect(getAdvice).not.toHaveBeenCalled()
  })

  it('rejects a non-JSON body', async () => {
    const res = await POST(new Request('http://test/api/ai/advice', { method: 'POST', body: 'not json' }))
    expect(res.status).toBe(400)
  })

  it('refresh: true clears the cache row before fetching', async () => {
    const res = await post({ payload: FEW_SHOTS[0].input, refresh: true })
    expect(res.status).toBe(200)
    expect(deleted).toEqual(['user-1'])
  })
})
