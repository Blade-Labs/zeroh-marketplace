#!/usr/bin/env node
/**
 * executor-liveness.mjs — the ONE liveness reader for an arc executor. Replaces
 * the hand-improvised stat/pgrep forensics whose first field run misread a
 * SYMLINKED transcript stub as a frozen file and declared a healthy five-commit
 * executor dead (2026-07-03). Every verdict ships its EVIDENCE; the script only
 * READS — nudging/killing stays with the orchestrator (do-arc, phase 1369).
 *
 * Usage: executor-liveness.mjs <path-to-.building/<ID>.json> [--json] [--transcript-dir <dir>]
 *
 * Signals gathered from the sidecar ({arcId, worktree, ...}):
 *  - exit-state: the FINAL record of the newest agent transcript under the
 *      transcript dir — an assistant record with stop_reason 'end_turn' as the
 *      file's last line means the agent COMPLETED its turn and will never
 *      self-resume; no liveness inference applies (deterministic, checked first)
 *  - beacon: last-line age + event kind of the newest *-executor.jsonl found in
 *      EITHER the sidecar's own dir (roadmap/arcs/.building/) OR the worktree's
 *      top-level .building/ — executors have written both places, keyed by arc
 *      id or phase number, so the reader discovers rather than assumes (the
 *      2026-07-10 false pre-beacon STALLED: the reader hard-coded
 *      <sidecar-dir>/<arcId>-executor.jsonl while the executor wrote
 *      <worktree>/.building/<phase>-executor.jsonl — never found, whole arc
 *      read pre-beacon)
 *  - worktree activity: last-commit age + the newest file mtime across the
 *      worktree (skipping .git/node_modules/.building/transcripts and build
 *      dirs) — the spawn-mechanism-agnostic signal; a harness sub-agent is not
 *      an OS process and can go 10+ min between beacon events inside one big
 *      task, but it cannot work without touching files
 *  - transcript: total *.output size under the transcript dir, read via
 *      statSync(realpathSync(p)) so a symlinked stub reports its TARGET size (the
 *      symlink trap, as code) — double-probed for growth; 'not recorded' when no
 *      dir is known (never guess a harness path)
 *  - pgrep: process table match for the worktree (injectable: LIVENESS_PGREP_CMD)
 *      — POSITIVE evidence only; zero hits means nothing for a harness sub-agent
 *
 * Verdict table (top row wins):
 *   final transcript record = assistant end_turn, ≥3 min old → EXITED (turn over;
 *     evidence carries the final-message excerpt so the orchestrator can see
 *     "prose, no typed result" at a glance)
 *   beacon age < 20 min                                   → ALIVE
 *   last event 'gate-stage-start' AND age < 45 min        → QUIET (gate work is silent)
 *   last event 'background-run' AND its log grew          → ALIVE (evidence: log + growth)
 *   otherwise, transcript grew OR pgrep hits              → QUIET
 *   last commit < 15 min OR newest worktree file < 10 min → ALIVE (activity)
 *   no beacon AND sidecar younger than the grace window   → QUIET (pre-beacon grace —
 *     a just-spawned executor has produced no signal yet; that is not a stall)
 *   none of the above                                     → STALLED
 * A MISSING beacon = a pre-beacon executor: skip the beacon rows, decide from
 * the remaining rows, and prefix the verdict `pre-beacon`.
 *
 * Injectable seams (hermetic tests): LIVENESS_PGREP_CMD overrides the pgrep default;
 * LIVENESS_PROBE_MS (default 10000) is the inter-probe delay;
 * LIVENESS_EXITED_MIN_AGE_MIN (default 3) is the end_turn settle window;
 * LIVENESS_PREBEACON_GRACE_MIN (default 15) is the pre-beacon grace window.
 */
import { readFileSync, statSync, realpathSync, readdirSync, existsSync, openSync, readSync, closeSync } from 'node:fs'
import { execSync, execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'

const ALIVE_MAX_MIN = 20
const GATE_QUIET_MAX_MIN = 45
const EXITED_MIN_AGE_MIN = Number(process.env.LIVENESS_EXITED_MIN_AGE_MIN ?? 3)
const PREBEACON_GRACE_MIN = Number(process.env.LIVENESS_PREBEACON_GRACE_MIN ?? 15)
const ACTIVITY_COMMIT_MAX_MIN = 15
const ACTIVITY_FILE_MAX_MIN = 10
// Dirs the activity scan skips: not-executor-work (.git internals, installs,
// build output) plus the two dirs the WATCHDOG side itself writes into
// (.building sidecars/beacons, transcripts) — monitoring must never read as work.
const ACTIVITY_SKIP_DIRS = new Set(['.git', 'node_modules', '.building', 'transcripts', 'dist', 'build', '.next', '.turbo', 'coverage'])
const ACTIVITY_SCAN_CAP = 50_000

const args = process.argv.slice(2)
const sidecarPath = args.find((a) => !a.startsWith('--'))
const jsonOut = args.includes('--json')
const tdIdx = args.indexOf('--transcript-dir')
const transcriptDirFlag = tdIdx >= 0 ? args[tdIdx + 1] : null

if (!sidecarPath) {
  console.error('usage: executor-liveness.mjs <sidecar.json> [--json] [--transcript-dir <dir>]')
  process.exit(2)
}

const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8'))
const worktree = sidecar.worktree
const arcId = sidecar.arcId
const registryDir = dirname(sidecarPath)
const PROBE_MS = Number(process.env.LIVENESS_PROBE_MS ?? 10000)
const now = Date.now()

/**
 * Beacon DISCOVERY, not a hard-coded path: executors have written
 * <registry>/<arcId>-executor.jsonl AND <worktree>/.building/<phase>-executor.jsonl
 * (the card's `.building/<ID>` was ambiguous on both dir and key). Scan both dirs
 * for any *-executor.jsonl and take the newest by mtime — a wrong guess here is a
 * false STALLED against a healthy executor.
 */
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

/** Newest file mtime across the worktree (skip-list bounded) — age in minutes, or null. */
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
          /* raced/unreadable — skip */
        }
      }
    }
  }
  if (!worktree || !existsSync(worktree)) return null
  walk(worktree)
  return newest > 0 ? (now - newest) / 60000 : null
}

/** statSync through a realpath so a symlink reports its TARGET size (the trap). */
function realSize(p) {
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

/** Newest (by realpath mtime) *.output under dir whose target is an agent JSONL. */
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
          if (!/agent-.*\.jsonl$/.test(real)) continue // background-run logs are *.output too
          const st = statSync(real)
          if (!best || st.mtimeMs > best.mtimeMs) best = { path: real, mtimeMs: st.mtimeMs }
        } catch {
          /* unreadable entry — skip, never crash the reader */
        }
      }
    }
  }
  walk(dir)
  return best
}

/** Parse the final JSONL record of a transcript (tail-read, files can be large). */
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

/**
 * EXITED probe: a final assistant record with stop_reason 'end_turn' means the
 * agent's turn is OVER — nothing re-invokes a sub-agent whose turn ended, so
 * waiting on it is pointless regardless of every other signal. The settle
 * window guards the race where the orchestrator is about to read the return.
 */
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

/** PIDs of this process and its ancestor chain (the shells/agents that ran us). */
function ownAncestry() {
  const pids = new Set()
  let pid = process.pid
  while (pid > 1 && !pids.has(pid)) {
    pids.add(pid)
    try {
      // /proc/<pid>/stat field 4 is ppid; field 2 (comm) can contain spaces but
      // is parenthesized, so split after the closing paren.
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
      pid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1])
    } catch {
      break
    }
  }
  return pids
}

function pgrepHits() {
  // The LIVENESS_PGREP_CMD override (test seam) runs through a shell; the DEFAULT
  // must NOT: execSync's `sh -c 'pgrep -f <worktree>'` wrapper put the pattern in
  // the shell's own cmdline — pgrep excludes itself but not its parent sh — so
  // hits was always ≥1 and the STALLED row was unreachable (the 2026-07-09
  // five-hour false-ALIVE). execFileSync spawns pgrep directly (no wrapper), and
  // the survivors are filtered: the watchdog TOOLING (this script, executor-watch —
  // their argv carries the sidecar path, which usually lives under the worktree)
  // and our own ancestor chain are monitoring, never evidence of executor life.
  const override = process.env.LIVENESS_PGREP_CMD
  try {
    if (override) {
      const out = execSync(override, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      return out ? out.split('\n').filter(Boolean).length : 0
    }
    const out = execFileSync('pgrep', ['-af', worktree], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (!out) return 0
    const ancestry = ownAncestry()
    return out.split('\n').filter(Boolean).filter((line) => {
      const sp = line.indexOf(' ')
      const pid = Number(line.slice(0, sp < 0 ? line.length : sp))
      const cmd = sp < 0 ? '' : line.slice(sp + 1)
      if (ancestry.has(pid)) return false
      if (/executor-(liveness|watch)\.mjs/.test(cmd)) return false
      return true
    }).length
  } catch {
    return 0 // pgrep exits 1 with no match — that's zero hits, not an error
  }
}

function gitInfo() {
  try {
    const recent = execSync(`git -C ${JSON.stringify(worktree)} log --oneline -5`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .split('\n')
      .filter(Boolean)
    const ct = execSync(`git -C ${JSON.stringify(worktree)} log -1 --format=%ct`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    const lastCommitAgeMin = ct ? (now / 1000 - Number(ct)) / 60 : null
    return { recentCount: recent.length, lastCommitAgeMin }
  } catch {
    return { recentCount: 0, lastCommitAgeMin: null }
  }
}

// ── beacon ────────────────────────────────────────────────────────────────────
let beacon = { exists: false }
if (beaconPath) {
  let lines = []
  try {
    lines = readFileSync(beaconPath, 'utf8').trim().split('\n').filter(Boolean)
  } catch {
    lines = [] // I/O error → treat as pre-beacon, never crash the reader
  }
  if (lines.length > 0) {
    try {
      const last = JSON.parse(lines[lines.length - 1])
      beacon = {
        exists: true,
        ageMin: (now - Date.parse(last.ts)) / 60000,
        lastEvent: last.event,
        log: last.log ?? null,
      }
    } catch {
      beacon = { exists: false, malformed: true }
    }
  }
}

const transcriptDir = transcriptDirFlag ?? sidecar.transcriptDir ?? null

// ── first probe (transcript + background-run log) ──────────────────────────────
const t1 = transcriptSize(transcriptDir)
const logPath = beacon.exists ? beacon.log : null
const log1 = logPath ? realSize(logPath) : null

const evidence = {}
evidence.beacon = beacon.exists
  ? `last event '${beacon.lastEvent}', age ${beacon.ageMin.toFixed(1)}min (${beaconPath})`
  : beacon.malformed
    ? 'present but unparseable last line (treated as pre-beacon)'
    : 'absent in both beacon dirs (pre-beacon executor)'

let verdict = null

// EXITED first — it is a FACT, not an inference, and it outranks every liveness
// row: a fresh commit beacon (< 20 min) must not read ALIVE when the transcript
// proves the executor ended its turn right after that commit.
const exited = exitState(transcriptDir)
if (exited) {
  verdict = 'EXITED'
  evidence.exit = `final record is a completed assistant turn (end_turn, ${exited.ageMin.toFixed(1)}min ago) in ${exited.path}`
  evidence.finalMessage = exited.excerpt || '(no text block in the final record)'
}

// Beacon age-based rows need no growth probe — decide them next.
if (verdict === null && beacon.exists) {
  if (beacon.ageMin < ALIVE_MAX_MIN) verdict = 'ALIVE'
  else if (beacon.lastEvent === 'gate-stage-start' && beacon.ageMin < GATE_QUIET_MAX_MIN) verdict = 'QUIET'
}

// Growth-based rows (background-run log, transcript) need a second probe.
const git = gitInfo()
if (verdict === null) {
  await new Promise((r) => setTimeout(r, PROBE_MS))
  const t2 = transcriptSize(transcriptDir)
  const log2 = logPath ? realSize(logPath) : null
  const transcriptGrew = t1 != null && t2 != null && t2 > t1
  const logGrew = log1 != null && log2 != null && log2 > log1
  const hits = pgrepHits()

  evidence.transcript =
    transcriptDir == null
      ? 'not recorded'
      : t1 == null
        ? `no *.output under ${transcriptDir}`
        : `${t1}B → ${t2}B (grew: ${transcriptGrew})`
  if (logPath) evidence.log = `${logPath}: ${log1}B → ${log2}B (grew: ${logGrew})`
  evidence.pgrep = `${hits} process(es) match the worktree`

  // Worktree activity — the spawn-mechanism-agnostic rows. A harness sub-agent
  // is invisible to pgrep and can go 10+ min between beacon events inside one
  // big task, but it cannot work without committing or touching files.
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
    // A just-spawned executor has produced NO signal yet — that is a grace
    // window, not a stall (the 2026-07-10 false STALLED fired seconds after spawn).
    verdict = 'QUIET'
    evidence.grace = `sidecar ${sidecarAgeMin().toFixed(1)}min old, within the ${PREBEACON_GRACE_MIN}min pre-beacon grace window`
  } else verdict = 'STALLED'
} else {
  // Decided on the beacon alone — still record the cheap signals for the evidence block.
  evidence.transcript =
    transcriptDir == null ? 'not recorded' : t1 == null ? `no *.output under ${transcriptDir}` : `${t1}B`
  if (logPath) evidence.log = `${logPath}: ${log1}B`
}

function sidecarAgeMin() {
  try {
    return (now - statSync(sidecarPath).mtimeMs) / 60000
  } catch {
    return Infinity // unreadable sidecar → no grace, never a crash
  }
}

const preBeacon = !beacon.exists
const finalVerdict = preBeacon ? `pre-beacon ${verdict}` : verdict
evidence.git = `${git.recentCount} recent commit(s), last ${git.lastCommitAgeMin == null ? '?' : git.lastCommitAgeMin.toFixed(1)}min ago`

if (jsonOut) {
  console.log(JSON.stringify({ verdict: finalVerdict, arcId, worktree, preBeacon, evidence }, null, 2))
} else {
  console.log(`${finalVerdict} — arc ${arcId} (${worktree})`)
  for (const [k, v] of Object.entries(evidence)) console.log(`  ${k}: ${v}`)
}
