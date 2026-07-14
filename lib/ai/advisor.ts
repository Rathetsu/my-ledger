import { eq } from 'drizzle-orm'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { aiAdviceCache, settings } from '@/lib/db/schema'
import { SYSTEM_PROMPT, buildContents } from './prompt'
import { cacheKey, type SanitizedPayload } from './sanitize'

const DEFAULT_MODEL = 'gemini-3-flash-preview'

// null means "advisor unavailable". This function never throws to the page.
export async function getAdvice(payload: SanitizedPayload): Promise<string | null> {
  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return null

    const user = await requireUser()
    const [userSettings] = await db.select().from(settings).where(eq(settings.userId, user.id))
    if (!userSettings?.aiEnabled) return null

    const key = cacheKey(payload)
    const [cached] = await db.select().from(aiAdviceCache).where(eq(aiAdviceCache.userId, user.id))
    if (cached && cached.payloadHash === key) return cached.advice

    const model = process.env.GEMINI_MODEL || DEFAULT_MODEL
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: buildContents(payload),
          generationConfig: { temperature: 0.3 },
        }),
      },
    )
    if (!res.ok) return null

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[]
    }
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim()
    if (!text) return null

    await db
      .insert(aiAdviceCache)
      .values({ userId: user.id, payloadHash: key, advice: text })
      .onConflictDoUpdate({
        target: aiAdviceCache.userId,
        set: { payloadHash: key, advice: text, createdAt: new Date() },
      })
    return text
  } catch {
    return null
  }
}
