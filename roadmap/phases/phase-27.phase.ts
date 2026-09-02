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
  status: 'backlog',
  plannedBy: { model: 'claude-fable-5-1' },
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
      done: false,
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
      done: false,
    },
  ],
  notes:
    'interview: skipped — the phase is the verbatim incident of 2026-09-02 (recorded in the session handoff and the phase-23 landing), planned by the supervising session to resolve the codex-26 lane\'s blocking question (option 1: two reviewed READY phases for the 26.4 trial). Two tasks below the floor for a nameable reason: one guard plus its end-to-end proof; padding would invent work. userFacing false: plugin CLI internals. ' +
    'Verify rehearsal attestation: assumption probes executed 2026-09-02 at plan time — the two-arg signature present, merge-base 0 hits in curate.mjs, the bare call present in phase.mjs (all exit 0). Step verifies red-now via their grep halves (no merge-base, no integrationRef argument on the curate call — the land path\'s own uses of the word are why the verify pins the call form, no \'already on\' in lifecycle.test); runner clauses inherit polarity from the grep representatives.',
})
