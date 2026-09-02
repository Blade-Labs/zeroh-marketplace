# zeroh-roadmap — Deletion-Disposition Ledger (ROADCODE prose diet)

## 2026-09 diet — phase 26.3

The nine never-trimmed bodies were returned to their last independently gated concise forms, then measured against the 2026-09-02 pre-diet tree. The detailed one-row-per-source-paragraph map and architect amendments live in `DIET-PLAN-2026-09.md`; the rows below are the ledger index for each removed/compressed passage class.

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| do-phase: duplicated worktree, gate-selection, and completion mechanics | enforced-by-code(`roadmap phase start`, `roadmap gate plan/run`, `roadmap phase curate`; cli/commands/phase.test.mjs, gate.test.mjs) | operative sequencing stays in the concise body; command internals return to code |
| do-phase: batch, long-run, and landing branch detail | relocated(`agents/references/executor-reference.md`) | conditional executor mechanics load only when the card's trigger fires; the body retains batch and landing decisions |
| do-arc: terminal-handoff landing mechanics | enforced-by-code(`roadmap arc land`; cli/lib/landing.mjs and landing tests) | phase-1658/1659 independently gated disposition reused |
| do-arc: option and handoff rationale | relocated(`DESIGN-NOTES.md` §executor orchestration) | concise body keeps the option vocabulary and non-done decisions; incident rationale remains in the established non-loaded design history |
| arc-sweep/release-sweep/validate-arc: command mechanics and incident rationale | relocated(their cited `references/` homes) | model-loaded bodies retain debt and validation judgment; conditional detail remains on demand |
| phase-executor: dated stale-read/API incident narration | relocated(`agents/references/executor-reference.md`) | card retains the empty-read, no-transcript-polling, gate, and typed-return rules |
| quality-pass/code-reviewer/software-architect: generic craft narration | obsolete-with-evidence(the role models already supply generic craft; typed outputs, severity, decision contracts and no-recursion remain) | phase-1659 agent-card gate established the ≤5,000-byte per-card forms |

Measured roll-up: do-arc **53,343 B / 13,339 tokens → 42,649 B / 10,665 tokens** (20.0%); do-phase **24,054 B / 6,014 tokens → 13,421 B / 3,356 tokens** (44.2%). Plan-arc is unchanged at 68,223 B / 17,057 tokens because none of its six manifest files is in this diet.

**The honesty rail (arc ROADCODE rail 3, locked decision 6).** No passage is deleted or
compressed from a model-loaded skill/agent-card without a NAMED disposition here. One row per
removed/compressed passage at section/heading granularity. A trim without a disposition row is a
gate failure, not a style nit.

**Grammar.** Each row: `| passage (origin heading/anchor) | disposition | evidence |`. The
disposition is exactly one of three:

- **enforced-by-code**(`<cli command | hook | test path>`) — the deleted rule is now enforced by
  a THING THAT EXISTS on branch `rebuild/roadcode` (a CLI command with a test, a hook branch, a
  schema refinement). The reviewer spot-checks the named code; a disposition pointing at code
  that does not enforce the deleted rule is a BLOCKER.
- **relocated**(`DESIGN-NOTES.md §<anchor>`) — the passage's text moved, verbatim in spirit,
  into the named DESIGN-NOTES.md section (never model-loaded). The named section must contain it.
- **obsolete-with-evidence**(`<one-line evidence>`) — falsifiable evidence the passage is dead (a
  retired mechanism, a superseded decision with its ruling date), not "seems unused".

A pass may ALSO open with a per-FILE roll-up row carrying before/after tokens; that row is a
measurement index, not a disposition — the per-passage rows beneath it carry the falsifiable
evidence the vocabulary demands.

**Ruling (operator, 2026-08-24) — the diet's standing bar.** Protocol bodies carry
**operative rules only**: incident archeology and why-a-rule-exists live in git history (the commits already
carry `WHY:` blocks), at most ONE clause of rationale survives where judgment genuinely depends on
it, and rarely-consulted detail decomposes into an on-demand reference. The budget is therefore not
a target but the MEASURED load at the last ratification, with zero growth allowed.

**Measured, never asserted (rail 4).** Size/token claims are `wc -c` and `roadmap measure`
outputs. The measured do-arc protocol load vs the ~49k baseline is recorded here:

> **Baseline (2026-07-15 plugin audit):** do-arc protocol load ≈ 49,000 tokens.
> **Measured (phase 1659.8, `roadmap measure --flow do-arc`):** **8,233 tokens** (32,924 B over 6
> model-loaded files) — an **~83% cut**, well under the budget (`roadmap measure --flow do-arc
> --assert <budget>` exits 0). The budget is the MEASURED load at the last ratification —
> **13,339 tokens** (2026-09-02, phase 23 task 23.5, operator re-ratchet; 13,257 from 2026-08-24,
> phase 1 task 1.4) — held in ONE place —
> `cli/lib/measure-budget.mjs` `PROTOCOL_LOAD_BUDGET_TOKENS`, read by the measure gate
> (cli/commands/measure.test.mjs) and by the ELICIT pass (cli/lib/eval-propose.mjs); it was
> 12,000 → 12,500 by user ruling 2026-07-27 (phase 1995 escalation) before the 2026-08-24 ruling
> replaced the aspirational number with the measured one. The
> cut is deletion-with-disposition (every removed passage has a row below), not hidden content — the
> fixture tier (1660) + rehearsal (1661) prove nothing load-bearing regressed.

---

## do-arc/SKILL.md (41,288 B → 4,875 B) — consolidated from 1658

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| :36-50 execution-prompt generation spec | relocated | DESIGN-NOTES.md §do-arc — execution-prompt generation spec (plan-arc owns the generator; thin skill keeps a pointer) |
| :52-79 execution-band thresholds (10/4/3/2) + per-phase classification | enforced-by-code(`roadmap arc next` band + `roadmap gate plan`; classifyBand in cli/lib/ladder.mjs) | thresholds are named constants in ladder.mjs; the workflow's classifyBandRoute routes the band |
| :81-89 arc-level task checklist prose | obsolete-with-evidence(per-plane workflows own phase sequencing — the arc/task-tier ritual is gone) | workflows/arc-plane.workflow.mjs |
| :91-99 build-sidecar registration shape | enforced-by-code(`roadmap arm`/`roadmap disarm`; cli/lib/sidecar.mjs) | arm writes the sidecar + refuses a taken lane |
| :107-209 watchdog liveness verdicts (stalled/exited reads) | enforced-by-code(`roadmap watch` exit 3/4/5 + hooks/executor-result-guard.mjs) | cli/commands/watch.mjs |
| :107-209 SendMessage resume-from-transcript protocol | obsolete-with-evidence(one-task-one-commit + `roadmap arc next` re-derivation bound the loss to the in-flight task; a relaunch fast-forwards) | cli/lib/derive.mjs deriveResume |
| :107-209 nudge → relaunch → escalate residue | enforced-by-code(thin do-arc's ~4-line reaction over `roadmap watch` verdicts) | skills/do-arc/SKILL.md |
| :107-209 dated incidents 2026-07-03/05/09/11/12 + beacon-sentinel narrative | relocated | DESIGN-NOTES.md §do-arc — watchdog & recovery-ladder incidents |
| :213-227 arc-mode marker + parse-the-return prose | enforced-by-code(`roadmap arm --inline` writes roadmap/.arc-mode; `roadmap result check` parses-or-dies) | cli/commands/arm.mjs, result.mjs |
| :237-247 shared-mutation serialization prose | enforced-by-code(workflow serializeSharedMutation grooms backlog + runs emit serially) | cli/lib/workflow-steps.mjs |
| :237-247 context-pressure "don't rush / delegation" prose | obsolete-with-evidence(per-plane workflows shrink the session's working set; the prose no longer earns its bytes) | workflows/arc-plane.workflow.mjs |
| :249-274 pause protocol (RESUME.md write, backlog label, sidecar-paused) | obsolete-with-evidence(locked decision 3: pause is free — no workflow state to hand off; resume = relaunch the plane workflow) | ROADCODE-DESIGN.md §4 halt semantics |
| :290-327 Step 8 landing mechanics (local-merge-then-push, contention, never-branch-ref, seven-blocker, autonomous-push) | enforced-by-code(`roadmap arc land`; cli/lib/landing.mjs) | policy values are config DATA (mergePolicy) |
| :328-353 Step 8b runner-summary field mapping | enforced-by-code(`roadmap arc land` writes RunnerSummary via the schema parse boundary) | cli/lib/landing.mjs |

## do-phase/SKILL.md (27,933 B → 6,139 B) — consolidated from 1658

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| :18-29 backlog next-up bash | enforced-by-code(`roadmap status` resolves the next queued phase) | cli/commands/status.mjs |
| :92-106 dependency verification loop | enforced-by-code(`roadmap phase validate` + `roadmap arc next` blocked action; unmet-dep detection in cli/lib/derive.mjs) | cli/commands/arc.mjs |
| :119-143 Step 1b resume path | enforced-by-code(`roadmap arc next` mid-phase re-derivation + unverified-done detection; derive.mjs deriveResume; em-dash SHA rule in gitscan) | cli/lib/derive.mjs |
| :242-265 kind×mode gate tables + four refinements | enforced-by-code(`roadmap gate plan` prints the resolved cell; `roadmap gate run` executes it; cli/lib/ladder.mjs + slots.mjs) | cli/commands/gate.mjs |
| :244 references/gate-protocol.md load directive | relocated | folded into thin do-phase (design-parity + per-stage echo, ~2KB); the ladder/table/slot prose is enforced-by-code(ladder.mjs + slots.mjs) — see the gate-protocol.md section (1659.5) |
| :276-282 arc-mode re-derivation prose | enforced-by-code(roadmap/.arc-mode sidecar written by `roadmap arm --inline`, read via `roadmap status`) | cli/commands/arm.mjs |
| :290-307 completion / grooming / push overrides | enforced-by-code(`roadmap gate run --verify-complete` + workflow serializeSharedMutation + `roadmap phase validate` done-transition check) | cli/commands/gate.mjs, phase.mjs |

## agents/phase-executor.md (6,912 B → 3,070 B) — consolidated from 1658

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| :26-45 never-rule-2 turn-end incident narration (2026-07-05/09) | enforced-by-code(hooks/executor-result-guard.mjs blocks a bare-prose mid-phase end; card keeps the three-legal-turn-ends rule + ROADMAP_EXECUTOR_PHASE arming) | hooks/executor-result-guard.mjs |
| :26-45 dated incident stories (2026-07-05/09) | relocated | DESIGN-NOTES.md §phase-executor — turn-end incidents |
| :55-71 beacon-forensics + long-run mechanics detail | relocated | condensed to the task-loop's task-start beacon + a pointer to executor-reference.md's long-run protocol |

## agents/references/executor-reference.md (13,781 B → 4,086 B) — consolidated from 1658

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| :7-22 "Full do-phase inheritance" restatement | enforced-by-code(decision 6: skills/do-phase/SKILL.md is the single statement of the do-phase rules; a restatement can only drift) | skills/do-phase/SKILL.md |
| :24-45 capability + spawn boundary detail | enforced-by-code(card's spawn-boundary section + the authorized-sub-agents allowlist — the sub-agents hold no Agent tool) | agents/phase-executor.md |
| :146-154 liveness-nudge protocol | enforced-by-code(`roadmap watch` verdicts + card's one-line "a nudge while healthy is a misread" note) | cli/commands/watch.mjs |
| :179-187 result contract restatement | enforced-by-code(seam 3: PhaseExecutionResultShape + `roadmap result check` + the hook; card names the typed return) | templates/schema.ts, cli/commands/result.mjs |
| long-run + foreign-red dated incident narrations (2026-07-05/06/09/11/12, RAGFID 1537) | relocated | DESIGN-NOTES.md §executor-reference — long-run survival & foreign-red incidents |

## using-zeroh-roadmap/SKILL.md (7,023 B → 2,045 B) — consolidated from 1658

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| :11-45 first-time scaffold steps | enforced-by-code(`roadmap init` scaffolds roadmap/ + roadmap.config.json) | cli/commands/init.mjs |
| :32-45 SessionStart schema-drift-check bash + update nudge | obsolete-with-evidence(no SessionStart hook exists to replace the grep; `roadmap config check` surfaces a schema-marker mismatch instead — no non-existent hook is cited) | cli/commands/config.mjs |
| :78-98 multi-session coordination prose | enforced-by-code(`roadmap status` lanes / `roadmap claim` phase lock / `roadmap arm` arc lane) | condensed to three pointer lines |
| :100-102 migration section | enforced-by-code(routing table's migrate row points at scripts/migrate/README.md) | scripts/migrate/README.md |
| pause-row trigger + rationale phrases "/ after phase N", "— pause is free" (trimmed 2026-07-28, arc EVALCORE 1998.3, do-arc flow at 12499/12500) | obsolete-with-evidence(pause-is-free is already carried by do-arc's §Pause & resume — one statement of the fact suffices; the "/ after phase N" trigger collapses into "pause the arc" without loss) | skills/do-arc/SKILL.md §Pause & resume |

---

<!-- Sections below are populated by phase 1659's own trim tasks. -->

## audit-roadmap/SKILL.md (14.7 KB → 1,592 B) — phase 1659.2

Every hand-run check section is now `roadmap audit` code (cli/commands/audit.mjs +
cli/audit-checks.mjs, tested by cli/commands/audit.test.mjs). The thin SKILL keeps only
trigger + invocation + verdict interpretation + is/is-not routing.

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| Step 1 enumerate (ls/find/cat + in-memory maps) | enforced-by-code(cli/audit-checks.mjs discoverPhases over phases/ + archive/<v>/ + backlog import) | audit-checks.mjs |
| Check 1 dangling phase dependsOn | enforced-by-code(cli/audit-checks.mjs check 1 + audit.test.mjs) | CRITICAL preserved |
| Check 2 dependency cycles | enforced-by-code(cli/audit-checks.mjs check 2 DFS + audit.test.mjs) | CRITICAL preserved |
| Check 3 backlog→missing phase | enforced-by-code(cli/audit-checks.mjs check 3 + audit.test.mjs) | HIGH preserved |
| Check 4 [NEEDS CLARIFICATION] markers | enforced-by-code(cli/commands/audit.mjs check 4 file:line + queued→CRITICAL + audit.test.mjs; scoped by phase 13.3 to LIVE phases and a TERMINATED token — a terminal phase's recorded question and an unterminated guard string are data, both documented marker forms still fire) | MEDIUM/CRITICAL preserved |
| Check 5 done phase incomplete tasks | enforced-by-code(cli/audit-checks.mjs check 5, historical exempt + audit.test.mjs) | HIGH preserved |
| Check 6 task dependsOn bad IDs | enforced-by-code(cli/audit-checks.mjs check 6 + audit.test.mjs) | HIGH/HIGH/MEDIUM preserved |
| Check 7 stale in-progress | enforced-by-code(cli/commands/audit.mjs check 7 git-log staleness + audit.test.mjs) | LOW preserved |
| Check 8 duplicate phase numbers (active+archive) | enforced-by-code(cli/audit-checks.mjs check 8, reuses DUPLICATE_PHASE_NUMBER_PREFIX wording + audit.test.mjs) | CRITICAL preserved |
| Check 9 missing kind (+ suggestKind backfill) | enforced-by-code(cli/audit-checks.mjs check 9, REUSES scripts/migrate/audit.ts suggestKind + audit.test.mjs) | HIGH preserved |
| Check 10 stale done entries in backlog | enforced-by-code(cli/audit-checks.mjs check 10 + audit.test.mjs) | MEDIUM/LOW/LOW/HIGH preserved |
| Check 11 oversized tasks without batchMode | enforced-by-code(cli/audit-checks.mjs check 11, done-task exempt + audit.test.mjs) | HIGH preserved |
| Check 12 archive integrity (12.1-12.4) | enforced-by-code(12.1/12.2 in cli/audit-checks.mjs; 12.3/12.4 REUSE debt-census join via `--include-archive` in cli/commands/audit.mjs + audit.test.mjs) | CRITICAL/CRITICAL/HIGH/MEDIUM preserved |
| arc↔phase consistency bonus | enforced-by-code(cli/audit-checks.mjs REUSES registry crossValidate() verbatim) | crossValidate |
| Step 3 report + verdict rules (CLEAN/HAS ISSUES/BROKEN) | enforced-by-code(cli/commands/audit.mjs renderReport + exit contract: BROKEN=2, else 0) | design §2 universal exit codes |
| "What NOT to do" (report-only, no short-circuit, no infer) | relocated | condensed into the thin SKILL's Report-only + routing paragraphs (kept as judgment) |

## plan-phase/SKILL.md (25.7 KB → 10,992 B) — phase 1659.4

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| Step 1 claim-script mechanics (claim-phase-number.sh internals, git-common-dir noclobber prose) | enforced-by-code(`roadmap claim`; cli/commands/claim.mjs) | the atomic-claim lock is the CLI's job; the skill states intent only |
| Step 4 slot-resolution prose (types/emit slot binding via `## Gate commands`) | enforced-by-code(`roadmap phase validate`; cli/lib/validate.mjs) | one command runs the write engine + emit |
| Step 5 mechanical members (paths resolve, size lint, unresolved-marker grep, emit/parse) | enforced-by-code(`roadmap phase validate` + `roadmap audit` check 4/11; audit.test.mjs) | the 9-check list keeps its JUDGMENT members as prose, points the mechanical ones at the CLI |
| Step 6 claim-rm mechanics (`rm -f …/<N>.claim`) | enforced-by-code(`roadmap claim` frees the reservation on commit) | cli/commands/claim.mjs |
| the yield-audit ATELIER granularity example + the full definePhase signature dump | relocated | condensed inline to the granularity rule + a compact signature line (judgment kept, narration cut) |
| `step → verify:` REQUIRED grammar + grandfather rule (NEW content, not a deletion) | enforced-by-code(cli/lib/validate.mjs stepVerifyGrammarWarnings — WARN on new-to-git only; bin/validate-roadmap-file.test.mjs) | review-phase Mode A is the enforcement; the lint is the reminder |

## review-phase/SKILL.md (23.2 KB → 8,995 B) — phase 1659.4

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| the restated 7-check verification catalogue (Checks 1-7 bodies) | enforced-by-code + relocated | REPLACED by ONE reference to plan-phase Step 5's self-verify list, applied adversarially (design decision 6); mechanical members are `roadmap phase validate`'s job |
| the `## Model policy` CLAUDE.md-block reference (Mode A HOME statement) | enforced-by-code(reads `modelPolicy.judgeModel` from roadmap.config.json; absent key = frontmatter default) | the config seam replaces the anchored block |
| the `## Gate specialists` CLAUDE.md-block references (testScope/reviewScope ratification) | enforced-by-code(a "specialist path" = a `gateSpecialists` path in roadmap.config.json) | config key replaces the anchored block |
| verbose per-task/Mode-B output templates + dated-defect asides (1281.7/1282.6, 1345, 1367) | relocated | trimmed to the rule; the KEEP-LIST (Step H, Mode A judge-model routing, Step 8 backlog-placement rules, Mode B hardening-closure rule) survives verbatim in spirit |

## do-phase/references/gate-protocol.md (38,575 B → DELETED) — phase 1659.5

The entire file is `git rm`'d. Every top-level section's disposition:

| passage (origin heading) | disposition | evidence |
|---|---|---|
| Gate commands — the consumer binding + resolution rules (REFUSE-on-missing, scoped-slot fallback note, never-invent-a-filter) | enforced-by-code(cli/lib/slots.mjs — the scoped-slot resolution rule + fallback note + verbatim execution; `roadmap gate run`) | cli/lib/slots.test.mjs |
| Gate Set by `phase.kind` (kind×mode table) | enforced-by-code(cli/lib/ladder.mjs gateCell; `roadmap gate plan` prints the resolved cell) | cli/lib/ladder.test.mjs |
| Design-parity stage (the LOOP protocol + rubric) | relocated | folded into skills/do-phase/SKILL.md "Design-parity stage" (1658.4) — a fold, not a deletion |
| Failure-identity rule (RED output must name failing tests; never re-filter a slot) | enforced-by-code(cli/lib/slots.mjs streams slot stdout/stderr unfiltered, tees to a log) | slots.mjs |
| Test-scope ladder (static/scoped/relevant/full derivation, floor rule, specialist floor, sequence cadence) | enforced-by-code(cli/lib/ladder.mjs deriveTestScope + specialistFloor) | cli/lib/ladder.test.mjs |
| Review-scope ladder (none/light/full, ≤150-line threshold, specialist hard floor, declared semantics) | enforced-by-code(cli/lib/ladder.mjs deriveReviewScope) | cli/lib/ladder.test.mjs |
| Per-Stage Echo Contract | relocated | folded into skills/do-phase/SKILL.md "Echo contract" (1658.4) |
| Round 0 — Quality Pass | relocated | the protocol is in skills/do-phase/SKILL.md gate section + agents/quality-pass.md |
| Rounds 1..N — Correctness Loop (mechanical checks half) | enforced-by-code(cli/lib/ladder.mjs + slots.mjs + `roadmap gate run`) / relocated(the agent-review loop + hard-cap 5 in do-phase) | ladder.mjs, slots.mjs |
| Compromise Summary | relocated | skills/do-phase/SKILL.md Step 4b (already the durable statement) |
| Phase Completion (done-fields, gate enforcement) | enforced-by-code(`roadmap gate run --verify-complete` + cli/lib/validate.mjs done-transition check) / relocated(do-phase Step 5) | validate.mjs |

Provenance note: cli/lib/ladder.mjs, ladder.test.mjs, and slots.mjs carry `gate-protocol.md:NNN`
source-line comments BY DESIGN (ROADCODE-DESIGN §2: "the deleted gate-protocol tables live on only
as these functions' test fixtures"; ladder.mjs:9 anticipates this deletion). Those are the
enforced-by-code provenance record and are OUT of the 1659.5 grep scope (skills/hooks/templates/bin/
scripts), which is 0.

## plan-arc/SKILL.md (17,386 B → 12,998 B) — phase 1659.5

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| the gate-protocol.md "Design-parity stage" pointer (Step 1b.3 ux-parity minting) | enforced-by-code(the thin do-phase gate section carries the design-parity stage) | skills/do-phase/SKILL.md |
| `## Design homes` anchor (arch + UX sub-gate reads) | enforced-by-code(read `designHomes` from roadmap.config.json; absent key → the same loud STOP) | cli/lib/config.mjs |
| `## Model policy` anchor (Step 3 reviewer routing) | enforced-by-code(`modelPolicy.judgeModel` config key) | review-phase HOME statement |
| Ask Ali / Studio / Agent HQ 2026-07 escalation narration | obsolete-with-evidence(the ux-parity pairing + validate-arc fail-safe derivation now close the drift the incident taught; the story added no operative rule) | plan-arc Step 1b.4 + validate-arc |
| verbose defineArc stub comments + reuse-first/sub-gate explanatory prose | relocated | condensed inline — the design-first protocol (classify → arch → UX → confirm) is kept intact, narration trimmed |

## plan-arc/references/design-gate.md (9,465 B → 8,673 B) — phase 1659.5

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| `## Design homes` anchor (§3 UX reuse, §4 homes, absent-block STOP) | enforced-by-code(`designHomes` config key; absent key → the same loud STOP) | cli/lib/config.mjs |
| `## Validation tiers` anchor (missing-binding mirror) | enforced-by-code(`validationTiers` config key) | cli/lib/config.mjs |
| reuse-first / generalize-forward / craft-bar explanatory prose | relocated | light-trimmed inline — the reuse-or-design protocol is untouched, only wording compressed |

## arc-sweep/SKILL.md (13,762 B → 8,965 B) — phase 1659.6

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| hand-in-contract prose (two-priority-order explanation, discoverResults() rationale) | enforced-by-code(`discoverResults()` + `roadmap debt census`) | condensed to the CLI calls; the debt-disposition table + reasoning are kept verbatim |
| `## Merge policy` anchor (disposition-mode read) | enforced-by-code(`mergePolicy.arcIntegration` config key) | cli/lib/config.mjs |
| `## Model policy` anchor (whole-arc architect routing) | enforced-by-code(`modelPolicy.judgeModel` home statement) | KEEP-LIST: the judge-model routing survives |
| Ask Ali / Studio / Agent HQ 2026-07 off-design narration (design-conformance) | relocated | DESIGN-NOTES.md §Design-parity origin incident |
| ledger-audit clause (NEW content, not a deletion) | enforced-by-code(the sweep verifies every arc-diff prose deletion has a DIET-LEDGER row + spot-checks enforced-by-code claims) | skills/arc-sweep/SKILL.md Step 2 |

## release-sweep/SKILL.md (13,847 B → 7,341 B) — phase 1659.6

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| Step 2 debt-join mechanics (candidate-debt enumeration, the 1371 open-status recheck) | enforced-by-code(`roadmap debt census` — the transparencyReport↔debtResolutions join) | scripts/debt-census.mts |
| `--all-done` bulk mechanics (census + dispose scripts) | enforced-by-code(`roadmap debt census` / `roadmap debt dispose` / `roadmap debt check`) | selector + archive JUDGMENT kept as prose |
| verbose resolution-vocabulary examples + edge-case prose | relocated | condensed inline; the (f)/(p)/(w)/(d)/(k)/(s) vocabulary + archive-gates-on-clean-debts rule kept |
| Step 5 archive git-mv mechanics (conflict-fatal, re-runnable skip guard) | obsolete-with-evidence(NOT owned by `roadmap debt`) → **KEEP-LIST**: PROSE-carried, survives verbatim | the git-mv loop is retained in Step 5 |

## validate-arc/SKILL.md (10,285 B → 7,696 B) — phase 1659.6

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| `## Validation tiers` anchor (Step 1 runnable check) | enforced-by-code(`validationTiers` config key) | cli/lib/config.mjs |
| `## Model policy` anchor (Step 3 judge routing) | enforced-by-code(`modelPolicy.judgeModel` home statement) | KEEP-LIST |
| verbose judge/panel/corrective-loop prose | relocated | condensed inline; the independent-judge protocol + panel sizing (2-agree for subjective, 1 for deterministic) + evidence-or-downgrade + the ux-parity fail-safe derivation are KEPT |
| Ask Ali / Studio / Agent HQ 2026-07 off-design narration (fail-safe rationale) | relocated | DESIGN-NOTES.md §Design-parity origin incident |

## full-code-review/SKILL.md (21,203 B → 18,885 B) — phase 1659.6

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| `## Gate commands` anchor (Phase 5 validation-gate task) | enforced-by-code(`gateCommands` config key) | cli/lib/config.mjs |
| Phase 5/6 verbose bookkeeping (JSON-shape examples, per-step commit prose, next-number sed) | relocated | condensed inline — the 8-agent release-gate protocol (Phase 2 Agents 1-8) is UNTOUCHED; next-number → `roadmap claim` |

## gate-loop details (from the deleted gate-protocol.md Rounds 1..N) — phase 1659.6

The three gate-loop details release-sweep's trim step flags — each gets a NAMED disposition, never a
silent drop:

| passage | disposition | evidence |
|---|---|---|
| hard round-cap 5 | relocated | skills/do-phase/SKILL.md gate section — "Rounds 1..N correctness loop (cap 5)" |
| RN>1 reviewers scoped to the fix-diff only | relocated | skills/do-phase/SKILL.md gate section — the Rounds 1..N loop names the round-scoped review-input |
| the finding `agent` attribution vocabulary (reviewer-1 / specialist name / quality-pass) | enforced-by-code(StructuredGateRoundShape.`agent` field; do-phase records `agent:` per finding + `agent: 'design-parity'`) | templates/schema.ts |

## agent cards (7 judgment cards) — phase 1659.7

**Ceiling reframed (USER RULING 2026-07-16, via AskUserQuestion — supersedes decision 5's ≤19,000
grand total).** The 19,000 grand-total conflated repo footprint with per-spawn context cost — no agent
loads all seven cards; each loads only its own. The binding ceiling is now **PER-CARD: each `agents/*.md`
≤ ~5,000 B** (every card passes; max 4,410 = quality-pass). This resolved the software-architect
ESCALATE_TO_USER verdict that the ≤11,832 seven-card sum was infeasible against the load-bearing judgment
the cards carry. Every card cut 39% from the pre-arc ~36,935 B (→ 22,442 B) preserving all judgment.

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| the canonical UX design-parity rubric (was intent-validator.md inline) | relocated | skills/validate-arc/references/parity-rubric.md — ONE canonical home; the 4 citing skills (validate-arc/plan-arc/arc-sweep/do-phase) + intent-validator point there by name (the ux-craft.md / driving-tiers.md precedent; a skills/references doc does NOT count against the agents/ ceiling) |
| intent-validator narration (independence/tier/drive-flow prose) | relocated | condensed inline; the bar rubric (3 Qs) + evidence-or-downgrade + IntentVerdict shape KEPT |
| quality-pass verbose mandate prose | relocated | condensed to dense lists; the two mandates (additive 3-item + subtractive 7-item incl. grep-before-delete) + 4-tag hard-stop taxonomy KEPT verbatim in spirit |
| software-architect generic "core principles" prose | obsolete-with-evidence(generic architect craft the opus model already has) → condensed to one line; the two-verdict **Decision Contract** + no-recursion + verify-on-the-way KEPT VERBATIM (Step-2 keep-list) | agents/software-architect.md |
| code-reviewer 7 generic review-class bodies | obsolete-with-evidence(generic code-review knowledge the model has) → condensed to one dense line; confidence≥80 + severity-rubric pointer + `reviewFocus` consumption + verify-then-report + typed GateFindingShape output KEPT | agents/code-reviewer.md |
| ux-designer generic UX prose + full craft-bar restatement | relocated | the craft self-check stays in skills/plan-arc/references/ux-craft.md (agent reads it); the design-first role + honest-states + artifact-form decision + the interactions-are-CONTRACT rule KEPT |
| software-developer / test-engineer generic craft prose | obsolete-with-evidence(generic dev/test knowledge the model has) → condensed; config bindings (gateCommands/testConventions/designHomes) + the roadmap-specific rules KEPT |
| `## Design homes` / `## Gate commands` / `## Test conventions` / `## Validation tiers` / `## Model policy` anchors across all 7 cards | enforced-by-code(re-pointed to designHomes/gateCommands/testConventions/validationTiers/modelPolicy.judgeModel config keys) | cli/lib/config.mjs |
| executor-reference.md + phase-executor.md | (1658.5 state VERIFIED — no re-trim) | 4,086 ≤4,096 (long-run protocol intact, zero "Full do-phase inheritance") + 3,070; both ≤5,000 per-card |

## do-phase/SKILL.md — phase 2015.2 (diet-funded)

The durable-lesson trigger line (`roadmap eval lesson`) was funded byte-for-byte inside the same
measured flow rather than granted new budget. **Measured:** do-phase/SKILL.md **8,545 B → 8,547 B**
(`git show f778fee^:…/skills/do-phase/SKILL.md | wc -c` vs `f778fee:…`); the do-arc flow
**12,499 tokens / 49,984 B** (`roadmap measure --flow do-arc --json`) against the enforced
`--assert 12500` (cli/commands/measure.test.mjs:147, which exits 0). Five passages paid for the line
— one row each.

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| Step 3 Commit — the formatter clause naming the two gate checks ("the gate's diff-scoped lint + history-comments checks catch what slips") | enforced-by-code(cli/lib/slots.mjs `historyCommentFindings` :187 + the `lint-diff` slot binding; run by `roadmap gate run`) | both named checks exist and run at the gate; the surviving prose keeps the operative half — run the formatter's `--write` twin on the task's touched files before committing |
| §Codex delegation lane — the entrypoint-invariants paragraph, incl. the dropped "sandbox-bypassed direct CLI" invariant, "the committed entrypoint", and the per-phase division-of-labor narration | enforced-by-code(the codex entry in cli/lib/drivers.mjs owns bin + argv + sandboxPosture, `launch()` in cli/commands/codex.mjs spawns from it, and the ratchet in cli/lib/drivers.test.mjs fails on any model-specific argv elsewhere under cli/) | the invariant IS the launch argv, which the CLI lane owns; the skill keeps "never hand-roll the launch", the 2026-07-22 user ruling, the full per-phase list, and "Codex never merges/pushes and never touches the primary checkout" |
| §Design-parity stage — "the canonical" qualifier before the parity-rubric path, and the `agent: 'design-parity'` field spelling in the `gateRounds` citation | relocated | the ONE canonical home is already ledgered (§agent cards — 7 judgment cards, 1659.7) and the skill still cites `skills/validate-arc/references/parity-rubric.md` by path, so the adjective restated a ledgered fact; the recorded value survives in the shortened citation |
| §Echo contract — "the full report stays in the transcript" | obsolete-with-evidence(a synchronously spawned gate agent's full report is in the transcript by construction — the clause described how the transcript works, not a rule an executor can break) | the operative half is untouched: the ~10-line per-stage echo plus the `[Quality pass] nothing to fix` empty wording |
| §Arc-mode — the `driver` fill sentence ("fill `driver` = your own model id + lane `session`") and "the **do-arc** workflow serializes those" | enforced-by-code(PhaseExecutionResultShape.`driver` is the parse boundary for the model/lane pair — templates/schema.ts:270; the grooming/emit/push tail is serializeSharedMutation — workflows/arc-plane.workflow.mjs:137) | the skill keeps the required field and both lane values (`session` / `codex`) and the SKIP list; only the imperative verb and the workflow's proper name were cut |

## do-phase/SKILL.md — phase 2094.1 (diet-funded)

The mode-agnostic `executionResult`/`driver` completion prose (phase 2094.1) was funded inside the
measured flow: the addition tipped the do-arc load to 12,532 tokens against the enforced
`--assert 12500`, and five compressions paid it back. **Measured:** do-phase/SKILL.md
**8,678 B → 8,371 B** (`git show 27b35a3^:…/skills/do-phase/SKILL.md | wc -c` vs the tree); the
do-arc flow **12,455 tokens / 49,808 B** (`roadmap measure --flow do-arc --json`), exits 0.

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| Step 0 — the phase-start parenthetical's long form "the atomic flip + move-commit + executor-start beacon; idempotent if already in-progress" | obsolete-with-evidence(pure wording compression — all three named mechanisms plus idempotency survive as "atomic flip + move-commit + beacon; idempotent") | the operative rule (CLI flip, never a hand edit of the status field) is untouched |
| Per-task loop 2 — "the executor-reference long-run protocol governs only genuinely long runs" | relocated | the long-run protocol's one home is agents/references/executor-reference.md (already ledgered, §agent cards); the pointer survives as "the long-run protocol covers genuinely long runs" |
| Per-task loop 3 Commit — the formatter rationale clause "the gate's diff-scoped checks catch what slips, but hygiene that never reaches it is cheaper" | enforced-by-code(the `lint-diff` slot binding + `historyCommentFindings` — cli/lib/slots.mjs — run at `roadmap gate run` regardless of the executor's hygiene) | the imperative half survives verbatim: run the formatter's `--write` twin on the task's touched files first; only the why-clause (restating what the gate already enforces) was cut |
| The gate — "— recording is not optional" | obsolete-with-evidence(restated the REFUSES clause of the same sentence; the enforcement is gate.mjs --verify-complete's refusal of a done flip with no recorded agent round, tested in cli/commands/gate.test.mjs) | the REFUSES sentence survives |
| §Codex delegation lane — "classify the visible command line" → "classify argv"; "prompt via stdin so argv stays free of test keywords" → "prompt via stdin"; "a `.building/codex-*.json` journal refusing a double-run" → "a double-run-refusing `.building/codex-*.json` journal" | enforced-by-code(cli/commands/codex.mjs owns the launch argv and the journal — the same evidence as the 2015.2 entrypoint-invariants row above) | every invariant is still named; only connective prose was cut |

## arc-sweep/SKILL.md — phase 2094.4 (diet-funded)

The Step-2 supersession check (phase 2094.4) was funded in-file. **Measured:** the do-arc flow
after the addition + both trims stays within the enforced budget (`roadmap measure --flow do-arc
--assert 12500` exits 0; figure recorded in the phase 2094 transparency report).

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| §When vs release-sweep — "Same persistence target (`debtResolutions[]`)." | obsolete-with-evidence(duplicate of the paragraph directly above it — "reuses release-sweep's debt-disposition vocabulary and `debtResolutions[]` persistence verbatim" — and of the Step-1 table column header) | both surviving statements name the same target |
| Step 2 intro — the forked-seam examples parenthetical "(3 hardcodes that should be 1 config; a shared type two phases redefined)" | obsolete-with-evidence(pedagogical examples of a concept the sentence itself defines; generic reviewer knowledge the judge model has) | the rule survives in full: a per-phase gate cannot catch a cross-phase forked seam, the whole-arc view is this step's job |
| §When vs release-sweep — the gloss "(the 8-agent pre-prod audit)" after `full-code-review` | obsolete-with-evidence(`full-code-review` is a named skill whose own card states its 8-agent scope; the gloss restated another skill's description) | the contrast survives: "NOT `full-code-review` — a lighter, seam-specific architect pass" |
| §No summary file — the opener "Like release-sweep, " | obsolete-with-evidence(the reuse-release-sweep framing is already stated twice above — the read-FIRST paragraph and Step 1's vocabulary rule) | the operative rule (never a persisted summary) survives verbatim |

## templates/schema.ts + the vendored lib/roadmap/schema.ts — the v10 drift marker (EVALLOOP sweep)

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| `// @zeroh-roadmap-schema v10` + its four-line bump-discipline comment ("bump this marker whenever the canonical schema gains a feature… the SessionStart drift check greps for this exact line") | obsolete-with-evidence(the named reader is retired — §using-zeroh-roadmap/SKILL.md already records "no SessionStart hook exists to replace the grep", and a repo-wide grep for a marker reader across cli/, hooks/, skills/ and scripts/schema.test.ts returns zero; the line asserted an enforcement that no longer exists, which is the one thing a marker must never do) | deleted in BOTH homes (plugin templates/schema.ts + consumer lib/roadmap/schema.ts) so the vendor pair stays byte-comparable; the v10 migration notes it introduced are untouched, and the whitespace-normalized vendor diff after the deletion is documented-deltas-only (the `governed-spine-reviewer` enum member, the home-specific doc comments, formatter line wrapping) |
</content>

## plan-phase/SKILL.md + plan-arc/SKILL.md — phase 2420 (diet-funded)

The step-contract rule + interfaces pointer (plan-phase), the Lane B band + band-skipped report
grammar (plan-arc Step 3/4 + arc-integrity §4/§5), and the one-home rationale + execution-prompt
authoring restoration (plan-arc Step 1/2b/4) were funded byte-for-byte in their own files.
**Measured (`wc -c`):** plan-phase/SKILL.md **14,491 → 14,447 B**; plan-arc/SKILL.md
**13,561 → 13,529 B** (net negative after ~1,000 B of additions); arc-integrity.md 9,636 → 9,919 B
(a reference file, loaded on demand — outside the measured flow set). The plan-arc flow re-measure
is recorded below.

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| plan-phase Step 1 — wx/EEXIST claim-lock mechanics | enforced-by-code(cli/commands/claim.mjs owns the atomic claim) | the skill keeps intent + never-hand-compute |
| plan-phase PRIME RULE 2 tail + Step 0 wrong-seam parenthetical + probe-vocabulary tail + timing tail + granularity/kind/assumptions wording | obsolete-with-evidence(pure wording compression — every named rule, threshold, and example survives) | the operative rules are untouched |
| plan-phase Step 3 — userFacing paraphrase-drift story | relocated | compressed to "a paraphrase once shipped a polarity drift" — the rule (cite, never restate) survives verbatim |
| plan-phase Step 3 — the second verify example "(or … dashboard shows $48)" | obsolete-with-evidence(the grammar sentence already names "command or observable"; one example carries the format) | the primary example survives |
| plan-phase Step 4 — size-lint ownership provenance + "When in doubt, split the task instead of reaching for batchMode" | relocated | the rule lives in the PhaseTaskShape docblock the passage itself cites (templates/schema.ts: "When in doubt, split the task instead.") |
| plan-phase Release-coupled — hold[] rationale long form | relocated | compressed; the hold[]-not-prose rule + never-a-guard clause survive |
| plan-arc intro + Trigger + Step 1 opener + Step 1b mirror clause + ux sub-gate + binding-language + validate-paste + reframe + Step 1c/2a/2b compressions | obsolete-with-evidence(wording compression funding the band + one-home additions — every gate, pause, floor, and refusal survives; the schema-enforcement citation compressed to its mechanism) | plan-arc SKILL.md at 13,529 B carries all operative rules |
| plan-arc Step 1 — "Size the phase count": the restated 5-8 tasks/phase target | relocated | the compressed sentence cites plan-phase "Phase granularity" by name, which carries `target 5-8 tasks` verbatim + "gate cost is per-phase: gate chain, executor spawn, serialization tail, so don't shard" |
| plan-arc Step 1 — "Size the phase count": the "v1 arcs run sequentially, so phase count tracks wall-clock" rationale clause | obsolete-with-evidence(rationale restating what plan-phase's surviving per-phase-cost parenthetical already carries; the operative sizing rule + timing-stats citation survive in the compressed sentence) | plan-arc Step 1 + plan-phase "Phase granularity" |
| plan-arc Step 1 — LOCKED DECISIONS convention example (VOICE.arc.ts) + rationale-in-comment posture | relocated | superseded by the one-home rule: rulings are one-line + dated in the comment; narrative rationale lives in roadmap/arc-prompts/<id>-execution-prompt.md (authored at Step 4, read by do-arc:155) |
| plan-arc Step 1 — user-ruling consequence example | obsolete-with-evidence(the rule + one-recorded-line clause survive; the example restated them) | Step 1 "A user ruling is law" |

**Phase 2420 measured close-out (2026-08-22):** `roadmap measure --flow plan-arc` **16,154 tokens
/ 64,611 B** vs the 16,173 plan-time baseline (net shrink after all additions). HONEST FLAG: the
do-arc flow measures **14,535 tokens against the enforced 12,500** — a standing overage from the
gauntlet v0.30.0 installs (the blind-trial winners for do-arc/do-phase/using-zeroh-roadmap replaced
smaller dieted texts; measure.test.mjs deliberately carries no real-tree assertion [CORRECTED 2026-08-22, see the phase-2422 gate R1 metering paragraph below: the assertion exists at measure.test.mjs:146]). Pre-existing,
untouched by 2420 (which only shrank its two files); surfaced for the next diet lane / re-ratchet
ruling rather than papered over.

## release-sweep/SKILL.md — phase 2422 (diet-funded)

The followup triage gate was funded by same-file compression; the phase close-out records the final
do-arc measurement after arc-sweep also lands.

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| selector explanations and estate-scale narration | obsolete-with-evidence(pure wording compression; every selector, archive destination, prompt rule, bulk command, and ratchet survives) | release-sweep invocation list + estate-scale callout |
| Edge cases + scope narration | obsolete-with-evidence(pure wording compression; every operative edge case and exclusion survives) | release-sweep §Edge cases + scope |
| arc-sweep intro, hand-in, and no-summary narration | obsolete-with-evidence(pure wording compression funding the followup birth contract; integration authority, fallback inputs, truncation refusal, persistence homes, and content boundary survive) | arc-sweep intro + Step 1 hand-in + No summary file |

**Phase 2422 gate R1 metering correction (2026-08-22):** the followup-contract.md reference is a
genuinely NEW conditional load in the do-arc flow (arc-sweep births + release-sweep Step 2.5 read
it) and was missing from the manifest — the no-growth assert was passing over unmetered load.
Row added; the flow now measures honestly at **14,917 tokens / 59,656 B** (skill BODIES stayed
net-negative under 2422's diet; the +433-token reference is named growth, never hidden). The
whole 12,500 recovery remains the diet lane's, per the phase-2420 flag. Correction of a 2420
close-out line: measure.test.mjs DOES carry the real-tree 12,500 assertion (cli/commands/measure.test.mjs:146, the PROTOCOL_LOAD_BUDGET_TOKENS assert) — it is the standing red, not an absent test.

## Phase 1 task 1.4 — the operative-rules-only diet + measured rebaseline (2026-08-24)

Operator ruling of 2026-08-24 (header, above). **Every diff in this pass is a DELETION or a MOVE —
no operative rule was reworded**, because a rewrite risks degrading a protocol the reviewer cannot
re-derive. `roadmap measure --flow do-arc` before **14,917 tokens / 59,656 B**, after **13,257
tokens / 53,018 B** (−1,660 tokens, −6,638 B, −11.1%), and `PROTOCOL_LOAD_BUDGET_TOKENS` is
re-ratcheted to that post-diet measured total — zero growth from here.

**One row per dieted file (before → after tokens):**

| file | tokens | disposition | evidence |
|---|---:|---|---|
| skills/do-arc/SKILL.md | 2,840 → 2,606 | obsolete-with-evidence(dated incident + justification prose; every operative rule survives verbatim) | rows below |
| skills/do-phase/SKILL.md | 3,329 → 3,051 | obsolete-with-evidence(dated attribution + mechanism narration; every operative rule survives verbatim) | rows below |
| skills/arc-sweep/SKILL.md | 2,595 → 2,229 | obsolete-with-evidence(self-duplicating disposition prose + a dated release incident) | rows below |
| skills/validate-arc/SKILL.md | 2,161 → 1,875 | obsolete-with-evidence(framing + justification parentheticals; every judge/panel/bound rule survives) | rows below |
| skills/release-sweep/SKILL.md | 1,819 → 1,697 | obsolete-with-evidence(prose restating the file's own bash comments + rationale clauses) | rows below |
| skills/using-zeroh-roadmap/SKILL.md | 945 → 852 | obsolete-with-evidence(honor-system asides + a dated provenance paragraph) | rows below |
| skills/validate-arc/references/driving-tiers.md | 795 → 569 | relocated | DESIGN-NOTES.md §driving-tiers — worked example (azure_private_agent) |
| skills/release-sweep/references/followup-contract.md | 433 → 378 | obsolete-with-evidence(restatement of the release-sweep gate it is a reference for) | rows below |

**Per-passage rows.**

### skills/do-arc/SKILL.md

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| intro — "(it is the loop's tested LIBRARY form … a sandboxed workflow engine cannot host its imports)" | relocated | DESIGN-NOTES.md §2026-07-17 — the per-plane workflow is a LIBRARY, not a hosted workflow script |
| Run it 2.3 — the `--executor-id` exclusivity rationale ("one session spawns many executors …") | obsolete-with-evidence(the operative rule "`--executor-id` is what makes the arm EXCLUSIVE" survives; the CLI refuses an unbound arm) | cli/commands/executor-arm path, do-arc §Run it |
| Run it 2.3 — "(every daemon instance to date was reaped by a session event before its arc finished)" | obsolete-with-evidence(archeology; "never a long-lived background `watch` daemon" survives as the rule) | do-arc §Run it |
| Run it 2.4 — the 2026-08-17 two-executors-on-one-tree incident | obsolete-with-evidence(dated incident; "`--force` … only after READING that evidence, never on a STALLED verdict alone" survives) | DESIGN-NOTES.md §Liveness observes the EXECUTOR (2026-08-18 incident) |
| Run it — "Position re-derives from disk on every `arc next` … a completed phase never re-runs" | obsolete-with-evidence(verbatim duplicate of §Pause & resume, which owns the fact) | do-arc §Pause & resume |
| halts/checkpoint — "No SendMessage negotiation, no judgment call: the wake is owned by this contract" + "(a progress ratchet, not a leash)" | obsolete-with-evidence(restates "respawn … UNCONDITIONALLY" and the stated three-checkpoint bound) | do-arc §The loop's non-done exits |
| halts/stalled — "(resume is free — re-derivation from disk makes a respawn lossless)" | obsolete-with-evidence(duplicate of §Pause & resume) | do-arc §Pause & resume |
| halts/unobserved — "(whose own mtime is not the transcript's)" | obsolete-with-evidence(rationale; "never `ls` on a tasks symlink" survives as the rule) | do-arc §The loop's non-done exits |
| land — "so a piped stdout can never mask the outcome" | obsolete-with-evidence(rationale; "never trust a pipeline's exit code over that line" survives) | do-arc §Terminal handoffs |

### skills/do-phase/SKILL.md

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| per-task loop 2 — "(a session event kills the Monitor's wake silently…)" | obsolete-with-evidence(archeology; the FOREGROUND rule and the long-run pointer survive) | do-phase §The per-task loop |
| Commit grammar — "Task-commit prose is working material: … never squash fodder" | obsolete-with-evidence(narrates what §Curate the landed history already governs) | do-phase §Curate the landed history |
| Curate — "(that order is BINDING: `docs(roadmap): mark phase N complete` carries no `—` boundary …)" | obsolete-with-evidence(rationale; "(that order is BINDING)" survives) | cli/commands/phase.mjs curate |
| Curate — ", so nothing the review relied on goes unreachable" | obsolete-with-evidence(rationale for CLI behaviour the sentence already states) | cli/commands/phase.mjs curate |
| Curate — "In the worktree lane a refusal cannot fire (…) — one on a primary-checkout phase means siblings shared the range" | obsolete-with-evidence(explanation of a case the stated rule already handles identically) | do-phase §Curate the landed history |
| Codex lane — "(the shared-host hook and reaper classify argv; the entrypoint carries the invariants: …)" | enforced-by-code(`roadmap codex run` owns every invariant listed; the rule "never hand-roll the launch" survives) | cli/commands/codex.mjs |
| Codex lane — "(user ruling 2026-07-22)" attribution | obsolete-with-evidence(dated attribution belongs to git history; the division of labor survives verbatim) | git log |
| Codex lane — the merge-in-the-wrong-checkout diagnosis ("Already up to date" tell, `cd`-reset cause) | obsolete-with-evidence(archeology; "run … FROM THE PRIMARY checkout" and the silent no-op survive) | do-phase §Codex delegation lane |

### skills/arc-sweep/SKILL.md

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| intro — "**When vs release-sweep:** arc-sweep runs pre-merge on an unversioned arc; release-sweep runs pre-archive on versioned phases." | obsolete-with-evidence(duplicate of the file's own "Not this skill" line four lines above; the full-code-review disambiguation survives) | arc-sweep §intro |
| Step 1 — the whole **ACCEPT** bullet | obsolete-with-evidence(verbatim restatement of the disposition table's ACCEPT rows, including the ≥20-char reason) | arc-sweep §Step 1 table |
| Step 1 — the OPERATOR-PENDING bullet's `{ status, via }` restatement, and "`ref`/`status`/`via`/`date` … do not redefine them" | obsolete-with-evidence(the table row carries the shape; "never a parallel taxonomy" is already the file's opening rule) | arc-sweep §Step 1 table + intro |
| Step 2 — "A per-phase gate sees only its own diff … that is this step's whole job." | obsolete-with-evidence(pure justification; the operative instruction follows immediately) | arc-sweep §Step 2 |
| Step 2.5 — the v0.36.0 three-CI-round + FRONTDOOR five-ratchet incidents and the "right altitude" argument | obsolete-with-evidence(dated incidents; "Once per arc, here" survives as the step's own placement) | git log |
| Step 2.5 — the estate scope enumeration and "(ratchet fixes are mechanical: …)" | obsolete-with-evidence(the consumer's `gateCommands.ratchets` binding defines the scope; RESOLVE-NOW-as-default survives) | arc-sweep §Step 2.5 |
| EOF — a stray `</content>` tag | obsolete-with-evidence(an authoring artifact, never protocol) | arc-sweep EOF |

### skills/validate-arc/SKILL.md

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| intro — "The per-phase gate proves the code correct; `arc-sweep` proves the arc coheres. Neither drives the shipped product …" | obsolete-with-evidence(framing; the operative "resolve criteria → drive → fresh independent judge → PASS/GAPS" survives) | validate-arc §intro |
| intro — the Step-5 pipeline restatement, and the "on GAPS, Step 5 takes over" pointer | obsolete-with-evidence(Step 5 owns the pipeline verbatim; Step 4 already closes with "On GAPS, Step 5 takes over") | validate-arc §Step 4 + §Step 5 |
| Step 0.2 — the drifted-arc explanation and the criteria-immutability consequence clause | obsolete-with-evidence(rationale; "Run step 3 FIRST" and "immutable post-planning (the validator enforces it)" survive) | validate-arc §Step 0 |
| Step 0.3 — "Not circular: the artifact was USER-CONFIRMED at the design gate …" | obsolete-with-evidence(justification for a derivation the step already sanctions) | validate-arc §Step 0 |
| Step 3 — "(the safe read-mostly fan-out `plan-arc` Step 3 uses)" and "This is the independent-judge singleSeam." | obsolete-with-evidence(justification + restatement; the spawn rule and edit-confinement/independence invariants survive) | validate-arc §Step 3 |
| Step 3 — the two-judge and split-verdict rationale parentheticals | obsolete-with-evidence(the panel rule and "split verdict is a GAP carrying BOTH verdicts (fail-visible — the user arbitrates)" survive) | validate-arc §Step 3 |
| Step 5 — "(user ruling 2026-07-18)" and "(the singleSeam)" | obsolete-with-evidence(dated attribution + label; the autonomous/hold rule and the no-parallel-executor rule survive) | git log |
| Step 5.3 — "A bound, not a guarantee: … the backstop is two-layered (…)" | obsolete-with-evidence(justification; "Widen if a phase's blast radius plausibly reaches other criteria" survives as the operative instruction) | validate-arc §Step 5 |

### skills/release-sweep/SKILL.md

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| PRIME RULE — "Once a phase is in `roadmap/archive/<version>/` the operator commits to never revisiting its open debts, so" | obsolete-with-evidence(rationale; "**Archive DOES gate**" + the full open-debt definition survive) | release-sweep §PRIME RULE |
| Step 5 — "The skip-if-already-archived guard makes `--archive` re-runnable (…); a both-paths-exist conflict is fatal …" | obsolete-with-evidence(restates the two inline comments in the bash block directly above it) | release-sweep §Step 5 bash block |
| Step 5 — "transparency reports + `debtResolutions` are preserved on the archived files (…)" | obsolete-with-evidence(describes `git mv` semantics; no action depends on it) | release-sweep §Step 5 |
| No summary file — the audit-trail justification | obsolete-with-evidence(the operative prohibition survives: never write `reviews/<version>-debt-sweep.md`) | release-sweep §No summary file |
| EOF — a stray `</content>` tag | obsolete-with-evidence(an authoring artifact, never protocol) | release-sweep EOF |

### skills/using-zeroh-roadmap/SKILL.md

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| intro + routing — the two "(honor-system: no hook blocks this …)" asides | obsolete-with-evidence(both rules survive as stated prohibitions; naming the absence of a hook changes no action) | using-zeroh-roadmap §intro |
| routing table — "(skill retired 2026-08-14, no outcome delta)" | obsolete-with-evidence(dated archeology; the route to the `code-reviewer` agent survives) | git log |
| EOF — the "Provenance: … 16 ArcEvalReports (2026-07-19 → 2026-08-12)" paragraph | obsolete-with-evidence(dated provenance, not a rule; the reports are on disk in the consumer) | roadmap/arc-evals/ |

### skills/validate-arc/references/driving-tiers.md

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| intro — "The plugin hardcodes no consumer command." | obsolete-with-evidence(restates the preceding clause: each consumer binds each tier in its own `roadmap.config.json`) | driving-tiers §intro |
| §Worked example — `azure_private_agent` (the whole section) | relocated | DESIGN-NOTES.md §driving-tiers — worked example (azure_private_agent); the reference keeps a pointer + the "the judge reads whichever bindings the consumer documents" rule |

### skills/release-sweep/references/followup-contract.md

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| Frontmatter grammar — "so lifecycle tooling fails open and the operator can disposition the file" | obsolete-with-evidence(rationale; "Unknown or malformed frontmatter is reported as UNTRIAGED" survives) | followup-contract §Frontmatter grammar |
| Release-sweep dispositions — "this contract adds no new decision vocabulary" | obsolete-with-evidence(restates "one existing release-sweep disposition" in the same sentence) | followup-contract §Release-sweep dispositions |
| EOF — "Disposition completes triage; it does not require building a promoted phase during release-sweep." | obsolete-with-evidence(duplicate of release-sweep Step 2.5's "This gates disposition only, never completion of promoted work") | release-sweep §Step 2.5 |

**Two non-model-loaded corrections rode this pass** (no ledger rows owed — neither file is in the
measured set, both were stale claims about the budget itself): `cli/measure-manifest.json`'s printed
note still claimed a "≤12k-token budget", and `cli/lib/measure-budget.mjs`'s docblock carried the
three-disagreeing-homes history — replaced by the one-line semantic plus the dated ruling. The
budget-coupled proposal fixtures (`cli/testdata/eval-proposals/{ALPHA,BRAVO,CHARLIE,DELTA}`) were
re-based by the same +757 delta so every boundary property they encode (one report EXACTLY at
budget, two prod-grade + one fast-lane OVER) is preserved, and `eval-propose.test.mjs` test 16 now
derives its corpus from `PROTOCOL_LOAD_BUDGET_TOKENS` instead of a literal 12,500 — the next
re-ratchet cannot silently re-point that arithmetic.

## do-arc/SKILL.md — phase 3 task 3.4 (diet-funded)

The spawner-never-asserts-a-model-id prohibition was funded byte-for-byte in its own file, so
`PROTOCOL_LOAD_BUDGET_TOKENS` stays 13257: 10,423 B → 10,404 B, flow total 13,257 → 13,252 tokens
(`roadmap measure --flow do-arc`). `measure` ceils per file, so the funding had to land here.

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| §the loop 2.3 — the preflight parenthetical "(the product repos this phase's keyFiles point into, and the newest declared keyFile age)" | enforced-by-code(`roadmap executor-arm` prints the preflight line; the instruction to READ it and the fresher-than-a-few-minutes decision rule both survive) | do-arc §the loop, spawn step |
| §non-done exits / `self-descope` — " — this is the arc face of the executor's never-rule 1" | obsolete-with-evidence(cross-reference label; "Never wave it through" and both dispositions survive verbatim) | do-arc §the loop, `self-descope` |
| §non-done exits / `checkpoint` — "(the two-exit turn contract)" | obsolete-with-evidence(names the executor card's contract; not an instruction to the do-arc driver) | do-arc §the loop, `checkpoint` |
| §non-done exits / `checkpoint` — "(the lossless precondition is broken)" | obsolete-with-evidence(rationale for the rule stated in the same clause; "A committedSha that does not resolve → treat as failed" survives) | do-arc §the loop, `checkpoint` |

## Model-policy prose → MULTI-DRIVER.md §1 pointers — phase 4 task 4.1

Two prose homes, one role each, became pointers at the single home the role table now backs:
`agents/software-architect.md` 768 B → 501 B, `skills/review-phase/SKILL.md` 1,519 B → 829 B.
Neither file is in the do-arc measured set, so no budget movement is claimed; the reduction is
recorded here because the ledger's rail is about DELETED RULES, not about budgets.

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| software-architect §Model policy — "`fable` is the spawn default: this is the highest-judgment seam… the design-first gate shapes every phase built against it" | obsolete-with-evidence(rationale for a value the table now carries; the frontmatter alias and the chain head are pinned by `cli/lib/roles.test.mjs`) | MULTI-DRIVER.md §1, `cli/lib/roles.mjs` ROLES['software-architect'] |
| software-architect §Model policy — the named fallback ("re-spawn the SAME architect at UNREDUCED rigor on **opus**… Opus also unavailable → report the stage UNJUDGED and STOP") | enforced-by-code(`resolveRole` walks `tierChain` and throws `RoleUnjudgedError` naming every tier tried; `cli/lib/roles.test.mjs` walks fable→sol→opus under injected unavailability) | cli/lib/roles.mjs |
| review-phase Mode A — "JUDGE seams ONLY - Mode A plan reviewers, arc-sweep's architect, validate-arc's panel; never `phase-executor`/`software-developer`/`test-engineer`" | enforced-by-code(`ROLES[*].class`; `resolveRole` applies `judgeModel` to judge-class only and ignores it for builder-class, asserted both directions) | cli/lib/roles.mjs, cli/lib/roles.test.mjs |
| review-phase Mode A — "**UNAVAILABLE judgeModel = fall back, never skip.** Symptom: … ("You've reached your <model> limit", an access refusal, an unknown-model error)" | relocated | MULTI-DRIVER.md §1 The resolver, bullet "A SPAWN that fails on model availability is the fourth trigger" — it carries the symptom list, the re-ask-at-unreduced-rigor response and the ran-but-adverse exclusion |
| review-phase Mode A — the `software-architect` fallback EXCEPTION ("whose frontmatter now equals the judge model and so names its own fallback in its card") | obsolete-with-evidence(the exception existed because the chain lived in a card; every role now resolves through one table) | MULTI-DRIVER.md §1, cli/lib/roles.mjs |

## Handoff routing boundary — phase 5 gate R2 (diet-funded)

The `handoff` dispatch and do-arc boundary were funded inside the measured files: the do-arc
flow moved from 13,256 tokens before phase 5 to 13,253 after the fix, below the 13,257 ceiling
(`roadmap measure --flow do-arc --assert 13257`).

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| do-arc §Pause & resume — "Pause is free — stop anywhere; no state lives in the loop. Resume is always the same act: re-enter the loop." | superseded-with-equivalent(`Pause anywhere; roadmap arc next resumes from disk` preserves the stop/re-entry rule while the command remains the state authority) | do-arc §Pause & resume |
| do-arc §Pause & resume — "optional human notes, never load-bearing" | superseded-with-equivalent(`optional arc-loop notes` plus the handoff boundary assigns both homes; `roadmap arc next resumes from disk` preserves non-load-bearing state) | do-arc §Pause & resume |

## using-zeroh-roadmap/SKILL.md — phase 4 task 4.3 (diet-funded)

The `references/codex-tools.md` pointer (the per-harness tool mapping) was funded in its own file:
3,405 B → 3,422 B, flow total 13,252 → 13,256 tokens against the 13,257 ceiling
(`roadmap measure --flow do-arc`). `measure` ceils per file, so the funding had to land here.

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| §Cross-cutting standards — "Downstream skills cite these same files at their own steps" | obsolete-with-evidence(the instruction that follows — load it yourself when the target skill has not — is the whole rule; the observation about downstream skills changes no reader's action) | using-zeroh-roadmap §Cross-cutting standards |
| §Routing — "your job ends at correct dispatch plus the coordination steps below" | obsolete-with-evidence(compressed to "your job is correct dispatch plus the coordination below"; both clauses survive) | using-zeroh-roadmap §Routing |

## do-phase/SKILL.md — phase 6 task 6.4 (net trim)

Worktree disposal moved from honor-system prose into the done-verbs (`roadmap phase land`,
`roadmap arc land`, `codex status` on a complete review lane). Both cleanup carriers in the
codex-delegation section were the audit's falsified promise; the manual integration sequence they
sat in is now the land verb's own mechanics. do-phase went 12,203 B → 12,181 B, flow total
13,253 → 13,248 tokens (`roadmap measure --flow do-arc`).

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| §Codex delegation lane — "then merge, push, backlog-groom, clean up the worktree" | enforced-by-code(`roadmap phase land` disposes the lane worktree + its merged branch and archives the journal; a refusal is named on stderr with the land still green) | cli/commands/phase.mjs `runLand`/`disposeSource`, cli/lib/worktree.mjs `disposeWorktree`, cli/commands/phase.test.mjs "a landed codex lane is DISPOSED" |
| §Integration routing — "rebase `codex/<N>` onto develop inside the codex worktree, then run `git merge --ff-only codex/<N>` FROM THE PRIMARY checkout — run inside the codex worktree it merges the branch into itself and silently no-ops" | enforced-by-code(the rebase-onto-tip + guarded fast-forward IS `landPhase`; `advanceBase` resolves the checkout holding the base ref, so the self-merge no-op is unwritable) | cli/lib/worktree.mjs `landPhase`/`advanceBase`, cli/commands/phase.test.mjs "a JOURNAL-CONFIRMED codex lane lands whatever executionIsolation says" |
| §Integration routing — "remove the worktree, the `codex/<N>` branch AND the `.building/codex-<N>.json` journal" | superseded-with-equivalent(the journal is now ARCHIVED rather than removed — `codex-<N>.closed.json`, which `codex status` reads as a closed lane; deleting it was the instruction that cost the reader an honest post-land answer) | cli/commands/phase.mjs `archiveJournal`, cli/commands/codex.mjs `findClosedJournal`, cli/commands/codex.test.mjs "an ARCHIVED run journal reports a CLOSED lane" |

## do-phase/SKILL.md — phase 10 (diet-funded)

The `interfaces.consumes` grep-first mirror (phase 10 task 10.7, per-task loop step 1) was funded
in-file. **Measured:** do-phase/SKILL.md **12,266 B → 12,178 B** (`wc -c`); the do-arc flow
**13,247 tokens / 52,978 B** (`roadmap measure --flow do-arc --json`) against the enforced
`--assert 13257` (PROTOCOL_LOAD_BUDGET_TOKENS, unchanged), exits 0.

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| Per-task loop 2 Verify — "a run that executed ZERO tests still exits green, so confirm a nonzero executed-test count before trusting a pass" | obsolete-with-evidence(pure wording compression — both operative elements survive as "a ZERO-tests-executed run exits green, so confirm a nonzero executed count"; deliberately NOT enforced-by-code: `roadmap gate run` counts nothing — runSlot trusts the slot's raw exit code (cli/lib/slots.mjs) and gate.mjs's zero-match guard is slot-NAME matching only, so the rule stays prose-carried) | do-phase §per-task loop step 2 |
| §Curate the landed history — "history staying granular is the honest fallback, " | obsolete-with-evidence(rationale clause per the 2026-08-24 operative-rules-only ruling; the operative rule survives verbatim — foreign-commit refusal recorded in `limitations`, left alone, "NEVER a forced rewrite of someone else's work") | do-phase §Curate the landed history |

## roles.mjs enforcement claim — phase 13.2 correction

The 2026-08-25 rows that deleted the model-policy prose homes justified the deletions with
"resolveRole enforces" — at deletion time that was an OVERSTATEMENT: `cli/lib/roles.mjs` had no
runtime consumer (only its own test; the codex hits are prompt strings), so the walk, the judge
routing, the recorded substitution and the UNJUDGED stop were convention-with-a-test, and the
POLYSEAT validate panel demonstrably ran on the frontmatter fallback (opus) against a configured
judgeModel of fable. **Corrected 2026-08-26 (phase 13.2):** `roadmap role resolve <role>
[--driver <id>] [--json]` is the reachable seam (exit 2 = UNJUDGED), pinned by 11 wired tests;
intent-validator's frontmatter fail-safe now equals the judge tier — one fable tier, no named
fallback, so fable down is honestly UNJUDGED (gate R1 ruling). The deleted prose stays deleted;
its claim is now true.

## do-arc flow reconciliation — phase 13.5 (measured 2026-08-26)

The 2026-08-26 phase-11 gate rounds grew do-phase/SKILL.md 12,178 B → 12,220 B (+42 B, the
terminal-identifier mirror wording) with no ledger row — the budget then sat at exactly
13,257/13,257, zero headroom, one byte from a silent assert breach. **Reconciled by phase 13.5
in one batch:** the two stale `judgeModel` home cites (arc-sweep, validate-arc) shortened to
their true home `MULTI-DRIVER.md §1` (the one-home rule those cites violated), FUNDING the
restored R28 `(honor-system)` tags in using-zeroh-roadmap, the trued pause-arc routing row, and
the do-arc `--executor-id` gloss fix (the session-dir gloss had attached to the executor-id
placeholder — a driver following it would collapse exclusivity back to the session).
**Measured after:** `roadmap measure --flow do-arc` = **13,252 tokens / 52,998 B** against the
unchanged `--assert 13257` (PROTOCOL_LOAD_BUDGET_TOKENS), exit 0 — 5 tokens of headroom
restored. **Re-measured at gate R1 = 13,255**: the `--executor-id` line was rewritten again to
keep the whole invocation in ONE copyable span (a reviewer found the split span read as a
runnable command that omitted the exclusivity flag) — +3 tokens, spent deliberately on a
correctness-of-instruction fix, 2 tokens still spare. Every operative rule survives; no deletion rows owed (edits are cite-corrections and
tag restorations, not content trims).


## using-zeroh-roadmap/SKILL.md — 2026-08-27 (diet-funded, closure audit)

The OPTION-1 documentation half (one coordination bullet: cross-arc lanes ARE the sanctioned
parallel path, one arc per session, gated by `roadmap capacity`) was funded in-file by three
wording compressions, every operative element surviving: the answer-from-status bullet (drops
the ROADMAP.md pointer — the entry doc is one hop away via the board), the mirror bullet
(mirror + CLI-wins survive), and the claim bullet (creation-is-the-lock + across-worktrees
survive). **Measured:** using-zeroh-roadmap 3,478 B → 3,483 B; the do-arc flow **13,256
tokens** against the unchanged `--assert 13257`, exit 0 — 1 token spare.

## Committing agent-card grammar — phase 16 task 16.4 (diet-funded)

The binding subject grammar was funded inside each committing card. **Measured (`wc -c`):**
quality-pass.md **5,545 → 5,542 B**; software-developer.md **2,179 → 2,176 B**;
test-engineer.md **2,877 → 2,859 B**. No card grew, and both developer/test cards remain
below the 5,000 B ceiling. (Gate R0 took one more byte off each card, dropping a stray
colon from the taught task form: `phase N — N.X <what>` is the form do-phase SKILL.md
binds and every landed subject uses.)

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| quality-pass opener — senior-role and one-pass framing | obsolete-with-evidence(pure wording compression; both ordered mandates, one-diff scope, correctness ownership, BUGS NOTED, and never-fix survive) | agents/quality-pass.md opener |
| software-developer §Principles — examples and connective prose | obsolete-with-evidence(pure wording compression; read the call chain, extend patterns, focused/YAGNI scope, contextual canonical errors, never-null catches, and logical-unit commits survive) | agents/software-developer.md §Principles |
| test-engineer §Coverage targets — expanded category wording | obsolete-with-evidence(pure wording compression; the 90% business/money and 80% auth/security/new-code thresholds survive) | agents/test-engineer.md §Coverage targets |
| test-engineer §A good test — worked examples | obsolete-with-evidence(generic examples removed; invariants, regression sensitivity, call arguments, and exact-boundary requirements survive) | agents/test-engineer.md §A good test |

**Gate R0, second quality sweep:** protocol step 5 of quality-pass.md still prescribed
`fix(phase-N): quality pass — <summary>` — the D2 scope-carried class this phase teaches the
gate to WARN about, and the verbatim marketplace-10 subject whose squash its own curation
refused. Corrected to the canonical gate-fix form (round 0 IS the quality pass, per do-phase
SKILL.md). **Measured:** quality-pass.md 5,542 → 5,543 B, still below the 5,545 B it carried
at the phase start.

## cli/commands/codex.mjs run envelope — MINESWEEP phases 15/16/17/18 (ratchet-funded)

Not a skill body, so it sits outside the measured do-arc flow; its governing instrument is the
envelope-overhead ratchet (`cli/lib/roles.test.mjs`, bound 0.235 — deliberately under the 0.2391
of the pre-delivery envelope that PARAPHRASED do-phase). Four phases added lines to this envelope
(the absolute CLI path and commit grammar in 15.3, the independence clause in 17.3) and each paid
for them in the same file. Recorded here because three of the four trimmed the SAME prose
independently, and a reader comparing them needs to know that is convergence, not duplication.
**Measured on the landed tree: 3,835 B envelope / 16,710 B protocol = 0.2295.**

| passage (origin) | disposition | evidence |
|---|---|---|
| the CROSS-REPO tail repeating bullet 1's "stage explicit paths, never push, never merge, never switch branches" | obsolete-with-evidence(verbatim restatement of the bullet directly above it; every rule survives there) | codex.mjs buildPrompt bullet 1 |
| the long-form run-tier substitution clause (`…that substitution is PRE-RATIFIED here and is never an escalation`) | obsolete-with-evidence(wording compression; the substitution, its PRE-RATIFIED status and the never-an-escalation rule all survive in the short form) | codex.mjs SHARED HOST bullet |
| the worktree fence stated twice (intro sentence + bullet 1) | relocated | one statement, in the bullet that owns worktree discipline — the ratchet's own assertions pin both the fence regex and the staging phrase |
| RESUME RULE / COMMIT TRAILER / ATTRIBUTION long forms | obsolete-with-evidence(pure wording compression: `done: true` + commit-in-log, the trailer, and the driver/lane pair all survive verbatim in meaning) | codex.test.mjs asserts each override individually |

## skills/using-zeroh-roadmap/SKILL.md — the Layout rule (phase 23 task 23.5)

Phase 23 makes the roadmap root DISCOVERABLE, which turns every stated path in every skill from a
fact into a guess. The fix is one rule in the always-active router — but the router is inside the
measured `do-arc` flow, whose budget allows zero growth, and the plan's assumed funding ("trim the
router's own restated path list") is worth ~20 tokens against a rule that needs ~85. So the rule
is split the way the standing bar prescribes: the OPERATIVE sentence stays in the router, the
mechanics (candidates, markers, the refusal, the schema seam, scaffolding) decompose into
`references/layout.md`, which is on-demand and outside every measured flow.

**Measured:** `skills/using-zeroh-roadmap/SKILL.md` 871 → 956 tokens (3,483 → 3,823 B).

| passage (origin) | disposition | evidence |
|---|---|---|
| the intro's `A bare repo → roadmap init scaffolds roadmap/ + roadmap.config.json — the ONLY sanctioned initialization path` | relocated | absorbed verbatim in meaning into the Layout rule three lines below, which also carries the `--root` flag the old sentence could not express |
| the routing table's `roadmap/ROADMAP.md` and the coordination board's `roadmap/backlog.ts` as literal paths | enforced-by-code(cli/lib/roadmap-root.mjs + the scan tripwire in cli/lib/roadmap-root.test.mjs) | both are now `<root>/…`; the root they resolve against is what the resolver returns, and no non-test source under cli/ or hooks/ may spell it |
| the layout MECHANICS (candidate order, markers, the ambiguity refusal, the schema seam, `roadmap init --root`) | relocated(`skills/using-zeroh-roadmap/references/layout.md`) | never in a model-loaded body before this phase; written straight into the on-demand reference and cited from the router, the routed-to standards list, README.md and CLAUDE.md |

## Operator ruling 2026-09-02 — re-ratchet 13,257 → 13,339 (phase 23 task 23.5)

**Ruling, verbatim:** "Re-ratchet the budget to 13,339." Option 1 of the 23.5 escalation, and the
software-architect's recommendation. The reasoning it turns on: the router's Layout rule is a
**correctness fix, not accretion** — without it half of consumers (every `docs/roadmap/` layout)
read paths that do not exist there, so the flow is not carrying more protocol, it is carrying
protocol that is now *true*. A one-off, against the section directly above which shows the diet
funding was ~20 tokens against a rule needing ~85. The standing zero-growth bar of 2026-08-24 is
UNCHANGED: from 13,339 the next byte still reds the gate.

**Measured, before → after (`roadmap measure`):**

| flow | before (pre-23.5) | after | delta | assert |
|---|---:|---:|---:|---|
| do-arc | 13,256 | **13,339** | +83 | `--assert 13339` exits 0 (sitting exactly on it, zero headroom) |
| do-phase | 5,990 | **5,989** | −1 | none |
| plan-arc (5 metered files) | 16,335 | 16,452 | +117 | none |
| plan-arc (honest, layout.md metered) | 16,335 | **17,059** | +724 | none |

The budget moves +82 (13,257 → 13,339); the do-arc FLOW moves +83 (13,256 → 13,339), because the
tree sat one token under its ceiling before this phase. Both numbers are real and they are not the
same number.

**The metering gap this pass closes (the phase-2422 error, not repeated).**
`skills/using-zeroh-roadmap/references/layout.md` is cited from `plan-phase`, `plan-arc`,
`review-phase` and `phase-file-contract.md`. Writing a phase file's schema import IS a plan-arc
act, so the reference is a genuine conditional load in that flow and was missing from
`cli/measure-manifest.json`. Row added; **plan-arc now measures honestly at 17,059 tokens /
68,232 B.** plan-arc carries no assert — this is DISCLOSURE, and the alternative (leaving it
unmetered because no gate would have caught it) is exactly what 2422 got wrong.

Observed and NOT acted on, so the next diet lane can: `skills/using-zeroh-roadmap/SKILL.md` is
ALWAYS ACTIVE and therefore loads in a planning session too, yet appears only in the do-arc flow's
file list. Metering it into plan-arc as well would be honest; it is a manifest-scoping decision
this phase's ruling did not cover.

**Repayment, and its limit.** The `<root>/…` cite sentence 23.5 introduced was restated VERBATIM
in four planning files. Folded to one short imperative form (232 B → 164 B, −68 B × 4). It repays
into plan-arc, NOT into do-arc: none of those four files is in the do-arc flow, so no amount of
folding there could have funded the +82 — which is itself part of why the ruling was the right
call rather than a diet.

| passage (origin) | disposition | evidence |
|---|---|---|
| `Paths here are written `<root>/…` on purpose: … so a bare `roadmap/…` is wrong in half the consumers. The rule lives in …` × 4 (plan-arc:12, plan-phase:12, review-phase:12, phase-file-contract:7) | obsolete-with-evidence(wording compression to an imperative; every operative element survives — write `<root>/…`, never a bare `roadmap/…`, the root is DISCOVERED, the rule home, the mechanics home) | the four cite sites, now 164 B each; plan-arc flow 16,503 → 16,452 over the three metered ones |

**Budget-coupled fixtures re-based by +82**, following the 2026-08-24 precedent's shape, so every
boundary property survives: `ALPHA` 13,258 → 13,340 and `BRAVO` 13,957 → 14,039 (the two
prod-grade OVER-budget reports), `CHARLIE` 15,757 → 15,839 (the fast-lane singleton), `DELTA`
13,257 → 13,339 (EXACTLY at budget — the report that must NOT be a finding). `load-fixture.mjs`'s
docblock table and its exactly-at-budget note carry the new numbers; `eval-propose.test.mjs:368`'s
pinned literal is 13,339.
## do-arc model-policy routing — phase 24.4

| Original location + phrase | Disposition | New location |
|---|---|---|
| do-arc Trigger — separate prose for optional band flags | superseded-with-equivalent(compacted into the options sentence while retaining both flags and their force-every-band meaning) | do-arc Trigger |
| do-arc Step 1 — "a lane a sibling already holds" | superseded-with-equivalent("a sibling's lane" preserves the ownership/refusal rule) | do-arc Step 1 |
| do-arc loop Step 3 — expanded executor arm/spawn explanation | superseded-with-equivalent(the compact paragraph retains ordering, exact commands/inputs, session and exclusive-id meanings, refusal scope, attribution reconciliation, preflight interpretation, and liveness handoff) | do-arc loop Step 3 |

## Gate convergence scope and stop rules — phase 25.3

Measured: do-phase skill 12,217 → 12,219 B; do-phase flow 5,989 → 6,014 tokens; do-arc remains
exactly 13,339 tokens (assert passes).

| Original location + phrase | Disposition | New location |
|---|---|---|
| do-phase gate paragraph — expanded kind ladder, round numbering, attribution, verify and arc caveats | superseded-with-equivalent(compacted while preserving every kind, cap, model attribution, done guard, docs-only and arc-scope rule) | do-phase gate paragraph, now also carrying round-brief decisions |
| phase-executor gate paragraph — repeated record-round attribution explanation | superseded-with-equivalent(compacted beside its new round-brief citation) | phase-executor gate paragraph |
