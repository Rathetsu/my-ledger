# ADR: AI advisor contract - free-text second opinion, anonymized payload, Gemini free tier

**Status:** accepted 2026-07-07

## Decision

From day one the plan screen shows a side-by-side second opinion: "Algorithm suggests X; the AI, given the numbers, thinks Y." The deterministic engine owns every number; the AI **quotes engine figures and never computes or invents new ones** (prompt-enforced). Output is **free text** - no structured actions, no adopt buttons; the user decides, acts, and logs manually. The payload is **anonymized and minimized by construction**: structured numbers with generic labels (`debtA: 12000 EGP, 0% APR, no deadline`), no account/counterparty names, no free-text notes; a visible "what gets sent" disclosure shows the exact payload. Provider: Gemini API free tier, model `gemini-3-flash-preview` (verified July 2026: free API tier exists; Gemini 3.1 Pro has none), configurable via `GEMINI_MODEL` env var for when the preview graduates. Advice is cached keyed on a hash of the sanitized payload with amounts bucketed to ~5%, regenerating only on hash change or manual refresh (protects the small free-tier quota). The prompt pack (system prompt, input shape, few-shot examples, "quote, never compute" guardrails) is a first-class artifact in the P9 plan. The app is fully functional with AI disabled or unreachable.

## Why

LLMs are confidently bad at arithmetic - in a money app a hallucinated number is the worst failure, so the engine/AI boundary is absolute. Free tiers may retain/train on data, so the payload is safe even if retained. Free-model weakness makes prompt engineering the feature: few-shot + tight constraints.

## Rejected

- **AI computes or adjusts the plan**: hallucinated financial math; breaks when rate-limited; non-reproducible.
- **Structured output with closed action enums + adopt buttons**: explicitly declined by the user - the plan is advice; may be revisited.
- **Full-detail payload**: identifiable financial life in a training set for marginally richer phrasing.
- **Local model**: too heavy for a personal Vercel app.
