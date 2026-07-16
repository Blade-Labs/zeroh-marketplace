#!/usr/bin/env node
/**
 * WIRED tests for the NEW `roadmap status` surface — the --json machine shape and
 * the exit-code / stream-separation rails the parity oracle does NOT cover (the
 * legacy script had no --json). SPAWNs `node <plugin>/bin/roadmap.mjs status …`
 * over hermetic tmp estates. The ported derivation ladder itself is locked by
 * status.parity.test.mjs.
 *
 * Hermetic-tmp pattern from cli/commands/config.test.mjs. Run:
 *   node --test cli/commands/status.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url)) // cli/commands/
const BIN = join(HERE, '..', '..', 'bin', 'roadmap.mjs')

const tmps = []
function newTmp(prefix = 'zr-status-') {
  const d = mkdtempSync(join(tmpdir(), prefix))
  tmps.push(d)
  return realpathSync(d)
}
process.on('exit', () => {
  for (const d of tmps) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* best-effort */
    }
  }
})

/** Mirror of writePhase in cli/lib/phasescan.test.mjs. */
function writePhase(dir, fileName, { phase, status, arcId } = {}) {
  mkdirSync(dir, { recursive: true })
  const lines = ['export const p = {']
  if (phase !== undefined) lines.push(`  phase: ${phase},`)
  if (status !== undefined) lines.push(`  status: '${status}',`)
  if (arcId !== undefined) lines.push(`  arcId: '${arcId}',`)
  lines.push('}')
  writeFileSync(join(dir, fileName), lines.join('\n') + '\n')
}

/** An estate with one BUILDING sidecar + one in-progress phase; returns the root. */
function estateWithBuildingArc() {
  const root = join(newTmp(), 'roadmap')
  const phases = join(root, 'phases')
  const building = join(root, 'arcs', '.building')
  mkdirSync(building, { recursive: true })
  writePhase(phases, 'phase-2001.phase.ts', { phase: 2001, status: 'in-progress', arcId: 'BUILDA' })
  writePhase(phases, 'phase-2002.phase.ts', { phase: 2002, status: 'backlog', arcId: 'BUILDA' })
  writeFileSync(
    join(building, 'BUILDA.json'),
    JSON.stringify({ arcId: 'BUILDA', worktree: '/nonexistent/wt-builda', branch: 'arc/builda', mode: 'mixed' }) + '\n',
  )
  return root
}

/** An estate with an empty phases/ dir and no arcs; returns the root. */
function emptyEstate() {
  const root = join(newTmp(), 'roadmap')
  mkdirSync(join(root, 'phases'), { recursive: true })
  return root
}

const status = (...args) => spawnSync('node', [BIN, 'status', ...args], { encoding: 'utf8' })

test('1) --json emits the { derivedAt, repo, rows, otherWorktrees, warnings } shape on stdout', () => {
  const root = estateWithBuildingArc()
  const res = status(root, '--json')
  assert.equal(res.status, 0, `status --json must exit 0; stderr:\n${res.stderr}`)

  let parsed
  assert.doesNotThrow(() => {
    parsed = JSON.parse(res.stdout)
  }, `stdout must be PURE JSON; got:\n${res.stdout}`)

  for (const key of ['derivedAt', 'repo', 'rows', 'otherWorktrees', 'warnings']) {
    assert.ok(key in parsed, `--json object must carry the "${key}" key; got keys ${Object.keys(parsed)}`)
  }
  assert.ok(Array.isArray(parsed.rows), 'rows is an array')
  assert.ok(parsed.rows.length >= 1, 'the BUILDING sidecar must produce at least one row')
  for (const row of parsed.rows) {
    for (const k of ['arc', 'state', 'where', 'age', 'note']) {
      assert.ok(k in row, `each row must carry "${k}"; got ${JSON.stringify(row)}`)
    }
  }
  const buildaRow = parsed.rows.find((r) => r.arc === 'BUILDA')
  assert.ok(buildaRow, 'the BUILDA lane must be present in rows')
  assert.equal(buildaRow.state, 'BUILDING', 'a non-paused sidecar lane is BUILDING')
})

test('2) --json keeps stdout parseable even when stderr carries narration', () => {
  const root = estateWithBuildingArc()
  const res = status(root, '--json')
  assert.equal(res.status, 0)
  // Stream-separation invariant: whatever lands on stderr, stdout parses alone.
  assert.doesNotThrow(() => {
    JSON.parse(res.stdout)
  }, `stdout must parse as JSON regardless of stderr content; stderr was:\n${res.stderr}\nstdout:\n${res.stdout}`)
})

test('3) empty estate → exit 0 and the human table reports All lanes free', () => {
  const root = emptyEstate()
  const res = status(root)
  assert.equal(res.status, 0, `an empty estate is not an error; stderr:\n${res.stderr}`)
  assert.match(res.stdout, /All lanes free/, `empty-estate body must say "All lanes free"; got:\n${res.stdout}`)
})

test('4) missing roadmap root → exit 1 with the no-roadmap line on stderr', () => {
  const res = status('/no/such/roadmap')
  assert.equal(res.status, 1, `a missing root is a usage error → exit 1; stderr:\n${res.stderr}`)
  assert.match(res.stderr, /no roadmap at/, `stderr must name the missing roadmap; got:\n${res.stderr}`)
  assert.equal(res.stdout.trim(), '', 'nothing on stdout on the error path')
})
