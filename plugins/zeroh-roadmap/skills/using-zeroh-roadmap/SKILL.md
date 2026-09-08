---
name: "Using zeroh-roadmap"
description: "Plan and execute requested roadmap work through native agents and typed progress. Do not turn every small edit into an arc."
user-invocable: true
---

# Using zeroh-roadmap

Use Roadmap when the user requests phases, arcs or durable roadmap progress. A small fix can stay a small fix. User instructions and existing authorization take precedence; do not create a planning ceremony around already approved work.

| Request | Action |
|---|---|
| Plan one phase / add an outcome | `plan-phase` |
| Plan an arc | `plan-arc` |
| Execute / resume a phase or arc | `do-phase` / `do-arc` |
| Review a phase | `review-phase` |
| Judge a built arc against intent | `validate-arc` |
| Pre-merge arc check | `arc-sweep` |
| Show progress / what's next | `roadmap status`, then read the typed records and dependencies |
| Diff review / whole-codebase review | `code-reviewer` / `full-code-review` |
| Release debt / structure audit / handoff | `release-sweep` / `audit-roadmap` / `handoff` |

The native supervising session runs the loop. Read [MULTI-DRIVER.md](../../MULTI-DRIVER.md) for dispatch and independence. Do not launch a workflow module, detached driver or a second orchestration CLI.

The CLI only scaffolds, reserves ownership, reports facts and validates typed files. Use the installed `roadmap` executable, or `node <actual-plugin-root>/bin/roadmap.mjs`. Discover the actual root; never copy a developer's absolute checkout path. Read `references/layout.md` for root discovery and legacy consumers.

Before editing an existing arc, acquire its exclusive work claim. Phase-number allocation is separate. Read the backlog and dependencies before selecting work; shared ownership does not prove two different arcs have disjoint files. Use isolated worktrees and explicit file ownership for concurrent edits, subject to the host's resource admission.

New project: if Greenfield is available, consult its PRD interview and selected project recipe before implementation. Reuse supplied answers and approval. Existing project: inspect its architecture, test and run-command homes; optionally offer missing practices. Declining those suggestions does not block Roadmap initialization. If Greenfield is unavailable, use the project's guidance and state any unresolved foundation choice; installing another plugin is not a prerequisite.

Read only relevant references: `documentation-rules.md` for docs; `test-worthiness.md` for checks; `component-structure.md` for UI organization; `external-assets-licensing.md` for external assets. These are guidance subordinate to the consumer's own standards, not extra review stages.
