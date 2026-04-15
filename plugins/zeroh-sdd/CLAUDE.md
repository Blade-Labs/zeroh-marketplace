# zeroh-sdd — Shape-Driven Development Plugin

## What This Is

A Claude Code plugin that enforces Shape-Driven Development (SDD) on any repo. Thin core with 7 extension points. Zero dependencies — all content is Markdown skills, bash scripts, and JSON config.

## Pipeline

```
specify → clarify → plan → shapes → tasks → implement → analyze
                                                   ↑
                                               rescope (re-entry)
```

## Skills (14)

### Process (11 speckit-* skills)
| Skill | Purpose |
|-------|---------|
| speckit-specify | Create feature spec from natural language |
| speckit-clarify | Ask up to 5 targeted clarification questions |
| speckit-checklist | Generate requirements checklist |
| speckit-constitution | Define project principles |
| speckit-plan | Implementation planning with research |
| speckit-shapes | Shape briefs + fills as RED tests |
| speckit-tasks | Dependency-ordered task generation |
| speckit-taskstoissues | Convert tasks to GitHub issues |
| speckit-implement | Task execution with per-task gates |
| speckit-analyze | Cross-artifact consistency audit |
| speckit-rescope | Surgical artifact invalidation |

### Enforcement (2 SDD skills)
| Skill | Purpose |
|-------|---------|
| criteria-first-tdd | CRITERIA-RED-GREEN-RATCHET cycle, CGTC trust chain, gate types, capitulation detection |
| shape-authoring | Golden shape template — SKOS+PROV-O, Schreiber taxonomy, BFO alignment |

### Bootstrap (1 meta-skill)
| Skill | Purpose |
|-------|---------|
| using-zeroh-sdd | Session bootstrap — loaded on every SessionStart |

## Enforcement Hooks

| Hook | Event | Type | Purpose |
|------|-------|------|---------|
| stop-check | Stop | BLOCKING | Prevents premature completion with uncommitted files |
| ap-detector | PostToolUse (Write/Edit) | ADVISORY | Catches 11 anti-patterns via grep/diff in <200ms |
| commit-hygiene | PostToolUse (Write/Edit) | ADVISORY | Reminds to commit when uncommitted files exceed threshold |
| session-start | SessionStart | LIFECYCLE | Pipeline state reporting + context recovery |
| pre-compact | PreCompact | LIFECYCLE | Preserves context snapshot before memory loss |
| session-end | SessionEnd | LIFECYCLE | Archives session transcript |

## Extension Points

1. **Pipeline hooks** — `templates/extensions.yml` (before/after any phase)
2. **AP registry** — `scripts/hooks/context/ap-registry.md` (add detection patterns)
3. **Context files** — `scripts/hooks/context/*.md` (tune hook behavior)
4. **Skills** — drop `skills/<name>/SKILL.md`
5. **Agents** — drop `agents/<name>.md`
6. **Commands** — drop `commands/<name>.md`
7. **Plugin composition** — install alongside other plugins

## Path Conventions

Skills reference plugin content via these paths:
- **Templates**: `${CLAUDE_PLUGIN_ROOT}/templates/`
- **Scripts**: `${CLAUDE_PLUGIN_ROOT}/scripts/`
- **Extensions**: `${CLAUDE_PLUGIN_ROOT}/templates/extensions.yml`

Artifacts are written to the user's repo:
- **Specs**: `specs/{feature-slug}/`
- **Constitution**: `.specify/memory/constitution.md`

## Core Principles

1. **Shapes are RED tests.** Boundary shapes define contracts before implementation.
2. **CRITERIA-RED-GREEN-RATCHET.** Acceptance criteria → failing tests → passing code → violations can only decrease.
3. **Skills are pure knowledge.** No runtime, no dependencies, no build step.
4. **Shapes consumed by reference.** Skills point to shapes by name — never bundle definitions.
5. **Errors are the debugging interface.** Never swallow, summarize, or "clean up" errors.
6. **Thin core + extension points.** Don't kitchen-sink. Make extending a click away.

## Companion Plugins

- **ui-design-skill** — branded UI generation (Ali, Zeroh GRC, Blade Corporate, Disclosure)

## Version

Update all adapter files when bumping:
- `package.json` → `version`
- `.claude-plugin/plugin.json` → `version`
- `gemini-extension.json` → `version`
- `.copilot/plugin.yaml` → `version`
- `.cursor-plugin/plugin.json` → `version`
