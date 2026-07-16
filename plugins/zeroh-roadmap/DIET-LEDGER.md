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
> **Measured (phase 1659.8):** _recorded at gate — `roadmap measure --flow do-arc` total._

---

## do-arc/SKILL.md (41,288 B → 4,875 B) — consolidated from 1658

| passage (origin heading/anchor) | disposition | evidence |
|---|---|---|
| :36-50 execution-prompt generation spec | relocated | DESIGN-NOTES.md §do-arc — execution-prompt generation spec (plan-arc owns the generator; thin skill keeps a pointer) |
| :52-79 execution-band thresholds (10/4/3/2) + per-phase classification | enforced-by-code(`roadmap arc next` band + `roadmap gate plan`; classifyBand in cli/lib/ladder.mjs) | thresholds are named constants in ladder.mjs; the workflow's classifyBandRoute routes the band |
| :81-89 arc-level task checklist prose | obsolete-with-evidence(per-plane workflows own phase sequencing — the arc/task-tier ritual is gone) | workflows/arc-plane.workflow.mjs |
| :91-99 build-sidecar registration shape | enforced-by-code(`roadmap arm`/`roadmap disarm`; cli/lib/sidecar.mjs) | arm writes the sidecar + refuses a taken lane |
| :107-209 watchdog liveness verdicts (stalled/exited reads) | enforced-by-code(`roadmap watch` exit 3/4 + hooks/executor-result-guard.mjs) | cli/commands/watch.mjs |
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

---

<!-- Sections below are populated by phase 1659's own trim tasks. -->

## audit-roadmap/SKILL.md (14.7 KB → ≤1,600 B) — phase 1659.2

_populated in 1659.2_

## plan-phase/SKILL.md (25.7 KB → ≤11,000 B) — phase 1659.4

_populated in 1659.4_

## review-phase/SKILL.md (23.2 KB → ≤9,000 B) — phase 1659.4

_populated in 1659.4_

## do-phase/references/gate-protocol.md (38.6 KB → DELETED) — phase 1659.5

_populated in 1659.5_

## plan-arc/SKILL.md (17.4 KB → ≤13,000 B) — phase 1659.5

_populated in 1659.5_

## plan-arc/references/design-gate.md (9.5 KB → ≤8,700 B) — phase 1659.5

_populated in 1659.5_

## arc-sweep/SKILL.md (14 KB → ≤9,000 B) — phase 1659.6

_populated in 1659.6_

## release-sweep/SKILL.md (14 KB → ≤9,000 B) — phase 1659.6

_populated in 1659.6_

## validate-arc/SKILL.md (10 KB → ≤7,700 B) — phase 1659.6

_populated in 1659.6_

## full-code-review/SKILL.md (21 KB → ≤19,000 B) — phase 1659.6

_populated in 1659.6_

## agent cards (intent-validator, quality-pass, software-architect, code-reviewer, ux-designer, software-developer, test-engineer) — phase 1659.7

_populated in 1659.7_
</content>
