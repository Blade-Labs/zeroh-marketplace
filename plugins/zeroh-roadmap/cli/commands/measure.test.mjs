#!/usr/bin/env node
/**
 * measure.test.mjs — `roadmap measure` at the CLI entry (ROADCODE 1659.3). Drives the REAL
 * bin/roadmap.mjs over a tmp fixture manifest (--manifest override) with known byte sizes,
 * so the token math (Σ ceil(bytes/4)), the --assert exit codes, the missing-manifest-path
 * loud fail (exit 1), and the unknown-flow / no-flow usage errors are all pinned.
 *
 * The REAL-tree ≤12k assertion is deliberately NOT here — it lands in 1659.8 once the diet
 * is complete, so this suite stays green at every commit in between. Run:
 * node --test cli/commands/measure.test.mjs
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

/**
 * A tmp dir holding a fixture manifest + files of exact byte sizes. `flows` maps flow →
 * array of { name, bytes } (bytes written verbatim); a `missing: true` entry lists a
 * manifest path with NO file on disk (to exercise the loud-fail branch).
 */
function makeManifest(flows) {
  const root = mkdtempSync(join(tmpdir(), 'zr-measure-'))
  bases.push(root)
  const manifestFlows = {}
  for (const [flow, files] of Object.entries(flows)) {
    const entries = []
    for (const f of files) {
      const rel = `f/${flow}-${f.name}.md`
      if (!f.missing) {
        mkdirSync(join(root, 'f'), { recursive: true })
        writeFileSync(join(root, rel), 'x'.repeat(f.bytes))
      }
      entries.push({ path: rel, why: `${flow}:1 — fixture` })
    }
    manifestFlows[flow] = { files: entries }
  }
  const manifestPath = join(root, 'manifest.json')
  writeFileSync(manifestPath, JSON.stringify({ flows: manifestFlows }))
  return manifestPath
}

function measure(manifestPath, args) {
  try {
    const stdout = execFileSync('node', [BIN, 'measure', '--manifest', manifestPath, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, stdout, stderr: '' }
  } catch (err) {
    return { code: err.status ?? 1, stdout: (err.stdout ?? '').toString(), stderr: (err.stderr ?? '').toString() }
  }
}

test('total = Σ ceil(bytes/4) per file', () => {
  // 10 → ceil(2.5)=3 ; 4 → 1 ; 7 → ceil(1.75)=2  ⇒ total 6, bytes 21
  const m = makeManifest({ f: [{ name: 'a', bytes: 10 }, { name: 'b', bytes: 4 }, { name: 'c', bytes: 7 }] })
  const r = measure(m, ['--flow', 'f', '--json'])
  assert.equal(r.code, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.equal(out.totalBytes, 21)
  assert.equal(out.totalTokens, 6)
  assert.deepEqual(out.files.map((x) => x.tokens), [3, 1, 2])
})

test('--assert passes (exit 0) when total ≤ N', () => {
  const m = makeManifest({ f: [{ name: 'a', bytes: 40 }] }) // 10 tokens
  assert.equal(measure(m, ['--flow', 'f', '--assert', '10']).code, 0)
  assert.equal(measure(m, ['--flow', 'f', '--assert', '11']).code, 0)
})

test('--assert fails (exit 2) when total > N', () => {
  const m = makeManifest({ f: [{ name: 'a', bytes: 44 }] }) // 11 tokens
  const r = measure(m, ['--flow', 'f', '--assert', '10'])
  assert.equal(r.code, 2)
})

test('a missing manifest path fails loud (exit 1), never silently drops a file', () => {
  const m = makeManifest({ f: [{ name: 'a', bytes: 40 }, { name: 'gone', bytes: 0, missing: true }] })
  const r = measure(m, ['--flow', 'f'])
  assert.equal(r.code, 1)
  assert.match(r.stderr, /does not exist/)
})

test('unknown --flow exits 1', () => {
  const m = makeManifest({ f: [{ name: 'a', bytes: 40 }] })
  const r = measure(m, ['--flow', 'nope'])
  assert.equal(r.code, 1)
  assert.match(r.stderr, /unknown flow/)
})

test('no --flow exits 1', () => {
  const m = makeManifest({ f: [{ name: 'a', bytes: 40 }] })
  const r = measure(m, [])
  assert.equal(r.code, 1)
  assert.match(r.stderr, /--flow required/)
})

test('a non-numeric --assert exits 1', () => {
  const m = makeManifest({ f: [{ name: 'a', bytes: 40 }] })
  assert.equal(measure(m, ['--flow', 'f', '--assert', 'abc']).code, 1)
})

test('human output carries the per-file table + total', () => {
  const m = makeManifest({ f: [{ name: 'a', bytes: 40 }] })
  const r = measure(m, ['--flow', 'f'])
  assert.equal(r.code, 0)
  assert.match(r.stdout, /TOTAL/)
  assert.match(r.stdout, /10/)
})

// The REAL-tree budget (armed at 1659.8 once the diet completed — the default manifest, no override):
// the do-arc protocol load must stay ≤ 12,000 tokens forever. Plugin CI (1660) runs this on every push.
test('real tree: measure --flow do-arc --assert 12000 exits 0 (the protocol-load-cut criterion)', () => {
  const out = JSON.parse(
    execFileSync('node', [BIN, 'measure', '--flow', 'do-arc', '--assert', '12000', '--json'], { encoding: 'utf8' }),
  )
  assert.ok(out.totalTokens <= 12000, `do-arc load ${out.totalTokens} > 12000`)
  assert.equal(out.withinBudget, true)
})
