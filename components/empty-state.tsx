import type { ReactNode } from 'react'

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="mt-12 flex flex-col items-center gap-2 px-6 text-center">
      <h2 className="text-base font-semibold">{title}</h2>
      {body ? <p className="max-w-sm text-sm text-neutral-500 dark:text-neutral-400">{body}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
