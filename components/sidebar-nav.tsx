import Link from 'next/link'

const DESTINATIONS = [
  { href: '/', label: 'Dashboard' },
  { href: '/accounts', label: 'Accounts' },
  { href: '/transactions', label: 'Transactions' },
  { href: '/income', label: 'Income' },
  { href: '/bills', label: 'Bills' },
  { href: '/installments', label: 'Installments' },
  { href: '/expenses', label: 'Expenses' },
  { href: '/debts', label: 'Debts' },
  { href: '/wishlist', label: 'Wishlist' },
  { href: '/plan', label: 'Plan' },
  { href: '/settings', label: 'Settings' },
]

export function SidebarNav() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-y-0 left-0 hidden w-56 flex-col gap-1 border-r border-neutral-200 bg-white p-4 md:flex dark:border-neutral-800 dark:bg-neutral-950"
    >
      <p className="px-2 pb-2 text-sm font-semibold">My Ledger</p>
      {DESTINATIONS.map((d) => (
        <Link
          key={d.href}
          href={d.href}
          className="flex min-h-11 items-center rounded px-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900"
        >
          {d.label}
        </Link>
      ))}
    </nav>
  )
}
