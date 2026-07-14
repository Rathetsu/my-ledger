import { describe, expect, it } from 'vitest'
import { FEW_SHOTS, SYSTEM_PROMPT, buildContents } from './prompt'

describe('prompt pack', () => {
  it('states the engine-owns-numbers rule verbatim', () => {
    expect(SYSTEM_PROMPT).toContain(
      'You may quote only numbers present in the input. Never perform arithmetic, never invent figures. If you feel a number is missing, say so in words.',
    )
  })

  it('ships exactly two few-shot examples under 200 words each', () => {
    expect(FEW_SHOTS).toHaveLength(2)
    for (const shot of FEW_SHOTS) {
      expect(shot.output.trim().split(/\s+/).length).toBeLessThanOrEqual(200)
    }
  })

  it('few-shot outputs reference only generic labels', () => {
    for (const shot of FEW_SHOTS) {
      expect(shot.output).not.toMatch(/\b(salary|rent|loan|visa|bank)\b/i)
    }
  })

  it('buildContents interleaves shots then appends the live payload as the last user turn', () => {
    const payload = FEW_SHOTS[0].input
    const contents = buildContents(payload)
    expect(contents.map((c) => c.role)).toEqual(['user', 'model', 'user', 'model', 'user'])
    expect(contents[4].parts[0].text).toBe(JSON.stringify(payload))
  })
})
