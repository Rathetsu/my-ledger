'use client'

import { useCallback, useEffect, useState } from 'react'
import type { SanitizedPayload } from '@/lib/ai/sanitize'

type PanelState =
  | { status: 'loading' }
  | { status: 'ready'; advice: string }
  | { status: 'unavailable' }

export function AiAdvisorSlot({ payload, aiEnabled }: { payload: SanitizedPayload; aiEnabled: boolean }) {
  const [state, setState] = useState<PanelState>(
    aiEnabled ? { status: 'loading' } : { status: 'unavailable' },
  )

  const load = useCallback(
    async (refresh: boolean) => {
      setState({ status: 'loading' })
      try {
        const res = await fetch('/api/ai/advice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload, refresh }),
        })
        const data = res.ok ? ((await res.json()) as { advice: string | null }) : { advice: null }
        setState(data.advice ? { status: 'ready', advice: data.advice } : { status: 'unavailable' })
      } catch {
        setState({ status: 'unavailable' })
      }
    },
    [payload],
  )

  useEffect(() => {
    if (aiEnabled) void load(false)
  }, [aiEnabled, load])

  return (
    <section aria-label="AI second opinion" className="mt-6 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">AI second opinion</h2>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={!aiEnabled || state.status === 'loading'}
          className="min-h-11 rounded px-3 text-sm underline disabled:opacity-40"
        >
          Refresh
        </button>
      </div>
      {state.status === 'loading' ? (
        <p className="mt-2 text-sm text-neutral-500">Asking the advisor...</p>
      ) : null}
      {state.status === 'ready' ? (
        <div className="mt-2 whitespace-pre-wrap text-sm">{state.advice}</div>
      ) : null}
      {state.status === 'unavailable' ? (
        <p className="mt-2 text-sm text-neutral-500">
          AI advisor unavailable, your plan above is complete without it.
        </p>
      ) : null}
      <details className="mt-4">
        <summary className="min-h-11 cursor-pointer py-2 text-sm text-neutral-600 dark:text-neutral-400">What gets sent</summary>
        <pre
          data-testid="ai-payload"
          className="mt-2 overflow-x-auto rounded bg-neutral-100 p-2 text-xs dark:bg-neutral-800"
        >
          {JSON.stringify(payload, null, 2)}
        </pre>
      </details>
    </section>
  )
}
