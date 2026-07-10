export function CategoryPicker({
  categories,
}: {
  categories: { id: string; name: string; icon: string | null }[]
}) {
  return (
    <label className="block">
      <span className="text-sm">Category</span>
      <select
        name="categoryId"
        defaultValue=""
        className="mt-1 w-full rounded border p-3"
      >
        <option value="">No category</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.icon ? `${c.icon} ` : ''}
            {c.name}
          </option>
        ))}
      </select>
    </label>
  )
}
