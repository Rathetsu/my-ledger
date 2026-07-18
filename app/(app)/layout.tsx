import { requireUser } from '@/lib/auth'
import { BottomTabs } from '@/components/bottom-tabs'
import { SidebarNav } from '@/components/sidebar-nav'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireUser()
  return (
    <div className="min-h-dvh pb-16 md:pb-0">
      <SidebarNav />
      <main className="mx-auto max-w-md p-4 md:ml-56 md:max-w-2xl md:px-8">
        {children}
      </main>
      <BottomTabs />
    </div>
  )
}
