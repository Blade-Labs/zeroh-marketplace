---
name: Using zeroh-sdd
description: SDD bootstrap — pipeline overview, skill inventory, enforcement hooks, extension points
disable-model-invocation: false
---

# zeroh-sdd: Shape-Driven Development

You have the zeroh-sdd plugin active. This gives you 14 development skills, 6 enforcement hooks, and 7 extension points.

## Pipeline

```
specify → clarify → checklist → constitution → plan → shapes → tasks → implement → analyze
                                                                              ↑
                                                                          rescope
```

## Skills

**Process** (invoke by name or let the model match your task):
| Skill | When to use |
|-------|-------------|
| speckit-specify | Starting a new feature — describe it in natural language |
| speckit-clarify | Spec has gaps — ask up to 5 targeted questions |
| speckit-checklist | Generate requirements checklist from spec |
| speckit-constitution | Define or update project principles |
| speckit-plan | Create implementation plan with research phase |
| speckit-shapes | Produce shape briefs, then fill shapes as RED tests |
| speckit-tasks | Generate dependency-ordered task breakdown |
| speckit-taskstoissues | Convert tasks.md into GitHub issues |
| speckit-implement | Execute tasks with per-task gates |
| speckit-analyze | Cross-artifact consistency audit |
| speckit-rescope | Surgical artifact invalidation after scope change |

**Enforcement**:
| Skill | When to use |
|-------|-------------|
| criteria-first-tdd | CRITERIA-RED-GREEN-RATCHET cycle, CGTC trust chain, gate types, capitulation detection |
| shape-authoring | Golden shape template — Zod authoring with SKOS+PROV-O, Schreiber taxonomy, BFO alignment |

## Enforcement Hooks

These fire automatically — no invocation needed:

| Hook | Event | What it does |
|------|-------|-------------|
| stop-check | Stop | Blocks premature completion when uncommitted files exist |
| ap-detector | PostToolUse (Write/Edit) | Catches 11 anti-patterns in <200ms via grep/diff |
| commit-hygiene | PostToolUse (Write/Edit) | Reminds to commit when uncommitted files exceed threshold |
| session-start | SessionStart | Reports pipeline state, recovers context after compaction |
| pre-compact | PreCompact | Preserves context snapshot before memory loss |
| session-end | SessionEnd | Archives session transcript |

## Companion Plugins

For UI design with branded themes, install **ui-design-skill** separately:
```
/plugin install ui-design-skill@zeroh-marketplace
```

## Extension Points

1. **Pipeline hooks** — edit `extensions.yml` to add before/after hooks on any phase
2. **AP registry** — edit `scripts/hooks/context/ap-registry.md` to detect new anti-patterns
3. **Context files** — edit `scripts/hooks/context/*.md` to tune hook behavior
4. **Skills** — drop `skills/<name>/SKILL.md` to add skills
5. **Agents** — drop `agents/<name>.md` to add specialized agents
6. **Commands** — drop `commands/<name>.md` to add slash commands
7. **Plugin composition** — install additional plugins alongside zeroh-sdd

## SDD Core Idea

Shapes are RED tests. Write the boundary contract (Zod schema) first. It fails because the code doesn't exist yet. Then implement until the shape passes. Violations can only decrease (ratchet).

## Project Detection

Detect the project's framework and suggest relevant skills:
- **New feature request** → start with `speckit-specify`
- **Existing spec, no plan** → `speckit-plan`
- **Plan exists, no tasks** → `speckit-tasks`
- **Tasks exist** → `speckit-implement`

**Conflict detection**: If `.specify/` directory exists (from epic-kit), warn: "This project has epic-kit installed. zeroh-sdd skills will use `${CLAUDE_PLUGIN_ROOT}` paths but scripts may conflict with `.specify/` paths. Consider running `epic uninstall` first or using zeroh-sdd's templates exclusively."
