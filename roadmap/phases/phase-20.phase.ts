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
  status: 'done',
  completedDate: '2026-09-01',
  gate: {
    lint: 'clean',
    typeCheck: 'clean',
    unitTests: {
      passed: 1635,
      total: 1635,
      notes:
        'Authoritative full gate: roadmap/.gate/20/run-000011-2026-09-01T14-20Z — GREEN, 1,635/1,635, on the tree rebased onto the integration ref (14, 15, 16, 17 and 18 landed underneath). The prior RED had two causes and NEITHER was a defect in this phase\'s work: a generated artifact (cli/roadmap.config.schema.json) had silently reverted to its stale form during landing, red on the integration branch itself and fixed there; and gate.test.mjs had lost its annotateScopedProbeWarnings import to a rebase resolution, so the unanswerable-probe test died on a ReferenceError instead of exercising 20.2. lint/types/build/integration declared-none; lint-diff and history-comments exit 0.',
    },
    integrationTests: {
      passed: 0,
      total: 0,
      notes: 'declared-none in gateCommands — the wired subprocess suites in the unit tier drive the real CLI against tmp git repos.',
    },
    e2eTests: { passed: 0, total: 0, notes: 'declared-none in gateCommands — no rendered surface.' },
    build: 'clean',
  },
  gateRounds: [
    { round: 0, agent: 'quality-pass', verdict: 'findings-fixed', summary: 'Shared the captured-runner helper; compressed protocol-handoff prose back inside the envelope budget (183c548, 7c2d6d1).' },
    { round: 1, agent: 'code-reviewer', verdict: 'findings-fixed', summary: 'Review findings closed in 0a763d5.' },
    { round: 2, agent: 'code-reviewer', verdict: 'findings-fixed', summary: 'Polarity record aligned with the implemented classes (9e5e50d).' },
    { round: 3, agent: 'code-reviewer', verdict: 'findings-fixed', summary: 'Wrapped commands covered — a verify inside `bash -c` is still judged per segment (745bbd2).' },
    { round: 4, agent: 'code-reviewer', verdict: 'findings-fixed', summary: 'Command-shape gaps closed (1653e4a).' },
    {
      round: 5,
      agent: 'code-reviewer',
      verdict: 'findings-fixed',
      summary:
        'Round 5 exhausted the cap with three findings, closed by the supervising session because two were the anti-vacuity lint failing its OWN standard: it judged a whole command by its last pipe, and it stripped a quoted search pattern only on an exact match. Both pinned. Third: a mutation proof quoting a 36-test suite that is now 50 — re-measured, not re-copied (44dd822).',
    },
  ],
  metrics: {
    commits: 12,
    linesAdded: 1123,
    linesRemoved: 20,
    filesChanged: 10,
    testsAtStart: 1581,
    testsAtEnd: 1635,
    testsAdded: 54,
    startedAt: '2026-09-01T07:13:00.000Z',
    completedAt: '2026-09-01T14:20:56.000Z',
    haltCount: 1,
  },
  executionResult: {
    phase: 20,
    status: 'done',
    driver: { model: 'gpt-5.6-sol', lane: 'codex' },
    roles: [
      { role: 'test-engineer', model: 'claude-opus-5', via: 'child-cli' },
      { role: 'quality-pass', model: 'claude-opus-5', via: 'child-cli' },
      {
        role: 'code-reviewer',
        model: 'claude-opus-5',
        via: 'child-cli',
        substituted: { from: 'claude-fable-5', to: 'claude-opus-5', reason: 'unavailable: claude-fable-5 reached its usage limit — the correctness rounds re-resolved at UNREDUCED rigor on claude-opus-5' },
      },
    ],
    compromises: [],
    skipped: [],
    hardcoded: [],
    surfaced: [
      'The keystone\'s own instrument was vacuous twice over, and the lane\'s five-round cap ran out before either was closed. The anti-vacuity lint judged a whole command by its LAST pipe, so an honest closing `grep -q` excused an earlier masked runner segment whose red was already swallowed; and it stripped a quoted search PATTERN only when the pattern was exactly the swallow literal, so a plan grepping for `x || true y` — hunting the very class this lint retires — drew a false WARN. Both now analysed per ; && || segment, and both carry the regression pin neither had.',
      'The second pin FAILED on its first run and the failure was the pin, not the code: the fixture embeds a step description inside a single-quoted JS literal, so a single-quoted grep pattern mangled the generated phase file instead of exercising the lint. Recorded because a pin that fails for its own reasons looks exactly like a refuted fix.',
      'Task 20.3\'s recorded mutation proof still quoted a 36-test suite that is now 50. Re-measured rather than re-copied — disabling the swallow rule reds 48/2, restoring greens 50/0 — with the original run kept as provenance. The restore came from a scratch COPY, never `git checkout`, which would have eaten the uncommitted round-5 work in the same file (mudarabah2\'s recorded lesson).',
      'Both failures in the first authoritative gate came from LANDING, not from this phase: a generated config schema silently reverted to its stale form when a rebase resolution took the landed side of a file a lane had regenerated (red on the integration branch itself, fixed there), and gate.test.mjs lost an import the same way, so 20.2\'s test died on a ReferenceError instead of pinning the behavior. Both are the cost of resolving conflicts by side rather than by meaning.',
    ],
    hardStops: [],
    gateRounds: 6,
  },
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
