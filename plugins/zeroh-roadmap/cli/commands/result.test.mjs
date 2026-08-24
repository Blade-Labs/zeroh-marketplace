#!/usr/bin/env node
/**
 * Fixtures for `roadmap result check` + `roadmap contract show --json-schema` — driven
 * through the REAL bin/roadmap.mjs (also proving dispatch registration) against a tmp
 * consumer whose lib/roadmap/schema.ts re-exports the REAL templates/schema.ts, with a
 * node_modules/zod symlink so `contract show` resolves the consumer's own zod.
 *
 * Plus the seam-3 conformance pin: a repo-wide grep asserts NO second
 * PhaseExecutionResultShape Zod DEFINITION under cli/ or hooks/. Run:
 * node --test cli/commands/result.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = join(HERE, '..', '..')
const BIN = join(PLUGIN_ROOT, 'bin', 'roadmap.mjs')
const SCHEMA = join(PLUGIN_ROOT, 'templates', 'schema.ts')
const PLUGIN_ZOD = realpathSync(join(PLUGIN_ROOT, 'node_modules', 'zod'))

const bases = []
process.on('exit', () => bases.forEach((b) => rmSync(b, { recursive: true, force: true })))

/** A git-inited tmp consumer with the re-export schema + a zod symlink. */
function makeConsumer() {
  const root = mkdtempSync(join(tmpdir(), 'zr-result-'))
  bases.push(root)
  mkdirSync(join(root, 'lib', 'roadmap'), { recursive: true })
  writeFileSync(join(root, 'lib', 'roadmap', 'schema.ts'), `export * from '${SCHEMA}'\n`)
  mkdirSync(join(root, 'node_modules'), { recursive: true })
  symlinkSync(PLUGIN_ZOD, join(root, 'node_modules', 'zod'), 'dir')
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { stdio: 'ignore' })
  git('init', '-q')
  return root
}

/** Drive bin/roadmap.mjs with cwd = the consumer; return { code, stdout, stderr }.
 *  spawnSync, not execFileSync: stderr must be observable on a ZERO exit too, because the
 *  attribution reconcile's loudest outputs (the unmappable-alias skip line) ride a green run. */
function roadmap(root, args) {
  const r = spawnSync('node', [BIN, ...args], { cwd: root, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

const validResult = { phase: 9001, status: 'done', gateRounds: 2, compromises: [], skipped: [], hardcoded: [], surfaced: [], hardStops: [] }

test('result check — a valid done result passes (exit 0) and echoes the parsed JSON', () => {
  const root = makeConsumer()
  const f = join(root, 'result.json')
  writeFileSync(f, JSON.stringify(validResult))
  const r = roadmap(root, ['result', 'check', '--phase', '9001', f])
  assert.equal(r.code, 0, r.stderr)
  assert.match(r.stdout, /"phase":\s*9001/)
})

test('result check — a missing required field (gateRounds) fails exit 2 naming the field', () => {
  const root = makeConsumer()
  const { gateRounds, ...bad } = validResult
  const f = join(root, 'bad.json')
  writeFileSync(f, JSON.stringify(bad))
  const r = roadmap(root, ['result', 'check', f])
  assert.equal(r.code, 2, r.stdout + r.stderr)
  assert.match(r.stderr, /gateRounds/)
})

test('result check — --phase mismatch exits 2', () => {
  const root = makeConsumer()
  const f = join(root, 'result.json')
  writeFileSync(f, JSON.stringify(validResult))
  const r = roadmap(root, ['result', 'check', '--phase', '9999', f])
  assert.equal(r.code, 2)
  assert.match(r.stderr, /9001.*!==.*9999/)
})

// ── Checkpoint status widening (RED-first; targets the not-yet-landed PhaseExecutionResultShape
//    widening: status gains 'checkpoint', a new optional `checkpoint` object, and a superRefine
//    that REQUIRES `checkpoint` when status === 'checkpoint'). Cases run against the SAME re-export
//    consumer schema the siblings use, so today the 'checkpoint' enum member is rejected. ─────────

const checkpointResult = {
  phase: 9001,
  status: 'checkpoint',
  checkpoint: {
    committedSha: 'abc1234',
    reason: 'unbounded ingest running detached',
    resume: 'read the log tail, then continue task 2',
    watch: { log: '/tmp/x.log' },
  },
  gateRounds: 0,
}

test('result check — a well-formed checkpoint result passes (exit 0) [RED until the widening lands]', () => {
  const root = makeConsumer()
  const f = join(root, 'checkpoint.json')
  writeFileSync(f, JSON.stringify(checkpointResult))
  const r = roadmap(root, ['result', 'check', '--phase', '9001', f])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /"status":\s*"checkpoint"/)
})

test('result check — a checkpoint result missing checkpoint.committedSha fails (non-zero)', () => {
  const root = makeConsumer()
  const { committedSha, ...watchlessCheckpoint } = checkpointResult.checkpoint
  const bad = { ...checkpointResult, checkpoint: watchlessCheckpoint }
  const f = join(root, 'no-sha.json')
  writeFileSync(f, JSON.stringify(bad))
  const r = roadmap(root, ['result', 'check', '--phase', '9001', f])
  assert.notEqual(r.code, 0, r.stdout + r.stderr)
})

test('result check — a payload-free checkpoint (no checkpoint field) fails via the superRefine (non-zero)', () => {
  const root = makeConsumer()
  const f = join(root, 'payload-free.json')
  writeFileSync(f, JSON.stringify({ phase: 9001, status: 'checkpoint', gateRounds: 0 }))
  const r = roadmap(root, ['result', 'check', '--phase', '9001', f])
  assert.notEqual(r.code, 0, r.stdout + r.stderr)
})

test('result check — an escalated result carrying escalation question+options still passes (exit 0)', () => {
  const root = makeConsumer()
  const escalated = {
    phase: 9001,
    status: 'escalated',
    escalation: { question: 'which store backend for the detached ingest?', options: ['postgres', 'sqlite'] },
    gateRounds: 0,
  }
  const f = join(root, 'escalated.json')
  writeFileSync(f, JSON.stringify(escalated))
  const r = roadmap(root, ['result', 'check', '--phase', '9001', f])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /"status":\s*"escalated"/)
})

test('contract show --json-schema — emits the schema with the drift-visible anchors', () => {
  const root = makeConsumer()
  const r = roadmap(root, ['contract', 'show', '--json-schema'])
  assert.equal(r.code, 0, r.stderr)
  const schema = JSON.parse(r.stdout)
  assert.ok(schema.properties.phase, 'properties.phase present')
  assert.deepEqual(schema.properties.status.enum, ['done', 'escalated', 'failed', 'checkpoint'])
  assert.ok(schema.properties.checkpoint, 'properties.checkpoint present (the typed hand-off)')
  assert.ok(schema.properties.hardStops, 'properties.hardStops present')
})

test('seam-3 conformance — NO second PhaseExecutionResultShape z.object definition under cli/ or hooks/', () => {
  // imports/identifier references are allowed; only a Zod DEFINITION is banned. Test
  // files are excluded (they legitimately reference the name in fixtures/assertions).
  const out = execFileSync(
    'bash',
    ['-c', `grep -rEn 'PhaseExecutionResultShape[[:space:]]*=[[:space:]]*z\\.(object|strictObject)' ${JSON.stringify(join(PLUGIN_ROOT, 'cli'))} ${JSON.stringify(join(PLUGIN_ROOT, 'hooks'))} | grep -v '\\.test\\.' || true`],
    { encoding: 'utf8' },
  )
  assert.equal(out.trim(), '', `unexpected second PhaseExecutionResultShape definition:\n${out}`)
})

// ── 3.4 — THE SESSION-LANE ATTRIBUTION RECONCILE ────────────────────────────────────────────────
// On 2026-08-23 the do-arc orchestrator wrote driver.model 'claude-fable-5' into the spawn prompt
// of a phase-executor whose agent card declares `model: opus`, and the returned result carried the
// spawner's assertion as if it were self-knowledge. Nothing could have caught it: this command
// validates SHAPE (driver is optional), the codex reconcile is journal-gated, and the validator
// warning fires on ABSENT attribution only. The arm file is the session lane's launch journal —
// written pre-spawn, carrying the alias the launcher READ off the card — so it is the launcher
// truth this command reconciles the executor's self-report against.
//
// The two sides are deliberately different KINDS of evidence and are compared by FAMILY, never for
// equality: the arm holds a harness ALIAS (a card cannot name a full model id), the result holds
// the exact id the executor's own context reports (the only place that id exists). Family
// agreement is all that can honestly be asserted; anything the map cannot place is a LOUD SKIP,
// because reddening a return on an alias this CLI does not understand would punish the one actor
// telling the truth.

const ARM_LIB = join(PLUGIN_ROOT, 'cli', 'lib', 'executor-arm.mjs')
const { armExecutor } = await import(ARM_LIB)

/** The arm path the CLI derives — resolved through the SAME git toplevel the command resolves,
 *  never string-joined onto the tmp root (a symlinked tmpdir would silently diverge). */
function armPathFor(root, phase) {
  const toplevel = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  return join(toplevel, '.building', `${phase}-executor.armed`)
}

/** Plant an arm body by hand (the on-disk contract pinned in cli/lib/executor-arm.test.mjs). */
function plantArm(root, phase, extra) {
  const p = armPathFor(root, phase)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify({ sessionId: 'sess-arc', armedAt: new Date().toISOString(), ...extra }) + '\n')
  return p
}

const sessionDriver = (model) => ({ model, lane: 'session' })
/** A valid done result, optionally carrying a driver self-stamp. */
function returnedResult(driver) {
  return driver ? { ...validResult, driver } : { ...validResult }
}
/** Write the doc and run `result check` against it. */
function checkResult(root, doc, args = ['--phase', '9001']) {
  const f = join(root, `result-${Math.random().toString(36).slice(2)}.json`)
  writeFileSync(f, JSON.stringify(doc))
  return roadmap(root, ['result', 'check', ...args, f])
}

test("result check — THE PLANTED 2026-08-23 DEFECT: armed 'opus', returned 'claude-fable-5' ⇒ exit 2 naming both sides", () => {
  const root = makeConsumer()
  const arm = plantArm(root, 9001, { expectedModelAlias: 'opus' })
  const r = checkResult(root, returnedResult(sessionDriver('claude-fable-5')))

  assert.equal(r.code, 2, `a spawner-asserted model id must not survive the return; stdout:\n${r.stdout}\nstderr:\n${r.stderr}`)
  assert.ok(r.stderr.includes('opus'), `the ARMED alias (launcher truth of the request) must be named; got:\n${r.stderr}`)
  assert.ok(r.stderr.includes('claude-fable-5'), `the RETURNED driver.model (executor self-report) must be named; got:\n${r.stderr}`)
  assert.ok(r.stderr.includes(arm), `the arm path must be named so the reader can read the launcher record; got:\n${r.stderr}`)
})

test('result check — the same defect with the arm written by the REAL armExecutor (cross-seam)', () => {
  // The hand-planted body above is a fixture; this one proves the writer and the reader agree, so
  // a shape drift in cli/lib/executor-arm.mjs cannot leave the reconcile quietly reading nothing.
  const root = makeConsumer()
  const toplevel = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  const arm = armExecutor(toplevel, 9001, 'sess-arc', { executorId: 'exec-1', expectedModelAlias: 'opus' })
  assert.equal(
    JSON.parse(readFileSync(arm, 'utf8')).expectedModelAlias,
    'opus',
    'precondition: armExecutor records the requested alias — without it this case cannot test the reconcile',
  )

  const r = checkResult(root, returnedResult(sessionDriver('claude-fable-5')))
  assert.equal(r.code, 2, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`)
  assert.ok(r.stderr.includes('claude-fable-5'), `names the self-report; got:\n${r.stderr}`)
})

test("result check — AGREEMENT: armed 'opus', returned 'claude-opus-5' ⇒ exit 0 and silence", () => {
  const root = makeConsumer()
  plantArm(root, 9001, { expectedModelAlias: 'opus' })
  const r = checkResult(root, returnedResult(sessionDriver('claude-opus-5')))
  assert.equal(r.code, 0, `agreement is not a finding; stderr:\n${r.stderr}`)
  assert.ok(!/opus/.test(r.stderr), `an agreeing run says nothing about the alias; got:\n${r.stderr}`)
  assert.match(r.stdout, /"model":\s*"claude-opus-5"/, 'the parsed result is still echoed unchanged')
})

test("result check — AGREEMENT on the SUFFIXED live id: armed 'opus', returned 'claude-opus-5[1m]' ⇒ exit 0", () => {
  // The exact form a live executor self-reports (context-window variants carry a bracket suffix).
  // Family PREFIX matching is what makes the reconcile usable; equality would red every real run.
  const root = makeConsumer()
  plantArm(root, 9001, { expectedModelAlias: 'opus' })
  const r = checkResult(root, returnedResult(sessionDriver('claude-opus-5[1m]')))
  assert.equal(r.code, 0, `a suffixed id is the same family; stderr:\n${r.stderr}`)
  assert.ok(!/opus/.test(r.stderr), `and it is not a finding; got:\n${r.stderr}`)
})

test('result check — DRIVER ABSENT under a recorded alias ⇒ exit 2 (the session-lane analog of the journal-present error)', () => {
  const root = makeConsumer()
  const arm = plantArm(root, 9001, { expectedModelAlias: 'opus' })
  const r = checkResult(root, returnedResult(null))
  assert.equal(r.code, 2, `a launcher that recorded a request is owed an answer; stdout:\n${r.stdout}\nstderr:\n${r.stderr}`)
  assert.ok(r.stderr.includes('opus'), `the armed alias must be named; got:\n${r.stderr}`)
  assert.ok(r.stderr.includes(arm), `the arm path must be named; got:\n${r.stderr}`)
})

test("result check — alias 'inherit' ⇒ a NAMED skip on stderr, and the exit code is the NO-ARM exit code", () => {
  const doc = returnedResult(sessionDriver('claude-fable-5'))
  const bare = makeConsumer()
  const baseline = checkResult(bare, doc)

  const root = makeConsumer()
  const arm = plantArm(root, 9001, { expectedModelAlias: 'inherit' })
  const r = checkResult(root, doc)

  assert.equal(r.code, baseline.code, `an unmappable alias is LOUD, never RED — same exit as no arm at all; stderr:\n${r.stderr}`)
  assert.ok(r.stderr.includes('inherit'), `the skipped alias must be NAMED, not silently dropped; got:\n${r.stderr}`)
  assert.ok(r.stderr.includes(arm), `and the arm it came from named; got:\n${r.stderr}`)
  assert.match(r.stderr, /skip|unmapp|unknown|not reconcil/i, `the line must say the reconcile did not happen; got:\n${r.stderr}`)
})

test("result check — an alias outside the family map ('gpt-5.6-sol') skips the same way", () => {
  const doc = returnedResult(sessionDriver('claude-fable-5'))
  const bare = makeConsumer()
  const baseline = checkResult(bare, doc)

  const root = makeConsumer()
  const arm = plantArm(root, 9001, { expectedModelAlias: 'gpt-5.6-sol' })
  const r = checkResult(root, doc)
  assert.equal(r.code, baseline.code, `an alias this CLI cannot place never reds a return; stderr:\n${r.stderr}`)
  assert.ok(r.stderr.includes('gpt-5.6-sol'), `the unplaceable alias must be named; got:\n${r.stderr}`)
  assert.ok(r.stderr.includes(arm), `and the arm it came from named; got:\n${r.stderr}`)
  assert.match(r.stderr, /skip|unmapp|unknown|not reconcil/i, `and the skip stated; got:\n${r.stderr}`)
})

test('result check — NO ARM ⇒ byte-identical to a consumer that has no .building at all', () => {
  const doc = returnedResult(sessionDriver('claude-fable-5'))
  const bare = makeConsumer()
  const baseline = checkResult(bare, doc)

  // A .building that exists and holds an arm for a DIFFERENT phase: the arm is phase-scoped, so
  // this must change nothing. A reconcile that scanned the directory would red here.
  const root = makeConsumer()
  plantArm(root, 9002, { expectedModelAlias: 'opus' })
  const r = checkResult(root, doc)

  assert.deepEqual(
    { code: r.code, stdout: r.stdout, stderr: r.stderr },
    { code: baseline.code, stdout: baseline.stdout, stderr: baseline.stderr },
    'no arm for THIS phase ⇒ behaviour byte-identical to before the reconcile existed',
  )
})

test('result check — an arm WITHOUT expectedModelAlias ⇒ byte-identical (every arm on disk today)', () => {
  const doc = returnedResult(sessionDriver('claude-fable-5'))
  const bare = makeConsumer()
  const baseline = checkResult(bare, doc)

  const root = makeConsumer()
  plantArm(root, 9001, { executorId: 'exec-1' })
  const r = checkResult(root, doc)

  assert.deepEqual(
    { code: r.code, stdout: r.stdout, stderr: r.stderr },
    { code: baseline.code, stdout: baseline.stdout, stderr: baseline.stderr },
    'an arm that recorded no request makes no claim — nothing to reconcile, nothing to say',
  )
})

test('result check — WITHOUT --phase the reconcile never fires (the arm is phase-scoped)', () => {
  const root = makeConsumer()
  plantArm(root, 9001, { expectedModelAlias: 'opus' })
  const r = checkResult(root, returnedResult(sessionDriver('claude-fable-5')), [])
  assert.equal(r.code, 0, `no --phase means no arm to read — never a guess from the doc's own phase; stderr:\n${r.stderr}`)
  assert.match(r.stdout, /"phase":\s*9001/)
})

test('result check — the FAMILY MAP is exhaustive and family-ANCHORED, not a substring search', () => {
  const agree = [
    ['fable', 'claude-fable-5'],
    ['opus', 'claude-opus-5'],
    ['sonnet', 'claude-sonnet-5'],
    ['haiku', 'claude-haiku-4-5'],
    ['opus', 'claude-opus'], // the bare family id is still the family
  ]
  const clash = [
    ['opus', 'claude-sonnet-5'],
    ['sonnet', 'claude-opus-5'],
    ['haiku', 'claude-fable-5'],
    ['fable', 'claude-haiku-4-5'],
    ['opus', 'opus-5'], // the family is 'claude-opus' — a bare vendorless id is not that family
    ['opus', 'gpt-5.6-sol'], // a lane confusion is exactly what this reconcile exists to catch
  ]
  for (const [alias, model] of agree) {
    const root = makeConsumer()
    plantArm(root, 9001, { expectedModelAlias: alias })
    const r = checkResult(root, returnedResult(sessionDriver(model)))
    assert.equal(r.code, 0, `armed '${alias}' vs returned '${model}' is agreement; stderr:\n${r.stderr}`)
  }
  for (const [alias, model] of clash) {
    const root = makeConsumer()
    plantArm(root, 9001, { expectedModelAlias: alias })
    const r = checkResult(root, returnedResult(sessionDriver(model)))
    assert.equal(r.code, 2, `armed '${alias}' vs returned '${model}' is a mismatch; stdout:\n${r.stdout}\nstderr:\n${r.stderr}`)
    assert.ok(r.stderr.includes(model), `and it must name the returned id; got:\n${r.stderr}`)
  }
})

test('result check — the reconcile runs AFTER the parse and never masks a shape error', () => {
  const root = makeConsumer()
  plantArm(root, 9001, { expectedModelAlias: 'opus' })
  const { gateRounds, ...bad } = returnedResult(sessionDriver('claude-fable-5'))
  const r = checkResult(root, bad)
  assert.equal(r.code, 2, `an invalid doc is still exit 2; stdout:\n${r.stdout}\nstderr:\n${r.stderr}`)
  assert.match(r.stderr, /gateRounds/, `the Zod issue must survive — an attribution finding never replaces it; got:\n${r.stderr}`)
})
