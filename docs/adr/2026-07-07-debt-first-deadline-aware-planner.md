# ADR: Deterministic debt-first planner with deadline slack; currency-aware funding gaps

**Status:** accepted 2026-07-07

## Decision

The payoff plan is computed by a pure, unit-tested deterministic engine that owns 100% of all numbers. Monthly surplus = guaranteed income − bills − installment obligations − variable spend estimate (essentials baseline seeding a blend toward trailing 3-month `expense` actuals, excluding `one_off` rows, once ≥3 months exist), in home currency at live rates. Allocation is **strict debt-first**: deadline-required and minimum payments first, then ASAP flexible debts by APR (avalanche); flexible debts with a **deadline** are paid just-enough to finish on time, and the released **deadline slack** (plus post-debt surplus) funds the wishlist (target-dated items first, then priority). Installments are fixed obligations - never avalanched; pathologically high-APR ones get flagged only. The planner is **currency-aware**: it groups each month's obligations by currency against projected account balances and emits advisory funding-gap transfer suggestions ("EGP needs 15,000; EGP accounts hold 6,000 → transfer ≈ €170"). Freelance/windfall income is never projected; when logged, that month's plan accelerates.

## Why

Deadlines are how the user actually thinks about debts ("no rush until October"); just-in-time scheduling frees real money for wishlist morale without compromising obligations. Currency-awareness makes the plan executable - it says what to move, not just what to pay. Determinism makes every figure reproducible and testable.

## Rejected

- **Percentage wishlist carve-out**: discussed and declined; deadline slack is the only pre-debt-free wishlist funding.
- **Unified avalanche including installments**: mathematically optimal but contradicts the user's fixed-obligation mental model.
- **Averaged freelance in surplus**: plans that promise dates based on maybe-income get abandoned when they slip.
- **Snowball default**: avalanche saves more; morale is handled by deadline slack instead.
