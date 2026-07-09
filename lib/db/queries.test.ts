import { expect, test, vi } from 'vitest'
import { accountBalanceMinor, totalsByCurrency } from '@/lib/db/queries'

const mockDb = vi.hoisted(() => ({
  balanceRows: [{ total: null }] as { total: string | null }[],
  groupedRows: [] as { currency: string; total: string | null }[],
}))

vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => {
          const p = Promise.resolve(mockDb.balanceRows) as Promise<
            { total: string | null }[]
          > & {
            groupBy: () => Promise<{ currency: string; total: string | null }[]>
          }
          p.groupBy = () => Promise.resolve(mockDb.groupedRows)
          return p
        },
      }),
    }),
  },
}))

test('empty account balance is 0 (SUM over no rows is NULL)', async () => {
  mockDb.balanceRows = [{ total: null }]
  expect(await accountBalanceMinor('any-id')).toBe(0)
})

test('balance coerces the SUM string to a number', async () => {
  mockDb.balanceRows = [{ total: '123456' }]
  expect(await accountBalanceMinor('any-id')).toBe(123456)
})

test('totalsByCurrency maps grouped rows', async () => {
  mockDb.groupedRows = [
    { currency: 'EUR', total: '85000' },
    { currency: 'EGP', total: '515000' },
  ]
  expect(await totalsByCurrency('user-1')).toEqual({ EUR: 85000, EGP: 515000 })
})
