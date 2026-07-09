'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { parseToMinor } from '@/lib/money/money'
import type { Currency } from '@/lib/money/money'
import {
  confirmOccurrence,
  skipOccurrence,
  unconfirmOccurrence,
} from '@/lib/occurrences/confirm'
import type { ConfirmResult } from '@/lib/occurrences/confirm'
import { confirmInput, idInput } from './schemas'

function revalidateOccurrenceScreens() {
  revalidatePath('/')
  revalidatePath('/income')
  revalidatePath('/accounts')
}

export async function confirmOccurrenceAction(
  input: unknown,
): Promise<ConfirmResult> {
  const user = await requireUser()
  const parsed = confirmInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid input' }
  let actualAmountMinor: number
  try {
    actualAmountMinor = parseToMinor(
      parsed.data.amount,
      parsed.data.currency as Currency,
    )
  } catch {
    return { ok: false, error: 'Invalid amount' }
  }
  if (actualAmountMinor <= 0)
    return { ok: false, error: 'Amount must be positive' }

  const result = await confirmOccurrence({
    userId: user.id,
    occurrenceId: parsed.data.occurrenceId,
    actualAmountMinor,
    actualDate: parsed.data.date,
  })
  if (result.ok) revalidateOccurrenceScreens()
  return result
}

export async function skipOccurrenceAction(
  input: unknown,
): Promise<ConfirmResult> {
  const user = await requireUser()
  const parsed = idInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid input' }
  const result = await skipOccurrence(user.id, parsed.data.occurrenceId)
  if (result.ok) revalidateOccurrenceScreens()
  return result
}

export async function unconfirmOccurrenceAction(
  input: unknown,
): Promise<ConfirmResult> {
  const user = await requireUser()
  const parsed = idInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid input' }
  const result = await unconfirmOccurrence(user.id, parsed.data.occurrenceId)
  if (result.ok) revalidateOccurrenceScreens()
  return result
}
