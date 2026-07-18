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

/** The VERBATIM worktree-hazard line a strict context prints on tsx-absent. */
export const TSX_ABSENT_HINT =
  'fresh worktrees have no node_modules — run npm ci in the consumer checkout (worktree node_modules are NOT shared)'

/** A typed bridge failure. kind ∈ 'tsx-absent' | 'schema-missing' | 'zod' | 'load' | 'eval-error'. */
export class BridgeError extends Error {
  constructor(kind, messageLines, extra = {}) {
    super(messageLines.join('\n'))
    this.name = 'BridgeError'
    this.kind = kind
    this.messageLines = messageLines
    Object.assign(this, extra)
  }
}

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
 * share of the ~7s/read). A consumer-local node_modules/.bin/tsx is invoked directly
 * (no npx); absent, the `npx --no-install tsx` fallback is kept VERBATIM. Memoized in a
 * module Map keyed by the resolved root. Returns { file, prefix }.
 */
const tsxInvocationCache = new Map()
export function resolveTsxInvocation(consumerRoot) {
  const key = resolve(consumerRoot)
  const memo = tsxInvocationCache.get(key)
  if (memo) return memo
  const local = join(key, 'node_modules', '.bin', 'tsx')
  const inv = existsSync(local)
    ? { file: local, prefix: [] }
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
 */
export function bridgeEval(consumerRoot, script, { args = [], timeout = 60_000, exec = execFileSync } = {}) {
  const { file, prefix } = resolveTsxInvocation(consumerRoot)
  try {
    const stdout = exec(file, [...prefix, '-e', script, ...args], {
      cwd: consumerRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
      encoding: 'utf8',
    })
    return { ok: true, stdout }
  } catch (err) {
    const stderr = err?.stderr?.toString?.() ?? ''
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
    const notFound =
      err?.code === 'ENOENT' || /not found|could not determine executable|npx: command/i.test(stderr)
    if (notFound) return { ok: false, kind: 'tsx-absent', stderr }
    if (err?.status === 4) return { ok: false, kind: 'load', stderr, exitCode: 4 }
    return { ok: false, kind: 'eval-error', stderr, exitCode: err?.status ?? 1 }
  }
}

// ── Content-keyed parse cache ─────────────────────────────────────────────────────────
// key = absolute path + sha256(file bytes) — NEVER mtime, so a content change is a new key
// and a hash mismatch is a plain miss (staleness is structurally impossible). In-process
// Map + a best-effort disk mirror under <consumerRoot>/roadmap/.gate/.typed-cache/<hash>.json
// (already gitignored via roadmap/.gate/.gitignore). Every disk op is try/catch: a cache
// failure is a MISS, never an error. Only ok results are cached.
const typedCache = new Map()
const typedCacheDir = (consumerRoot) => join(consumerRoot, 'roadmap', '.gate', '.typed-cache')

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
    if (!existsSync(join(consumerRoot, 'roadmap'))) return // only mirror inside a real consumer
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
      hash = createHash('sha256').update(readFileSync(targetPath)).digest('hex')
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
      if (e && Array.isArray(e.issues)) out[p] = { ok: false, kind: 'zod', issues: e.issues }
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
        hash = createHash('sha256').update(readFileSync(p)).digest('hex')
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

/**
 * <consumerRoot>/lib/roadmap/schema.ts — the ONE consumer schema seam-3 validates
 * through. Existence-checked: a non-consumer tree throws BridgeError('schema-missing')
 * for the caller to map to exit 1.
 */
export function consumerSchemaPath(consumerRoot) {
  const p = join(consumerRoot, 'lib', 'roadmap', 'schema.ts')
  if (!existsSync(p)) {
    throw new BridgeError('schema-missing', [
      `roadmap: no consumer schema at ${p} — this repo is not a roadmap consumer (expected lib/roadmap/schema.ts)`,
    ])
  }
  return p
}
