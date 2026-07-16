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
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync, rmSync } from 'node:fs'
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

/** Drive bin/roadmap.mjs with cwd = the consumer; return { code, stdout, stderr }. */
function roadmap(root, args) {
  try {
    const stdout = execFileSync('node', [BIN, ...args], { cwd: root, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, stdout, stderr: '' }
  } catch (err) {
    return { code: err.status ?? 1, stdout: (err.stdout ?? '').toString(), stderr: (err.stderr ?? '').toString() }
  }
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

test('contract show --json-schema — emits the schema with the drift-visible anchors', () => {
  const root = makeConsumer()
  const r = roadmap(root, ['contract', 'show', '--json-schema'])
  assert.equal(r.code, 0, r.stderr)
  const schema = JSON.parse(r.stdout)
  assert.ok(schema.properties.phase, 'properties.phase present')
  assert.deepEqual(schema.properties.status.enum, ['done', 'escalated', 'failed'])
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
