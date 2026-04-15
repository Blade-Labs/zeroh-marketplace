---
name: criteria-first-tdd
description: "Criteria-First Gate-Driven Development — decision trees for criteria-first governance using CRITERIA-RED-GREEN-RATCHET cycle. Use when writing acceptance criteria, designing gates, encountering failing tests, deciding gate type/severity, or detecting test capitulation. Triggers on: acceptance criteria, test failures, gate design, vitest, gate.assert(), ratchet, ceiling, criteria-first, ATDD."
disable-model-invocation: false
---

# ZeroH ATDD — Criteria-First Gate-Driven Development

You reason about criteria-first governance decisions using the CRITERIA-RED-GREEN-RATCHET cycle — ATDD (Acceptance Test-Driven Development) adapted for LLM-driven development with architectural fitness gates. Acceptance criteria are the machine-readable Definition of Done that prevents premature completion.

---

## Mental Model: CRITERIA-RED-GREEN-RATCHET

Kent Beck's TDD cycle, extended with ATDD's criteria-first principle for LLM-driven development:

| Phase | ZeroH Equivalent | What Happens |
|-------|-----------------|--------------|
| **CRITERIA** | Declare acceptance criteria at source | Define what must be true BEFORE writing any code or tests. Criteria are the machine-readable DOD. |
| **RED** | Write failing gate | Write tests with `@covers` annotations referencing criteria IDs. They fail because code doesn't exist yet. |
| **GREEN** | Implement until gate passes | Write the minimum code to make tests pass. The criteria define "done". |
| **RATCHET** | Lock improvement baseline | Lock the baseline so violations can only decrease. This replaces REFACTOR — improvement is monotonic and enforced. |

```
CRITERIA ──→ RED ──→ GREEN ──→ RATCHET ──→ CRITERIA (next artifact)
 │            │         │          │
 │            │         │          └── UPDATE_BASELINE=1 pnpm test:fitness
 │            │         └── Implement until tests pass
 │            └── Write tests with @covers for each criterion
 └── Declare acceptance criteria in the feature contract (route config, API spec, or shape definition)
```

### Cynefin Qualifier: When Criteria Come First

Criteria-first applies to **Clear and Complicated domains** (Cynefin framework):

| Domain | Protocol | Why |
|--------|----------|-----|
| **Clear** | CRITERIA → RED → GREEN → RATCHET | Requirements known. Criteria expressible upfront. |
| **Complicated** | CRITERIA → RED → GREEN → RATCHET | Expert decomposes requirements into criteria first. |
| **Complex** | Probe → (criteria emerge) → RED → GREEN → RATCHET | Must probe first. Criteria are premature before understanding. Use `.vibe/` sessions. |
| **Chaotic** | Act → Stabilize → (criteria post-facto) → RATCHET | No time for criteria. Stabilize first, formalize later. |

**Default to Complicated** when unsure. Criteria-first is the safer choice — overspecification is cheaper than premature completion (the #1 LLM anti-pattern).

**Machine-readable DOD:** An LLM cannot declare "done" until `uncovered must-priority criteria = 0`. This directly solves AP: Premature Completion — the subjective "are we done?" becomes a structural gate: running acceptance criteria coverage tests.

---

## Mental Model: Convention-Gated Trust Chain (CGTC)

Trust is earned layer by layer. Each layer depends on the one below it being locked.

```
Layer 0: CONVENTION ──── "What must be true about a file?"
   │     ceiling gates, zero tolerance (Design by Contract)
   │
Layer 1: DISCOVERY ───── "Find all artifacts matching convention"
   │     parity gates: glob count === discovery count (CoC)
   │
Layer 2: TRIANGULATION ─ "Are the numbers real?"
   │     cross-verify: filesystem === discovery === registry (IV&V)
   │
Layer 3: DOWNSTREAM ──── "Build on trustworthy data"
         ratchets, dashboards, pipelines (Fitness Functions)
```

**The invariant:** You CANNOT work on Layer N until Layer N-1 is locked. A dashboard on unverified discovery shows unknown unknowns as zeros.

A convention has four dimensions — all must hold simultaneously:

| Dimension | Question | Example |
|---|---|---|
| **Location** | Can discovery FIND it? | Shape files must follow the project's naming and location convention |
| **Export Shape** | Can discovery EXTRACT it? | Must export `*Shape` with `.meta()` returning non-null |
| **Completeness** | Can classification USE it? | `.meta()` must include `{ id, prefLabel, definition, category, version }` |
| **Behavioral** | Does it DO what it claims? | Route must declare `acceptanceCriteria` with `@covers` tests (ADR-GOV-004) |

The trust chain itself follows nested RED-GREEN-RATCHET: the outer loop iterates layers (0 → 3), the inner loop applies RED-GREEN-RATCHET within each layer. Each layer's RATCHET is the precondition for the next layer's RED.

For the full theory, established framework mappings (Meyer, DO-178C, DHH, NIST, X.509, NASA IV&V), and triangulation gate patterns, see `references/trust-chain-framework.md`.

---

## Trigger

This framework activates when:

- You need to decide what kind of test to write (gate vs fitness vs unit)
- You encounter a failing gate and need to decide: fix code or fix test?
- You're designing a new invariant and need to choose severity/type
- You suspect test capitulation (AP3) — weakening a test instead of fixing code
- Sprint Phase 0 asks you to "codify" requirements as tests first
- You're planning a convention hardening sprint (which layer first?)
- You need to decide if a metric is trustworthy enough to build on
- You're implementing a new route, shape, or op and need to write acceptance criteria first
- You need to determine if criteria should precede implementation (Cynefin qualifier)

---

## Decision Tree 1: Test Tier Selection

```
What are you validating?
│
├─ Architectural invariant (MUST be true always)?
│  └─→ GATE (tests/gates/) — pre-commit, severity: error
│      Examples: zone boundaries, naming conventions, export wiring
│
├─ Progressive quality metric (getting better over time)?
│  └─→ FITNESS (tests/fitness/) — CI, severity: warn + ratchet
│      Examples: describe coverage, provenance completeness, token ceilings
│
└─ Function/component behavior (unit logic)?
   └─→ UNIT TEST (tests/unit/ or colocated) — vitest standard
       Examples: parser output, compute results, edge cases
```

**Key distinction:** Gates enforce invariants (binary pass/fail). Fitness tracks improvement (ratchet). Unit tests verify behavior (assertion).

---

## Decision Tree 2: Gate Type — Structural vs Behavioral

```
What does the gate check?
│
├─ File existence, export wiring, package structure?
│  └─→ STRUCTURAL (vacuous when absent)
│      Pattern: if (!existsSync(path)) return  // 0 violations = pass
│      Activates only when the artifact exists
│
├─ Data correctness, computation, validation?
│  └─→ BEHAVIORAL (fails until correct)
│      Pattern: const result = Schema.safeParse(data)
│      Fails immediately, drives implementation
│
└─ Unsure?
   └─→ Is the branch long-lived (>3 days)?
      ├─ YES → STRUCTURAL (green CI throughout)
      └─ NO  → Either works, prefer BEHAVIORAL for short branches
```

---

## Decision Tree 3: Severity — Hard Gate vs Ratchet

```
Can you tolerate pre-existing violations?
│
├─ NO — This invariant must hold NOW (security, correctness)
│  └─→ severity: 'error' (hard gate, blocks commit)
│      Use: gate.assert() in tests/gates/
│
├─ YES — Existing violations OK, but no NEW ones
│  └─→ severity: 'warn' + ratchet baseline
│      Use: ratchet.assert() or checkRatchet() in tests/fitness/
│      Baseline: .fitness-baseline.json
│
└─ Need an upper bound (budget, ceiling)?
   └─→ ceiling.assert() with ceiling: N
       Use: ceiling fixture in tests/gates/ or tests/fitness/
```

**Ratchet protocol:** After fixing violations, tighten:
```bash
UPDATE_BASELINE=1 pnpm test:fitness
```

---

## Decision Tree 4: AP3 Detection — "Am I Capitulating?"

When a test fails, ask these questions IN ORDER:

```
Q1: Is the test correct? (Does it enforce the desired behavior per ADR/spec?)
│
├─ YES → Fix the code, not the test
│  │
│  Q2: Is the current behavior intentional? (Documented design decision?)
│  ├─ YES → Test was wrong. Fix test AND add comment explaining why.
│  └─ NO  → Current behavior is a bug. Fix the code.
│
└─ NO → Fix the test (rare — usually means you misread the spec)
```

**Red flags you're capitulating:**
- Changing `toThrow()` to `toBeUndefined()` without fixing root cause
- Using `--no-verify` to bypass a failing hook
- "Engine trusts upstream validation" (excuse for not validating)
- "Minimal fix" that adds shims instead of fixing root cause
- Removing a check from lint-staged because it fails
- "Pre-existing failures aren't my problem" (they are on a cleanup branch)

**The rule:** If your change makes a test pass by weakening the assertion rather than strengthening the code, it's capitulation.

---

## Decision Tree 5: Mock Policy

```
What are you tempted to mock?
│
├─ External I/O (network, filesystem, database)?
│  └─→ MOCK IT — isolate from external dependencies
│
├─ Internal module behavior (business logic, validation)?
│  └─→ DO NOT MOCK — test the real implementation
│      Mocking internals hides bugs and creates false confidence
│
├─ Architectural invariant (zone boundary, naming rule)?
│  └─→ NEVER MOCK — invariants must be tested against real codebase
│      Gate tests scan actual files, not mocked structures
│
└─ Time/randomness?
   └─→ MOCK IT — use deterministic seeds/clocks
```

**Key principle:** Gate tests operate on the real codebase. They scan actual files, parse actual exports, validate actual data. Mocking defeats the purpose.

---

## Decision Tree 6: TED Metadata Completeness

Every `gate.assert()` call MUST include all 6 TED fields. Check:

```
gateId:      Unique identifier?           (e.g., 'K19-GLOBALMETA-PROVENANCE')
severity:    error or warn?               (error = blocks, warn = advisory)
owner:       Who owns this invariant?     (e.g., 'governance', 'privacy')
rule:        One-line rule statement?      (what MUST be true)
rationale:   WHY does this invariant exist? (consequence of violation)
remediation: HOW to fix? (array of steps) (import paths, code templates, examples)
```

**Incomplete TED = useless test.** A gate that says "validation failed" without remediation steps forces the agent to guess. A gate that says "Add `.describe()` to field X — see `scoring-dimension.shape.ts` for canonical example" enables immediate action.

For the formal TED specification, see `references/ted-pattern.md`.

---

## Decision Tree 7: Trust Layer Selection

When planning a hardening sprint or writing a gate that enforces data quality, determine which trust layer you're operating on:

```
What are you trying to enforce?
│
├─ File naming, location, export shape, metadata completeness?
│  └─→ Layer 0: CONVENTION
│      Fixture: ceiling(0) — zero tolerance, CI-failing
│      Gate ID prefix: C{N}
│      Location: tests/gates/architecture/ or catalogs/suffix-rules.ts
│
├─ "Discovery finds everything" — glob count matches file count?
│  └─→ Layer 1: DISCOVERY
│      Fixture: ceiling(0) — filesystem count === discovery count
│      Gate ID prefix: L1
│      Location: tests/gates/architecture/
│
├─ "Multiple sources agree" — filesystem vs discovery vs registry?
│  └─→ Layer 2: TRIANGULATION
│      Fixture: ceiling(0) — all sources agree within tolerance
│      Gate ID prefix: L2
│      Location: tests/fitness/governance/
│
└─ Metrics, dashboards, ratchets built on discovery data?
   └─→ Layer 3: DOWNSTREAM
       Fixture: ratchet() — derived from trusted discovery, never hardcoded
       Gate ID prefix: varies by domain (K, M, SC, D, etc.)
       Location: tests/fitness/

CRITICAL: If Layer N-1 is not locked, do NOT write Layer N gates.
A ratchet (L3) on unverified discovery (L1) ratchets toward a lie.
```

---

## Decision Tree 8: Convention Dimension

When writing a Layer 0 convention gate, determine which dimension you're checking:

```
What aspect of the convention is violated?
│
├─ File is in the WRONG PLACE (discovery can't find it)?
│  └─→ LOCATION gate
│      Pattern: glob ALL files with suffix → filter those outside canonical path
│      Example: *.shape.ts not in the expected shapes directory → invisible to discovery
│      TED rationale: "discoverX() only scans {canonical path}. Files elsewhere are invisible."
│
├─ File is in the right place but exports WRONG SHAPE (discovery skips it)?
│  └─→ EXPORT SHAPE gate
│      Pattern: import each file → check type guard → flag empty extractions
│      Example: .op.ts that doesn't export isCompiledOp() → discovered but yields nothing
│      TED rationale: "discover-ops checks isCompiledOp(). Non-conforming exports are silently skipped."
│
└─ File exports correctly but metadata is INCOMPLETE (classification breaks)?
   └─→ COMPLETENESS gate
       Pattern: extract metadata → validate minimum required fields
       Example: shape.meta() missing { id, prefLabel } → classifies as 'none' instead of 'secondary'
       TED rationale: "classifyMetaTier() reads these fields. Missing fields cause misclassification."
```

All three must hold simultaneously. A file in the right location with wrong exports is invisible. A file with correct exports but incomplete metadata is misclassified.

---

## Decision Tree 9: Catalog vs Standalone Gate

When adding a new convention rule, decide whether to extend the existing catalog or write a standalone gate:

```
Is this a file-suffix naming rule (*.op.ts, *.shape.ts, *.hook.ts)?
│
├─ YES → Add to the project's suffix-rules catalog
│        The file-naming.test.ts gate iterates the catalog automatically.
│        One data entry, zero test code. (Policy/mechanism split.)
│        See: existing SUFFIX_RULES[] for the SuffixRule interface.
│
└─ NO → Write a standalone gate
        ├─ Convention (location/shape/completeness) → tests/gates/architecture/
        ├─ Zone boundary or security → tests/gates/safety/
        ├─ Emission determinism → tests/gates/drift/
        └─ Progressive quality metric → tests/fitness/governance/
```

**The catalog pattern:** `suffix-rules.ts` is a typed `SuffixRule[]` array. Each entry carries its own TED metadata (`rationale`, `remediation`). The test file `file-naming.test.ts` iterates `for...of SUFFIX_RULES` with `gate()` — adding a rule requires zero test code changes. This is the policy/mechanism split: catalog owns *what*, test owns *how*.

---

## Decision Tree 10: Intelligence Tier Selection

```
What layer of analysis does this gate need?
│
├─ File existence, naming, location?
│  └─→ LEXICAL (regex/glob) — fastest, every commit
│      No script needed. Use fg.sync() or readFileSync + regex.
│      Tier: gate (zero-dep, pre-commit per ADR-AFT-001)
│
├─ Export analysis, import resolution, .meta() typing?
│  └─→ STRUCTURAL (ts-morph)
│      Script: AST analysis tool for your project
│      Tier: fitness (AST-allowed, CI only)
│      Heuristic: If your regex has \s*\( or \{, you need AST
│
├─ Zone trust, circular deps, dependency direction?
│  └─→ ARCHITECTURAL (ArchUnitTS / dependency-cruiser)
│      Script: Architecture rule checker for your project
│      Tier: fitness (CI only)
│      When: The check involves relationships BETWEEN files
│
├─ Semantic coherence, intent matching, documentation accuracy?
│  └─→ INTENT (LLM judge)
│      Script: # Project-specific judge command, e.g.: pnpm judge --rubric {rubric} --model {model}
│      Tier: fitness only, advisory only (never hard gate)
│      When: No deterministic analysis can answer the question
│
└─ Unsure?
   └─→ Start deterministic, escalate if ambiguous.
       70% of surface is deterministic (free). See intelligence-pyramid.md
```

**ADR-AFT-001 boundary:** Gates (pre-commit) are zero-dep — NO ts-morph, ArchUnitTS, or sdi-ai imports. Scripts are agent/fitness tools only.

---

## Decision Tree 11: Model Selection (Cognitive Fit)

```
What cognitive task does the LLM judge perform?
│
├─ Classification or labeling → FAST (Haiku — Opus overthinks labels)
├─ Breadth scanning → STANDARD (Sonnet — better survey-per-token ratio)
├─ Deep architectural judgment → EXPERT (Opus — system-wide implications)
├─ Remediation authoring → EXPERT (Opus — full system understanding needed)
└─ Calibration validation → EXPERT (Opus — rubric + domain understanding)
```

Maps `--model fast|standard|expert` to `the project's AI model tier module` ModelTier. See `references/llm-judge-calibration.md` for tiered cascade pattern (Haiku screens → Sonnet resolves → Opus for disputes).

**Empirical evidence (wire-up-completeness calibration, 2026-02-25):**
- Sonnet (standard) on rubric v2: κ = −0.071 (worse than chance — 5 false negatives on boundary cases)
- Opus (expert) on rubric v3: κ = 0.867 (almost perfect — caught a gold set labeling error humans missed)
- Same rubric structure, tighter criteria + Opus = 12-point swing. Calibration is an expert cognitive task — Sonnet lacks the domain reasoning to resolve ambiguous boundary cases (skill-specific CLI vs platform-wide commands, cautionary mentions vs active instructions).

---

## Decision Tree 12: The IRIS Protocol (ADR → Gate)

Converting ADR prose into machine-enforced gates:

```
1. EXTRACT — Read ADR, identify constraint (what MUST be true)
   Tool: Opus reads prose, outputs structured constraint

2. FORMALIZE — Express as structural rule
   ├─ Import boundary? → # Project-specific arch command, e.g.: pnpm arch --rules zone-trust
   ├─ File convention? → # Project-specific AST command, e.g.: pnpm ast --query {exports|imports}
   └─ Dependency rule? → # Project-specific deps command, e.g.: pnpm deps --circular

3. EXECUTE — Run structural tool, collect violations

4. FILTER — LLM reviews violations for false positives (optional)
   Tool: # Project-specific judge command, e.g.: pnpm judge --rubric adr-code-alignment.rubric.md

5. RATCHET — Lock count. Violations can only decrease.
   Tool: ratchet.assert() in tests/fitness/
```

See `references/iris-pattern.md` for full protocol with examples.

---

## Decision Tree 13: Token Budget Awareness

```
You are adding LLM intelligence to a test. Ask:
│
├─ Can a deterministic check answer this? (regex, AST, type-check)
│  └─→ YES: Use it. Free. Deterministic. Always prefer.
│
├─ Is the rubric stable (unchanged for weeks)?
│  └─→ CACHE-EFFICIENT. Rubric in system prompt = 90% cost savings.
│      Cluster judge calls within 5-min TTL window.
│
├─ Is the rubric actively being iterated?
│  └─→ EXPENSIVE. Every edit = cache miss = 12.5x cost spike.
│      Iterate locally, calibrate (κ > 0.8), then deploy.
│
├─ Is this gating a commit (pre-merge CI)?
│  └─→ DETERMINISTIC ONLY. LLM flakiness in CI = developer distrust.
│      LLM advisory in nightly suite, not PR gate.
│
└─ Updating a ratchet baseline after a rubric change?
   └─→ STOP. Rubric change shifts score distribution.
       The baseline is from a different rubric. Re-establish, don't tighten.
       See references/token-economics.md (DV-5: Ratchet Baseline Corruption)
```

---

## Decision Tree 14: Intelligent Gate Lifecycle

```
When to enter: Decision Tree 10 selected INTENT tier (LLM judge required)
Goal: Build, calibrate, and activate an LLM-judged fitness gate

Which step are you on?
│
├─ Step 1: RUBRIC — Define what "good" means
│  │  Write rubrics/{concern}.rubric.md using Three-Tier structure:
│  │  - Essential: hard blockers (auto-FAIL if any answer is NO)
│  │  - Important: advisory quality signals (logged, does not block)
│  │  - Pitfall: inverse checks (auto-FAIL if any answer is YES)
│  │  Rules:
│  │  - Every criterion is a yes/no question with measurable condition
│  │  - One rubric per concern (monolithic rubrics divide LLM attention)
│  │  - Include 3-5 few-shot examples (PASS, FAIL, BORDERLINE)
│  │  See: references/llm-judge-calibration.md § Rubric-as-Rewards
│  │
│  └─→ Rubric written? → Step 2
│
├─ Step 2: GOLD SET — Curate human-labeled examples
│  │  Write gold-sets/{concern}.gold.json with 20+ examples:
│  │  - Balance: include both PASS and FAIL examples (≥20% each class)
│  │  - Verify: every file path exists, every label matches actual code
│  │  - Rationale: explain WHY each example passes or fails
│  │  Common trap: labeling based on what you THINK the code does
│  │  instead of what it ACTUALLY does. Always verify with grep/read.
│  │  See: references/llm-judge-calibration.md § The Gold Set
│  │
│  │  **Gold set composition requirements (AP-9 prevention):**
│  │  - ≥50% REAL artifacts: actual project files, not LLM-generated fixtures
│  │  - ≥2 BOUNDARY cases: artifacts where PASS/FAIL is genuinely debatable
│  │    (almost-good with one subtle flaw, or technically-failing but reasonable)
│  │  - LLM-generated fixtures supplement real artifacts for coverage gaps only
│  │  - NEVER let the same model generate ALL fixtures AND judge them
│  │    (Xu et al. 2025: 6x bias amplification in dual-source LLM benchmarks)
│  │  - If you must use LLM-generated fixtures, verify a human agrees with
│  │    the label BEFORE adding to gold set. "Verify with grep/read" is not
│  │    sufficient — the LLM's concept of "bad" is its own competence boundary.
│  │
│  └─→ Gold set curated? → Step 3
│
├─ Step 3: CALIBRATE — Prove judge agrees with human labels
│  │  Run: # Project-specific judge command, e.g.: pnpm judge --rubric X --gold-set Y --calibrate --model expert
│  │  Read κ score:
│  │    κ > 0.8 → PASS — proceed to Step 4
│  │    κ 0.6-0.8 → analyze disagreements:
│  │      Self-feedback first (Honk Lesson 6): ask "What criteria in this rubric
│  │      were ambiguous or underspecified given these disagreements?" The response
│  │      reliably identifies the specific rubric weakness — converting a 3-iteration
│  │      calibration loop into 1-2 iterations.
│  │      Is the human label wrong? → fix gold set (back to Step 2)
│  │      Is the rubric ambiguous? → tighten criteria, add few-shot (back to Step 1)
│  │    κ < 0.6 → rubric is broken, rewrite criteria (back to Step 1)
│  │  Max 3 iterations per calibration attempt.
│  │  Save result to tests/fitness/calibration-baselines/{concern}.json
│  │
│  │  **Calibration lessons (empirical):**
│  │  - Use `--model expert` (Opus). Calibration is a DT11 expert task. Sonnet
│  │    lacks domain reasoning for boundary cases (κ = −0.071 vs Opus κ = 0.867).
│  │  - Class imbalance kills κ. Target ≥20% FAIL examples in gold set.
│  │    22 PASS / 2 FAIL = mathematically unstable even with perfect agreement.
│  │  - Rubric scope must match judge input. If the judge only sees SKILL.md,
│  │    criteria requiring registry files (TOOL_DEFS, TOOL_HANDLERS) cause
│  │    systematic false negatives.
│  │  - Trust the judge on disagreements. The judge caught a human labeling
│  │    error (commented-out `# allowed-tools:` line) that visual review missed.
│  │
│  │  **κ interpretation (including suspiciously high scores):**
│  │    κ > 0.8, κ < 0.95 → HEALTHY — proceed to Step 4
│  │    κ ≥ 0.95           → SUSPECT — gold set likely too easy (AP-9 risk)
│  │                          Action: verify ≥2 boundary cases exist, verify
│  │                          ≥50% real artifacts, check if LLM generated both
│  │                          fixtures AND judged them (circular evaluation).
│  │    κ = 1.0            → RED FLAG — almost certainly tautological
│  │                          Expected κ for well-calibrated judge ≈ 0.8 (same
│  │                          as human-to-human agreement). Perfect agreement
│  │                          signals the task is trivially easy OR raters share
│  │                          systematic bias (same model = same perplexity
│  │                          preferences). MUST add boundary cases before
│  │                          proceeding. See AP-9 and references/llm-judge-calibration.md.
│  │
│  │  **Cross-model validation (AP-9 mitigation):**
│  │  After achieving κ > 0.8 with the primary judge, run the automated
│  │  triparty protocol with `--cross-validate` to evaluate across all 3
│  │  model families (Opus, GPT-5.2 Pro, Gemini 3.1 Pro) simultaneously.
│  │  Produces: pairwise Cohen's κ, Fleiss' κ (3-rater agreement),
│  │  majority verdicts, and per-provider bias analysis (FPR/FNR).
│  │  See references/llm-judge-calibration.md § Triparty Evaluation Protocol.
│  │
│  │  ```bash
│  │  # Single-provider calibration (default: Opus)
│  │  # Project-specific judge command, e.g.: pnpm judge --rubric X --gold-set Y --calibrate --model expert
│  │
│  │  # Automated 3-model jury (Opus + GPT-5.2 Pro + Gemini 3.1 Pro)
│  │  # Project-specific judge command, e.g.: pnpm judge --rubric X --gold-set Y --calibrate --cross-validate
│  │
│  │  # Manual single-provider (still supported)
│  │  # Project-specific judge command, e.g.: pnpm judge --rubric X --gold-set Y --calibrate --model expert --provider openai
│  │  ```
│  │
│  │  **Triparty output:**
│  │  - Per-provider `CalibrationRunArtifact` with `EvaluationRecord[]`
│  │  - Progressive NDJSON on stderr (one record per example, real-time)
│  │  - Pairwise Cohen's κ (Opus↔GPT, Opus↔Gemini, GPT↔Gemini)
│  │  - Fleiss' κ across all 3 raters
│  │  - Majority verdicts per example (2/3 or 3/3 agreement)
│  │  - Bias analysis: FPR/FNR per provider against human labels
│  │  Requires: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`
│  │
│  └─→ 0.8 < κ < 0.95? → Step 4
│
├─ Step 4: WIRE — Connect to fitness test
│  │  The fitness test file (tests/fitness/) must:
│  │  - Import JudgeHelper from tests/fitness/support/intelligent-fixture.ts
│  │  - Gate LLM tier behind: process.env.ZEROH_JUDGE_ENABLED === '1'
│  │  - Tier 1 (deterministic): always runs, severity: 'warn' + ratchet
│  │  - Tier 2 (LLM judge): only when ZEROH_JUDGE_ENABLED=1, advisory only
│  │  - LLM result stored as $stochastic evidence (never hard gate)
│  │  See: tests/fitness/governance/ for existing wired examples
│  │
│  └─→ Fitness test wired? → Step 5
│
└─ Step 5: ACTIVATE — Verify end-to-end
   Test both modes:
   - ZEROH_JUDGE_ENABLED=1 → Tier 1 + Tier 2 run, no crashes, no timeouts
   - Without env var → Tier 1 runs, Tier 2 skipped gracefully
   Gate is now active. LLM judge runs nightly, not on PR.
   DONE.
```

**Router detection signals (for sub-step routing):**

| Signal | Sub-step |
|--------|----------|
| No `rubrics/{concern}.rubric.md` | Step 1: RUBRIC |
| Rubric exists, no `gold-sets/{concern}.gold.json` | Step 2: GOLD SET |
| Rubric + gold set exist, no `tests/fitness/calibration-baselines/{concern}.json` | Step 3: CALIBRATE |
| Calibrated (κ > 0.8), no fitness test wiring | Step 4: WIRE |
| Wired but not verified end-to-end | Step 5: ACTIVATE |
| All complete | DONE |

---

## The RED Phase Checklist (Writing New Gates)

When entering RED phase (writing a new gate before implementation):

0. **Criteria declared?** — For new artifacts in Clear/Complicated domains, acceptance criteria must already be declared at source. If not → complete CRITERIA phase first (see Mental Model 1 and `references/tdd-methodology.md` § CRITERIA Phase Protocol).
1. **Search first** — Does a gate for this invariant already exist? Check `tests/gates/`, `tests/fitness/`, and `catalogs/suffix-rules.ts`. Extend existing gates before creating new ones. (AP: Creating Parallel Systems)
2. **Determine trust layer** — Convention, Discovery, Triangulation, or Downstream? → Decision Tree 7
3. **Name the invariant** — What MUST be true? Write it as a one-sentence rule.
4. **Choose tier** — Gate (pre-commit) or Fitness (CI)? → Decision Tree 1
   - 4a. **Choose intelligence tier** → Decision Tree 10. If INTENT tier → follow **Decision Tree 14** (Intelligent Gate Lifecycle) instead of continuing below.
5. **Choose type** — Structural or Behavioral? → Decision Tree 2
6. **Choose severity** — Hard gate or ratchet? → Decision Tree 3
7. **Choose mechanism** — Catalog entry or standalone gate? → Decision Tree 9
8. **Write the gate** — COLLECT → EVALUATE → ASSERT pattern
9. **Fill TED metadata** — All 6 fields complete → Decision Tree 6
10. **Verify it fails** — Run the gate, confirm RED (expected failure)
11. **Commit the RED gate** — `test(gates): add {GATE-ID} gate (RED — drives {feature})`

Then transition to GREEN: implement until the gate passes.

For detailed Kent Beck mapping and the formal RED-GREEN-RATCHET specification, see `references/tdd-methodology.md`.
For gate fixture anatomy and naming conventions, see `references/gate-design-framework.md`.

---

## Anti-Patterns

- **Do NOT weaken a test to make it pass.** Fix the code. This is AP3 (Test Capitulation) — the #1 anti-pattern. See Decision Tree 4.
- **Do NOT skip pre-commit hooks** with `--no-verify`. If the hook fails, the code has a problem. Fix the problem.
- **Do NOT mock invariants.** Gate tests scan real files. Mocking the filesystem defeats the purpose of architectural testing.
- **Do NOT write gates without TED metadata.** A gate that says "failed" without remediation is worse than no gate — it blocks without guiding.
- **Do NOT use `it.each()` with gate fixtures.** It doesn't inject fixture context. Use `for...of + gate()` instead.
- **Do NOT combine COLLECT and EVALUATE.** Separate data gathering from rule checking. This makes gates reusable and debuggable.
- **Do NOT build downstream metrics on unverified discovery.** A ratchet on a count that misses invisible files ratchets toward a lie. Lock Layer 0 (convention) before trusting Layer 1 (discovery). See Decision Tree 7.
- **Do NOT hardcode baselines that can be derived.** If the emitted registry already tracks a count, derive from it. Hardcoded constants go stale silently. The registry IS the baseline.
- **Do NOT implement without declared acceptance criteria** in Clear/Complicated domains. Criteria-first is the golden pattern for LLM-driven development. Implementing before declaring criteria means the LLM has no machine-readable DOD — it WILL declare "done" prematurely. Exception: Complex/Chaotic domains (Cynefin qualifier). See ADR-GOV-004.
- **Do NOT bundle multiple invariants into one RED-GREEN-RATCHET cycle** (Spotify Honk Lesson 5). Each cycle targets ONE invariant. Compound invariants cause partial completion, debugging ambiguity, and context exhaustion. If two invariants are related, run two cycles sequentially. Decompose at the orchestration layer, not in the gate.
- **Do NOT let the same LLM generate gold set fixtures AND judge them (AP-9: Circular Evaluation).** When the same model writes FAIL fixtures to match rubric criteria, then judges whether those fixtures fail, κ=1.0 is the *expected* outcome — not evidence of rubric quality. The model's perplexity preferences are consistent with themselves. This is not calibration; it is tautological self-agreement. LLM-generated fixtures create failures maximally distinguishable *to the generating model* but not necessarily to humans or different models (Xu et al. 2025: 6x bias amplification in dual-source benchmarks). Gold sets MUST contain ≥50% real artifacts and ≥2 boundary cases where PASS/FAIL is genuinely debatable. See DT14 Step 2 composition requirements.

---

## Post-Failure Reflection Protocol (Spotify Honk Lesson 6)

After a failed or incomplete session, the agent itself is in a surprisingly good position to identify what was missing. This backward-looking protocol turns failures into permanent improvements.

### When a gate you wrote fails unexpectedly

1. **REFLECT** — Ask: "What context was missing that would have helped me write this gate correctly the first time?"
2. **CAPTURE** — Record the answer in the commit message body under `Findings:` so it survives context compaction
3. **FEED BACK** — If the missing context is a pattern that should be in a reference file, update the reference. One failure should prevent all future instances of the same failure.

### When calibration fails (κ < 0.8)

1. **Before iterating the rubric**, ask: "What criteria were ambiguous that caused the disagreements?" The response reliably identifies the specific rubric weakness — converting a 3-iteration calibration loop into 1-2 iterations.
2. **Log the specific ambiguity and resolution** in the calibration baseline artifact (`tests/fitness/calibration-baselines/{concern}.json`) under a `lessons` array.
3. This creates an audit trail of rubric evolution — each calibration failure produces a named insight.

### When an agent task completes but the output is wrong

1. **Query the agent**: "What context was missing that would have helped you complete this task correctly?"
2. **Use the response as a structured prompt improvement signal** — update the prompt, preconditions, or examples. Do not re-run immediately.
3. **The agent's post-failure introspection is a usable signal, not noise.** Treat it as diagnostic data with the same rigor as a stack trace.

---

## Key Principle

> Tests are not penalties. They are remediation signals pointing at technical debt. The goal is not to make the test pass — the goal is to use the test to remove debt properly.

> Acceptance criteria are the contract. Tests verify the contract. Gates enforce the contract. Code implements the contract. Without criteria, there is no contract — only hope.

---

## References

| Reference | Contains |
|---|---|
| `references/tdd-methodology.md` | Kent Beck origins, RED-GREEN-RATCHET formal spec, sprint integration |
| `references/gate-design-framework.md` | Fixture anatomy (gate/ratchet/ceiling), naming, COLLECT-EVALUATE-ASSERT |
| `references/ted-pattern.md` | TED metadata schema, BDD comparison, golden output checklist |
| `references/trust-chain-framework.md` | CGTC theory, 6 established frameworks, convention dimensions, triangulation patterns, vocabulary |
| `references/intelligence-pyramid.md` | 5-layer analysis taxonomy (Lexical → Intent), tool mapping, 70/30 rule |
| `references/iris-pattern.md` | IRIS 5-step protocol (EXTRACT→FORMALIZE→EXECUTE→FILTER→RATCHET) for ADR→gate |
| `references/tricorder-lessons.md` | Google Tricorder <5% FP threshold, Beyonce Rule, developer trust metrics |
| `references/llm-judge-calibration.md` | GoDaddy Rubrics-as-Rewards, 9 anti-patterns (AP-8 + AP-9), Cohen's κ calibration, tiered cascade, cross-model validation. Theory backing for DT14 Steps 1-3. |
| `references/research-circular-evaluation.md` | Verified research sources for AP-9: Xu et al. (dual-source amplification), Panickssery/Wataoka (self-preference), Lehr (extreme self-preference), CoBBLEr (cognitive bias taxonomy), κ independence assumption. |
| `references/token-economics.md` | Prompt cache mechanics, 5 drift vectors, 12.5x cost swing, token budget strategy |
| `docs/adrs/ADR-GOV-004-criteria-first-development.md` | Criteria-first as CGTC Layer 0, ATDD + OSCAL + CGTC synthesis, Cynefin qualifier, research evidence |
| `rubrics/` | Three-tier rubric files (Essential/Important/Pitfall) for LLM judges. Created via DT14 Step 1. |
| `gold-sets/` | Human-labeled examples (20+ per rubric) for calibration. Created via DT14 Step 2. |
| `tests/fitness/calibration-baselines/` | κ scores, agreement matrices, model IDs. Written by DT14 Step 3. |

---

## Completion

**After applying the appropriate decision tree and taking the recommended action (writing a gate, fixing code, locking a ratchet, or determining the correct trust layer), you are DONE.**
