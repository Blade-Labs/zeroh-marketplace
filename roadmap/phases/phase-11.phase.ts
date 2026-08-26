import { definePhase } from '@/lib/roadmap/schema'

/**
 * Dynamic executor-capacity admission — `roadmap capacity` + live wiring + executionMode removal.
 *
 * Phase-10's parallel-dispatch investigation (DESIGN-NOTES §Parallel dispatch) left the ruling
 * with the user; the user ratified (AskUserQuestion, 2026-08-26): build the live capacity check
 * AND wire it into today's spawn sites, and remove the dead executionMode field here. The check
 * answers, from the box's at-that-moment resources, "can another executor spawn right now, and
 * how many at most" — the mandatory admission gate any future parallel fan-out must consult.
 * timing: band 4-6 × surface:false, N=4, median 148.8 min, p80 196.4 min
 */
export default definePhase({
  phase: 11,
  name: 'Dynamic executor-capacity admission — roadmap capacity verb, spawn-site wiring, executionMode removal',
  status: 'done',
  completedDate: '2026-08-26',
  gate: {
    lint: 'clean',
    typeCheck: 'clean',
    unitTests: {
      passed: 1410,
      total: 1410,
      notes:
        'Authoritative full gate: roadmap/.gate/11/ run of 2026-08-26T16:38Z — GREEN, 1,410/1,410, run on the FINAL tree after the round-3 fixes (two earlier full runs: the first REDDED on the v0.33.0 manifest drift + a history-comment, fixed as gate R1-mechanical; the second, 1,405/1,405, predated the agent-round fixes and was superseded). 39 tests added over the 1,371 baseline. lint/types/build/integration declared-none; lint-diff and history-comments exit 0.',
    },
    integrationTests: {
      passed: 0,
      total: 0,
      notes: 'declared-none in gateCommands — the wired subprocess suites inside the unit tier (capacity, arc-next, arm-disarm, status) drive the real CLI end to end against tmp git repos.',
    },
    e2eTests: { passed: 0, total: 0, notes: 'declared-none in gateCommands — no rendered surface.' },
    build: 'clean',
    preReview: 'clean',
  },
  gateRounds: [
    {
      round: 0,
      agent: 'quality-pass',
      verdict: 'findings-fixed',
      summary:
        'Three fixes (its own commit 4d84957, correct grammar this time): the SEAM_ENV constant became the one home for the env name, consumerCapacityConfig() extracted for the two advisory readers with the verb deliberately excluded (fail-loud, documented), and the two arc-next gate branches collapsed behind an override flag (equivalence checked, pinned by N25-N29). Handed three leads to round 1.',
    },
    {
      round: 1,
      agent: 'code-reviewer',
      verdict: 'findings-fixed',
      summary:
        'Five findings, all fixed: (MEDIUM) seamProbes accepted a PARTIAL payload and silently invented zero-busy signals — a permissive verdict that parsed cleanly (reviewer reproduced it); now a strict five-reading shape, missing keys NAMED in a SeamError through every consumer. (MEDIUM) liveExecutorArms counted a completed-but-undisarmed arm as busy — three leftovers would fail arc next CLOSED forever (reproduced); now filtered through the staleArms oracle. (LOW×3) harness surfaces spawnSync errors; the arm advisory got test-pinned and a broken seam is NAMED instead of silently blinding arm; the capacity verb seam refusal aligned to exit 1 per the bin contract.',
    },
    {
      round: 2,
      agent: 'code-reviewer',
      verdict: 'findings-fixed',
      summary:
        'Four LOW findings, fixed: three durable-record drifts the R1 code fixes left behind were trued in place (11.1 staleArms filter named, 11.3 exit-1 partial-payload contract with provenance, 11.5 advisory pin recorded), and the one asymmetry R1 itself created — a SeamError silently swallowed under --ignore-capacity — now prints a named note while run-phase stands. All R1 fixes verified HOLD: every consumer driven live against the partial-seam repro, two scratch mutations killed.',
    },
    {
      round: 3,
      agent: 'code-reviewer',
      verdict: 'findings-fixed',
      summary:
        'Two LOW findings, fixed: N30 pins the override-seam named note (exit 0, derivation byte-intact; disabling the branch reds it — mutation-checked), and task 11.4 limitations trued with the R2 override path. All R2 fixes verified HOLD.',
    },
    {
      round: 4,
      agent: 'code-reviewer',
      verdict: 'clean',
      summary:
        'Zero findings. N30 mutation-executed independently (short-circuited branch → not ok; reverted with a clean diff); the 11.4 record verified accurate clause-by-clause against arc.mjs at HEAD; phase validate OK; capacity 10/10 and arm-disarm 11/11 green.',
    },
  ],
  metrics: {
    commits: 12,
    linesAdded: 1677,
    linesRemoved: 44,
    filesChanged: 24,
    testsAtStart: 1371,
    testsAtEnd: 1410,
    testsAdded: 39,
    startedAt: '2026-08-26T14:06:28Z',
    completedAt: '2026-08-26T16:56:00Z',
    haltCount: 0,
  },
  compromises:
    'None. The one plan-time-unmade decision surfaced by a tester (a bare .int() admitting a zero bound that would divide the admission math by zero) had one correct answer under PRIME RULE 1 (ambiguity → throw: .int().positive() + a boundary case), not a fork. The curate refusal is a deliberate non-rewrite: two phase-12 planning commits (user-directed mid-phase, this session) interleave the range and the foreign-detector correctly refuses to squash across them; history stays granular.',
  executionResult: {
    phase: 11,
    status: 'done',
    driver: { model: 'claude-fable-5', lane: 'session' },
    roles: [
      { role: 'test-engineer', model: 'claude-opus-5', via: 'native' },
      { role: 'quality-pass', model: 'claude-opus-5', via: 'native' },
      { role: 'code-reviewer', model: 'claude-opus-5', via: 'native' },
    ],
    compromises: [],
    skipped: [],
    hardcoded: [],
    surfaced: [
      'Capacity policy defaults are grounded in THIS box (capbuild 6G, 31G, ~6 sessions); other consumer repos should set roadmap.config.json capacity to their own bounds — the live probes adapt, the policy does not.',
      'status --json with a malformed seam exits 1 named but is untested at that tier (the seam contract is pinned at the capacity-command, lib, arc-next and arm tiers).',
      'Under --ignore-capacity, a NON-SeamError throw from the capacity path stays silent — deliberate override semantics (R4 INFO), the one path with no operator-visible trace.',
      'staleArms treats only phase-complete/terminal-phase/unbound as stale, so an arm whose last beacon is result-returned on a not-yet-done phase still counts busy — fail-closed conservatism consistent with one staleness oracle (R2 INFO).',
      'liveExecutorArms sees the CURRENT toplevel only — cross-worktree arms on the same box are invisible to the default probe; a cross-worktree registry is the nameable follow-up if multi-arc-per-box becomes routine.',
    ],
    hardStops: [],
    gateRounds: 5,
  },
  plannedBy: { model: 'claude-fable-5' },
  category: 'feature',
  kind: 'logic',
  source:
    'User request 2026-08-26 + phase-10 DESIGN-NOTES §Parallel dispatch options; user-ratified scope via AskUserQuestion: (1) check + wire today\'s spawns, (2) executionMode removal rides this phase.',
  priority: 'MEDIUM',
  dependsOn: [10],
  conflictsWith: [],
  keyFiles: [
    'plugins/zeroh-roadmap/cli/lib/capacity.mjs',
    'plugins/zeroh-roadmap/cli/lib/capacity.test.mjs',
    'plugins/zeroh-roadmap/cli/lib/config.mjs',
    'plugins/zeroh-roadmap/cli/lib/config.test.mjs',
    'plugins/zeroh-roadmap/cli/roadmap.config.schema.json',
    'plugins/zeroh-roadmap/cli/commands/capacity.mjs',
    'plugins/zeroh-roadmap/cli/commands/capacity.test.mjs',
    'plugins/zeroh-roadmap/bin/roadmap.mjs',
    'plugins/zeroh-roadmap/cli/commands/arc.mjs',
    'plugins/zeroh-roadmap/cli/commands/status.mjs',
    'plugins/zeroh-roadmap/cli/commands/arm.mjs',
    'plugins/zeroh-roadmap/templates/schema.ts',
    'lib/roadmap/schema.ts',
    'plugins/zeroh-roadmap/DESIGN-NOTES.md',
  ],
  stakeholderDemo:
    'Any session can ask the box "can another executor spawn right now?" and get a typed, reasoned verdict from live resources; arc execution refuses to start a phase on a starved box (operator-overridable); the dead executionMode field is gone.',
  userFacing: false,
  assumptions: [
    {
      claim: 'bin/roadmap.mjs dispatches via a COMMANDS registry and a dynamic import of cli/commands/<command>.mjs — a new verb is one registry row + one module.',
      verify: 'bash -c "grep -qF \'cli/commands/${command}.mjs\' plugins/zeroh-roadmap/bin/roadmap.mjs"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'RoadmapConfigShape is the ONE Zod shape and the committed roadmap.config.schema.json is generated from it with a drift subtest in config.test.mjs.',
      verify:
        'bash -c "grep -qF \'RoadmapConfigShape\' plugins/zeroh-roadmap/cli/lib/config.mjs && grep -qF \'z.toJSONSchema\' plugins/zeroh-roadmap/cli/generate-config-schema.mjs"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'Human `roadmap status` output is parity-pinned byte-compatible to the legacy script — the reason capacity NEVER prints in the default human status, only --json / the new verb / arm.',
      verify: 'bash -c "grep -qF \'BYTE-COMPATIBLE\' plugins/zeroh-roadmap/cli/commands/status.mjs"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'derive.mjs already speaks a blocked(reason) action that do-arc\'s halt vocabulary handles — the admission gate reuses it and adds ZERO prose to any budget-metered skill file.',
      verify: 'bash -c "grep -qF \'return blocked(\' plugins/zeroh-roadmap/cli/lib/derive.mjs"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'executionMode is consulted by no code and pinned by no test — removal is a schema-only act.',
      verify: 'bash -c "! grep -rn \'executionMode\' plugins/zeroh-roadmap/cli plugins/zeroh-roadmap/test plugins/zeroh-roadmap/scripts 2>/dev/null | grep -v test-logs"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'This box exposes the live signals the probes read: /proc/meminfo MemAvailable, /proc/loadavg, and systemd user units for capbuild (capbuild-<pid>.service transient scopes).',
      verify: 'bash -c "grep -q MemAvailable /proc/meminfo && test -r /proc/loadavg && systemctl --user list-units \'capbuild-*\' --no-legend >/dev/null"',
      onFalse: 'ESCALATE',
    },
  ],
  tasks: [
    {
      id: '11.1',
      title: 'cli/lib/capacity.mjs — typed verdict + injectable live-resource probes',
      problem:
        'Nothing in the plugin can answer "can another executor spawn right now" — spawn decisions today consult no resource signal, and the phase-10 investigation named live-capacity admission as the gate any parallelism needs (36 GB box, 6G capbuild cgroups, ~6 sessions).',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/capacity.mjs',
          description:
            'Export CapacityVerdictShape (zod): { canSpawn: boolean, maxParallel: int≥0, signals: [{name, value, limit, ok}], reasons: string[], degraded: string[] } — degraded lists probes unreadable on this host (non-Linux, no systemctl): those FAIL OPEN with the gap named, never block a spawn on missing evidence → verify: bash -c "grep -qF \'CapacityVerdictShape\' plugins/zeroh-roadmap/cli/lib/capacity.mjs"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/capacity.mjs',
          description:
            'Export probeCapacity(config, probes = defaultProbes), every reader injectable: memAvailableMb (/proc/meminfo MemAvailable), load1 + cores (/proc/loadavg, os.availableParallelism), runningCapbuildUnits (systemctl user units capbuild-*, degraded on failure), liveExecutorArms (executor-arm registry readers). Math: memSlots = floor((memAvailableMb − minFreeMemMb) / memPerExecutorMb); loadSlots = floor(max(0, cores − load1) / loadPerExecutor); maxParallel = max(0, min(memSlots, loadSlots, maxExecutors − busy)), busy = capbuild units + live arms; canSpawn = maxParallel ≥ 1; each binding constraint → a reasons[] line → verify: capbuild node --test plugins/zeroh-roadmap/cli/lib/capacity.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/capacity.test.mjs',
          description:
            'Behavioral tests with injected probes (RED first, tdd): mem-bound, load-bound, busy-bound (maxExecutors − busy), all-clear, degraded-probe fail-open (canSpawn true + the gap in degraded[] + a reasons line), and config-override precedence over defaults; verdicts parse through CapacityVerdictShape → verify: capbuild node --test plugins/zeroh-roadmap/cli/lib/capacity.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'capbuild node --test plugins/zeroh-roadmap/cli/lib/capacity.test.mjs exits 0 with all six behavior cases; a starved fixture yields canSpawn false with the binding constraint named in reasons',
      ],
      files: ['plugins/zeroh-roadmap/cli/lib/capacity.mjs', 'plugins/zeroh-roadmap/cli/lib/capacity.test.mjs'],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-08-26',
      transparencyReport: {
        whatWasDone:
          'cli/lib/capacity.mjs exports CapacityVerdictShape, DEFAULT_CAPACITY, defaultProbes (live /proc/meminfo, /proc/loadavg + availableParallelism, systemctl running capbuild-* units, live executor arms via liveArm over <toplevel>/.building MINUS the staleArms oracle set — gate R1 added the filter so a completed-but-undisarmed leftover never fails arc next CLOSED; oracle unreadable ⇒ fall back to liveArm alone) and probeCapacity(config, probes) with the admission math from the plan; degraded probes drop OUT of the min (never counted as zero slots), fail-open per-signal.',
        how:
          'TDD: test-engineer wrote 9 RED tests from the API contract only (module absent — ERR_MODULE_NOT_FOUND quoted), including exact-boundary pairs, underflow clamps, per-signal fail-open (degraded memory beside an at-cap executor signal still refuses), busy-as-sum, partial-config precedence, a shape-refusal case, and a live-box defaultProbes smoke; the test author mutation-validated the fixtures against a scratchpad reference (10/10 seeded mutants killed). Implementation went 9/9 first run.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None — the four policy bounds live in DEFAULT_CAPACITY (config-overridable per box), grounded in the recorded capbuild MemoryMax contract.',
        limitations:
          'liveExecutorArms counts arms in the CURRENT toplevel only — cross-worktree arms on the same box are invisible to the default probe (the capbuild-units signal still sees their gate load); a cross-worktree registry is a nameable follow-up if multi-arc-per-box becomes routine.',
      },
      interfaces: { consumes: [], produces: ['probeCapacity (cli/lib/capacity.mjs)', 'CapacityVerdictShape (cli/lib/capacity.mjs)'] },
    },
    {
      id: '11.2',
      title: 'Config: optional capacity block + regenerated JSON schema',
      problem:
        'Capacity thresholds are per-box policy (this box: 6G capbuild cap, 31G usable, ~6 sessions) — hardcoding them makes every other consumer box wrong; the plugin already routes all consumer knobs through the ONE strict RoadmapConfigShape with a generated editor schema.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/config.mjs',
          description:
            'Add optional CapacityConfigShape (z.strictObject, all fields optional): memPerExecutorMb (default 6144 — the capbuild MemoryMax), minFreeMemMb (4096), loadPerExecutor (2), maxExecutors (3); key `capacity` optional on RoadmapConfigShape; defaults live in capacity.mjs so an absent block means the defaults verbatim → verify: bash -c "grep -qF \'CapacityConfigShape\' plugins/zeroh-roadmap/cli/lib/config.mjs"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/roadmap.config.schema.json',
          description:
            'Regenerate via node plugins/zeroh-roadmap/cli/generate-config-schema.mjs (never hand-edit); config.test.mjs gains: a config WITH a capacity block parses, an unknown key inside it reds (strictObject), and the existing drift subtest covers the regenerated file → verify: capbuild node --test plugins/zeroh-roadmap/cli/lib/config.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'config.test.mjs exits 0 including the schema-drift subtest against the regenerated roadmap.config.schema.json; a capacity block with an unknown key fails parse',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/lib/config.mjs',
        'plugins/zeroh-roadmap/cli/lib/config.test.mjs',
        'plugins/zeroh-roadmap/cli/roadmap.config.schema.json',
      ],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-08-26',
      transparencyReport: {
        whatWasDone:
          'RoadmapConfigShape gained optional `capacity` (strictObject, all four fields optional positive integers, NO shape-level defaults so the parse round-trips byte-faithful and never shadows DEFAULT_CAPACITY); roadmap.config.schema.json regenerated via the generator (+26 lines); the drift subtest covers it.',
        how:
          'TDD: test-engineer added 6 RED cases (5 red + 1 deliberate regression guard green-today; root-level "Unrecognized key: capacity" failures quoted). The tester flagged that a bare .int() would admit 0 and divide the admission math by zero — resolved as .int().positive() (ambiguity → throw; one correct answer, no fork) with an added zero-rejects/one-parses boundary case. Suite 38/38 GREEN including drift.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'The boundary case was authored by the executor during the green step (the tester offered it conditional on the positivity ruling); RED discipline was served by the original 5.',
      },
      interfaces: { consumes: [], produces: ['config.capacity (CapacityConfigShape, cli/lib/config.mjs)'] },
    },
    {
      id: '11.3',
      title: 'roadmap capacity — the verb',
      problem:
        'The verdict needs a first-class door: sessions deciding whether to arm another lane, and any future fan-out, must have ONE command to consult — not a buried library call.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/capacity.mjs',
          description:
            'New command module (default export run(argv) returning exit code, the arm.mjs thin-command pattern): human output = verdict line + per-signal table + reasons; --json = the CapacityVerdictShape object verbatim; exit 0 when canSpawn, exit 3 when not (a scriptable gate), exit unchanged-0 under --json (the JSON carries the verdict) → verify: capbuild node --test plugins/zeroh-roadmap/cli/commands/capacity.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/bin/roadmap.mjs',
          description:
            "COMMANDS registry row: capacity: { phase: 11, sub: ['[--json]'], desc: 'live box-resource admission check — can another executor spawn right now (the mandatory gate for any parallel fan-out)' } → verify: bash -c \"node plugins/zeroh-roadmap/bin/roadmap.mjs capacity --json | node -e 'const c=[];process.stdin.on(String.fromCharCode(100,97,116,97),d=>c.push(d)).on(String.fromCharCode(101,110,100),()=>{const v=JSON.parse(c.join(String())); if(typeof v.canSpawn!==String.fromCharCode(98,111,111,108,101,97,110))process.exit(1)})'\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/capacity.test.mjs',
          description:
            'Subprocess tests (the command-test house pattern): --json parses through CapacityVerdictShape; a starved probe fixture (env-injected or config-injected) exits 3 with the binding reason on stdout; a clear fixture exits 0 → verify: capbuild node --test plugins/zeroh-roadmap/cli/commands/capacity.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'roadmap capacity --json emits a CapacityVerdictShape-valid object on this box; capacity.test.mjs exits 0 with the starved-exit-3 and clear-exit-0 cases',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/commands/capacity.mjs',
        'plugins/zeroh-roadmap/cli/commands/capacity.test.mjs',
        'plugins/zeroh-roadmap/bin/roadmap.mjs',
      ],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-08-26',
      transparencyReport: {
        whatWasDone:
          'roadmap capacity landed: human verdict line + per-signal table + reasons with exit 0/3 (3 = at capacity, the scriptable gate), --json = the CapacityVerdictShape object verbatim at exit 0; COMMANDS registry row added and the bin header exit-code contract updated to name capacity’s exit-3 meaning (the tester’s honesty note). Deterministic seam: env ZEROH_ROADMAP_CAPACITY_PROBES replaces ALL probes with fixed values; a malformed OR PARTIAL seam payload is a named exit-1 configuration refusal (task-time build used exit 2 and accepted partial payloads; gate R1 widened validation to all five readings and aligned the code to the bin contract), never a silent live fallback.',
        how:
          'TDD: test-engineer wrote 10 RED wired subprocess cases (unknown-command failures quoted; 11/11 seeded mutants killed against a scratch reference, including partial-seam leaks and narration bleed into --json stdout). Implementation went 10/10 first run; the plan’s registry verify (extracted verbatim at plan time) also green. Consumed interfaces grep-verified before building (probeCapacity, CapacityVerdictShape in cli/lib/capacity.mjs).',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None — the seam env name is a single exported-in-doc constant in the module.',
        limitations:
          'The seam env is honored in ALL contexts, not only tests — deliberately, as a dry-run simulation knob; an operator setting it and forgetting gets fixed verdicts, mitigated by the named env in every refusal and the doc header.',
      },
      dependsOn: ['11.1', '11.2'],
      interfaces: { consumes: ['probeCapacity (cli/lib/capacity.mjs)', 'CapacityVerdictShape (cli/lib/capacity.mjs)'], produces: [] },
    },
    {
      id: '11.4',
      title: 'Admission gate at arc next — refuse to start a phase on a starved box',
      problem:
        "do-arc's spawn site takes whatever `roadmap arc next` hands it; on a starved box that spawns a phase-executor whose capbuild gates will thrash or OOM-kill sibling sessions (the 2026-06-08 incident class). The gate belongs in the CLI choke point: derive's blocked(reason) action is already in do-arc's halt vocabulary, so NO budget-metered skill file grows.",
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/arc.mjs',
          description:
            'In the next handler, AFTER the derive verdict: when action === "run-phase" and probeCapacity(config).canSpawn is false, transform to the blocked shape with reason `box at capacity — <reasons.join("; ")> — re-run when load drops, or override with --ignore-capacity`; add the --ignore-capacity flag (operator override, logged to stderr when used); degraded-probe verdicts pass through untransformed (fail-open) → verify: capbuild node --test plugins/zeroh-roadmap/test/fixture-consumer/arc-next.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/test/fixture-consumer/arc-next.test.mjs',
          description:
            'Extend the existing arc-next harness: a starved capacity fixture turns a runnable member into blocked with the capacity reason; --ignore-capacity restores run-phase; a clear fixture is untouched (byte-equal action to the pre-gate derivation) → verify: capbuild node --test plugins/zeroh-roadmap/test/fixture-consumer/arc-next.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'arc-next.test.mjs exits 0: starved → blocked with capacity reason, --ignore-capacity → run-phase, clear box → derivation unchanged; no skills/*.md file in the do-arc measure flow grew (roadmap measure --flow do-arc --assert 13257 still exits 0)',
      ],
      files: ['plugins/zeroh-roadmap/cli/commands/arc.mjs', 'plugins/zeroh-roadmap/test/fixture-consumer/arc-next.test.mjs'],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-08-26',
      transparencyReport: {
        whatWasDone:
          'arc next gained the capacity admission gate: a run-phase on a starved box transforms to the blocked action (reason `box at capacity — <reasons> … --ignore-capacity`, refused member returned to remaining, exit 2 via the existing mapping); --ignore-capacity restores the untransformed derivation byte-for-byte with a stderr audit note naming the flag and the overridden reasons; the probe seam moved to cli/lib/capacity.mjs (seamProbes/SeamError/SEAM_ENV — ONE home shared with the capacity command). Gate scoped to run-phase only: refusing a RESUME would strand committed work mid-phase (the tester’s scope note, resolved per the plan’s explicit run-phase contract).',
        how:
          'TDD: test-engineer added N25-N29 (3 RED + 2 fence cases; real reason strings pre-verified against probeCapacity). Two implementation findings: the refused member had to go BACK into remaining (refused ≠ consumed), and N26 exposed a real harness defect — runCli dropped all exit-0 stderr because execFileSync only exposes stderr on the error object; fixed with spawnSync and the lesson flushed to the eval lane. arc-next 25/25; ALL fixture-consumer suites 73/73 after the harness change; do-arc budget still exactly 13257/13257 (acceptance criterion re-run).',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'test/fixture-consumer/harness.mjs joined the diff beyond the plan’s files[] (the runCli stderr capture fix N26 required). Seam-error handling in arc next: operator-set seam problems exit 1 loudly WITHOUT --ignore-capacity; under the override (gate R2) a seam error prints a named note ("override active — run-phase stands") and exits 0 with the derivation intact (pinned by N30, gate R3); a live-probe computation throw fails OPEN with a stderr note (untested by the N-cases — the lib tier owns degraded behavior).',
      },
      dependsOn: ['11.1'],
      interfaces: { consumes: ['probeCapacity (cli/lib/capacity.mjs)'], produces: [] },
    },
    {
      id: '11.5',
      title: 'Surface capacity where lane decisions happen: status --json and arm',
      problem:
        'Cross-arc lane parallelism (the sanctioned path today) is decided by humans reading `roadmap status` and arming lanes — but neither surface shows whether the box can carry another executor. The human status table is parity-pinned byte-compatible (assumption 3), so capacity rides the --json machine shape and the arm advisory, never the default human table.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/status.mjs',
          description:
            'Attach `capacity: <CapacityVerdictShape object>` to the --json output only (the additive-machine-shape divergence the file header already sanctions); the human table stays byte-identical so the status-parity test keeps passing → verify: capbuild node --test plugins/zeroh-roadmap/cli/commands/status.parity.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/arm.mjs',
          description:
            'After a successful arm, print ONE stderr advisory when canSpawn is false: `arm: box at capacity — <first reason>; this lane may thrash live executors` (advisory only — arming is a claim, not a spawn; refusal stays the lane-conflict rule) → verify: bash -c "grep -qF \'box at capacity\' plugins/zeroh-roadmap/cli/commands/arm.mjs"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/status.test.mjs',
          description:
            'Additive assertion: --json output carries a capacity key parsing through CapacityVerdictShape (injected clear-probe fixture) → verify: capbuild node --test plugins/zeroh-roadmap/cli/commands/status.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'status.parity.test.mjs still passes (human output untouched); status --json carries a shape-valid capacity object; arm prints the advisory only when canSpawn is false',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/commands/status.mjs',
        'plugins/zeroh-roadmap/cli/commands/status.test.mjs',
        'plugins/zeroh-roadmap/cli/commands/arm.mjs',
      ],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-08-26',
      transparencyReport: {
        whatWasDone:
          'status --json gained a top-level capacity key (CapacityVerdictShape, seam-honored; config-less estates read with library defaults — status is a read verb and never explodes where loadConfig refuses); the human table stays byte-identical (parity suite 2/2 before and after). arm prints one stderr advisory after a successful arm when canSpawn is false (arming is a claim, not a spawn — never a refusal), advisory math never fails the arm.',
        how:
          'TDD: test-engineer added 2 RED + 1 constraint-fence case (mutation-checked: a seam-ignoring implementation and a human-table capacity leak both kill); implementation 13/13 + parity 2/2 + arm-disarm 9/9 first run; arm grep verify green. The starved fixture is policy-independent (all three signals at zero slots) so no consumer config can flip it.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'The arm advisory was grep-verified only at task time; gate R1 test-pinned it (arm-disarm cases 10-11: starved prints, clear silent, broken seam NAMED, arm exit 0 — suite 11/11). Still untested: a malformed seam on status --json exits 1 named (the seam contract is pinned at the capacity-command and lib tiers).',
      },
      dependsOn: ['11.1'],
      interfaces: { consumes: ['probeCapacity (cli/lib/capacity.mjs)', 'CapacityVerdictShape (cli/lib/capacity.mjs)'], produces: [] },
    },
    {
      id: '11.6',
      title: 'Remove executionMode; record the resolution',
      problem:
        'The phase-10 investigation ruled the field models rejected task-level batching and is consulted by nothing (assumption 5 re-proved it); dynamic at-spawn-time capacity is its replacement, and the user ratified removal riding this phase.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/templates/schema.ts',
          description:
            'Delete the executionMode field + its RESERVED docblock from PhaseShape (old files carrying the key keep parsing — the compat probe in the verify proves it), then byte-sync lib/roadmap/schema.ts → verify: bash -c "! grep -qF \'executionMode\' plugins/zeroh-roadmap/templates/schema.ts && cmp plugins/zeroh-roadmap/templates/schema.ts lib/roadmap/schema.ts && node --import tsx -e \\"import(\'./lib/roadmap/schema.ts\').then(m=>process.exit(m.PhaseShape.safeParse({phase:900,name:\'probe here\',status:\'backlog\',category:\'fix\',source:\'probe source\',priority:\'LOW\',dependsOn:[],conflictsWith:[],keyFiles:[],stakeholderDemo:\'probe demo ok\',executionMode:\'sequential\',tasks:[]}).success?0:1))\\""',
        },
        {
          file: 'plugins/zeroh-roadmap/DESIGN-NOTES.md',
          description:
            'Append a dated resolution line to §Parallel dispatch investigation: option ratified 2026-08-26 (check + wire today\'s spawns), executionMode REMOVED in phase 11, and `roadmap capacity` is the mandatory admission gate any future fan-out (PARDISPATCH) must consult → verify: bash -c "grep -qF \'mandatory admission gate\' plugins/zeroh-roadmap/DESIGN-NOTES.md"',
        },
      ],
      acceptanceCriteria: [
        'No executionMode key remains in either schema copy; a phase object still carrying the key parses (compat probe in the step verify runs green); the DESIGN-NOTES section carries the dated resolution',
      ],
      files: ['plugins/zeroh-roadmap/templates/schema.ts', 'lib/roadmap/schema.ts', 'plugins/zeroh-roadmap/DESIGN-NOTES.md'],
      testMode: 'none',
      done: true,
      doneDate: '2026-08-26',
      transparencyReport: {
        whatWasDone:
          'executionMode deleted from PhaseShape in both schema copies (byte-synced); DESIGN-NOTES §Parallel dispatch gained the dated resolution: option ratified, field removed, roadmap capacity named as the mandatory admission gate for any future fan-out and its live wiring listed.',
        how:
          'The plan-time compound verify ran verbatim green: no executionMode in either copy, cmp byte-identical, and the compat probe proved a phase object still CARRYING the key parses (Zod strips unknown keys on the non-strict PhaseShape). scripts/schema.test.ts PASS — 0 failures.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'Historical prose naming executionMode (phase-10 records, the pre-resolution investigation text) stays as history — records are not rewritten; the resolution line supersedes them in place.',
      },
    },
  ],
  notes:
    'interview: conducted 2026-08-26 via AskUserQuestion (per the phase-10 default-on rule) — two rulings recorded: scope = check + wire today\'s spawn sites (not advisory-only, not full fan-out), and executionMode removal rides this phase. ' +
    'DECISIONS MADE AT PLAN TIME: (1) fail-open on degraded probes — a host where /proc or systemctl is unreadable gets canSpawn true with the gap named in degraded[]; blocking every non-Linux consumer on missing evidence would be worse than a missed protection (the check is protective-advisory, and the arc-next gate honors the same rule). (2) The admission gate lives in cli/commands/arc.mjs, NOT derive.mjs, keeping the derivation oracle pure and testable; it reuses the blocked action shape do-arc already handles, so NO do-arc-flow skill file grows (the budget sits at exactly 13257/13257 after phase 10 — assumption 4 is the zero-prose proof obligation, re-checked by 11.4\'s acceptance criterion). (3) Capacity NEVER prints in default human status (parity pin, assumption 3) — it rides status --json, the capacity verb, and the arm advisory. (4) Threshold defaults grounded in this box\'s recorded contract (capbuild MemoryMax 6G → memPerExecutorMb 6144; minFreeMemMb 4096; loadPerExecutor 2; maxExecutors 3) but every one config-overridable per box — the "dynamic per at-that-point resources" the user asked for is the LIVE probe; the config only sets policy bounds. ' +
    'PLAN-TIME PROBES: /proc/meminfo MemAvailable=25921392 kB and /proc/loadavg 0.23/16 cores read live; systemctl --user list-units capbuild-* exits 0 (3 failed remnant units listed, 0 running); executionMode grep over cli/, test/, scripts/ = zero hits (only schema docblock + phase-10 historical prose); COMMANDS registry + dynamic import confirmed at bin/roadmap.mjs:70. ' +
    'userFacing: false — plugin/CLI machinery for roadmap operators; no consumer app surface, no flag applies. ' +
    'Zero-test task 11.6 is legitimate: schema deletion + archival doc line, guarded by the compat-probe verify and the existing schema parse suite; all executable logic (11.1-11.5) is tdd.',
})
