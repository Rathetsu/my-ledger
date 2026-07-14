import { requireUser } from '@/lib/auth'
import { getSettings } from '@/lib/db/queries'
import { HomeCurrencyForm } from '@/components/home-currency-form'
import { updateAiEnabled } from '@/lib/actions/settings'

export default async function SettingsPage() {
  const user = await requireUser()
  const s = await getSettings(user.id)
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <HomeCurrencyForm current={s.homeCurrency} />
      <section aria-label="AI advisor" className="mt-6">
        <h2 className="text-base font-semibold">AI advisor</h2>
        <form action={updateAiEnabled} className="mt-2 flex items-center gap-3">
          <label htmlFor="aiEnabled" className="flex min-h-11 items-center gap-2 text-sm">
            <input
              id="aiEnabled"
              name="aiEnabled"
              type="checkbox"
              defaultChecked={s.aiEnabled}
              className="h-5 w-5"
            />
            Show an AI second opinion on the plan screen
          </label>
          <button
            type="submit"
            className="min-h-11 rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
          >
            Save
          </button>
        </form>
      </section>
    </div>
  )
}
