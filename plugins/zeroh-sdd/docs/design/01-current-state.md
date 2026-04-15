# Current State: zeroh-sdd Plugin

**Date:** 2026-04-10
**Repo:** Blade-Labs/zeroh-sdd (main branch)
**Published via:** Blade-Labs/zeroh-marketplace

---

## What Ships Today

A Claude Code plugin delivering **Shape-Driven Development** methodology via 14 skills, 8 hooks, and 7 extension points. Zero npm dependencies — pure Markdown, bash, and JSON.

### Install

```bash
claude plugin install zeroh-sdd  # via zeroh-marketplace
```

### File Inventory (47 files)

```
zeroh-sdd/
├── .claude-plugin/plugin.json        # Claude Code manifest
├── .codex/INSTALL.md                 # Codex adapter
├── .copilot/plugin.yaml              # Copilot adapter
├── .cursor-plugin/plugin.json        # Cursor adapter
├── gemini-extension.json             # Gemini adapter
├── GEMINI.md                         # Gemini entry point
├── hooks/hooks.json                  # 8 hooks across 6 events
├── hook-overrides.json               # Per-project customization template
├── skills/ (14 SKILL.md files)
│   ├── using-zeroh-sdd/              # Bootstrap (SessionStart)
│   ├── speckit-{11 skills}/          # Development pipeline
│   ├── criteria-first-tdd/           # TDD enforcement
│   └── shape-authoring/              # Shape template
├── scripts/
│   ├── hooks/ (8 hook scripts)       # Enforcement gradient
│   │   ├── session-start.sh          # Lifecycle: pipeline state
│   │   ├── phase-context.sh          # PreToolUse: file-type JIT context
│   │   ├── ap-detector.sh            # PostToolUse: 15+ anti-patterns
│   │   ├── commit-hygiene.sh         # PostToolUse: commit reminders
│   │   ├── pre-compact.sh            # PreCompact: context snapshot
│   │   ├── stop-check.sh             # Stop: uncommitted work block
│   │   ├── stop-quality-gate.sh      # Stop: quality gate enforcement
│   │   └── session-end.sh            # SessionEnd: transcript archive
│   ├── create-new-feature.sh
│   ├── check-prerequisites.sh
│   ├── setup-plan.sh
│   ├── per-task-gate.sh
│   ├── update-agent-context.sh
│   └── common.sh
├── templates/ (8 files)
│   ├── spec-template.md
│   ├── plan-template.md
│   ├── tasks-template.md
│   ├── checklist-template.md
│   ├── constitution-template.md
│   ├── agent-file-template.md
│   ├── claude-template.md
│   └── extensions.yml
├── agents/.gitkeep
├── commands/.gitkeep
├── CLAUDE.md
├── CONTRIBUTING.md
├── CHANGELOG.md
├── README.md
├── LICENSE
└── package.json
```

### Enforcement Gradient (Current)

```
LIGHTEST ─────────────────────────────────────────────── HEAVIEST

Context     Warn (advisory)    Block (prevent)
   │             │                    │
SessionStart  phase-context      stop-check
bootstrap     ap-detector        stop-quality-gate
              commit-hygiene
```

### Hook Architecture (Current)

| # | Script | Event | Gradient | Detects |
|---|--------|-------|----------|---------|
| 1 | session-start.sh | SessionStart | Context | Pipeline state, context recovery |
| 2 | phase-context.sh | PreToolUse (Write/Edit) | Warn | File type → checklist injection |
| 3 | ap-detector.sh | PostToolUse (Write/Edit) | Warn | 15+ anti-patterns (grep + diff) |
| 4 | commit-hygiene.sh | PostToolUse (Write/Edit) | Warn | Uncommitted file accumulation |
| 5 | pre-compact.sh | PreCompact | Context | Snapshot before memory loss |
| 6 | stop-check.sh | Stop | Block | Uncommitted work on feature branch |
| 7 | stop-quality-gate.sh | Stop | Block | Quality gate enforcement |
| 8 | session-end.sh | SessionEnd | Context | Transcript archival |

### Anti-Pattern Coverage (Current: 18 patterns)

**Tier 1 — Grep (<100ms, any file):** AP-ERR-01/02, AP-ANY-01, AP-DOC-01, AP-IGN-01, AP-LOG-01, AP-WIRE-01/02/03/04, AP-SHAPE-01/02/03, AP-TEST-01, AP-FAT-01, AP-ENV-01

**Tier 2 — Diff (<200ms, test files):** AP-CAP-01/02/03

### Skill Architecture (Current)

14 skills organized as a pipeline:
```
specify → clarify → checklist → constitution → plan → shapes → tasks → implement → analyze
                                                                              ↑
                                                                          rescope
```

With extension hooks (extensions.yml):
- after_plan: shapes (mandatory) + TDD gate design (mandatory) + patterns check (optional)
- before_implement: RED tests from criteria (mandatory)
- after_implement: wire-check (mandatory)

### What's Working Well

1. **AP detector catches real issues** — 18 patterns covering error handling, wiring, shapes, tests, security
2. **Phase-context injects relevant guidance** — file type → checklist before write
3. **Hook overrides enable customization** — per-project allow/deny/ask per file type
4. **Skills encode deep decision trees** — 14 DTs in criteria-first-tdd alone
5. **5-platform distribution** — Claude Code, Cursor, Codex, Gemini, Copilot

### What's Missing

1. **No type-level steering** — hooks detect patterns via grep, not via Zod safeParse
2. **No shape-aware validation** — ap-detector doesn't know what shape a file SHOULD conform to
3. **No correction loop** — warnings are fire-and-forget; no verification that LLM actually fixed the issue
4. **No runtime wiring teaching** — skills teach shape creation, not where to call safeParse at boundaries
5. **No testing gradient** — per-task gate exists but no per-file, per-phase, or continuous verification
6. **No business rule depth** — 91% of monorepo shapes are structural only (Tier 1 of 9 Zod tiers)
7. **No UI design skill** — blade-design split to separate companion plugin (ui-design-skill)
