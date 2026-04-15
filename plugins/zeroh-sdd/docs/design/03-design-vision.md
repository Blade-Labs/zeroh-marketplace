# Design Vision: zeroh-sdd Plugin Evolution

**Date:** 2026-04-10
**Status:** Draft
**Authors:** Claude (research + synthesis), Human (framing + direction)
**Scope:** Current state → target state for zeroh-sdd as Schema-Driven Steering vehicle

---

## 1. Vision Statement

Evolve zeroh-sdd from a **prose-steering plugin** (Markdown checklists + grep-based anti-pattern detection) into a **type-steering plugin** (Zod safeParse in hooks + shape-aware JIT context injection) that steers LLMs to develop enterprise-grade, best-practices-aligned React/Next.js applications — guided by type errors, not just prose advice.

**The formula:**
```
ZeroH Shape Ecosystem (652 shapes, 14,637 .describe() annotations)
  + Claude Code Hooks (JIT context injection via additionalContext)
  + Skill Prose (decision trees, quality gates, criteria-first TDD)
  + Enforcement Gradient (Context → Warn → Auto-fix → Type-steer → Block → Error-chain)
  = LLM-steered development where type errors ARE the teaching signal
```

---

## 2. Current State (What Ships Today)

See [01-current-state.md](./01-current-state.md) for full inventory.

**Summary:** 14 skills, 8 hooks, 18 anti-patterns, 47 files. Zero npm dependencies. Distributed via zeroh-marketplace to 5 platforms (Claude Code, Cursor, Codex, Gemini, Copilot).

**Enforcement gradient today:**
```
LIGHTEST ─────────────────────────────────────────────── HEAVIEST

Context     Warn (advisory)    Block (prevent)
   │             │                    │
SessionStart  phase-context      stop-check
bootstrap     ap-detector        stop-quality-gate
              commit-hygiene
```

**What's working:** Prose-steering via skills + hooks. Anti-pattern detection via grep/diff. Phase-context JIT injection. Hook overrides for per-project customization.

**What's missing:** Type-level steering. Shape-aware validation. Correction loops. Runtime wiring teaching. Testing gradient. Business rule depth.

---

## 3. Target State (Where We Want To Get)

### 3.1 Expanded Enforcement Gradient

```
LIGHTEST ────────────────────────────────────────────────────────── HEAVIEST

Context    Warn      Auto-fix    Type-steer   Phase-gate   Block    Error-chain
   │         │          │            │             │          │          │
Session   phase-    biome-      safeParse     per-task    stop-    validatedParse
Start     context   format      in hooks      gate +      check    + RFC 9457
          ap-       subpath-    + Zod error   per-file    stop-    + Fix with
          detect    exporter    injection     gate        quality  Claude
          commit-                                         gate
          hygiene
```

**New additions (bold = new capabilities):**
- **Type-steer:** PostToolUse hooks that run `safeParse` against target shapes and inject Zod validation errors as `additionalContext`
- **Auto-fix:** Hooks that silently correct formatting/structural issues (lift biome-format pattern from monorepo)
- **Phase-gate per-file:** Not just per-task but per-file validation that the written file conforms to its target shape
- **Error-chain:** Skills that teach WHERE to call `safeParse` at boundaries, connecting Layer 1 (build-time) to Layer 2/3 (generation/runtime)

### 3.2 Hook Evolution

| # | Script | Event | Current | Target |
|---|--------|-------|---------|--------|
| 1 | session-start.sh | SessionStart | Pipeline state | + Shape ecosystem discovery |
| 2 | phase-context.sh | PreToolUse | File-type checklist | + Shape-aware: inject `.describe()` annotations for target shape |
| 3 | **shape-validator.sh** | PostToolUse | — (new) | Run `safeParse` against target shape, inject Zod errors |
| 4 | ap-detector.sh | PostToolUse | 18 grep/diff patterns | + Shape-aware patterns (does output conform to expected shape?) |
| 5 | **correction-verifier.sh** | PostToolUse | — (new) | Verify previous warning was addressed; escalate if not |
| 6 | commit-hygiene.sh | PostToolUse | Uncommitted files | No change |
| 7 | pre-compact.sh | PreCompact | Context snapshot | + Shape conformance state snapshot |
| 8 | stop-check.sh | Stop | Uncommitted work | No change |
| 9 | stop-quality-gate.sh | Stop | Quality gate | + Shape conformance gate |
| 10 | session-end.sh | SessionEnd | Transcript | No change |

### 3.3 The Type-Steering Loop (New Core Capability)

This is the critical evolution — bringing the `importSDI()` correction loop pattern into build-time hooks:

```
1. PreToolUse fires (Claude is about to Write/Edit a file)
   → phase-context.sh detects file type AND target shape
   → Injects: shape .describe() annotations + field constraints + examples
   → additionalContext: "This file must conform to PolicyShape. Required fields: ..."

2. Claude writes the file (informed by injected context)

3. PostToolUse fires (Claude just wrote the file)
   → shape-validator.sh identifies target shape from file path/imports
   → Runs: node -e "schema.safeParse(require(filePath))" 
   → If PASS: exit 0 silently
   → If FAIL: Zod errors → additionalContext injection
     "Shape validation failed for PolicyShape:
      - path: .data.status — expected 'active' | 'suspended', received 'enabled'
      - path: .data.effectiveDate — required field missing
      Fix: update the status field to use the PolicyStatus enum values"

4. Claude reads the Zod errors in additionalContext → self-corrects

5. PostToolUse fires again after correction
   → correction-verifier.sh checks if previous violations are resolved
   → If resolved: exit 0 silently
   → If NOT resolved: escalate (warn → ask → deny progression)
```

**This IS the TypeChat/Instructor pattern, but at Layer 1 (build-time) instead of Layer 2 (generation-time).** Cost: ~0 tokens for the validation, injected context only. No LLM API calls for validation.

### 3.4 Shape-Aware Phase Context

Evolve `phase-context.sh` from file-type routing to shape-aware routing:

**Current (file-type only):**
```bash
case "$file_path" in
  *.shape.ts)     → checklist-shape.md
  *.test.ts)      → checklist-test.md
  *route*.ts)     → checklist-route.md
  *store*.ts)     → checklist-store.md
  *.tsx)           → checklist-component.md
esac
```

**Target (shape-aware):**
```bash
# Step 1: File-type detection (existing)
# Step 2: Shape discovery — which shape governs this file?
#   - Parse imports for *Shape imports
#   - Check nearest shapes/ directory for matching domain
#   - Lookup shape registry (emitted artifact)
# Step 3: Extract shape metadata
#   - .describe() annotations → field-level guidance
#   - .meta() → domain context, category, standards
#   - Enum values → valid options
#   - .refine() constraints → business rules
# Step 4: Inject as additionalContext
#   - File-type checklist (existing)
#   + Shape field descriptions
#   + Valid enum values
#   + Business rule constraints
#   + Example conforming output
```

### 3.5 UI Design Integration (via ui-design-skill)

The `ui-design-skill` companion plugin handles frontend design decisions. Integration points:

- **Shape → Component:** When writing a `.tsx` file backed by a shape, inject both the shape's `.describe()` annotations (data contract) AND the ui-design-skill's component patterns (presentation contract)
- **Route → Page:** When writing a route handler, inject both the route contract shape AND the page layout pattern
- **Shared vocabulary:** Both plugins reference the same shape ecosystem; ui-design-skill focuses on presentation patterns while zeroh-sdd focuses on data/business patterns

This keeps the UI surface area reduced — one skill handles design, another handles data/validation, both reference the same shapes.

---

## 4. Patterns to Lift from Monorepo

These patterns already exist in the ZeroH GRC Platform monorepo and can be adapted for the plugin:

### 4.1 From `importSDI()` → Shape Validator Hook

| importSDI() component | Hook adaptation |
|-----------------------|-----------------|
| `z.toJSONSchema(schema)` | Not needed — hook validates actual TS/TSX output, not JSON |
| `schema.safeParse(rawInput)` | `node -e "require(shape).safeParse(require(file))"` in PostToolUse |
| Zod errors → `tool_result { isError }` | Zod errors → `additionalContext` injection |
| `maxCorrections` turns | correction-verifier.sh escalation (warn → ask → deny) |
| Taxonomy injection | Shape `.meta()` + `.describe()` → PreToolUse context |
| `.meta()` operationalization | Shape metadata → hook context for domain-specific guidance |

### 4.2 From Zone-Warning Hook → Shape-Aware Zone Context

The monorepo's `zone-warning.sh` maps file paths to trust zones (core/kernel/emitted/infra) and injects zone-specific constraint prose. Adapt this for shape-aware context:

```
File path → Zone (existing pattern)
File path → Target shape (new: lookup shape registry)
File path → Zone + Shape → combined context fragment
```

### 4.3 From RFC 9457 Error Chain → Hook Error Messages

The monorepo's error chain pattern (status code + trace ID + remediation text + `_fix.prompt`) should inform how hooks format their `additionalContext`:

```json
{
  "violation": "AP-WIRE-01",
  "severity": "warn",
  "file": "src/routes/policy.ts",
  "detail": "PolicySchema imported at line 3 but never parsed",
  "remediation": "Add: const validated = PolicySchema.safeParse(input)",
  "shape_context": {
    "schema": "PolicySchema",
    "required_fields": ["id", "status", "effectiveDate"],
    "status_enum": ["active", "suspended", "terminated"]
  }
}
```

### 4.4 From Scaffold Integrity → Correction Verification

The monorepo's speckit-implement skill uses scaffold integrity checks (count comparison: "expected 5 functions, found 4 — what's missing?"). Adapt for correction verification:

```
Warning issued → track { violation_id, file, timestamp }
Next PostToolUse on same file → check if violation persists
If resolved → clear tracking
If persists → escalate: warn → ask ("Did you address AP-WIRE-01?") → deny
```

### 4.5 From CGTC Trust Chain → Phase-Gate Progression

The criteria-first-tdd skill's CGTC (Convention → Gate → Triangulation → Chain) pattern gates progression:

```
Convention locked → Discovery unlocked
Discovery locked → Triangulation unlocked
Triangulation locked → Downstream unlocked
```

Adapt for shape-aware phase gates:

```
Shape defined + .meta() present → Implementation unlocked
Implementation written → Shape validation (safeParse) gate
safeParse passes → Test gate (criteria-first-tdd)
Tests pass → Commit unlocked (stop-quality-gate)
```

---

## 5. Implementation Phases

### Phase 1: Shape Discovery (extend existing hooks)

**Goal:** Hooks know which shape governs a file, not just the file type.

**Changes:**
- Extend `phase-context.sh` to parse imports and detect target shapes
- Create `context/shape-registry.json` (maps file patterns → shape names)
- Inject shape `.describe()` text alongside existing checklists

**Lift from:** Zone-warning hook pattern (file path → context fragment routing)

**No new dependencies.** Uses `grep` + `node -e` for import parsing. Stays within <200ms budget.

### Phase 2: Type-Steer Hook (new hook)

**Goal:** PostToolUse validates output against target shape via `safeParse`.

**Changes:**
- New `shape-validator.sh` hook (PostToolUse, Write/Edit events)
- Resolves target shape from file path/imports
- Runs lightweight `safeParse` via `node -e`
- Injects Zod validation errors as `additionalContext`

**Lift from:** `importSDI()` correction loop (safeParse → error → feedback)

**Performance budget:** <300ms. Shape resolution cached per-session. `safeParse` is synchronous.

### Phase 3: Correction Loop (new hook)

**Goal:** Verify that warnings were actually addressed. Escalate if not.

**Changes:**
- New `correction-verifier.sh` hook (PostToolUse)
- Tracks open violations per file (in-memory or temp file)
- Re-checks on subsequent writes to same file
- Escalation: warn → ask → deny (3-strike pattern)

**Lift from:** Scaffold integrity pattern + CGTC trust chain

### Phase 4: Shape Depth (extend shapes)

**Goal:** Move shapes from Tier 1 (structural) toward Tier 2-9 (business rules).

**Changes:**
- Extend skills to teach `.refine()`, `.transform()`, `.discriminatedUnion()`
- Add shape quality skill: analyzes existing shapes, suggests enrichments
- Add AP patterns for missing business rules (e.g., "datetime pair without temporal ordering" already exists as AP-SHAPE-02)

**Lift from:** 652 existing shapes + `.describe()` annotation system

### Phase 5: UI Integration (coordinate with ui-design-skill)

**Goal:** Unified shape + design context for frontend files.

**Changes:**
- Coordinate `phase-context.sh` with ui-design-skill's component patterns
- When writing `.tsx`: inject shape data contract + design component pattern
- Shared shape registry between both plugins

**Depends on:** ui-design-skill maturity

---

## 6. Distribution Strategy

**Channel:** zeroh-marketplace (already operational)

```bash
claude plugin install zeroh-sdd  # via zeroh-marketplace
```

**5-platform support (existing):**
- Claude Code: `.claude-plugin/plugin.json` + hooks + skills
- Cursor: `.cursor-plugin/plugin.json`
- Codex: `.codex/INSTALL.md`
- Gemini: `gemini-extension.json` + `GEMINI.md`
- Copilot: `.copilot/plugin.yaml`

**Note:** Type-steering hooks (Phase 2+) require Claude Code hook support. Other platforms get skill prose + AP detection (Phase 1 capabilities). This is acceptable — Claude Code is the primary vehicle for the full enforcement gradient.

---

## 7. Success Criteria

| Metric | Current | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|--------|---------|---------|---------|---------|---------|
| Anti-patterns detected | 18 (grep/diff) | 18 + shape-aware | 18 + safeParse | 18 + correction loop | 18 + business rules |
| File types with context injection | 5 | 5 + shape metadata | 5 + Zod constraints | 5 + escalation | 5 + enriched shapes |
| Correction loop | None | None | Fire-and-forget | Verify + escalate | Verify + escalate |
| Shape validation in hooks | None | Discovery only | safeParse gate | safeParse + verify | safeParse + business rules |
| Shape ecosystem depth (Tier 2+) | 9% | 9% | 9% | 9% | 25%+ target |
| npm dependencies | 0 | 0 | 0 (node -e) | 0 (node -e) | 0 |

**Non-goals:**
- This plugin does NOT replace Layer 2 (`importSDI`) or Layer 3 (runtime error chain)
- This plugin does NOT require the full monorepo — it works standalone
- This plugin does NOT add npm dependencies — continues using bash + node -e + Markdown

---

## 8. Architectural Decisions

### AD-1: No npm dependencies (maintain)

The plugin stays dependency-free. Shape validation uses `node -e` with inline scripts. This enables:
- 5-platform distribution without package managers
- No version conflicts with user's project
- Predictable behavior (bash + node stdlib only)

### AD-2: Hook performance budget (<300ms)

All hooks must complete within 300ms. Shape resolution is cached per-session. `safeParse` is synchronous. If a shape is too complex for the budget, degrade to Tier 1 (structural check only) rather than blocking.

### AD-3: Escalation, not blocking (for type-steer)

The type-steer hook uses `additionalContext` injection (allow mode), not `permissionDecision: deny`. The LLM should self-correct from injected Zod errors, not be blocked. Blocking is reserved for stop hooks (uncommitted work, quality gates).

Exception: After 3 unresolved violations on the same file (correction-verifier.sh Phase 3), escalate to `ask` mode.

### AD-4: Shape registry as convention, not config

Shape-to-file mapping uses conventions (import analysis + directory structure) rather than a manual registry file. Falls back to file-type detection when shape can't be resolved. The system degrades gracefully to current behavior when shapes aren't discoverable.

### AD-5: UI design as companion, not embedded

Frontend design patterns live in `ui-design-skill` (separate plugin). Integration is via shared shape references, not embedded UI logic. This keeps zeroh-sdd focused on data/validation and ui-design-skill focused on presentation.

---

## 9. Open Questions

1. **Shape resolution heuristic:** How reliably can we determine the target shape from file path + imports alone? Need to prototype with representative files from the monorepo.

2. **safeParse in hooks without dependencies:** `node -e` can `require()` a shape file, but the shape file imports from `zod`. The user's project must have `zod` installed. Is this an acceptable implicit dependency?

3. **Cross-platform parity:** Type-steering requires Claude Code hooks. How much value can other platforms (Cursor, Copilot) get from skill prose alone? Is skill-only sufficient for those platforms?

4. **Correction loop state:** Where does the correction verifier store open violations? Options: temp file (per-session), environment variable, or inline in `additionalContext` (stateless but verbose).

5. **Shape ecosystem growth:** How do we incentivize moving shapes from Tier 1 to Tier 2+? A skill that analyzes shapes and suggests enrichments? An AP pattern for "shape with obvious business rules but no .refine()"?
