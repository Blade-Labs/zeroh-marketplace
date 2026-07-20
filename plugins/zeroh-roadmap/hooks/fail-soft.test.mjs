#!/usr/bin/env node
/**
 * fail-soft — the hook wrapper's own suite. Fixtures are tiny throwaway hook modules in a tmp dir:
 * one that crashes at LOAD time (the cjs/loader class the wrapper exists for), one that runs
 * cleanly, one that exits with its own verdict code. Run: node --test hooks/fail-soft.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const WRAPPER = join(dirname(fileURLToPath(import.meta.url)), 'fail-soft.mjs')
const bases = []
process.on('exit', () => {
  for (const b of bases) {
    try {
      rmSync(b, { recursive: true, force: true })
    } catch {
      /* best-effort */
    }
  }
})

function fixture(body) {
  const dir = mkdtempSync(join(tmpdir(), 'failsoft-'))
  bases.push(dir)
  const p = join(dir, 'hook.mjs')
  writeFileSync(p, body)
  return p
}

const run = (hookPath) => spawnSync('node', [WRAPPER, hookPath], { encoding: 'utf8', input: '{}' })

test('a hook that crashes at LOAD time fails soft — one named line, exit 0', () => {
  const p = fixture("import './does-not-exist-anywhere.mjs'\n")
  const r = run(p)
  assert.equal(r.status, 0, 'a broken hook must never block the turn')
  assert.match(r.stderr, /\[zeroh-roadmap\] hook hook\.mjs failed soft:/)
  assert.doesNotMatch(r.stderr, /at ModuleJob/, 'the raw Node stack never reaches the user')
})

test('a hook that throws inside its default export fails soft the same way', () => {
  const p = fixture("export default function () { throw new Error('boom inside') }\n")
  const r = run(p)
  assert.equal(r.status, 0)
  assert.match(r.stderr, /failed soft: boom inside/)
})

test('a clean self-running hook passes through untouched (exit 0, its own stdout)', () => {
  const p = fixture("process.stdout.write('hook-ran\\n')\n")
  const r = run(p)
  assert.equal(r.status, 0)
  assert.match(r.stdout, /hook-ran/)
  assert.equal(r.stderr.trim(), '', 'a healthy hook produces no fail-soft line')
})

test("a hook's own VERDICT exit code survives — fail-soft covers crashes, never judgments", () => {
  const p = fixture("export default function () { process.stdout.write('{\"decision\":\"block\"}\\n'); return 2 }\n")
  const r = run(p)
  assert.equal(r.status, 2, 'a successful evaluation keeps its contract exit code')
  assert.match(r.stdout, /"decision":"block"/)
})

test('no hook argument → one named line, exit 0 (never a stack)', () => {
  const r = spawnSync('node', [WRAPPER], { encoding: 'utf8', input: '{}' })
  assert.equal(r.status, 0)
  assert.match(r.stderr, /fail-soft: no hook module given/)
})
