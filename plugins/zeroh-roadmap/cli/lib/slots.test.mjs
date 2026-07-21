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

// matchGlobPath is the ONE glob matcher (ladder.mjs) — imported here to cross-check that
// resolveConditionalSlots reuses it, never forks a second matcher.
import { matchGlobPath } from './ladder.mjs'

// New task-1792.1/1792.2 exports pulled DYNAMICALLY: a not-yet-implemented export resolves
// to `undefined` here (no link-time SyntaxError), so RED lands ONLY on the new tests below —
// the static-import suite above stays green until the feature ships.
const { resolveHygieneSlots, historyCommentFindings, resolveConditionalSlots } = await import(
  './slots.mjs'
)

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

// ── {base} substitution — the hygiene-lint sibling of {files}/{range} (task 1792.1) ────
const HYGIENE_CFG = Object.freeze({
  gateCommands: Object.freeze({
    ...CFG.gateCommands,
    'lint-diff': 'npm run lint:diff {base}',
  }),
})

test('resolveSlot — {base} substitutes VERBATIM (sibling of {files}/{range})', () => {
  const r = resolveSlot(HYGIENE_CFG, 'lint-diff', { base: 'origin/develop..HEAD' })
  // the base ref arrives raw — the template author owns quoting, exactly like {files}/{range}
  assert.equal(r.command, 'npm run lint:diff origin/develop..HEAD')
})

test('resolveSlot — a {base} placeholder with no value REFUSES (never a literal-brace command)', () => {
  const r = resolveSlot(HYGIENE_CFG, 'lint-diff', {})
  assert.match(r.refused, /\{base\} placeholder but no base/)
  assert.equal(r.command, undefined)
})

// ── resolveHygieneSlots — a NAMED skip, never a silent omission (task 1792.1) ──────────
test('resolveHygieneSlots — a bound lint-diff resolves with {base} → the base sha', () => {
  const arr = resolveHygieneSlots(HYGIENE_CFG, 'abc1234')
  assert.ok(Array.isArray(arr), 'returns an array')
  const ld = arr.find((s) => s.slot === 'lint-diff')
  assert.ok(ld, 'lint-diff entry present')
  assert.equal(ld.command, 'npm run lint:diff abc1234')
  assert.equal(ld.skipped, undefined)
  assert.equal(ld.declaredAbsent, undefined)
})

test('resolveHygieneSlots — an UNBOUND lint-diff is a NAMED skip OBJECT, never omitted', () => {
  const arr = resolveHygieneSlots(CFG, 'abc1234') // CFG binds no lint-diff
  assert.ok(Array.isArray(arr))
  const ld = arr.find((s) => s.slot === 'lint-diff')
  assert.ok(ld, 'lint-diff must appear as a skip entry (named, never a silent omission)')
  assert.equal(
    ld.skipped,
    'not bound in gateCommands — hygiene lint skipped (named, never silent)',
  )
  assert.equal(ld.command, undefined)
})

test("resolveHygieneSlots — lint-diff bound to 'none' is declaredAbsent like its siblings", () => {
  const cfg = { gateCommands: { ...CFG.gateCommands, 'lint-diff': 'none' } }
  const arr = resolveHygieneSlots(cfg, 'abc1234')
  const ld = arr.find((s) => s.slot === 'lint-diff')
  assert.ok(ld)
  assert.equal(ld.declaredAbsent, true)
  assert.equal(ld.command, undefined)
  assert.equal(ld.skipped, undefined)
})

test('resolveHygieneSlots — lintDiffMatches filters to the linter estate; all-outside ⇒ the NAMED estate skip', () => {
  const cfg = {
    gateCommands: { ...CFG.gateCommands, 'lint-diff': 'biome check {files}' },
    lintDiffMatches: ['src/**', 'web/src/**'],
  }
  // Mixed set: one estate file + one roadmap file → only the estate file substitutes.
  const mixed = resolveHygieneSlots(cfg, 'abc1234', ['src/foo.ts', 'roadmap/phases/phase-1817.phase.ts'])
  const ld = mixed.find((s) => s.slot === 'lint-diff')
  assert.equal(ld.command, 'biome check src/foo.ts', 'the roadmap file is filtered out before substitution')
  assert.deepEqual(ld.files, ['src/foo.ts'])
  // Roadmap-only set → the named estate skip (the 1817 gate quirk), never exit-1-over-nothing.
  const only = resolveHygieneSlots(cfg, 'abc1234', ['roadmap/phases/phase-1817.phase.ts'])
  const skip = only.find((s) => s.slot === 'lint-diff')
  assert.match(skip.skipped, /lintDiffMatches.*estate mismatch/, `named estate skip: ${JSON.stringify(skip)}`)
  assert.equal(skip.command, undefined)
  // No lintDiffMatches configured → behavior-identical to today (no filtering).
  const noFilter = resolveHygieneSlots({ gateCommands: cfg.gateCommands }, 'abc1234', ['roadmap/phases/phase-1817.phase.ts'])
  assert.equal(noFilter[0].command, 'biome check roadmap/phases/phase-1817.phase.ts')
})

// ── historyCommentFindings — pure scan of a unified diff's ADDED comment lines ─────────
test('historyCommentFindings — an ADDED comment with a phase number is a finding (file+line+match)', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,2 +1,3 @@',
    ' const a = 1',
    '+// phase-1792 wiring for the hygiene gate',
    ' const b = 2',
    '',
  ].join('\n')
  const found = historyCommentFindings(diff)
  assert.equal(found.length, 1)
  assert.deepEqual(found[0], { file: 'src/a.ts', line: 2, match: 'phase-1792' })
})

test('historyCommentFindings — a date literal in a # comment is a finding at the right line', () => {
  const diff = [
    'diff --git a/scripts/x.py b/scripts/x.py',
    '--- a/scripts/x.py',
    '+++ b/scripts/x.py',
    '@@ -10,1 +10,3 @@',
    ' keep = 1',
    '+x = 2',
    '+# shipped 2026-07-20',
    '',
  ].join('\n')
  const found = historyCommentFindings(diff)
  // new line 10 = context 'keep = 1', 11 = '+x = 2' (code, no match), 12 = '+# shipped 2026-07-20'
  assert.equal(found.length, 1)
  assert.deepEqual(found[0], { file: 'scripts/x.py', line: 12, match: '2026-07-20' })
})

test('historyCommentFindings — a version literal in a jsdoc (*) comment is a finding', () => {
  const diff = [
    'diff --git a/src/v.ts b/src/v.ts',
    '--- a/src/v.ts',
    '+++ b/src/v.ts',
    '@@ -1 +1,2 @@',
    ' code()',
    '+ * bumped to v0.36.0 in this pass',
    '',
  ].join('\n')
  const found = historyCommentFindings(diff)
  assert.equal(found.length, 1)
  assert.deepEqual(found[0], { file: 'src/v.ts', line: 2, match: 'v0.36.0' })
})

test('historyCommentFindings — an ADDED CODE line carrying a version literal is NOT a finding', () => {
  const diff = [
    'diff --git a/src/b.ts b/src/b.ts',
    '--- a/src/b.ts',
    '+++ b/src/b.ts',
    '@@ -1 +1,2 @@',
    ' x()',
    "+const VERSION = 'v0.36.0'",
    '',
  ].join('\n')
  // the string lives in real code, not a comment — narration hygiene targets comments only
  assert.deepEqual(historyCommentFindings(diff), [])
})

test('historyCommentFindings — files under roadmap/ are EXEMPT (phase files legitimately carry numbers)', () => {
  const diff = [
    'diff --git a/roadmap/phases/phase-1792.phase.ts b/roadmap/phases/phase-1792.phase.ts',
    '--- a/roadmap/phases/phase-1792.phase.ts',
    '+++ b/roadmap/phases/phase-1792.phase.ts',
    '@@ -1 +1,2 @@',
    ' x',
    '+// phase 1792 — 2026-07-20 — v0.36.0, all fine under roadmap/',
    '',
  ].join('\n')
  assert.deepEqual(historyCommentFindings(diff), [])
})

test('historyCommentFindings — REMOVED and CONTEXT comment lines never match (added-only)', () => {
  const diff = [
    'diff --git a/src/d.ts b/src/d.ts',
    '--- a/src/d.ts',
    '+++ b/src/d.ts',
    '@@ -1,2 +1,1 @@',
    '-// phase 1700 old narration',
    ' // touched in phase 1650 (context, unchanged)',
    '',
  ].join('\n')
  assert.deepEqual(historyCommentFindings(diff), [])
})

// ── resolveConditionalSlots — glob-gated extra slots, reusing matchGlobPath (task 1792.2) ─
const CONDITIONAL_CFG = Object.freeze({
  gateCommands: CFG.gateCommands, // has integration + unit; NO build (an unbound slot to test)
  gateConditionalSlots: Object.freeze([
    Object.freeze({ whenDiffMatches: ['src/contracts/**'], slot: 'integration' }),
    Object.freeze({ whenDiffMatches: ['web/**'], slot: 'unit' }),
  ]),
})

test('resolveConditionalSlots — a matching glob resolves its slot, augmented with a reason naming the glob', () => {
  const arr = resolveConditionalSlots(CONDITIONAL_CFG, ['src/contracts/foo.ts'])
  assert.ok(Array.isArray(arr), 'always returns an array')
  assert.equal(arr.length, 1)
  assert.equal(arr[0].slot, 'integration')
  assert.equal(arr[0].command, CFG.gateCommands.integration) // resolveSlot's own command, unchanged
  assert.equal(arr[0].reason, 'src/contracts/** matched → integration')
})

test('resolveConditionalSlots — no diff path matches any entry → [] (no phantom slots)', () => {
  const arr = resolveConditionalSlots(CONDITIONAL_CFG, ['docs/readme.md', 'scripts/x.sh'])
  assert.deepEqual(arr, [])
})

test('resolveConditionalSlots — mixed entries: only the matching one resolves', () => {
  const arr = resolveConditionalSlots(CONDITIONAL_CFG, ['web/src/x.ts'])
  assert.equal(arr.length, 1)
  assert.equal(arr[0].slot, 'unit')
  assert.equal(arr[0].reason, 'web/** matched → unit')
})

test('resolveConditionalSlots — two entries both match → both resolve, each with its own glob reason', () => {
  const arr = resolveConditionalSlots(CONDITIONAL_CFG, ['src/contracts/a.ts', 'web/src/b.ts'])
  assert.equal(arr.length, 2)
  assert.deepEqual(
    arr.map((e) => e.slot).sort(),
    ['integration', 'unit'],
  )
  assert.equal(arr.find((e) => e.slot === 'integration').reason, 'src/contracts/** matched → integration')
  assert.equal(arr.find((e) => e.slot === 'unit').reason, 'web/** matched → unit')
})

test('resolveConditionalSlots — a matching entry whose slot is UNBOUND returns the refusal shape verbatim', () => {
  const cfg = {
    gateCommands: CFG.gateCommands, // no 'build' binding
    gateConditionalSlots: [{ whenDiffMatches: ['src/build/**'], slot: 'build' }],
  }
  const arr = resolveConditionalSlots(cfg, ['src/build/thing.ts'])
  assert.equal(arr.length, 1)
  assert.equal(arr[0].slot, 'build')
  // the SAME refusal resolveSlot already produces — no swallowed/renamed error
  assert.equal(
    arr[0].refused,
    'gate cannot run: gateCommands.build missing in roadmap/roadmap.config.json — add it',
  )
  assert.equal(arr[0].command, undefined)
})

test('resolveConditionalSlots — glob semantics ARE matchGlobPath (src/contracts/** hits src/contracts/foo.ts, misses web/src/x.ts)', () => {
  // pin the exact matcher behavior this function must reuse — never a second glob engine
  assert.equal(matchGlobPath('src/contracts/**', 'src/contracts/foo.ts'), true)
  assert.equal(matchGlobPath('src/contracts/**', 'web/src/x.ts'), false)
  const cfg = {
    gateCommands: CFG.gateCommands,
    gateConditionalSlots: [{ whenDiffMatches: ['src/contracts/**'], slot: 'integration' }],
  }
  assert.equal(resolveConditionalSlots(cfg, ['src/contracts/foo.ts']).length, 1)
  assert.deepEqual(resolveConditionalSlots(cfg, ['web/src/x.ts']), [])
})
