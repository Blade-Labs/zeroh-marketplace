import { definePhase } from '@/lib/roadmap/schema'

/**
 * MINESWEEP plane 3 (keystone) — anti-vacuity: name the proof that cannot fail.
 *
 * The single largest mined failure class (~20 incidents, all four repos): checks that
 * pass whether or not the claim holds. Recorded shapes this phase mechanizes: a scoped
 * runner exiting 0 on a nonexistent target ("existing Nx suites can exit 0 when passed a
 * nonexistent file or unmatched -t" — the codex plan lane's own discovery; azure 2333's
 * vitest include-glob running zero tests green), and judged-through-a-pipe validators
 * ("a validate piped through tail -1 masked a schema failure and the red phase file got
 * pushed" — azure 2421). The remaining shapes (fixture-from-plan, guards encoding the
 * bug) stay judgment-side: review-phase Lane A and the verify-rehearsal reference own
 * them, and this phase adds the mechanical door Lane A lacked — executing a plan's
 * assumption tripwires on demand.
 * Evidence: roadmap/arc-prompts/MINESWEEP-execution-prompt.md §vacuity.
 *
 * ## Hypotheses (why vacuous greens ship)
 * 1. CONFIRMED — the existing polarity lint is narrower than the recorded incident set:
 *    verifyPolarityWarnings (validate.mjs:204-231) catches bare `grep -c` absence and
 *    pipe-judged RUNNERS (`npm|pnpm|yarn|tsc|capbuild|nx|vitest|node --test` left-sides
 *    only) — azure 2421's `node bin/…mjs | tail -1` matches no class, `|| true` and
 *    `; echo` tails match none, and NOTHING probes whether a gate slot's scoped runner
 *    can fail at all (0 'cannot fail' hits in gate.mjs/slots.mjs).
 * 2. REFUTED — "authors just need the rehearsal discipline": verify-rehearsal.md is
 *    mandatory and SEODESKFIX/UCAUDIT still shipped backward verifies (4 and 8/20) —
 *    the discipline needs its mechanical arms, not more prose.
 *
 * timing: no reference data for 1-3×surface:false
 */
export default definePhase({
  phase: 20,
  name: 'Anti-vacuity: scoped-runner cannot-fail probe, widened polarity lint, executable assumption tripwires',
  status: 'in-progress',
  plannedBy: { model: 'claude-fable-5' },
  category: 'fix',
  kind: 'hardening',
  arcId: 'MINESWEEP',
  source:
    'MINESWEEP plane "Proof of proof" — 2026-08-31 mining §Q3 item 1 (P1, the largest cross-repo class; atlas plan-22 self-caught vacuous Nx commands; azure 2333/2421; marketplace 11).',
  priority: 'HIGH',
  dependsOn: [],
  conflictsWith: [],
  keyFiles: [
    'plugins/zeroh-roadmap/cli/commands/gate.mjs',
    'plugins/zeroh-roadmap/cli/commands/gate.test.mjs',
    'plugins/zeroh-roadmap/cli/lib/slots.mjs',
    'plugins/zeroh-roadmap/cli/lib/slots.test.mjs',
    'plugins/zeroh-roadmap/cli/lib/validate.mjs',
    'plugins/zeroh-roadmap/bin/validate-roadmap-file.test.mjs',
    'plugins/zeroh-roadmap/cli/commands/phase.mjs',
    'plugins/zeroh-roadmap/cli/commands/phase.test.mjs',
  ],
  stakeholderDemo:
    'The gate names a scoped test runner that cannot fail before it certifies anything with it; the polarity lint catches the recorded piped-validator and swallowed-exit shapes; a reviewer can execute a plan\'s assumption tripwires with one flag instead of trusting the author\'s attestation.',
  userFacing: false,
  assumptions: [
    {
      claim: "The piped-judgement lint keys on a runner list that excludes plain `node`/`npx`/`tsx` invocations (azure 2421's exact shape), and no `|| true` or trailing-echo class exists.",
      verify:
        'bash -c "grep -qF \'(npm run|pnpm |yarn |tsc\\\\b|capbuild|nx run|vitest|node --test)\' plugins/zeroh-roadmap/cli/lib/validate.mjs && test \\"$(grep -cF \'|| true\' plugins/zeroh-roadmap/cli/lib/validate.mjs)\\" = \\"0\\""',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'Slot templates substitute {files} verbatim (slots.mjs substitute), so a sentinel nonexistent path can ride the SAME template the real gate uses — the probe never invents an invocation.',
      verify: 'bash -c "grep -qF \\"cmd.split(\'{files}\').join\\" plugins/zeroh-roadmap/cli/lib/slots.mjs"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'No assumption-execution door exists: `phase validate` parses and lints but never runs assumptions[].verify (0 `--assumptions` hits in phase.mjs).',
      verify: 'bash -c "test \\"$(grep -cF -- --assumptions plugins/zeroh-roadmap/cli/commands/phase.mjs)\\" = \\"0\\""',
      onFalse: 'ESCALATE',
    },
  ],
  tasks: [
    {
      id: '20.1',
      title: 'slots.mjs: probeScopedSlot — can this runner fail at all?',
      problem:
        'A scoped runner that exits 0 on a nonexistent target certifies every task it "scopes" vacuously (atlas plan-22 caught its own; azure 2333 shipped one) — and nothing ever asks the runner the one question that exposes it.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/slots.mjs',
          description:
            "Export probeScopedSlot(template, { cwd, timeoutMs = 120000 }): substitute a provably-nonexistent sentinel path (roadmap/.gate/__vacuity_probe_does_not_exist__.test.ts) into the template's {files} via the SAME substitute(), run it captured; exit 0 → { vacuous: true, message: 'scoped runner cannot fail on a missing target — a green scoped slot proves nothing (vacuous-green class)' }; non-zero → { vacuous: false }; spawn error/timeout → { vacuous: null, message } (an unanswerable probe is reported, never read as pass) → verify: bash -c \"grep -qF 'export function probeScopedSlot' plugins/zeroh-roadmap/cli/lib/slots.mjs\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/slots.test.mjs',
          description:
            'Tests with stub runners: an exit-0-always script → vacuous:true; a script that exits 2 on a missing file → vacuous:false; a hanging script under a short timeoutMs → vacuous:null with the timeout named; a template without {files} → skipped (null, "not a scoped template") → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'probeScopedSlot\' cli/lib/slots.test.mjs && capbuild node --test cli/lib/slots.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'The probe answers vacuous true/false/null through the real template substitution, never a hand-built invocation; every branch has a stub-runner test',
      ],
      files: ['plugins/zeroh-roadmap/cli/lib/slots.mjs', 'plugins/zeroh-roadmap/cli/lib/slots.test.mjs'],
      testMode: 'tdd',
      interfaces: { consumes: [], produces: ['probeScopedSlot(template, opts) from cli/lib/slots.mjs'] },
      done: true,
      doneDate: '2026-09-01',
      transparencyReport: {
        whatWasDone:
          'Exported probeScopedSlot, which substitutes a fixed nonexistent test path through the existing slot-template seam and executes the captured command. Exit zero is reported as a vacuous scoped runner, any completed nonzero exit proves the runner can fail, and missing/unscoped templates, substitution failures, spawn errors, and timeouts remain explicitly indeterminate.',
        how:
          'The claude-opus-5 test-engineer first added real executable stub-runner cases and established RED at 34 passing / 11 failing, then added the omitted hanging-runner boundary for 34 passing / 12 failing. The implementation spawns bash in a process group so timeout cleanup also kills descendants, captures stdout/stderr, and returns the substituted command and sentinel target for test evidence. The final scoped suite passed 46/46; the types slot was declared-none and green.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations: 'None',
      },
    },
    {
      id: '20.2',
      title: 'gate plan surfaces the cannot-fail probe as a HIGH warning',
      problem:
        'The probe is worthless unless it fires where scope is decided: gate plan is where a scoped tier gets chosen over the full suite, so a vacuous scoped runner must be named there, before it certifies a phase.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/gate.mjs',
          description:
            "In the gate-plan path (the `plan` subcommand emission — `gate run` shares buildPlan and must NOT pay the probe), for each scoped slot's RAW template (architect amendment A5 — resolved slot rows carry the POST-substitution command with no {files} left: substitute() runs inside resolveSlot/resolveScopedOrFallback, so either carry `template` on resolveScopedOrFallback's return for scoped slots, the preferred one-line seam, or re-read cfg.gateCommands[<slot>] per built slot name) containing {files}: run probeScopedSlot once (per distinct template, cached within the run); vacuous:true → a `warning: <slot> scoped runner cannot fail …` line + a plan-notes entry; vacuous:null → a probe-unanswerable note. WARN-only — exit codes unchanged (arc acceptance bar: the executor judges) → verify: bash -c \"grep -qF 'cannot fail' plugins/zeroh-roadmap/cli/commands/gate.mjs\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/gate.test.mjs',
          description:
            'Fixture-consumer: gateCommands binding a stub exit-0-always scoped runner → gate plan output carries the warning and still exits by its normal contract; the honest-runner twin carries no warning (both directions) → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'cannot fail\' cli/commands/gate.test.mjs && capbuild node --test cli/commands/gate.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'A vacuous scoped runner is named at plan time with unchanged exit semantics; honest runners stay silent; the probe runs once per distinct template per plan (asserted via the stub\'s invocation count)',
      ],
      files: ['plugins/zeroh-roadmap/cli/commands/gate.mjs', 'plugins/zeroh-roadmap/cli/commands/gate.test.mjs'],
      testMode: 'tdd',
      dependsOn: ['20.1'],
      interfaces: { consumes: ['probeScopedSlot(template, opts) from 20.1'], produces: [] },
      done: true,
      doneDate: '2026-09-01',
      transparencyReport: {
        whatWasDone:
          'Gate plan now probes every selected file-scoped slot template before emitting its JSON. Results are cached by exact raw template, while vacuous results produce a warning and per-slot plan note and indeterminate results produce a per-slot unanswerable note; gate run never invokes the probe and verdict codes are unchanged.',
        how:
          'The claude-opus-5 test-engineer added four fixture-consumer cases using real shell stubs and established four new RED failures beyond an environment-only baseline. The plan-only dispatcher awaits a small annotation helper after buildPlan, reads each selected slot raw binding from gateCommands, and memoizes its probe promise. After restoring the ignored plugin-local zod resolution seam to the existing root install, the complete gate command suite passed 68/68; the types slot was declared-none and green.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations: 'None',
      },
    },
    {
      id: '20.3',
      title: 'Polarity lint: the three recorded missing classes',
      problem:
        'azure 2421\'s `node bin/validate-roadmap-file.mjs <path> | tail -1` matches no lint class (the runner list excludes plain node/npx/tsx), and the `|| true` / trailing-`; echo` swallow shapes match none — three recorded incident classes the lint was built to catch and cannot.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/validate.mjs',
          description:
            "In verifyPolarityWarnings: (a) widen the piped-judgement left-side alternation with `node |npx |tsx ` (plain script invocations — the 2421 class), keeping the filter-tail regex as is; (b) new class: a command whose FINAL list element after `;` is a bare `echo`/`true` (the judged exit is the echo's, unconditionally 0); (c) new class: `|| true` anywhere (the swallow) — each WARN cites its incident class in one clause → verify: bash -c \"grep -qF '|| true' plugins/zeroh-roadmap/cli/lib/validate.mjs\"",
        },
        {
          file: 'plugins/zeroh-roadmap/bin/validate-roadmap-file.test.mjs',
          description:
            'Table rows per class from the recorded incidents verbatim (the 2421 node|tail form; `cmd || true`; `cmd; echo done`) each WARN on a new-to-git fixture phase; the clean twins (grep-q assertions as the final pipeline stage, quoted grep patterns, expected-output assertions, and `cmd && echo`, whose short-circuit preserves a failing left-side verdict) do not; committed-to-git files stay exempt (grandfather rule pinned) → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'|| true\' bin/validate-roadmap-file.test.mjs && capbuild node --test bin/validate-roadmap-file.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'All three recorded shapes WARN with their incident citation; the clean twins stay silent; the grandfather rule is untouched (both directions per class)',
      ],
      files: ['plugins/zeroh-roadmap/cli/lib/validate.mjs', 'plugins/zeroh-roadmap/bin/validate-roadmap-file.test.mjs'],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-09-01',
      transparencyReport: {
        whatWasDone:
          'Expanded verifyPolarityWarnings to catch plain node/npx/tsx invocations whose final filter masks their verdict, any real `|| true` exit swallow outside quoted search patterns, and semicolon lists ending in a bare echo/true, including wrapped and quoted forms. Each warning names its incident class, while final grep-q/count assertions, honest `&&` lists, expected-output assertions, quoted search literals, and committed phase files remain silent.',
        how:
          'The claude-opus-5 test-engineer added table-driven new-file, clean-twin, and grandfathered-file cases and established 32 passing / 4 failing before implementation; the completed validator suite passed 36/36 at the time and the types slot was declared-none. MUTATION PROOF RE-MEASURED against the CURRENT 50-test suite after the round-5 fixes (the 36-test figures below are the historical run, kept as provenance, not as today\'s evidence): disabling the swallow rule so it can never fire → RED, 48 pass / 2 fail; restored from a scratch COPY (never `git checkout`, which would have eaten the uncommitted round-5 work in the same file) → GREEN, 50 pass / 0 fail. Original run: planted `|| true` into its clean twin → RED (35 pass, 1 fail: unexpected WARN); changed the rule anchor from `true` to `false` → RED (35 pass, 1 fail: expected WARN count 0); decoy direct command and expected-output echo twins → GREEN (36 pass, 0 fail). Semicolon-tail polarity guard mutation proof: planted `; echo found` into the honest `&& echo` clean twin → RED (0 pass, 1 fail: unexpected WARN); changed the rule anchor from `;` to `:` → RED (0 pass, 2 fail: expected WARN count 0 for both `; echo` and `; true`); restored `;` bad-shape, `&& echo` clean-twin, and committed-file decoy cases → GREEN (3 pass, 0 fail). Each scratch mutation was reverted before this report.',
        compromises:
          'Correctness review narrowed the planned trailing-no-op class from `;` or `&&` to `;` only: `cmd && echo` short-circuits on failure and therefore preserves the left-side non-zero verdict.',
        skipped: 'None',
        hardcoded: 'None',
        limitations: 'None',
      },
    },
    {
      id: '20.4',
      title: '`phase validate --assumptions`: execute the tripwires',
      problem:
        'A plan\'s assumptions[].verify commands are attested by their author and re-run by nobody until execution trips over a stale claim — review-phase Lane A demands both-direction evidence but has no mechanical door to the green direction.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/phase.mjs',
          description:
            "Add --assumptions to `phase validate`: after the normal validation, execute each assumptions[].verify (spawn captured, cwd toplevel, 120s timeout each), print per-claim `ok`/`STALE (exit k)`/`TIMEOUT`; any non-ok → exit 2 listing the stale claims verbatim (a stale tripwire means the plan's territory moved — the review verdict, mechanized). Without the flag, behavior is byte-identical → verify: bash -c \"grep -qF -- '--assumptions' plugins/zeroh-roadmap/cli/commands/phase.mjs\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/phase.test.mjs',
          description:
            'Fixture-consumer: a phase whose two tripwires are green → exit 0 with two ok lines; one flipped stale (fixture edit) → exit 2 naming exactly that claim; a phase with no assumptions → note + exit 0; flagless run unchanged (regression pin) → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF -- \'--assumptions\' cli/commands/phase.test.mjs && capbuild node --test cli/commands/phase.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'Green, stale, timeout and assumption-less paths each behave and report as specified (all directions tested); flagless validate is byte-identical',
      ],
      files: ['plugins/zeroh-roadmap/cli/commands/phase.mjs', 'plugins/zeroh-roadmap/cli/commands/phase.test.mjs'],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-09-01',
      transparencyReport: {
        whatWasDone:
          'Added `phase validate --assumptions` and exported runAssumptions for an injectable timeout seam. After ordinary validation succeeds, every declared verify runs from the repository toplevel under an independent 120-second budget and reports its full claim as ok, STALE with the real exit code, or TIMEOUT; all claims run even after a stale result and any non-ok result exits 2.',
        how:
          'The claude-opus-5 test-engineer added nine real-CLI and injected-timeout cases, establishing 38 passing / 8 failing with the flagless regression case already green. The implementation uses captured bash child processes in process groups so timeout cleanup kills descendants, preserves completed exit codes, and leaves the no-flag path byte-identical. The final phase command suite passed 46/46; the types slot was declared-none and green.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations: 'None',
      },
    },
  ],
  notes:
    'interview: skipped — arc member; scope from the MINESWEEP arc record (acceptance criterion vacuity-flagged binds 20.2 + 20.3). ' +
    'reviewScope full (arc keystone; lint/probe polarity errors would mass-annoy or mass-miss). ' +
    'Out-of-scope, documented: fixture-vs-contract diffing and guard-encodes-the-bug detection are judgment classes owned by review-phase Lane A and the code-reviewer card (mechanizing them would need contract introspection no seam provides — recorded as the boundary, not a gap); the hook-adapter-as-CLI class is consumer-specific (azure bin layout) and its plugin-side twin is already typed (validate-roadmap-file is a real CLI here). ' +
    'Verify rehearsal attestation: red-now probes executed 2026-08-31 — probeScopedSlot 0 hits, `cannot fail` 0 hits (gate.mjs, slots.mjs), `--assumptions` 0 hits (phase.mjs), `|| true` 0 hits in validate.mjs AND in bin/validate-roadmap-file.test.mjs (each step-verify red for exactly what its diff adds); assumption probes all exit 0 (runner-list literal and substitute join-form present); the 20.3 clean-twin design was checked against this phase\'s own verifies (none end in a bare echo/true; `|| true` appears only as a quoted grep PATTERN in three clauses — shape-distinct from the swallow class, and this committed file is grandfathered); runner clauses inherit polarity from their grep representatives. ' +
    'review-phase Mode A 2026-08-31: [FIXED] 20.3.s2 verify was green-now (the suite already passes at HEAD and the clause carried no diff marker — itself the vacuous-green shape) — repaired with the `|| true` test-file marker grep, re-run red (exit 1); corpus measure: zero `; echo` / `|| true` verify clauses in roadmap/phases/*.phase.ts outside this file, so 20.3\'s new classes have no existing-plan false-positive exposure (grandfather rule shields committed files regardless); 20.2 scoped to the `plan` subcommand so `gate run` never pays probe latency.',
})
