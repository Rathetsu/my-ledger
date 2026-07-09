import { z } from 'zod'
import { CURRENCIES } from '@/lib/money/money'

const currencySchema = z.enum(CURRENCIES as unknown as [string, ...string[]])
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const incomeSourceInput = z.object({
  name: z.string().trim().min(1).max(100),
  amount: z.string().min(1),
  currency: currencySchema,
  dayOfMonth: z.coerce.number().int().min(1).max(31),
  accountId: z.string().uuid(),
  recurring: z.boolean(),
  active: z.boolean().default(true),
})

export const windfallInput = z.object({
  accountId: z.string().uuid(),
  amount: z.string().min(1),
  date: isoDate,
  note: z.string().trim().max(200).default(''),
})

export const confirmInput = z.object({
  occurrenceId: z.string().uuid(),
  amount: z.string().min(1),
  currency: currencySchema,
  date: isoDate,
})

export const idInput = z.object({ occurrenceId: z.string().uuid() })
