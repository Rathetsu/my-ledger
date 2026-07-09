'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { settings } from '@/lib/db/schema'
import { getSettings } from '@/lib/db/queries'
import type { ActionState } from './accounts'

export async function setHomeCurrency(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser()
  const parsed = z
    .object({ homeCurrency: z.enum(['EUR', 'USD', 'EGP']) })
    .safeParse({ homeCurrency: formData.get('homeCurrency') })
  if (!parsed.success) return { error: 'Pick a valid currency' }
  await getSettings(user.id) // ensure the row exists before updating
  await db
    .update(settings)
    .set({ homeCurrency: parsed.data.homeCurrency })
    .where(eq(settings.userId, user.id))
  revalidatePath('/')
  revalidatePath('/settings')
  return null
}
