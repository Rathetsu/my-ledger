import { z } from 'zod'
import { CURRENCIES } from '@/lib/money/money'

const currencySchema = z.enum(CURRENCIES as unknown as [string, ...string[]])
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
// A decimal money string; bounded so an unbounded payload can't reach parseToMinor.
const amountString = z.string().trim().min(1).max(20)

// Guards positional `id` args before they hit a uuid column (a non-uuid string
// otherwise 500s on the Postgres cast). Returns true when `id` is a valid uuid.
export function isUuid(id: string): boolean {
  return z.string().uuid().safeParse(id).success
}

export const incomeSourceInput = z.object({
  name: z.string().trim().min(1).max(100),
  amount: amountString,
  currency: currencySchema,
  dayOfMonth: z.coerce.number().int().min(1).max(31),
  accountId: z.string().uuid(),
  recurring: z.boolean(),
  active: z.boolean().default(true),
})

export const windfallInput = z.object({
  accountId: z.string().uuid(),
  amount: amountString,
  date: isoDate,
  note: z.string().trim().max(200).default(''),
})

export const confirmInput = z.object({
  occurrenceId: z.string().uuid(),
  amount: amountString,
  currency: currencySchema,
  date: isoDate,
})

export const idInput = z.object({ occurrenceId: z.string().uuid() })

export const billInput = z.object({
  name: z.string().trim().min(1).max(100),
  amount: amountString,
  currency: currencySchema,
  dueDay: z.coerce.number().int().min(1).max(31),
  accountId: z.string().uuid(),
  active: z.boolean().default(true),
})

export const installmentInput = z.object({
  name: z.string().trim().min(1).max(100),
  amount: amountString, // monthly amount, decimal string
  currency: currencySchema,
  dueDay: z.coerce.number().int().min(1).max(31),
  totalCount: z.coerce.number().int().min(1).max(240),
  startDate: isoDate,
  accountId: z.string().uuid(),
  apr: z.coerce.number().min(0).max(200).nullable().default(null),
})

export const categoryInput = z.object({
  name: z.string().trim().min(1).max(60),
  icon: z.string().trim().min(1).max(8).optional(),
})

export const debtSchema = z.object({
  name: z.string().trim().min(1).max(80),
  originalMinor: z.number().int().positive(),
  currency: z.enum(['EUR', 'USD', 'EGP']),
  apr: z.number().min(0).max(200).default(0),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  minPaymentMinor: z.number().int().positive().optional(),
})

export const installmentUpdateInput = installmentInput
  .extend({
    // Reject a blank field rather than coercing '' to 0 (which would silently
    // complete the installment). An explicit 0 is still a valid "mark complete".
    remainingCount: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.coerce.number().int().min(0),
    ),
    active: z.boolean(),
  })
  .refine((v) => v.remainingCount <= v.totalCount, {
    message: 'remainingCount cannot exceed totalCount',
  })
