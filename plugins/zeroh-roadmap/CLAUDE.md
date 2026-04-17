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
| analyze-phases | Cross-phase consistency auditor (dangling deps, cycles, clarification markers, stale phases) |

### Bootstrap (1 meta-skill)
| Skill | Purpose |
|-------|---------|
| using-zeroh-roadmap | Session bootstrap — loaded on every SessionStart |

## Agents (4)

| Agent | Purpose |
|-------|---------|
| code-reviewer | Bugs, logic errors, pattern adherence |
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

## Version

Update both files when bumping:
- `package.json` → `version`
- `.claude-plugin/plugin.json` → `version`
