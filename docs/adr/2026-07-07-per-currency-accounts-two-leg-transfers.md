# ADR: Per-currency accounts; transactions never convert; transfers carry two explicit legs

**Status:** accepted 2026-07-07

## Decision

Money lives in accounts, each fixed to one currency (EUR/USD/EGP; multiple accounts per currency allowed, UX assumes few). **Every transaction is single-currency inside one account.** Currency conversion exists only: (a) at display/planning time using live cached rates, and (b) inside cross-currency transfers, entered as **two explicit legs** - actual amount sent and actual amount received - linked by `transfer_group_id`, with the live rate only pre-filling a suggestion. Payables and purchases pay from same-currency accounts; when short, the app advises a transfer first. Negative balances are allowed (ledger honesty over enforcement).

## Why

User's reality: EUR salary, USD freelance/debts, EGP debts/purchases, each spent in its own currency. Making transactions conversion-free eliminates the hardest planning problem: per-transaction FX freezing and free historical-rate lookups (the free API has today-only rates; historical EGP data is paid). Two-leg transfers record the rate you *actually got* (bank spread included), so balances stay truthful.

## Rejected

- **Single balance + per-transaction conversion with frozen rates**: required historical rates we cannot get for free; rewrote history or lied by the spread.
- **Auto-computed transfer destination from API rate**: systematically wrong by the bank spread; drift defeats reconciliation.
- **Exactly one account per currency (hard rule)**: costs nothing to allow more in schema; hard rule would block bank-vs-cash separation later.
- **Blocking payments on insufficient balance**: the ledger records reality; it does not enforce it.
