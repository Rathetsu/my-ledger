import {
  boolean,
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

// Keep the Better Auth tables (generated in P0) part of the Drizzle schema,
// or db:generate will try to drop them.
export * from './auth-schema'

export const currencyEnum = pgEnum('currency', ['EUR', 'USD', 'EGP'])

export const TRANSACTION_TYPES = [
  'opening',
  'income',
  'expense',
  'bill_payment',
  'installment_payment',
  'debt_payment',
  'purchase',
  'transfer_in',
  'transfer_out',
  'adjustment',
] as const

export const transactionTypeEnum = pgEnum('transaction_type', TRANSACTION_TYPES)

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  currency: currencyEnum('currency').notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  type: transactionTypeEnum('type').notNull(),
  // Signed integer minor units: inflows positive, outflows negative.
  amountMinor: integer('amount_minor').notNull(),
  currency: currencyEnum('currency').notNull(),
  categoryId: uuid('category_id'), // FK to expense_categories lands in P6
  occurredOn: date('occurred_on').notNull(),
  note: text('note'),
  oneOff: boolean('one_off').notNull().default(false),
  sourceType: text('source_type'), // 'income' | 'bill' | 'installment' (P3+); null = plain row
  sourceId: uuid('source_id'),
  transferGroupId: uuid('transfer_group_id'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

// Single row, base USD; getRates() refreshes it when older than 24h.
export const exchangeRates = pgTable('exchange_rates', {
  base: text('base').primaryKey(),
  rates: jsonb('rates')
    .$type<Record<'EUR' | 'USD' | 'EGP', number>>()
    .notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
})

export const settings = pgTable('settings', {
  userId: text('user_id').primaryKey(),
  homeCurrency: currencyEnum('home_currency').notNull().default('EUR'),
  essentialsBaseline: jsonb('essentials_baseline').$type<
    Partial<Record<'EUR' | 'USD' | 'EGP', number>>
  >(),
  aiEnabled: boolean('ai_enabled').notNull().default(true),
})
