# zeroh-roadmap — Phase-Driven Development Plugin

## What This Is

A Claude Code plugin that adds phase-driven development with validation gates, review reports, and changelog generation to any project. Zero dependencies — all content is Markdown skills, bash scripts, and TypeScript templates.

## Skills (8)

### Process (3 phase lifecycle skills)
| Skill | Purpose |
|-------|---------|
| do-phase | Execute a phase task-by-task with sequential discipline |
| plan-phase | Create new phases with high-confidence task design |
| review-phase | Verify completed work or audit plan quality |

### Quality (4 review skills)
| Skill | Purpose |
|-------|---------|
| code-review | Confidence-filtered code review (>=80% only) |
| full-code-review | Pre-release gate with 8 parallel specialist agents |
| test-strategy | Test pyramid, coverage targets, conventions |
| audit-roadmap | Cross-phase structural audit (dangling deps, cycles, clarification markers, stale phases) |

### Bootstrap (1 meta-skill)
| Skill | Purpose |
|-------|---------|
| using-zeroh-roadmap | Session bootstrap — loaded on every SessionStart. Also runs the 1-line schema-drift check and nudges the user toward the migration script when outdated. |

## Migration tools (not a skill, not scaffolded)

`scripts/migrate/audit.ts` is a one-off upgrade tool. It lives in the plugin,
`scaffold-roadmap.sh` deliberately skips it, and there is no permanent skill
for it. Discovery is via the SessionStart drift check in `using-zeroh-roadmap`
and the routing row that maps "migrate roadmap" directly to the script
invocation. Run from a target project root:

```bash
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/migrate/audit.ts
```

## Agents (6)

| Agent | Purpose |
|-------|---------|
| architect-critique | Shortcut hunter — auto-fixes hardcodes, TODOs, and pre-existing issues in touched files. Runs as the first stage of the `do-phase` gate (one-shot), before simplifier. Surfaces only true hard-stops (multi-repo breaking changes, scoped-out systems, product decisions, speculative fixes). |
| code-reviewer | Bugs, logic errors, pattern adherence |
| simplifier | Taste pass — removes dead scaffolding, speculative abstractions, redundant error handling, and any over-extraction the architect-critique may have introduced. Runs as Round 0 of the `do-phase` gate (one-shot), after architect-critique. |
| software-architect | Architecture blueprints, decisive design |
| software-developer | Implementation with existing patterns |
| test-engineer | Test writing, coverage enforcement |

## Path Conventions

Skills reference plugin content via these paths:
- **Templates**: `${CLAUDE_PLUGIN_ROOT}/templates/`
- **Scripts**: `${CLAUDE_PLUGIN_ROOT}/scripts/`

Artifacts are written to the user's repo:
- **Schema**: `lib/roadmap/schema.ts`
- **Backlog**: `roadmap/backlog.ts` (ordered execution queue — first entry is next)
- **Phases**: `roadmap/phases/*.phase.ts`
- **Gate results**: `roadmap/phases/*.phase.ts` (gate + metrics fields)
- **Review reports**: `reviews/releases/v*-review.json`
- **Dashboard**: `reviews/dashboard/index.html`

## Core Principles

1. **One task at a time.** Sequential execution with commit between each.
2. **Know the diff before writing the task.** High-confidence planning.
3. **Validation gate after every phase.** No exceptions.
4. **Zero findings to pass.** Loop agents until clean.
5. **Errors are the debugging interface.** Never swallow, summarize, or "clean up" errors.
6. **`phase.kind` drives gate selection.** `mockup` runs typecheck+biome only; `logic` runs the full architect→simplifier→reviewer chain; `hardening` adds the integration-rerun closure rule for persistence/event fixes; `release` adds e2e. Schema v3.
7. **Tasks are one decision, one commit — `task.batchMode` is the explicit escape.** Plan/review reject any task with `files.length > 10` OR `steps.length > 6` unless `batchMode: true`. Default is split. `batchMode` signals genuinely mechanical multi-commit work; do-phase runs the Batch Protocol (TaskCreate per step, commit per step, type-check between). Sub-agent forks for big tasks are forbidden. Schema v4.

## Version

Update both files when bumping:
- `package.json` → `version`
- `.claude-plugin/plugin.json` → `version`
