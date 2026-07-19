# zeroh-roadmap improvement plan — 2026-07-01 audit

Three parallel audits (lifecycle skills · review agents/gates · mechanical substrate), each
grounded in the flagship consumer's operational record (azure_private_agent: 1,177 phase files,
38 arcs, real gate catches, real failure incidents). Goal: a high-confidence, well-balanced
coding workflow that runs **reliably on Opus 4.8**, not only on a frontier driver.

> **Reconciliation (2026-07-05, post-arc-ROADOPUS).** This 2026-07-01 audit is the standing design
> frame; its Tier-1/Tier-2 mechanical items SHIPPED across two arcs — **phases 1232/1233** (the
> `## Gate commands` seam, the PostToolUse validator hook, atomic claims, governed-spine-reviewer)
> and **arc ROADOPUS, phases 1365-1372** (FM1-FM4: scoped-gate slots + scoping-guard hook;
> validator v2 with the six write-time defect checks; the executor beacon + liveness script; the
> one-screen operating card + mid-phase resume + respawn ladder; autonomous merge (`## Merge
> policy`); the follow-up contract (IN-ARC default + typed DESCOPE + openFollowups budget);
> assumptions tripwires + the plan-arc interview step + `## Model policy`; and this five-manifest
> version alignment to 0.13.0). The arc-level design record for the ROADOPUS work is
> **`OPUS-OPTIMIZATION-2026-07.md`** (audit-grounded, 2026-07-04). Treat the tables below as the
> ORIGINAL audit — the items named here are shipped, not still-open.

## Verdict

**The architecture is right.** plan-arc (design gate) → Mode-A plan review → do-arc (recursion,
per-phase 3-gate) → arc-sweep → validate-arc: each stage catches a failure class no other stage
can, and each has caught real bugs. The three-pass phase gate (architect-critique → simplifier →
code-review) has crisp, non-overlapping division of labor. One task = one commit is the right
granularity. The Zod schema is the best artifact in the plugin and the consumer hasn't drifted
from it (template↔consumer diff = comments only).

**The two systemic problems:**
1. **Fossil DNA.** The older agents and gate-protocol are hardcoded to a previous consumer
   (pnpm/biome/vitest/drizzle/Next.js paths). `pnpm biome check .`, `pnpm e2e:local`,
   `lib/business-rules/`, vitest output parsing, a Next.js-shaped `pre-review.sh` that silently
   false-greens in this consumer. A frontier driver silently adapts; **Opus 4.8 will execute
   these literally** — fail, flail, or fabricate a pass. The newer seams (`## Validation tiers`,
   `## Design homes`, intent-validator) already solved this pattern; the fix is finishing that
   refactor.
2. **Prose where mechanism should be.** The plugin ships **zero hooks** (every sibling plugin
   ships hooks.json). Every recorded pain point — malformed phase file breaking emit:phases for
   all sessions, phase-number collisions, 3,000+ char backlog labels, arc-summary.json holding
   only the last arc — maps to a rule that lives in SKILL.md prose the schema/hooks could own.
   On a weaker driver, prose rules are exactly what decays.

---

## Tier 1 — consistency & fossil purge (do first; cheapest, biggest Opus risk)

| # | Change | Files | Why |
|---|---|---|---|
| 1.1 | **`## Gate commands` consumer block** — gate-protocol/do-phase read lint/type/unit/integration/build commands from consumer CLAUDE.md (the `## Validation tiers` pattern); fail loud when absent | `skills/do-phase/references/gate-protocol.md`, `skills/do-phase/SKILL.md` + consumer CLAUDE.md | The single biggest Opus 4.8 risk: today's mechanical checks (`pnpm biome`, `pnpm e2e:local`) literally don't exist in the consumer |
| 1.2 | **Purge fossil content from agents** — code-reviewer (focus areas 4, 8–13), test-engineer + test-strategy (vitest/drizzle → a `## Test conventions` consumer binding), software-developer (rewrite: fossil paths out, consumer-conventions read + output contract + self-check loop in), software-architect ("Architecture Reference" section → the `## Design homes` block-read its own advisor mode already uses) | `agents/*.md`, `skills/test-strategy/SKILL.md` | 8 of 13 reviewer focus areas steer at the wrong repo; thinnest prompt (developer) steers the most code |
| 1.3 | **Reconcile the merge-hold contradiction** — arc-sweep says "never merge, hold for user"; do-arc Step 8 says "auto-land is the default". Rewrite arc-sweep Step 3: report readiness; standalone runs hold; under do-arc the landing decision is Step 8's | `skills/arc-sweep/SKILL.md` | A weaker driver stalls or oscillates at the contradiction |
| 1.4 | **One confidence/severity rubric** — code-reviewer agent (80/90 confidence→Major/Critical) vs code-review skill (5-level severity) disagree; state one rubric once, reference it from both | `agents/code-reviewer.md`, `skills/code-review/SKILL.md` | Weak model produces schizophrenic labels otherwise |
| 1.5 | Housekeeping: fix `build-dashboard.sh` path bug (resolves `$SCRIPT_DIR/releases` but is installed to `scripts/`); align 3-way version drift (plugin.json 0.9.0 / package.json 0.7.0 / alt manifests 0.1.0); fix copilot/cursor manifests carrying zeroh-sdd's description; delete the hardcoded `reviews/2026-03-22-…` path in full-code-review; strip unresolvable "phase 855/858" internal references; drop dead LSP instructions (disabled on the host) for Grep | various | Small, all confirmed defects |

## Tier 2 — mechanical substrate (the Opus 4.8 safety layer)

| # | Change | Design | Why |
|---|---|---|---|
| 2.1 | **Ship hooks: PostToolUse phase-file validator** | `hooks/hooks.json` matcher Write\|Edit on `roadmap/**/*.{phase,arc}.ts` + `backlog.ts` → `npx tsx <file>` (the `definePhase().parse()` at import IS the validator) + scoped duplicate-number check; exit 2 with the Zod error | A malformed file never lands — kills the phase-1165 outage class at the source |
| 2.2 | **Atomic phase-number reservation** | `scripts/claim-phase-number.sh`: max+1 across phases/+archive, then `set -C` (noclobber) create of `roadmap/phases/.claims/<N>.claim` — creation IS the lock; EEXIST → retry N+1. plan-phase Step 1 + plan-arc 2a call it | Kills concurrent-session collisions permanently (today: unlocked read-compute-write) |
| 2.3 | **Quarantining emit** | `emit.ts`: parse failure → warn + exclude + still emit (duplicates stay fatal); also call `discoverArcs` + `crossValidate` (today arc↔phase drift is manual-audit-only) | One sibling's bad file stops blocking every session's phase completion |
| 2.4 | **Schema tightening** | (a) close the `MinimalTaskShape` union loophole (historical-only or explicit discriminant — today a malformed task silently degrades to 3-field validation); (b) deprecate bare-string `gateRounds` for new done phases; add `agent` enum + verdict per structured round; (c) `integrationTests: passed===total when total>0`; (d) backlog `label.max(200)` + reject `items: []` narrative tiers; (e) `RunnerSummaryShape.arcId` → `number\|string` union; (f) optional `PhaseTask.commit` sha (makes one-task-one-commit verifiable) | The schema is the rail a weak driver can't argue with; every escape hatch is a place it silently degrades |
| 2.5 | **Durable homes** | Per-arc `roadmap/arc-summaries/<arcId>.json` (keyed, never overwritten; `arc-summary.json` stays the last-run pointer) + `roadmap/followups/<arcId>.md` as the typed home for PLAN-PHASE/OPERATOR-PENDING sweep dispositions; backlog tier label becomes ONE line pointing there | Fixes both "history overwritten" and the root cause of backlog-label bloat (dispositions had no home) |
| 2.6 | **Script the bookkeeping** | `validate-phase.ts` (the 5 mechanical checks plan-phase Step 5 + review-phase Mode A both run as prose — fix the "5-point" header, it lists 9); `complete-phase.ts N` (groom backlog + emit + the Step-5 tail); a disposition-recording helper for arc-sweep; script audit-roadmap's 12 checks over registry.ts (a model cannot honestly execute them over 1,177 files); script full-code-review Phases 5–6 JSON/dashboard bookkeeping; de-hardcode `collect-phase-metrics.ts` (lockfile-sniff the package manager, parse node:test output, honest `unverified-historical` sentinel instead of fabricated `clean`) | Every "remember to also…" becomes one call; the judgment stays with the model, the bookkeeping doesn't |

## Tier 3 — consumer-side (azure_private_agent)

| # | Change | Why |
|---|---|---|
| 3.1 | Author `## Gate commands`, `## Review focus` (~10 repo finding classes with greppable signatures: parallel egress, missing `.parse()`, inline `process.env`, fail-open identity, persisted rehydration map, void-ed audit append, office mirror drift, non-exhaustive label Record, missing `.js` import), `## Test conventions` blocks in CLAUDE.md | The consumer half of 1.1/1.2 — same fail-loud seam as `## Validation tiers` |
| 3.2 | Mechanical fences in `.dependency-cruiser.cjs`: only `src/relay/**` may import `src/model/select.js` (no-parallel-egress as a graph edge — zero false positives); rehydration-store import fence; `process.env`-outside-config grep in the gate's Round-1 block | Moves the two catastrophic classes from probabilistic agent review to deterministic lint. The anti-zeroh-sdd lesson: mechanical gates on import edges/literal patterns, never semantic regexes |
| 3.3 | One repo-local specialist: `.claude/agents/governed-spine-reviewer.md` (mask→relay→audit→rehydrate invariants, the 7-seam ledger-sibling checklist, the fail-closed table) — swapped in as reviewer #2 when the diff touches `src/relay/ src/masking* src/audit/ src/pii/ src/contracts/`, referenced from a `## Gate specialists` block | ONE path-triggered specialist, not an agent zoo — contracts-checker/masking-hunter as separate agents would be a 3rd and 4th pass whose best checks are mechanical (3.2) anyway |
| 3.4 | Migrate existing backlog label blobs into `roadmap/followups/` (one-time, enables 2.4d) | — |

## Tier 4 — reviewer hardening & flow polish

| # | Change | Why |
|---|---|---|
| 4.1 | Reviewers emit **typed findings** (`StructuredGateRound.findings` shape) + a **verify-then-report rule** ("re-Read the flagged lines; a finding you cannot re-locate is not reported") — copy intent-validator's pattern (typed verdict, evidence-or-downgrade, parse + one re-run), which the operational record shows is the plugin's most weak-model-proof artifact | Hallucinated findings are the dominant weak-reviewer failure |
| 4.2 | architect-critique: demote "when in doubt: fix" → hard-stop-on-doubt for weaker drivers; auto-fix requires the phase-relevant test to pass, not only type-check | Frontier-calibrated bias invites overreach |
| 4.3 | simplifier: Grep-verify zero non-test callers (incl. dynamic/registry references) before deleting any export; report the grep | Guards over-deletion in a registry-wired codebase |
| 4.4 | Per-phase governed-invariant coverage = 3.1's Review-focus prepend + 3.2's mechanical Round-1 checks (today masking/spine review exists only at release tier) — NOT a fourth agent pass | Catastrophic classes are per-diff properties |
| 4.5 | **Retire orchestrator-inline arc mode** (recursion-only), or persist an explicit mode marker the skill re-reads — the dual-role "am I do-arc or do-phase?" implicit state is the set's most fragile long-horizon demand | do-arc's own "momentum carries past an escalated result" warning is the admission |
| 4.6 | do-arc Step 4: `.parse()` the phase-executor's PhaseExecutionResult; on failure fall back to `discoverResults()` then re-ask once (validate-arc's judge pattern, currently asymmetric) | Typed returns need a parse-retry contract on both sides |
| 4.7 | Replace prose exception-nests with decision tables: do-phase test cadence (kind × mode → commands), arc-sweep disposition → persistence (5 rows incl. "OPERATOR-PENDING writes none") | Tables survive weak drivers; nested prose exceptions don't |
| 4.8 | full-code-review: consumer-override rule ("a consumer release-review skill wins") — azure_private_agent's `release-review` already IS that override | Stop shipping another repo's 8 agent missions |
| 4.9 | Portability honesty: keep schema/scripts as the portable layer; either implement real hook contracts for copilot/cursor or drop the manifests (they currently point a "hook" at a Markdown file and carry the wrong plugin's description at 0.1.0) | Aspirational manifests mislead |

## Direct answers to the founder's questions

- **plan-arc → do-arc → phases: keep it.** The flow shape and phase granularity are validated by
  the operational record. Fix the contradictions (1.3) and the inline mode (4.5), not the shape.
- **Coding standards: yes — as consumer CLAUDE.md blocks** (Gate commands / Review focus / Test
  conventions), not a new standards doc: the standards already live in CLAUDE.md + the
  architecture set, and a parallel doc would drift.
- **Codebase-specific agents: one** — the path-triggered `governed-spine-reviewer` — plus
  mechanical import-graph fences for the invariants that are syntactic. The dividing line:
  *mechanical = "this pattern/edge must never appear"; agent = "is this the right behavior."*
- **Opus 4.8 reliability: the theme of every tier** — bind commands per-consumer, ship hooks,
  make the schema close its escape hatches, script the bookkeeping, type every agent boundary,
  and use decision tables where prose currently nests exceptions. intent-validator is the
  house pattern; apply it everywhere.

## Addendum — 2026-07-02: multi-session coordination (from the four-lane paused-build day)

Evidence base: four concurrent arc builds (ANYPLAN + KNOWFIX sharing the consumer's MAIN
checkout, MEETRAG + PROMPTCRAFT in isolated worktrees), a user-directed all-pause across
them, 36 phases planned in parallel by a fifth session (zero number collisions), and two
hand-rolled resume-handoff files (PROMPTGOV-RESUME.md, PROMPTCRAFT-RESUME.md) that both
worked. What should graduate from convention to plugin protocol:

1. **Pause/resume as a first-class do-arc verb.** The `<ID>-RESUME.md` pattern proved out
   twice but is re-invented each time. do-arc should honor a "pause after <phase>"
   directive: finish the phase's serialize tail, write `roadmap/arcs/<ID>-RESUME.md` from a
   TEMPLATE (worktree path, branch, HEAD, baseRef, execution mode + sizing, per-phase
   state, known gotchas, the exact next command), commit it on the arc branch, and update
   the consumer's backlog tier label with `PAUSED after <N>` + the resume pointer. Resume =
   a fresh session reads the file and continues the protocol — no archaeology.

2. **Worktree registration at arc start.** do-arc records its worktree + branch into the
   arc's backlog tier label (or a gitignored sidecar beside `.claims/`, e.g.
   `roadmap/arcs/.building/<ID>.json`) when the build starts, and clears it at merge.
   Today this lives only in session memory; the coordinator had to reverse-engineer the
   lane map from `git worktree list` + commit forensics.

3. **Claim-before-start, enforced.** `claim-phase-number.sh` worked perfectly under real
   concurrency (36 claims, zero collisions) but is convention-only. Add a validate-hook
   check: a NEW `phase-<N>.phase.ts` appearing without `.claims/<N>.claim` and without a
   prior commit for N → loud warn (block in strict mode). Also bless claiming for one-off
   fix phases, not just arc planning (the consumer now claims before ANY new phase).

4. **Bake the executor await-background gotcha into phase-executor.** It bit at least three
   times across two arcs: executors yield "waiting for a background test run" that is
   already dead, and need SendMessage nudges with process-table evidence to finish. Add to
   the phase-executor prompt: "Never yield awaiting a background test run. Before yielding,
   `pgrep` the runner; if absent, read the result file directly or re-run scoped in the
   foreground via the consumer's gate commands, then return the structured
   PhaseExecutionResult."

5. **A home for the coordination board.** The consumer now keeps a COORDINATION BOARD
   (lane map, release plan, standing conventions) in `backlog.ts`'s header comment — it
   survives sessions and rides the same commit discipline as the queue. Either bless that
   convention in using-zeroh-roadmap's docs, or add an optional `board` string field to
   `defineBacklog` (schema v10) so hooks can lint lane references against live worktrees.

6. **Model-pin housekeeping (observed).** 76c2e68 reverted ux-designer to opus while
   software-architect still carries a1f5b7e's "temporary" fable pin. The planning wave that
   motivated the pin completed 2026-07-02 — revert software-architect too; planning
   sessions that want Fable pass the call-site model override per the consumer's standing
   rule.

## Addendum — 2026-07-19: TENANTCORE executor-band findings (first arc driven on the 1737 arm/beacon CLI)

Evidence base: phases 1637–1639 of arc TENANTCORE (the spine-wide multi-tenant keystone)
driven with per-phase Opus phase-executors, supervised from a Fable session. Roughly half
the elapsed wall-clock was lost to four codifiable classes:

1. **Background-park stalls, again and harder (extends 2026-07-02 item 4).** Four
   incidents, ~3.5h lost in one phase alone (docs build 67 min, gate run 55 min,
   post-gate 38 min, review chain ~50 min): the executor ends its turn "anchored on the
   background run + armed Monitor", and the wake dies silently (session events reap
   Monitors on shared hosts). The 2026-07-02 prompt fix under-shoots — the executor
   treated 10–15 min tiers/doc builds as background-worthy. Tighten executor-reference:
   FOREGROUND every bounded run regardless of duration (tiers, type-check, docs builds);
   a background park is legal ONLY for genuinely unbounded work, and then the turn must
   end on a disk-heartbeat contract (beacon file the supervisor can poll), never a
   Monitor.

2. **Subagent results route to the ORCHESTRATOR, not the spawning executor.** Two
   further stalls (~40 min each): architect Decision Contracts finished in ~3 min
   (145s/178s) while the executor yielded "awaiting the architect" — the verdicts landed
   as task-notifications in the supervising session, and the executor sat dark until a
   SendMessage relay. do-phase ALREADY mandates the architect as "foreground, single
   hop"; the gap is enforcement in phase-executor.md: state that a spawned subagent's
   result NEVER arrives after a yield (it routes to the orchestrator), so the consult
   must be read in-turn and an executor must never end its turn to await a subagent.

3. **Commit-grammar attribution fails silent → cryptic red gate.** Subjects of the form
   `phase N task N.X — …` defeat phaseOwnFiles (grep `phase N —`): every file classes
   foreign, the scoped slots run with `files: []` and exit 2 with no cause named.
   deviantGrammarFindings only catches the `phase N N.X —` variant, so this shipped 23
   commits deep and cost a filter-branch reword + a full gate re-cycle. Fixes:
   (a) widen the deviant regex to also catch `phase N task N.X`; (b) gate plan/run
   should FAIL LOUD ("0 phase-own files but K commits in range — commit-grammar
   attribution broken?") instead of running empty slots; (c) print the canonical grammar
   in `roadmap phase start` output so executors see it at the moment it matters.

4. **`roadmap watch` as a long-lived daemon is reaped on shared hosts.** Both daemon
   instances died before their arc finished — one after hours, its restart within
   minutes (test-orphan-reaper class). The working pattern was supervisor-driven
   `watch --once --json` spot-checks on each executor notification + a commit-tail
   monitor. Bless that in do-arc's step 2.3 (or make `watch` itself re-exec-resilient
   via a cron/heartbeat mode).

Env facts for calibration: the same executor ran phase 1638 CLEAN in ~2.5h once
"foreground only" was in its brief — the stall classes, not executor capability, were
the bottleneck. Also confirmed live: executor-arm/disarm + phase start + beacon (1737)
work end-to-end; executor-disarm --sweep correctly swept a terminal phase's arm.

## Addendum — 2026-07-19 (night 2): WORKSIM confirms the executor-band stall classes; supervision arrow inverted

Evidence base: arc WORKSIM (1693 inline + 1694 via an Opus phase-executor) driven from a Fable
session on the shared MAIN checkout, three sibling lanes committing concurrently. ~7h wall-clock
for 3 phases + sweep/validate/land, ~40% lost to coordination waste. Confirms every 2026-07-19
TENANTCORE class and adds two:

1. **The agent card BLESSES the broken park** (root cause behind item 1 above): phase-executor.md
   line ~19 sanctions ending a turn on "a beacon'd background-run with its armed Monitor" — on this
   host Monitors/watchers are reaper-bait (four killed in one night, incl. an `arc land` that
   backgrounded at the 600s Bash cap and died with an EMPTY output file while reporting exit 0).
   The 1694 executor stalled twice exactly this way (20–40 min each until a SendMessage). Fix
   scope decided later; the fix shape: turn ends on running tool calls or the typed result,
   NOTHING else; foreground every bounded run; unbounded work = detached setsid + own-log +
   sentinel + beacon, supervisor spot-checks only.
2. **The executor-arm Stop-hook guard did NOT fire on either yield** — it guards the top-level
   session, not the spawned executor's stop. A durable guard must trip on the executor's own
   stop while its phase shows undone tasks and no terminal result.
3. **NEW — `arc land` full-tier fallback + buffered silence:** impacted.mjs cannot class
   sim-runner/** (own package), scenario-library .json (loader-test-owned), or .py — selector
   rc=3 → FULL unit tier on a contended box (~1h), with npm buffering all output so a dead run
   and a live run look identical from outside. Owed: classing rules for non-module-graph files +
   stage-progress streaming to the land log.
4. **NEW — foreign-red polling is unowned:** two of three phase gates went red on FOREIGN
   sibling in-flight work (a type break, a contracts-pure violation); every session hand-rolls
   the same poll-until-green loop. Owed: `gate run --wait-foreign-green` (bounded, only when the
   red is provably outside the phase-own set).
5. **Throughput calibration:** the INLINE drive (1693: 6 TDD tasks + quality pass + 3 reviewer
   rounds, ~2h) ran ~2x the delegated executor's pace (1694: 5 tasks, ~2.5h + two stalls).
   Consumer policy worth blessing: prefer inline for arcs ≤2–3 phases when the driver is Fable —
   the executor band protects orchestrator context, but on short arcs it costs more than it saves.

User directive on record (2026-07-19): "we need a durable executor that actually gets the work
done… he should be the watcher." The supervision arrow must invert: the executor watches its own
children by foregrounding; the supervisor only reacts to the typed result or a stale disk beacon.
