import type { ActionResult } from '@/lib/actions/definitions'

export function FormErrors({
  result,
  field,
}: {
  result: ActionResult | null | undefined
  field?: string
}) {
  if (!result || result.ok) return null
  const message = field ? result.fieldErrors?.[field] : result.error
  if (!message) return null
  return (
    <p role="alert" className="mt-1 text-sm text-red-600">
      {message}
    </p>
  )
}
