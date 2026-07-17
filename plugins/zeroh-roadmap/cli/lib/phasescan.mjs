/**
 * phasescan — the regex-tier phase reader (ROADCODE-DESIGN §2 tier (a): zero
 * toolchain). Ported verbatim from scripts/arc-status.mjs's status/declared-phase/
 * arcId patterns and its per-arc progress fold, plus the claim script's
 * max-declared scan. status/derive/watch (1657) and claim (1655.6) all consume this.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const STATUS_RE = /status:\s*'([a-z-]+)'/
const DECLARED_RE = /(?:^|[{,])\s*phase:\s*(\d+)\s*,/m
const ARCID_RE = /arcId:\s*'([^']+)'/
const FILENAME_RE = /phase-(\d+)/

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
  const status = src.match(STATUS_RE)?.[1]
  if (!status) return null
  const declared = src.match(DECLARED_RE)?.[1]
  const phase = declared ?? absPath.match(FILENAME_RE)?.[1]
  const arcId = src.match(ARCID_RE)?.[1]
  return { phase, status, arcId }
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
