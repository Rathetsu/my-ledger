import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
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
  sourceType: text('source_type'), // 'income_occurrence' | 'bill_occurrence' | 'installment_occurrence' (P3+); null = plain row
  sourceId: uuid('source_id'),
  transferGroupId: uuid('transfer_group_id'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => [
  // Balance derivation sums by account; totalsByCurrency groups by (user, currency).
  index('transactions_account_id').on(t.accountId),
  index('transactions_user_currency').on(t.userId, t.currency),
])

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

export const occurrenceKind = pgEnum('occurrence_kind', [
  'income',
  'bill',
  'installment',
])
export const occurrenceStatus = pgEnum('occurrence_status', [
  'pending',
  'confirmed',
  'skipped',
  'overdue',
])

export const incomeSources = pgTable('income_sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  amountMinor: integer('amount_minor').notNull(),
  currency: currencyEnum('currency').notNull(),
  dayOfMonth: integer('day_of_month').notNull(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  recurring: boolean('recurring').notNull().default(true),
  active: boolean('active').notNull().default(true),
})

export const bills = pgTable('bills', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  amountMinor: integer('amount_minor').notNull(),
  currency: currencyEnum('currency').notNull(),
  dueDay: integer('due_day').notNull(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  categoryId: uuid('category_id'), // FK to expense_categories added in P6 when that table exists
  active: boolean('active').notNull().default(true),
})

export const installments = pgTable('installments', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  monthlyAmountMinor: integer('monthly_amount_minor').notNull(),
  currency: currencyEnum('currency').notNull(),
  dueDay: integer('due_day').notNull(),
  totalCount: integer('total_count').notNull(),
  remainingCount: integer('remaining_count').notNull(),
  startDate: date('start_date', { mode: 'string' }).notNull(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  apr: doublePrecision('apr'), // nullable; a rate, not money, so float is fine
  active: boolean('active').notNull().default(true),
})

export const occurrences = pgTable(
  'occurrences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    kind: occurrenceKind('kind').notNull(),
    sourceId: uuid('source_id').notNull(),
    period: text('period').notNull(), // 'YYYY-MM'
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    expectedAmountMinor: integer('expected_amount_minor').notNull(),
    status: occurrenceStatus('status').notNull().default('pending'),
    transactionId: uuid('transaction_id').references(() => transactions.id),
  },
  (t) => [
    uniqueIndex('occurrences_user_kind_source_period').on(
      t.userId,
      t.kind,
      t.sourceId,
      t.period,
    ),
    // Housekeeping overdue-flip + attention-window scans filter on these.
    index('occurrences_user_status_due').on(t.userId, t.status, t.dueDate),
  ],
)

export const expenseCategories = pgTable('expense_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  icon: text('icon'),
})

export const flexibleDebts = pgTable('flexible_debts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  originalMinor: integer('original_minor').notNull(),
  currency: currencyEnum('currency').notNull(),
  apr: doublePrecision('apr').notNull().default(0),
  deadline: date('deadline'),
  minPaymentMinor: integer('min_payment_minor'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})
