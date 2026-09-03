import { definePhase } from '@/lib/roadmap/schema'

/**
 * Curate never rewrites published history — the range stops at the integration ref.
 *
 * Incident 2026-09-02 (phase 23): a Claude executor committed the six task commits directly
 * on feat/roadmap-arcs; the gate then finished on a codex lane branched from that tip; the
 * lane's `roadmap phase curate` derived its range from the phase-start commit and squashed
 * the ALREADY-PUBLISHED task commits together with its own gate fixes into one commit
 * (d7abfe5). `phase land` then had to replay changes the branch already carried, and the
 * supervising session rebuilt the lane by hand (tree ids compared) before landing. A phase
 * started by one driver and finished by another is now a supported shape (phase 24 policies,
 * lane relaunches), so the guard belongs in the range derivation.
 *
 * ## Hypotheses
 * 1. CONFIRMED — deriveCurationRange (curate.mjs) takes `derivePhaseStartSha(cwd, phaseNum)..HEAD`
 *    and refuses only on FOREIGN subjects; nothing consults the integration ref, so a range
 *    whose lower part is already reachable from feat/roadmap-arcs (or origin/…) is squashed
 *    like unpublished work.
 * 2. CONFIRMED — the caller knows the ref: cli/commands/phase.mjs imports integrationRefOf
 *    (config.mjs) and uses it for land (phase.mjs:377) but passes nothing to the curate path.
 * 3. REFUTED — "land's rebase catches it": land rebases the lane onto the integration ref; a
 *    squash that re-applies published hunks conflicts on every shared file, which is exactly the
 *    2026-09-02 failure, not a guard.
 *
 * timing: band 1-3 × surface:false, N=2, median 219.3 min, p80 221.5 min
 */
export default definePhase({
  phase: 27,
  name: 'Curate stops at the integration ref: published commits are never squashed',
  status: 'done',
  completedDate: '2026-09-03',
  gate: {
    lint: 'clean', typeCheck: 'clean',
    unitTests: { passed: 1861, total: 1861, notes: 'Authoritative full gate roadmap/.gate/27/run-000003-2026-09-03T04-44-48-561Z.json was GREEN; the capped unit slot completed in 1,970,229 ms.' },
    integrationTests: { passed: 10, total: 10, notes: 'Hardening closure used the fixture-consumer lifecycle suite; the full gate also included it.' },
    e2eTests: { passed: 0, total: 0, notes: 'declared-none; no rendered surface.' }, build: 'clean',
  },
  gateRounds: [
    { round: 0, agent: 'quality-pass', model: 'gpt-5.6-sol', verdict: 'findings-fixed', summary: 'Closed ancestry-ordering and real phase-land lifecycle proof gaps.' },
    { round: 1, agent: 'code-reviewer', model: 'gpt-5.6-sol', verdict: 'clean', summary: 'Both prior MEDIUM findings independently verified closed; no new correctness findings.' },
  ],
  metrics: { commits: 1, linesAdded: 266, linesRemoved: 14, filesChanged: 8, testsAtStart: 1854, testsAtEnd: 1861, testsAdded: 7, startedAt: '2026-09-03T03:19:04.731Z', completedAt: '2026-09-03T04:45:57.000Z' },
  compromises: 'No unratified implementation compromise remains; both quality findings were fixed and independently re-reviewed.',
  executionResult: {
    phase: 27, status: 'done', driver: { model: 'gpt-5.6-sol', lane: 'codex' },
    modelPolicy: { source: 'config', preset: 'codex' },
    roles: [
      { role: 'test-engineer', model: 'gpt-5.6-sol', via: 'native' },
      { role: 'test-engineer', model: 'gpt-5.6-sol', via: 'native' },
      { role: 'quality-pass', model: 'gpt-5.6-sol', via: 'native' },
      { role: 'code-reviewer', model: 'gpt-5.6-sol', via: 'native' },
    ],
    compromises: [], skipped: [], hardcoded: [],
    surfaced: [
      'The plugin-local dependency link was absent in this lane; a temporary ignored symlink to the existing installed dependency tree was retained through scoped verification and the authoritative full gate.',
      'The full gate exceeded the execution transport lifetime twice; the final single capped run was detached from that transport and monitored to its green report without running a duplicate.',
      'The curation composer emits a generic Claude trailer, so the generated curated commit message was immediately corrected to the binding Claude Fable 5 trailer without changing its tree.',
    ],
    hardStops: [], gateRounds: 2,
  },
  plannedBy: { model: 'claude-fable-5-1' },
  reviewRecord: { date: '2026-09-02', model: 'claude-fable-5-1', verdict: 'READY', via: 'executed' },
  category: 'fix',
  kind: 'hardening',
  source:
    'Incident 2026-09-02 while landing phase 23 (lane codex-23 curated d7abfe5 over task commits already on feat/roadmap-arcs; land conflicted; rebuilt by hand). Planned as one of the two real trial phases for phase 26.4 per the supervising session\'s resolution of the lane\'s blocking question (option 1).',
  priority: 'HIGH',
  dependsOn: [],
  conflictsWith: [],
  keyFiles: [
    'plugins/zeroh-roadmap/cli/lib/curate.mjs',
    'plugins/zeroh-roadmap/cli/lib/curate.test.mjs',
    'plugins/zeroh-roadmap/cli/commands/phase.mjs',
    'plugins/zeroh-roadmap/test/fixture-consumer/harness.mjs',
  ],
  stakeholderDemo:
    'A lane branched from a branch that already carries a phase\'s task commits curates ONLY its own gate-fix commits; `phase land` fast-forwards cleanly; the dry run names how many commits were left alone because the integration ref already has them; a range that is entirely published is a named no-op, never a rewrite.',
  userFacing: false,
  assumptions: [
    {
      claim: 'deriveCurationRange consults no integration ref.',
      verify: 'bash -c "grep -qF \'export function deriveCurationRange(cwd, phaseNum)\' plugins/zeroh-roadmap/cli/lib/curate.mjs && test \\"$(grep -c \'merge-base\' plugins/zeroh-roadmap/cli/lib/curate.mjs)\\" = \\"0\\""',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The curate command in phase.mjs does not pass the integration ref into the range derivation.',
      verify: 'bash -c "grep -qF \'const range = deriveCurationRange(cwd, phaseNum)\' plugins/zeroh-roadmap/cli/commands/phase.mjs"',
      onFalse: 'ESCALATE',
    },
  ],
  tasks: [
    {
      id: '27.1',
      title: 'deriveCurationRange clamps its base to the merge-base with the integration ref (and its origin twin)',
      problem:
        'The range is `phaseStart..HEAD` regardless of what the integration ref already contains (curate.mjs deriveCurationRange), so commits shared with feat/roadmap-arcs are squashed and the lane can no longer land by fast-forward.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/curate.mjs',
          description:
            "deriveCurationRange(cwd, phaseNum, { integrationRef }): base = the LATER of derivePhaseStartSha and `git merge-base HEAD <integrationRef>` (and `origin/<integrationRef>` when that ref exists — the higher of the two); commits at or below it are returned as `published: [{sha, subject}]`, never in `commits`. A range with zero unpublished commits returns { ok: true, commits: [], published, noop: 'every commit is already on <ref>' }. Absent integrationRef = today's behaviour → verify: bash -c \"grep -qF 'merge-base' plugins/zeroh-roadmap/cli/lib/curate.mjs && cd plugins/zeroh-roadmap && capbuild node --test cli/lib/curate.test.mjs >/dev/null 2>&1\"",
        },
      ],
      acceptanceCriteria: [
        'curate.test.mjs: the 2026-09-02 shape (phase start + task commits on the integration ref, gate fixes above on a lane) yields a range of the gate fixes only with the task commits listed as published; an entirely published range is a named no-op; no integrationRef reproduces the old range; origin/<ref> ahead of the local ref raises the base to the origin merge-base',
      ],
      files: ['plugins/zeroh-roadmap/cli/lib/curate.mjs', 'plugins/zeroh-roadmap/cli/lib/curate.test.mjs'],
      testMode: 'tdd',
      interfaces: { consumes: [], produces: ['deriveCurationRange opts.integrationRef', 'range.published', 'range.noop'] },
      transparencyReport: {
        whatWasDone: 'Made curation integration-aware so history already reachable from the local or origin integration ref is reported as published and excluded from rewriting, including a named all-published no-op.',
        how: 'The independent gpt-5.6-sol test-engineer added four real-Git cases and established RED at 31 pass / 3 fail. The implementation compares available integration merge-bases by ancestry, refuses incomparable published boundaries, enumerates phase history between the original phase base and the selected boundary as published, and preserves the exact legacy result shape when integrationRef is omitted. GREEN ran 34/34 tests; the gate review added a divergent-history regression, and the types slot was declared-none and green.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations: 'None',
      },
      done: true,
      doneDate: '2026-09-03',
    },
    {
      id: '27.2',
      title: 'phase curate passes the ref and says what it left alone; the fixture proves the land',
      problem:
        'phase.mjs curate calls deriveCurationRange(cwd, phaseNum) with no ref (the land path already resolves integrationRefOf(config) at phase.mjs:377), and nothing end-to-end proves a mixed-driver phase lands by fast-forward after curation.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/phase.mjs',
          description:
            'The curate command resolves `integrationRefOf(loadConfig(cwd))` and passes it; the dry-run plan prints `N commit(s) already on <ref> — left out of the curation range` and the no-op reason when nothing is curatable (exit 0, nothing rewritten); the codex lane prompt needs no change (it runs the same verb) → verify: bash -c "grep -qF \'deriveCurationRange(cwd, phaseNum, { integrationRef\' plugins/zeroh-roadmap/cli/commands/phase.mjs && cd plugins/zeroh-roadmap && capbuild node --test cli/commands/phase.test.mjs >/dev/null 2>&1"',
        },
        {
          file: 'plugins/zeroh-roadmap/test/fixture-consumer/lifecycle.test.mjs',
          description:
            'Fixture-consumer direction: task commits landed on the integration ref by one driver, a lane branch with two gate-fix commits, `phase curate --apply` → one curated commit above the published tip, `phase land` fast-forwards with no conflict; the negative twin (today\'s behaviour) is the RED before 27.1 → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'already on\' test/fixture-consumer/lifecycle.test.mjs && capbuild node --test test/fixture-consumer/lifecycle.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'The end-to-end direction lands by fast-forward; the dry run names the published count; existing lifecycle and phase suites stay green',
      ],
      files: ['plugins/zeroh-roadmap/cli/commands/phase.mjs', 'plugins/zeroh-roadmap/cli/commands/phase.test.mjs', 'plugins/zeroh-roadmap/test/fixture-consumer/lifecycle.test.mjs'],
      testMode: 'tdd',
      dependsOn: ['27.1'],
      interfaces: { consumes: ['deriveCurationRange opts.integrationRef from 27.1', 'range.published from 27.1'], produces: [] },
      transparencyReport: {
        whatWasDone: 'Wired phase curate to the configured integration ref, made its plan name published history and cleanly no-op when all phase commits are already published, and added a fixture-consumer fast-forward landing proof.',
        how: 'The independent gpt-5.6-sol test-engineer added a command contract and a real-CLI mixed-driver lifecycle flow; the phase suite established RED at 51 pass / 1 fail. The CLI resolves integrationRef through the existing config seam and injects it into runCurate, which reports the excluded count before composing only unpublished groups. GREEN ran 52/52 phase-command tests and 10/10 lifecycle tests; both consumed interfaces were found in runtime code, and the types slot was declared-none and green.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations: 'The lifecycle runner initially could not collect because this lane lacked plugin-local node_modules; an ignored symlink to the already-installed worktree-root dependencies restored the intended test environment without changing tracked files.',
      },
      done: true,
      doneDate: '2026-09-03',
    },
  ],
  notes:
    'interview: skipped — the phase is the verbatim incident of 2026-09-02 (recorded in the session handoff and the phase-23 landing), planned by the supervising session to resolve the codex-26 lane\'s blocking question (option 1: two reviewed READY phases for the 26.4 trial). Two tasks below the floor for a nameable reason: one guard plus its end-to-end proof; padding would invent work. userFacing false: plugin CLI internals. ' +
    'Verify rehearsal attestation: assumption probes executed 2026-09-02 at plan time — the two-arg signature present, merge-base 0 hits in curate.mjs, the bare call present in phase.mjs (all exit 0). Step verifies red-now via their grep halves (no merge-base, no integrationRef argument on the curate call — the land path\'s own uses of the word are why the verify pins the call form, no \'already on\' in lifecycle.test); runner clauses inherit polarity from the grep representatives. Mode A review EXECUTED 2026-09-02 (claude-fable-5-1, standalone inline): deriveCurationRange re-read (curate.mjs, base = phase start, foreign-only refusal), the curate call site and the land path\'s integrationRefOf use re-read (phase.mjs:377); [FIXED] the 27.2 verify grepped a word the land path already carries — pinned to the call form. Ratified: 2-task floor exception, testMode tdd both, userFacing false. Placement: HIGH, no deps or conflicts → 1 of 4.',
})
