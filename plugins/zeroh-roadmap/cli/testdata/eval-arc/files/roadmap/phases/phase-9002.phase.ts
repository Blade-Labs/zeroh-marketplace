import { definePhase } from '../../lib/roadmap/schema.js'

/**
 * Fixture phase 9002 — the PARTIALLY-RECORDED vintage, and every cohort's other side:
 * NO driver on the executionResult (the unrecorded-driver case the scorer must name
 * rather than guess), NO plannedBy, no web/ keyFiles (the non-surface cohort), two
 * tasks, and a 90-minute record with haltCount 2 (the interrupted case timing stats
 * must EXCLUDE and COUNT).
 */
export default definePhase({
  phase: 9002,
  name: 'the partially recorded fixture phase',
  arcId: 'EVALFIX',
  status: 'done',
  category: 'feature',
  kind: 'hardening',
  source: 'fixture corpus for the arc eval engine',
  priority: 'MEDIUM',
  dependsOn: [9001],
  conflictsWith: [],
  keyFiles: ['src/scorer.ts', 'cli/lib/eval-score.mjs'],
  stakeholderDemo: 'the scorer maps every absence to a named sentinel',
  completedDate: '2026-07-17',
  gate: {
    lint: 'warnings',
    typeCheck: 'clean',
    unitTests: { passed: 8, total: 8 },
    integrationTests: { passed: 0, total: 0 },
    e2eTests: { passed: 0, total: 0 },
    build: 'clean',
  },
  gateRounds: [
    { round: 1, agent: 'code-reviewer', verdict: 'clean', findings: [], summary: 'one correctness round, clean' },
  ],
  metrics: {
    commits: 2,
    linesAdded: 180,
    linesRemoved: 12,
    filesChanged: 3,
    testsAtStart: 112,
    testsAtEnd: 120,
    testsAdded: 8,
    startedAt: '2026-07-17T09:00:00.000Z',
    completedAt: '2026-07-17T10:30:00.000Z',
    haltCount: 2,
  },
  executionResult: {
    phase: 9002,
    status: 'done',
    compromises: [],
    skipped: ['the live-ui tier for criterion c3 was not driven in this fixture'],
    hardcoded: [],
    surfaced: [],
    hardStops: [],
    gateRounds: 1,
  },
  debtResolutions: [],
  tasks: [
    {
      id: '9002.1',
      title: 'add the deterministic scorer',
      problem: 'the seven dimensions must be computed in one place so the sentinel mapping has one application site.',
      steps: [{ file: 'src/scorer.ts', description: 'score the deterministic dimensions off the collected trace' }],
      acceptanceCriteria: ['a missing input yields a sentinel, never a zero score'],
      files: ['src/scorer.ts'],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-07-17',
      transparencyReport: {
        whatWasDone: 'added the deterministic scorer over the collected arc trace',
        how: 'mapped each absent trace field to its named sentinel at a single site',
        compromises: 'None',
        skipped: 'the live-ui tier for criterion c3 was not driven in this fixture run',
        hardcoded: 'None',
        limitations: 'None',
        decisionRef: 'ratified in the arc EVALFIX design note',
      },
    },
    {
      id: '9002.2',
      title: 'compute the rolling ratchet',
      problem: 'a backfilled report and a judged report must only be compared on the dimensions they share.',
      steps: [{ file: 'src/scorer.ts', description: 'exclude incomparable priors from a dimension baseline' }],
      acceptanceCriteria: ['an incomparable prior is excluded from that dimension baseline'],
      files: ['src/scorer.ts'],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-07-17',
      transparencyReport: {
        whatWasDone: 'added the rolling baseline ratchet with the comparability rule',
        how: 'skipped any prior whose dimension carried a sentinel instead of a score',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations: 'None',
      },
    },
  ],
})
