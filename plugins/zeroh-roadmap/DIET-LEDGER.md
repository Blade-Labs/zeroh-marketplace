# zeroh-roadmap — Deletion-Disposition Ledger (ROADCODE prose diet)

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

**Measured, never asserted (rail 4).** Size/token claims are `wc -c` and `roadmap measure`
outputs. The measured do-arc protocol load vs the ~49k baseline is recorded here:

> **Baseline (2026-07-15 plugin audit):** do-arc protocol load ≈ 49,000 tokens.
> **Measured (phase 1659.8, `roadmap measure --flow do-arc`):** **8,233 tokens** (32,924 B over 6
> model-loaded files) — an **~83% cut**, well under the budget (`roadmap measure --flow do-arc
> --assert <budget>` exits 0). The budget is **12,500 tokens**, held in ONE place —
> `cli/lib/measure-budget.mjs` `PROTOCOL_LOAD_BUDGET_TOKENS`, read by the measure gate
> (cli/commands/measure.test.mjs) and by the ELICIT pass (cli/lib/eval-propose.mjs); it was
> re-ratcheted from 12,000 by user ruling 2026-07-27 (phase 1995 escalation). The
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
| Check 4 [NEEDS CLARIFICATION] markers | enforced-by-code(cli/commands/audit.mjs check 4 raw file:line + queued→CRITICAL + audit.test.mjs) | MEDIUM/CRITICAL preserved |
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
| §Codex delegation lane — the entrypoint-invariants paragraph, incl. the dropped "sandbox-bypassed direct CLI" invariant, "the committed entrypoint", and the per-phase division-of-labor narration | enforced-by-code(cli/commands/codex.mjs:122 spawns `['exec', '--dangerously-bypass-approvals-and-sandbox', '-C', worktree, '-']`; the module header :12 states the invariant) | the invariant IS the launch argv, which the CLI lane owns; the skill keeps "never hand-roll the launch", the 2026-07-22 user ruling, the full per-phase list, and "Codex never merges/pushes and never touches the primary checkout" |
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
