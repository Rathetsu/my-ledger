import Link from 'next/link'
import { SignOutButton } from '@/components/sign-out-button'

const LINKS = [
  { href: '/accounts', label: 'Accounts' },
  { href: '/debts', label: 'Debts' },
  { href: '/settings', label: 'Settings' },
]

export default function MorePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">More</h1>
      <ul className="divide-y rounded border">
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="block p-4">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
      <SignOutButton />
    </div>
  )
}
