# Research Findings: Schema-Driven Steering

**Date:** 2026-04-10
**Source:** Deep study of ZeroH GRC Platform monorepo + zeroh-sdd plugin
**Method:** 4 parallel research agents + direct codebase exploration

---

## Finding 1: Three Steering Layers Already Exist in the Monorepo

The ZeroH GRC Platform already implements three distinct layers of LLM steering using Zod shapes as the control plane. The zeroh-sdd plugin is the vehicle to make Layer 1 portable.

### Layer 1: Build-Time Steering (Claude Code Hooks)

**Location:** `.claude/settings.json` + `.claude/hooks/*.sh`

7 hooks across 6 lifecycle events inject `additionalContext` into the LLM's context window at the exact moment of action:

| Hook | Event | Gradient | What It Does |
|------|-------|----------|-------------|
| zone-warning | PreToolUse | Warn | Detects file zone (core/kernel/emitted/infra), injects constraint prose |
| biome-format | PostToolUse | Auto-fix | Silently runs biome on every file Claude writes |
| commit-hygiene | PostToolUse | Warn | Injects commit reminder when uncommitted files > threshold |
| subpath-exporter | PostToolUse | Auto-fix | Auto-adds package.json exports for new blocks files |
| stop-check | Stop | Block | Prevents session end with uncommitted work |
| session-start | SessionStart | Context | Environment setup, tool discovery, context recovery |
| pre-compact | PreCompact | Context | Saves snapshot before memory loss |

**Key mechanism:** `hookSpecificOutput.additionalContext` — text injected into LLM context window. The LLM reads it and self-corrects. This IS JIT context injection.

### Layer 2: Generation-Time Steering (importSDI — The TypeChat Pattern)

**Location:** `packages/sdi-ai/src/core/sdi.ts:189`

Already implements the exact TypeChat/Instructor/Reflexion pattern:

```
Zod schema → z.toJSONSchema(schema, { target: 'draft-07' })
  → tool definition with field-level guidance
  + Taxonomy fragment prepended to system prompt
  + .meta() fields operationalized for telemetry
  → LLM generates structured output
  → schema.safeParse(rawInput) — deterministic gate
  → If fail: Zod errors → tool_result { isError: true } → self-correction
  → Up to maxCorrections turns (not blind retry)
```

**ZeroH innovations beyond TypeChat/Instructor:**
- Taxonomy injection (domain vocabulary as pre-hoc guidance)
- `.meta()` operationalization (name, category, outcome_mapping → telemetry)
- Lineage tracking (MLflow-style run_id, schema_name, generated_at)
- Correction turn count in result metadata
- Multi-provider (Anthropic, OpenAI, Google)

### Layer 3: Runtime Steering (Fix with Claude — 6-Layer Error Chain)

**Location:** 6 files across ai-gateway, server-core, blocks

```
validatedParse() at boundary → Zod error with remediation
  → throwUpstreamError() → RFC 9457 chain with service-specific guidance
  → handleError() → builds _fix context with pre-built LLM prompt
  → HTTP response with X-Trace-Id header
  → parseApiError() → browser renders recursive chain
  → "Fix with Claude" button → agent loop (3 attempts + gate re-run)
```

15+ upstream services have domain-specific remediation strings. The `_fix.prompt` field is pre-built for LLM consumption.

---

## Finding 2: Shape Ecosystem Is Semantically Rich but Enforcement-Weak

**652 shape files** across 65+ domains with:
- 14,637 `.describe()` invocations (~22 per shape)
- 1,876 `.meta()` invocations (64% of shapes)
- 347 enum vocabularies
- 657 provenance/crosswalk links
- 25+ formal standards mapped

**But only 9% use Tier 2+ validation:**
- 12 shapes with `.refine()` (1.8%)
- 30 shapes with `.transform()` (4.6%)
- 17 shapes with `.discriminatedUnion()` (2.6%)

The semantic instructions are rich (LLM reads `.describe()` annotations to understand intent), but the validation gates are weak (most shapes only enforce structural types, not business rules).

---

## Finding 3: Plugin Already Has Gradient Enforcement (15 Anti-Patterns)

The zeroh-sdd plugin's `ap-detector.sh` already implements a 2-tier detection system:

**Tier 1 — Grep-catchable (<100ms):**
- AP-ERR-01: Error swallowing (return null/undefined/[] in catch)
- AP-ERR-02: New error handler bypassing canonical utility
- AP-ANY-01: High type assertion density (>3 `as any` per file)
- AP-DOC-01: Commit hook bypass (--no-verify)
- AP-IGN-01: Suppression without justification
- AP-LOG-01: console.log in production code
- AP-WIRE-01: Schema imported but never parsed
- AP-WIRE-02: Unvalidated type assertion on response.json()
- AP-WIRE-03: Error chain destruction (throw new Error(response.text()))
- AP-WIRE-04: Catch block without remediation guidance
- AP-SHAPE-01: Status/state field without discriminatedUnion
- AP-SHAPE-02: Multiple datetime fields without temporal ordering
- AP-SHAPE-03: Shape file missing .meta()
- AP-TEST-01: Test without @covers/@spec annotation
- AP-FAT-01: Route handler > 50 lines
- AP-ENV-01: process.env outside config/ directory

**Tier 2 — Diff-catchable (test files):**
- AP-CAP-01: toThrow weakened to toBeUndefined/toBeTruthy
- AP-CAP-02: Net decrease in test count or skip added
- AP-CAP-03: Gate severity downgraded from error to warn

---

## Finding 4: Phase-Context Hook Is Layer 1 Type-Steering

The `phase-context.sh` PreToolUse hook detects file types and injects checklists:
- `*.shape.ts` → shape authoring checklist
- `*.test.ts` → test writing checklist
- `*route*.ts` → route contract checklist
- `*store*.ts` → state management checklist
- `*.tsx` (components) → component contract checklist

This IS the "type-steering" pattern — context injected based on what you're about to create, not after you've created it. Combined with `ap-detector.sh` (PostToolUse), the plugin already has a **before/after enforcement sandwich**.

---

## Finding 5: Skill Prose Contains Deep Decision Tree Infrastructure

**14 decision trees** in criteria-first-tdd route LLM behavior:
- DT1-DT3: Test tier, gate type, severity selection
- DT4: Real-time capitulation detection (AP3)
- DT5: Mock policy
- DT7-DT8: Trust layer and dimension selection (CGTC)
- DT10: Intelligence tier (lexical → structural → architectural → intent)
- DT12: IRIS protocol (ADR prose → machine-enforced gates)
- DT14: 5-step intelligent gate lifecycle with κ > 0.8 calibration

**21 shape quality gates** (K1-K21) enforce provenance, quality, and GlobalMeta completeness.

**10-item red flag table** catches capitulation rationalizations during implementation.

---

## Finding 6: Existing Patterns to Lift

| Pattern | Where It Exists | What to Lift |
|---------|----------------|-------------|
| Zod → JSON Schema → tool → safeParse → error feedback loop | `sdi-ai/src/core/sdi.ts` | The correction loop architecture |
| Zone-based PreToolUse context injection | `.claude/hooks/zone-warning.sh` | File-path → context fragment routing |
| RFC 9457 error chain with `_fix` prompt | `server-core/error-handler.ts` | Structured error → LLM-actionable remediation |
| Phase-context file-type checklists | `zeroh-sdd/scripts/hooks/phase-context.sh` | Already in plugin — extend with more types |
| AP detector with grep+diff tiers | `zeroh-sdd/scripts/hooks/ap-detector.sh` | Already in plugin — extend with Zod-aware checks |
| Hook overrides for per-project customization | `zeroh-sdd/hook-overrides.json` | Already in plugin — extend with severity levels |
| Taxonomy injection for domain vocabulary | `sdi-ai/src/core/sdi.ts` (getTaxonomyFragment) | Pre-hoc guidance pattern |
| `.describe()` as semantic carrier | 14,637 invocations across 652 shapes | The annotation system IS the prompt engineering |
| Scaffold integrity (count comparison) | speckit-implement SKILL.md | Mechanical check that defeats rationalization |
| CGTC 4-layer trust chain | criteria-first-tdd SKILL.md | Layer N blocks until Layer N-1 locked |
