# 2026-07-07 - Grilling session decisions + adversarial audit

Dated record of the design interview (17 questions) and the audit that followed. Current truth lives in the [spec](../superpowers/specs/2026-07-07-my-ledger-design.md) and [wiki](../wiki/architecture.md); this file is evidence, append-only.

## Grilling decisions

1. **Ledger honesty**: ledger + reconciliation ("set actual balance" → `adjustment` txn) over pure-logging or reconciliation-first.
2. **FX freezing**: originally froze rate per transaction; **dissolved by decision 14** (per-currency accounts make transactions conversion-free).
3. **Cross-currency transfers**: two explicit legs (actual sent + actual received); API rate is only a pre-fill suggestion. Chosen over derive-from-API (drifts by the spread) and rate-entry (you know amounts, not rates).
4. **Variable spend estimate**: essentials baseline as seed → blend to trailing 3-month actuals (excluding one-off-tagged), avoiding baseline+actuals double-count.
5. **Freelance**: plan counts guaranteed income only; freelance is a logged windfall that accelerates that month. Chosen over averaging (fragile) and dual projections (overkill).
6. **Installments vs debts**: installments are fixed obligations, never avalanched; high-APR ones flagged only. Flexible debts get the surplus.
7. **Debt vs wishlist**: strict debt-first. Flexible debts gain an optional deadline; deadlined debts are paid just-in-time, releasing slack to the wishlist. (A %-carve-out option was discussed and NOT chosen; a leftover mention was later removed in audit.)
8. **AI role**: deterministic engine owns 100% of numbers; AI is a second opinion ("Algorithm suggests X; AI thinks Y") that quotes, never computes. AI moved from "later" to day one.
9. **AI privacy**: anonymized minimized payload (generic labels, no names/notes) + visible disclosure. Chosen over full detail (free tiers may train on data) and local models (too heavy).
10. **AI output**: free text. The structured closed-action-space option (adopt buttons driving engine knobs) was explicitly declined - plan is advice; user acts and logs manually. Revisitable.
11. **Income confirmation**: editable pre-filled sheet (amount + date), explicit "not yet"/"skip"; posts actuals; plan recalculates.
12. **Installment accounting**: count-based (`remaining_count`). Balance-based was rejected: real installment contracts respond to prepay/skip by policy; the user edits the definition instead.
13. **Recurring bills**: first-class entity with occurrences + confirm flow (posts `bill_payment`). Essentials baseline demoted to variable-only.
14. **Architecture change (user-initiated)**: per-currency accounts; every transaction single-currency; conversion only in aggregates (live) and transfers. Payables pay from same-currency accounts; top up via transfer when short.
15. **Account cardinality**: schema allows multiple accounts per currency; UX optimized for one-per-currency.
16. **Planner currency-awareness**: per-currency obligation grouping vs projected balances → advisory funding-gap transfer suggestions.
17. **Net-worth history**: daily snapshots via Vercel cron (Hobby once/day confirmed in docs) instead of lazy-only or paid historical FX.

## Adversarial audit (20 findings, all resolved into the spec)

Highest-impact: (1) Google-only OAuth blocks Playwright → separate Stack test project with email+password; (2) occurrence generation needed idempotency + status-guarded confirms (multi-device); (3) due-day clamping rule for short months; (4) source-linked transactions mutable only via owning flow; (5) snapshots store the day's rates so home-currency switches don't break trends. Also: single shared `housekeeping()` for cron+lazy paths, account archiving (no hard delete), pending-only occurrence rewrites on definition edits, `bill_payment`≠`expense` (spend-estimate double-count), simple-interest projection convention, settings lazy-upsert, seeded FX row, round-half-up rule, transfer-group atomicity, negative balances allowed, AI cache with bucketed amounts, migrations in Vercel build step.

## Verified against current docs during planning

Stack Auth wiring (StackServerApp/StackProvider/handler/getUser), Drizzle+Neon client split, Next.js server actions + revalidatePath, Vercel cron (vercel.json, Hobby limits, CRON_SECRET), Gemini free tier (`gemini-3-flash-preview` has free API tier; 3.1 Pro does not).
