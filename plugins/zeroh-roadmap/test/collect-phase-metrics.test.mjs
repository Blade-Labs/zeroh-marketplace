#!/usr/bin/env node
/**
 * Fixtures for scripts/collect-phase-metrics.ts — seeded tmp git repos (a mini
 * roadmap/phases tree plus canonical roadmap.config.json bindings to harmless
 * fixture commands, so LIVE mode never runs a real lint/type-check/build)
 * driven through the REAL script under tsx with cwd = the fixture. Cases: the derived
 * EXECUTION window (startedAt = the `move to in-progress` anchor, completedAt = the last
 * subject-matching commit at or after it, both normalized to UTC from controlled
 * GIT_AUTHOR_DATE values) and the two ways it must refuse to guess — no anchor ⇒ both
 * bounds absent, and a release merge naming the phase in its BODY never enters it —
 * the additive/idempotent time-axis merge into an existing block, the honest-absent
 * haltCount in live mode with neither a beacon nor an executionResult (the key must be
 * ABSENT, never `haltCount: 0`), and schema conformance of the emitted metrics object
 * against PhaseMetricsShape — including the non-UTC-offset commit dates that would fail
 * `z.string().datetime()` if the script stopped normalizing. Run:
 * node --test test/collect-phase-metrics.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, unlinkSync, existsSync, chmodSync } from 'node:fs'
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

/**
 * A git repo holding one phase file plus commits stamped with controlled author dates.
 *
 * `opts.planCommit` prepends a PLAN-time commit (the `plan(roadmap): … queue phase N` grammar)
 * and `opts.anchor` inserts the `roadmap phase start` marker after it. Together they reproduce
 * the real shape the execution window has to cut through: plan-time chatter carrying the phase
 * subject can precede execution by hours, and only the anchor says where the work began.
 * `opts.mergeNoise` adds a release MERGE whose body enumerates the phase — the whole-message
 * grep that this script used to run absorbed exactly that into every span.
 */
function makeRepo(phaseNum, commitDates, opts = {}) {
  const root = mkdtempSync(join(tmpdir(), 'zr-metrics-'))
  bases.push(root)
  const rootRel = opts.rootRel ?? 'roadmap'
  mkdirSync(join(root, rootRel, 'phases'), { recursive: true })
  writeFileSync(join(root, 'CLAUDE.md'), CLAUDE_MD)
  writeFileSync(join(root, rootRel, 'roadmap.config.json'), JSON.stringify({
    configVersion: 1,
    gateCommands: { lint: 'true', types: 'true', unit: 'true', integration: 'none', build: 'true', e2e: 'none', emit: 'none' },
  }))
  const phaseFile = join(root, rootRel, 'phases', `phase-${phaseNum}.phase.ts`)
  writeFileSync(phaseFile, (opts.phaseSource ?? phaseSource)(phaseNum))

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

  const commitAt = (date, message) => {
    git(['add', '-A'])
    git(['commit', '-q', '-m', message], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date })
  }

  if (opts.planCommit) {
    writeFileSync(join(root, 'plan.txt'), 'planned\n')
    commitAt(opts.planCommit, `plan(roadmap): phase ${phaseNum} review fix + queue phase ${phaseNum}`)
  }
  if (opts.anchor) {
    writeFileSync(join(root, 'anchor.txt'), 'in progress\n')
    commitAt(opts.anchor, `docs(roadmap): phase ${phaseNum} — move to in-progress`)
  }

  commitDates.forEach((date, i) => {
    writeFileSync(join(root, `work-${i}.txt`), `line ${i}\n`)
    commitAt(date, `feat(x): phase ${phaseNum} — ${phaseNum}.${i + 1} ${['first', 'second'][i] ?? `task${i}`}`)
  })

  if (opts.mergeNoise) {
    git(['checkout', '-q', '-b', 'side'])
    writeFileSync(join(root, 'side.txt'), 'side\n')
    commitAt(opts.mergeNoise, 'feat(y): unrelated side work')
    git(['checkout', '-q', '-'])
    git(
      ['merge', '--no-ff', '-q', 'side', '-m', `release: v9.9.9 — the release\n\nIncludes phase ${phaseNum} and others.`],
      { GIT_AUTHOR_DATE: opts.mergeNoise, GIT_COMMITTER_DATE: opts.mergeNoise },
    )
  }

  return { root, phaseFile }
}

function runCollector(root, args, env = {}) {
  return execFileSync(TSX, [SCRIPT, ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } })
}

test('root discovery finds docs/roadmap and ROADMAP_ROOT overrides candidates', () => {
  const docs = makeRepo(9010, ['2026-01-02T03:04:05Z'], { rootRel: 'docs/roadmap', anchor: '2026-01-02T03:00:00Z' })
  runCollector(docs.root, ['9010', '--historical'])
  assert.match(readFileSync(docs.phaseFile, 'utf8'), /metrics:\s*\{/)
  runCollector(docs.root, ['9010', '--historical'], { ROADMAP_ROOT: '' })
  mkdirSync(join(docs.root, 'roadmap', 'phases'), { recursive: true })
  const beforeRefusal = readFileSync(docs.phaseFile, 'utf8')
  assert.throws(() => runCollector(docs.root, ['9010', '--historical']), (error) => {
    assert.match(error.stderr.toString(), /kind: 'ambiguous'/)
    assert.match(error.stderr.toString(), /ROADMAP_ROOT=<dir>/)
    return true
  })
  assert.equal(readFileSync(docs.phaseFile, 'utf8'), beforeRefusal, 'ambiguous roots cannot mutate metrics')

  const custom = makeRepo(9011, ['2026-01-02T03:04:05Z'], { rootRel: 'ops/roadmap', anchor: '2026-01-02T03:00:00Z' })
  runCollector(custom.root, ['9011', '--historical'], { ROADMAP_ROOT: 'ops/roadmap' })
  assert.match(readFileSync(custom.phaseFile, 'utf8'), /metrics:\s*\{/)
})

/** The metrics block by BRACE MATCHING — the same reason the script does it that way: a lazy
 *  regex against a ONE-LINE block runs past it into the next object. */
function findMetricsText(written) {
  const m = written.match(/\n  metrics:\s*\{/)
  assert.ok(m, 'phase file should carry a metrics block after collection')
  const start = m.index + 1
  let depth = 0
  for (let i = written.indexOf('{', start); i < written.length; i++) {
    if (written[i] === '{') depth++
    else if (written[i] === '}') { depth--; if (depth === 0) return written.slice(start, i + 1) }
  }
  throw new Error('metrics block should terminate')
}

/** The single `metrics: { … }` block as written into the phase file. */
function metricsBlock(written) {
  const start = written.indexOf('metrics: {')
  assert.notEqual(start, -1, 'phase file should carry a metrics block after collection')
  const end = written.indexOf('\n  }', start)
  assert.notEqual(end, -1, 'metrics block should terminate')
  return written.slice(start, end + 4)
}

test('timestamps: the window opens at the in-progress ANCHOR, not at the first matching commit', () => {
  const { root, phaseFile } = makeRepo(9001, ['2026-01-02T03:04:05Z', '2026-03-04T05:06:07Z'], {
    planCommit: '2025-11-01T00:00:00Z',
    anchor: '2026-01-01T00:00:00Z',
  })

  runCollector(root, ['9001', '--historical'])
  const block = metricsBlock(readFileSync(phaseFile, 'utf8'))

  // The plan commit predates execution by two months and carries the phase subject. Folding it
  // in would report a two-month phase, and computeTimingStats would put that in the median.
  assert.match(block, /startedAt: "2026-01-01T00:00:00\.000Z"/)
  assert.doesNotMatch(block, /2025-11-01/, 'a plan-time commit is not the start of execution')
  // git log is newest-first: the LAST commit must become completedAt, not startedAt.
  assert.match(block, /completedAt: "2026-03-04T05:06:07\.000Z"/)
  // commits counts every subject match including the plan + anchor commits; only the WINDOW
  // is anchored. That split is deliberate: the anchor says when work began, not what counts.
  assert.match(block, /commits: 4/)
})

test('timestamps: no in-progress anchor ⇒ BOTH bounds absent (excluded, never approximated)', () => {
  const { root, phaseFile } = makeRepo(9005, ['2026-01-02T03:04:05Z', '2026-03-04T05:06:07Z'])

  const stdout = runCollector(root, ['9005', '--historical'])
  const block = metricsBlock(readFileSync(phaseFile, 'utf8'))

  // A phase predating the `roadmap phase start` grammar has no execution window on the record.
  // It lands in the timing table's interruptedExcluded rather than contributing a guess.
  assert.doesNotMatch(block, /startedAt/, 'no anchor ⇒ no startedAt')
  assert.doesNotMatch(block, /completedAt/, 'no anchor ⇒ no completedAt')
  assert.match(block, /commits: 2/, 'the commit metrics are still derivable — only the WINDOW is not')
  assert.match(stdout, /ABSENT/)
})

test('timestamps: a release MERGE naming the phase in its BODY never enters the window', () => {
  // The measured defect: `git log --grep` reads the whole message, so a release merge whose PR
  // body enumerates the phase was absorbed into its span (phase 1889 derived 1137 minutes
  // against a real 15.5, and every phase in an arc inherited one arc-shaped duration).
  const { root, phaseFile } = makeRepo(9006, ['2026-01-02T03:04:05Z', '2026-01-02T03:20:00Z'], {
    anchor: '2026-01-02T03:00:00Z',
    mergeNoise: '2026-06-01T00:00:00Z',
  })

  runCollector(root, ['9006', '--historical'])
  const block = metricsBlock(readFileSync(phaseFile, 'utf8'))

  assert.match(block, /completedAt: "2026-01-02T03:20:00\.000Z"/)
  assert.doesNotMatch(block, /2026-06-01/, 'the release merge is five months later and is not this phase')
  assert.match(block, /commits: 3/, 'the merge is not one of the phase’s commits either')
})

test('the time axis lands in METRICS, not in the executionResult that follows a one-line block', () => {
  // The shape that broke it: phase files carry the metrics block BOTH one-line and multi-line,
  // and a lazy `\{[\s\S]*?\n  \}` against the one-line form runs past it to the next dedented
  // `}` — the end of executionResult — appending the time axis into the wrong object entirely.
  const { root, phaseFile } = makeRepo(9008, ['2026-01-02T03:04:05Z'], {
    anchor: '2026-01-02T03:00:00Z',
    phaseSource: (num) =>
      [
        'export default {',
        `  id: ${num},`,
        "  status: 'done',",
        '  gate: { lint: "clean" },',
        "  gateRounds: ['R0'],",
        '  metrics: { commits: 3, linesAdded: 10, linesRemoved: 1, filesChanged: 2, testsAtStart: 0, testsAtEnd: 4, testsAdded: 4 },',
        "  completedDate: '2026-01-02',",
        '  executionResult: {',
        `    phase: ${num},`,
        "    status: 'done',",
        '    gateRounds: 1,',
        '  },',
        '}',
        '',
      ].join('\n'),
  })

  runCollector(root, ['9008', '--historical'])
  const written = readFileSync(phaseFile, 'utf8')
  const block = findMetricsText(written)

  assert.match(block, /startedAt: '2026-01-02T03:00:00\.000Z'/, 'the time axis belongs to metrics')
  assert.match(block, /commits: 3/, 'every pre-existing key survives untouched')
  const execResult = written.slice(written.indexOf('executionResult:'))
  assert.doesNotMatch(execResult, /startedAt/, 'the executionResult must not have absorbed the time axis')
  assert.doesNotMatch(execResult, /completedAt/, 'the executionResult must not have absorbed the time axis')
})

test('the time-axis merge is ADDITIVE and idempotent over an existing metrics block', () => {
  const { root, phaseFile } = makeRepo(9007, ['2026-01-02T03:04:05Z'], { anchor: '2026-01-02T03:00:00Z' })

  runCollector(root, ['9007', '--historical'])
  const first = readFileSync(phaseFile, 'utf8')
  assert.match(metricsBlock(first), /startedAt: "2026-01-02T03:00:00\.000Z"/)

  // A second run must not append a duplicate key or rewrite a recorded value — this is what
  // makes the path safe to run across ~1,900 historical phase files.
  const stdout = runCollector(root, ['9007', '--historical'])
  const second = readFileSync(phaseFile, 'utf8')
  assert.equal(second, first, 'a re-run over an already-populated block is a no-op')
  assert.match(stdout, /No changes/)
})

test('haltCount is ABSENT (not 0) in live mode with no beacon and no executionResult', () => {
  const { root, phaseFile } = makeRepo(9002, ['2026-01-02T03:04:05Z', '2026-03-04T05:06:07Z'], { anchor: '2026-01-01T00:00:00Z' })
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
  assert.match(written, /startedAt: "2026-01-01T00:00:00\.000Z"/)
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
  const { root, phaseFile } = makeRepo(9004, ['2026-05-06T07:08:09+05:30', '2026-06-07T08:09:10-07:00'], { anchor: '2026-05-06T07:08:09+05:30' })

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

function boundCollectorFixture(phaseNum = 9020) {
  const fixture = makeRepo(phaseNum, ['2026-01-02T03:04:05Z'], { rootRel: 'docs/roadmap', anchor: '2026-01-02T03:00:00Z' })
  const configPath = join(fixture.root, 'docs/roadmap/roadmap.config.json')
  const gateCommands = { lint: 'node gate-sentinel.mjs lint', types: 'node gate-sentinel.mjs types', unit: 'node gate-sentinel.mjs unit', integration: 'none', build: 'node gate-sentinel.mjs build', e2e: 'none', emit: 'none' }
  writeFileSync(configPath, JSON.stringify({ configVersion: 1, gateCommands }))
  writeFileSync(join(fixture.root, 'gate-sentinel.mjs'), 'import { appendFileSync } from "node:fs"; appendFileSync("gate-calls.txt", process.argv[2] + "\\n"); if (process.argv[2] === "unit") console.log("# pass 7\\n# fail 0");\n')
  return { ...fixture, configPath, gateCommands }
}
test('collector live authority: config bindings drive execution despite CLAUDE and lockfile changes', () => {
  const { root, phaseFile } = boundCollectorFixture()
  writeFileSync(join(root, 'CLAUDE.md'), '# unrelated conventions\n')
  runCollector(root, ['9020'])
  const expected = ['lint', 'types', 'unit', 'build']
  assert.deepEqual(readFileSync(join(root, 'gate-calls.txt'), 'utf8').trim().split('\n'), expected)
  assert.match(readFileSync(phaseFile, 'utf8'), /unitTests:\s*\{\s*passed: 7,\s*total: 7/)
  writeFileSync(join(root, 'CLAUDE.md'), CLAUDE_MD.replaceAll(': true', ': node gate-sentinel.mjs WRONG-AUTHORITY'))
  writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  writeFileSync(join(root, 'yarn.lock'), '# competing lockfile must not choose commands\n')
  runCollector(root, ['9020'])
  assert.deepEqual(readFileSync(join(root, 'gate-calls.txt'), 'utf8').trim().split('\n'), [...expected, ...expected])
})
for (const mode of ['missing', 'malformed', 'invalid']) {
  test(`collector live authority: ${mode} config refuses before executing gates or rewriting phase`, () => {
    const { root, phaseFile, configPath } = boundCollectorFixture(9021)
    const before = readFileSync(phaseFile, 'utf8')
    if (mode === 'missing') unlinkSync(configPath)
    if (mode === 'malformed') writeFileSync(configPath, '{')
    if (mode === 'invalid') writeFileSync(configPath, JSON.stringify({ configVersion: 1, gateCommands: { lint: 'true' } }))
    const result = spawnSync(TSX, [SCRIPT, '9021'], { cwd: root, encoding: 'utf8' })
    assert.notEqual(result.status, 0, 'unusable config cannot report successful collection')
    assert.match(result.stderr + result.stdout, /config/i)
    assert.equal(existsSync(join(root, 'gate-calls.txt')), false, 'no configured gate ran')
    assert.equal(readFileSync(phaseFile, 'utf8'), before, 'failed config cannot rewrite phase evidence')
  })
}
test('collector live authority: none is a declared absence with honest notes and is never a shell command', () => {
  const { root, phaseFile, configPath, gateCommands } = boundCollectorFixture(9022)
  writeFileSync(configPath, JSON.stringify({ configVersion: 1, gateCommands: Object.fromEntries(Object.keys(gateCommands).map((slot) => [slot, 'none'])) }))
  writeFileSync(join(root, 'CLAUDE.md'), CLAUDE_MD.replaceAll(': true', ': none'))
  const bin = join(root, 'fake-bin'); mkdirSync(bin)
  const trap = join(bin, 'none')
  writeFileSync(trap, '#!/bin/sh\nprintf "executed\\n" >> none-was-executed\n')
  chmodSync(trap, 0o755)
  const stdout = runCollector(root, ['9022'], { PATH: `${bin}:${process.env.PATH}` })
  assert.equal(existsSync(join(root, 'none-was-executed')), false, 'none must not be executed, even when resolvable on PATH')
  const written = readFileSync(phaseFile, 'utf8')
  assert.match(written, /notes:\s*["'][^"']*declared-none/, 'written gate evidence explains declared absence')
  for (const slot of ['lint', 'types', 'unit', 'build']) assert.match(stdout, new RegExp(`(?:${slot}[^\\n]*declared-none|declared-none[^\\n]*${slot})`), `${slot} absence is reported honestly`)
})
