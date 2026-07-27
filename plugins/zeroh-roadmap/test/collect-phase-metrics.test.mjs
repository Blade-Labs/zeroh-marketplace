#!/usr/bin/env node
/**
 * Fixtures for scripts/collect-phase-metrics.ts — seeded tmp git repos (a mini
 * roadmap/phases tree plus a `## Gate commands` CLAUDE.md binding every gate slot to
 * `true`, so LIVE mode shells out to no-ops instead of a real lint/type-check/build)
 * driven through the REAL script under tsx with cwd = the fixture. Cases: the derived
 * time axis (startedAt = FIRST matching commit's author date, completedAt = the LAST,
 * both normalized to UTC from controlled GIT_AUTHOR_DATE values), the honest-absent
 * haltCount in live mode with neither a beacon nor an executionResult (the key must be
 * ABSENT, never `haltCount: 0`), and schema conformance of the emitted metrics object
 * against PhaseMetricsShape — including the non-UTC-offset commit dates that would fail
 * `z.string().datetime()` if the script stopped normalizing. Run:
 * node --test test/collect-phase-metrics.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = join(HERE, '..')
const SCRIPT = join(PLUGIN, 'scripts', 'collect-phase-metrics.ts')
const SCHEMA = join(PLUGIN, 'templates', 'schema.ts')
const TSX = join(PLUGIN, 'node_modules', '.bin', 'tsx')

const bases = []
process.on('exit', () => bases.forEach((b) => rmSync(b, { recursive: true, force: true })))

/** Every gate slot bound to `true` — live mode then execs a no-op per slot, so the
 *  haltCount case can exercise the REAL live path without running a real build. */
const CLAUDE_MD = ['# fixture', '', '## Gate commands', '- lint: true', '- types: true', '- unit: true', '- build: true', ''].join('\n')

/** Placeholder-shaped phase file: applyData's path 1 (`: undefined` replacement).
 *  Deliberately carries NO `executionResult:` — that absence is the point of case 2. */
const phaseSource = (num) =>
  [
    'export default {',
    `  id: ${num},`,
    `  title: 'fixture phase ${num}',`,
    "  status: 'done',",
    '  gate: undefined,',
    '  gateRounds: undefined,',
    '  metrics: undefined,',
    '  completedDate: undefined,',
    '}',
    '',
  ].join('\n')

/** A git repo holding one phase file plus commits stamped with controlled author dates. */
function makeRepo(phaseNum, commitDates) {
  const root = mkdtempSync(join(tmpdir(), 'zr-metrics-'))
  bases.push(root)
  mkdirSync(join(root, 'roadmap', 'phases'), { recursive: true })
  writeFileSync(join(root, 'CLAUDE.md'), CLAUDE_MD)
  const phaseFile = join(root, 'roadmap', 'phases', `phase-${phaseNum}.phase.ts`)
  writeFileSync(phaseFile, phaseSource(phaseNum))

  const git = (args, env = {}) =>
    execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      env: { ...process.env, ...env },
    })

  git(['init', '-q'])
  git(['add', '-A'])
  // Seed commit carries NO phase grammar, so it never enters the phase's own git window.
  git(['commit', '-q', '-m', 'seed fixture roadmap'])

  commitDates.forEach((date, i) => {
    writeFileSync(join(root, `work-${i}.txt`), `line ${i}\n`)
    git(['add', '-A'])
    git(['commit', '-q', '-m', `feat(x): phase ${phaseNum} — ${phaseNum}.${i + 1} ${['first', 'second'][i] ?? `task${i}`}`], {
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    })
  })

  return { root, phaseFile }
}

function runCollector(root, args) {
  return execFileSync(TSX, [SCRIPT, ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/** The single `metrics: { … }` block as written into the phase file. */
function metricsBlock(written) {
  const start = written.indexOf('metrics: {')
  assert.notEqual(start, -1, 'phase file should carry a metrics block after collection')
  const end = written.indexOf('\n  }', start)
  assert.notEqual(end, -1, 'metrics block should terminate')
  return written.slice(start, end + 4)
}

test('timestamps: startedAt/completedAt are the first/last matching commit author dates, in UTC', () => {
  const { root, phaseFile } = makeRepo(9001, ['2026-01-02T03:04:05Z', '2026-03-04T05:06:07Z'])

  runCollector(root, ['9001', '--historical'])
  const written = readFileSync(phaseFile, 'utf8')
  const block = metricsBlock(written)

  // git log is newest-first: the FIRST commit must become startedAt, not completedAt.
  assert.match(block, /startedAt: "2026-01-02T03:04:05\.000Z"/)
  assert.match(block, /completedAt: "2026-03-04T05:06:07\.000Z"/)
  assert.match(block, /commits: 2/)
})

test('haltCount is ABSENT (not 0) in live mode with no beacon and no executionResult', () => {
  const { root, phaseFile } = makeRepo(9002, ['2026-01-02T03:04:05Z', '2026-03-04T05:06:07Z'])
  // No .building/9002-executor.jsonl, and phaseSource() writes no `executionResult:`.

  const stdout = runCollector(root, ['9002'])
  const written = readFileSync(phaseFile, 'utf8')

  assert.doesNotMatch(written, /haltCount/, 'no evidence source ⇒ the key must not exist at all')
  assert.match(stdout, /haltCount ABSENT \(no executionResult, no beacon\)/)
  // Live mode really ran the bound no-op slots (a fallback to `npm run lint` in a fixture
  // with no package.json would have recorded errors/warnings), so this absence is the
  // LIVE path's honest-absent, not a historical-mode shortcut.
  assert.match(stdout, /mode: live/)
  assert.match(written, /lint: "clean"/)
  assert.match(written, /typeCheck: "clean"/)
  assert.match(written, /build: "clean"/)
  assert.match(written, /startedAt: "2026-01-02T03:04:05\.000Z"/)
})

test('haltCount counts beacon resume events once a beacon exists (zero stays absent without one)', () => {
  const { root, phaseFile } = makeRepo(9003, ['2026-01-02T03:04:05Z', '2026-03-04T05:06:07Z'])
  mkdirSync(join(root, '.building'), { recursive: true })
  writeFileSync(
    join(root, '.building', '9003-executor.jsonl'),
    [
      JSON.stringify({ event: 'start' }),
      JSON.stringify({ event: 'resume' }),
      'not json at all',
      JSON.stringify({ event: 'resume' }),
      JSON.stringify({ event: 'done' }),
      '',
    ].join('\n'),
  )

  runCollector(root, ['9003'])
  const block = metricsBlock(readFileSync(phaseFile, 'utf8'))

  assert.match(block, /haltCount: 2/, 'two resume events, and a malformed line is not a halt')
})

test('emitted metrics parse clean against PhaseMetricsShape, incl. offset commit dates normalized to Z', () => {
  // Author dates deliberately carry non-UTC offsets: %aI preserves them, and an
  // un-normalized value would fail z.string().datetime().
  const { root, phaseFile } = makeRepo(9004, ['2026-05-06T07:08:09+05:30', '2026-06-07T08:09:10-07:00'])

  runCollector(root, ['9004', '--historical'])
  const written = readFileSync(phaseFile, 'utf8')
  assert.match(written, /startedAt: "2026-05-06T01:38:09\.000Z"/)
  assert.match(written, /completedAt: "2026-06-07T15:09:10\.000Z"/)

  // .mts so tsx treats the checker as ESM (top-level await for the phase-file import).
  const checker = join(root, 'check-metrics.mts')
  writeFileSync(
    checker,
    [
      `import { PhaseMetricsShape } from ${JSON.stringify(SCHEMA)}`,
      `const phase = (await import(${JSON.stringify(phaseFile)})).default as any`,
      'PhaseMetricsShape.parse(phase.metrics)',
      // Sensitivity control: the un-normalized offset form the script guards against
      // must be REJECTED, so a clean parse above is a real signal, not a vacuous one.
      "const bad = PhaseMetricsShape.safeParse({ ...phase.metrics, startedAt: '2026-05-06T07:08:09+05:30' })",
      "if (bad.success) throw new Error('PhaseMetricsShape accepted a non-UTC offset timestamp')",
      "console.log('PARSE_OK ' + phase.metrics.startedAt + ' ' + phase.metrics.completedAt)",
      '',
    ].join('\n'),
  )

  const out = execFileSync(TSX, [checker], { cwd: PLUGIN, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  assert.match(out, /PARSE_OK 2026-05-06T01:38:09\.000Z 2026-06-07T15:09:10\.000Z/)
})
