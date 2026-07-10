'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/', label: 'Home' },
  { href: '/transactions', label: 'Ledger' },
  { href: '/income', label: 'Income' },
  { href: '/bills', label: 'Bills' },
  { href: '/installments', label: 'Inst' },
  { href: '/plan', label: 'Plan' },
  { href: '/more', label: 'More' },
]

export function BottomTabs() {
  const pathname = usePathname()
  return (
    <nav className="fixed inset-x-0 bottom-0 border-t bg-white">
      <ul className="flex">
        {TABS.map((t) => {
          const active =
            t.href === '/' ? pathname === '/' : pathname.startsWith(t.href)
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                aria-current={active ? 'page' : undefined}
                className={`block py-3 text-center text-sm ${
                  active ? 'font-semibold text-blue-600' : 'text-gray-500'
                }`}
              >
                {t.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
