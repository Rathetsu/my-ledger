import { describe, expect, test } from 'vitest'
import { directMutability } from '@/lib/transactions/mutability'

describe('directMutability (spec §3 Mutability)', () => {
  test('plain row: mutable', () => {
    expect(
      directMutability({ sourceType: null, transferGroupId: null }),
    ).toEqual({
      ok: true,
    })
  })
  test('source-linked row: blocked with a clear error', () => {
    const r = directMutability({ sourceType: 'income', transferGroupId: null })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/confirm flow/i)
  })
  test('transfer leg: blocked, points at the group flow', () => {
    const r = directMutability({ sourceType: null, transferGroupId: 'g-1' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/transfer/i)
  })
  test('source-linked wins over transfer (defensive; should not co-occur)', () => {
    const r = directMutability({ sourceType: 'bill', transferGroupId: 'g-1' })
    expect(r.ok).toBe(false)
    // Prove precedence: the source-linked branch must win, not the transfer one.
    if (!r.ok) expect(r.reason).toMatch(/confirm flow/i)
  })
})
