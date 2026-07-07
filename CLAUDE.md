# my-ledger

Mobile-first Next.js personal money ledger (multi-currency accounts, bills/installments/debts, deterministic payoff planner + AI second opinion). **Docs map: [docs/index.md](docs/index.md). Domain language: [CONTEXT.md](CONTEXT.md) - use its terms exactly.**

Hard rules: money is integer minor units (never floats); no transaction converts currency; all numbers come from the deterministic engine, never the AI; day boundaries are Africa/Cairo.

## Skill routing

Skills are invoked with the Skill tool **before** responding or touching code. Process skills (how to approach the work) come before implementation skills (how to execute it). Where a skill exists both in the `superpowers` plugin and elsewhere, the `superpowers:` version is authoritative.

### Starting work

- Any new feature, component, or behavior change → `superpowers:brainstorming` first, always, even when the request seems clear.
- Multi-step work with agreed requirements → `superpowers:writing-plans`, then execute via `superpowers:executing-plans` (separate session) or `superpowers:subagent-driven-development` (same session).
- Stress-testing a plan or design before building → `grilling`.
- Unsure whether a state model or UI direction is right → `prototype` (throwaway, answers one design question).
- Work that needs isolation from the current tree → `superpowers:using-git-worktrees`.

### Building

- Every feature or bugfix → `superpowers:test-driven-development`. Failing test first, no exceptions the skill itself doesn't allow.
- 2+ independent tasks → `superpowers:dispatching-parallel-agents`.
- Questions about any library, framework, or API → `find-docs` (Context7). Never answer from training data, even for well-known libraries.

### Debugging

- Any bug, test failure, or unexpected behavior → `superpowers:systematic-debugging` before proposing a fix.
- Hard bugs or performance regressions that survive a first pass → `diagnosing-bugs`.

### Decisions and docs

- Significant technical decision (library choice, schema, API contract, pattern) → `ai-dev-docs`, even if nobody asked for documentation.
- Domain terminology or an architectural decision record → `domain-modeling`. This repo is single-context: one `CONTEXT.md` at the root plus `docs/adr/`. See `docs/agents/domain.md`.

### Finishing

- Before claiming anything is complete, fixed, or passing → `definition-of-done`, which composes `superpowers:verification-before-completion`. Evidence before assertions; run the checks, show the output.
- Completed a task or major feature → `superpowers:requesting-code-review`. Received feedback → `superpowers:receiving-code-review` (verify, don't blindly apply).
- Reviewing a branch or diff against spec and repo standards → `review`.
- Work is done and verified → `superpowers:finishing-a-development-branch` to decide merge, PR, or cleanup.

### Meta

- Creating or editing a skill → `superpowers:writing-skills`.

## Issue tracker

Issues and PRDs live in this repo's GitHub Issues (via the `gh` CLI). External PRs are **not** a triage surface. See `docs/agents/issue-tracker.md`. To file bugs conversationally, use the `qa` skill; to plan a refactor as an issue, use `request-refactor-plan`.

### Triage labels

Canonical triage vocabulary - label strings match their role names (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.
