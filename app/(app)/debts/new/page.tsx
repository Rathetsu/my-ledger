import { DebtForm } from '@/components/debts/debt-form'

export default function NewDebtPage() {
  return (
    <main className="mx-auto max-w-md space-y-4 p-4">
      <h1 className="text-xl font-semibold">Add debt</h1>
      <DebtForm />
    </main>
  )
}
