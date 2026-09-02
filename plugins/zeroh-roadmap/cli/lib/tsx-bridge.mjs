/**
 * tsx-bridge — typed-tier reading of roadmap/consumer files via the CONSUMER's tsx
 * (ROADCODE-DESIGN §2 tier (b)). Ports the bin/validate-roadmap-file.mjs IMPORT_CHECK
 * mechanic (:38-49) — including the CJS↔ESM double-wrap unwrap and the structured
 * exit-3 ZODISSUES / exit-4 load-error classification — into reusable helpers that
 * gate plan (1656.4), result check / contract show (1656.3), and phase validate
 * (1656.7) all share. The plugin carries NO second copy of any consumer contract:
 * seam 3 validates through <toplevel>/lib/roadmap/schema.ts, never a plugin mirror.
 *
 * Strict vs advisory (design §2): a caller in a STRICT context (gate, result check,
 * verify-complete) treats a tsx-absent result as a LOUD exit-1 error naming the
 * worktree hazard; an advisory context (status) labels the degradation. This module
 * returns the classification as DATA; the caller owns the exit code.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BridgeError } from './bridge-error.mjs'
import { roadmapRoot } from './roadmap-root.mjs'

/** The VERBATIM worktree-hazard line a strict context prints on tsx-absent. */
export const TSX_ABSENT_HINT =
  'fresh worktrees have no node_modules — install in the consumer checkout with the recipe its ' +
  'committed lockfile selects: pnpm-lock.yaml → pnpm install --frozen-lockfile, ' +
  'package-lock.json → npm ci (worktree node_modules are NOT shared)'

// BridgeError is DECLARED in ./bridge-error.mjs and re-exported here unchanged: roadmap-root.mjs
// throws it while this module consumes roadmap-root.mjs, so one home for the class keeps the two
// from importing each other. Every existing importer of BridgeError keeps this module as its door.
export { BridgeError } from './bridge-error.mjs'
export { consumerSchemaPath } from './roadmap-root.mjs'

// The import-parse one-liner (validate-roadmap-file.mjs:38-49, verbatim behavior):
// import the target by absolute file:// URL, unwrap ONE CJS↔ESM default layer, print
// PARSED:<json> on success, ZODISSUES (exit 3) / raw load error (exit 4) on failure.
const IMPORT_CHECK = `
import('file://' + process.argv[1])
  .then((m) => {
    let d = m && m.default
    if (d && typeof d === 'object' && d.default != null) d = d.default
    process.stdout.write('PARSED:' + JSON.stringify(d ?? null))
  })
  .catch((e) => {
    if (e && Array.isArray(e.issues)) { process.stderr.write('ZODISSUES:' + JSON.stringify(e.issues)); process.exit(3) }
    process.stderr.write(String((e && e.stack) || e)); process.exit(4)
  })
`

/**
 * Resolve the tsx invocation ONCE per consumer root (the npx-resolution tax is a large
 * share of the ~7s/read). Three rungs:
 *   1. consumer-local node_modules/.bin/tsx — the consumer's own toolchain wins;
 *   2. the PLUGIN's own tsx (a declared devDependency) — the binary only runs the
 *      script; the TARGET import still resolves zod from the imported file upward, so
 *      the consumer's schema semantics are untouched. This rung is what lets the
 *      fixture suites (tmp trees with no node_modules) and thin consumers validate at
 *      all instead of failing open;
 *   3. the `npx --no-install tsx` fallback, kept VERBATIM.
 * Memoized in a module Map keyed by resolved root + the (injectable) plugin-tsx path.
 * Returns { file, prefix }.
 */
export const PLUGIN_TSX = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'node_modules',
  '.bin',
  'tsx',
)
const tsxInvocationCache = new Map()
export function resolveTsxInvocation(consumerRoot, { pluginTsx = PLUGIN_TSX } = {}) {
  const key = resolve(consumerRoot) + '|' + pluginTsx
  const memo = tsxInvocationCache.get(key)
  if (memo) return memo
  const local = join(resolve(consumerRoot), 'node_modules', '.bin', 'tsx')
  const inv = existsSync(local)
    ? { file: local, prefix: [] }
    : existsSync(pluginTsx)
      ? { file: pluginTsx, prefix: [] }
      : { file: 'npx', prefix: ['--no-install', 'tsx'] }
  tsxInvocationCache.set(key, inv)
  return inv
}

/**
 * Run an inline tsx script in the consumer repo via the resolved tsx invocation.
 * `args` become process.argv[1..] inside the script. `exec` (default execFileSync) is
 * injectable so the one-spawn assertions are testable without a real tsx. Returns a
 * discriminated result; NEVER throws on a non-zero exit (the script's exit code is DATA):
 *   { ok:true, stdout }
 *   { ok:false, kind:'zod', issues, stderr, exitCode:3 }
 *   { ok:false, kind:'load', stderr, exitCode:4 }
 *   { ok:false, kind:'tsx-absent', stderr }
 *   { ok:false, kind:'eval-error', stderr, exitCode }
 *
 * `input` carries a payload on STDIN instead of argv, and a caller with a DOCUMENT must use it —
 * the guard below REFUSES an oversize argv entry rather than trusting convention. Linux caps a
 * SINGLE argv entry at 128KB (MAX_ARG_STRLEN, 32 pages) regardless of the ~2MB total ARG_MAX, so a
 * JSON.stringify'd doc over that size fails the spawn with E2BIG — and E2BIG arrives with EMPTY
 * stderr, which is why this read as a schema mismatch for the first arc big enough to hit it
 * (UCAUDIT, 20 members, ~520KB of transparency reports). The pattern is `args: [..., '-']` +
 * `input: json`, the script reading fd 0 when it sees the '-' sentinel — the same idiom
 * `cli/commands/codex.mjs` already uses to keep argv clean ("Prompt on STDIN").
 *
 * `input` alone delivers the payload (node overrides stdio[0] when it is set); the explicit 'pipe'
 * is documentation, not the mechanism.
 */
// Well under MAX_ARG_STRLEN (128KB), leaving headroom for the -e script body and the environment.
// BYTES, not characters: the kernel counts bytes, and a 71,680-char Arabic string is 143,360 utf8
// bytes — a length-based guard waves through exactly the payloads this consumer's traces carry.
const MAX_ARGV_ENTRY_BYTES = 96 * 1024

export function bridgeEval(
  consumerRoot,
  script,
  { args = [], timeout = 60_000, exec = execFileSync, input = undefined, pluginTsx = PLUGIN_TSX } = {},
) {
  const oversize = args.findIndex(
    (a) => typeof a === 'string' && Buffer.byteLength(a, 'utf8') > MAX_ARGV_ENTRY_BYTES,
  )
  if (oversize >= 0) {
    const bytes = Buffer.byteLength(args[oversize], 'utf8')
    return {
      ok: false,
      kind: 'eval-error',
      exitCode: 1,
      stderr:
        `bridgeEval: argv entry ${oversize} is ${bytes} bytes — one argv entry caps at 128KB ` +
        `(MAX_ARG_STRLEN), and the spawn would fail E2BIG with no stderr. Pass it as \`input\` ` +
        `with a '-' sentinel in that slot.`,
    }
  }
  const { file, prefix } = resolveTsxInvocation(consumerRoot, { pluginTsx })
  try {
    const stdout = exec(file, [...prefix, '-e', script, ...args], {
      cwd: consumerRoot,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      ...(input === undefined ? {} : { input }),
      timeout,
      encoding: 'utf8',
      // The house ceiling (see exec.mjs): the 1MB default TRUNCATES and then throws ENOBUFS, which
      // reads as "the command failed". PARSE_SCRIPT echoes the whole parsed doc back, so a large
      // arc's round trip clears 1MB — UCAUDIT's 520KB in returns ~532KB out.
      maxBuffer: 16 * 1024 * 1024,
    })
    return { ok: true, stdout }
  } catch (err) {
    // EPIPE means the CHILD stopped reading stdin, not that the run failed — its exit status is the
    // truth. Without this, a script that short-circuits on success (an early exit before it reads
    // fd 0) returns ok:false with exitCode 0 and its stdout thrown away.
    if (err?.code === 'EPIPE' && err?.status === 0) return { ok: true, stdout: err.stdout?.toString?.() ?? '' }
    // A spawn that never reached the script (E2BIG, ENOBUFS, EPIPE) has NO stderr, so report the
    // errno rather than an empty string — an empty reason is what made this read as a zod failure.
    const stderr =
      (err?.stderr?.toString?.() ?? '') ||
      (err?.code === 'ENOBUFS'
        ? `spawn failed: ENOBUFS — the child's stdout exceeded maxBuffer and was truncated`
        : err?.code
          ? `spawn failed: ${err.code}${err.message ? ` — ${err.message}` : ''}`
          : '')
    // Classify OUR wrapper's structured exits FIRST — a real ZodError must never be
    // misread as a missing toolchain even if its message contains "not found".
    if (err?.status === 3 && stderr.startsWith('ZODISSUES:')) {
      let issues = []
      try {
        issues = JSON.parse(stderr.slice('ZODISSUES:'.length))
      } catch {
        /* leave issues empty */
      }
      return { ok: false, kind: 'zod', issues, stderr, exitCode: 3 }
    }
    if (err?.status === 4) {
      // The wrapper's structured exit outranks every text heuristic (a load error whose
      // message merely CONTAINS "not found" is not a missing toolchain). One carve-out
      // keeps the fail-open contract: on a consumer tree with NO installed dependencies,
      // the plugin-tsx rung reaches the import and fails on unresolvable modules — that
      // is the toolchain-missing class (the tree cannot validate), never a verdict on
      // the file. With node_modules present, the same failure is a genuine load error.
      const depsMissing =
        /ERR_MODULE_NOT_FOUND|Cannot find (module|package)/.test(stderr) &&
        !existsSync(join(resolve(consumerRoot), 'node_modules'))
      if (depsMissing) return { ok: false, kind: 'tsx-absent', stderr: `${stderr}\n${TSX_ABSENT_HINT}` }
      return { ok: false, kind: 'load', stderr, exitCode: 4 }
    }
    // "canceled due to missing packages" is modern npm's --no-install refusal wording —
    // without it a tsx-less environment misreads as a load-error (exit 2, blocking edits)
    // instead of failing OPEN as the toolchain-missing contract demands.
    // `env: 'node': No such file or directory` is the SHIM case: node_modules/.bin/tsx is a
    // script whose shebang is `#!/usr/bin/env node`, so with PATH scrubbed the exec SUCCEEDS
    // (/usr/bin/env exists) and `env` then exits 127 because it cannot resolve the interpreter.
    // That is the toolchain-missing class by every meaning that matters — the tree cannot
    // validate — but it reaches neither the ENOENT branch nor the "not found" wording, so it
    // used to fall through to eval-error and turn a fail-OPEN contract into a blocking exit 2.
    const notFound =
      err?.code === 'ENOENT' ||
      /not found|could not determine executable|npx: command|canceled due to missing packages/i.test(stderr) ||
      /env: .*: No such file or directory/i.test(stderr)
    if (notFound) return { ok: false, kind: 'tsx-absent', stderr }
    return { ok: false, kind: 'eval-error', stderr, exitCode: err?.status ?? 1 }
  }
}

// ── Named-shape validation ───────────────────────────────────────────────────────────

// Parse a document against a NAMED consumer shape. argv[1] = schema path, argv[2] = shape
// name, argv[3] = the input JSON or '-' to read it from STDIN.
//
// Use '-' for anything document-sized: one argv entry caps at 128KB (MAX_ARG_STRLEN), and a
// bigger doc fails the spawn with E2BIG and an EMPTY stderr — which reads as a schema
// mismatch it is not.
const SHAPE_PARSE_SCRIPT = `
const schemaPath = process.argv[1]
const shapeName = process.argv[2]
const inputArg = process.argv[3]
Promise.all([import('file://' + schemaPath), import('node:fs')]).then(([m, fs]) => {
  const shape = m[shapeName] || (m.default && m.default[shapeName])
  if (!shape) { process.stderr.write(shapeName + ' not exported from ' + schemaPath + ' — the consumer schema predates this shape; re-sync lib/roadmap/schema.ts'); process.exit(4) }
  const inputJson = inputArg === '-' ? fs.readFileSync(0, 'utf8') : inputArg
  let input
  try { input = JSON.parse(inputJson) } catch (e) { process.stderr.write('input is not valid JSON: ' + e.message); process.exit(4) }
  const r = shape.safeParse(input)
  if (r.success) { process.stdout.write('PARSED:' + JSON.stringify(r.data)) }
  else { process.stderr.write('ZODISSUES:' + JSON.stringify(r.error.issues)); process.exit(3) }
}).catch((e) => { process.stderr.write(String((e && e.stack) || e)); process.exit(4) })
`

/**
 * Validate `doc` against the CONSUMER's `shapeName` through the bridge. Returns
 * `{ ok: true, parsed }` or `{ ok: false, res }`, where `res` is the bridgeEval failure —
 * `kind: 'zod'` carries `.issues`, `'tsx-absent'` the toolchain gap, `'load'` a broken schema.
 *
 * ONE home for the idiom every consumer-contract writer needs (the eval recorders, the
 * scorecard projection, the gate's per-phase eval record). Seam 3 holds: the plugin still
 * carries no second copy of any consumer contract — this only moves the SPAWN, never the shape.
 */
export function bridgeParseShape(consumerRoot, schemaPath, shapeName, doc, opts = {}) {
  return bridgeParseShapeJson(consumerRoot, schemaPath, shapeName, JSON.stringify(doc), opts)
}

/**
 * The same validation over an ALREADY-SERIALIZED document — the stdin lane, for input that
 * arrived as text and must not round-trip through JSON.parse on the way in. Malformed JSON
 * then fails INSIDE the script with its own named exit-4 message, exactly as it did before
 * this helper existed, rather than throwing in the caller.
 */
export function bridgeParseShapeJson(consumerRoot, schemaPath, shapeName, inputJson, opts = {}) {
  const res = bridgeEval(consumerRoot, SHAPE_PARSE_SCRIPT, {
    ...opts,
    args: [schemaPath, shapeName, '-'],
    input: inputJson,
  })
  if (!res.ok) return { ok: false, res }
  return { ok: true, parsed: JSON.parse(res.stdout.slice(res.stdout.indexOf('PARSED:') + 'PARSED:'.length)) }
}

// ── Content-keyed parse cache ─────────────────────────────────────────────────────────
// key = absolute path + sha256(schema-signature + file bytes) — NEVER mtime. A change to
// either the file OR the schema it parses through (definePhase/defineArc apply defaults at
// import) is a new key ⇒ a plain miss, so a cross-process disk hit can never serve a parse
// from a superseded schema. In-process Map + a best-effort disk mirror under
// <consumerRoot>/roadmap/.gate/.typed-cache/<hash>.json (already gitignored via
// roadmap/.gate/.gitignore). Every disk op is try/catch: a cache failure is a MISS, never
// an error. Only ok results are cached.
const typedCache = new Map()
const typedCacheDir = (consumerRoot) => join(roadmapRoot(consumerRoot), '.gate', '.typed-cache')

// The plugin's own schema definition file — folded into every cache key so a re-vendored /
// edited schema invalidates prior parses (the parsed value is schema-dependent, not just
// file-dependent). Memoized; absent ⇒ a stable sentinel (the file itself is the only key).
let _schemaSig
function schemaSignature() {
  if (_schemaSig !== undefined) return _schemaSig
  try {
    const schemaFile = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates', 'schema.ts')
    _schemaSig = createHash('sha256').update(readFileSync(schemaFile)).digest('hex').slice(0, 16)
  } catch {
    _schemaSig = 'noschema'
  }
  return _schemaSig
}

/** Content hash = sha256(schema-signature + file bytes). Throws if the file is unreadable. */
function contentHash(path) {
  return createHash('sha256').update(schemaSignature()).update(readFileSync(path)).digest('hex')
}

function readTypedCacheDisk(consumerRoot, hash) {
  try {
    const p = join(typedCacheDir(consumerRoot), `${hash}.json`)
    if (!existsSync(p)) return undefined
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return undefined // any failure ⇒ a miss
  }
}

function writeTypedCacheDisk(consumerRoot, hash, parsed) {
  try {
    if (!existsSync(roadmapRoot(consumerRoot))) return // only mirror inside a real consumer
    const dir = typedCacheDir(consumerRoot)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${hash}.json`), JSON.stringify(parsed))
  } catch {
    /* best-effort — a cache write failure is silently a MISS on the next read */
  }
}

/**
 * Parse a roadmap file (phase/arc/backlog) through its own import-time .parse(). cwd
 * defaults to the target's directory (tsx is resolved globally; zod resolves relative
 * to the imported file). Content-keyed cached unless { cache:false } (phase validate,
 * the write-guard, must always genuinely parse). `exec` is forwarded to bridgeEval.
 * Returns { ok:true, parsed } | a bridgeEval failure result.
 */
export function bridgeImport(targetPath, { consumerRoot, timeout, cache = true, exec } = {}) {
  const root = consumerRoot ?? dirname(targetPath)
  let hash = null
  let memKey = null
  if (cache) {
    try {
      hash = contentHash(targetPath)
    } catch {
      hash = null // unreadable ⇒ no caching, fall through to a real parse (which will error loud)
    }
    if (hash) {
      memKey = resolve(targetPath) + ':' + hash
      if (typedCache.has(memKey)) return { ok: true, parsed: typedCache.get(memKey) }
      const disk = readTypedCacheDisk(root, hash)
      if (disk !== undefined) {
        typedCache.set(memKey, disk)
        return { ok: true, parsed: disk }
      }
    }
  }
  const res = bridgeEval(root, IMPORT_CHECK, { args: [targetPath], timeout, exec })
  if (!res.ok) return res
  const idx = res.stdout.indexOf('PARSED:')
  if (idx < 0) return { ok: false, kind: 'load', stderr: res.stdout, exitCode: 4 }
  let parsed
  try {
    parsed = JSON.parse(res.stdout.slice(idx + 'PARSED:'.length))
  } catch (e) {
    return { ok: false, kind: 'load', stderr: `unparseable PARSED payload: ${e.message}`, exitCode: 4 }
  }
  if (cache && hash) {
    typedCache.set(memKey, parsed)
    writeTypedCacheDisk(root, hash, parsed)
  }
  return { ok: true, parsed }
}

// The batch import-parse script — the IMPORT_CHECK mechanic over N paths with a PER-FILE
// try/catch (one bad file fails THAT entry, not the batch), emitting a path-keyed map.
const MANY_IMPORT_CHECK = `
const out = {}
const paths = process.argv.slice(1)
;(async () => {
  for (const p of paths) {
    try {
      const m = await import('file://' + p)
      let d = m && m.default
      if (d && typeof d === 'object' && d.default != null) d = d.default
      out[p] = { ok: true, parsed: d ?? null }
    } catch (e) {
      if (e && Array.isArray(e.issues)) out[p] = { ok: false, kind: 'zod', issues: e.issues, stderr: 'ZODISSUES:' + JSON.stringify(e.issues) }
      else out[p] = { ok: false, kind: 'load', stderr: String((e && e.stack) || e) }
    }
  }
  process.stdout.write('PARSEDMANY:' + JSON.stringify(out))
})()
`

/**
 * Import N roadmap files in ONE tsx process (the N-spawn tax killer). Content-cache hits
 * are served first; only the misses go through a single batched invocation. Per-file
 * failure is ISOLATED (one bad file yields { ok:false, kind:'zod'|'load' } for THAT path,
 * never failing its siblings) — mirroring bridgeImport's classification. A tsx-absent /
 * eval-error fails the WHOLE call (a toolchain matter, as today). Only ok results are
 * cached. `exec` is forwarded to bridgeEval.
 * Returns { ok:true, byPath: { [path]: { ok:true, parsed } | { ok:false, kind, issues?, stderr } } }
 *   | a bridgeEval whole-call failure result ({ ok:false, kind:'tsx-absent'|'eval-error'|'load', ... }).
 */
export function bridgeImportMany(paths, { consumerRoot, timeout, exec, cache = true } = {}) {
  const root = consumerRoot ?? (paths[0] ? dirname(paths[0]) : process.cwd())
  const byPath = {}
  const misses = []
  const hashByPath = {}
  for (const p of paths) {
    if (cache) {
      let hash = null
      try {
        hash = contentHash(p)
      } catch {
        hash = null
      }
      if (hash) {
        hashByPath[p] = hash
        const memKey = resolve(p) + ':' + hash
        if (typedCache.has(memKey)) {
          byPath[p] = { ok: true, parsed: typedCache.get(memKey) }
          continue
        }
        const disk = readTypedCacheDisk(root, hash)
        if (disk !== undefined) {
          typedCache.set(memKey, disk)
          byPath[p] = { ok: true, parsed: disk }
          continue
        }
      }
    }
    misses.push(p)
  }
  if (misses.length === 0) return { ok: true, byPath }

  const res = bridgeEval(root, MANY_IMPORT_CHECK, { args: misses, timeout, exec })
  if (!res.ok) return res // tsx-absent / eval-error fails the whole call (toolchain matter)
  const idx = res.stdout.indexOf('PARSEDMANY:')
  if (idx < 0) return { ok: false, kind: 'load', stderr: res.stdout, exitCode: 4 }
  let parsedMap
  try {
    parsedMap = JSON.parse(res.stdout.slice(idx + 'PARSEDMANY:'.length))
  } catch (e) {
    return { ok: false, kind: 'load', stderr: `unparseable PARSEDMANY payload: ${e.message}`, exitCode: 4 }
  }
  for (const p of misses) {
    const r = parsedMap[p] ?? { ok: false, kind: 'load', stderr: `no batch result for ${p}` }
    byPath[p] = r
    if (r.ok && cache && hashByPath[p]) {
      const memKey = resolve(p) + ':' + hashByPath[p]
      typedCache.set(memKey, r.parsed)
      writeTypedCacheDisk(root, hashByPath[p], r.parsed)
    }
  }
  return { ok: true, byPath }
}

// The ONE consumer schema seam-3 validates through, resolved by roadmap-root.mjs (root-first
// <root>/lib/schema.ts, then the legacy <consumerRoot>/lib/roadmap/schema.ts) and existence-
// checked there — a non-consumer tree throws BridgeError('schema-missing') for the caller to
// map to exit 1. Re-exported from HERE because gate, eval, result, eval-collect and landing all
// import it from this module; the resolver moved, the door did not.
