# Synthesis: Schema-Driven Steering as TypeChat/Instructor/Reflexion

**Date:** 2026-04-10
**Context:** Mapping academic/industry patterns to ZeroH's three existing steering layers

---

## The Core Insight

ZeroH already implements three complementary self-correction loops. Each maps to a known pattern from the LLM steering literature. The zeroh-sdd plugin's job is to make Layer 1 portable and evolve it from prose-steering to type-steering.

---

## Pattern Mapping

### TypeChat (Microsoft Research, 2023)

**Paper pattern:** TypeScript interface → system prompt → LLM generates → `tsc` compile check → type errors fed back → LLM self-corrects.

**ZeroH implementation:** `importSDI()` at `packages/sdi-ai/src/core/sdi.ts:189`

```
Zod schema → z.toJSONSchema(schema, { target: 'draft-07' })
  → tool definition with field-level .describe() annotations
  + Taxonomy fragment prepended to system prompt
  → LLM generates structured output
  → schema.safeParse(rawInput) — deterministic gate (this IS the tsc equivalent)
  → If fail: Zod errors → tool_result { isError: true } → self-correction
  → Up to maxCorrections turns (not blind retry)
```

**ZeroH innovations beyond TypeChat:**
- Taxonomy injection (domain vocabulary as pre-hoc guidance, not just post-hoc validation)
- `.meta()` operationalization (name, category, outcome_mapping → telemetry)
- Lineage tracking (MLflow-style run_id, schema_name, generated_at)
- Correction turn count in result metadata
- Multi-provider (Anthropic, OpenAI, Google) — TypeChat is OpenAI-only

**Where it lives:** Layer 2 — Generation-time steering. Active in production today for all SDI operations.

---

### Instructor (Jason Liu, 2023)

**Library pattern:** Pydantic model → structured output → validation error → automatic retry with error context → LLM fixes output.

**ZeroH implementation:** Same `importSDI()` loop, plus the plugin's enforcement gradient.

The key Instructor insight is **validation errors as teaching signals**. In ZeroH:
- `safeParse()` failures become `tool_result { isError: true }` messages (Layer 2)
- `ap-detector.sh` findings become `additionalContext` injections (Layer 1)
- `validatedParse()` failures become RFC 9457 chains with `_fix.prompt` (Layer 3)

Each layer uses the same principle: structured validation failure → actionable error → model/developer self-corrects.

**The gradient maps to Instructor's retry strategy:**

| Instructor | ZeroH Equivalent | Layer |
|-----------|-----------------|-------|
| `max_retries` | `maxCorrections` turns in importSDI | 2 |
| `ValidationError` details | Zod `.issues[]` with path + message | 2 |
| Field-level descriptions | `.describe()` annotations (14,637 across 652 shapes) | 2 |
| `@validator` decorators | `.refine()` / `.superRefine()` (currently only 9% of shapes) | 2 |
| Automatic retry | `tool_result { isError }` → model retries | 2 |
| — | `additionalContext` injection (hook warns) | 1 |
| — | "Fix with Claude" agent loop (3 attempts + gate) | 3 |

---

### Reflexion (Shinn et al., 2023)

**Paper pattern:** External evaluator → verbal reinforcement signal → model stores reflection → improved behavior on next attempt.

**ZeroH implementation:** The full three-layer system, viewed as a single feedback architecture.

```
Layer 1 (Build-time reflexion):
  PreToolUse hook detects file type → injects checklist (pre-hoc guidance)
  PostToolUse hook detects anti-pattern → injects warning (post-hoc feedback)
  LLM reads additionalContext → self-corrects on next action
  = Reflexion with "external evaluator" = grep/diff, "verbal signal" = additionalContext

Layer 2 (Generation-time reflexion):
  Zod schema → tool definition (pre-hoc guidance)
  safeParse failure → tool_result error (post-hoc feedback)
  LLM reads error → self-corrects within maxCorrections turns
  = Reflexion with "external evaluator" = Zod, "verbal signal" = parse errors

Layer 3 (Runtime reflexion):
  validatedParse at boundary → RFC 9457 error with remediation (feedback)
  "Fix with Claude" → agent loop reads error → attempts fix → gate re-run
  = Reflexion with "external evaluator" = runtime validation, "verbal signal" = _fix.prompt
```

The Reflexion paper's key contribution is that **verbal reinforcement outperforms scalar rewards** for LLM self-correction. ZeroH operationalizes this:
- Not just "invalid" (scalar) but "field `status` at path `.data.status` must be one of: active, suspended, terminated — received 'enabled'" (verbal)
- Not just "anti-pattern detected" (scalar) but "AP-WIRE-01: Schema imported but never parsed — call safeParse() on every schema import" (verbal)
- Not just "error" (scalar) but "_fix.prompt: check ALLOWED_ORIGINS includes this origin" (verbal)

---

## The Plugin's Role in This Architecture

The plugin makes **Layer 1 portable**. It ships:

| Component | Role | Analogy |
|-----------|------|---------|
| **Shapes** | The map (what's correct) | TypeChat's TypeScript interfaces |
| **Skills** | The guide (when/why to apply shapes) | Instructor's field descriptions |
| **Hooks** | The steering wheel (JIT context injection) | Reflexion's external evaluator |
| **Validation errors** | The feedback signal | All three: type errors / parse errors / verbal reinforcement |

### What's Working (Prose-Steering)

The current plugin achieves Layer 1 steering through **prose**:
- `phase-context.sh` injects Markdown checklists as `additionalContext`
- `ap-detector.sh` injects anti-pattern warnings as `additionalContext`
- Skills contain decision trees that route LLM behavior through Markdown prose
- 14 skills encode 14+ decision trees, 21 quality gates, 10-item red flag tables

This works because LLMs read and follow natural language instructions. The enforcement gradient (Context → Warn → Block) provides escalating pressure.

### What's Missing (Type-Steering)

The bridge from prose-steering to type-steering:

1. **No safeParse in hooks** — PostToolUse hooks grep for patterns but don't validate against the actual Zod shape the file should conform to. A hook that runs `safeParse` on Claude's output and injects Zod errors as `additionalContext` would complete the self-healing loop at development time.

2. **No correction verification** — Warnings are fire-and-forget. The hook warns about AP-WIRE-01 but never checks if Claude actually fixed it. A correction loop (warn → verify → escalate) would close the gap.

3. **No shape-aware context** — `phase-context.sh` knows file types but not which specific shape applies. Shape-aware hooks would inject the relevant `.describe()` annotations and `.meta()` context.

4. **No business rule depth** — 91% of shapes are Tier 1 (structural types only). The remaining 9 Zod tiers (refine, transform, discriminatedUnion, superRefine, pipe, brand, coerce, preprocess, effects) are underutilized.

### The Economic Argument

Catching a shape violation at each layer has different costs:

| Layer | Cost | Mechanism |
|-------|------|-----------|
| Layer 1 (build-time hook) | ~0 tokens | Injected text in `additionalContext` |
| Layer 2 (generation-time) | ~500 tokens/retry | `maxCorrections` loop in importSDI |
| Layer 3 (runtime) | ~10,000 tokens | Full "Fix with Claude" agent loop (3 attempts) |
| Layer 4 (human) | Hours | Developer reads error, debugs, fixes |

Every violation caught in Layer 1 that would otherwise reach Layer 3 saves ~10,000 tokens and an agent loop. The plugin's evolution toward type-steering maximizes this economic advantage.

---

## Key Insight: The Self-Correction Sandwich

The plugin already implements a **before/after enforcement sandwich**:

```
BEFORE (pre-hoc guidance):
  PreToolUse → phase-context.sh → checklist injection
  = "Here's what correct looks like before you write"

AFTER (post-hoc feedback):
  PostToolUse → ap-detector.sh → anti-pattern warning
  = "Here's what you got wrong after you wrote"
```

This sandwich is the Reflexion pattern in miniature. The evolution to type-steering strengthens both layers:

```
BEFORE (type-aware pre-hoc):
  PreToolUse → detect target shape → inject .describe() annotations + field constraints
  = "Here's the EXACT schema your output must satisfy"

AFTER (type-aware post-hoc):
  PostToolUse → safeParse against target shape → inject Zod errors as additionalContext
  = "Here's EXACTLY where your output fails validation, with path and expected type"
```

This transforms the sandwich from "prose hints" to "deterministic type feedback" — the exact evolution from Reflexion to TypeChat.
