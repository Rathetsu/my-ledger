# ADR: Live rates for aggregates; daily snapshots for history; one idempotent housekeeping routine

**Status:** accepted 2026-07-07

## Decision

FX rates come from the free, keyless `open.er-api.com`, cached in `exchange_rates` with a hardcoded seed row in the initial migration (cold-start) and last-good fallback; aggregate figures display rate staleness. The combined net-worth headline uses **live rates** (a "quick idea" number). Historical trends come from **daily snapshots** (`UNIQUE(user_id, date)`) storing per-currency totals, **the day's rates**, combined value, home currency, and total debt - so charts re-derive combined values in any later home currency and history never rewrites. All periodic work lives in one idempotent `housekeeping(userId, today)` routine - generate current+next-period occurrences (`ON CONFLICT DO NOTHING`), flip pending→overdue, upsert today's snapshot, refresh stale rates - called lazily on dashboard load **and** by a Vercel cron (`vercel.json` crons → `CRON_SECRET`-guarded route; Hobby tier: once daily, ±59 min). Day boundaries: `Africa/Cairo`, due dates clamp to `min(due_day, last_day_of_month)`.

## Why

Free tier has today-only rates; snapshots are the only honest free history. Storing each day's rates survives home-currency switches (audit finding). One shared routine gives cron and lazy paths identical, duplicate-safe behavior - the cron is just a scheduler for reliability on days the app isn't opened.

## Rejected

- **Paid historical FX APIs**: cost for a personal app; EGP coverage poor on free alternatives.
- **Recomputing history at current rates**: history rewrites itself as EGP moves; misleading trends.
- **Cron-only (no lazy fallback)**: Hobby cron is best-effort; a missed day would leave permanent gaps.
- **Storing only the combined number per snapshot**: breaks the moment home currency changes.
