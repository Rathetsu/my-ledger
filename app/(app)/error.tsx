'use client'

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="mt-16 flex flex-col items-center gap-3 px-6 text-center">
      <h2 className="text-base font-semibold">Something went wrong</h2>
      <p className="max-w-sm text-sm text-neutral-500 dark:text-neutral-400">
        Your data is safe; nothing was lost. Try again, and if it keeps failing reload the page.
      </p>
      {error.digest ? (
        <p className="text-xs text-neutral-400 dark:text-neutral-500">Reference: {error.digest}</p>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="min-h-11 rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
      >
        Try again
      </button>
    </div>
  )
}
