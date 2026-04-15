# Epic: zeroh-sdd Plugin Infrastructure for Type-Steering

> **Status:** READY FOR EXECUTION
> **Branch:** `claude/schema-driven-steering-design` (zeroh-sdd repo)
> **Date:** 2026-04-10
> **Calibration:** EPIC-JIT-CONTEXT-INJECTION (monorepo) — hook architecture patterns
> **Gate Strategy:** VACUOUS (file/export existence checks). Infrastructure-only — no behavioral tests until Phase 2 stories.

---

## Section 1: Epic Identity

```yaml
epic_id: EPIC-SDD-PLUGIN-INFRA
title: "zeroh-sdd Plugin Infrastructure for Type-Steering"
scope: zeroh-sdd plugin repository (Blade-Labs/zeroh-sdd)
calibration_reference: "EPIC-JIT-CONTEXT-INJECTION — hook architecture patterns"
gate_strategy: "VACUOUS for infra stories, FAILING for hook behavior stories"
```

## Vision

Lay the first infrastructure layer into zeroh-sdd that enables the evolution from prose-steering to type-steering. This epic does NOT implement type-steering itself — it builds the foundation: persistent data, conflict detection, expanded hook coverage, plugin manifest completeness, and agent definitions.

**CEO sees:** Plugin `--plugin-dir` test shows all new hooks firing, agents appearing in `/agents`, conflict detection working, and `${CLAUDE_PLUGIN_DATA}` persisting shape registry across sessions.

## Gap Analysis

### Present State

zeroh-sdd ships 14 skills, 8 hooks, and 47 files. It uses:
- **6 of 25+ hook events** (24% coverage)
- **1 of 4 hook types** (command only — no prompt, agent, or http)
- **0 agents** (agents/ has .gitkeep only)
- **0 bin/ executables**
- **No persistent data** (${CLAUDE_PLUGIN_DATA} unused)
- **No conflict detection** (overlaps with monorepo hooks)
- **No UserPromptSubmit** (can't inject SDD state before prompts)
- **No PostCompact** (SDD state lost after compaction)
- **No FileChanged** (can't watch shape files)
- **Incomplete plugin.json** (missing userConfig, homepage)

### Desired State

- Hook events cover the 7 high-value unused events
- Plugin detects and defers to overlapping monorepo hooks
- Persistent data directory stores shape registry + violation state
- Plugin agents enable complex multi-step validation
- plugin.json is complete with userConfig for project settings
- PostCompact re-injects SDD pipeline state
- FileChanged watches shape files for re-validation triggers

### Gap → Story Map

| Gap | Severity | Stories |
|-----|----------|---------|
| No persistent data strategy | CRITICAL | S-01, S-02 |
| Hook overlap/conflict with monorepo | CRITICAL | S-03 |
| Missing high-value hook events | MAJOR | S-04, S-05, S-06 |
| No agent definitions | MAJOR | S-07 |
| Incomplete plugin.json | MINOR | S-08 |
| No prompt/agent hook types | MAJOR | S-09 |

---

## Stories

### Wave 1: Foundation (no dependencies)

#### S-01: Persistent Data Bootstrap

```yaml
story_type: implementation
fitness_gate: SDD-INFRA-PERSISTENT-DATA
traces_to:
  - docs/design/03-design-vision.md (Phase 2: shape registry)
  - research/plugin-infrastructure-research.md (Gap 1)
commit_strategy: single
ceo_sees: "SessionStart hook creates ${CLAUDE_PLUGIN_DATA}/shape-registry.json if missing; subsequent sessions reuse it"
```

**What:** Add `${CLAUDE_PLUGIN_DATA}` usage to the plugin for persistent state across sessions and updates.

**Changes:**
1. Update `hooks/hooks.json` — add SessionStart hook that bootstraps persistent data directory
2. Create `scripts/hooks/bootstrap-data.sh` — checks `${CLAUDE_PLUGIN_DATA}` exists, creates `shape-registry.json` skeleton if missing, compares `package.json` for dependency changes
3. Create `scripts/hooks/context/data-schema.md` — documents the persistent data format

**Acceptance Criteria:**
- `${CLAUDE_PLUGIN_DATA}/shape-registry.json` created on first session
- Subsequent sessions detect existing data and skip creation
- Data survives plugin updates (diff check pattern from official docs)

---

#### S-02: Shape Registry Skeleton

```yaml
story_type: implementation
fitness_gate: SDD-INFRA-SHAPE-REGISTRY
traces_to:
  - docs/design/03-design-vision.md (Section 3.4: Shape-Aware Phase Context)
commit_strategy: per-file
ceo_sees: "shape-registry.json contains discoverable structure for mapping file patterns to shape names"
```

**What:** Define the shape registry format that will be used by type-steering hooks to map files to their governing shapes.

**Changes:**
1. Create `templates/shape-registry-template.json` — schema for file-pattern → shape mappings
2. Update bootstrap-data.sh (S-01) to copy template on first run
3. Create `scripts/discover-shapes.sh` — scans project for `*.shape.ts` files, extracts export names, populates registry

**Acceptance Criteria:**
- Template defines: `{ patterns: [{ glob, shapeName, shapePath, imports }] }`
- discover-shapes.sh finds shape files via glob and extracts export names
- Registry is human-readable JSON, not binary

---

#### S-03: Hook Conflict Detection

```yaml
story_type: implementation
fitness_gate: SDD-INFRA-CONFLICT-DETECT
traces_to:
  - research/plugin-infrastructure-research.md (Section 3: Conflict Analysis)
commit_strategy: single
ceo_sees: "Plugin hooks that overlap with monorepo hooks (commit-hygiene, stop-check) silently defer when monorepo hooks are present"
```

**What:** Plugin hooks detect whether the installing repo already has overlapping hooks and defer to avoid duplicate warnings/blocking. Also fix the PreCompact file write race (P0 bug).

**Changes:**
1. Create `scripts/hooks/lib/conflict-check.sh` — shared function that checks `$CLAUDE_PROJECT_DIR/.claude/settings.json` for matching hook commands
2. Update `scripts/hooks/commit-hygiene.sh` — add conflict check, exit 0 if monorepo has its own commit-hygiene
3. Update `scripts/hooks/stop-check.sh` — add conflict check, exit 0 if monorepo has its own stop-check
4. Update `scripts/hooks/session-end.sh` — add conflict check for transcript archival
5. **Fix `scripts/hooks/pre-compact.sh`** — write to `.vibe/sdd-snapshot.md` instead of `.vibe/context-snapshot.md` to avoid file write race with monorepo's pre-compact (both run in parallel, last writer wins = data loss)
6. Document conflict detection in `scripts/hooks/context/conflict-detection.md`

**Overlap map (from deep conflict research):**
| Plugin Hook | Monorepo Equivalent | Severity | Resolution |
|------------|-------------------|----------|------------|
| commit-hygiene.sh | .claude/hooks/commit-hygiene.sh | MEDIUM (duplicate warnings) | Defer — exit 0 if monorepo has own |
| stop-check.sh | .claude/hooks/stop-check.sh + ~/.claude stop hook | HIGH (triple block, contradictory counts) | Defer — exit 0 if monorepo has own |
| pre-compact.sh | .claude/hooks/pre-compact.sh | **CRITICAL (file write race)** | Write to different file: `.vibe/sdd-snapshot.md` |
| session-end.sh | .claude/hooks/session-end.sh | LOW (duplicate archives) | Defer — exit 0 if monorepo has own |

**Known bug (anthropics/claude-code#24115):** Plugin hooks can fire twice when loaded from both marketplace source and cache. Conflict detection must be idempotent — safe to run 2x.

**Acceptance Criteria:**
- Plugin commit-hygiene exits 0 silently when monorepo commit-hygiene exists
- Plugin stop-check exits 0 silently when monorepo stop-check exists
- Plugin pre-compact writes to `.vibe/sdd-snapshot.md` (NOT `.vibe/context-snapshot.md`)
- session-end defers when monorepo session-end exists
- Non-overlapping hooks (ap-detector, phase-context, stop-quality-gate) unaffected
- Conflict check is idempotent (safe if hook fires 2x per #24115)
- Works with both direct file detection and settings.json grep

---

### Wave 2: Hook Coverage (depends on Wave 1)

#### S-04: PostCompact Hook — Re-inject SDD State

```yaml
story_type: implementation
fitness_gate: SDD-INFRA-POSTCOMPACT
traces_to:
  - docs/design/03-design-vision.md (Section 3.2: Hook Evolution)
  - research/plugin-infrastructure-research.md (Gap 5)
commit_strategy: single
ceo_sees: "After compaction, SDD pipeline state (current phase, active shapes, open violations) re-injected as systemMessage"
```

**What:** Add PostCompact hook that re-injects critical SDD context after context compaction.

**Changes:**
1. Update `hooks/hooks.json` — add PostCompact event entry
2. Create `scripts/hooks/post-compact.sh` — reads pre-compact snapshot + persistent data → emits systemMessage with SDD state
3. Update `scripts/hooks/pre-compact.sh` — ensure snapshot includes shape registry state

**Acceptance Criteria:**
- PostCompact fires after every compaction
- Emits systemMessage with: current SDD phase, active feature, open violations count
- Reads from `${CLAUDE_PLUGIN_DATA}/` for persistent state

---

#### S-05: UserPromptSubmit Hook — Pipeline Context

```yaml
story_type: implementation
fitness_gate: SDD-INFRA-USERPROMPT
traces_to:
  - research/plugin-infrastructure-research.md (Gap 3)
commit_strategy: single
ceo_sees: "Every user prompt gets SDD pipeline context injected — current phase, what's expected next"
```

**What:** Add UserPromptSubmit hook that injects SDD pipeline state before Claude processes any user prompt.

**Changes:**
1. Update `hooks/hooks.json` — add UserPromptSubmit event entry
2. Create `scripts/hooks/prompt-context.sh` — reads pipeline state, emits lightweight systemMessage

**Pipeline state injection (< 100 tokens):**
```
[SDD] Phase: implement | Feature: user-auth | Shapes: 3 defined, 1 pending
Next: Complete tasks 4-6 in tasks.md. Run per-task gate after each.
```

**Acceptance Criteria:**
- Fires on every user prompt
- Output is <100 tokens (lightweight — doesn't bloat context)
- Reads pipeline state from specs/ directory structure
- Gracefully exits 0 if no active SDD feature

---

#### S-06: PostToolUseFailure Hook — Remediation Injection

```yaml
story_type: implementation
fitness_gate: SDD-INFRA-FAILURE-HOOK
traces_to:
  - research/plugin-infrastructure-research.md (Section 2: Hook Events Gap)
commit_strategy: single
ceo_sees: "When a tool call fails, SDD-specific remediation context is injected (e.g., shape validation failure → suggest safeParse pattern)"
```

**What:** Add PostToolUseFailure hook that detects common failure patterns and injects SDD-specific remediation.

**Changes:**
1. Update `hooks/hooks.json` — add PostToolUseFailure event entry
2. Create `scripts/hooks/failure-remediation.sh` — pattern-matches tool failure output, injects relevant remediation from context fragments

**Failure patterns to match:**
- TypeScript compilation error mentioning shape types → inject shape checklist
- Test failure mentioning shape validation → inject safeParse pattern
- Import error for shape file → inject shape discovery guidance

**Acceptance Criteria:**
- Fires on any tool failure
- Pattern-matches failure output (< 50ms grep)
- Injects relevant context fragment or exits silently
- Does NOT block (PostToolUseFailure exit codes are ignored per spec)

---

### Wave 3: Agents + Manifest (depends on Wave 1)

#### S-07: SDD Agent Definitions

```yaml
story_type: implementation
fitness_gate: SDD-INFRA-AGENTS
traces_to:
  - docs/design/03-design-vision.md (Section 3.3: Type-Steering Loop)
commit_strategy: per-file
ceo_sees: "Running /agents shows zeroh-sdd agents: sdd-shape-validator, sdd-code-reviewer"
```

**What:** Define specialized agents that ship with the plugin for shape validation and SDD-aware code review.

**Changes:**
1. Create `agents/sdd-shape-validator.md` — agent that validates files against their governing shapes
2. Create `agents/sdd-code-reviewer.md` — agent that reviews code with SDD criteria (AP patterns, shape conformance, wiring checks)
3. Remove `agents/.gitkeep`

**Agent: sdd-shape-validator**
```yaml
---
name: sdd-shape-validator
description: Validates TypeScript files against their governing Zod shapes. Use when checking if implementation conforms to shape contracts.
model: haiku
maxTurns: 5
disallowedTools: Write, Edit
---
```

**Agent: sdd-code-reviewer**
```yaml
---
name: sdd-code-reviewer
description: Reviews code for SDD compliance — anti-patterns, shape conformance, wiring checks, test coverage
model: sonnet
maxTurns: 10
disallowedTools: Write, Edit
---
```

**Acceptance Criteria:**
- Both agents appear in `/agents` when plugin is loaded
- sdd-shape-validator is read-only (no Write/Edit)
- sdd-code-reviewer is read-only (no Write/Edit)
- Agents reference skill content for decision trees

---

#### S-08: Complete plugin.json Manifest

```yaml
story_type: implementation
fitness_gate: SDD-INFRA-MANIFEST
traces_to:
  - research/plugin-infrastructure-research.md (Gap 7)
commit_strategy: single
ceo_sees: "Plugin validation passes with no warnings; userConfig prompts for project shape path on enable"
```

**What:** Complete the plugin.json manifest with all recommended fields and add userConfig for project-specific settings.

**Changes:**
1. Update `.claude-plugin/plugin.json`:
   - Add `homepage` pointing to README
   - Add `userConfig` for: `shapes_directory` (path to project shapes), `enforcement_level` (strict/moderate/minimal)
   - Bump version to 0.2.0

**userConfig schema:**
```json
{
  "userConfig": {
    "shapes_directory": {
      "description": "Path to your project's shape files (e.g., core/shapes/src)",
      "sensitive": false
    },
    "enforcement_level": {
      "description": "Enforcement strictness: strict (block on violations), moderate (warn), minimal (context only)",
      "sensitive": false
    }
  }
}
```

**Acceptance Criteria:**
- `claude plugin validate` passes with no errors
- userConfig values available as `$CLAUDE_PLUGIN_OPTION_SHAPES_DIRECTORY` in hooks
- Version bumped to 0.2.0

---

#### S-09: First Prompt-Type Hook (AP Semantic Check)

```yaml
story_type: implementation
fitness_gate: SDD-INFRA-PROMPT-HOOK
traces_to:
  - research/plugin-infrastructure-research.md (Gap 6: No prompt/agent hook types)
  - docs/design/03-design-vision.md (Section 3.3: Type-Steering Loop)
commit_strategy: single
ceo_sees: "When Claude writes a shape file, an LLM-evaluated prompt hook checks semantic quality beyond what grep can detect"
```

**What:** Add the first `prompt`-type hook to zeroh-sdd — an LLM-evaluated semantic check for shape files that catches issues grep can't.

**Changes:**
1. Update `hooks/hooks.json` — add PostToolUse entry with `type: "prompt"` for shape files
2. Create `scripts/hooks/context/shape-semantic-prompt.md` — the evaluation prompt

**Prompt hook definition:**
```json
{
  "matcher": "Write|Edit",
  "hooks": [
    {
      "type": "prompt",
      "prompt": "The file at $TOOL_INPUT.file_path was just written. If it is a .shape.ts file, evaluate: 1) Does every field have a .describe()? 2) Are enum values domain-appropriate? 3) Is there a .meta() with at least name and category? 4) If there's a status/state field, is discriminatedUnion used? Return 'approve' if all pass, or specific feedback on what to fix.",
      "timeout": 30
    }
  ]
}
```

**Acceptance Criteria:**
- Prompt hook fires only on shape files (matcher + prompt logic)
- LLM evaluation catches semantic issues (wrong enum values, missing descriptions)
- Timeout set to 30s to avoid blocking
- Falls through gracefully for non-shape files

---

## Dependency Graph

```
Wave 1 (parallel):
  S-01: Persistent Data Bootstrap
  S-02: Shape Registry Skeleton  (soft dep on S-01 for bootstrap)
  S-03: Hook Conflict Detection

Wave 2 (depends on Wave 1):
  S-04: PostCompact Hook         (depends on S-01 for persistent data)
  S-05: UserPromptSubmit Hook
  S-06: PostToolUseFailure Hook

Wave 3 (depends on Wave 1):
  S-07: SDD Agent Definitions
  S-08: Complete plugin.json
  S-09: First Prompt-Type Hook
```

## Execution Waves

| Wave | Stories | Parallelism | Est. Commits |
|------|---------|-------------|--------------|
| 1 | S-01, S-02, S-03 | All parallel | 6-8 |
| 2 | S-04, S-05, S-06 | All parallel | 4-6 |
| 3 | S-07, S-08, S-09 | All parallel | 4-5 |

**Total: 9 stories across 3 waves, ~15-19 commits**

---

## Architectural Decisions

### AD-INFRA-01: Use ${CLAUDE_PLUGIN_DATA} for All Persistent State

Persistent state (shape registry, violation tracking, session snapshots) lives in `${CLAUDE_PLUGIN_DATA}/`, not in the project directory. This survives plugin updates and separates plugin state from project state.

### AD-INFRA-02: Conflict Detection via Settings.json Grep

Plugin hooks detect monorepo overlaps by grepping `$CLAUDE_PROJECT_DIR/.claude/settings.json` for matching hook commands. This is more reliable than checking for specific file paths (which could differ across projects).

### AD-INFRA-03: Prompt Hooks for Semantic Checks Only

`prompt`-type hooks are reserved for semantic checks that grep can't do (e.g., "are these enum values domain-appropriate?"). Deterministic checks (file exists, pattern matches) stay as `command` hooks for performance.

### AD-INFRA-04: Agents Are Read-Only

Plugin-shipped agents have `disallowedTools: Write, Edit`. They observe and report but don't modify. This is a trust boundary — the main agent acts on agent findings, but agents themselves can't change code.

### AD-INFRA-05: UserPromptSubmit Is Lightweight (<100 tokens)

The UserPromptSubmit hook injects minimal pipeline context. It must not bloat every prompt with verbose instructions. Target: <100 tokens of injected context.

---

## Route To

After this epic: `/sprint-execute` on type-steering implementation (Phase 2 of design vision — the actual safeParse hooks, correction loop, shape-aware phase-context).
