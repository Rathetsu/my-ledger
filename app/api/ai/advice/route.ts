import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getAdvice } from '@/lib/ai/advisor'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { aiAdviceCache } from '@/lib/db/schema'

const currency = z.enum(['EUR', 'USD', 'EGP'])
const yyyyMm = z.string().regex(/^\d{4}-\d{2}$/)

const payloadSchema = z.object({
  homeCurrency: currency,
  horizonMonths: z.number().int().positive(),
  spendEstimateSource: z.enum(['baseline', 'blend']),
  // zod 4's z.record with an enum key schema is exhaustive (requires every enum
  // key present). sanitizePlanPayload only emits the currencies the user actually
  // holds, so these four must use z.partialRecord (installed zod ^4.4.3 has it).
  monthlyIncomeMinor: z.partialRecord(currency, z.number().int()),
  billsMinor: z.partialRecord(currency, z.number().int()),
  variableSpendMinor: z.partialRecord(currency, z.number().int()),
  accountBalancesMinor: z.partialRecord(currency, z.number().int()),
  installments: z.array(
    z.object({
      label: z.string().regex(/^installment[A-Z]+$/),
      monthlyMinor: z.number().int(),
      currency,
      remainingCount: z.number().int(),
      apr: z.number().optional(),
    }),
  ),
  debts: z.array(
    z.object({
      label: z.string().regex(/^debt[A-Z]+$/),
      balanceMinor: z.number().int(),
      currency,
      apr: z.number(),
      deadline: yyyyMm.optional(),
      minPaymentMinor: z.number().int().optional(),
      payoffPeriod: yyyyMm.nullable(),
    }),
  ),
  wishlist: z.array(
    z.object({
      label: z.string().regex(/^item[A-Z]+$/),
      costMinor: z.number().int(),
      currency,
      priority: z.number(),
      targetMonth: yyyyMm.optional(),
      affordablePeriod: yyyyMm.nullable(),
    }),
  ),
  surplusMinorByMonth: z.record(yyyyMm, z.number().int()),
  fundingGaps: z.array(z.object({ period: yyyyMm, currency, shortfallMinor: z.number().int() })),
  highAprInstallmentFlags: z.array(z.string().regex(/^installment[A-Z]+$/)),
})

const bodySchema = z.object({ payload: payloadSchema, refresh: z.boolean().optional() })

export async function POST(req: Request) {
  const user = await requireUser()
  const raw = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return Response.json({ error: 'invalid payload' }, { status: 400 })
  }
  if (parsed.data.refresh) {
    await db.delete(aiAdviceCache).where(eq(aiAdviceCache.userId, user.id))
  }
  const advice = await getAdvice(parsed.data.payload)
  return Response.json({ advice })
}
