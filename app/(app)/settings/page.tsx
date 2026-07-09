import { requireUser } from '@/lib/auth'
import { getSettings } from '@/lib/db/queries'
import { HomeCurrencyForm } from '@/components/home-currency-form'

export default async function SettingsPage() {
  const user = await requireUser()
  const s = await getSettings(user.id)
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <HomeCurrencyForm current={s.homeCurrency} />
    </div>
  )
}
