# zeroh-sdd

**Shape-Driven Development for AI-assisted coding.**
Shapes as RED tests. Enforcement hooks. Extension points.

```
/plugin install zeroh-sdd@zeroh-marketplace
```

---

## The Problem

LLM-generated codebases exhibit predictable structural failures. Research across 211M lines of code (GitClear), 470 PRs (CodeRabbit), and 304K commits (Liu et al.) documents 10 recurring anti-patterns:

1. **Fat route handlers** — 200-400 LOC inline instead of service layer
2. **Parallel implementations** — `chat/` + `chat-v2/` accumulate; nothing gets deleted
3. **Scattered env reads** — `process.env` everywhere instead of centralized config
4. **Inconsistent error handling** — 3+ patterns mixed across files
5. **Type assertion abuse** — `as any` density exceeds 18%
6. **Naming drift** — camelCase/snake_case/PascalCase mixed within one codebase
7. **Structural tests** — "does file export X?" instead of "does function enforce invariant Y?"
8. **Dead code accumulation** — `if: false` blocks, commented-out code, unreachable branches
9. **Blurred module boundaries** — circular dependencies, internal imports crossing zones
10. **JSDoc bloat** — 20-40 line headers that duplicate the code below

**Root causes:** Local optimization without global coherence. Additive bias (LLMs add, rarely delete). Training distribution leakage (patterns from training data, not project conventions).

**Existing tools address fragments.** spec-kit creates specs but can't enforce implementation. Superpowers documents TDD but relies on honor system. Neither combines schema enforcement + ratcheting + trust chains + evidence emission.

---

## What zeroh-sdd Does

zeroh-sdd teaches AI agents Shape-Driven Development — a methodology where **Zod schemas define contracts BEFORE implementation**, and **hooks enforce those contracts mechanically**.

**Five novel contributions:**

1. **Shapes as RED tests** — A Zod shape IS the acceptance criterion. `safeParse()` IS the test. One artifact, two roles.
2. **CRITERIA-RED-GREEN-RATCHET** — Acceptance criteria first. Failing tests. Passing code. Violations can only decrease.
3. **CGTC trust chain** — 4-layer governance: conventions must lock before discovery, discovery before triangulation, triangulation before downstream metrics.
4. **Test scaffolds from criteria** — The spec decides WHAT to test, not the LLM. Scaffolds are immutable; the LLM fills assertions.
5. **Mechanical enforcement** — PostToolUse hooks catch anti-patterns in <200ms. Stop hooks block premature completion. Not prose suggestions — bash scripts with grep/diff.

---

## Installation

```bash
# Add Blade Labs marketplace (one-time)
/plugin marketplace add Blade-Labs/zeroh-marketplace

# Install the plugin
/plugin install zeroh-sdd@zeroh-marketplace

# Optional: UI design companion plugin
/plugin install ui-design-skill@zeroh-marketplace

# Enable auto-updates for private repo (add to .bashrc/.zshrc)
export GITHUB_TOKEN=ghp_xxx
```

**Zero dependencies.** No npm install. No build step. Pure markdown, bash, and JSON.

---

## Pipeline

```
specify → clarify → plan → SHAPES → tasks → implement → analyze
                                                   ↑
                                               rescope
```

| Phase | Produces | What happens |
|-------|----------|-------------|
| **specify** | spec.md | Capture WHAT to build and WHY from natural language |
| **clarify** | Updated spec | Ask up to 5 targeted questions to resolve ambiguity |
| **plan** | plan.md | Architecture decisions, component breakdown, dependencies |
| **shapes** | shape-briefs/ | Boundary contracts as Zod schemas — these ARE the RED tests |
| **tasks** | tasks.md | Dependency-ordered, atomic implementation steps |
| **implement** | Code + tests | Execute tasks with per-task gates (lint, typecheck) |
| **analyze** | Findings | Cross-artifact consistency audit |
| **rescope** | Updated artifacts | Surgical invalidation when scope changes (preserves research) |

---

## Skills (14)

| Skill | Slash Command | Purpose |
|-------|--------------|---------|
| speckit-specify | `/zeroh-sdd:speckit-specify` | Create feature spec from natural language |
| speckit-clarify | `/zeroh-sdd:speckit-clarify` | Ask up to 5 targeted clarification questions |
| speckit-checklist | `/zeroh-sdd:speckit-checklist` | Generate requirements checklist ("unit tests for English") |
| speckit-constitution | `/zeroh-sdd:speckit-constitution` | Define or update project principles |
| speckit-plan | `/zeroh-sdd:speckit-plan` | Implementation planning with research phase |
| speckit-shapes | `/zeroh-sdd:speckit-shapes` | Shape briefs + fills as RED tests |
| speckit-tasks | `/zeroh-sdd:speckit-tasks` | Dependency-ordered task generation |
| speckit-taskstoissues | `/zeroh-sdd:speckit-taskstoissues` | Convert tasks to GitHub issues |
| speckit-implement | `/zeroh-sdd:speckit-implement` | Execute tasks with per-task mechanical gates |
| speckit-analyze | `/zeroh-sdd:speckit-analyze` | Cross-artifact consistency audit |
| speckit-rescope | `/zeroh-sdd:speckit-rescope` | Surgical artifact invalidation after scope change |
| criteria-first-tdd | `/zeroh-sdd:criteria-first-tdd` | CRITERIA-RED-GREEN-RATCHET cycle enforcement |
| shape-authoring | `/zeroh-sdd:shape-authoring` | Golden Zod shape template with SKOS+PROV-O metadata |
| using-zeroh-sdd | *(auto-loaded)* | Session bootstrap — skill inventory, pipeline state |

---

## Enforcement Hooks

These fire automatically. No invocation needed.

| Hook | Event | Type | What it catches |
|------|-------|------|----------------|
| **stop-check** | Stop | BLOCKING | Premature "I'm done!" with uncommitted files |
| **ap-detector** | PostToolUse (Write/Edit) | ADVISORY | 11 anti-patterns via grep/diff in <200ms |
| **commit-hygiene** | PostToolUse (Write/Edit) | ADVISORY | Commit batching (>3 uncommitted files) |
| **session-start** | SessionStart | LIFECYCLE | Pipeline state, context recovery after compaction |
| **pre-compact** | PreCompact | LIFECYCLE | Context snapshot before memory loss |
| **session-end** | SessionEnd | LIFECYCLE | Session transcript archival |

**Anti-patterns detected** (from `scripts/hooks/context/ap-registry.md`):

| ID | Pattern | What it catches |
|----|---------|----------------|
| AP-ERR-01 | `return null` in catch block | Error swallowing |
| AP-ERR-02 | New `handle*Error` function | Bypass of canonical error utility |
| AP-ANY-01 | `as any` count > 3 per file | Type assertion abuse |
| AP-DOC-01 | `--no-verify` in git | Commit hook bypass |
| AP-IGN-01 | `@ts-ignore` without comment | Suppression without justification |
| AP-ENV-01 | `process.env` outside config/ | Scattered environment reads |
| AP-LOG-01 | `console.log` in prod code | Debug logging left behind |
| AP-CAP-01 | `toThrow` → `toBeUndefined` | Test assertion weakened |
| AP-CAP-02 | Test count decreased | Test removed or skipped |
| AP-CAP-03 | Gate severity downgraded | Gate weakened |

---

## What Makes This Different

| Dimension | Superpowers | spec-kit | Kiro | **zeroh-sdd** |
|-----------|------------|----------|------|-----------|
| **Enforcement** | Honor system | None | None | **Hooks catch APs in <200ms** |
| **Test philosophy** | TDD (prose) | None | None | **CRITERIA-RED-GREEN-RATCHET** |
| **Shapes** | None | None | None | **Zod schemas as RED tests** |
| **Trust chain** | None | None | None | **CGTC 4-layer governance** |
| **Blocking hooks** | 0 | 0 | 0 | **1 (Stop: premature completion)** |
| **Advisory hooks** | 0 | 0 | 0 | **2 (AP detection + commit hygiene)** |
| **Extension model** | Skills only | Extensions + presets | None | **7 extension points** |
| **Multi-agent** | 6 platforms | 28 platforms | VS Code only | **5 platforms** |

---

## Multi-Agent Support

zeroh-sdd works on multiple AI coding platforms:

| Platform | Config | Skills format |
|----------|--------|--------------|
| **Claude Code** | `.claude-plugin/plugin.json` | SKILL.md (native) |
| **Gemini CLI** | `gemini-extension.json` | SKILL.md via GEMINI.md |
| **GitHub Copilot** | `.copilot/plugin.yaml` | SKILL.md |
| **Cursor** | `.cursor-plugin/plugin.json` | SKILL.md |
| **Codex** | `.codex/INSTALL.md` | SKILL.md |

SKILL.md follows the [agentskills.io](https://agentskills.io) standard, supported by 30+ AI coding tools.

---

## Companion Plugins

zeroh-sdd focuses on methodology. Aesthetics and domain knowledge are separate plugins:

- **[ui-design-skill](https://github.com/Blade-Labs/ui-design-skill)** — Branded UI generation with design system themes

Future extension packs (install alongside zeroh-sdd):
- `zeroh-agents` — 12 specialized agents (architect, reviewer, debugger, etc.)
- `zeroh-eval` — Quality evaluation framework (7 evaluators)
- `zeroh-sprint` — Sprint lifecycle management

---

## Extending

zeroh-sdd has 7 extension points. Extending is designed to be a single-file operation.

### Add an AP detection pattern

Edit `scripts/hooks/context/ap-registry.md`. Add a row:

```markdown
| AP-XXX-01 | `your-regex-pattern` | *.ts | Your warning message | How to fix it |
```

Next session, the hook catches this pattern automatically.

### Add a pipeline phase hook

Copy `templates/extensions.yml` to `.specify/extensions.yml` in your project. Add:

```yaml
hooks:
  after_tasks:
    - command: my-custom-check
      optional: true
      prompt: "Run custom validation?"
```

### Add a skill, agent, or command

Drop a file in the appropriate directory:
- `skills/<name>/SKILL.md` — auto-discovered by Claude
- `agents/<name>.md` — specialized subagent
- `commands/<name>.md` — slash command

### Tune hook behavior

Edit any file in `scripts/hooks/context/*.md`. These are plain markdown templates the hooks read at runtime.

---

## License

[Apache-2.0](LICENSE)
