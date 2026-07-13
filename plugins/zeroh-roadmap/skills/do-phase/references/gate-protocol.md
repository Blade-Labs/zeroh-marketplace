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

Three stages, run in order:

1. **Round 0 — Quality pass** (one-shot, no looping). ONE `quality-pass` agent runs both quality mandates over the phase diff in a single read: the additive architect sweep (shortcuts, hardcodes, cross-task patterns, neighborhood issues in touched files — auto-fixed in scope, hard-stopped otherwise) and the subtractive simplify sweep (dead scaffolding, speculative abstractions, noise — deleted). Formerly two agents (architect-critique + simplifier); merged because both were one-shot judgment passes over the same diff and the second full-diff read bought nothing.
2. **Rounds 1..N — Correctness loop** (loops until clean, hard-cap 5). Mechanical checks + ONE `code-reviewer` (joined in parallel by the consumer's `## Gate specialists` agent when the diff touches a specialist path). Each round fixes findings and re-runs until zero actionable findings.
3. **Compromise summary** — aggregate every task's persisted `transparencyReport` PLUS the quality pass's surfaced items and hard-stops. This is the ONLY human stop-point in the gate (inline mode; under arc-mode the `do-arc` orchestrator owns the stop — see SKILL.md Step 4b).

Which of stages 1–2 run for a given phase is governed by the **Review-scope ladder** (below): `full` runs both, `light` runs a single-reviewer stage 2 only, `none` runs no review agents. Stage 3 always runs.

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
| `mockup` | Mechanical only: the `lint` + `types` slots. Skip the quality pass (Round 0) and Rounds 1..N. Compromise Summary still runs. |
| `logic` | All four stages (default behaviour). |
| `hardening` | All four stages **plus** the bug-fix closure rule from `review-phase` Mode B Step 2(b): for any persistence/event/marshal-chain task, the integration-suite rerun is the closure criterion. Quote the integration test diff in the compromise summary. Unit-test pass alone is NOT sufficient. |
| `release` | All four stages **plus** the `e2e` slot in Round 1's mechanical checks. |

**Orthogonal to this table:** the **Design-parity stage** (below) runs for ANY kind whenever the
phase implements a `ux` designRef — a `mockup` phase that skips the review chain still runs it.

If `kind` is missing on a legacy phase, treat as `logic` and emit a one-time warning pointing at `scripts/migrate/audit.ts`.

The `kind` field is required at schema parse time; the legacy fallback only covers phases authored before v3.

## Design-parity stage (runs whenever the phase implements a `ux` designRef)

**Trigger:** the phase's tasks cite an arc designRef with `kind: 'ux'` (plan-arc Step 2b requires the
citation) AND the phase's diff touches a rendered surface. Applies to EVERY kind — `mockup`
included (a mockup phase that builds a designed surface is exactly the case this exists for).

**Why this stage exists (history):** arcs shipped with ratified UX previews (a static HTML design
the user confirmed at the design gate) whose DELIVERED surfaces drifted — the per-phase gate judged
code, arc-sweep judged the diff, and nobody put the rendered pixels next to the design until the
user did it themselves in production (Ask Ali web, the Studio builder, Agent HQ — 2026-07 user
escalation). A design the user confirmed is a CONTRACT; "roughly inspired by" is a silent breach.

**Protocol (a LOOP, not a checkbox):**
1. Render the built surface via the consumer's `live-ui` Validation-tiers binding (or the consumer's
   dev-server + screenshot lane when the binding needs a deploy). Capture screenshot(s) of every
   state the design artifact shows (default, loading, error, empty — the states ARE part of the
   design) — AND drive every interaction the design defines: hover/focus each styled control,
   trigger the transitions/animations (open/close, expand, reveal), and screenshot the hovered/
   focused/mid-transition states. A static screenshot pass is blind to interaction drift — the
   drift users notice first.
2. Open the design artifact named by the designRef `ref` (static HTML preview → render + screenshot
   it too, AND drive its interactions the same way; a prose layout note → read it).
3. Compare side by side with a vision-capable judgment against the parity rubric (the
   `intent-validator` agent's "UX design-parity rubric" section — same rubric, applied per phase):
   layout structure, component presence/hierarchy, states, interaction & motion (hover/focus
   effects, transitions/animations — same or unambiguously better, never flattened or inert), copy,
   and visual tokens (spacing/typography/color family). Judged-equivalent is fine;
   missing/moved/renamed/degraded is a deviation.
4. Every MATERIAL deviation → fix it in this phase, re-render, re-compare. Loop until parity or
   until a deviation is genuinely out of the phase's scope — that residual is recorded in the
   phase's `compromises` naming the designRef + the exact deviation (never silently shipped), and it
   becomes an arc-level item validate-arc's parity criterion will re-catch.
5. Record the outcome as a `gateRounds` entry (`agent: 'design-parity'`, verdict `clean` |
   `deviations-recorded`, summary naming the screenshots compared and any residuals).

**No self-grading shortcut:** the comparison uses fresh eyes — a spawned reviewer/judge with the two
images, never the implementing agent squinting at its own build. Under arc-mode the executor spawns
it like any gate agent; inline, the do-phase runner spawns it.


---

**Failure-identity rule (applies to EVERY test slot, full and scoped):** a slot's RED
output must NAME its failing tests without a rerun. A tier piped through `tail`/`grep`
(or any bounded filter) discards exactly the `not ok` lines a red run exists to surface —
the recorded failure mode is a gate note reading "failure name lost to output truncation"
followed by a full-tier rerun to learn ONE name. If the consumer's raw runner floods
stdout (a 10k-test TAP stream), the consumer binds its slots to a wrapper that emits a
BOUNDED summary carrying every failing test's name/file to stdout and routes the full
stream to a log file, preserving the exit code (dual test reporters are the standard
mechanism; see the consumer's slot bindings for the concrete runner). An executor must
never re-filter a slot's output — run the slot verbatim, read what it prints.

## Test-scope ladder (opt-in — narrows the TEST slots only, never the gate)

`kind` selects the agent chain, but it is a poor proxy for how much of the test pyramid a
diff needs: a `logic` phase whose diff is register data + two small scripts buys nothing
from a full-tier rerun, while the same `kind` on a spine refactor genuinely needs it. The
ladder scopes ONLY the `unit`/`integration` slots in Round 1's mechanical checks.
Everything else is UNCHANGED: lint/types/build/emit, the quality-pass →
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
| `relevant` | src changes with cross-module consumers, **including any `## Gate specialists` path** | scoped + the suites that exercise the touched modules — a REASONED selection (trace the diff's importers/consumers, pick the suites that actually execute the changed seams), not a fixed path→suite map; the rationale is recorded (honesty record below) |
| `full` | declared (with a stated one-line justification in the phase file — review-phase challenges an unjustified `full`), or a `release`-kind phase | the whole kind × mode cell (the pre-ladder behavior) |

**Floor rule (fail-loud):** derive the floor from the diff FIRST; a declared `testScope`
may only RAISE it. Declared below the derived floor → the gate REFUSES:
`testScope 'static' declared but the diff touches src/relay/governed-turn.ts
(## Gate specialists floor: relevant)`. A `## Gate specialists` path floors to `relevant`,
never below — its module suites always run at the gate — but not to `full`: the whole-suite
value on a spine path is catching *distant* consumers, and that is exactly what the declared
`## Test cadence` backstop re-covers off the phase gate. (The specialist path still forces
the **agent-chain** floor to `full` in the Review-scope ladder below — the review floor and
the test floor deliberately diverge: reviewer judgment on spine diffs has real catch history;
a distant-suite rerun per phase mostly re-proves untouched code the backstop re-proves anyway.)

**Running the narrowed set:** the `scoped`/`relevant` file selections run through the
consumer's `integration-scoped` / `unit-scoped` slot per the scoped-slot resolution rule
(Gate-commands section above) — `{files}` = the selected paths, verbatim template; an
unbound scoped slot falls back to the full slot with the `scoped slot missing — ran full
suite` note. The ladder decides WHICH files; the resolution rule decides HOW they run.

**Honesty record:** any scope below `full` writes what was deferred and which backstop
covers it into `gate.unitTests.notes` (e.g. `deferred: full unit+integration tiers →
ci-pr-gate + nightly per ## Test cadence`) — a narrowed gate is a recorded state, never a
silent or ad-hoc one. A `relevant` selection additionally records its RATIONALE in one
line (`ran: <suites> — they exercise <seams>; deferred: <what> → <backstop>`): reasoned
selection is sanctioned exactly to the extent it is legible afterwards.

**Arc-mode note:** the arc-mode column of the kind × mode table already implements
`relevant` with the arc-end full run (do-arc Step 8) as its backstop. Under the ladder both
modes read as one rule — prove the touched code at the gate; the declared backstop
(`## Test cadence` inline, arc-end suite in arc-mode) re-covers the world.

**Sequence cadence (inline multi-phase runs get the arc amortization):** when one session
executes ≥2 queued phases back-to-back inline (a tier, a program, an explicit "do X then Y"
— NOT an arc, which already has Step 8), running each phase's full cell re-proves the same
untouched world N times. Under a declared `## Test cadence` block, a sequence member's gate
caps its test slots at `relevant` — including a member that DECLARED `testScope: 'full'`,
whose full run defers to the sequence end — and ONE sequence-end pass runs after the last
member: the highest deferred scope across members (any member declaring `full`/`release` ⇒
the full cell, once). Floors are UNTOUCHED per member: the hardening closure itest never
defers, `## Gate specialists` module suites always run at that member's own gate, and
lint/types/build run per phase (they are cheap and diff-local). Each deferring member's
honesty record names the forward cover (`deferred → sequence-end suite after phase N`),
and the sequence-end result is recorded on the LAST member's gate notes. A sequence
interrupted before its end-pass leaves the deferral covered by the declared backstop —
recorded, never silent; the next phase gate or release sweep sees it in the notes.

---

## Review-scope ladder (plan-time configurable — narrows the AGENT chain)

The test-scope ladder scopes the mechanical slots; this ladder scopes the **agent chain**.
The flat chain (quality pass + 2 reviewers on every `logic` phase) prices a one-line
fix and a spine refactor identically — the planner is better placed to say what review is
genuinely high-value for a given diff, and `review-phase` Mode A already reviews that plan.
No consumer opt-in block is needed (unlike the test ladder there is no deferred work needing
a backstop — a lower rung runs less review, recorded honestly; the release-time
`full-code-review`/release review remains the whole-tree backstop).

**The ladder** (`phase.reviewScope`; absent → derived from the diff at gate time):

| `reviewScope` | Derived when the diff is… | Agent stages run |
|---|---|---|
| `none` | docs/data/assets only (the same path-class test as the quality pass's pure-docs skip), or `kind: mockup` | No review agents. Mechanical checks + Compromise Summary only. |
| `light` | executable code, ≤ ~150 changed lines, touching NO `## Gate specialists` path and adding no new governed surface / contract / ledger event kind | ONE `code-reviewer` correctness loop (Rounds 1..N, same convergence + hard-cap rules). Skip the quality pass. |
| `full` | anything else — always when a `## Gate specialists` path is touched | The full chain: quality pass → ONE `code-reviewer`, joined by the consumer's `## Gate specialists` agent as a second reviewer when the diff touches a specialist path. |

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

Every gate-agent stage (the Quality Pass, each code-reviewer round) echoes a condensed summary inline in chat after the agent returns. The full agent report stays in the sub-agent transcript — the echo exists so the user has non-zero visibility without scrolling.

Cap each echo at **~10 lines / ~600 chars**. Truncate ruthlessly. If the agent's report is empty, a single line is enough (`[Quality pass] nothing to fix or simplify`). Format examples in `do-phase/SKILL.md` Step 4.

This is in addition to the per-stage bookkeeping (commits, gateRounds entries, etc.) — it does not replace any of it.

---

## Round 0 — Quality Pass (one-shot)

**Runs only at `reviewScope: full`** (the Review-scope ladder above) — a `light`/`none` phase records the `round: 0` entry as `skipped — reviewScope <rung> (plan-ratified)` and proceeds to Round 1.

ONE `quality-pass` agent runs both quality mandates in a single pass over the diff — the additive architect sweep (neighborhood issues in touched files, cross-task patterns, gate-bypassed compromises; auto-fix in scope, tagged hard-stop otherwise) and the subtractive simplify sweep (dead scaffolding, speculative abstractions, noise). The two used to be separate agents (architect-critique, then simplifier); they were merged because both are one-shot judgment passes over the same diff, the simplifier's measured standalone yield was near zero, and the second full-diff read doubled cost without adding coverage. The mandate split lives inside the agent (`agents/quality-pass.md`), with the subtractive sweep explicitly re-checking any over-extraction the additive fixes introduced.

**Why it runs before the correctness loop:** quality corrections invalidate bug findings — if the pass deletes a helper the code-reviewer was about to flag, you avoid wasted rounds; and the reviewers then validate the final combined result in one pass, not two.

**Why one-shot, not looping:** both mandates are judgment calls with no "zero" state to converge on. The code-reviewer loop after it is the validation gate for whatever the pass changed — a correctness issue it introduces gets caught there.

**Skip the pass for a pure-docs/prose diff.** Both mandates are a *code* lens; a phase whose diff touches no executable code has nothing to act on. Mechanical test (not a judgment call): list the phase diff's changed paths — `git diff --name-only <phase-start-SHA>..HEAD` — and if NONE is an executable-code file (`.ts` `.tsx` `.js` `.jsx` `.mjs` `.cjs` `.py` `.rego` `.sql` or a logic-bearing config), skip the agent and record the `round: 0` entry with summary `skipped — pure-docs diff, no code for the quality pass` (keep the audit trail honest). Any executable-code file in the diff → run it as normal. `mockup`-kind phases already skip the whole agent chain; this extends the same logic to docs-only diffs of any `kind`.

### Protocol

1. Launch exactly one `quality-pass` agent **synchronously** (no `run_in_background`) with:
   - `git diff <phase-start-SHA>..HEAD` — the full phase diff
   - The phase file — for scope context and transparency-report compromises

   Block on the return. A background launch ends the parent turn and there is no completion notification until the sub-agent's final `end_turn` — the parent will appear to stop between the sub-agent's last commit and its summary.
2. The agent applies its fixes and commits as one: `fix(phase-N): quality pass — <summary>`. If nothing was fixed, it commits nothing.
3. Capture the agent's report:
   - **FIXED (architect)** / **FIXED (simplify)** — applied inline; no further action.
   - **SURFACED** — applied, but worth flagging (DB migrations, schema changes). Carry forward to the compromise summary.
   - **HARD-STOPS** — tagged `[MULTI-REPO]`, `[SCOPED-OUT]`, `[PRODUCT]`, `[SPECULATIVE]`. Carry forward to the compromise summary for user decision.
   - **SKIPPED** / **BUGS NOTED** — feed to Round 1's code-reviewer agents.
4. If the agent reports nothing fixed and no hard-stops, that is a valid outcome. Proceed to Round 1 with no changes.
5. **Do not re-run the agent.** The code-reviewer loop validates whatever the pass left.

### Record in gateRounds

Round 0 gets its own entry with `round: 0`:

```typescript
{
  round: 0,
  findings: [],  // the quality pass does not return findings; see `simplifyPass` field
  summary: 'Round 0: quality pass — −N lines across M files, 2 architect fixes',
  simplifyPass: {   // legacy field name; records the pass's subtractive numbers
    linesRemoved: N,
    linesAdded: M,
    filesChanged: K,
    fixed: ['lib/foo.ts: removed unused _opts parameter', ...],
    skipped: ['lib/qux.ts:42 — speculative, unclear caller count'],
    bugsNoted: ['lib/zot.ts:88 — null check missing'],
  },
}
```

If `simplifyPass` is not yet in the phase schema, record the summary in the `summary` field and skip the structured sub-object. The schema migration is optional — the skill works either way.

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

**2. Agent reviews.** At `reviewScope: none`, skip this step entirely (the mechanical checks in step 1 still gate; record `no review agents — reviewScope none` in the round summary and proceed to the compromise summary once they pass). At `reviewScope: light`, launch ONE `code-reviewer`; at `full`, launch ONE `code-reviewer` — plus the consumer's `## Gate specialists` agent as a second, parallel reviewer when the diff touches a specialist path — **synchronous Agent calls in a single message** (no `run_in_background`). "Parallel" means the runtime fans them out; the parent still blocks until all return. (`full` used to spawn a second generic `code-reviewer`; attributed-yield data 2026-07-06/07 — ~20 full-chain phases — showed the generic #2's solo catch count was ZERO (one joint LOW) while the path-triggered specialist caught 4 actionable in 4 phases, so the second slot is now specialist-only.) Each receives:
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
- Build a `StructuredGateRound` record for this round — ALWAYS the object form below; the legacy bare-string round is read-only back-compat and writing it defeats the yield audit (`audit-roadmap` flags it on newly-done phases):
  ```typescript
  {
    round: N,
    findings: [
      { file, line?, severity, confidence, description, fixedInCommit?, agent? }
    ],
    summary: 'Round N: X findings fixed',
  }
  ```
  Keep this in working memory — it gets written to the phase file in Step 5.
- **Attribute every finding** via the optional `agent` field: which spawn reported it —
  `'reviewer-1'` for the generalist (`'reviewer-2'` survives only in legacy records), the
  specialist's name when a `## Gate specialists` path put it on the panel (e.g.
  `'governed-spine-reviewer'`), `'quality-pass'`
  for a bug the Round-0 pass noted that a reviewer then confirmed. One word per finding at
  record time is what makes the gate's yield auditable later — "does the specialist earn its
  spawn?" stays a mechanical query over `gateRounds` instead of archaeology (this exact
  query is how the generic reviewer #2 was retired: zero solo catches in ~20 attributed
  full-chain phases). Findings without a clear source (e.g. found while fixing) omit the field.
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

### Surfaced by the quality pass (fixed, but worth knowing)
- DB migration applied: new column `users.verified_at` — ensure staging migration runs before deploy

### Hard-stops from the quality pass (NOT fixed — your call)
- [MULTI-REPO] lib/api/client.ts — signature change breaks callers in zeroh-admin repo
- [SCOPED-OUT] lib/analytics/emitter.ts:34 — pre-existing double-fire, analytics out of scope
- [PRODUCT] checkout flow for expired coupons — needs product decision
- [SPECULATIVE] settlement.calculate() partial-month basis ambiguous
```

### Structured return (arc-mode)

When do-phase runs inside a phase-executor (orchestrated by `do-arc`), the free-text summary above is **still** persisted to the phase file's `compromises` string (audit + release-sweep read it) — that does not change. **In addition**, the executor emits the same content as a typed `PhaseExecutionResult` (`PhaseExecutionResultShape` in `templates/schema.ts`) as its return value, so the orchestrator can aggregate the arc without re-parsing markdown:
- `compromises` / `skipped` / `hardcoded` ← the matching task transparency-report lines (one array entry per task line).
- `surfaced` ← the quality pass's SURFACED entries.
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
2. The quality pass's `SURFACED` section (DB migrations, schema changes — applied, flagged for visibility).
3. The quality pass's `HARD-STOPS` section (all four tag categories).

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
         summary: 'Round 0: quality pass — −47 lines across 3 files, 1 architect fix',
       },
       {
         round: 1,
         findings: [
           { file: 'lib/services/foo.ts', line: 42, severity: 'HIGH', confidence: 85,
             description: 'Missing null check when payload.user is undefined',
             fixedInCommit: 'a1b2c3d', agent: 'governed-spine-reviewer' },
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
5. Push to develop — inline (non-arc) runs only. In arc-mode the executor never pushes: landing and pushing belong to the do-arc orchestrator (Step 8's landing mechanics).

### Alternative: automated metrics

If `scripts/collect-phase-metrics.ts` exists, it can fill gate + metrics automatically:

```bash
npx tsx scripts/collect-phase-metrics.ts N
```

Then set `status: 'done'` and verify with the `types` slot.
