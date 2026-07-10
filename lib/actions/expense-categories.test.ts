import { describe, expect, it } from 'vitest'
import { categorySchema } from './expense-categories'

describe('categorySchema', () => {
  it('accepts a name and optional icon', () => {
    expect(categorySchema.parse({ name: 'Groceries', icon: '🛒' })).toEqual({ name: 'Groceries', icon: '🛒' })
    expect(categorySchema.parse({ name: 'Transport' })).toEqual({ name: 'Transport' })
  })
  it('rejects an empty name', () => {
    expect(() => categorySchema.parse({ name: '' })).toThrow()
  })
})
