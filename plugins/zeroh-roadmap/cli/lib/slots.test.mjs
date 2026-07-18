#!/usr/bin/env node
/**
 * Fixtures for cli/lib/slots.mjs — resolution (missing/none/plain), VERBATIM
 * {files}/{range} substitution (a shell-meta char arrives UNQUOTED — pinning slots.mjs
 * adds nothing), the scoped fallback note verbatim + the byte-identical no-invented-
 * filter pin, and runSlot exit/log fixtures driven by controllable fake commands in a
 * tmp dir. Run: node --test cli/lib/slots.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  resolveSlot,
  resolveScopedOrFallback,
  resolveImpactedOrFallback,
  runSlot,
  SCOPED_FALLBACK_NOTE,
  IMPACTED_FALLBACK_NOTE,
} from './slots.mjs'

const CFG = Object.freeze({
  gateCommands: Object.freeze({
    lint: 'npm run lint:boundaries',
    types: 'npm run type-check',
    unit: 'bash scripts/test/run-tier.sh unit',
    integration: 'bash scripts/test/run-tier.sh integration',
    e2e: 'none',
    'integration-scoped': 'bash scripts/test/run-tier.sh integration-scoped {files}',
    'unit-impacted': 'bash scripts/test/run-tier.sh unit-impacted {range}',
  }),
})

// ── resolution ─────────────────────────────────────────────────────────────────────
test('resolveSlot — a plain slot resolves to its command', () => {
  assert.deepEqual(resolveSlot(CFG, 'lint'), { slot: 'lint', command: 'npm run lint:boundaries' })
})

test('resolveSlot — a missing slot REFUSES with the exact string', () => {
  const r = resolveSlot(CFG, 'build')
  assert.equal(r.refused, 'gate cannot run: gateCommands.build missing in roadmap/roadmap.config.json — add it')
  assert.equal(r.command, undefined)
})

test("resolveSlot — a slot bound to the literal 'none' is declaredAbsent, not a failure", () => {
  assert.deepEqual(resolveSlot(CFG, 'e2e'), { slot: 'e2e', declaredAbsent: true })
})

test('resolveSlot — {files} substitutes VERBATIM, no quoting even with shell-meta chars', () => {
  const r = resolveSlot(CFG, 'integration-scoped', { files: ['a;b.itest.ts', 'c d.itest.ts'] })
  // slots.mjs adds NOTHING — the shell-meta ; and the space arrive raw (the template author owns quoting)
  assert.equal(r.command, 'bash scripts/test/run-tier.sh integration-scoped a;b.itest.ts c d.itest.ts')
})

test('resolveSlot — {range} substitutes verbatim', () => {
  const r = resolveSlot(CFG, 'unit-impacted', { range: 'origin/develop..HEAD' })
  assert.equal(r.command, 'bash scripts/test/run-tier.sh unit-impacted origin/develop..HEAD')
})

test('resolveSlot — a {files} placeholder with no value REFUSES (never a literal-brace command)', () => {
  const r = resolveSlot(CFG, 'integration-scoped', {})
  assert.match(r.refused, /\{files\} placeholder but no files/)
  assert.equal(r.command, undefined)
})

// ── scoped fallback — the single seam ────────────────────────────────────────────────
test('resolveScopedOrFallback — a bound scoped slot substitutes files', () => {
  const r = resolveScopedOrFallback(CFG, 'integration', ['integration/relay.itest.ts'])
  assert.equal(r.scoped, true)
  assert.equal(r.command, 'bash scripts/test/run-tier.sh integration-scoped integration/relay.itest.ts')
})

test('resolveScopedOrFallback — an UNBOUND scoped slot returns the full command byte-identical + the verbatim note', () => {
  // CFG has no unit-scoped → fall back to the full unit slot
  const r = resolveScopedOrFallback(CFG, 'unit', ['lib/foo.test.ts'])
  assert.equal(r.scoped, false)
  assert.equal(r.note, SCOPED_FALLBACK_NOTE)
  assert.equal(r.note, 'scoped slot missing — ran full suite')
  // BYTE-IDENTICAL to the full binding — no appended/invented filter (the FM2 class)
  assert.equal(r.command, CFG.gateCommands.unit)
})

// ── impacted fallback — the {range} single seam (mirrors scoped) ──────────────────────
test('resolveImpactedOrFallback — a bound impacted slot substitutes the {range} verbatim', () => {
  const r = resolveImpactedOrFallback(CFG, 'unit', 'origin/develop..HEAD')
  assert.equal(r.scoped, true)
  assert.equal(r.command, 'bash scripts/test/run-tier.sh unit-impacted origin/develop..HEAD')
})

test('resolveImpactedOrFallback — an UNBOUND impacted slot returns the full command byte-identical + the verbatim note', () => {
  // CFG has no integration-impacted → fall back to the full integration slot
  const r = resolveImpactedOrFallback(CFG, 'integration', 'origin/develop..HEAD')
  assert.equal(r.scoped, false)
  assert.equal(r.note, IMPACTED_FALLBACK_NOTE)
  assert.equal(r.note, 'impacted slot missing — ran full suite')
  // BYTE-IDENTICAL to the full binding — no appended/invented filter, no range grafted on
  assert.equal(r.command, CFG.gateCommands.integration)
})

test('resolveImpactedOrFallback — a bound impacted slot with NO range REFUSES (never a literal-brace command)', () => {
  const r = resolveImpactedOrFallback(CFG, 'unit', null)
  assert.match(r.refused, /\{range\} placeholder but no range/)
  assert.equal(r.command, undefined)
})

test("resolveImpactedOrFallback — an impacted slot bound to the literal 'none' falls back to the full tier", () => {
  const cfg = {
    gateCommands: {
      ...CFG.gateCommands,
      'unit-impacted': 'none',
    },
  }
  const r = resolveImpactedOrFallback(cfg, 'unit', 'origin/develop..HEAD')
  assert.equal(r.scoped, false)
  assert.equal(r.note, IMPACTED_FALLBACK_NOTE)
  assert.equal(r.command, CFG.gateCommands.unit)
})

// ── runSlot — exit passthrough + tee'd log + stream-through ───────────────────────────
test('runSlot — a green fake command: exit 0, marker tee-d to the log AND streamed to stdout', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zr-slots-'))
  const logPath = join(dir, 'ok.log')
  const captured = []
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = (chunk, ...rest) => {
    captured.push(chunk.toString())
    return orig(chunk, ...rest)
  }
  try {
    const r = await runSlot({ slot: 'unit', command: "echo GREEN_MARKER_123" }, { cwd: dir, logPath })
    assert.equal(r.exitCode, 0)
    assert.equal(r.slot, 'unit')
    assert.ok(typeof r.durationMs === 'number')
    assert.match(readFileSync(logPath, 'utf8'), /GREEN_MARKER_123/) // tee'd to the log
    assert.ok(captured.join('').includes('GREEN_MARKER_123'), 'streamed through to stdout unfiltered')
  } finally {
    process.stdout.write = orig
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runSlot — a red fake command returns its exit code as DATA (never throws)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zr-slots-'))
  const logPath = join(dir, 'red.log')
  try {
    const r = await runSlot({ slot: 'types', command: 'echo FAIL_MARKER >&2; exit 3' }, { cwd: dir, logPath })
    assert.equal(r.exitCode, 3) // passthrough, not thrown
    assert.match(readFileSync(logPath, 'utf8'), /FAIL_MARKER/) // stderr tee'd too (failure-identity rule)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runSlot — carries a scoped-fallback note through to the result row', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zr-slots-'))
  try {
    const r = await runSlot(
      { slot: 'unit', command: 'true', note: SCOPED_FALLBACK_NOTE },
      { cwd: dir, logPath: join(dir, 'n.log') },
    )
    assert.equal(r.note, 'scoped slot missing — ran full suite')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
