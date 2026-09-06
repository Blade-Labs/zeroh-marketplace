import { definePhase } from '../../lib/roadmap/schema'

/**
 * NATIVEGREEN conformance plane: prove the composed system before documentation advertises it.
 *
 * timing: no reference data for band 7-9×surface:false
 */
export default definePhase({
  phase: 43,
  name: 'Gauntlet 3 native-parent, cross-driver, and no-plugin lifecycle proof',
  plannedBy: { model: 'gpt-5.6-sol' },
  status: 'backlog',
  category: 'test',
  kind: 'hardening',
  source:
    'NATIVEGREEN arc conformance plane; docs/roadmap/arc-prompts/NATIVEGREEN-execution-prompt.md and plugins/zeroh-roadmap/docs/architecture/intent-to-green-pr-design.md.',
  priority: 'HIGH',
  arcId: 'NATIVEGREEN',
  dependsOn: [42],
  conflictsWith: [],
  keyFiles: [
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
    'A reproducible four-lane Gauntlet drives three realistic arcs from intent through an exact-head green PR and proves interruption, repair, branch, history, and cleanup behavior without treating an unjudged or unavailable run as success.',
  userFacing: false,
  testScope: 'full',
  reviewScope: 'full',
  assumptions: [
    {
      claim: 'Gauntlet 1.0 and 2.0 are retained as historical evidence and neither already supplies a four-lane full-lifecycle runner.',
      verify:
        'bash -c "test -f plugins/zeroh-roadmap/GAUNTLET-2026-08.md && test -f plugins/zeroh-roadmap/GAUNTLET-2.0.md && test ! -e plugins/zeroh-roadmap/scripts/gauntlet-3.0/run.mjs"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The semantic delivery, CI, normalization, and GC seams needed by the trial are committed by phases 37 through 42 before this phase starts.',
      verify:
        'bash -c "for n in 37 38 39 40 41 42; do grep -Eq \"status:.*done\" docs/roadmap/phases/phase-$n.phase.ts || exit 1; done"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'Both Claude and Codex drivers are registered with verbatim same-host verification evidence before live arms run.',
      verify:
        'bash -c "node plugins/zeroh-roadmap/bin/roadmap.mjs driver verify claude --json >/tmp/nativegreen-claude-driver.json && node plugins/zeroh-roadmap/bin/roadmap.mjs driver verify codex --json >/tmp/nativegreen-codex-driver.json && node -e \"for(const p of [\'/tmp/nativegreen-claude-driver.json\',\'/tmp/nativegreen-codex-driver.json\']){const x=require(p);if(x.ok!==true)process.exit(1)}\""',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'No Gauntlet 3 preflight exists yet; task 43.1 owns the mandatory isolation and real-provider gate before any external mutation.',
      verify:
        'bash -c \"test ! -e plugins/zeroh-roadmap/scripts/gauntlet-3.0/preflight.mjs && test -f plugins/zeroh-roadmap/cli/lib/providers/github.mjs\"',
      onFalse: 'ESCALATE',
    },
  ],
  tasks: [
    {
      id: '43.1',
      title: 'Freeze the lifecycle contract, arm matrix, and disqualifying sentinels',
      problem:
        'A full-lifecycle comparison is invalid unless conditions, scenario packets, baselines, exact model/driver identities, authority, and disqualifying failures are frozen before any arm runs.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/scripts/gauntlet-3.0/scenarios.mjs',
          description:
            'Define GAUNTLET_3_CONTRACT and SCENARIOS for three concurrent arcs, independent/stacked/explicit-group branches, twenty lanes, interruption points, causal/owned/unrelated/indeterminate CI, normalization, GC, exact-head green, evaluation, and second resume; export four conditions (Claude parent→Claude child, Claude→Codex, Codex→Codex, Codex→Claude) plus matched no-plugin baselines. → verify: node plugins/zeroh-roadmap/scripts/gauntlet-3.0/scenarios.mjs --validate',
        },
        {
          file: "plugins/zeroh-roadmap/scripts/gauntlet-3.0/preflight.mjs",
          description:
            "Implement a mutation-free preflight that requires isolated repository/provider namespaces, exact real Claude and Codex binaries/versions, installed plugin hashes, credentials/capabilities, and explicit external-action authority; unavailable is a refusal, never a simulated pass. → verify: node --test --test-name-pattern=preflight plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs",
        },
        {
          file: 'plugins/zeroh-roadmap/scripts/gauntlet-3.0/fixtures.mjs',
          description:
            'Implement buildGauntletFixture and assertFixtureIsolation so every arm starts at one frozen SHA in its own repository/worktree/provider namespace and sealed packets never enter builder prompts. → verify: node --test --test-name-pattern=fixture plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs',
          description:
            'Add mutation tests proving omitted no-plugin baselines, shared worktrees, changed base SHA, leaked held-out packets, absent exact-model stamps, and unjudged arms all RED while the frozen matrix GREENs. → verify: node --test --test-name-pattern=contract plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs',
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
      done: false,
      interfaces: { produces: ['GAUNTLET_3_CONTRACT', 'SCENARIOS', 'GauntletPreflight', 'buildGauntletFixture'], consumes: [] },
    },
    {
      id: '43.2',
      title: 'Build a resumable four-lane runner with capability and authority receipts',
      problem:
        'Live parent/child runs need one durable launcher that distinguishes unavailable from failed, persists intent before mutation, resumes by stable arm ID, and never converts permission or provider errors into passes.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/scripts/gauntlet-3.0/run.mjs',
          description:
            'Implement runGauntlet3, runArm, resumeArm, and ArmJournal around the shared driver/role registry; persist requested condition, authority, fixture SHA and external-action intent before launch, then append observed driver/model/result receipts with unavailable/failed/unjudged kept terminally distinct. → verify: node --test --test-name-pattern=runner plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/scripts/gauntlet-3.0/run.mjs',
          description:
            'Add bounded concurrency and interruption injection so twenty lanes preserve one owner/result, a killed parent resumes the same stable run and PR key, and no adapter retries an external mutation without reconciling its prior receipt. → verify: node --test --test-name-pattern=interruption plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs',
          description:
            'Use fake Claude/Codex/provider adapters to plant limit, auth, sandbox, crash-before-receipt, crash-after-provider-success, duplicate-result, and wrong-model outcomes and assert exact typed dispositions and resume commands. → verify: node --test --test-name-pattern=permission plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs',
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
      done: false,
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
            'Implement scoreDeterministicSentinels for exact-head checks, stable PR identity, branch strategy, repair classification, bounded review, tree-equivalent normalization, GC identity/recoverability, terminal eval, and idempotent resume; any missing/unreadable sentinel invalidates the arm and yields no absolute score. → verify: node --test --test-name-pattern=sentinel plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/scripts/gauntlet-3.0/score.mjs',
          description:
            'Implement buildBlindJudgePacket and mergeBlindVerdict so judges see frozen criteria plus anonymized deliverables but no skill, driver, condition, builder reasoning, or prior verdict; require exact judge model and abstain/unjudged handling. → verify: node --test --test-name-pattern=judge plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs',
          description:
            'Plant stale-SHA green, unrelated-code edit, unsafe GC, cosmetic force-push, omitted eval, leaked condition, missing judge, and fabricated absolute score mutations and require each to fail its named check. → verify: node --test --test-name-pattern=mutation plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs',
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
      done: false,
      dependsOn: ['43.2'],
      interfaces: { consumes: ['ArmJournal', 'GAUNTLET_3_CONTRACT'], produces: ['scoreDeterministicSentinels', 'buildBlindJudgePacket'] },
    },
    {
      id: "43.4",
      title: "Attest real native hosts and provider before counting a live arm",
      problem: "Fake adapters can prove reducer negatives but cannot establish that Claude-native, Codex-native, cross-driver, plugin loading, or provider delivery actually worked.",
      steps: [
        { file: "plugins/zeroh-roadmap/scripts/gauntlet-3.0/preflight.mjs", description: "Probe the real claude and codex executables, exact versions/models, clean plugin installation hashes, isolated repository remotes, provider account/repository identity, required capabilities, and mutation authority; persist a signed-by-content preflight receipt and refuse product repositories or any fake/shim executable. → verify: node plugins/zeroh-roadmap/scripts/gauntlet-3.0/preflight.mjs --verify-receipt plugins/zeroh-roadmap/gauntlet-3.0/preflight.json" },
        { file: "plugins/zeroh-roadmap/scripts/gauntlet-3.0/run.mjs", description: "Require the matching fresh preflight receipt for every live arm and record parent PID/executable/version, child driver receipt, plugin manifest hash, provider request IDs, repository identity, and raw transcript checksums; never promote fake-adapter output into the live result namespace. → verify: node --test --test-name-pattern=attestation plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs" },
        { file: "plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs", description: "Plant shim binaries, stale or copied preflight receipts, wrong plugin hashes, product remotes, fake provider receipts, missing native provenance, and cross-arm receipt reuse; require each arm to be invalid or unavailable, never passed. → verify: node --test --test-name-pattern=attestation plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs" },
      ],
      acceptanceCriteria: ["A live-pass arm proves a real native parent process, declared child driver, installed plugin hash, isolated repository, and real provider request chain.", "Fake/shim/stale/copied/missing provenance is mechanically excluded from live scores and documentation claims.", "Unavailable credentials, capabilities, binaries, or authority remain unavailable and cannot be substituted by an in-memory adapter."],
      files: ["plugins/zeroh-roadmap/scripts/gauntlet-3.0/preflight.mjs", "plugins/zeroh-roadmap/scripts/gauntlet-3.0/run.mjs", "plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs", "plugins/zeroh-roadmap/gauntlet-3.0/preflight.json"],
      testMode: "tdd", done: false, dependsOn: ["43.3"],
      interfaces: { consumes: ["ArmJournal"], produces: ["NativeHostAttestation"] },
    },
    {
      id: '43.5',
      title: 'Exercise independent, stacked, and grouped delivery through exact-head CI',
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
            'For each plugin arm exercise blocked/stalled/unobserved/exited, review exhaustion, validation gaps and corrective phase, then causal, owned-preexisting, unrelated, infrastructure/flaky, indeterminate, auth, quota, timeout and repeated-fingerprint CI outcomes before exact-head green. → verify: node plugins/zeroh-roadmap/scripts/gauntlet-3.0/score.mjs --assert-lifecycle plugins/zeroh-roadmap/gauntlet-3.0/results.json',
        },
        {
          file: 'plugins/zeroh-roadmap/gauntlet-3.0/results.json',
          description:
            'Record pre-publication one-commit-per-phase tree equality/rescue receipts, green-history no-op, identity-proven GC decisions for fifty lanes, terminal eval, optional policy-authorized merge fixture, and a second resume with zero new external actions. → verify: node plugins/zeroh-roadmap/scripts/gauntlet-3.0/score.mjs --assert-history-gc-idempotency plugins/zeroh-roadmap/gauntlet-3.0/results.json',
        },
      ],
      acceptanceCriteria: [
        'Every plugin condition completes all three branch strategies and records a unique stable PR key, current head SHA, required-check rollup, correction trace, terminal evaluation, and zero-action second resume.',
        'Causal and owned failures enter normal correction phases; unrelated, indeterminate, infrastructure, auth, quota, timeout, and repeated fingerprints hold without unauthorized source edits.',
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
      title: "Disqualify negative lifecycle, authority, and provider outcomes",
      problem: "A happy-path live run can hide stale green, unauthorized edits, adapter fallback, or held provider failures unless raw evidence is checked independently.",
      steps: [
        { file: "plugins/zeroh-roadmap/scripts/gauntlet-3.0/verify-live.mjs", description: "Validate raw live receipts for blocked, stalled, unobserved, exited, review-exhausted, gaps, causal, owned-preexisting, unrelated, flaky, indeterminate, auth, quota, timeout, repeated fingerprint, stale head, forbidden edit, and authority-growth outcomes; reject missing raw evidence and synthetic live receipts. → verify: node --test --test-name-pattern=live-negative plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs" },
        { file: "plugins/zeroh-roadmap/gauntlet-3.0/results.json", description: "Record controlled isolated-provider negative scenarios with before/after repository trees and external-action ledgers; causal and owned repair through normal phases while all other classes hold with zero unauthorized edits or actions. → verify: node plugins/zeroh-roadmap/scripts/gauntlet-3.0/verify-live.mjs --assert-negatives plugins/zeroh-roadmap/gauntlet-3.0/results.json" },
      ],
      acceptanceCriteria: ["Every negative class has raw causal evidence, exact typed disposition, repository diff, action ledger, and bounded resume or user-decision state.", "Unrelated, indeterminate, infrastructure, auth, quota, timeout, and repeated-fingerprint cases produce zero unauthorized source edits.", "No fake adapter, fabricated provider receipt, missing check, or stale-head green can score as a live pass."],
      files: ["plugins/zeroh-roadmap/scripts/gauntlet-3.0/verify-live.mjs", "plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs", "plugins/zeroh-roadmap/gauntlet-3.0/results.json"],
      testMode: "tdd", done: false, dependsOn: ["43.5"],
      interfaces: { consumes: ["Gauntlet 3 live results", "NativeHostAttestation"], produces: ["live negative-case verdicts"] },
    },
    {
      id: "43.7",
      title: "Prove semantic parity and paired no-plugin baselines",
      problem: "Four completed arms are not parity evidence unless the same frozen semantic events and outputs are compared, and plugin benefit is not attributable without matched real-parent baselines.",
      steps: [
        { file: "plugins/zeroh-roadmap/scripts/gauntlet-3.0/parity.mjs", description: "Compare canonical transition, authority, delivery, CI, history, cleanup, evaluation, and resume receipts across all four real parent-child conditions after removing declared host provenance only; emit exact mismatch paths and refuse unavailable or unjudged pairs. → verify: node --test --test-name-pattern=parity plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs" },
        { file: "plugins/zeroh-roadmap/gauntlet-3.0/results.json", description: "Run matched no-plugin baselines through the same real parent binaries, models, fixture SHA, provider namespace class, prompts, limits, and blind judges; pair each condition directly and exclude historical Gauntlet means from concurrent effect claims. → verify: node plugins/zeroh-roadmap/scripts/gauntlet-3.0/parity.mjs --assert-paired plugins/zeroh-roadmap/gauntlet-3.0/results.json" },
      ],
      acceptanceCriteria: ["All four available real-host conditions yield byte-equivalent semantic receipts after only declared provenance fields are normalized.", "Each plugin arm has one matched real-parent no-plugin baseline with identical frozen inputs and an independently complete blind verdict.", "Unavailable, invalid, failed, or unjudged arms prevent a parity/support claim rather than shrinking the denominator."],
      files: ["plugins/zeroh-roadmap/scripts/gauntlet-3.0/parity.mjs", "plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs", "plugins/zeroh-roadmap/gauntlet-3.0/results.json"],
      testMode: "tdd", done: false, dependsOn: ["43.6"],
      interfaces: { consumes: ["live negative-case verdicts", "buildBlindJudgePacket"], produces: ["semantic parity verdict", "paired baseline verdict"] },
    },
    {
      id: '43.8',
      title: 'Publish a reproducible report with explicit limitations and claim inventory',
      problem:
        'Phase 45 may document only behavior established here, so the evidence needs a machine-readable claim inventory and a human report that distinguishes verified, unavailable, failed, inferred, and untested behavior.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/scripts/gauntlet-3.0/report.mjs',
          description:
            'Implement buildGauntlet3Report from frozen contract, journals, deterministic scores, blind verdicts, exact versions and checksums; emit a claim inventory whose status vocabulary is verified/unavailable/failed/unjudged/untested and reject unsupported green claims. → verify: node --test --test-name-pattern=report plugins/zeroh-roadmap/scripts/gauntlet-3.0/gauntlet-3.0.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/GAUNTLET-3.0.md',
          description:
            'Generate the method, condition matrix, lifecycle coverage, paired results, judge evidence, interruptions, restores, limitations, exact rerun commands and documentation-safe claim inventory; never expose sealed packets or credentials. → verify: node plugins/zeroh-roadmap/scripts/gauntlet-3.0/report.mjs --check plugins/zeroh-roadmap/GAUNTLET-3.0.md',
        },
        {
          file: 'plugins/zeroh-roadmap/gauntlet-3.0/results.json',
          description:
            'Seal final checksums, versions, condition/arm counts, sentinel verdicts, judge completeness and documentation claim IDs after one clean rerun; any unavailable arm remains unavailable rather than green. → verify: node plugins/zeroh-roadmap/scripts/gauntlet-3.0/report.mjs --verify-seal plugins/zeroh-roadmap/gauntlet-3.0/results.json',
        },
      ],
      acceptanceCriteria: [
        'The report is reproducible from committed, secret-free results and names exact models, drivers, plugin SHA, provider fixtures, condition counts, and checksums.',
        'Every documentation-safe feature claim has a stable claim ID and verified evidence pointer; unavailable, failed, unjudged, inferred, and untested are never collapsed into supported.',
        'A clean rerun passes every deterministic sentinel and completes every available blind judgment before the sealed result is written.',
      ],
      files: [
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
  reviewRecord: { date: '2026-09-04', model: 'gpt-5.6-sol', verdict: 'READY', via: 'executed' },
  notes:
    '## Hypotheses — CONFIRMED cause: earlier gauntlets compare partial or potentially invalid evidence and no existing runner exercises the complete real native-parent/provider lifecycle (evidence: only scripts/gauntlet-2.0 exists and GAUNTLET-2026-08.md plus GAUNTLET-2.0.md are reports, not a four-condition live runner). Refuted rival: existing fixture-consumer tests provide reusable deterministic substrate but cannot attest real Claude/Codex/plugin/provider execution. Metadata ratification: userFacing false because this produces internal evidence; testScope full and full review are mandatory for the public truth source. interview: skipped — arc member; NATIVEGREEN.arc.ts and its execution prompt record the user rulings. userFacing false: this phase creates internal conformance infrastructure and evidence, not a consumer runtime feature, so no feature flag applies. `testScope: full` and full review are required because the result is the truth source for later public claims. Gauntlet 1.0 provides stronger blind comparative evidence while 2.0 provides paragraph/load discipline; this phase combines both and adds the missing whole lifecycle. The repository boundary wrapper was invoked before editing but dependency preflight stopped on ERR_PNPM_IGNORED_BUILDS before classification; no restricted-path verdict was emitted. --skip-review: plan unverified, not queued.',
})
