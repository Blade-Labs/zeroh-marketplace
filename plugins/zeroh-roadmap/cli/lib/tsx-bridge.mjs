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
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

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
 * Run an inline tsx script in the consumer repo via `npx --no-install tsx -e`.
 * `args` become process.argv[1..] inside the script. Returns a discriminated result;
 * NEVER throws on a non-zero exit (the script's exit code is DATA):
 *   { ok:true, stdout }
 *   { ok:false, kind:'zod', issues, stderr, exitCode:3 }
 *   { ok:false, kind:'load', stderr, exitCode:4 }
 *   { ok:false, kind:'tsx-absent', stderr }
 *   { ok:false, kind:'eval-error', stderr, exitCode }
 */
export function bridgeEval(consumerRoot, script, { args = [], timeout = 60_000 } = {}) {
  try {
    const stdout = execFileSync('npx', ['--no-install', 'tsx', '-e', script, ...args], {
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

/**
 * Parse a roadmap file (phase/arc/backlog) through its own import-time .parse(). cwd
 * defaults to the target's directory (tsx is resolved globally; zod resolves relative
 * to the imported file). Returns { ok:true, parsed } | a bridgeEval failure result.
 */
export function bridgeImport(targetPath, { consumerRoot, timeout } = {}) {
  const res = bridgeEval(consumerRoot ?? dirname(targetPath), IMPORT_CHECK, { args: [targetPath], timeout })
  if (!res.ok) return res
  const idx = res.stdout.indexOf('PARSED:')
  if (idx < 0) return { ok: false, kind: 'load', stderr: res.stdout, exitCode: 4 }
  try {
    return { ok: true, parsed: JSON.parse(res.stdout.slice(idx + 'PARSED:'.length)) }
  } catch (e) {
    return { ok: false, kind: 'load', stderr: `unparseable PARSED payload: ${e.message}`, exitCode: 4 }
  }
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
