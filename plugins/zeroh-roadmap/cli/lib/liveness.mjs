/**
 * liveness — the ONE executor-liveness verdict engine (arc ROADCODE 1657.6). PORTED
 * (moved, minimally adapted — NOT rewritten) from scripts/executor-liveness.mjs so the
 * 2026-07-03 symlink-trap, 2026-07-09 false-ALIVE-pgrep, and 2026-07-10 false-STALLED
 * scars stay fixed. `roadmap watch [--once]` (and the deprecation shim) drive this; the
 * beacon last-line parse routes through cli/lib/beacon.mjs (one parser). The engine only
 * READS + ships EVIDENCE; nudging/killing stays with the orchestrator.
 *
 * Verdict table (top row wins): final transcript record = assistant end_turn ≥3min →
 * EXITED · beacon age <20min → ALIVE · gate-stage-start & <45min → QUIET · background-run
 * & its log grew → ALIVE · transcript grew OR pgrep hits → QUIET · last commit <15min OR
 * newest file <10min → ALIVE · no beacon & sidecar within grace → QUIET · else STALLED.
 * A MISSING beacon prefixes the verdict `pre-beacon`.
 *
 * Injectable env seams (hermetic tests): LIVENESS_PGREP_CMD, LIVENESS_PROBE_MS (10000),
 * LIVENESS_EXITED_MIN_AGE_MIN (3), LIVENESS_PREBEACON_GRACE_MIN (15).
 */
import { readFileSync, statSync, realpathSync, readdirSync, existsSync, openSync, readSync, closeSync } from 'node:fs'
import { execSync, execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { readBeaconLine } from './beacon.mjs'

const ALIVE_MAX_MIN = 20
const GATE_QUIET_MAX_MIN = 45
const ACTIVITY_COMMIT_MAX_MIN = 15
const ACTIVITY_FILE_MAX_MIN = 10
const ACTIVITY_SKIP_DIRS = new Set(['.git', 'node_modules', '.building', 'transcripts', 'dist', 'build', '.next', '.turbo', 'coverage'])
const ACTIVITY_SCAN_CAP = 50_000

/**
 * Read one liveness verdict for a sidecar. Returns { verdict, arcId, worktree, preBeacon,
 * evidence } — the same object executor-liveness.mjs printed. Async: the growth-based rows
 * need a second probe (LIVENESS_PROBE_MS apart).
 */
export async function readLiveness({ sidecarPath, transcriptDir = null, env = process.env }) {
  const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8'))
  const worktree = sidecar.worktree
  const arcId = sidecar.arcId
  const registryDir = dirname(sidecarPath)
  const PROBE_MS = Number(env.LIVENESS_PROBE_MS ?? 10000)
  const EXITED_MIN_AGE_MIN = Number(env.LIVENESS_EXITED_MIN_AGE_MIN ?? 3)
  const PREBEACON_GRACE_MIN = Number(env.LIVENESS_PREBEACON_GRACE_MIN ?? 15)
  const now = Date.now()

  // Beacon DISCOVERY (not a hard-coded path): executors write both <registry>/<arcId>-
  // executor.jsonl AND <worktree>/.building/<phase>-executor.jsonl — scan both, newest by mtime.
  function discoverBeacon() {
    const dirs = [...new Set([registryDir, join(worktree, '.building')])]
    let best = null
    for (const d of dirs) {
      if (!existsSync(d)) continue
      let entries = []
      try {
        entries = readdirSync(d)
      } catch {
        continue
      }
      for (const name of entries) {
        if (!name.endsWith('-executor.jsonl')) continue
        const p = join(d, name)
        try {
          const st = statSync(p)
          if (!best || st.mtimeMs > best.mtimeMs) best = { path: p, mtimeMs: st.mtimeMs }
        } catch {
          /* unreadable — skip */
        }
      }
    }
    return best?.path ?? null
  }
  const beaconPath = discoverBeacon()

  function newestWorktreeFileAgeMin() {
    let newest = 0
    let visited = 0
    const walk = (d) => {
      if (visited > ACTIVITY_SCAN_CAP) return
      let entries
      try {
        entries = readdirSync(d, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        if (visited++ > ACTIVITY_SCAN_CAP) return
        if (e.isDirectory()) {
          if (!ACTIVITY_SKIP_DIRS.has(e.name)) walk(join(d, e.name))
        } else if (e.isFile()) {
          try {
            const m = statSync(join(d, e.name)).mtimeMs
            if (m > newest) newest = m
          } catch {
            /* raced — skip */
          }
        }
      }
    }
    if (!worktree || !existsSync(worktree)) return null
    walk(worktree)
    return newest > 0 ? (now - newest) / 60000 : null
  }

  const realSize = (p) => {
    try {
      return statSync(realpathSync(p)).size
    } catch {
      return null
    }
  }

  function transcriptSize(dir) {
    if (!dir || !existsSync(dir)) return null
    let total = 0
    let seen = false
    const walk = (d) => {
      let entries
      try {
        entries = readdirSync(d, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        const p = join(d, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name.endsWith('.output')) {
          const s = realSize(p)
          if (s != null) {
            total += s
            seen = true
          }
        }
      }
    }
    walk(dir)
    return seen ? total : null
  }

  function newestAgentTranscript(dir) {
    if (!dir || !existsSync(dir)) return null
    let best = null
    const walk = (d) => {
      let entries
      try {
        entries = readdirSync(d, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        const p = join(d, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name.endsWith('.output')) {
          try {
            const real = realpathSync(p)
            if (!/agent-.*\.jsonl$/.test(real)) continue
            const st = statSync(real)
            if (!best || st.mtimeMs > best.mtimeMs) best = { path: real, mtimeMs: st.mtimeMs }
          } catch {
            /* unreadable — skip */
          }
        }
      }
    }
    walk(dir)
    return best
  }

  function lastTranscriptRecord(path) {
    try {
      const size = statSync(path).size
      const span = Math.min(size, 64 * 1024)
      const buf = Buffer.alloc(span)
      const fd = openSync(path, 'r')
      try {
        readSync(fd, buf, 0, span, size - span)
      } finally {
        closeSync(fd)
      }
      const lines = buf.toString('utf8').trim().split('\n').filter(Boolean)
      return lines.length ? JSON.parse(lines[lines.length - 1]) : null
    } catch {
      return null
    }
  }

  function exitState(dir) {
    const t = newestAgentTranscript(dir)
    if (!t) return null
    const rec = lastTranscriptRecord(t.path)
    if (!rec || rec.type !== 'assistant' || rec.message?.stop_reason !== 'end_turn') return null
    const ts = Date.parse(rec.timestamp ?? '')
    const ageMin = (now - (Number.isNaN(ts) ? t.mtimeMs : ts)) / 60000
    if (ageMin < EXITED_MIN_AGE_MIN) return null
    const text = (rec.message.content ?? []).find((b) => b?.type === 'text')?.text ?? ''
    return { path: t.path, ageMin, excerpt: text.slice(0, 180) }
  }

  function ownAncestry() {
    const pids = new Set()
    let pid = process.pid
    while (pid > 1 && !pids.has(pid)) {
      pids.add(pid)
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
        pid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1])
      } catch {
        break
      }
    }
    return pids
  }

  function pgrepHits() {
    const override = env.LIVENESS_PGREP_CMD
    try {
      if (override) {
        const out = execSync(override, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
        return out ? out.split('\n').filter(Boolean).length : 0
      }
      const out = execFileSync('pgrep', ['-af', worktree], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      if (!out) return 0
      const ancestry = ownAncestry()
      return out
        .split('\n')
        .filter(Boolean)
        .filter((line) => {
          const sp = line.indexOf(' ')
          const pid = Number(line.slice(0, sp < 0 ? line.length : sp))
          const cmd = sp < 0 ? '' : line.slice(sp + 1)
          if (ancestry.has(pid)) return false
          if (/executor-(liveness|watch)\.mjs|roadmap\.mjs watch/.test(cmd)) return false
          return true
        }).length
    } catch {
      return 0
    }
  }

  function gitInfo() {
    try {
      const recent = execSync(`git -C ${JSON.stringify(worktree)} log --oneline -5`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        .trim()
        .split('\n')
        .filter(Boolean)
      const ct = execSync(`git -C ${JSON.stringify(worktree)} log -1 --format=%ct`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      const lastCommitAgeMin = ct ? (now / 1000 - Number(ct)) / 60 : null
      return { recentCount: recent.length, lastCommitAgeMin }
    } catch {
      return { recentCount: 0, lastCommitAgeMin: null }
    }
  }

  const sidecarAgeMin = () => {
    try {
      return (now - statSync(sidecarPath).mtimeMs) / 60000
    } catch {
      return Infinity
    }
  }

  // ── beacon (via the ONE parser) ──
  let beacon = { exists: false }
  if (beaconPath) {
    const line = readBeaconLine(beaconPath)
    if (line) beacon = { exists: true, ageMin: (now - line.ts) / 60000, lastEvent: line.event, log: line.log }
    else {
      let hasContent = false
      try {
        hasContent = readFileSync(beaconPath, 'utf8').trim().length > 0
      } catch {
        /* unreadable */
      }
      if (hasContent) beacon = { exists: false, malformed: true }
    }
  }

  const td = transcriptDir ?? sidecar.transcriptDir ?? null
  const t1 = transcriptSize(td)
  const logPath = beacon.exists ? beacon.log : null
  const log1 = logPath ? realSize(logPath) : null

  const evidence = {}
  evidence.beacon = beacon.exists
    ? `last event '${beacon.lastEvent}', age ${beacon.ageMin.toFixed(1)}min (${beaconPath})`
    : beacon.malformed
      ? 'present but unparseable last line (treated as pre-beacon)'
      : 'absent in both beacon dirs (pre-beacon executor)'

  let verdict = null

  const exited = exitState(td)
  if (exited) {
    verdict = 'EXITED'
    evidence.exit = `final record is a completed assistant turn (end_turn, ${exited.ageMin.toFixed(1)}min ago) in ${exited.path}`
    evidence.finalMessage = exited.excerpt || '(no text block in the final record)'
  }

  if (verdict === null && beacon.exists) {
    if (beacon.ageMin < ALIVE_MAX_MIN) verdict = 'ALIVE'
    else if (beacon.lastEvent === 'gate-stage-start' && beacon.ageMin < GATE_QUIET_MAX_MIN) verdict = 'QUIET'
  }

  const git = gitInfo()
  if (verdict === null) {
    await new Promise((r) => setTimeout(r, PROBE_MS))
    const t2 = transcriptSize(td)
    const log2 = logPath ? realSize(logPath) : null
    const transcriptGrew = t1 != null && t2 != null && t2 > t1
    const logGrew = log1 != null && log2 != null && log2 > log1
    const hits = pgrepHits()

    evidence.transcript = td == null ? 'not recorded' : t1 == null ? `no *.output under ${td}` : `${t1}B → ${t2}B (grew: ${transcriptGrew})`
    if (logPath) evidence.log = `${logPath}: ${log1}B → ${log2}B (grew: ${logGrew})`
    evidence.pgrep = `${hits} process(es) match the worktree`

    const fileAgeMin = newestWorktreeFileAgeMin()

    if (beacon.exists && beacon.lastEvent === 'background-run' && logGrew) verdict = 'ALIVE'
    else if (transcriptGrew || hits > 0) verdict = 'QUIET'
    else if (git.lastCommitAgeMin != null && git.lastCommitAgeMin < ACTIVITY_COMMIT_MAX_MIN) {
      verdict = 'ALIVE'
      evidence.activity = `last commit ${git.lastCommitAgeMin.toFixed(1)}min ago (< ${ACTIVITY_COMMIT_MAX_MIN}min)`
    } else if (fileAgeMin != null && fileAgeMin < ACTIVITY_FILE_MAX_MIN) {
      verdict = 'ALIVE'
      evidence.activity = `newest worktree file touched ${fileAgeMin.toFixed(1)}min ago (< ${ACTIVITY_FILE_MAX_MIN}min)`
    } else if (!beacon.exists && sidecarAgeMin() < PREBEACON_GRACE_MIN) {
      verdict = 'QUIET'
      evidence.grace = `sidecar ${sidecarAgeMin().toFixed(1)}min old, within the ${PREBEACON_GRACE_MIN}min pre-beacon grace window`
    } else verdict = 'STALLED'
  } else {
    evidence.transcript = td == null ? 'not recorded' : t1 == null ? `no *.output under ${td}` : `${t1}B`
    if (logPath) evidence.log = `${logPath}: ${log1}B`
  }

  const preBeacon = !beacon.exists
  const finalVerdict = preBeacon ? `pre-beacon ${verdict}` : verdict
  evidence.git = `${git.recentCount} recent commit(s), last ${git.lastCommitAgeMin == null ? '?' : git.lastCommitAgeMin.toFixed(1)}min ago`

  return { verdict: finalVerdict, arcId, worktree, preBeacon, evidence }
}
