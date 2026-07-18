import { eq } from 'drizzle-orm'
import { EmptyState } from '@/components/empty-state'
import { db } from '@/lib/db/client'
import { expenseCategories } from '@/lib/db/schema'
import { requireUser } from '@/lib/auth'
import { deleteCategory } from '@/lib/actions/expense-categories'
import { CategoryForm } from '@/components/expenses/category-form'

export default async function CategoriesPage() {
  const user = await requireUser()
  const categories = await db
    .select()
    .from(expenseCategories)
    .where(eq(expenseCategories.userId, user.id))
    .orderBy(expenseCategories.name)
  return (
    <main className="mx-auto max-w-md space-y-4 p-4">
      <h1 className="text-xl font-semibold">Expense categories</h1>
      <CategoryForm />
      {categories.length === 0 ? (
        <EmptyState
          title="No categories yet."
          body="Add one above; expenses can also stay uncategorized."
        />
      ) : (
        <ul className="divide-y rounded-lg border">
          {categories.map((c) => (
            <li key={c.id} className="space-y-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <span>
                  {c.icon ? `${c.icon} ` : ''}
                  {c.name}
                </span>
                <form
                  action={async () => {
                    'use server'
                    await deleteCategory({ id: c.id })
                  }}
                >
                  <button
                    className="p-2 text-sm text-red-600"
                    aria-label={`Delete ${c.name}`}
                  >
                    Delete
                  </button>
                </form>
              </div>
              {/* Native <details> disclosure reveals the edit form full-width without any
                  client state, since this row lives in a server component. */}
              <details>
                <summary className="cursor-pointer list-none text-sm text-blue-600">
                  Edit
                </summary>
                <div className="mt-2">
                  <CategoryForm existing={c} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
