/**
 * phasescan — the regex-tier phase reader (ROADCODE-DESIGN §2 tier (a): zero
 * toolchain). Ported verbatim from scripts/arc-status.mjs's status/declared-phase/
 * arcId patterns and its per-arc progress fold, plus the claim script's
 * max-declared scan. status/derive/watch (1657) and claim (1655.6) all consume this.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { defaultExec } from './exec.mjs'

const STATUS_RE = /status:\s*'([a-z-]+)'/
const DECLARED_RE = /(?:^|[{,])\s*phase:\s*(\d+)\s*,/m
const ARCID_RE = /arcId:\s*'([^']+)'/
const FILENAME_RE = /phase-(\d+)/

/**
 * Match the status FIELD, not prose: scan from `definePhase(` when present, so a
 * `status:'suspended'` inside the doc-comment header never wins over the real field
 * (phase 1787 false refusal). Files without definePhase (fixtures, plain-object
 * exports) scan from the top — behavior-identical to the bare STATUS_RE.
 * Returns { status, index } with index absolute into src, or null.
 */
export function matchStatusField(src) {
  const anchor = src.indexOf('definePhase(')
  const scanFrom = anchor >= 0 ? anchor : 0
  const m = src.slice(scanFrom).match(STATUS_RE)
  return m ? { status: m[1], index: scanFrom + m.index } : null
}

/**
 * Match the arcId FIELD, not prose — the same anchor `matchStatusField` uses, and for the same
 * reason: a docstring that NAMES another arc ("supersedes arcId: 'OTHER'") sits above the real
 * field, and a whole-file first-match hands back the wrong owner. Membership decisions read this,
 * so a prose hit would misroute a phase to an arc that does not own it.
 */
export function matchArcIdField(src) {
  const anchor = src.indexOf('definePhase(')
  const scanFrom = anchor >= 0 ? anchor : 0
  return src.slice(scanFrom).match(ARCID_RE)?.[1]
}

/**
 * The string entries of the bracketed array beginning at the next `[` after `start`.
 *
 * A hand-rolled scanner rather than a quote-pairing regex, because a phase file's keyFiles array
 * is ordinary source: it carries `//` comments, and those comments carry APOSTROPHES. A regex
 * reads such an apostrophe as the start of a literal, every subsequent pairing shifts by one, and
 * real declared paths vanish SILENTLY — on this corpus that dropped all ten absolute paths of one
 * cross-repo phase, precisely the class this field exists to serve. Reading source correctly means
 * tracking quote and comment state, and it costs one linear pass with no backtracking.
 *
 * Escapes inside a literal are honored too, so a path containing an escaped apostrophe reads back
 * whole rather than truncating at the escape.
 */
function scanArrayEntries(src, start) {
  const open = src.indexOf('[', start)
  if (open < 0) return []
  const entries = []
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i)
      if (nl < 0) break
      i = nl
    } else if (c === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2)
      if (close < 0) break
      i = close + 1
    } else if (c === "'" || c === '"' || c === '`') {
      let value = ''
      let j = i + 1
      let closed = false
      for (; j < src.length; j++) {
        if (src[j] === '\\') {
          value += src[j + 1] ?? ''
          j++
        } else if (src[j] === c) {
          closed = true
          break
        } else value += src[j]
      }
      if (!closed) break
      entries.push(value)
      i = j
    } else if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) break
    }
  }
  return entries
}

/**
 * Match the keyFiles FIELD — the only place a phase declares the ABSOLUTE paths it
 * writes, so it is the only way the CLI can learn which repository a cross-repo phase
 * actually commits into. Same `definePhase(` anchor as the two matchers above, for the
 * same reason: a docstring quoting an older plan's keyFiles listing sits above the real
 * field. Always an array — callers iterate it, so absent is `[]`, never undefined.
 */
export function matchKeyFilesField(src) {
  const anchor = src.indexOf('definePhase(')
  const scanFrom = anchor >= 0 ? anchor : 0
  const at = src.indexOf('keyFiles:', scanFrom)
  if (at < 0) return []
  return scanArrayEntries(src, at + 'keyFiles:'.length)
}

/**
 * Read one phase file. The DECLARED `phase: N` value wins over the filename.
 * Returns null when the file has no `status:` (arc-status's `continue`).
 */
export function scanPhaseFile(absPath) {
  let src
  try {
    src = readFileSync(absPath, 'utf8')
  } catch {
    return null
  }
  const status = matchStatusField(src)?.status
  if (!status) return null
  const declared = src.match(DECLARED_RE)?.[1]
  const phase = declared ?? absPath.match(FILENAME_RE)?.[1]
  const arcId = matchArcIdField(src)
  const keyFiles = matchKeyFilesField(src)
  return { phase, status, arcId, keyFiles }
}

// Per-dir memo — the single source for "how far along is arc X", never hand-written.
const scanCache = new Map()

/**
 * Per-arc progress fold over a phases dir (arc-status.mjs:84-124, verbatim rules):
 * done+historical ⇒ done; in-progress ⇒ inprog + next.unshift (in-progress FIRST);
 * else ⇒ backlog + next.push. Returns { inProgress, progress } Maps; memoized per dir.
 */
export function scanProgress(phasesDir) {
  if (scanCache.has(phasesDir)) return scanCache.get(phasesDir)
  const inProgress = new Map() // arcId|'?' -> [phase numbers]
  const progress = new Map() // arcId -> { done, inprog, backlog, total, next[] }
  const out = { inProgress, progress }
  scanCache.set(phasesDir, out)
  if (!existsSync(phasesDir)) return out
  for (const f of readdirSync(phasesDir).filter((f) => f.endsWith('.phase.ts'))) {
    const r = scanPhaseFile(join(phasesDir, f))
    if (!r) continue // statusless / unreadable → skipped, never a crash
    const { status, phase: num, arcId: arc } = r
    if (arc) {
      const p = progress.get(arc) ?? { done: 0, inprog: 0, backlog: 0, total: 0, next: [] }
      p.total++
      if (status === 'done' || status === 'historical') p.done++
      else if (status === 'in-progress') {
        p.inprog++
        p.next.unshift(num)
      } else {
        p.backlog++
        p.next.push(num)
      }
      progress.set(arc, p)
    }
    if (status === 'in-progress') {
      const key = arc ?? '?'
      inProgress.set(key, [...(inProgress.get(key) ?? []), num])
    }
  }
  return out
}

function walkPhaseFiles(dir, acc) {
  if (!existsSync(dir)) return acc
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) walkPhaseFiles(full, acc)
    else if (e.name.endsWith('.phase.ts')) acc.push(full)
  }
  return acc
}

/**
 * Max DECLARED `phase: N` value across the given roots, scanned recursively for
 * *.phase.ts (claim-phase-number.sh's grep, in node). Declared value only — the
 * filename never inflates the max. Returns 0 when none found.
 */
export function maxDeclaredPhase(roots) {
  let max = 0
  for (const root of roots) {
    for (const file of walkPhaseFiles(root, [])) {
      let src
      try {
        src = readFileSync(file, 'utf8')
      } catch {
        continue
      }
      const declared = src.match(DECLARED_RE)?.[1]
      if (declared) {
        const n = Number(declared)
        if (n > max) max = n
      }
    }
  }
  return max
}

/**
 * The max phase number DECLARED on a remote ref's phase files (1792.5): a sibling session may
 * have PUSHED a phase this checkout has not fetched, and claiming over it is the recurring
 * collision (1735-37 renumbered to 1738-40). Best-effort by construction — an unknown ref, a
 * non-zero git status, or a thrown exec all yield 0 so an offline claim degrades to local-only
 * (loud at the call site) rather than failing.
 */
export function maxRemotePhase(repoRoot, upstreamRef, exec = defaultExec) {
  if (!upstreamRef) return 0
  let res
  try {
    res = exec('git', ['ls-tree', '-r', '--name-only', upstreamRef, 'roadmap/phases'], { cwd: repoRoot })
  } catch {
    return 0 // a spawn failure is not a claim failure
  }
  if (!res || res.status !== 0 || !res.stdout) return 0
  let max = 0
  for (const line of String(res.stdout).split('\n')) {
    const m = line.trim().match(/phase-(\d+)\.phase\.ts$/)
    if (m) {
      const n = Number(m[1])
      if (n > max) max = n
    }
  }
  return max
}
