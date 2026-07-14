import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = {
  aiEnabled: true,
  cacheRow: null as { userId: string; payloadHash: string; advice: string } | null,
  upserts: [] as { userId: string; payloadHash: string; advice: string }[],
}

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ id: 'user-1' })),
}))

vi.mock('@/lib/db/client', async () => {
  const schema = await import('@/lib/db/schema')
  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: async () => {
            if (table === schema.settings) return [{ userId: 'user-1', aiEnabled: state.aiEnabled }]
            if (table === schema.aiAdviceCache) return state.cacheRow ? [state.cacheRow] : []
            return []
          },
        }),
      }),
      insert: () => ({
        values: (v: { userId: string; payloadHash: string; advice: string }) => ({
          onConflictDoUpdate: async () => {
            state.upserts.push(v)
          },
        }),
      }),
    },
  }
})

import { FEW_SHOTS } from './prompt'
import { cacheKey } from './sanitize'
import { getAdvice } from './advisor'

const payload = FEW_SHOTS[0].input

function geminiOk(text: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  } as unknown as Response
}

describe('getAdvice', () => {
  beforeEach(() => {
    state.aiEnabled = true
    state.cacheRow = null
    state.upserts = []
    vi.stubEnv('GEMINI_API_KEY', 'test-key')
    vi.stubEnv('GEMINI_MODEL', '')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('happy path: calls gemini, upserts cache, returns text', async () => {
    const fetchMock = vi.fn(async () => geminiOk('Solid plan overall.'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(getAdvice(payload)).resolves.toBe('Solid plan overall.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent',
    )
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key')
    const body = JSON.parse(String(init.body)) as {
      generationConfig: { temperature: number }
      contents: unknown[]
    }
    expect(body.generationConfig.temperature).toBe(0.3)
    expect(body.contents).toHaveLength(5)
    expect(state.upserts).toEqual([
      { userId: 'user-1', payloadHash: cacheKey(payload), advice: 'Solid plan overall.' },
    ])
  })

  it('respects GEMINI_MODEL override', async () => {
    vi.stubEnv('GEMINI_MODEL', 'gemini-4-flash')
    const fetchMock = vi.fn(async () => geminiOk('ok'))
    vi.stubGlobal('fetch', fetchMock)
    await getAdvice(payload)
    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toContain(
      'models/gemini-4-flash:generateContent',
    )
  })

  it('cache hit returns stored advice and skips fetch', async () => {
    state.cacheRow = { userId: 'user-1', payloadHash: cacheKey(payload), advice: 'cached words' }
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(getAdvice(payload)).resolves.toBe('cached words')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stale cache (different hash) refetches', async () => {
    state.cacheRow = { userId: 'user-1', payloadHash: 'old-hash', advice: 'stale' }
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk('fresh advice')))
    await expect(getAdvice(payload)).resolves.toBe('fresh advice')
  })

  it('returns null without fetch when ai_enabled is false', async () => {
    state.aiEnabled = false
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(getAdvice(payload)).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns null without fetch when GEMINI_API_KEY is missing', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(getAdvice(payload)).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns null on 429', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }) as unknown as Response))
    await expect(getAdvice(payload)).resolves.toBeNull()
  })

  it('returns null on network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('ECONNRESET'))))
    await expect(getAdvice(payload)).resolves.toBeNull()
  })

  it('returns null on malformed response body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as unknown as Response))
    await expect(getAdvice(payload)).resolves.toBeNull()
  })
})
