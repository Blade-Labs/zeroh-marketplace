import { definePhase } from '../lib/schema'

/**
 * NATIVEGREEN conformance plane: prove the composed system before documentation advertises it.
 *
 * timing: no reference data for band 7-9×surface:false
 */
export default definePhase({
  phase: 43,
  name: 'Codex usability pilot; broad native comparison deferred',
  plannedBy: { model: 'unverified' },
  status: 'in-progress',
  category: 'test',
  kind: 'hardening',
  source:
    'NATIVEGREEN arc conformance plane; docs/roadmap/arc-prompts/NATIVEGREEN-execution-prompt.md and plugins/zeroh-roadmap/docs/architecture/intent-to-green-pr-design.md.',
  priority: 'HIGH',
  arcId: 'NATIVEGREEN',
  dependsOn: [42],
  conflictsWith: [],
  keyFiles: [
    'docs/roadmap/roadmap.config.json',
    'plugins/zeroh-roadmap/scripts/gauntlet-3.0/run.mjs',
    'plugins/zeroh-roadmap/scripts/gauntlet-3.0/scenarios.mjs',
    "plugins/zeroh-roadmap/scripts/gauntlet-3.0/preflight.mjs",
    'plugins/zeroh-roadmap/scripts/gauntlet-3.0/score.mjs',
    'plugins/zeroh-roadmap/scripts/gauntlet-3.0/report.mjs',
    'plugins/zeroh-roadmap/scripts/gauntlet-3.0/fixtures.mjs',
    'plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs',
    'plugins/zeroh-roadmap/GAUNTLET-3.0.md',
    'plugins/zeroh-roadmap/gauntlet-3.0/results.json',
  ],
  stakeholderDemo:
    'One installed Codex plugin takes a tiny consumer intent through runnable tested output, bounded review, one exact-head green PR and a safe resume.',
  userFacing: false,
  testScope: 'full',
  reviewScope: 'full',
  assumptions: [
    {
      "claim": "Historical gauntlets and the phase41 provider remain available.",
      "verify": "test -f plugins/zeroh-roadmap/GAUNTLET-2026-08.md && test -f plugins/zeroh-roadmap/GAUNTLET-2.0.md && test -f plugins/zeroh-roadmap/cli/lib/providers/github.mjs",
      "onFalse": "ESCALATE"
    },
    {
      "claim": "Prerequisite phases37 through42 are complete before conformance authoring.",
      "verify": "for n in 37 38 39 40 41 42; do grep -Eq \"status:[[:space:]]*['\\\"]done['\\\"]\" docs/roadmap/phases/phase-$n.phase.ts || exit 1; done",
      "onFalse": "ESCALATE"
    }
  ],
  tasks: [
    {
      id: '43.1',
      title: 'Freeze the lifecycle contract, arm matrix, and disqualifying sentinels',
      problem:
        'A full-lifecycle comparison is invalid unless conditions, scenario packets, baselines, exact observed model/driver identities (unknown identity prevents a model-specific claim), authority, and disqualifying failures are frozen before any arm runs.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/scripts/gauntlet-3.0/scenarios.mjs',
          description:
            'Define GAUNTLET_3_CONTRACT and SCENARIOS as a finite table keyed by criterion ID, condition, scenario, fixture SHA and expected disposition, with separate deterministic/live provenance and for three concurrent arcs, independent/stacked/explicit-group branches, twenty lanes, interruption points, causal/owned/unrelated/indeterminate CI, normalization, GC, exact-head green, evaluation, and second resume; Freeze an operator-supplied total native-time/token budget and per-arm timeout in the contract before launch; stop at budget exhaustion with incomplete arms unresolved, resume only after explicit extension. Export four conditions (Claude parent→Claude child, Claude→Codex, Codex→Codex, Codex→Claude) plus matched no-plugin baselines. → verify: node plugins/zeroh-roadmap/scripts/gauntlet-3.0/scenarios.mjs --validate',
        },
        {
          file: "plugins/zeroh-roadmap/scripts/gauntlet-3.0/preflight.mjs",
          description:
            "Implement a mutation-free preflight that requires isolated repository/provider namespaces, exact real Claude and Codex binaries/versions, installed plugin hashes, credentials/capabilities, and explicit external-action authority; unavailable is a refusal, never a simulated pass. → verify: capbuild node --test --test-name-pattern=preflight plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs",
        },
        {
          file: 'plugins/zeroh-roadmap/scripts/gauntlet-3.0/fixtures.mjs',
          description:
            'Implement buildGauntletFixture and assertFixtureIsolation over a supplied seed commit that already contains the complete deterministic estate: all branch variants, three arcs, twenty lane identities, fifty GC identities and six-phase history. Clone the exact SHA into a clean isolated arm checkout; writeRunPacket writes only external scenario/condition/arm IDs and opaque references, never checkout edits or sealed packet bytes. Sealed evaluator data remains outside builder roots and prompts. → verify: capbuild node --test --test-name-pattern=fixture plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs',
          description:
            'Add mutation tests proving omitted no-plugin baselines, shared worktrees, changed base SHA, leaked held-out packets, absent exact-model stamps, and unjudged arms all RED while the frozen matrix GREENs. → verify: capbuild node --test --test-name-pattern=contract plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'The checked matrix names four plugin conditions and matched no-plugin baselines, with exact parent/child driver and model identity recorded rather than inferred.',
        'Scenario coverage explicitly includes three concurrent arcs, twenty lanes, branch strategies, interruption, all CI ownership classes, history normalization, worktree GC, exact-head green PR, evaluation, and idempotent second resume.',
        'Mutation tests demonstrate that isolation, sealed data, required baselines, exact identity, and judge completeness are enforced rather than narrated.',
      ],
      files: [
        'plugins/zeroh-roadmap/scripts/gauntlet-3.0/scenarios.mjs',
        'plugins/zeroh-roadmap/scripts/gauntlet-3.0/preflight.mjs',
        'plugins/zeroh-roadmap/scripts/gauntlet-3.0/fixtures.mjs',
        'plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs',
      ],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-09-08',
      transparencyReport: {"whatWasDone": "Added the frozen four-parent/child-pair plugin/baseline contract, three strategy scenarios, read-only preflight and isolated seed-clone/evaluator checks.", "how": "Independent test engineer wrote RED before production; corrected schema drift against architect signatures. Eight matched conditions retain explicit parent/child requested model IDs and 22 lifecycle criteria. Launch fields remain null until explicit budget, authority, models and exact fixture SHA are supplied. Preflight probes return typed ready/unavailable/refused observations without live receipts. Clones preserve exact clean seed HEAD/tree; external control packets contain opaque IDs only. Evaluator-owned bytes/paths are checked by a bounded local filesystem walk. Real Git tests cover cross-arm identities, changed HEAD/tree, ignored-file and prompt leakage, symlinks, oversized sparse files, and rejection before cloning into an existing target. Configured types run000003 declared-none; task unit run000004 passed11/11 in2549ms. Test-engineer model identity unverified (requested gpt-5.6-sol); supervising implementation identity unverified.", "compromises": "None", "skipped": "None", "hardcoded": "None", "limitations": "Deterministic conformance authoring only: probe observations are injected, model stamps are requested identities, seed fixtures are local Git, and no native model/provider run or performance comparison is claimed. Live attestation belongs to43.4. The evaluator scan refuses above10000 files or64MiB; it does not sample or create a consumer proof service. Full phase gate and independent correctness review remain pending."},
      interfaces: { produces: ['GAUNTLET_3_CONTRACT', 'SCENARIOS', 'GauntletPreflight', 'buildGauntletFixture'], consumes: [] },
    },
    {
      id: '43.2',
      title: 'Compose a resumable four-lane runner over the existing driver and run records',
      problem:
        'Live parent/child runs need one durable launcher that distinguishes unavailable from failed, persists intent before mutation, resumes by stable arm ID, and never converts permission or provider errors into passes.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/scripts/gauntlet-3.0/run.mjs',
          description:
            'Implement runGauntlet3({contract, outputDir, adapters, budget}), runArm(armId), and resumeArm(armId) over phase38 AgentRunHandle and phase41 ArcDelivery; ArmJournal is a small arm-index projection of those records, never a second scheduler/lock/journal engine; persist requested condition, authority, fixture SHA and external-action intent before launch, then append observed driver/model/result receipts with unavailable/failed/unjudged kept terminally distinct. → verify: capbuild node --test --test-name-pattern=runner plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/scripts/gauntlet-3.0/run.mjs',
          description:
            'Use the existing capbuild shared host pool and worker admission, never reserve all currently free RAM per session; add bounded concurrency and interruption injection so twenty lanes preserve one owner/result, a killed parent resumes the same stable run and PR key, and no adapter retries an external mutation without reconciling its prior receipt. → verify: capbuild node --test --test-name-pattern=interruption plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs',
          description:
            'Use fake Claude/Codex/provider adapters to plant limit, auth, sandbox, crash-before-receipt, crash-after-provider-success, duplicate-result, and wrong-model outcomes and assert exact typed dispositions and resume commands. → verify: capbuild node --test --test-name-pattern=permission plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'A second invocation resumes by stable arm IDs and reconciles pending external actions instead of duplicating child runs, branches, pushes, or PRs.',
        'Twenty concurrent fake lanes produce exactly twenty owner claims and twenty terminal results with no duplicate executor or delivery action.',
        'Unavailable, permission-held, failed, and unjudged remain explicit non-pass states with a bounded resume instruction.',
      ],
      files: [
        'plugins/zeroh-roadmap/scripts/gauntlet-3.0/run.mjs',
        'plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs',
      ],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-09-08',
      transparencyReport: {"whatWasDone": "Added immutable 24-arm indexing, derived per-arm allocations, parent-request binding, receipt-derived outcomes, bounded resume, delivery reconciliation and static shared-pool worker dispatch.", "how": "Independent test engineer captured missing-module RED before implementation. Prepared requests use the existing RoleRunRequest validator and launch the requested parent; child policy remains requested intent. The index publishes via existing immutable file owner; actual run/executor/delivery records own lifecycle and action reconciliation. Unknown usage, identity conflict and budget exhaustion prevent new starts; resumed operations use remaining allocation and admission. A real local Git-backed test produced20 canonical executor/run owners and20 terminal records with simulated model output, then replayed identical identities with no new starts/results; four held lanes remained without records. Pending provider state reconciled once through the supplied existing-owner seam, retaining its PR key. Installed hostpool prerequisite4cd9c4f equals reviewed isolated0ed2b34;16 pool,5 lifecycle,6 env and2 real-job checks passed. An opt-in repository-to-installed-pool smoke passed1/1 in7.67s:24 static workers returned unavailable with zero native runs/receipts. Configured final types run000008 declared-none; task unit run000009 passed18 executed checks (one host-only opt-in skip) in10597ms. Test-engineer and supervising model identities remain unverified.", "compromises": "None", "skipped": "None", "hardcoded": "None", "limitations": "This task proves deterministic coordination and actual local record/resource-owner wiring, not a live native comparison. Record-owner stress uses simulated native output and supplied source metadata. Production fresh workers explicitly refuse until43.4 supplies real parent preparation, token enforcement/observed bounded usage and linked delegated-child attestation. No native time/token allowance is inferred. The separate host change enforces shared admission and cgroup timeouts only; it is not a token meter. Full phase gate and independent phase review remain pending."},
      dependsOn: ['43.1'],
      interfaces: { consumes: ['GAUNTLET_3_CONTRACT', 'SCENARIOS', 'buildGauntletFixture'], produces: ['runGauntlet3', 'ArmJournal'] },
    },
    {
      id: '43.3',
      title: 'Score deterministic lifecycle sentinels and blind outcome quality separately',
      problem:
        'Gauntlet 2.0 showed that a uniformly broken adherence ruler can compare arms while reporting false absolute quality; Gauntlet 3 must refuse invalid sentinels and keep deterministic truth separate from judge-owned quality.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/scripts/gauntlet-3.0/score.mjs',
          description:
            'Implement scoreDeterministicSentinels for exact-head checks, stable PR identity, branch strategy, repair classification, bounded review, tree-equivalent normalization, GC identity/recoverability, terminal eval, and idempotent resume; any missing/unreadable sentinel invalidates the arm and yields no absolute score. → verify: capbuild node --test --test-name-pattern=sentinel plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/scripts/gauntlet-3.0/score.mjs',
          description:
            'Implement buildBlindJudgePacket and mergeBlindVerdict so judges see frozen criteria plus anonymized deliverables but no skill, driver, condition, builder reasoning, or prior verdict; require exact judge model and abstain/unjudged handling. → verify: capbuild node --test --test-name-pattern=judge plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs',
          description:
            'Plant stale-SHA green, unrelated-code edit, unsafe GC, cosmetic force-push, omitted eval, leaked condition, missing judge, and fabricated absolute score mutations and require each to fail its named check. → verify: capbuild node --test --test-name-pattern=mutation plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'Every deterministic requirement is a named sentinel with a mutation-red test, and no invalid run contributes an absolute score or a green verdict.',
        'Outcome judges receive anonymized artifacts and frozen evaluation packets only; exact judge identity, confidence, violations, and abstention are persisted.',
        'Plugin-versus-baseline comparisons report paired outcomes and confidence without presenting historical or cross-driver means as concurrent baselines.',
      ],
      files: [
        'plugins/zeroh-roadmap/scripts/gauntlet-3.0/score.mjs',
        'plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs',
      ],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-09-08',
      transparencyReport: {"whatWasDone": "Added deterministic lifecycle scoring, blind packet construction and judge receipt merging, with reciprocal plugin/baseline outcome comparisons.", "how": "Independent test engineer captured missing-module RED. A positive raw-owner fixture exercises all11 sentinels over3 arcs,6 normalization outcomes and50 cleanup cases; one mutation per sentinel plus unrelated Git edits, cosmetic published normalization with recomputed digest, extra replay actions and stale evaluation must invalidate the score. Canonical run history, delivery validators, correction binding, cleanup outcome and delivery summary owners are reused. Blind packets reject identity leakage and omit absolute scores; existing pending stdin digest and terminal receipt bind exact judge inputs/model/session. Paired confidence is the minimum criterion confidence; incomplete/abstained evidence cannot compare. Final configured unit run000013 passed26 executed tests, one explicit host-only opt-in skip, in10837ms; final types run000014 declared-none. Test-engineer identity unverified (requested gpt-5.6-sol); supervising identity unverified.", "compromises": "None", "skipped": "None", "hardcoded": "None", "limitations": "Pure evaluator coverage uses injected canonical-shaped records and scripted raw Git answers; it does not attest real native models, provider actions or cleanup runs. The 50-case scorer fixture has one simulated removal and49 safe holds; broader real ownership coverage remains in existing worktree tests and43.5. Read-only observation collection/current-summary loading and real judge/native provenance belong to43.4\u201343.5. absoluteScore1 is deterministic validity only, not software quality or performance. Full phase gate and independent correctness review remain pending."},
      dependsOn: ['43.2'],
      interfaces: { consumes: ['ArmJournal', 'GAUNTLET_3_CONTRACT'], produces: ['scoreDeterministicSentinels', 'buildBlindJudgePacket'] },
    },
    {
      "id": "43.4",
      "title": "Repair delegated plan-review friction, then prove the Codex path",
      "problem": "The single native pilot exhausted1000 seconds in initialization and plan review without application source or tests. The delegated reviewer performs queue work it cannot apply and discovers its missing validation toolchain after launch.",
      "steps": [
        {
          "file": "plugins/zeroh-roadmap/cli/commands/codex.mjs",
          "description": "Align buildReviewPrompt with delegated report-only Mode A: independent fitness/feasibility/verifier judgment, direct checklist references, no repair or placement probes, existing NOT QUEUED verdict. Follow implementation block1 in arc-prompts/NATIVEGREEN-codex-repair-plan.md. \u2192 verify: rendered prompt preserves independent adverse verdicts and omits delegated queue analysis"
        },
        {
          "file": "plugins/zeroh-roadmap/skills/review-phase/SKILL.md",
          "description": "Define the delegated branch and direct reference ownership without duplicating the authoring protocol; preserve standalone repair/queue and Mode B. Follow documentation-rules.md. \u2192 verify: independent review confirms intent, source, feasibility and testability checks remain required"
        },
        {
          "file": "plugins/zeroh-roadmap/cli/commands/codex.mjs",
          "description": "In reviewCodex validate the exact detached requested checkout before native launch; return a concrete missing-toolchain remedy before launch; the authorized outer session prepares and retries the same worktree. No implicit review install or authority upgrade. Follow block2 for cold/warm/base/carry/dirty/failure handling. \u2192 verify: configured task tests show zero native launches on prerequisite failure and correct requested-base validation"
        },
        {
          "file": "plugins/zeroh-roadmap/cli/commands/codex.test.mjs",
          "description": "Add offline valid review fixtures and regression cases from block2; retain existing deduplication, authority, carry, archive and cleanup coverage. Preserve previously reviewed usage/beacon/schema fixes. \u2192 verify: node plugins/zeroh-roadmap/bin/roadmap.mjs gate run 43 --task 43.4 --slots unit"
        },
        {
          "file": "docs/roadmap/arc-prompts/NATIVEGREEN-codex-repair-plan.md",
          "description": "Obtain one independent candidate review and final mechanical/packaging checks before any new native trial; keep the prior failure and original RED gate. \u2192 verify: candidate review has no unresolved blocking finding and final configured gate is green"
        },
        {
          "file": "docs/roadmap/arc-evals/NATIVEGREEN-codex-usability-reassessment.md",
          "description": "Only after a fresh native allowance and verified disposable GitHub target, execute block3: same tiny intent, runtime cap, runnable tests, independent correctness review, one exact-head green open PR and duplicate-free resume. \u2192 verify: actual pilot outcome satisfies all release criteria or remains explicitly failed/incomplete"
        }
      ],
      "acceptanceCriteria": [
        "One actual Codex session uses the installed candidate in an ordinary consumer and produces a runnable tested result plus one reviewed, open non-draft PR with required checks green on its exact current head.",
        "Resuming preserves the same work and PR without duplicate executor or publication; the operator does not author a session orchestration program or predict hashes.",
        "Native runtime is capped at 20 minutes; known token usage and unknown usage are reported separately. Timeout, repeated failure, unknown executor state or a material review gap prevents a release claim.",
        "Only necessary fixes are included. Read-only feedback from zeroh, viky-agent-2 and atlas is classified and verified without treating their project/auth/host issues as plugin defects. One run supports only the tested Codex path."
      ],
      "files": [
        "plugins/zeroh-roadmap/cli/lib/durable-process-agent-driver.mjs",
        "plugins/zeroh-roadmap/cli/lib/codex-agent-driver.test.mjs",
        "plugins/zeroh-roadmap/cli/lib/beacon.mjs",
        "plugins/zeroh-roadmap/cli/lib/beacon.test.mjs",
        "plugins/zeroh-roadmap/cli/commands/result.mjs",
        "plugins/zeroh-roadmap/cli/commands/result.test.mjs",
        "plugins/zeroh-roadmap/cli/roadmap.config.schema.json",
        "plugins/zeroh-roadmap/cli/lib/config.test.mjs",
        "plugins/zeroh-roadmap/package.json",
        "plugins/zeroh-roadmap/.codex-plugin/plugin.json",
        "plugins/zeroh-roadmap/.claude-plugin/plugin.json",
        "docs/roadmap/arc-evals/NATIVEGREEN-codex-usability-reassessment.md",
        "plugins/zeroh-roadmap/cli/commands/codex.mjs",
        "plugins/zeroh-roadmap/cli/commands/codex.test.mjs",
        "plugins/zeroh-roadmap/skills/review-phase/SKILL.md",
        "docs/roadmap/arc-prompts/NATIVEGREEN-codex-repair-plan.md"
      ],
      "notes": "Owner ratification 2026-09-08: one real Codex end-to-end run, necessary fixes and review. Reuse the previously ratified single-pilot 20-minute native ceiling; no 24-arm budget is required because the matrix is deferred. One targeted correction, one independent review; a HIGH fix gets one bounded re-review. No automatic merge or release. Stop after this task; 43.5\u201343.8 and phases44\u201345 remain deferred and not done. The abandoned uncommitted matrix-preflight extension is preserved under .building/nativegreen-deferred/43.4-matrix-preflight.patch; the native usage fix remains active. Owner2026-09-08 requested review and a repair plan after the timeout; this does not authorize a fresh native budget. Active implementation is the two bounded corrections in docs/roadmap/arc-prompts/NATIVEGREEN-codex-repair-plan.md, followed by review and a separately authorized observation. Existing file count includes retained already-reviewed candidate fixes, not new scope; no batchMode assertion is made. Interview: skipped \u2014 existing owner intent and current arc scope are explicit. Planning hypotheses: CONFIRMED the launcher/protocol prerequisite mismatch and redundant delegated placement work exist in the named owners; NOT TESTED whether their correction brings setup/implementation within budget; REFUTED dependency installation alone as an established dominant cause, because the reviewer continued after its repair. Prior candidate fixes remain uncommitted and must be preserved.",
      "testMode": "tdd",
      "done": false,
      "dependsOn": [
        "43.3"
      ],
      "interfaces": {
        "consumes": [
          "installed Roadmap Codex CLI and session tools"
        ],
        "produces": [
          "single Codex pilot observation"
        ]
      }
    },
    {
      id: '43.5',
      title: 'DEFERRED — Exercise independent, stacked, and grouped delivery through exact-head CI',
      problem:
        'The central product claim is not proven by phase-only execution; real isolated provider runs must traverse planning, execution, halts, sweep, validation, normalization, PR delivery, CI repair, evaluation, and resume for each branch policy.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/gauntlet-3.0/results.json',
          description:
            'Run the four plugin conditions and matched baselines against the three isolated branch-strategy fixtures, inject interruption before and after PR creation, and record stable run/branch/PR IDs, raw provider receipts, terminal state, and exact head SHA without secrets. → verify: node plugins/zeroh-roadmap/scripts/gauntlet-3.0/run.mjs --verify-results plugins/zeroh-roadmap/gauntlet-3.0/results.json',
        },
        {
          file: 'plugins/zeroh-roadmap/gauntlet-3.0/results.json',
          description:
            'For each plugin arm exercise blocked/stalled/unobserved/exited, review exhaustion, validation gaps with one bounded small correction pass and separately a larger planned correction, then causal, owned-preexisting, unrelated, infrastructure/flaky, indeterminate, auth, quota, timeout and repeated-fingerprint CI outcomes before exact-head green. → verify: node plugins/zeroh-roadmap/scripts/gauntlet-3.0/score.mjs --assert-lifecycle plugins/zeroh-roadmap/gauntlet-3.0/results.json',
        },
        {
          file: 'plugins/zeroh-roadmap/gauntlet-3.0/results.json',
          description:
            'Record pre-publication one-commit-per-phase tree equality/rescue receipts, green-history no-op, identity-proven GC decisions for fifty lanes, terminal eval, optional policy-authorized merge fixture, and a second resume with zero new external actions. → verify: node plugins/zeroh-roadmap/scripts/gauntlet-3.0/score.mjs --assert-history-gc-idempotency plugins/zeroh-roadmap/gauntlet-3.0/results.json',
        },
      ],
      acceptanceCriteria: [
        'Every plugin condition completes all three branch strategies and records a unique stable PR key, current head SHA, required-check rollup, correction trace, terminal evaluation, and zero-action second resume.',
        'Causal and owned failures use the shipped bounded small-repair route or a planned correction for larger scope; unrelated, indeterminate, infrastructure, auth, quota, timeout, and repeated fingerprints hold without unauthorized source edits.',
        'History normalization is tree-identical and recoverable; no green branch is rewritten for cosmetics; GC removes only identity-matched inactive-twice clean recoverable lanes.',
      ],
      files: ['plugins/zeroh-roadmap/gauntlet-3.0/results.json'],
      testMode: 'none',
      done: false,
      dependsOn: ['43.4'],
      interfaces: { consumes: ['runGauntlet3', 'scoreDeterministicSentinels'], produces: ['Gauntlet 3 live results'] },
    },
    {
      id: "43.6",
      title: "DEFERRED — Disqualify negative lifecycle, authority, and provider outcomes",
      problem: "A happy-path live run can hide stale green, unauthorized edits, adapter fallback, or held provider failures unless raw evidence is checked independently.",
      steps: [
        { file: "plugins/zeroh-roadmap/scripts/gauntlet-3.0/verify-live.mjs", description: "Validate raw live receipts for blocked, stalled, unobserved, exited, review-exhausted, gaps, causal, owned-preexisting, unrelated, flaky, indeterminate, auth, quota, timeout, repeated fingerprint, stale head, forbidden edit, and authority-growth outcomes; reject missing raw evidence and synthetic live receipts. → verify: capbuild node --test --test-name-pattern=live-negative plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs" },
        { file: "plugins/zeroh-roadmap/gauntlet-3.0/results.json", description: "Record controlled isolated-provider negative scenarios with before/after repository trees and external-action ledgers; causal and owned repair through the existing bounded correction route, with larger changes planned while all other classes hold with zero unauthorized edits or actions. → verify: node plugins/zeroh-roadmap/scripts/gauntlet-3.0/verify-live.mjs --assert-negatives plugins/zeroh-roadmap/gauntlet-3.0/results.json" },
      ],
      acceptanceCriteria: ["Every negative class has raw causal evidence, exact typed disposition, repository diff, action ledger, and bounded resume or user-decision state.", "Unrelated, indeterminate, infrastructure, auth, quota, timeout, and repeated-fingerprint cases produce zero unauthorized source edits.", "No fake adapter, fabricated provider receipt, missing check, or stale-head green can score as a live pass."],
      files: ["plugins/zeroh-roadmap/scripts/gauntlet-3.0/verify-live.mjs", "plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs", "plugins/zeroh-roadmap/gauntlet-3.0/results.json"],
      testMode: "tdd", done: false, dependsOn: ["43.5"],
      interfaces: { consumes: ["Gauntlet 3 live results", "NativeHostAttestation"], produces: ["live negative-case verdicts"] },
    },
    {
      id: "43.7",
      title: "DEFERRED — Prove semantic parity and paired no-plugin baselines",
      problem: "Four completed arms are not parity evidence unless the same frozen semantic events and outputs are compared, and plugin benefit is not attributable without matched real-parent baselines.",
      steps: [
        { file: "plugins/zeroh-roadmap/scripts/gauntlet-3.0/parity.mjs", description: "Compare canonical transition, authority, delivery, CI, history, cleanup, evaluation, and resume receipts across all four real parent-child conditions after removing declared host provenance only; emit exact mismatch paths and refuse unavailable or unjudged pairs. → verify: capbuild node --test --test-name-pattern=parity plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs" },
        { file: "plugins/zeroh-roadmap/gauntlet-3.0/results.json", description: "Run matched no-plugin baselines through the same real parent binaries, models, fixture SHA, provider namespace class, prompts, limits, and blind judges; pair each condition directly and exclude historical Gauntlet means from concurrent effect claims. → verify: node plugins/zeroh-roadmap/scripts/gauntlet-3.0/parity.mjs --assert-paired plugins/zeroh-roadmap/gauntlet-3.0/results.json" },
      ],
      acceptanceCriteria: ["All four available real-host conditions yield byte-equivalent semantic receipts after only declared provenance fields are normalized.", "Each plugin arm has one matched real-parent no-plugin baseline with identical frozen inputs and an independently complete blind verdict.", "Unavailable, invalid, failed, or unjudged arms prevent a parity/support claim rather than shrinking the denominator."],
      files: ["plugins/zeroh-roadmap/scripts/gauntlet-3.0/parity.mjs", "plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs", "plugins/zeroh-roadmap/gauntlet-3.0/results.json"],
      testMode: "tdd", done: false, dependsOn: ["43.6"],
      interfaces: { consumes: ["live negative-case verdicts", "buildBlindJudgePacket"], produces: ["semantic parity verdict", "paired baseline verdict"] },
    },
    {
      id: '43.8',
      title: 'DEFERRED — Publish a reproducible report with explicit limitations and claim inventory',
      problem:
        'Phase 45 may document only behavior established here, so the evidence needs a machine-readable claim inventory and a human report that distinguishes verified, unavailable, failed, inferred, and untested behavior.',
      steps: [
        { file: 'docs/roadmap/roadmap.config.json', description: "Bind docs/roadmap/roadmap.config.json validationTiers.live-host to capbuild node plugins/zeroh-roadmap/scripts/gauntlet-3.0/run.mjs --validate-arc NATIVEGREEN --json; implement that explicit entrypoint in run.mjs to preflight and drive missing real-host scenarios within the recorded authority/budget, return retained evidence separately from fresh observations, and refuse missing/unavailable conditions. --verify-seal alone cannot count as a new live drive. Preserve wired binding and add a wrong-source/missing-condition binding-negative test. \u2192 verify: node plugins/zeroh-roadmap/bin/roadmap.mjs config check && capbuild node --test --test-name-pattern=binding plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs" },
        {
          file: 'plugins/zeroh-roadmap/scripts/gauntlet-3.0/report.mjs',
          description:
            'Implement buildGauntlet3Report({contract, arms, verdicts}) from frozen contract, existing run records, deterministic scores, blind verdicts, exact versions and checksums; emit a claim inventory whose status vocabulary is verified/unavailable/failed/unjudged/untested and reject unsupported green claims. → verify: capbuild node --test --test-name-pattern=report plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/GAUNTLET-3.0.md',
          description:
            'Generate the method, condition matrix, lifecycle coverage, paired results, judge evidence, interruptions, restores, limitations, exact rerun commands and documentation-safe claim inventory; never expose sealed packets or credentials. → verify: node plugins/zeroh-roadmap/scripts/gauntlet-3.0/report.mjs --check plugins/zeroh-roadmap/GAUNTLET-3.0.md',
        },
        {
          file: 'plugins/zeroh-roadmap/gauntlet-3.0/results.json',
          description:
            'Seal final checksums, versions, condition/arm counts, sentinel verdicts, judge completeness and documentation claim IDs after a clean deterministic replay of the retained run records; do not relaunch successful native arms merely to regenerate a report; any unavailable arm remains unavailable rather than green. → verify: node plugins/zeroh-roadmap/scripts/gauntlet-3.0/report.mjs --verify-seal plugins/zeroh-roadmap/gauntlet-3.0/results.json',
        },
      ],
      acceptanceCriteria: [
        'The report is reproducible from committed, secret-free results and names exact models, drivers, plugin SHA, provider fixtures, condition counts, and checksums.',
        'Every documentation-safe feature claim has a stable claim ID and verified evidence pointer; unavailable, failed, unjudged, inferred, and untested are never collapsed into supported.',
        'A clean deterministic replay passes every sentinel and completes every available blind judgment before the sealed result is written.',
      ],
      files: [
        'docs/roadmap/roadmap.config.json',
        'plugins/zeroh-roadmap/scripts/gauntlet-3.0/run.mjs',
        'plugins/zeroh-roadmap/scripts/gauntlet-3.0/report.mjs',
        'plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs',
        'plugins/zeroh-roadmap/GAUNTLET-3.0.md',
        'plugins/zeroh-roadmap/gauntlet-3.0/results.json',
      ],
      testMode: 'tdd',
      done: false,
      dependsOn: ['43.7'],
      interfaces: { consumes: ['Gauntlet 3 live results', 'semantic parity verdict', 'paired baseline verdict', 'buildBlindJudgePacket'], produces: ['Gauntlet 3 claim inventory', 'GAUNTLET-3.0.md'] },
    },
  ],
  reviewRecord: { date: '2026-09-06', model: 'unverified (requested gpt-5.6-sol)', verdict: 'READY', via: 'executed' },
  notes:
    "Owner scope 2026-09-08 supersedes broad execution: only task43.4 is active. Stop after its commit;43.5\u201343.8 and phases44\u201345 remain deferred and unmet. Completed43.1\u201343.3 retain their original evidence. Historical planning notes below describe the deferred matrix, not current release obligations. " +
    '43.2 prerequisite ruling PROCEED_WITH_FIX: installed capbuild-node-tests owns shared fairness but only accepts test-file/TAP jobs; no general admission.submit API exists. A separate reviewed host-tool change at illumination_VS_setup/scripts/capbuild-node-tests will add bounded argv-manifest jobs to that same owner, with literal argv preserved through capbuild. Host prerequisite candidate0ed2b34 was verified in isolated /tmp/nativegreen-capbuild-jobs, then installed atomically and committed4cd9c4f on the owning host branch; the commit trees are identical. Sixteen pool checks, five real lifecycle probes, six environment checks and two real generic-job checks passed. Independent review found a whole-checkout lock starving generic callers; a real two-caller RED proved it, and the fixed generic mode admits the second caller while the first runs. Test-file mode retains its lock. Installed capability advertises jobs-manifest-v1. No host slice ceilings changed. This solves shared admission and cgroup deadlines only. Native token enforcement or durable bounded observation remains a separate required prerequisite, and no live comparison may start without explicit supplied budget/authority. Reuse existing safe receipt IDs and start/awaitEvent/recover; do not pass a fabricated runId through runPhase, which derives its own. 43.1 architecture ruling PROCEED_WITH_FIX: deterministic contract/preflight/fixture authoring remains separate from execution43.2 and fresh native attestation43.4. The eight-condition by three-strategy template has null budget, authority and fixture SHA; authoring validation permits it, launch validation refuses it. Only explicit supplied limits/authority/exact fixture bytes may freeze a launchable contract; no default native allowance or model identity is inferred. Read-only preflight does not attest a native parent/session or count as a live outcome. The supplied frozen seed already owns the complete fixture estate; per-arm building cannot dirty it. writeRunPacket owns only external control selection, and sealed contents stay evaluator-owned outside all builder roots. A readSealedPackets evaluator port supplies actual bytes and paths for a bounded local file walk (10000 files, 64MiB; overflow refuses, never samples); opaque IDs remain permitted references. Candidate and installed hashes both name corresponding manifest bytes, not different objects; explicit credential denial refuses while missing credentials remain unavailable. Requested model IDs may be null in authoring templates but must be explicit before launch and later compared with actual native receipts. Fixture identities and sealed data remain isolated without a new scheduler, receipt journal or hash service. Resume preflight repair: absence of future modules and presence of defects are historical observations at036b7c5, not runtime prerequisites. The original observation remains in Git; legitimate in-progress work must not be stopped because earlier tasks repaired it. Preflights are cheap; behavior suites belong to task/gate verification. Task43.4 explicitly owns fixed production parent-builder RoleRunRequest preparation from real source/authority records, per-arm token enforcement or durably bounded observation, and linked delegated-child receipt attestation. The indexed request launches the requested PARENT; child routing metadata alone proves no cross-driver condition. Both native drivers and provider authority are still mandatory before live tasks43.4–43.7 via43.1/43.4 preflight; unavailable hosts cannot pass, but do not block prior deterministic authoring. Replan 2026-09-06 against source036b7c5; reuse cli/lib/drivers.mjs launchArgv/driverStamp, gate-report.mjs reports, gate-diagnostics.mjs retryDecision, test/fixture-consumer/harness.mjs, and phase38/41 run/delivery records. Greenfield native collectors are product-specific: borrow raw-output parsing only when compatible, never rerun their prototype matrix or scan all session/log trees. Collect only this run ID and bounded secret-free records. All original four conditions plus baselines, three concurrent arcs, twenty lanes and fifty GC cases remain required; deterministic cases do not substitute for live-host criteria. The harness is development conformance tooling, never a new consumer gate or installed proof service; prior READY is historical and fresh review is required. Author model identity is not externally attested. Future modules and verifies are implementation obligations, not existing passes. Scoped task checks use the shipped capbuild pool; the configured terminal suite remains full. ## Hypotheses — CONFIRMED cause: earlier gauntlets compare partial or potentially invalid evidence and no existing runner exercises the complete real native-parent/provider lifecycle (evidence: only scripts/gauntlet-2.0 exists and GAUNTLET-2026-08.md plus GAUNTLET-2.0.md are reports, not a four-condition live runner). Refuted rival: existing fixture-consumer tests provide reusable deterministic substrate but cannot attest real Claude/Codex/plugin/provider execution. Metadata ratification: userFacing false because this produces internal evidence; testScope full and full review are mandatory for the public truth source. Task 43.5 testMode none is ratified because it records live-host evidence through the validators authored in adjacent TDD tasks rather than adding executable logic; every reducer, validator, provider boundary, and report builder remains TDD. interview: skipped — arc member; NATIVEGREEN.arc.ts and its execution prompt record the user rulings. userFacing false: this phase creates internal conformance infrastructure and evidence, not a consumer runtime feature, so no feature flag applies. `testScope: full` and full review are required because the result is the truth source for later public claims. Gauntlet 1.0 provides stronger blind comparative evidence while 2.0 provides paragraph/load discipline; this phase combines both and adds the missing whole lifecycle. The repository boundary wrapper was invoked before editing but dependency preflight stopped on ERR_PNPM_IGNORED_BUILDS before classification; no restricted-path verdict was emitted. --skip-review: plan unverified, not queued. [FIXED review] Replaced the impossible pre-task Gauntlet preflight assumption with the shipped driver-verification commands; task 43.1 still owns creation of the later provider/isolation preflight.',
})
