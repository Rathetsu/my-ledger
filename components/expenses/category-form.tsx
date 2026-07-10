'use client'

import { useState } from 'react'
import { createCategory, updateCategory } from '@/lib/actions/expense-categories'

export function CategoryForm({ existing }: { existing?: { id: string; name: string; icon: string | null } }) {
  const [name, setName] = useState(existing?.name ?? '')
  const [icon, setIcon] = useState(existing?.icon ?? '')
  return (
    <form
      action={async () => {
        const payload = { name, icon: icon || undefined }
        if (existing) await updateCategory({ id: existing.id, ...payload })
        else await createCategory(payload)
        setName('')
        setIcon('')
      }}
      className="flex gap-2"
    >
      <input
        value={icon}
        onChange={(e) => setIcon(e.target.value)}
        placeholder="🛒"
        aria-label="Icon (optional)"
        className="w-14 rounded-lg border p-3 text-center"
      />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Category name"
        aria-label="Category name"
        required
        className="min-w-0 flex-1 rounded-lg border p-3"
      />
      <button type="submit" className="rounded-lg bg-neutral-900 px-4 text-white dark:bg-neutral-100 dark:text-neutral-900">
        {existing ? 'Save' : 'Add'}
      </button>
    </form>
  )
}
