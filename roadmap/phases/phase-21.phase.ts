import { definePhase } from '@/lib/roadmap/schema'

/**
 * MINESWEEP arc-sweep follow-up — the whole-arc architect's three LOW findings
 * (2026-09-01 post-build review; verdict merge-ready, zero blockers). Deliberately
 * queued POST-arc: the architect ruled none of these gates the merge, and each is
 * a polish of a seam the arc already proved single.
 *
 * ## Hypotheses
 * 1. CONFIRMED — three porcelain parses of `git worktree list` exist (worktree.mjs
 *    checkoutOf :278, surveyLanes ~:477, executor-arm.mjs worktreeRoots :72-79),
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
  status: 'backlog',
  plannedBy: { model: 'claude-fable-5' },
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
    'plugins/zeroh-roadmap/cli/lib/tsx-bridge.mjs',
    'plugins/zeroh-roadmap/cli/commands/codex.mjs',
  ],
  stakeholderDemo:
    'The worktree-porcelain block format is parsed in exactly one exported helper; the tsx-absent hint teaches the lockfile-keyed install the arc ruled; the envelope and the agent cards teach one identical task-subject form.',
  userFacing: false,
  assumptions: [
    {
      claim: 'Three separate porcelain parses exist and no shared enumerator does.',
      verify:
        'bash -c "test \\"$(grep -cF \'export function listWorktrees\' plugins/zeroh-roadmap/cli/lib/worktree.mjs)\\" = \\"0\\" && grep -qF \\"[\'worktree\', \'list\', \'--porcelain\']\\" plugins/zeroh-roadmap/cli/lib/worktree.mjs && grep -qF \\"\'worktree\', \'list\', \'--porcelain\'\\" plugins/zeroh-roadmap/cli/lib/executor-arm.mjs"',
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
      title: 'listWorktrees: one exported porcelain enumerator under all three parsers',
      problem:
        'checkoutOf, surveyLanes and executor-arm worktreeRoots each re-parse `git worktree list --porcelain` block output; the arc singleSeam wants one enumerator even though the three CONSUMERS legitimately filter differently.',
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
      ],
      acceptanceCriteria: [
        'Exactly ONE porcelain parse of worktree-list blocks remains in the plugin (grep for the block-split idiom finds only listWorktrees); all existing worktree/arm/status/audit tests stay green',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/lib/worktree.mjs',
        'plugins/zeroh-roadmap/cli/lib/worktree.test.mjs',
        'plugins/zeroh-roadmap/cli/lib/executor-arm.mjs',
      ],
      testMode: 'tdd',
      done: false,
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
      ],
      acceptanceCriteria: ['The hint names both lockfile-keyed recipes; no bare npm ci prose remains in tsx-bridge.mjs'],
      files: ['plugins/zeroh-roadmap/cli/lib/tsx-bridge.mjs'],
      testMode: 'none',
      done: false,
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
      ],
      acceptanceCriteria: ['grep finds one taught task-subject form across envelope + cards; roles/codex suites green'],
      files: ['plugins/zeroh-roadmap/cli/commands/codex.mjs'],
      testMode: 'none',
      done: false,
    },
  ],
  notes:
    'interview: skipped — all three items are verbatim architect findings from the MINESWEEP arc-sweep, each graded LOW and explicitly non-blocking; the disposition (PLAN-PHASE, post-arc) is recorded in the sweep report. ' +
    '3 tasks below the 4-floor for a nameable reason: the phase IS the architect\'s finding list; padding would invent work. reviewScope light justified: mechanical consolidations of seams the arc just proved single, each pinned by existing suites. ' +
    'Verify rehearsal attestation: assumption probes executed 2026-09-01, all exit 0 (listWorktrees 0 hits; the npm-ci hint literal present; both grammar forms present in their respective homes); step verifies red-now via their grep halves (listWorktrees absent, hint literal present so its negation is red, the colon form present so its negation is red); runner clauses inherit polarity from the grep representatives. Authored with --skip-review: plan unverified, NOT queued — queue after a Mode A review post-arc.',
})
