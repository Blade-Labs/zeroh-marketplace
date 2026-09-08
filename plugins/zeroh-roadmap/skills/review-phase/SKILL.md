---
name: "Review Phase"
description: "Independently verify a roadmap phase or whole arc against the real code: backlog phases get a plan-quality review that repairs the plan and queues it; done/in-progress phases get a report-only post-execution audit. Trigger: 'review phase N', '/review-phase N', 'verify/audit phase N', 'review arc <ID>'; also the mandatory pre-queue pass after plan-phase and the spawned judge step in plan-arc. Not for general diff/PR review or bug hunting - that is a plain diff review (the code-reviewer agent)."
user-invocable: true
metadata:
  keywords: review, phase, verify, audit, check, validate
  aliases: verify-phase, audit-phase
---

# Review Phase - Verification Protocol

Write `<root>/…`, never a bare `roadmap/…`: the roadmap root is DISCOVERED. Rule: `skills/using-zeroh-roadmap/SKILL.md` (mechanics: its `references/layout.md`).

**Trigger:** `review phase N`, `/review-phase N`, `review arc <ID>` (arc entity + every member;
Step H runs ONCE at arc level). A trailing prompt = extra checks AFTER the protocol, EXCEPT a
placement-only ask, which NARROWS scope (Step 8). Cross-repo: read the other repo by full path.

**This IS** two questions: (1) **Fitness** - right feature, right shape, whole, lean?
(2) **Verification** - does/will the claimed work match reality? Treat the plan as possibly
hallucinated and the executor's self-verification as lazy; every grade needs source evidence.
Never execute test suites in either mode - reason from code + existing evidence (honor-system;
standing ruling: plan-time never runs suites, verifies are executor tripwires). **Not this
skill:** a plain diff review (the `code-reviewer` agent) owns diff quality and new-bug hunting, even on a diff a phase produced -
this skill never hunts bugs outside the phase's claims. `audit-roadmap` owns roadmap-wide
structure (never reads source; this skill always does). The design gate is never re-run:
ratified/user-locked decisions are checked for DRIFT only, never relitigated (honor-system).

## Evidence rules (both modes)

- **Closure claims**: one literal grep for one phrasing structurally cannot find a
  differently-phrased sibling (a comment, a bind-site note, a console label). Key the search to
  the durable code token (`grep -F` on the symbol/status code/config key, bounded dirs) PLUS
  one alternate phrasing for prose carriers; only then declare closed, probes recorded.
- **Negative claims** ("nothing queued", "no other caller"): assertable only with the executed
  probe list naming every searched location - queue negatives search `<root>/backlog.ts`,
  `release/activation.json`, AND `<root>/followups/`. An unprobed negative is a CONCERN.
- **Line cites**: re-verify every `file:line` in the report against HEAD immediately before
  emitting (re-open the file at that offset); one stale cite discredits the rest.
- **Gap calibration**: probe whether CURRENT data/state can trigger each same-pattern gap
  (scan the existing rows/markers for the offending shape); label it LIVE or LATENT.

Evidence of use: commits `48c726155`/`dd5a17218`/`11ce678f9`; themes mined 2026-08-13.

## Step 0 - Mode by `status`

Read `<root>/phases/phase-N.phase.ts`. `backlog` → Mode A. `done`/`in-progress` → Mode B
(in-progress = audit the `done:true` tasks; the rest flagged unaudited, NO grade token).
`historical`/`cancelled` → terminal, NOT reviewable (predates gate discipline) - say so, STOP.

## Mode A - Plan Quality Review (backlog phases)

Review as a senior software architect reading the code fresh - verify every claim against source.

**Model policy - one home: `MULTI-DRIVER.md` §1** (role table + resolver in
`cli/lib/roles.mjs`). It rules which roles a consumer's `modelPolicy.judgeModel` may re-route
(judge-class only), the tier walk at unreduced rigor, the recorded substitution, and the
UNJUDGED stop when every tier is down. Here: a spawner running Mode A *via an agent* passes
`model: <judgeModel>` from `roadmap.config.json` when the key is set, else the agent's
frontmatter alias (fail-safe). Judge independence is fresh read-only context +
evidence-or-downgrade, not a different model. A reviewer that RAN and returned an adverse
verdict has judged - that never triggers a swap; never queue on an unrun review
(`audit-roadmap` flags queue anomalies after the fact). Mode A invoked STANDALONE runs INLINE
(no spawn); the spawn site is plan-arc Step 3.

### Delegated report-only Mode A

When the launcher identifies this as a **delegated report-only** review, perform Step H,
Step V and metadata judgment, then emit the existing verdict. Skip Step F and Step 8,
including their repair/placement reasoning and queue probes. Use the literal
`Placement: NOT QUEUED — delegated report-only review`. Report required plan repairs as
OPEN findings; never edit the plan or backlog. The supervising session owns queueing.

Read the phase, its arc criteria and locked decisions, relevant source, the direct
checklist below and `references/plan-adversary.md`. Do not reload the full plan-authoring
skill or repeat its authoring workflow. Keep independent intent, coverage, feasibility,
source/seam, falsifiability, state-coverage and risk judgment. An author summary is
context, not proof; missing evidence remains a finding. Apply the checklist to the
reviewed scope: no queue probes for a placement claim this lane does not make.

The launcher supplies the successful mechanical validation summary for this requested
checkout. Reuse it for shape checks; do not reinstall dependencies or repeat validation.
If it is absent or contradicts the reviewed checkout, report that gap rather than
assuming success. These rules do not change standalone Mode A or Mode B.

### Step H - Holistic feature review (leads the report; finalized after Step V)

A plan can be flawless per-task and still be the wrong, half, or too-much thing. Answer four questions WITH EVIDENCE:

- **H1 Right problem, worth doing now?** Superseded by landed work or a live-state change
  (the "stale OPERATOR-PENDING actually live" class)? Check `git log` since authoring +
  `roadmap status` before trusting the phase's framing.
- **H2 Right shape?** Against CONFIRMED `designRefs` + locked decisions + `rejectedAlternatives`
  (drift = finding; a task implementing a rejected option is a HIGH finding). Does
  it EXTEND a declared seam or quietly fork one (`singleSeams`)? Right altitude - vertical now,
  generalization as a named follow-up (consumer CLAUDE.md §Generalize-forward)?
- **H3 Whole?** Build the **promise ledger** per `references/plan-adversary.md` §D: every docblock/
  overview commitment mapped to the task.step fulfilling it - an unmapped promise is the FLUENTFRONT
  failure (a promised artifact shipped empty). Then check the consumer repo's wholeness bars by
  READING CLAUDE.md §Conventions at review time (flag-first ON, fail-closed, audit rule, wired-itest
  rule) - never from a restated list here.
- **H4 Anything to cut?** A task duplicating shipped capability, a speculative abstraction with
  one consumer, gold-plating past the acceptance bar.

Verdict: `SOUND | RESHAPE (what+why) | QUESTION (ruling needed)`. Disposition rides Step F: a
missing-but-mechanical wholeness piece is ADDED as auto-repair; RESHAPE/CUT/new-scope stay
report-only. An ARC review runs Step H once against the arc entity (`planes`, `singleSeams`,
`honestyRails`, criteria vs the arc's stated job); member reviews inherit it. Mode B skips Step H.

### Step V - Per-task adversarial verification

Read `../plan-phase/references/closure-checklist.md` directly and apply its judgment
checks against each task as an independent adversary (catalogue not restated here). Its mechanical members (paths, size lint, markers, emit/parse)
are `roadmap phase validate <N>`'s job: standalone runs it; the delegated branch uses
the launcher's checked result. Never hand-simulate it. Bring JUDGMENT
to the rest via `references/plan-adversary.md` (§A verify-clause falsifiability, §B anchor
freshness, §C criterion state-coverage, §E decision deferrals, §F prose-mechanism drift) - plus:

- **Source confirms** - open the function each task claims to modify; does `problem` exist there
  NOW? For a planned addition, confirm the missing capability and its creating task/contract;
  absence of that future file or symbol is expected, not a BLOCKER.
- **Blast radius** (the commonest real failure) - per Evidence rules: grep each changed
  pattern/symbol repo-wide keyed to the code token, plus alternate phrasings for prose carriers
  (comments, labels, docs drift in different words); every uncovered occurrence = NEEDS WORK.
- **Plan prose accuracy** - the plan's characterization of the existing mechanism (what keys a
  tolerance, what a route returns, what a flag gates) is verified against code like any anchor;
  a mischaracterization ships a wrong description downstream → auto-repair per §F.
- **Data-flow order** - no step depends on a later step's output. BLOCKER.
- **Hypotheses refuted** (`category:'fix'` / `kind:'hardening'`) - `notes` carries the
  `## Hypotheses` block the house plan grammar REQUIRES for these, with exactly one CONFIRMED
  cause + evidence; an unrefuted rival = NEEDS WORK; a MISSING block routes to Step F.
- **`step → verify:` grammar** - every step carries a verify clause AND the clause passes §A
  falsifiability. This review IS the enforcement the grandfathered lint defers to.

**Metadata ratifications Mode A owns** (nothing downstream re-checks these): ratify `testScope`,
per-task `testMode`, licensing, `reviewScope` relaxations, and `userFacing`/flag pairing per
`references/metadata-ratifications.md`; unjustified/violating declaration = NEEDS WORK. Record
each ratification IN the phase artifact (`notes`), not only the report - downstream reads the artifact.

Grade per task: `READY | NEEDS WORK | BLOCKER` + the evidence that produced it.

### Step F - Apply plan repairs, then re-verify

The product is a phase FIXED and queued, not a findings list. Repairs touch ONLY plan artifacts
(`.phase.ts` + `backlog.ts`), NEVER source code - a source fix routes to `/do-phase` (honor-system).
Re-run `roadmap phase validate <N>` + `roadmap status`; the verdict issues on the POST-fix plan.
- **Auto-repair** (knowable from code already read): wrong file/line anchor; blast-radius gaps
  (add the paths); an unfalsifiable verify clause or initial-state-only criterion (reword per
  `references/plan-adversary.md`); a prose-mechanism mischaracterization (§F, cite the deciding
  file); a missing `## Hypotheses` block whose confirmed cause the read code establishes (author
  it, cite the evidence); malformed `dependsOn`/stale name/mechanical `batchMode` split; an
  either/or the code resolves; a missing-but-mechanical H3 element. Tag each `[FIXED]`.
- **Report-only** (alters intent/scope/ownership - needs an owner, blocks queueing): `problem`
  absent from source; missing dependency phase or new scope; contradiction with a user-LOCKED
  decision (a repair may never override one - honor-system); unresolved `[NEEDS CLARIFICATION]`
  markers; an unresolvable §E deferral (QUESTION); a rival hypothesis the read code cannot refute.
Commit plan edits with EXPLICIT paths only (shared checkout - `git add -A` is hook-blocked):
`plan(roadmap): phase N review fixes`; run `npm run emit:phases` (`gateCommands.emit`) first when phase files feed generated views.

### Step 8 - Backlog placement (name kept: plan-arc/plan-phase cite "Mode A Step 8"; runs only on a POST-fix READY verdict)

Auto-repaired findings never block queueing; open report-only findings do (surface → owner →
re-review → queue). Derive EVERY cited index per `references/queue-placement.md`: positions
count ONLY exported-array entries in `<root>/backlog.ts` (docblock example rows are NOT rows -
miscounting is a disqualifier class); two independent probes + a `K of TOTAL` checksum. Apply
the rules in this exact order, naming each in the report:
1. **Dependency floor** - after every `dependsOn` phase: lowest index = `max(depIndex)+1`; a dep
   that is done/historical satisfies it; a dep in neither backlog nor completed record = BLOCKER.
2. **Conflict spacing** - `conflictsWith` phases never adjacent (≥1 entry between, else move).
3. **Priority sort** within the eligible range: BLOCKER > HIGH > MEDIUM > LOW; **equal =
   strict FIFO**: insert AFTER the LAST existing equal-tier entry. Placing ahead of ANY older
   equal-tier entry is a violation unless rule 1 or 2 forces it (name the forcing rule + entries).
4. **Already listed?** Validate against 1-3; propose + apply any move EXPLICITLY in the report -
   never silently reorder (honor-system; the backlog docblock names this skill as the only queue writer).
Before queueing, write `reviewRecord` with the date, judge model, verdict, and `via: 'executed'` onto the phase; a user `--skip-review` records `via: 'waived'` in the report line. Commit with the fix commit or `docs(roadmap): queue phase N`. Output
`QUEUED at K | ALREADY at K | MOVED K1→K2 | NOT QUEUED` + reasoning, positions as `K of TOTAL`.
**Placement-only / `--no-queue`:** validate 1-3, report the correct position WITHOUT editing
`backlog.ts`; confine output per `references/queue-placement.md` (no holistic/phase-verdict tokens; every proposal UNAPPLIED).

## Mode B - Post-Execution Audit (done / in-progress phases)

Strictly report-only: a shipped-wrong finding becomes new planned work via `plan-phase`, never an
inline fix (honor-system). `git log --grep="phase N"`, read each diff, then read the files at
HEAD (a diff can be reverted or mergeback-clobbered; HEAD is the truth). Two stages per task:

**B1 - Spec compliance (did the claimed work happen?)**
- Every `steps[].file` actually modified and present at HEAD; claimed anchors accurate; each
  acceptance criterion probed against the code, not the commit message.
- `category:'fix'`: trace the mechanism to the root cause - a guard at the symptom site with the
  cause untouched = papered over → FAIL.
- **Blast radius repo-wide** (the most important check): per Evidence rules - the OLD pattern +
  every renamed symbol chased through imports, string literals, label catalogs, seed data, routes,
  tests, E2E; token-keyed + alternate phrasings. Uncovered occurrence → FAIL, labeled LIVE/LATENT.
- **Hardening / persistence / event-chain tasks: a unit pass is NOT closure.** Demand evidence
  the integration-level verification was re-run POST-fix and the original symptom resolved
  (task `compromises`/`notes` or the completion commit). Absent → FAIL regardless of unit status.

**B2 - Quality bars (is what happened acceptable?)**
- Architecture floor: business logic in library modules, no side effects in pure functions,
  SSOT, canonical error shapes, integer-cents finance - plus the consumer's own bars read at
  audit time (CLAUDE.md §Conventions, `docs/CODE-STYLE.md`).
- Test coverage on executable logic; a declarative artifact's guard is its ratchet/lint lane, not a bespoke test.

**Every PASS carries its probe**: record beside each PASS the exact command or file read that
would have failed had the claim been false; every NEGATIVE claim carries its probe + searched
locations (Evidence rules). A PASS or negative with no attachable probe is a CONCERN.
Grade per task: `PASS | CONCERN | FAIL` + probe + pattern-elsewhere result.

## Phase-level verdict + close

Emit exactly this structure (downstream parsers consume the enums verbatim):

```
## Phase N Review
Mode: A|B - judged by: <model> (+ fallback reason if substituted)
Holistic: SOUND | RESHAPE (what+why) | QUESTION (ruling needed)   [Mode A only]
Tasks: N.1 <grade> - <evidence/probe> ...
Findings: [FIXED] <auto-repairs> | OPEN <report-only, owner needed>
Placement: QUEUED at K | ALREADY at K | MOVED K1→K2 | NOT QUEUED - <reasoning>   [Mode A only]
Verdict: CLEAN | HAS CONCERNS | BLOCKED
```

`CLEAN` = all tasks pass + Step H SOUND. `HAS CONCERNS` = minor findings, or RESHAPE/QUESTION.
`BLOCKED` = any must-fix. Never soften a finding or let missing evidence default favorable -
"probably fine" is not a verdict (honor-system). When the invoker asked a concrete decision question
("safe to stack?", "trust this?"), close with ONE decision-shaped line answering it ("safe to
stack, with these caveats: ...") after the verdict block. User-appended checks run last.
