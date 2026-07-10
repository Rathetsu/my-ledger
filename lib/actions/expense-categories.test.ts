import { describe, expect, it } from 'vitest'
import { categoryInput } from './schemas'

describe('categoryInput', () => {
  it('accepts a name and optional icon', () => {
    expect(categoryInput.parse({ name: 'Groceries', icon: '🛒' })).toEqual({ name: 'Groceries', icon: '🛒' })
    expect(categoryInput.parse({ name: 'Transport' })).toEqual({ name: 'Transport' })
  })
  it('rejects an empty name', () => {
    expect(() => categoryInput.parse({ name: '' })).toThrow()
  })
})
