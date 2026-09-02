#!/usr/bin/env node
/**
 * Fixtures for cli/lib/tsx-bridge.mjs against a tmp consumer tree that imports the
 * REAL templates/schema.ts by absolute path (the validate-test fixture pattern):
 * consumerSchemaPath resolution + exists-check, bridgeImport of a valid + a
 * zod-invalid roadmap file, bridgeEval of a trivial script, and the verbatim
 * tsx-absent hint string-pin. Run: node --test cli/lib/tsx-bridge.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  bridgeImport,
  bridgeImportMany,
  bridgeEval,
  PLUGIN_TSX,
  resolveTsxInvocation,
  consumerSchemaPath,
  BridgeError,
  TSX_ABSENT_HINT,
} from './tsx-bridge.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCHEMA = join(HERE, '..', '..', 'templates', 'schema.ts')

/**
 * 21.2 — the ONE written-down form of the tsx-absent remedy. The consumer's install is
 * keyed by its COMMITTED lockfile, so the hint must carry BOTH recipes; a bare `npm ci`
 * sends every pnpm consumer into the doomed install the arc's lockfile ruling retired.
 * Pinned VERBATIM on purpose: a substring match would let the pnpm half rot back out
 * silently, which is exactly how the bare-npm-ci wording survived that ruling.
 */
const EXPECTED_TSX_ABSENT_HINT =
  'fresh worktrees have no node_modules — install in the consumer checkout with the recipe its ' +
  'committed lockfile selects: pnpm-lock.yaml → pnpm install --frozen-lockfile, ' +
  'package-lock.json → npm ci (worktree node_modules are NOT shared)'

const bases = []
process.on('exit', () => bases.forEach((b) => rmSync(b, { recursive: true, force: true })))

/** A tmp consumer whose lib/roadmap/schema.ts re-exports the REAL plugin schema. */
function makeConsumer() {
  const root = mkdtempSync(join(tmpdir(), 'zr-bridge-'))
  bases.push(root)
  mkdirSync(join(root, 'lib', 'roadmap'), { recursive: true })
  writeFileSync(join(root, 'lib', 'roadmap', 'schema.ts'), `export * from '${SCHEMA}'\n`)
  return root
}

const validPhase = `import { definePhase } from '${SCHEMA}'
export default definePhase({
  phase: 9101, name: 'a fixture bridge phase', status: 'backlog',
  category: 'infra', kind: 'logic', source: 'fixture source', priority: 'LOW',
  dependsOn: [], conflictsWith: [], keyFiles: ['x'], stakeholderDemo: 'a demoable fixture outcome',
  tasks: [],
})
`
// name too short (min 5) — a clean Zod rejection at import time
const zodBadPhase = `import { definePhase } from '${SCHEMA}'
export default definePhase({
  phase: 9102, name: 'x', status: 'backlog',
  category: 'infra', kind: 'logic', source: 'fixture source', priority: 'LOW',
  dependsOn: [], conflictsWith: [], keyFiles: ['x'], stakeholderDemo: 'a demoable fixture outcome',
  tasks: [],
})
`

test('consumerSchemaPath — resolves lib/roadmap/schema.ts; throws schema-missing otherwise', () => {
  const root = makeConsumer()
  assert.equal(consumerSchemaPath(root), join(root, 'lib', 'roadmap', 'schema.ts'))
  const bare = mkdtempSync(join(tmpdir(), 'zr-bridge-bare-'))
  bases.push(bare)
  assert.throws(() => consumerSchemaPath(bare), (e) => e instanceof BridgeError && e.kind === 'schema-missing')
})

test('bridgeImport — imports a valid roadmap file and returns its parsed default', () => {
  const root = makeConsumer()
  const f = join(root, 'phase-9101.phase.ts')
  writeFileSync(f, validPhase)
  const res = bridgeImport(f)
  assert.equal(res.ok, true)
  assert.equal(res.parsed.phase, 9101)
  assert.equal(res.parsed.status, 'backlog')
})

test('bridgeImport — a zod-invalid file classifies as kind:zod with issues (exit 3)', () => {
  const root = makeConsumer()
  const f = join(root, 'phase-9102.phase.ts')
  writeFileSync(f, zodBadPhase)
  const res = bridgeImport(f)
  assert.equal(res.ok, false)
  assert.equal(res.kind, 'zod')
  assert.ok(Array.isArray(res.issues) && res.issues.length > 0)
})

test('bridgeEval — runs an inline script and returns its stdout', () => {
  const root = makeConsumer()
  const res = bridgeEval(root, "process.stdout.write('BRIDGE_OK')")
  assert.equal(res.ok, true)
  assert.match(res.stdout, /BRIDGE_OK/)
})

test('TSX_ABSENT_HINT — the verbatim worktree-hazard line (string-pinned)', () => {
  assert.equal(TSX_ABSENT_HINT, EXPECTED_TSX_ABSENT_HINT)
})

test('TSX_ABSENT_HINT — names BOTH committed-lockfile recipes, each keyed to its own lockfile', () => {
  // pnpm consumers are the ones the old wording stranded: their recipe must be present AND
  // attached to the lockfile that selects it, not merely mentioned somewhere in the line.
  const pnpmLock = TSX_ABSENT_HINT.indexOf('pnpm-lock.yaml')
  const pnpmRecipe = TSX_ABSENT_HINT.indexOf('pnpm install --frozen-lockfile')
  assert.ok(pnpmLock >= 0, 'the hint must name pnpm-lock.yaml as a decider')
  assert.ok(pnpmRecipe >= 0, 'the hint must name pnpm install --frozen-lockfile')
  assert.ok(pnpmLock < pnpmRecipe, 'the pnpm recipe must READ as selected by pnpm-lock.yaml')

  const npmLock = TSX_ABSENT_HINT.indexOf('package-lock.json')
  const npmRecipe = TSX_ABSENT_HINT.indexOf('npm ci')
  assert.ok(npmLock >= 0, 'the hint must name package-lock.json as a decider')
  assert.ok(npmRecipe >= 0, 'the hint must still name npm ci for a package-lock.json consumer')
  assert.ok(npmLock < npmRecipe, 'npm ci must READ as selected by package-lock.json')
})

test('TSX_ABSENT_HINT — no bare generic npm-ci remedy survives', () => {
  assert.doesNotMatch(
    TSX_ABSENT_HINT,
    /run npm ci in the consumer checkout/,
    'the retired unconditional remedy must be gone, not merely supplemented',
  )
  assert.equal(
    TSX_ABSENT_HINT.split('npm ci').length - 1,
    1,
    'npm ci may appear exactly once — as the package-lock.json branch, never as a second bare remedy',
  )
  // The worktree hazard is why the line exists at all; the reword must not drop it.
  assert.match(TSX_ABSENT_HINT, /fresh worktrees have no node_modules/)
  assert.match(TSX_ABSENT_HINT, /worktree node_modules are NOT shared/)
})

// ── 1719.3 — resolved binary + content-keyed cache ────────────────────────────────────
const bareRoot = () => {
  const r = mkdtempSync(join(tmpdir(), 'zr-bridge-bare2-'))
  bases.push(r)
  return r
}
/** An injected exec that counts calls and returns a canned PARSED payload. */
const countingExec = (payload) => {
  const state = { calls: 0 }
  const exec = () => {
    state.calls++
    return 'PARSED:' + JSON.stringify(payload)
  }
  return { exec, state }
}

test('resolveTsxInvocation — consumer tsx wins; else the plugin tsx; else npx; memoized', () => {
  const withLocal = bareRoot()
  mkdirSync(join(withLocal, 'node_modules', '.bin'), { recursive: true })
  writeFileSync(join(withLocal, 'node_modules', '.bin', 'tsx'), '#!/bin/sh\n')
  const inv = resolveTsxInvocation(withLocal)
  assert.equal(inv.file, join(withLocal, 'node_modules', '.bin', 'tsx'))
  assert.deepEqual(inv.prefix, [])
  assert.equal(resolveTsxInvocation(withLocal), inv, 'memoized — same object per resolved root')

  // Without a consumer tsx, the second rung is the plugin's own devDependency tsx when
  // this checkout has one installed; only a checkout with NO node_modules at all reaches
  // the verbatim npx fallback. Environment-aware so the assertion is true in both.
  const without = bareRoot()
  const inv2 = resolveTsxInvocation(without)
  if (existsSync(PLUGIN_TSX)) {
    assert.equal(inv2.file, PLUGIN_TSX)
    assert.deepEqual(inv2.prefix, [])
  } else {
    assert.equal(inv2.file, 'npx')
    assert.deepEqual(inv2.prefix, ['--no-install', 'tsx'])
  }

  // The npx rung, pinned DETERMINISTICALLY via the injectable plugin-tsx path — this is
  // the rung end-user installs without node_modules actually reach, so its exact
  // composition must stay covered regardless of what this checkout has installed.
  const inv3 = resolveTsxInvocation(bareRoot(), { pluginTsx: '/nonexistent/plugin-tsx' })
  assert.equal(inv3.file, 'npx')
  assert.deepEqual(inv3.prefix, ['--no-install', 'tsx'])
})

test('bridgeEval — composes the npx invocation and passes the prefix + -e + args through the injected exec', () => {
  // The plugin-tsx rung is disabled by injection so the npx composition — the one rung a
  // dropped-prefix mutation would break for end users — is pinned, not derived from the
  // function under test's own collaborator.
  const root = bareRoot()
  const calls = []
  const fakeExec = (file, args) => {
    calls.push({ file, args })
    return 'OUT'
  }
  const res = bridgeEval(root, 'SCRIPT_BODY', { args: ['ARG1'], exec: fakeExec, pluginTsx: '/nonexistent/plugin-tsx' })
  assert.equal(res.ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].file, 'npx')
  assert.deepEqual(calls[0].args, ['--no-install', 'tsx', '-e', 'SCRIPT_BODY', 'ARG1'])
})

test('bridgeEval — exit 4 with unresolvable modules on an UNINSTALLED consumer fails OPEN as tsx-absent', () => {
  const root = bareRoot() // no node_modules here
  const err = Object.assign(new Error('spawn failed'), {
    status: 4,
    stderr: "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'zod' imported from /x/phase.ts",
  })
  const res = bridgeEval(root, 'S', { exec: () => { throw err }, pluginTsx: '/nonexistent/plugin-tsx' })
  assert.equal(res.ok, false)
  assert.equal(res.kind, 'tsx-absent', 'an uninstalled tree cannot validate — toolchain-missing, never a file verdict')
  assert.ok(
    res.stderr.includes(EXPECTED_TSX_ABSENT_HINT),
    'the EMITTED remedy is the lockfile-keyed line verbatim — the pin travels with what users read',
  )
})

test('bridgeEval — exit 4 with unresolvable modules on an INSTALLED consumer is a genuine load error', () => {
  const root = bareRoot()
  mkdirSync(join(root, 'node_modules'), { recursive: true })
  const err = Object.assign(new Error('spawn failed'), {
    status: 4,
    stderr: "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'left-pad' imported from /x/phase.ts",
  })
  const res = bridgeEval(root, 'S', { exec: () => { throw err } })
  assert.equal(res.kind, 'load')
  assert.equal(res.exitCode, 4)
})

test('bridgeEval — a structured exit 4 whose text contains "not found" is a load error, not tsx-absent', () => {
  const root = bareRoot()
  mkdirSync(join(root, 'node_modules'), { recursive: true })
  const err = Object.assign(new Error('spawn failed'), {
    status: 4,
    stderr: 'Error: config profile not found in the registry\n    at file:///x/phase.ts:3',
  })
  const res = bridgeEval(root, 'S', { exec: () => { throw err } })
  assert.equal(res.kind, 'load', "the wrapper's structured exit outranks the not-found text heuristic")
})

test('bridgeImport — cache HIT: two calls on an unchanged file make ONE exec (+ a disk mirror written)', () => {
  const root = makeConsumer()
  mkdirSync(join(root, 'roadmap'), { recursive: true }) // enables the disk mirror
  const f = join(root, 'roadmap', 'p.ts')
  writeFileSync(f, 'CONTENT_V1')
  const { exec, state } = countingExec({ phase: 42 })
  const r1 = bridgeImport(f, { consumerRoot: root, exec })
  const r2 = bridgeImport(f, { consumerRoot: root, exec })
  assert.equal(r1.parsed.phase, 42)
  assert.equal(r2.parsed.phase, 42)
  assert.equal(state.calls, 1, 'second call served from cache')
  const cacheDir = join(root, 'roadmap', '.gate', '.typed-cache')
  assert.ok(existsSync(cacheDir) && readdirSync(cacheDir).length === 1, 'a content-keyed disk mirror was written')
})

test('bridgeImport — cache MISS on content change: two execs (staleness structurally impossible)', () => {
  const root = makeConsumer()
  const f = join(root, 'p.ts')
  writeFileSync(f, 'V1')
  const { exec, state } = countingExec({ phase: 1 })
  bridgeImport(f, { consumerRoot: root, exec })
  writeFileSync(f, 'V2-different-bytes') // new content ⇒ new hash ⇒ miss
  bridgeImport(f, { consumerRoot: root, exec })
  assert.equal(state.calls, 2, 'changed content bypasses the cache')
})

test('bridgeImport — cache:false always execs (the phase-validate bypass)', () => {
  const root = makeConsumer()
  const f = join(root, 'p.ts')
  writeFileSync(f, 'V1')
  const { exec, state } = countingExec({ phase: 7 })
  bridgeImport(f, { consumerRoot: root, cache: false, exec })
  bridgeImport(f, { consumerRoot: root, cache: false, exec })
  assert.equal(state.calls, 2, 'cache:false never serves a cached parse')
})

test('bridgeImport — a FAILED parse is never cached (two calls ⇒ two execs)', () => {
  const root = makeConsumer()
  const f = join(root, 'bad.ts')
  writeFileSync(f, 'BROKEN')
  let calls = 0
  const failExec = () => {
    calls++
    const e = new Error('load boom')
    e.status = 4
    e.stderr = Buffer.from('load failed')
    throw e
  }
  const a = bridgeImport(f, { consumerRoot: root, exec: failExec })
  const b = bridgeImport(f, { consumerRoot: root, exec: failExec })
  assert.equal(a.ok, false)
  assert.equal(b.ok, false)
  assert.equal(calls, 2, 'failures re-parse every time — only ok results are cached')
})

// ── 1719.4 — bridgeImportMany batch import ────────────────────────────────────────────
test('bridgeImportMany — batch output matches per-file bridgeImport for real fixture files', () => {
  const root = makeConsumer()
  const f1 = join(root, 'phase-9101.phase.ts')
  const f2 = join(root, 'phase-9101b.phase.ts')
  writeFileSync(f1, validPhase)
  writeFileSync(f2, validPhase.replace('9101', '9111').replace('a fixture bridge phase', 'a second fixture phase'))
  const many = bridgeImportMany([f1, f2], { consumerRoot: root, cache: false })
  assert.equal(many.ok, true)
  const one1 = bridgeImport(f1, { consumerRoot: root, cache: false })
  const one2 = bridgeImport(f2, { consumerRoot: root, cache: false })
  assert.deepEqual(many.byPath[f1].parsed, one1.parsed)
  assert.deepEqual(many.byPath[f2].parsed, one2.parsed)
})

test('bridgeImportMany — per-file failure isolation: one broken file does not fail its siblings', () => {
  const root = makeConsumer()
  const good1 = join(root, 'g1.phase.ts')
  const bad = join(root, 'bad.phase.ts')
  const good2 = join(root, 'g2.phase.ts')
  writeFileSync(good1, validPhase)
  writeFileSync(bad, zodBadPhase)
  writeFileSync(good2, validPhase.replace('9101', '9121'))
  const many = bridgeImportMany([good1, bad, good2], { consumerRoot: root, cache: false })
  assert.equal(many.ok, true)
  assert.equal(many.byPath[good1].ok, true)
  assert.equal(many.byPath[good2].ok, true)
  assert.equal(many.byPath[bad].ok, false)
  assert.equal(many.byPath[bad].kind, 'zod')
  assert.ok(Array.isArray(many.byPath[bad].issues) && many.byPath[bad].issues.length > 0)
})

test('bridgeImportMany — N=5 misses make exactly ONE spawn (counted via the injected exec)', () => {
  const root = bareRoot()
  const paths = [1, 2, 3, 4, 5].map((n) => join(root, `p${n}.ts`))
  paths.forEach((p) => writeFileSync(p, `CONTENT_${p}`))
  let calls = 0
  const fakeExec = (file, args) => {
    calls++
    const evalIdx = args.indexOf('-e')
    const passed = args.slice(evalIdx + 2) // [...prefix,'-e',script,...paths]
    const out = {}
    for (const p of passed) out[p] = { ok: true, parsed: { phase: 1 } }
    return 'PARSEDMANY:' + JSON.stringify(out)
  }
  const many = bridgeImportMany(paths, { consumerRoot: root, cache: false, exec: fakeExec })
  assert.equal(many.ok, true)
  assert.equal(calls, 1, 'all five misses import in a single tsx process')
  assert.equal(Object.keys(many.byPath).length, 5)
})

test('bridgeEval — a document rides STDIN, never argv (the 128KB MAX_ARG_STRLEN cap)', () => {
  const root = bareRoot()
  const seen = []
  const fakeExec = (file, args, opts) => {
    seen.push({ args, stdin: opts.stdio[0], input: opts.input })
    return 'OUT'
  }
  const doc = 'x'.repeat(200 * 1024) // over the single-argument cap, under nothing else
  const res = bridgeEval(root, 'S', { args: ['schema', 'Shape', '-'], input: doc, exec: fakeExec })

  assert.equal(res.ok, true)
  // The doc must NOT appear in argv — that is the whole defect. A 200KB argv entry fails the
  // spawn with E2BIG, and E2BIG carries no stderr, so it used to read as a schema mismatch.
  assert.ok(
    !seen[0].args.some((a) => Buffer.byteLength(a, 'utf8') > 4096),
    'no argv entry may carry the document — it goes on stdin',
  )
  assert.equal(seen[0].args.at(-1), '-', "the sentinel tells the script to read fd 0")
  assert.equal(seen[0].input, doc, 'the document is handed to the child on stdin')
  assert.equal(seen[0].stdin, 'pipe', 'stdin must be piped when input is supplied')
})

test('bridgeEval — a caller with no input keeps stdin ignored (unchanged for every other caller)', () => {
  const root = bareRoot()
  let opts
  const fakeExec = (_f, _a, o) => ((opts = o), 'OUT')
  bridgeEval(root, 'S', { args: ['ARG1'], exec: fakeExec })
  assert.equal(opts.stdio[0], 'ignore')
  assert.equal('input' in opts, false, 'no input key when the caller passed none')
})

test('bridgeEval — a spawn that never reached the script reports its errno, not an empty reason', () => {
  const root = bareRoot()
  const fakeExec = () => {
    const e = new Error('spawnSync /bin/x E2BIG')
    e.code = 'E2BIG' // no .stderr at all — the shape E2BIG actually arrives in
    throw e
  }
  const res = bridgeEval(root, 'S', { args: [], exec: fakeExec })
  assert.equal(res.ok, false)
  assert.match(res.stderr, /E2BIG/, 'the refusal must name its own cause rather than print nothing')
})

test('bridgeEval — an oversize argv entry is REFUSED, not spawned (the cliff is closed by construction)', () => {
  const root = bareRoot()
  let spawned = false
  const fakeExec = () => ((spawned = true), 'OUT')
  const res = bridgeEval(root, 'S', { args: ['schema', 'x'.repeat(200 * 1024)], exec: fakeExec })

  assert.equal(res.ok, false)
  assert.equal(spawned, false, 'it must refuse BEFORE the spawn, not discover E2BIG afterwards')
  assert.match(res.stderr, /MAX_ARG_STRLEN/)
  assert.match(res.stderr, /argv entry 1 is \d+ bytes/)
})

test('bridgeEval — the argv guard counts BYTES, so a multi-byte payload cannot slip under it', () => {
  const root = bareRoot()
  let spawned = false
  const fakeExec = () => ((spawned = true), 'OUT')
  // 70k Arabic characters: well under 96k by .length, ~140KB by utf8 bytes — over the kernel cap.
  const arabic = 'ب'.repeat(70 * 1024)
  assert.ok(arabic.length < 96 * 1024, 'the fixture must be under the cap by CHARACTERS')
  assert.ok(Buffer.byteLength(arabic, 'utf8') > 128 * 1024, 'and over the kernel cap by BYTES')

  const res = bridgeEval(root, 'S', { args: [arabic], exec: fakeExec })
  assert.equal(res.ok, false, 'a length-based guard would have waved this through')
  assert.equal(spawned, false)
})

test('bridgeEval — EPIPE with a ZERO status is a SUCCESS whose child stopped reading stdin', () => {
  const root = bareRoot()
  const fakeExec = () => {
    const e = new Error('spawnSync EPIPE')
    e.code = 'EPIPE'
    e.status = 0 // the child exited fine; it just never drained fd 0
    e.stdout = 'PARSED:{"ok":true}'
    throw e
  }
  const res = bridgeEval(root, 'S', { args: ['-'], input: 'x'.repeat(200 * 1024), exec: fakeExec })
  assert.equal(res.ok, true, 'a child that exited 0 did not fail because it ignored stdin')
  assert.equal(res.stdout, 'PARSED:{"ok":true}', 'and its stdout must not be thrown away')
})

test('bridgeEval — EPIPE with a NON-zero status still classifies on the exit code', () => {
  const root = bareRoot()
  const fakeExec = () => {
    const e = new Error('spawnSync EPIPE')
    e.code = 'EPIPE'
    e.status = 4
    e.stderr = 'SHAPE_NOT_EXPORTED'
    throw e
  }
  const res = bridgeEval(root, 'S', { args: ['-'], input: 'big', exec: fakeExec })
  assert.equal(res.ok, false)
  assert.equal(res.kind, 'load', 'a real load failure must not be rescued by the EPIPE early-return')
})

test('bridgeEval — the errno synthesis does not misroute the classification chain', () => {
  const root = bareRoot()
  const throwing = (props) => () => {
    const e = new Error(props.message ?? 'boom')
    Object.assign(e, props)
    throw e
  }
  // ENOENT still reads as a missing toolchain, and now carries a reason where it had none.
  const missing = bridgeEval(root, 'S', { exec: throwing({ code: 'ENOENT', message: 'spawnSync npx ENOENT' }) })
  assert.equal(missing.kind, 'tsx-absent')

  // A plain script exit carries NO .code, so the synthesis must stay out of the way entirely.
  const plain = bridgeEval(root, 'S', { exec: throwing({ status: 3 }) })
  assert.equal(plain.kind, 'eval-error')
  assert.equal(plain.stderr, '', 'an ordinary non-zero exit must not gain a fabricated spawn reason')

  // ENOBUFS names the truncation rather than just the errno.
  const over = bridgeEval(root, 'S', { exec: throwing({ code: 'ENOBUFS' }) })
  assert.match(over.stderr, /exceeded maxBuffer/)
})

test('bridgeEval — REAL SPAWN: a >128KB document round-trips through stdin byte-exact', () => {
  const root = bareRoot()
  // The one test that exercises the CHILD side: the '-' sentinel, readFileSync(0) and the utf8
  // leg. A fake exec proves none of it — a typo in an inline script's sentinel would stay green.
  const script =
    "import('node:fs').then((fs) => {" +
    "  const raw = process.argv[1] === '-' ? fs.readFileSync(0, 'utf8') : process.argv[1];" +
    "  process.stdout.write('LEN:' + Buffer.byteLength(raw, 'utf8') + ':' + raw.slice(-6))" +
    '})'
  const doc = 'é'.repeat(100 * 1024) + 'ENDING' // ~200KB utf8, far past the argv cap
  const res = bridgeEval(root, script, { args: ['-'], input: doc })

  assert.equal(res.ok, true, res.stderr ?? 'the round trip must succeed')
  assert.equal(res.stdout, `LEN:${Buffer.byteLength(doc, 'utf8')}:ENDING`)
})
