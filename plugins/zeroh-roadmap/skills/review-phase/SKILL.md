---
name: "Review Phase"
description: "Verify a phase's claimed work actually happened correctly — task completeness, code accuracy, blast radius, architecture compliance. Works on done phases (post-execution audit) and backlog phases (plan quality review)."
user-invocable: true
metadata:
  keywords: review, phase, verify, audit, check, validate
  aliases: verify-phase, audit-phase
---

# Review Phase — Verification Protocol

**Trigger:** `review phase N`, `/review-phase N`, `review arc <ID>` (arc entity + every member; Step
H runs ONCE at arc level). A trailing prompt = extra checks appended after the protocol.

**This IS** two questions: (1) **Fitness** — right feature, right shape, whole, lean? (2)
**Verification** — did/will the claimed work match reality (task said "add X at line 42" → is X
there)? **NOT** `/code-review` (new bugs) nor a re-run of the design gate (ratified decisions checked
for drift, never relitigated).

**Step 0 — read the phase file; mode by `status`:** `backlog` → Mode A (plan quality);
`done`/`in-progress` → Mode B (in-progress = verify done tasks, flag the rest); `historical`/
`cancelled` → terminal, not reviewable (historical predates gate discipline — say so and stop).

---

## Mode A — Plan Quality Review (backlog phases)

Review as a **senior software architect** — don't trust the plan; verify it against the code (the
planner may have hallucinated paths/functions/lines).

**Model policy (the HOME statement — stated ONCE here; the other judge seams reference it).** A
spawner running Mode A *via an agent* reads `modelPolicy.judgeModel` from `roadmap.config.json`:
when set, pass `model: <that>` to the spawned reviewer; **absent key = the agent's frontmatter
default** (fail-safe). JUDGE seams ONLY — Mode A plan reviewers, arc-sweep's whole-arc
software-architect, validate-arc's intent-validator panel; NOT `phase-executor`/`software-developer`/
`test-engineer`. Judge independence is fresh read-only context + evidence-or-downgrade, not a
different model. Mode A invoked STANDALONE runs INLINE (no spawn); the SPAWN site is plan-arc Step 3.

**UNAVAILABLE judgeModel = fall back, never skip the judge.** A configured `judgeModel` can be set
yet unusable at spawn time — quota exhausted, plan gating, the model withdrawn. The judge stage is
NOT optional, so a spawner whose reviewer dies on a model-availability error (e.g. "You've reached
your <model> limit", an access/permission refusal, or an unknown-model error) RE-SPAWNS the SAME
reviewer on the fallback chain — the caller's explicitly requested model if it named one, else the
agent's frontmatter default — and does NOT downgrade the review's rigor to compensate.

The fallback is **recorded, never silent**: the report names the model that actually judged and why
it differs from the configured one, because "which model graded this" is part of the evidence a
later reader needs. Distinguish this from a CONTENT failure — a reviewer that ran and returned
NEEDS WORK/BLOCKER has judged; only an availability error triggers the swap. If the fallback also
fails, surface the stage as UNJUDGED and STOP; never queue a phase on an unrun review.

### Step H — Holistic feature review (issued FIRST in the report, finalized after the per-task pass)
Before grading tasks, judge the FEATURE — a plan can be flawless and still be the wrong thing, half
a thing, or too much. Four questions, each answered with EVIDENCE:
- **H1 Right problem, still true, worth doing now?** Did landed work / a shipped arc / a live-state
  change supersede it (the "stale OPERATOR-PENDING actually live" class)? Worth its slot?
- **H2 Right shape?** Against CONFIRMED designRefs + locked decisions (drift is a finding;
  relitigating a ratified decision is not). EXTEND a seam or quietly fork one (`singleSeams`)? Right
  altitude (vertical → generalization as a named follow-up)? A simpler mechanism?
- **H3 Anything missing that makes it whole?** Fail-closed arms on every new decision point, audit/
  receipt for every governed effect, the kill-switch flag + OFF-path proof, the wired test per new
  surface, canon/docs, the adjacent gap that leaves it half-useful.
- **H4 Anything to remove?** A task duplicating shipped capability (→ the problem doesn't exist),
  speculative abstraction with one consumer, gold-plating past the acceptance bar.

Disposition rides Step 7b: a missing-but-mechanical piece is ADDED as auto-repair; RESHAPE/CUT/
new-scope are report-only. Verdict: `SOUND | RESHAPE (what+why) | QUESTION (ruling needed)`. An ARC
review runs Step H once against the arc entity (planes, singleSeams, honestyRails, criteria vs the
JTBD); per-phase passes inherit it. Mode B skips Step H.

### Per-task verification — apply plan-phase's self-verify list ADVERSARIALLY
The check catalogue is not restated here: run **plan-phase Step 5's self-verify list** against each
task as an independent adversary (the codebase may have changed; self-verification is lazy). Its
mechanical members (paths, size lint, markers, emit/parse) are `roadmap phase validate`'s job. Bring
JUDGMENT to: **source confirms** (open the function — does `problem` exist there? BLOCKER if not),
**blast radius** (grep the pattern/symbol repo-wide; uncovered = NEEDS WORK — the commonest failure),
**criteria verifiable**, **data-flow order**, **hypotheses refuted** (fix/hardening), the **`step →
verify:` grammar** (this review is the enforcement the grandfathered lint defers to).

Bonus ratifications Mode A owns (a "specialist path" = a `gateSpecialists` path in `roadmap.config.json`):
- **`testScope` sanity** (when declared): a specialist / cross-module `src/` path is incompatible
  with `static`/`scoped`; `scopedTests` globs resolve → else NEEDS WORK.
- **Test shape:** every task's `testMode` is ratified against
  `skills/using-zeroh-roadmap/references/test-worthiness.md` — a violation (a NEVER-class spec, a
  skipped tdd on pure logic) without a recorded architect verdict in the notes = NEEDS WORK; a task
  whose diff is declarative planning a NEW test file, absent that verdict, = NEEDS WORK (point it
  at the consumer's ratchets/lint lane); a byte-for-byte content assertion over a data file = NEEDS WORK.
- **License check:** a task introducing an external dep/asset names its license + placement tier
  per `skills/using-zeroh-roadmap/references/external-assets-licensing.md`; missing, banned-tier,
  or a server-side-only license placed in a shipped client artifact = NEEDS WORK.
- **`reviewScope` ratification** (declared below `full`): THIS review IS the ratification the gate
  trusts. Verify no `keyFiles`/`files[]` path is a specialist path, the rung fits the diff (`none`
  docs/data only; `light` only small/mechanical — no new governed surface/contract/ledger-kind/subtle
  logic), the planner stated WHY. Unjustified low rung = NEEDS WORK.
- **`userFacing` + `flag`:** a user-visible phase carries `userFacing: true` + `{ id }` or a
  justified `{ bootWired, justification }`; missing = NEEDS WORK.

Output per task: `READY|NEEDS WORK|BLOCKER` + source-confirmed / blast radius / issues.

### Step 7b — Apply plan repairs (auto-fix, then re-verify)
A plan review's point is a phase **fixed and queued**, not a findings list. APPLY every repair to the
PLAN in the `.phase.ts`, re-run the affected checks; the verdict issues on the POST-fix plan.
- **Auto-repair (default — knowable from the code you read):** a wrong file/line anchor; blast-radius
  gaps (add the paths); an unverifiable criterion (reword to the command/observable); a malformed
  `dependsOn`/stale name/mechanical `batchMode` split; an either/or the code resolves. Tag `[FIXED]`.
- **Report-only (changes INTENT / needs an owner):** `problem` doesn't exist in source; a missing
  dependency phase or new scope; a user-LOCKED contradiction or product choice; unresolved markers.
Commit plan edits (explicit paths) `plan(roadmap): phase N review fixes`, `emit` first if phase files
feed generated views.

### Step 8 — Backlog placement (runs when the POST-fix verdict is READY)
Auto-repaired findings don't block queueing; open REPORT-ONLY findings do (surface, re-review, queue).
Position, in order:
1. **Dependency floor** — AFTER every `dependsOn` phase (lowest index = `max(depIndex)+1`); a dep
   done/historical satisfies it; a dep in neither backlog nor completed = BLOCKER.
2. **Conflict spacing** — `conflictsWith` phases never adjacent (≥1 between, else NEEDS WORK).
3. **Priority sort** in the eligible range: BLOCKER>HIGH>MEDIUM>LOW; equal = FIFO.
4. **Already listed?** Validate against 1–3; propose + apply a move, never silently reorder.
Insert `{ phase: N, name }` at the index (or move); commit with the fix commit or
`docs(roadmap): queue phase N`. Output `QUEUED at K | ALREADY at K | MOVED K1→K2 | NOT QUEUED` +
reasoning. **`--no-queue`:** validate 1–3 but do NOT edit `backlog.ts` — just output the position.

---

## Mode B — Post-Execution Audit (done / in-progress phases)
Verify the CLAIMED work happened, COMPLETELY. `git log --grep="phase N"`; read each diff. Per task:
- **Claimed changes exist** — every `steps[].file` actually modified; read the code, not the commit message.
- **Bug actually fixed (not papered over)** — trace the root cause. **`kind: hardening` + any
  persistence/event/marshal-chain task: unit-pass is NOT closure — the integration-suite RERUN is.**
  Find evidence the itest was rerun post-fix and the symptom resolved (diff in `compromises` or the
  completion commit); no rerun or symptom persists → FAIL regardless of unit status.
- **Pattern caught EVERYWHERE (the "elsewhere?" check — the most important)** — grep the OLD pattern
  + every changed symbol (imports AND string-literals) repo-wide; a renamed field → check catalog,
  disclosure matrix, E2E, seed data, routes, rules. Uncovered → FAIL.
- **Line numbers accurate**, **architecture compliance** (logic in `lib/`, no side effects in pure
  functions, SSOT, canonical errors, integer-cents finance), **criteria met**, **test coverage**
  (executable logic; a declarative artifact's guard is its lane, not a bespoke test).
Output per task: `PASS|CONCERN|FAIL`, bug-confirmed, pattern-elsewhere.

---

## Phase-level verdict + close
`## Phase N Review`: mode; (Mode A) the Step H block first; task tallies; findings (auto-repairs
`[FIXED]`); **Verdict: CLEAN** (all pass, Step H SOUND) **| HAS CONCERNS** (minor, or RESHAPE/
QUESTION) **| BLOCKED** (must-fix). User-appended checks run last; cross-repo phases read other-repo
files by full path.

**What NOT to do:** Mode A fixes the PLAN, never source (→ `/do-phase`); Mode B stays report-only (a
shipped-wrong finding goes through a phase). Don't run tests, review outside phase scope, or weaken
findings — "probably fine" is not a verdict.
