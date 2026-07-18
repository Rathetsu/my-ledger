import Link from 'next/link'

export interface SetupState {
  hasAccount: boolean
  hasIncomeSource: boolean
  hasCommitment: boolean // any bill or installment
  hasExpense: boolean
}

const STEPS = [
  {
    key: 'hasAccount' as const,
    label: 'Create your accounts',
    href: '/accounts',
    hint: 'Add each wallet with its currency and opening balance.',
  },
  {
    key: 'hasIncomeSource' as const,
    label: 'Add your income source',
    href: '/income',
    hint: 'Your salary: amount, day of month, target account.',
  },
  {
    key: 'hasCommitment' as const,
    label: 'Add bills or installments',
    href: '/bills',
    hint: 'Recurring commitments the plan should expect.',
  },
  {
    key: 'hasExpense' as const,
    label: 'Log your first expense',
    href: '/expenses',
    hint: 'Day-to-day spending builds your real spend estimate.',
  },
]

export function SetupChecklist({ state }: { state: SetupState }) {
  if (STEPS.every((s) => state[s.key])) return null
  return (
    <section
      aria-label="Set up My Ledger"
      className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
    >
      <h2 className="text-base font-semibold">Set up My Ledger</h2>
      <ul className="mt-2 flex flex-col">
        {STEPS.map((s) =>
          state[s.key] ? (
            <li
              key={s.key}
              className="flex min-h-11 items-center gap-2 text-sm text-neutral-400 dark:text-neutral-500"
            >
              <span aria-hidden="true">✓</span>
              <span className="line-through">{s.label}</span>
            </li>
          ) : (
            <li key={s.key}>
              <Link
                href={s.href}
                className="flex min-h-11 flex-col justify-center rounded px-1 hover:bg-neutral-50 dark:hover:bg-neutral-900"
              >
                <span className="text-sm font-medium">{s.label}</span>
                <span className="text-xs text-neutral-500 dark:text-neutral-400">{s.hint}</span>
              </Link>
            </li>
          ),
        )}
      </ul>
    </section>
  )
}
