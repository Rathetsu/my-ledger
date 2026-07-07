# ADR: Integer minor units; balances derived, never stored; round-half-up conversion

**Status:** accepted 2026-07-07

## Decision

All amounts are stored as integer minor units (`amount_minor`) plus a currency code - never floats. EUR/USD/EGP all use 2-decimal minor units. Account balances and flexible-debt balances are **derived** by summing linked transactions (debts: `original_minor` + adjustments − `debt_payment` transactions); nothing stores a running total, and DB balances never accrue interest (planner projections use simple monthly interest, `apr/12`, computed on the fly). Currency conversion follows one rule everywhere: convert each per-currency total once, **round half-up** to minor units, then sum - shared by dashboard and snapshots so numbers can never disagree by cents.

## Why

Float money bugs are the classic ledger failure. Derived balances make edits/deletes/un-confirms automatically consistent - no sync bugs between a stored total and its history. Personal-scale data (thousands of rows) sums instantly; caching would be premature.

## Rejected

- **Stored running balances**: desyncs on any edit; the audit found this exact bug in the original `flexible_debts.balance_minor` design.
- **Numeric/decimal columns with fractional math in JS**: still floats at the JS boundary.
- **Posting interest accrual transactions**: phantom entries the user never made; interest is a projection concern, not a ledger fact.
