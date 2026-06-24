# zeroh-roadmap — Phase-Driven Development Plugin

A Claude Code plugin that adds phase-driven development with validation gates, review reports, and changelog generation. Zero dependencies — Markdown skills, bash scripts, TypeScript templates.

The skill catalog (auto-loaded) is the source of truth for what skills exist and what they do. Agent definitions are loaded when invoked. Operator-facing setup notes (migration script, version bump, contributor docs) live in README.md.

## Path Conventions

Plugin content via `${CLAUDE_PLUGIN_ROOT}/templates/` and `${CLAUDE_PLUGIN_ROOT}/scripts/`.

User-repo artifacts:
- Schema: `lib/roadmap/schema.ts`
- Backlog: `roadmap/backlog.ts` (ordered queue — first entry is next)
- Phases: `roadmap/phases/*.phase.ts`
- Review reports: `reviews/releases/v*-review.json`
- Dashboard: `reviews/dashboard/index.html`

## Core Principles

1. **One task at a time.** Sequential execution with commit between each.
2. **Know the diff before writing the task.** High-confidence planning.
3. **Validation gate after every phase.** No exceptions.
4. **Zero findings to pass.** Loop agents until clean.
5. **Errors are the debugging interface.** Never swallow, summarize, or "clean up" errors.
6. **`phase.kind` selects the gate set.** Picker rules in plan-phase Step 3.
7. **One task = one commit.** `batchMode: true` is the only escape; sub-agent forks that absorb phase tasks are forbidden — but the arc executor is one agent = one whole phase (not a fork per task), see do-phase Step 4.
