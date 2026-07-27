# zeroh-roadmap eval loop plan, 2026-07-27

LangSmith-style evals over the plugin's own development process: after each arc lands,
score the arc from its recorded traces, trend the scores across arcs, and distil
recurring findings into ratified process improvements. Grounded in the 2026-07-27
audit of the flagship consumer (azure_private_agent: ~1,900 phase files, 45+ arcs,
`roadmap/arc-summaries/`, `roadmap/.gate/`) and mirroring the consumer's own product
architecture (`docs/architecture/src/eval-loops.md`: OBSERVE -> ELICIT -> RATIFY ->
PROVE; `governed-self-improvement.md`: proposer is never the actor, never rewrite
history, ratchet instead of replay).

## Verdict from the audit

**The trace corpus already exists; the eval layer does not.** Every arc leaves behind:
per-task `transparencyReport`s (compromises/skipped/hardcoded), per-phase
`executionResult` + `PhaseMetrics` + `roadmap/.gate/<phase>/run-*.json` (test slots,
reviewer rounds, verdicts), per-arc `RunnerSummary` + validate-arc `IntentVerdict`s,
and a greppable git grammar for gate-fix commits (`fix(x): phase N gate RX`). Nothing
reads this corpus after landing. The only learnings mechanism is `reviewFocus` in the
consumer's roadmap.config.json: 20 hand-authored rules distilled manually from past
gate catches, which is exactly the artifact the ELICIT stage should be generating as
proposals.

## The seven scored dimensions

| Dimension | Deterministic signals (already on disk unless noted) | Judge rubric adds |
|---|---|---|
| Code confidence | gateRounds per phase; reviewer-verdict trajectory across rounds; **escape rate**: post-land fix commits touching the arc's files (git) | were post-land fixes structural or cosmetic |
| Verified-vs-intent | IntentVerdict met/gap ratio; `tierUsed` distribution (live-host > live-ui > wired); judge confidence | evidence quality: driven flow + screenshot vs bare assertion |
| Standards adherence | reviewFocus hit counts at gates; lint/type slot exit codes | sampled adherence read of the arc diff |
| Doc brevity (git is the archive) | comment-density delta on touched files; docs-lines per code-line on the arc diff | flags narration comments, phase-number archaeology, over-documentation |
| Composability / testability | testsAdded vs surface added (PhaseMetrics); quality-pass finding counts; singleSeams disposition from the arc entity | did reuse-backward actually happen; are seams injectable |
| Speed | wall-clock per phase (new timestamps, below); gateRounds as rework tax; token load (`measure.mjs` already meters flows) | where the time went: build vs gate churn vs halts |
| Plan quality (added 2026-07-27) | escalations + checkpoints, assumption-tripwire fires, hardStops, plan-review fix counts | right altitude: over-specified/brittle (steps invalidated by reality, tripped assumptions, stale anchors) vs under-specified (executor re-derivation, scope drift) - sliceable by plannedBy |

## Architecture: `roadmap eval <ARC>`

One new CLI command + one thin skill step, run as do-arc Step 9 after the
RunnerSummary (and runnable standalone on any landed arc, including historical ones).

1. **Collect** (deterministic, a script not a model): walk the arc's phases, gate
   dirs, arc-summary, IntentVerdicts, and git; emit a raw `ArcTrace` JSON.
2. **Score**: deterministic metrics computed in code; the judge rubric columns run as
   one bounded model pass over the trace + arc diff, returning typed findings
   (intent-validator's evidence-or-downgrade pattern, the plugin's most
   weak-model-proof artifact). Output: `ArcEvalReport` (Zod, in templates/schema.ts)
   persisted at `roadmap/arc-evals/<ARCID>-<date>.json`. Never overwritten.
3. **Ratchet, not replay** (PROVE): each dimension keeps a rolling baseline over the
   last N reports; a new arc scoring below baseline gets a named regression line in
   its report. No replaying of arc builds: that is the honest, affordable analogue of
   dataset regression. Trend view bolts onto the existing `build-dashboard.sh`.
4. **Elicit -> ratify** (the part that makes it get better): a clustering pass over
   the last N eval reports groups recurring findings (same compromise class 3x, same
   reviewer catch 2x, same doc-bloat pattern) into **proposals**: a candidate
   `reviewFocus` entry, a skill-prompt amendment, a schema tightening. Proposals are
   written to `roadmap/arc-evals/proposals/` and surfaced to the user; the eval never
   edits the plugin or the config itself. Proposer is never the actor.

## The time dimension (decided)

- **Phase metrics, not per-response stamping.** `PhaseMetricsShape` gains
  `startedAt` / `completedAt` plus `haltCount` (checkpoints, escalations,
  session-limit resumes) so the eval can report active-ish time; elapsed alone is
  poisoned on a shared box. `collect-phase-metrics.ts` derives most of it from what
  already exists (gate run `startedAt`, beacon timestamps, commit times) and records
  it durably.
- **Estimation gets better via reference classes, not model clock-feel.** The eval
  aggregates a small stats table (phase duration by task count / surface-or-not /
  gate rounds) into `roadmap/arc-evals/timing-stats.json`; plan-phase and plan-arc
  read it and annotate estimates with the historical range. Model "time sense" does
  not persist across sessions; recorded stats do.
- **In-session pacing**: a one-line UserPromptSubmit hook stamping the current
  wall-clock time into each prompt, so an executor can notice a 45-minute gate round
  mid-flight. Pacing only; it feeds no metric.
- Per-tool-call / per-response timing: rejected as token noise with no consumer.

## Hermes harvest (added 2026-07-27; per the 2026-07-12 "copy patterns, never
integrate" ruling — reference clone ~/hermes-agent)

EVALLOOP-scope ports from Hermes' self-learning design, adapted to the ratify-only
contract:

- **Event-triggered lesson capture, never interval-triggered.** Hermes triggers
  skill-writes on events (multi-step success, error recovery, user correction),
  not a prompt counter. Ours: `roadmap eval lesson "<text>"` appends
  {ts, phase?, text} to a lessons sidecar (committed under roadmap/arc-evals/);
  the executor/skills name the trigger moments (error recovered, user correction,
  surprising re-derivation). EVALLOOP clusters lessons beside the arc artifacts.
  "Every 10 prompts" reflection is REJECTED: token cost + mid-flight
  self-distraction, and phase/arc boundaries are the honest grading grain.
- **Pre-compaction distillation, mechanized.** The consumer CLAUDE.md "on /compact,
  preserve ..." prose becomes a PreCompact hook injecting the preservation contract
  (modified files, active phase/task + next step, gate slots owed, flush any
  durable lesson to the sidecar) - prose-to-mechanism, the plugin's standing
  direction.
- **Curator provenance invariants for the proposal machinery.** Write-origin is
  tracked on everything the loop touches: eval proposals may CONSOLIDATE the
  eval's own prior proposals (archive, dedupe - never silent-delete), but
  user-authored content (rulings, hand-written reviewFocus entries, CLAUDE.md
  blocks, user skills) is untouchable by the loop; changes against it are always
  a routed proposal to the user. (Hermes' cautionary tale is the reason the
  ratify-only contract stays: self-written skills with approval off became a
  durable prompt-injection persistence surface - 3 CVEs.)

## Gaps to close first (prerequisites, all small)

| # | Gap | Fix |
|---|---|---|
| G1 | arc-sweep report is chat-only (SKILL.md Step 3 "ephemeral") | persist a typed sweep report as `roadmap/arc-evals/<ARCID>-<date>-sweep.json` |
| G2 | IntentVerdicts have a schema but no durable home | validate-arc writes `roadmap/arc-evals/<ARCID>-<date>-verdicts.json` |
| G3 | no timestamps or halt counts in PhaseMetrics | schema + collect-phase-metrics.ts change above |

## Driver & reviewer attribution + efficiency & reduction (ratified 2026-07-27)

The workflow's actors are heterogeneous and getting more so: session drivers (Fable,
Opus), the detached Codex lane (`roadmap codex`), possibly Grok later; reviewer
agents per gate round; a pinned judge. The eval's overall goal is the WORKFLOW
getting better AND reliable AND cheaper AND faster - which means outcomes must be
attributable to the actor that produced them, and "do less" must be a first-class
verdict, not a failure mode.

- **Attribution is captured at write time (Arc 1).** `PhaseExecutionResult` gains an
  optional `driver { model, lane }` the executor self-reports (codex journals are
  the fallback evidence for the codex lane); reviewer identity per round already
  lives in the gate run records (`agents[].agent`). The ArcEvalReport carries an
  `attribution` block (which drivers built which phases, which reviewers sat which
  rounds) so reports are sliceable later. No comparison in Arc 1 - capture only.
- **The planner is an actor too (added 2026-07-27).** Phases and arcs record
  `plannedBy { model }` at authoring time (plan-phase/plan-arc fill it), so plan
  outcomes are attributable: Fable-planned vs Opus-planned arcs become sliceable
  exactly like drivers. The `plan-quality` dimension scores the plan against what
  execution actually did. If clustering later shows plan defects correlate with
  task type, per-kind PLAN TEMPLATES become a proposal kind - rule of three applies,
  never a speculative template zoo.
- **Actor scorecards are an EVALLOOP job (Arc 2).** Per-driver slicing (gate rounds,
  escape rate, halt rate, speed by driver/lane) and the REVIEWER eval: a reviewer's
  catches correlated against later escapes (misses) and against fix-rejected rounds
  (false positives). Small-N honesty: scorecards report sample counts and abstain
  under a floor, never rank on 2 data points.
- **Automatic vs ratified (the operating contract, ratified 2026-07-27).**
  Measurement is automatic (do-arc's terminal eval step, judge, ratchet, trend -
  zero operator effort per arc); CHANGE is never automatic. Every proposal waits
  for user ratification, then ships as a normal reviewed commit - the
  proposer-is-never-the-actor rule, kept partly to prevent the loop reward-hacking
  its own grader. A proposal CLASS may later earn a standing auto-apply rule, but
  only by explicit user ruling, never by drift.
- **Two proposal lanes, routed by home (ratified 2026-07-27).** The eval improves
  two different things and the clustering pass must say which per proposal:
  (a) PLUGIN-GENERIC - the senior dev's habits: skill prompts, gate structure,
  plan templates, diets, schema tightenings; lands in the zeroh-roadmap plugin,
  benefits every consumer. (b) CONSUMER-SPECIFIC - knowing THIS repo: reviewFocus
  classes, CLAUDE.md consumer blocks, CODE-STYLE/TEST-STRATEGY amendments,
  repo-local specialist skills or reviewer agents (the hand-made
  governed-spine-reviewer is the existing exemplar of the species), release
  practice; lands in the consumer repo via its existing consumer-block seams.
  A proposal that cannot name its home lane is not ready to surface.
- **Reduction is a proposal kind.** Clustering may conclude we over-engineered or
  over-prompted: a skill section no failure ever traces to, a gate stage that never
  catches, a rubric dimension that never moves. Those become diet proposals wired to
  the existing `roadmap measure` budgets and DIET-LEDGER.md - same ratify-only
  discipline, deletion PRs are still user-ratified.
- **Cache-aware cost accounting.** Prompt caching makes the long STABLE prefix
  (skill/agent text re-read within a session) nearly free; what stays expensive is
  per-invocation variable bloat, cold reads, and context-window pressure. Diet
  proposals must weigh that split: shrinking a stable cached preamble buys little,
  cutting per-call re-explanation and variable payload buys a lot. `measure`'s
  bytes/4 remains the load metric; the eval never fabricates a dollar figure it
  cannot derive (token spend not recorded -> named sentinel, as everywhere).

## Delivery

- **Arc 1 (plugin): EVALCORE.** G1-G3, the `ArcTrace`/`ArcEvalReport` schemas, the
  collector, deterministic scoring, the judge pass, `roadmap eval`, do-arc Step 9
  wiring, dashboard trend line, the pacing hook. 3-4 phases. Backfill: run the
  collector over the last ~5 landed arcs so the ratchet starts with a baseline.
- **Arc 2 (plugin): EVALLOOP.** Clustering + proposals (reduction/diet proposals
  included) + the plan-time timing-stats consumer + the actor scorecards
  (per-driver slicing, the reviewer catch-vs-escape/false-positive eval), once a
  few real eval reports exist to cluster. 2-3 phases.

## Resolved rulings (2026-07-27)

- **Judge model: pinned `claude-sonnet-5`, never the session model.** Scores must be
  comparable across arcs; a floating judge shifts baselines for reasons unrelated to
  the code. Sonnet 5 is strong enough for rubric judgment over an arc diff, cheap
  enough to run after every arc, and the evidence-or-downgrade pattern holds on
  non-frontier drivers. Every `ArcEvalReport` records `judgeModel`; changing the pin
  resets the baseline knowingly instead of drifting silently.
- **Consumer-side `roadmap/arc-evals/` is COMMITTED.** It is the archive the ratchet
  and the clustering pass read. (Plan-review amendment 2026-07-27: the flagship
  gitignores `roadmap/arc-summaries/` by design — the RunnerSummary is regenerable —
  so ALL non-regenerable eval artifacts, the sweep and verdicts records included,
  live in `roadmap/arc-evals/`; the collector reads arc-summaries with honest-absent
  semantics.)
