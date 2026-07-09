import { requireUser } from '@/lib/auth'
import { BottomTabs } from '@/components/bottom-tabs'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireUser()
  return (
    <div className="min-h-dvh pb-16">
      <main className="mx-auto max-w-md p-4">{children}</main>
      <BottomTabs />
    </div>
  )
}
