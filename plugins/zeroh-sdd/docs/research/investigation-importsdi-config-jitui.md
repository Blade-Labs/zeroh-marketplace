# Investigation: importSDI, Config Surface, and JIT UI

**Date:** 2026-04-10
**Context:** Three investigations into existing infrastructure for type-steering

---

## 1. importSDI — Hook Integration

### Finding: safeParse is the hook; Claude is the correction loop

`importSDI` at `packages/sdi-ai/src/core/sdi.ts:189` runs:
```
Zod schema → JSON Schema → tool definition → LLM generates → safeParse → error feedback → retry
```

A PostToolUse hook doesn't need the full importSDI. It needs only the **validation gate** (`safeParse`). Claude IS the correction loop — the hook injects Zod errors as `additionalContext`, Claude reads them, Claude self-corrects.

```
importSDI pattern:    safeParse → error → tool_result → LLM retries (Layer 2)
Hook pattern:         safeParse → error → additionalContext → Claude self-corrects (Layer 1)
```

Same pattern, different delivery mechanism. Layer 1 is cheaper (zero LLM API calls for validation).

### Invocation from hooks

The monorepo already calls `node -e` from hooks (biome-format.sh, zone-warning.sh). Calling `pnpm tsx` with a validator script that imports real shapes is the natural extension:

```bash
# PostToolUse hook (sketch):
pnpm tsx scripts/validate-sdi.ts "$file_path"
```

The validator imports the target shape from `@zeroh/shapes` and runs `safeParse`.

### The Critical Question: Which Shape?

**This is where Schema-Driven Development enters.**

The hook needs to know: for the file Claude just wrote, which Zod shape should it validate against? This mapping is the **shape registry** — the artifact produced during the speckit-shapes phase.

```
speckit-specify  → "What are we building?"
speckit-plan     → "How will we build it?"
speckit-shapes   → "What shapes govern each file?" ← THIS PRODUCES THE REGISTRY
speckit-tasks    → "What tasks, in what order?"
speckit-implement → hooks use the registry to validate each written file
```

The shapes phase doesn't just produce `.shape.ts` files — it produces the **mapping** from file patterns to governing shapes. That mapping IS the hook's configuration.

---

## 2. JIT Context Injection UI — Exists at /lab/platform-hub

### What's Working

| Component | Path | Status |
|-----------|------|--------|
| **BehaviorsTab** | `apps/dev-zeroh/app/lab/platform-hub/components/tabs/BehaviorsTab.tsx` | Working |
| **Hooks API GET** | `apps/dev-zeroh/app/api/hooks/route.ts` | Working |
| **Hooks API PATCH** | `apps/dev-zeroh/app/api/hooks/route.ts` | Working |
| **Context API GET/PUT** | `apps/dev-zeroh/app/api/hooks/context/route.ts` | Working |
| **BehaviorSelector** | `packages/blocks/src/chat/components/behavior-selector.tsx` | Working |

**BehaviorsTab capabilities:**
- Fetches hook data from `/api/hooks`
- Displays behavior cards grouped by category (safety, productivity, recovery, team, learning)
- Toggle switches per behavior
- Hook counts and trigger descriptions
- Badge showing active count ("3/13 active")
- Exposes state to Claude via `useAIReadable`
- Error handling with remediation UI

**Hooks API capabilities:**
- `GET /api/hooks` — returns hooks + overrides + context tree structure
- `PATCH /api/hooks` — merge-patches hook-overrides.json for toggle persistence
- `GET /api/hooks/context?hookId=<id>` — reads context `.md` files
- `PUT /api/hooks/context` — writes context `.md` files via GitHub API

### What's Missing

| Gap | Description | Impact |
|-----|-------------|--------|
| Behavior catalog | `packages/sdi-hooks/src/behavior-catalog.ts` never built. API returns `behaviors: []` | BehaviorsTab shows "catalog empty" |
| Plugin hook support | hook-overrides.json only covers monorepo hooks, not plugin hooks | Can't toggle plugin hooks from UI |
| userConfig UI | No UI for `userConfig` fields (shapes_directory, enforcement_level) | Users must hand-edit files |
| Conflict detection | No UI showing hook overlaps between monorepo + plugin | Duplicate warnings invisible |
| Sprint 2-3 | Telemetry, async hooks, policy engine — not started | Observability gap |

### Epic Status

EPIC-JIT-CONTEXT-INJECTION Sprint 1: **COMPLETE** (commit 805deed98)
- S1.1: CEO sees behavior cards ✅
- S1.2: AI Behavior Manager page with Tabs ✅
- S1.3: Context preview ✅
- S1.4: Pre-compiled hooks ✅
- S1.5: Token budget (300 tokens/hook) ✅

Sprint 2-3: **NOT STARTED**

---

## 3. Plugin Config Surface

### Existing: hook-overrides.json

```json
{
  "phase-context": { "enabled": true, "modes": { "shapes": "allow", "routes": "deny" } },
  "ap-detector": { "enabled": true },
  "commit-hygiene": { "enabled": true, "threshold": 3 },
  "stop-quality-gate": { "enabled": true },
  "stop-check": { "enabled": true }
}
```

This IS a configurable surface — per-hook enable/disable, per-file-type modes (allow/deny/ask), threshold tuning. The Hooks API can read/write it.

### Existing: userConfig (plugin.json spec)

The Anthropic plugin spec supports `userConfig` — values prompted when plugin is enabled:
```json
{
  "userConfig": {
    "shapes_directory": { "description": "Path to shapes", "sensitive": false },
    "enforcement_level": { "description": "strict|moderate|minimal", "sensitive": false }
  }
}
```
Values available as `$CLAUDE_PLUGIN_OPTION_SHAPES_DIRECTORY` in hooks. **Not yet in zeroh-sdd plugin.json.**

### Missing: Shape Registry as Config

The shape registry (file-pattern → shape mapping) is the missing config layer:
```json
{
  "patterns": [
    { "glob": "src/routes/policy*.ts", "shape": "PolicyShape", "path": "core/shapes/src/grc/policy.shape.ts" },
    { "glob": "src/models/control*.ts", "shape": "ControlShape", "path": "core/shapes/src/grc/grc-core.shape.ts" }
  ]
}
```
This is what the PostToolUse hook reads to determine WHICH shape to safeParse against.

---

## 4. The SDD Loop: Shapes as RED Tests

### The Connection

```
CRITERIA-RED-GREEN-RATCHET applied to shapes:

CRITERIA:  speckit-specify → acceptance criteria
RED:       speckit-shapes  → write shapes that FAIL safeParse against current code
GREEN:     speckit-implement → write code until safeParse PASSES
RATCHET:   hooks enforce → safeParse violations can only DECREASE
```

Shapes are not documentation. **Shapes are RED tests.** The speckit-shapes phase produces:
1. `.shape.ts` files — the Zod schemas (the test assertions)
2. Shape registry — the file-pattern → shape mapping (the test configuration)
3. Shape briefs — the rationale for each shape (the test documentation)

The implementation phase then has:
- **PreToolUse hook**: reads shape registry → injects `.describe()` annotations for the target shape as `additionalContext` ("here's what correct looks like")
- **PostToolUse hook**: reads shape registry → runs `safeParse` → injects Zod errors as `additionalContext` ("here's what you got wrong")
- **Stop hook**: reads shape registry → all shapes must pass `safeParse` → blocks if any fail

### Why This Matters

Without shapes, the hooks can only do **prose steering** — inject checklists and grep for patterns. With shapes, the hooks do **type steering** — inject Zod validation errors that are deterministic, path-specific, and machine-actionable.

The difference:
```
Prose:  "Remember to validate input with safeParse"     → LLM may ignore
Type:   "safeParse failed: .data.status expected 'active'|'suspended', got 'enabled'"  → LLM MUST fix
```

### The Pipeline

```
1. /speckit-specify  → User describes feature
2. /speckit-plan     → Plan with data model
3. /speckit-shapes   → Write shapes (RED tests) + populate shape registry
4. /speckit-tasks    → Tasks reference shapes as acceptance criteria
5. /speckit-implement → Hooks use shape registry to validate every write
   └─ PreToolUse:  inject shape .describe() annotations
   └─ PostToolUse: run safeParse, inject Zod errors
   └─ Stop:        block if any shapes fail validation
6. /speckit-analyze  → Verify all shapes pass, no regressions
```

**The shape registry is the bridge between the speckit pipeline and the hook enforcement system.**
