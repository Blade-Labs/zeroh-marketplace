# Gate Protocol

Detailed protocol for the phase validation gate invoked by `do-phase` Step 4 and the phase completion fields invoked by Step 5.

**Escalation contract (rule #1, mirrored on the phase-executor card).** Blocked, or the only
path forward narrows an acceptance criterion / records a compromise the architect did not
bless? **Escalate — escalating IS success.** Invoke `software-architect` per the Prime-Rule-1
Decision Contract; on an `ESCALATE_TO_USER` verdict (or a `[MULTI-REPO]`/`[PRODUCT]` hard-stop)
surface it (inline) or return `status: "escalated"` (arc-mode). A criterion silently narrowed
to reach `done` is the one unacceptable outcome; a fabricated `done` is never better than an
honest `escalated`.

## Overview

Four stages, run in order:

1. **Architect-critique pass** (one-shot, no looping). `architect-critique` agent hunts shortcuts, hardcodes, TODOs, and pre-existing issues in touched files. Auto-fixes everything within scope; surfaces only true hard-stops.
2. **Round 0 — Simplify pass** (one-shot, no looping). `simplifier` agent removes dead scaffolding, speculative abstractions, and any over-extraction the critique may have introduced. Runs exactly once per phase.
3. **Rounds 1..N — Correctness loop** (loops until clean, hard-cap 5). Mechanical checks + two parallel `code-reviewer` agents. Each round fixes findings and re-runs until zero actionable findings.
4. **Compromise summary** — aggregate every task's persisted `transparencyReport` PLUS the critique's surfaced items and hard-stops. This is the ONLY human stop-point in the gate (inline mode; under arc-mode the `do-arc` orchestrator owns the stop — see SKILL.md Step 4b).

Which of stages 1–3 run for a given phase is governed by the **Review-scope ladder** (below): `full` runs all three, `light` runs a single-reviewer stage 3 only, `none` runs no review agents. Stage 4 always runs.

After the gate passes, Step 5 fills the phase file with gate results, metrics, and completion date.

---

## Gate commands — the consumer binding (read this FIRST)

Every mechanical check in this protocol is a **named slot**, never a literal command. The
consumer repo binds each slot to its real command in a **`## Gate commands`** block in its
CLAUDE.md — the same consumer-binding seam `validate-arc` uses for `## Validation tiers`.
Slot names: `lint` · `types` · `unit` · `integration` · `build` · `e2e` · `emit`, plus two
OPTIONAL scoped slots — `integration-scoped` · `unit-scoped` — for running ONE suite/file
instead of the whole tier (see **Scoped slots** below).

Example consumer block:

```markdown
## Gate commands
- lint: npm run lint:boundaries
- types: npm run type-check
- unit: npm test
- integration: npm run test:integration
- build: npm run build
- e2e: npm run test:e2e
- emit: npm run emit:phases
- integration-scoped: node --test {files}   # OPTIONAL — {files} = space-separated suite paths
- unit-scoped: node --test {files}           # OPTIONAL — same contract, unit tier
```

**Resolution rules (fail-loud, never guess):**
- Read the block once per session from the consumer's CLAUDE.md; resolve every slot the
  selected gate set needs BEFORE running any check.
- A needed slot missing from the block → the gate **REFUSES** with: `Gate cannot run:
  '## Gate commands' in CLAUDE.md has no '<slot>' binding — add it.` Do not substitute a
  guessed `npm`/`pnpm` command: a guess that happens to execute can silently run the wrong
  check and report a false pass.
- The whole block absent → the gate **REFUSES**, naming the block and pointing at the
  example above.
- A slot explicitly bound to `none` (e.g. `e2e: none`) is the consumer's honest statement
  that the tier doesn't exist — record it as absent-by-declaration in the gate results;
  that is not a failure.

**Scoped slots (optional — `integration-scoped` / `unit-scoped`):** a consumer whose full
`integration`/`unit` slot runs a broad glob binds these to a template that runs a NARROW
file list, so a gate that needs to prove only the touched suite does not run the whole tier
(which can exceed the foreground window and push the run onto the unreliable background
path). The template carries the literal placeholder **`{files}`** — the gate substitutes a
space-separated list of suite/test paths VERBATIM, adding no quoting (the template author
owns quoting).

**Scoped-slot resolution rule (the single seam — stated here ONCE; the ladder, the arc-mode
column, and the long-running mechanic all reference THIS rule, never restate it):** when a
run should be scoped to specific files, use the matching scoped slot verbatim with `{files}`
substituted. If the consumer has NOT bound that scoped slot, run the FULL slot and record
`scoped slot missing — ran full suite` in the gate notes (`gate.integrationTests.notes` /
`gate.unitTests.notes`) — honest and fail-visible. NEVER append or invent a filter argument
on a full-suite slot: a guessed filter the runner ignores (or applies ON TOP of an inline
glob) silently runs everything while the gate believes it scoped — the exact FM2 failure
this arc closes.

---

## Gate Set by `phase.kind`

The gate set is selected from the phase's `kind` field (introduced in `@zeroh-roadmap-schema v3`):

| `kind` | Stages run |
|---|---|
| `mockup` | Mechanical only: the `lint` + `types` slots. Skip Architect-Critique, Round 0, and Rounds 1..N. Compromise Summary still runs. |
| `logic` | All four stages (default behaviour). |
| `hardening` | All four stages **plus** the bug-fix closure rule from `review-phase` Mode B Step 2(b): for any persistence/event/marshal-chain task, the integration-suite rerun is the closure criterion. Quote the integration test diff in the compromise summary. Unit-test pass alone is NOT sufficient. |
| `release` | All four stages **plus** the `e2e` slot in Round 1's mechanical checks. |

If `kind` is missing on a legacy phase, treat as `logic` and emit a one-time warning pointing at `scripts/migrate/audit.ts`.

The `kind` field is required at schema parse time; the legacy fallback only covers phases authored before v3.


---

## Test-scope ladder (opt-in — narrows the TEST slots only, never the gate)

`kind` selects the agent chain, but it is a poor proxy for how much of the test pyramid a
diff needs: a `logic` phase whose diff is register data + two small scripts buys nothing
from a full-tier rerun, while the same `kind` on a spine refactor genuinely needs it. The
ladder scopes ONLY the `unit`/`integration` slots in Round 1's mechanical checks.
Everything else is UNCHANGED: lint/types/build/emit, the architect-critique → simplifier →
code-reviewer chain, `hardening`'s closure itest (never defers), `release`'s `e2e`.

**Opt-in (consumer-binding, fail-loud — the `## Gate commands` pattern):** the ladder is
honored ONLY when the consumer's CLAUDE.md declares a `## Test cadence` block naming the
backstop that re-covers untouched code off the phase gate:

```markdown
## Test cadence
- backstop: ci-pr-gate + nightly   # what re-runs the full suites off the phase gate
- floors: blocking                 # coverage floors enforced there (or 'advisory'/'none')
```

No block → the ladder is OFF and the kind × mode table applies as-is (today's behavior).
Never guess a consumer's CI posture: a consumer without a CI/nightly backstop keeps the
full-suite default because the phase gate IS its only line of defense.

**The ladder** (`phase.testScope`; absent → derived from the diff's path classes, the same
mechanical `git diff --name-only` classification the Round-0 docs-only skip uses):

| `testScope` | Derived when the diff is… | Test slots run |
|---|---|---|
| `static` | docs/data/assets/generated artifacts only (no executable code) | none — lint/types/emit only, plus a determinism re-run of any generator whose source is in the diff |
| `scoped` | code whose proving tests are enumerable | test files IN the diff + colocated `<name>.test.*` siblings of changed files + `phase.scopedTests` globs — exactly those files |
| `relevant` | src changes with cross-module consumers | scoped + the suites that exercise the touched modules (the arc-mode rule, promoted to inline) |
| `full` | any path matched by the consumer's `## Gate specialists` block, or declared | the whole kind × mode cell (today's behavior) |

**Floor rule (fail-loud):** derive the floor from the diff FIRST; a declared `testScope`
may only RAISE it. Declared below the derived floor → the gate REFUSES:
`testScope 'static' declared but the diff touches src/relay/governed-turn.ts
(## Gate specialists floor: full)`. A path important enough to swap in a specialist
reviewer is important enough for the full suite — one consumer seam, two consumers.

**Running the narrowed set:** the `scoped`/`relevant` file selections run through the
consumer's `integration-scoped` / `unit-scoped` slot per the scoped-slot resolution rule
(Gate-commands section above) — `{files}` = the selected paths, verbatim template; an
unbound scoped slot falls back to the full slot with the `scoped slot missing — ran full
suite` note. The ladder decides WHICH files; the resolution rule decides HOW they run.

**Honesty record:** any scope below `full` writes what was deferred and which backstop
covers it into `gate.unitTests.notes` (e.g. `deferred: full unit+integration tiers →
ci-pr-gate + nightly per ## Test cadence`) — a narrowed gate is a recorded state, never a
silent or ad-hoc one.

**Arc-mode note:** the arc-mode column of the kind × mode table already implements
`relevant` with the arc-end full run (do-arc Step 8) as its backstop. Under the ladder both
modes read as one rule — prove the touched code at the gate; the declared backstop
(`## Test cadence` inline, arc-end suite in arc-mode) re-covers the world.

---

## Review-scope ladder (plan-time configurable — narrows the AGENT chain)

The test-scope ladder scopes the mechanical slots; this ladder scopes the **agent chain**.
The flat chain (critique + simplifier + 2 reviewers on every `logic` phase) prices a one-line
fix and a spine refactor identically — the planner is better placed to say what review is
genuinely high-value for a given diff, and `review-phase` Mode A already reviews that plan.
No consumer opt-in block is needed (unlike the test ladder there is no deferred work needing
a backstop — a lower rung runs less review, recorded honestly; the release-time
`full-code-review`/release review remains the whole-tree backstop).

**The ladder** (`phase.reviewScope`; absent → derived from the diff at gate time):

| `reviewScope` | Derived when the diff is… | Agent stages run |
|---|---|---|
| `none` | docs/data/assets only (the same path-class test as the simplifier's pure-docs skip), or `kind: mockup` | No review agents. Mechanical checks + Compromise Summary only. |
| `light` | executable code, ≤ ~150 changed lines, touching NO `## Gate specialists` path and adding no new governed surface / contract / ledger event kind | ONE `code-reviewer` correctness loop (Rounds 1..N, same convergence + hard-cap rules). Skip Architect-Critique and Round 0. |
| `full` | anything else — always when a `## Gate specialists` path is touched | The full chain: Architect-Critique → Simplifier → 2 parallel reviewers (today's behavior). |

**Declaration semantics (deliberately different from `testScope`):** a declared
`reviewScope` is HONORED in both directions — the planner may lower a large-but-mechanical
diff to `light` or raise a subtle small diff to `full` — with ONE hard floor: a diff touching
any `## Gate specialists` path runs `full` regardless of declaration; the gate REFUSES a
lower declared value (`reviewScope 'light' declared but the diff touches src/relay/… —
## Gate specialists floor: full`) rather than honoring it. The legitimacy of a lowered rung
comes from plan review: `review-phase` Mode A judges the declared `reviewScope` against the
planned diff and returns NEEDS WORK on under-scoping, so a low rung that reaches the gate has
been independently ratified.

**Honesty record:** any rung below `full` writes what was skipped into the `gateRounds`
entries (e.g. Round 0 recorded as `skipped — reviewScope light (plan-ratified)`, and the
round-1 summary noting `1 reviewer — reviewScope light`) — a narrowed chain is a recorded
state, never a silent one.

---

## Per-Stage Echo Contract

Every gate-agent stage (Architect-Critique, Simplifier, each code-reviewer round) echoes a condensed summary inline in chat after the agent returns. The full agent report stays in the sub-agent transcript — the echo exists so the user has non-zero visibility without scrolling.

Cap each echo at **~10 lines / ~600 chars**. Truncate ruthlessly. If the agent's report is empty, a single line is enough (`[Simplifier] nothing to simplify`). Format examples in `do-phase/SKILL.md` Step 4.

This is in addition to the per-stage bookkeeping (commits, gateRounds entries, etc.) — it does not replace any of it.

---

## Architect-Critique Pass (one-shot)

**Runs only at `reviewScope: full`** (the Review-scope ladder above) — a `light`/`none` phase skips straight past this stage, recording the skip in `gateRounds`.

**Why it runs first:** shortcut-hunting is additive work (fixing hardcodes, adding proper handling, updating same-repo callers for a contract change). Running it before the simplifier means the simplifier gets a chance to trim any over-extraction the critique may have introduced. Running it before the code-reviewer loop means the reviewer validates the final combined result in one pass, not two.

**Why one-shot, not looping:** the critique makes judgment calls about whether a shortcut is worth fixing now vs. escalating. There is no "zero" state to converge on. The code-reviewer loop that runs after acts as the validation gate for the critique's fixes — if the critique introduces a correctness issue, reviewers will catch it.

### Protocol

1. Launch exactly one `architect-critique` agent **synchronously** (no `run_in_background`) with:
   - `git diff <phase-start-SHA>..HEAD` — the full phase diff (raw implementation, no simplifier run yet)
   - The phase file — for scope context and transparency-report compromises

   Block on the return. A background launch ends the parent turn and there is no completion notification until the sub-agent's final `end_turn` — the parent will appear to stop between the sub-agent's last commit and its summary.
2. The agent applies auto-fixes and commits as one: `fix(phase-N): architect critique — <summary>`. If nothing was fixed, it commits nothing.
3. Capture the agent's report. It has three sections:
   - **FIXED (auto)** — applied inline; no further action.
   - **SURFACED** — fixed, but worth flagging (DB migrations, schema changes). Carry forward to the compromise summary.
   - **HARD-STOPS** — tagged `[MULTI-REPO]`, `[SCOPED-OUT]`, `[PRODUCT]`, `[SPECULATIVE]`. Carry forward to the compromise summary for user decision.
4. If the agent reports nothing fixed and no hard-stops, that is a valid outcome. Proceed to Round 0.
5. **Do not re-run the agent.** The code-reviewer loop validates whatever the critique left.

---

## Round 0 — Simplify Pass (one-shot)

**Runs only at `reviewScope: full`** — a `light`/`none` phase records the `round: 0` entry as `skipped — reviewScope <rung> (plan-ratified)` and proceeds.

**Why it runs after critique, before correctness:** taste corrections invalidate bug findings. If the simplifier deletes a helper that the code-reviewer was about to flag, you avoid wasted rounds. And running the simplifier *after* the architect-critique lets it trim any over-extraction the critique may have introduced (e.g. a config object promoted for one caller).

**Why one-shot, not looping:** simplification is judgment. There is no "zero" state to converge on. Diminishing returns kick in after the first pass, and taste loops encourage over-deletion.

**Skip the simplify pass for a pure-docs/prose diff.** The simplifier's mandate — dead scaffolding, speculative abstractions, over-extraction — is a *code* lens; a phase whose diff touches no executable code has nothing for it to act on, and running it is pure overhead. Mechanical test (not a judgment call): list the phase diff's changed paths — `git diff --name-only <phase-start-SHA>..HEAD` — and if NONE is an executable-code file (`.ts` `.tsx` `.js` `.jsx` `.mjs` `.cjs` `.py` `.rego` `.sql` or a logic-bearing config), i.e. the diff is entirely Markdown/docs/assets, skip the agent and record the `round: 0` entry with summary `skipped — pure-docs diff, no code to simplify` (keep the audit trail honest). Any executable-code file in the diff → run the simplifier as normal. `mockup`-kind phases already skip the whole agent chain; this extends the same logic to docs-only diffs of any `kind`.

### Protocol

1. Launch exactly one `simplifier` agent **synchronously** (no `run_in_background`) with:
   - `git diff <phase-start-SHA>..HEAD` — the full phase diff, now including the architect-critique's commit
   - The phase file, for context on what the phase was supposed to accomplish
   - Scope reminder: fix taste issues, flag bugs for later rounds, do NOT fix correctness
2. The agent applies its edits inline and commits: `refactor(phase-N): simplify — <summary>`.
3. Capture the simplifier's report — flagged-but-unfixed items get fed to Round 1's code-reviewer agents.
4. If the simplifier reports "nothing to simplify", that is a valid outcome. Proceed to Round 1 with no changes.
5. **Do not re-run the simplifier.** Even if Round 1 introduces new complexity via fixes, trust the first pass.

### Record in gateRounds

Round 0 gets its own entry with `round: 0`:

```typescript
{
  round: 0,
  findings: [],  // simplifier does not return findings; see `simplifyPass` field
  summary: 'Round 0: simplify — −N lines across M files',
  simplifyPass: {
    linesRemoved: N,
    linesAdded: M,
    filesChanged: K,
    fixed: ['lib/foo.ts: removed unused _opts parameter', ...],
    skipped: ['lib/qux.ts:42 — speculative, unclear caller count'],
    bugsNoted: ['lib/zot.ts:88 — null check missing'],
  },
}
```

If `simplifyPass` is not yet in the phase schema, record the summary in the `summary` field and skip the structured `simplifyPass` sub-object. The schema migration is optional — the skill works either way.

---

## Rounds 1..N — Correctness Loop

The loop is automated. Each round fixes findings and re-runs agents without pausing for user input, until one round reports zero actionable findings.

### Round N (start with N=1)

**1. Mechanical checks.** Every step must pass before agents run. If any fails, fix it, commit, and restart Round N from the top. Which slots run is a **table lookup**, not a judgment call — resolve slots via the `## Gate commands` binding (top of this file), then run the cell for this phase's `kind` × mode — **narrowed by the Test-scope ladder (above) when, and only when, the consumer has a `## Test cadence` block**:

| `kind` \ mode | **Inline** (standalone do-phase) | **Arc-mode** (inside a phase-executor) |
|---|---|---|
| `mockup` | `lint` + `types` | `lint` + `types` |
| `logic` | `lint` + `types` + `unit` + `integration` + `build` | `lint` + `types` + `build` + tests **relevant to this diff** only |
| `hardening` | the `logic` row **plus** the closure integration test for any persistence/event/marshal-chain task | `lint` + `types` + `build` + relevant tests, **always including the closure integration test** (the closure criterion never defers) |
| `release` | the `logic` row **plus** the broad `e2e` slot | `lint` + `types` + `build` + relevant tests; broad `e2e` defers to the arc end |

Also run `bash scripts/pre-review.sh <first-task-SHA>~1` when that script exists in the consumer repo (a consumer-authored mechanical finding catcher; skip silently when absent).

Why the arc-mode column is narrower: re-running the whole unit+integration+e2e suite on every phase's gate runs it N times per arc — `do-arc` Step 8 runs the full suite ONCE at the arc end (after the sweep and validate-arc, since both can still land code), and a red suite there blocks the merge. A docs/config-only phase whose diff has no covering tests runs its relevant doc/lint checks and records honestly that no test suite applies.

The principle behind "relevant tests": always include the specific test(s) that *prove the touched code correct* — what defers is only the broad suite that re-covers untouched code. Those relevant/diff tests run through the consumer's `integration-scoped` / `unit-scoped` slot (scoped-slot resolution rule, Gate-commands section) — never an improvised filter; an unbound scoped slot falls back to the full slot with the honest `scoped slot missing — ran full suite` note.

**Long-running slots — the execution mechanic (do not improvise this).** A slot expected to run ≤ 8 min runs **foreground** under the consumer's documented wrapper with an explicit timeout; block on it. A slot expected to run longer (full unit tiers, coverage runs, integration+build chains) is backgrounded to a log file **and, in the same turn, before it ends,** a Monitor is armed whose script EXITS when the log shows the terminal line — with failure signatures (`FAILED|not ok|Error|Killed|OOM|exit [1-9]`) and a ~5-min log-stall emit included — so re-invocation is guaranteed. On every wake: `pgrep` the runner + read the log tail FIRST, then continue the round in that same turn. Never end a turn "waiting" with no verified live process and no armed exiting Monitor; a dead or missing process means the run is done — read its log and drive on. Prefer several foreground-sized scoped runs — via the `integration-scoped` / `unit-scoped` slot (scoped-slot resolution rule above) — over one giant background run whenever the tier can be scoped to specific files. (This is the mechanical form of the phase-executor's long-run survival protocol; it applies to inline runs too.)

**2. Agent reviews.** At `reviewScope: none`, skip this step entirely (the mechanical checks in step 1 still gate; record `no review agents — reviewScope none` in the round summary and proceed to the compromise summary once they pass). At `reviewScope: light`, launch ONE `code-reviewer`; at `full`, launch 2 `code-reviewer` agents in parallel — **synchronous Agent calls in a single message** (no `run_in_background`). "Parallel" here means the runtime fans them out; the parent still blocks until both return. Each receives:
- **Round 1**: full phase diff (`git diff <phase-start-SHA>..HEAD`) plus any unresolved items from Round 0's `skipped` or `bugsNoted` lists.
- **Round N > 1**: only the fix diff from the previous round (scoped per ROADMAP.md:77-81).
- The phase file for context.
- Hard requirement: findings must have `confidence >= 80`. Lower-confidence findings are dropped.
- **Severity range: CRITICAL through LOW are in scope for fixing.** INFO findings are recorded but do not block the gate. Agents must surface every ≥80% confidence issue — the loop triages, the agents don't.

**3. Evaluate round result:**
- **Every launched agent returns 0 actionable findings (CRITICAL/HIGH/MEDIUM/LOW)** → gate passes for this round. Record the round (including any INFO observations) and proceed to the compromise summary.
- **At least one agent returns ≥1 actionable finding** → fix, record, loop. INFO-only findings do not trigger another round but must still be persisted in `gateRounds[].findings` for the audit trail.

**4. Fix findings and record round:**
- Apply fixes. One commit per logical fix group: `fix(<scope>): phase N gate RN — <what was fixed>`.
- Build a `StructuredGateRound` record for this round:
  ```typescript
  {
    round: N,
    findings: [
      { file, line?, severity, confidence, description, fixedInCommit? }
    ],
    summary: 'Round N: X findings fixed',
  }
  ```
  Keep this in working memory — it gets written to the phase file in Step 5.
- Go back to step 1 with Round N+1.

### Hard limit — Round 5

If the loop has not converged after 5 rounds, STOP and surface the remaining findings to the user. Agents may be cycling (finding-then-rewriting-then-finding). Do not silently loop forever.

**NO EXCEPTIONS to the gate itself** — every phase runs the gate: mechanical checks, the correctness evaluation, and the compromise summary. What the gate runs INSIDE that frame is scoped by exactly two sanctioned ladders, both recorded and floor-protected: the opt-in **Test-scope ladder** narrows the test slots (the declared backstop re-covers the rest), and the **Review-scope ladder** narrows the agent chain (derived from the diff, or plan-declared and Mode-A-ratified; `## Gate specialists` paths always floor to `full`). Neither ever skips the mechanical lint/type/build checks, the hardening closure itest, the arc-end suite, or the compromise summary — and an ad-hoc narrowing outside the two ladders remains forbidden. If the phase file's validation task specifies additional checks, run those too.

---

## Compromise Summary (the only human stop-point — inline mode; under arc the orchestrator owns the stop, see SKILL.md Step 4b)

**Chat-output cap: ~30 lines / ~1500 chars.** The full summary is persisted to the phase file's `compromises` field and the completion commit body. Don't repeat the long form in chat — render a head + tail with a `+N more in roadmap/phases/phase-N.phase.ts` pointer when the summary would overflow. Output-token truncation has historically blocked phase completion mid-summary; the file is the long-form surface, chat is the headline.

Before marking the phase done, aggregate into a phase-level summary:

```
## Phase N Compromise Summary

Tasks: X total | Y clean | Z with compromises

### Compromises (from task transparency reports)
- Task N.1: <one-liner from COMPROMISES section>
- Task N.3: <one-liner>

### Skipped criteria
- Task N.2: <what was skipped>

### Hardcoded values
- Task N.4: <one-liner>

### Surfaced by architect-critique (fixed, but worth knowing)
- DB migration applied: new column `users.verified_at` — ensure staging migration runs before deploy

### Hard-stops from architect-critique (NOT fixed — your call)
- [MULTI-REPO] lib/api/client.ts — signature change breaks callers in zeroh-admin repo
- [SCOPED-OUT] lib/analytics/emitter.ts:34 — pre-existing double-fire, analytics out of scope
- [PRODUCT] checkout flow for expired coupons — needs product decision
- [SPECULATIVE] settlement.calculate() partial-month basis ambiguous
```

### Structured return (arc-mode)

When do-phase runs inside a phase-executor (orchestrated by `do-arc`), the free-text summary above is **still** persisted to the phase file's `compromises` string (audit + release-sweep read it) — that does not change. **In addition**, the executor emits the same content as a typed `PhaseExecutionResult` (`PhaseExecutionResultShape` in `templates/schema.ts`) as its return value, so the orchestrator can aggregate the arc without re-parsing markdown:
- `compromises` / `skipped` / `hardcoded` ← the matching task transparency-report lines (one array entry per task line).
- `surfaced` ← the architect-critique SURFACED entries.
- `hardStops` ← the tagged HARD-STOPS (`[MULTI-REPO]` / `[SCOPED-OUT]` / `[PRODUCT]` / `[SPECULATIVE]`), each `{ tag, text }`.
- `gateRounds` ← the count of correctness rounds run (Rounds 1..N).
- `status` ← `"escalated"` (with `escalation.question` + `options`) on a hard `ESCALATE_TO_USER` / `[MULTI-REPO]` / `[PRODUCT]` stop, else `"done"`.

The structured result is an addition, not a replacement: the `compromises` string is the durable human-readable audit record; the `PhaseExecutionResult` is the machine-readable channel `do-arc` aggregates. The executor returns it AND persists it to `phase.executionResult` (do-phase arc-mode Step 5), so `arc-sweep` can re-read it via `discoverResults()` if the arc resumes — the return value is the fast path, the persisted field the system of record.

The user reviews the summary and decides (**inline mode only** — under arc-mode the `do-arc` orchestrator owns this stop; see SKILL.md Step 4b):
- **"Mark done"** → proceed to phase completion
- **"Address X first"** → fix the compromise, then re-run the summary
- **"Plan follow-up"** → especially for `[MULTI-REPO]` hard-stops that need a phase in another repo

Sources to aggregate:
1. Every task's persisted `transparencyReport` (compromises, skipped criteria, hardcoded values, limitations).
2. The architect-critique's `SURFACED` section (DB migrations, schema changes — applied, flagged for visibility).
3. The architect-critique's `HARD-STOPS` section (all four tag categories).

Record the summary in both:
1. The phase file's `compromises` field (durable record).
2. The completion commit message body.

Persisting to the phase file means the compromise summary survives outside git and is queryable by `audit-roadmap`. Skipping the phase file write loses that signal.

---

## Phase Completion

The schema enforces gate results when `status: 'done'`. The `types` slot catches missing fields and wrong literal values (e.g. `typeCheck: 'errors'`, `lint: 'errors'`); `definePhase()` additionally catches `unitTests.passed !== total` and empty `gateRounds` at runtime. Fill everything in one edit.

### Required fields (set together)

1. Edit the `.phase.ts` file:
   - `status: 'done'`
   - `gate: { typeCheck: 'clean', lint: 'clean', unitTests: { passed: N, total: N }, ... }` — must reflect passing results from Rounds 1..N.
   - `gateRounds` — the structured `StructuredGateRound` entries from the correctness loop, with Round 0's entry at index 0. At least 1 entry required. Example:
     ```typescript
     gateRounds: [
       {
         round: 0,
         findings: [],
         summary: 'Round 0: simplify — −47 lines across 3 files',
       },
       {
         round: 1,
         findings: [
           { file: 'lib/services/foo.ts', line: 42, severity: 'HIGH', confidence: 85,
             description: 'Missing null check when payload.user is undefined',
             fixedInCommit: 'a1b2c3d' },
         ],
         summary: 'Round 1: 1 finding fixed',
       },
       { round: 2, findings: [], summary: 'Round 2: 0 findings — gate clean' },
     ],
     ```
     Legacy free-form strings are still accepted by the schema for compatibility with pre-extension phases, but new phases should use the structured form so `audit-roadmap` can query findings.
   - `metrics: { commits, linesAdded, linesRemoved, filesChanged, testsAtStart, testsAtEnd, testsAdded }`
   - `compromises: '<summary from compromise-summary step>'` — the aggregated compromise/skipped/hardcoded summary. Omit only if every task reported "None" in all six sections.
   - `completedDate: 'YYYY-MM-DD'`
2. Run the `types` slot — confirms gate enforcement passes.
3. Run the `emit` slot to regenerate `reviews/changelog.json`.
4. Commit: `docs(roadmap): mark phase N complete` (include compromise summary in commit body).
5. Push to develop.

### Alternative: automated metrics

If `scripts/collect-phase-metrics.ts` exists, it can fill gate + metrics automatically:

```bash
npx tsx scripts/collect-phase-metrics.ts N
```

Then set `status: 'done'` and verify with the `types` slot.
