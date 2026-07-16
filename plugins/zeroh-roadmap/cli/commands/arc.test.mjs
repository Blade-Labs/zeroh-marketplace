#!/usr/bin/env node
/**
 * arc.test.mjs — `roadmap arc next` / `arc record-validate` at the CLI entry (arc
 * ROADCODE 1657.2). Drives the REAL bin/roadmap.mjs over scratch git repos; asserts
 * the universal exit contract (0 any derived action incl complete · 2 blocked · 1
 * config/tsx) and the record-validate → arc next round-trip (gates.validated false →
 * write PASS → true). Run: node --test cli/commands/arc.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const BIN = join(HERE, '..', '..', 'bin', 'roadmap.mjs')
const bases = []
process.on('exit', () => bases.forEach((b) => rmSync(b, { recursive: true, force: true })))

const tsSrc = (obj) =>
  'export default ' + JSON.stringify(obj, null, 2).replace(/"([\w$]+)":/g, '$1:').replace(/"/g, "'") + '\n'
const CONFIG = { configVersion: 1, gateCommands: { lint: 'l', types: 't', unit: 'u', integration: 'i', build: 'b', e2e: 'none', emit: 'e' } }

function makeRepo(arcId, arc, phases, { configJson = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'zr-arc-'))
  bases.push(root)
  mkdirSync(join(root, 'roadmap', 'phases'), { recursive: true })
  mkdirSync(join(root, 'roadmap', 'arcs'), { recursive: true })
  writeFileSync(join(root, 'roadmap', 'arcs', `${arcId}.arc.ts`), tsSrc({ id: arcId, baseRef: 'develop', ...arc }))
  for (const p of phases) writeFileSync(join(root, 'roadmap', 'phases', `phase-${p.phase}.phase.ts`), tsSrc(p))
  if (configJson) writeFileSync(join(root, 'roadmap', 'roadmap.config.json'), JSON.stringify(CONFIG))
  // Minimal consumer registry so the REAL debt-census.mts (imported by runDebtCensus via
  // `npx --no-install tsx`) runs over the scratch repo and reports an empty (swept) slice —
  // the census is exhaustively exercised with fakes in derive.test.mjs; here it is real e2e.
  mkdirSync(join(root, 'lib', 'roadmap'), { recursive: true })
  writeFileSync(
    join(root, 'lib', 'roadmap', 'registry.ts'),
    'export async function discoverPhases() { return { phases: [], errors: [] } }\n'
      + 'export async function discoverArcs() { return { arcs: [] } }\n',
  )
  execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'init', '-q'])
  execFileSync('git', ['-C', root, 'add', '-A'])
  execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'seed'])
  return root
}

function bin(root, args) {
  try {
    const stdout = execFileSync('node', [BIN, ...args], { cwd: root, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, stdout }
  } catch (e) {
    return { code: e.status ?? 1, stdout: (e.stdout ?? '').toString(), stderr: (e.stderr ?? '').toString() }
  }
}

const backlog = (n) => ({ phase: n, status: 'backlog', arcId: 'A', tasks: [{ id: `${n}.1`, done: false }] })
const done = (n) => ({ phase: n, status: 'done', arcId: 'A', tasks: [{ id: `${n}.1`, done: true }] })

test('arc next — exit 0 with a derived run-phase action, JSON on stdout', () => {
  const root = makeRepo('A', { planes: [{ name: 'P', phases: [10] }] }, [backlog(10)])
  const r = bin(root, ['arc', 'next', 'A', '--json'])
  assert.equal(r.code, 0)
  const pos = JSON.parse(r.stdout)
  assert.equal(pos.action, 'run-phase')
  assert.equal(pos.phase, 10)
})

test('arc next — exit 2 on a blocked lane (foreign worktree sidecar)', () => {
  const root = makeRepo('A', { planes: [{ name: 'P', phases: [10] }] }, [backlog(10)])
  mkdirSync(join(root, 'roadmap', 'arcs', '.building'), { recursive: true })
  writeFileSync(join(root, 'roadmap', 'arcs', '.building', 'A.json'), JSON.stringify({ arcId: 'A', worktree: '/some/other/tree' }))
  const r = bin(root, ['arc', 'next', 'A'])
  assert.equal(r.code, 2)
  assert.match(r.stdout, /"action": "blocked"/)
})

test('arc next — exit 1 when config.json is absent (usage/config error)', () => {
  const root = makeRepo('A', { planes: [{ name: 'P', phases: [10] }] }, [backlog(10)], { configJson: false })
  const r = bin(root, ['arc', 'next', 'A'])
  assert.equal(r.code, 1)
})

test('arc next — exit 0 for the terminal complete action', () => {
  const root = makeRepo('A', { planes: [{ name: 'P', phases: [10] }] }, [done(10)])
  writeFileSync(join(root, 'roadmap', 'arc-summary.json'), JSON.stringify({ arcId: 'A', outcome: 'shipped' }))
  const r = bin(root, ['arc', 'next', 'A', '--json'])
  assert.equal(r.code, 0)
  assert.equal(JSON.parse(r.stdout).action, 'complete')
})

test('record-validate → arc next round-trip: gates.validated false → write PASS → true → land', () => {
  const root = makeRepo('A', { planes: [{ name: 'P', phases: [10] }], acceptanceCriteria: [{ id: 'c1', job: 'x' }] }, [done(10)])
  // Before stamping: swept but not validated → action validate.
  let r = bin(root, ['arc', 'next', 'A', '--json'])
  assert.equal(r.code, 0)
  assert.equal(JSON.parse(r.stdout).gates.validated, false)
  assert.equal(JSON.parse(r.stdout).action, 'validate')
  // Stamp PASS.
  r = bin(root, ['arc', 'record-validate', 'A', '--verdict', 'PASS'])
  assert.equal(r.code, 0)
  // After: validated true → action land.
  r = bin(root, ['arc', 'next', 'A', '--json'])
  const pos = JSON.parse(r.stdout)
  assert.equal(pos.gates.validated, true)
  assert.equal(pos.action, 'land')
})

test('record-validate — a bad verdict is a usage error (exit 1)', () => {
  const root = makeRepo('A', { planes: [{ name: 'P', phases: [10] }] }, [done(10)])
  assert.equal(bin(root, ['arc', 'record-validate', 'A', '--verdict', 'MAYBE']).code, 1)
})
