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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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

test('resolveHygieneSlots — the estate filter is ANCHORED: site/src does NOT tail-collide with src/**', () => {
  const cfg = {
    gateCommands: { ...CFG.gateCommands, 'lint-diff': 'biome check {files}' },
    lintDiffMatches: ['src/**', 'web/src/**'],
  }
  // The 1852 regression: repo-relative site/src/* carries the tail src/*, which matchGlobPath's
  // tail-walk (built for ABSOLUTE keyFiles paths) matched against src/** — the un-onboarded site
  // estate leaked into biome, which exits 1 over nothing. Diff paths are repo-relative; anchored
  // matching must send an all-site set to the NAMED estate skip instead.
  const siteOnly = resolveHygieneSlots(cfg, 'abc1234', ['site/src/components/ChatView.tsx', 'site/src/lib/title-notify.ts'])
  const skip = siteOnly.find((s) => s.slot === 'lint-diff')
  assert.match(skip.skipped, /lintDiffMatches.*estate mismatch/, `named estate skip: ${JSON.stringify(skip)}`)
  assert.equal(skip.command, undefined)
  // Positive coverage: a genuine estate file still resolves the bound slot under anchored matching.
  const mixed = resolveHygieneSlots(cfg, 'abc1234', ['site/src/App.tsx', 'src/foo.ts'])
  const ld = mixed.find((s) => s.slot === 'lint-diff')
  assert.equal(ld.command, 'biome check src/foo.ts', 'the site file is filtered out; the estate file survives')
  assert.deepEqual(ld.files, ['src/foo.ts'])
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

// ── probeScopedSlot — can the scoped runner FAIL AT ALL? (task 20.1) ──────────────────
/**
 * A scoped runner that exits 0 on a target that does NOT exist certifies every task it
 * scopes vacuously: the gate believes the phase's tests ran, the runner ran nothing and
 * said "fine". Nothing in this module asked whether the runner can fail — probeScopedSlot
 * asks it, with a REAL execution through the module's OWN substitution:
 *   vacuous: true   — exit 0 on a nonexistent target: the runner cannot fail, scoping is a lie
 *   vacuous: false  — non-zero: the runner really discriminates, the scoping is load-bearing
 *   vacuous: null   — INDETERMINATE (no template, an unsubstitutable/unscoped template, or the
 *                     probe could not be RUN TO AN ANSWER — it never started, or it hung past
 *                     timeoutMs). Never collapsed into true/false: an unrun probe reporting
 *                     `false` would BE the failure class this closes.
 * The explanatory string is `message` on every branch (the field the phase-20.1 contract names).
 * Pulled DYNAMICALLY for the same reason as the block at the top of this file — a not-yet-
 * implemented export resolves to `undefined` (no link-time SyntaxError), so RED lands only here.
 */
const { probeScopedSlot } = await import('./slots.mjs')

/**
 * A tmp estate holding a REAL, controllable stub runner (a genuine executable sh script, not a
 * function mock). `body` is the sh source after the argv recorder, so each test picks the
 * runner's behavior. Every stub records the argv it was handed to argv.txt — `argv()` returning
 * null therefore PROVES the runner was never invoked, which several null-branch tests depend on.
 */
function stubEstate(body) {
  const dir = mkdtempSync(join(tmpdir(), 'zr-probe-'))
  const argvPath = join(dir, 'argv.txt')
  const runner = join(dir, 'stub-runner.sh')
  writeFileSync(
    runner,
    `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(argvPath)}\n${body}\n`,
    { mode: 0o755 },
  )
  return {
    dir,
    runner,
    template: `sh ${runner} {files}`,
    argv: () => (existsSync(argvPath) ? readFileSync(argvPath, 'utf8').split('\n').filter(Boolean) : null),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

/** The stub that CANNOT fail — exits 0 whatever it is handed (the vacuous scoped runner). */
const ALWAYS_GREEN = 'echo "0 tests found, nothing to do"; exit 0'
/** The stub that discriminates — red iff a target it was handed does not exist. */
const HONEST = 'for f in "$@"; do [ -e "$f" ] || { echo "no such test file: $f" >&2; exit 1; }; done; exit 0'

test('probeScopedSlot — slots.mjs EXPORTS the probe (a gate that cannot ask cannot answer)', () => {
  assert.equal(typeof probeScopedSlot, 'function', 'slots.mjs must export probeScopedSlot')
})

test('probeScopedSlot — a runner that exits 0 on a nonexistent target is VACUOUS TRUE', async () => {
  const s = stubEstate(ALWAYS_GREEN)
  try {
    const r = await probeScopedSlot(s.template, { cwd: s.dir })
    assert.equal(r.vacuous, true, 'exit 0 on a target that does not exist ⇒ the runner cannot fail')
    assert.equal(r.exitCode, 0)
    // The runner really RAN and really received the probe's target — without this the verdict
    // above would be a guess about a process that may never have started.
    assert.deepEqual(s.argv(), [r.target], 'the stub was invoked with exactly the probe target')
    // …and the target really was nonexistent. A probe that happened to pick a REAL file would
    // read green for the honest reason and mislabel an honest runner as vacuous.
    assert.equal(
      existsSync(resolve(s.dir, r.target)),
      false,
      `the probe target must not exist (got ${r.target})`,
    )
  } finally {
    s.cleanup()
  }
})

test('probeScopedSlot — a runner that reds on a nonexistent target is VACUOUS FALSE', async () => {
  const s = stubEstate(HONEST)
  try {
    const r = await probeScopedSlot(s.template, { cwd: s.dir })
    assert.equal(r.vacuous, false, 'a runner that reds on a missing target really scopes')
    assert.equal(r.exitCode, 1)
    assert.deepEqual(s.argv(), [r.target])
  } finally {
    s.cleanup()
  }
})

test('probeScopedSlot — VACUOUS FALSE reads ANY non-zero exit, and carries the code verbatim', async () => {
  // Pins "non-zero", not a hardcoded === 1: a runner exiting 5 on a missing file can fail too.
  const s = stubEstate('exit 5')
  try {
    const r = await probeScopedSlot(s.template, { cwd: s.dir })
    assert.equal(r.vacuous, false)
    assert.equal(r.exitCode, 5, "the runner's own exit code survives — never normalized to 1")
  } finally {
    s.cleanup()
  }
})

test('probeScopedSlot — the honest stub is not an always-red script, so its FALSE is real discrimination', async () => {
  const s = stubEstate(HONEST)
  try {
    writeFileSync(join(s.dir, 'real.test.mjs'), '')
    // Handed a target that EXISTS the same stub is green — so the FALSE below is the stub
    // discriminating present-vs-absent, not a stub that reds at everything.
    const green = await runSlot(
      { slot: 'probe-fixture', command: `sh ${s.runner} real.test.mjs` },
      { cwd: s.dir },
    )
    assert.equal(green.exitCode, 0, 'fixture: the honest stub passes on a real target')
    const r = await probeScopedSlot(s.template, { cwd: s.dir })
    assert.equal(r.vacuous, false)
  } finally {
    s.cleanup()
  }
})

test('probeScopedSlot — the probe command IS the module substitution, never a hand-built string', async () => {
  const s = stubEstate(HONEST)
  try {
    // TWO {files} occurrences: substitute() is split/join (fills BOTH); a hand-rolled
    // String.replace() fills only the FIRST and leaves literal braces in the command.
    const template = `sh ${s.runner} {files} --second-pass {files}`
    const r = await probeScopedSlot(template, { cwd: s.dir })
    const viaRealPath = resolveSlot({ gateCommands: { probe: template } }, 'probe', { files: [r.target] })
    assert.ok(viaRealPath.command, 'fixture: resolveSlot must resolve this template')
    assert.equal(r.command, viaRealPath.command, 'byte-identical to resolveSlot on the same target')
    assert.ok(!r.command.includes('{files}'), 'no literal brace survives into an executed command')
    assert.deepEqual(s.argv(), [r.target, '--second-pass', r.target], 'both placeholders reached the runner')
  } finally {
    s.cleanup()
  }
})

test('probeScopedSlot — NO template ⇒ NULL, and nothing is executed', async () => {
  const s = stubEstate(ALWAYS_GREEN) // would answer TRUE if it were ever invoked
  try {
    for (const template of [undefined, null]) {
      const r = await probeScopedSlot(template, { cwd: s.dir })
      assert.equal(r.vacuous, null, `template ${String(template)} is indeterminate, never a verdict`)
      assert.ok(r.command == null, 'no command was built')
      assert.equal(typeof r.message, 'string')
      assert.ok(r.message.length > 0, 'a null verdict must SAY why it is null')
    }
    assert.equal(s.argv(), null, 'no runner was spawned')
  } finally {
    s.cleanup()
  }
})

test("probeScopedSlot — a template bound to the literal 'none' ⇒ NULL (declared absence, not a verdict)", async () => {
  const s = stubEstate(ALWAYS_GREEN)
  try {
    const r = await probeScopedSlot('none', { cwd: s.dir })
    assert.equal(r.vacuous, null, "'none' is the module's declared-absence literal — there is no runner to probe")
    assert.ok(r.command == null)
    assert.ok(typeof r.message === 'string' && r.message.length > 0)
    assert.equal(s.argv(), null, 'no runner was spawned')
  } finally {
    s.cleanup()
  }
})

test("probeScopedSlot — an UNSUBSTITUTABLE template ⇒ NULL carrying the module's OWN refusal text", async () => {
  const s = stubEstate(ALWAYS_GREEN)
  try {
    // {range} has no value in a scoped probe → substitute() refuses. The probe must surface THAT
    // refusal verbatim rather than inventing a second error vocabulary for the same condition.
    const template = `sh ${s.runner} {files} {range}`
    const expected = resolveSlot({ gateCommands: { probe: template } }, 'probe', { files: ['x'] }).refused
    assert.ok(expected, 'fixture: resolveSlot must itself refuse this template or the compare below is vacuous')
    const r = await probeScopedSlot(template, { cwd: s.dir })
    assert.equal(r.vacuous, null)
    assert.equal(r.message, expected)
    assert.equal(s.argv(), null, 'a command with literal braces left in it is NEVER executed')
  } finally {
    s.cleanup()
  }
})

test('probeScopedSlot — a template with NO {files} placeholder ⇒ NULL, and the full suite is never run', async () => {
  const s = stubEstate(ALWAYS_GREEN)
  try {
    // Nothing to make nonexistent: an unscoped template has no target to probe. Answering TRUE
    // here would slander every consumer whose runner is simply not file-scoped; answering by
    // RUNNING it would make a cheap probe cost a full suite.
    const template = `sh ${s.runner} --all`
    const r = await probeScopedSlot(template, { cwd: s.dir })
    assert.equal(r.vacuous, null, 'an unscoped template cannot be probed for vacuous scoping')
    assert.ok(typeof r.message === 'string' && r.message.length > 0)
    assert.equal(s.argv(), null, 'the probe never executes an unscoped command')
  } finally {
    s.cleanup()
  }
})

test('probeScopedSlot — a shell-level command-not-found exit is a non-zero verdict', async () => {
  const s = stubEstate(ALWAYS_GREEN)
  try {
    // The probe successfully spawned its bash command; per contract, every completed non-zero
    // verdict is evidence that the scoped template can fail. A spawn error is a distinct branch.
    const template = `zr-no-such-runner-${Math.random().toString(36).slice(2, 10)} {files}`
    const r = await probeScopedSlot(template, { cwd: s.dir })
    assert.equal(r.exitCode, 127)
    assert.equal(r.vacuous, false, 'a completed non-zero shell verdict means the scoped command can fail')
  } finally {
    s.cleanup()
  }
})

test('probeScopedSlot — a runner that HANGS past timeoutMs ⇒ NULL naming the timeout, and the probe returns', async () => {
  // The probe runs a REAL consumer command; a runner that blocks (a watcher left in `--watch`
  // mode, a prompt on stdin, a wedged compiler) would otherwise hang the gate that asked. The
  // budget must also be an ANSWER boundary, not just a stopwatch: whatever exit the kill
  // produces (a signal, 143, 124) is NOT the runner discriminating a missing target, so the
  // verdict is null. Reading a timeout kill as VACUOUS FALSE would certify the scoping off a
  // runner that never rendered a judgement at all.
  const s = stubEstate('sleep 10; exit 0') // exit 0 = TRUE if ever allowed to finish; it must not be
  try {
    const started = Date.now()
    const r = await probeScopedSlot(s.template, { cwd: s.dir, timeoutMs: 250 })
    const elapsed = Date.now() - started
    assert.equal(r.vacuous, null, 'a runner killed mid-flight answered nothing — never true, never false')
    assert.match(
      String(r.message),
      /time(?:d)?\s*-?\s*out/i,
      `the null verdict must NAME the timeout, got: ${JSON.stringify(r.message)}`,
    )
    // Bounded well under the stub's 10s sleep: proves the 250ms budget was ENFORCED (the child
    // killed, the promise settled) rather than the probe quietly waiting the runner out.
    assert.ok(elapsed < 5000, `probe must return on its own timeout budget, took ${elapsed}ms`)
    // The runner really STARTED and really hung — without this the null could be any of the
    // module's other null branches (unscoped template, refusal) passing for a timeout.
    assert.deepEqual(s.argv(), [r.target], 'the hanging stub was invoked with exactly the probe target')
  } finally {
    s.cleanup()
  }
})
