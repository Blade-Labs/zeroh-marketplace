import { definePhase } from '@/lib/roadmap/schema'

/**
 * MINESWEEP arc-sweep follow-up — the whole-arc architect's three LOW findings
 * (2026-09-01 post-build review; verdict merge-ready, zero blockers). Deliberately
 * queued POST-arc: the architect ruled none of these gates the merge, and each is
 * a polish of a seam the arc already proved single.
 *
 * ## Hypotheses
 * 1. CONFIRMED — FOUR porcelain parses of `git worktree list` exist (worktree.mjs
 *    checkoutOf :278, surveyLanes :477, executor-arm.mjs worktreeRoots :73-79, and
 *    status.mjs derive() step (1) :67 — the sidecar-correlation parse whose own :253
 *    comment says it "predates the seam"; the sweep counted three, Mode A found the fourth),
 *    each answering a different question but each re-parsing the same block format;
 *    the architect ruled worktreeRoots is not a classifier FORK (it needs the
 *    primary + slots that surveyLanes structurally excludes), yet the seam's letter
 *    wants ONE enumerator under them.
 * 2. REFUTED — "the tsx-bridge hint is fine": it says `run npm ci in the consumer
 *    checkout` (tsx-bridge.mjs:23), tone-deaf to the arc's LOCKED lockfile ruling —
 *    prose-only and pre-arc, but a taught form that contradicts a landed rail.
 *
 * timing: no reference data for 1-3×surface:false
 */
export default definePhase({
  phase: 21,
  name: 'Arc-sweep LOW follow-ups: one worktree enumerator, lockfile-aware tsx hint, envelope colon',
  status: 'in-progress',
  plannedBy: { model: 'claude-fable-5' },
  reviewRecord: { date: '2026-09-01', model: 'claude-fable-5-1', verdict: 'READY', via: 'executed' },
  category: 'refactor',
  kind: 'hardening',
  source:
    "MINESWEEP arc-sweep Step 2 whole-arc architect review 2026-09-01 — three LOW findings, all explicitly non-blocking ('none of these gates the merge').",
  priority: 'LOW',
  dependsOn: [14, 19],
  conflictsWith: [],
  keyFiles: [
    'plugins/zeroh-roadmap/cli/lib/worktree.mjs',
    'plugins/zeroh-roadmap/cli/lib/worktree.test.mjs',
    'plugins/zeroh-roadmap/cli/lib/executor-arm.mjs',
    'plugins/zeroh-roadmap/cli/commands/status.mjs',
    'plugins/zeroh-roadmap/cli/commands/status.test.mjs',
    'plugins/zeroh-roadmap/cli/lib/tsx-bridge.mjs',
    'plugins/zeroh-roadmap/cli/lib/tsx-bridge.test.mjs',
    'plugins/zeroh-roadmap/cli/commands/codex.mjs',
    'plugins/zeroh-roadmap/cli/commands/codex.test.mjs',
  ],
  stakeholderDemo:
    'The worktree-porcelain block format is parsed in exactly one exported helper; the tsx-absent hint teaches the lockfile-keyed install the arc ruled; the envelope and the agent cards teach one identical task-subject form.',
  userFacing: false,
  assumptions: [
    {
      claim: 'Four separate porcelain parses exist (worktree.mjs x2, executor-arm.mjs, status.mjs) and no shared enumerator does.',
      verify:
        'bash -c "test \\"$(grep -cF \'export function listWorktrees\' plugins/zeroh-roadmap/cli/lib/worktree.mjs)\\" = \\"0\\" && grep -qF \\"[\'worktree\', \'list\', \'--porcelain\']\\" plugins/zeroh-roadmap/cli/lib/worktree.mjs && grep -qF \\"\'worktree\', \'list\', \'--porcelain\'\\" plugins/zeroh-roadmap/cli/lib/executor-arm.mjs && grep -qF \\"[\'worktree\', \'list\', \'--porcelain\'], repo\\" plugins/zeroh-roadmap/cli/commands/status.mjs"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The tsx-absent hint still teaches a bare npm ci.',
      verify: 'bash -c "grep -qF \'run npm ci in the consumer checkout\' plugins/zeroh-roadmap/cli/lib/tsx-bridge.mjs"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The envelope teaches the task form with a colon while the 16.4 cards teach it without.',
      verify: 'bash -c "grep -qF \'phase N — N.X: <what>\' plugins/zeroh-roadmap/cli/commands/codex.mjs && grep -qF \'phase N — N.X <what>\' plugins/zeroh-roadmap/agents/quality-pass.md"',
      onFalse: 'ESCALATE',
    },
  ],
  tasks: [
    {
      id: '21.1',
      title: 'listWorktrees: one exported porcelain enumerator under all four parsers',
      problem:
        'checkoutOf, surveyLanes, executor-arm worktreeRoots AND status.mjs derive() step (1) (cli/commands/status.mjs:67, the sidecar-correlation path→branch map) each re-parse `git worktree list --porcelain` block output; the arc singleSeam wants one enumerator even though the four CONSUMERS legitimately filter/shape differently.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/worktree.mjs',
          description:
            "Export listWorktrees(root) → [{ dir, branch|null }] parsing the porcelain blocks once (branch null for detached); route checkoutOf and surveyLanes through it, each keeping its OWN filtering (checkoutOf finds the block holding a ref; surveyLanes keeps its primary/slot exclusions verbatim) → verify: bash -c \"grep -qF 'export function listWorktrees' plugins/zeroh-roadmap/cli/lib/worktree.mjs && cd plugins/zeroh-roadmap && capbuild node --test cli/lib/worktree.test.mjs >/dev/null 2>&1\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/executor-arm.mjs',
          description:
            'worktreeRoots consumes listWorktrees (it wants EVERY root including primary and slots — filtering none is a legal consumption of the shared enumerator) → verify: bash -c "grep -qF \'listWorktrees\' plugins/zeroh-roadmap/cli/lib/executor-arm.mjs && cd plugins/zeroh-roadmap && capbuild node --test cli/commands/executor-arm-disarm.test.mjs >/dev/null 2>&1"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/status.mjs',
          description:
            'derive() step (1) builds its path→branch Map from listWorktrees(repo), mapping branch null to the existing \'(detached)\' label so the parity-pinned human table stays byte-identical; the :253 comment drops its "pre-existing porcelain parse" clause → verify: bash -c "! grep -qF \\"[\'worktree\', \'list\', \'--porcelain\'], repo\\" plugins/zeroh-roadmap/cli/commands/status.mjs && grep -qF \'listWorktrees\' plugins/zeroh-roadmap/cli/commands/status.mjs && cd plugins/zeroh-roadmap && capbuild node --test cli/commands/status.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'Exactly ONE porcelain parse of worktree-list blocks remains in the plugin (grep -F for the worktree/list/--porcelain argv across cli/lib + cli/commands non-test files finds only listWorktrees); all existing worktree/arm/status/audit tests stay green',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/lib/worktree.mjs',
        'plugins/zeroh-roadmap/cli/lib/worktree.test.mjs',
        'plugins/zeroh-roadmap/cli/lib/executor-arm.mjs',
        'plugins/zeroh-roadmap/cli/commands/status.mjs',
        'plugins/zeroh-roadmap/cli/commands/status.test.mjs',
      ],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-09-02',
      transparencyReport: {
        whatWasDone:
          'Added one exported listWorktrees porcelain parser and routed checkoutOf, surveyLanes, executor-arm worktreeRoots, and status through it without changing their consumer-specific filtering or labels.',
        how:
          'The independent claude-opus-5 test-engineer added two RED tests: the missing exported shape and the four-parser inventory failed while the detached-status compatibility guard stayed green. The implementation returns every registered worktree as { dir, branch: string|null }; status alone maps null to its established detached label. The focused worktree, status, and executor-arm suites passed 106/106; the types slot was declared-none.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations: 'None',
      },
    },
    {
      id: '21.2',
      title: 'tsx-absent hint teaches the lockfile-keyed install',
      problem:
        "tsx-bridge.mjs:23's remedy line says `run npm ci in the consumer checkout` — the exact assumption the arc's LOCKED lockfile ruling retired; a pnpm consumer following it hits the doomed install the arc fixed elsewhere.",
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/tsx-bridge.mjs',
          description:
            'Reword the hint to name the committed lockfile as the decider (pnpm-lock.yaml → pnpm install --frozen-lockfile; package-lock.json → npm ci) → verify: bash -c "! grep -qF \'run npm ci in the consumer checkout\' plugins/zeroh-roadmap/cli/lib/tsx-bridge.mjs && grep -qF \'frozen-lockfile\' plugins/zeroh-roadmap/cli/lib/tsx-bridge.mjs"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/tsx-bridge.test.mjs',
          description:
            'Re-pin the VERBATIM string test (:94-97 asserts the full old literal) and the stderr regex (:173 matches /run npm ci in the consumer checkout/) to the new lockfile-keyed wording — the pin is the point, so it moves WITH the string, never loosens to a substring → verify: bash -c "grep -qF \'assert.doesNotMatch\' plugins/zeroh-roadmap/cli/lib/tsx-bridge.test.mjs && grep -qF \'frozen-lockfile\' plugins/zeroh-roadmap/cli/lib/tsx-bridge.test.mjs && cd plugins/zeroh-roadmap && capbuild node --test cli/lib/tsx-bridge.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: ['The hint names both lockfile-keyed recipes; no bare npm ci prose remains in tsx-bridge.mjs or its test; tsx-bridge suite green'],
      files: ['plugins/zeroh-roadmap/cli/lib/tsx-bridge.mjs', 'plugins/zeroh-roadmap/cli/lib/tsx-bridge.test.mjs'],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-09-02',
      transparencyReport: {
        whatWasDone:
          'Replaced the unconditional npm-ci remediation with one lockfile-keyed hint naming the pnpm and npm frozen-install recipes.',
        how:
          'The independent claude-opus-5 test-engineer moved the full literal pin and added recipe-order and emitted-stderr coverage, producing 4 RED failures before implementation. The final tsx-bridge suite passed 28/28 and the types slot was declared-none.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'The original step verify required the retired npm-ci phrase to be absent even from its negative assertion; gate Round 0 re-keyed it to the explicit doesNotMatch guard and lockfile wording.',
      },
    },
    {
      id: '21.3',
      title: 'One taught task-subject form: drop the envelope colon',
      problem:
        "codex.mjs's COMMIT_GRAMMAR teaches `phase N — N.X: <what>` while the 16.4 agent cards teach `phase N — N.X <what>`; attribution is indifferent (both match the canonical alternation) but two taught forms is the drift the grammar seam exists to end.",
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.mjs',
          description:
            'Align the envelope to the cards\' colonless form, funding the zero-byte edit trivially; envelope-overhead ratchet must stay green → verify: bash -c "! grep -qF \'phase N — N.X: <what>\' plugins/zeroh-roadmap/cli/commands/codex.mjs && cd plugins/zeroh-roadmap && capbuild node --test cli/lib/roles.test.mjs cli/commands/codex.test.mjs >/dev/null 2>&1"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.test.mjs',
          description:
            'Re-key the 15.3 grammar pins to the colonless form: the test-local COMMIT_GRAMMAR table\'s task re (:3338, keyed on the colon) and the grammarLine finder (:3377, /N\\.X:/) would both red the envelope edit; both move to the dash-bound form the attribution regex binds on (gitscan.mjs:54-64) → verify: bash -c "grep -qF \"TAUGHT_TASK_FORM = \'phase N — N.X <what>\'\" plugins/zeroh-roadmap/cli/commands/codex.test.mjs && grep -qF \'COLON_TASK_FORM_RE\' plugins/zeroh-roadmap/cli/commands/codex.test.mjs && cd plugins/zeroh-roadmap && capbuild node --test cli/commands/codex.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: ['grep finds one taught task-subject form across envelope + cards + the codex test pins; roles/codex suites green'],
      files: ['plugins/zeroh-roadmap/cli/commands/codex.mjs', 'plugins/zeroh-roadmap/cli/commands/codex.test.mjs'],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-09-02',
      transparencyReport: {
        whatWasDone:
          'Aligned the Codex execution envelope with the agent cards by removing the task-subject colon while retaining the attribution-bound prefix and all other grammar.',
        how:
          'The independent claude-opus-5 test-engineer re-keyed the grammar pins and added a one-byte ratchet assertion, producing 4 RED failures before the one-character implementation edit. The focused codex and role suites passed 157/157, including the envelope-overhead ratchet; the types slot was declared-none.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'The original step verify required the colon token to be absent even from its negative regex; gate Round 0 re-keyed it to the shared colonless-form constant and explicit colon-form refusal.',
      },
    },
  ],
  notes:
    'interview: skipped — all three items are verbatim architect findings from the MINESWEEP arc-sweep, each graded LOW and explicitly non-blocking; the disposition (PLAN-PHASE, post-arc) is recorded in the sweep report. ' +
    '3 tasks below the 4-floor for a nameable reason: the phase IS the architect\'s finding list; padding would invent work. reviewScope light justified: mechanical consolidations of seams the arc just proved single, each pinned by existing suites. ' +
    'Verify rehearsal attestation: assumption probes executed 2026-09-01, all exit 0 (listWorktrees 0 hits; the npm-ci hint literal present; both grammar forms present in their respective homes); step verifies red-now via their grep halves (listWorktrees absent, hint literal present so its negation is red, the colon form present so its negation is red); runner clauses inherit polarity from the grep representatives. Authored with --skip-review; Mode A review EXECUTED 2026-09-01 (claude-fable-5-1, standalone inline): READY after four [FIXED] repairs — (1) hypothesis 1 undercounted: status.mjs:67 is a FOURTH porcelain parse (its own :253 comment names it pre-seam), so 21.1 gained the status.mjs step + status.test.mjs; (2) 21.2 missed tsx-bridge.test.mjs, which string-pins the old hint at :94-97 and regex-matches it at :173; (3) 21.3 missed codex.test.mjs, whose 15.3 pins key on the colon at :3338/:3377; (4) testMode none→tdd on 21.2/21.3 since each now moves a pin. Ratified: reviewScope light stands (mechanical seam consolidations, every touched file suite-pinned); userFacing false (plugin internals); 3-task floor exception stands. Attribution indifference re-verified at gitscan.mjs:54-64 (binds on `phase N —`; the colon is outside the bound prefix).',
})
