# Library index

Every skill the company shares, in one flat library, grouped by category. A
playbook is just a skill: process encoded as a `SKILL.md` the agent activates.
Install the whole library; the agent loads the right skill when the work calls
for it.

Categories: `planning`, `engineering`, `quality`, `docs`, `meta`.

## planning

| Skill           | What it's for                                        |
| --------------- | ---------------------------------------------------- |
| `brainstorming` | Explore intent and design before building anything.  |
| `writing-plans` | Turn a spec into a step-by-step implementation plan. |

## engineering

| Skill                            | What it's for                                        |
| -------------------------------- | ---------------------------------------------------- |
| `test-driven-development`        | Write the failing test first, then the code.         |
| `executing-plans`                | Work a written plan with review checkpoints.         |
| `subagent-driven-development`    | Run plan tasks through subagents in one session.     |
| `dispatching-parallel-agents`    | Split independent work across parallel agents.       |
| `using-git-worktrees`            | Isolate work in a worktree before touching the tree. |
| `finishing-a-development-branch` | Land, PR, or clean up completed branch work.         |

## quality

| Skill                            | What it's for                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| `definition-of-done`             | The single "am I done?" gate: composes verification, the doc gate, and the repo's own gates. |
| `systematic-debugging`           | Find root cause with evidence before proposing fixes.                                        |
| `verification-before-completion` | Prove work done with command output, not assertions.                                         |
| `requesting-code-review`         | Get your work reviewed before merging.                                                       |
| `receiving-code-review`          | Act on review feedback with technical rigor.                                                 |

## docs

| Skill         | What it's for                                                                                                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai-dev-docs` | The documentation discipline for AI-built repos: wiki, ADRs, stream, doc gate. Carries a repo bootstrap (`template/`, `BOOTSTRAP.md`) and the full reference (`documentation-intelligence.md`) bundled in the skill. |

## meta

| Skill            | What it's for                                  |
| ---------------- | ---------------------------------------------- |
| `writing-skills` | Author and verify new skills for this library. |

## Categorization

Categories live here, in the index. Skills vendored from upstream keep their
original frontmatter untouched so re-vendoring stays clean (see
`../../vendor/superpowers.lock`). Skills we author ourselves declare their
category in frontmatter:

```yaml
---
name: incident-response
description: ...
category: ops
---
```

When you add a skill, drop it in `skills/`, add a row here under its category,
and bump the plugin version.
