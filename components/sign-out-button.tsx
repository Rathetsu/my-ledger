'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { signOut } from '@/lib/auth-client'

export function SignOutButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        // signOut clears the cookie (nextCookies plugin); the push re-triggers
        // the protected layout's requireUser() gate.
        await signOut()
        router.push('/sign-in')
        router.refresh()
      }}
      className="w-full rounded border border-red-600 py-3 text-red-600"
    >
      Sign out
    </button>
  )
}
