# Docs Index - My Ledger

The map of this repo's documentation. Start here.

## Layers

| Layer | Answers | Location |
|---|---|---|
| Hard rules & commands | What must never break? How do I run things? | [/CLAUDE.md](../CLAUDE.md) |
| Domain language | What do our words mean? | [/CONTEXT.md](../CONTEXT.md) |
| Wiki (current truth, rewritten) | What is true now? | [wiki/architecture.md](wiki/architecture.md), [wiki/status.md](wiki/status.md) |
| ADRs (append-only, date-slug) | Why is it this way? | [adr/](adr/) |
| Stream (append-only, dated) | What did we decide when? | [stream/](stream/) |
| Spec | What are we building? | [superpowers/specs/2026-07-07-my-ledger-design.md](superpowers/specs/2026-07-07-my-ledger-design.md) |
| Implementation plans | How do we build it, step by step? | [superpowers/plans/README.md](superpowers/plans/README.md) (master index → 12 phase plans) |
| Agent process docs | How agents work in this repo | [agents/](agents/) (issue tracker, triage labels, domain docs) |

## Conventions

- ADR filenames are **date-slug** (`2026-07-07-topic.md`), never sequential numbers (parallel agents collide).
- Wiki pages are **rewritten** as current truth, never appended to. History lives in git and `stream/`.
- One fact lives in one place; everything else links to it. The spec is the single source of truth for requirements; ADRs carry rationale and rejected alternatives.
- A task is done only when affected wiki pages are rewritten, ADR-worthy decisions have ADRs, and CLAUDE.md is synced (see the doc gate in the ai-dev-docs skill).
