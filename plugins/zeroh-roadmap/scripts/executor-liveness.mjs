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
 *  - beacon: last-line age + event kind of <ID>-executor.jsonl (the 1368 heartbeat)
 *  - transcript: total *.output size under the transcript dir, read via
 *      statSync(realpathSync(p)) so a symlinked stub reports its TARGET size (the
 *      symlink trap, as code) — double-probed for growth; 'not recorded' when no
 *      dir is known (never guess a harness path)
 *  - pgrep: process table match for the worktree (injectable: LIVENESS_PGREP_CMD)
 *  - git: `git -C <worktree> log --oneline -5` + last-commit age
 *
 * Verdict table:
 *   beacon age < 20 min                                   → ALIVE
 *   last event 'gate-stage-start' AND age < 45 min        → QUIET (gate work is silent)
 *   last event 'background-run' AND its log grew          → ALIVE (evidence: log + growth)
 *   otherwise, transcript grew OR pgrep hits              → QUIET
 *   none of the above                                     → STALLED
 * A MISSING beacon = a pre-beacon executor: skip the beacon rows, decide from
 * transcript/pgrep, and prefix the verdict `pre-beacon`.
 *
 * Injectable seams (hermetic tests): LIVENESS_PGREP_CMD overrides the pgrep default;
 * LIVENESS_PROBE_MS (default 10000) is the inter-probe delay.
 */
import { readFileSync, statSync, realpathSync, readdirSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, dirname } from 'node:path'

const ALIVE_MAX_MIN = 20
const GATE_QUIET_MAX_MIN = 45

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
const beaconPath = join(registryDir, `${arcId}-executor.jsonl`)
const PROBE_MS = Number(process.env.LIVENESS_PROBE_MS ?? 10000)
const now = Date.now()

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

function pgrepHits() {
  const cmd = process.env.LIVENESS_PGREP_CMD ?? `pgrep -f ${JSON.stringify(worktree)}`
  try {
    const out = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return out ? out.split('\n').filter(Boolean).length : 0
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
if (existsSync(beaconPath)) {
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
  ? `last event '${beacon.lastEvent}', age ${beacon.ageMin.toFixed(1)}min`
  : beacon.malformed
    ? 'present but unparseable last line (treated as pre-beacon)'
    : 'absent (pre-beacon executor)'

let verdict = null

// Beacon age-based rows need no growth probe — decide them first.
if (beacon.exists) {
  if (beacon.ageMin < ALIVE_MAX_MIN) verdict = 'ALIVE'
  else if (beacon.lastEvent === 'gate-stage-start' && beacon.ageMin < GATE_QUIET_MAX_MIN) verdict = 'QUIET'
}

// Growth-based rows (background-run log, transcript) need a second probe.
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

  if (beacon.exists && beacon.lastEvent === 'background-run' && logGrew) verdict = 'ALIVE'
  else if (transcriptGrew || hits > 0) verdict = 'QUIET'
  else verdict = 'STALLED'
} else {
  // Decided on the beacon alone — still record the cheap signals for the evidence block.
  evidence.transcript =
    transcriptDir == null ? 'not recorded' : t1 == null ? `no *.output under ${transcriptDir}` : `${t1}B`
  if (logPath) evidence.log = `${logPath}: ${log1}B`
}

const preBeacon = !beacon.exists
const finalVerdict = preBeacon ? `pre-beacon ${verdict}` : verdict
evidence.git = ((g) => `${g.recentCount} recent commit(s), last ${g.lastCommitAgeMin == null ? '?' : g.lastCommitAgeMin.toFixed(1)}min ago`)(gitInfo())

if (jsonOut) {
  console.log(JSON.stringify({ verdict: finalVerdict, arcId, worktree, preBeacon, evidence }, null, 2))
} else {
  console.log(`${finalVerdict} — arc ${arcId} (${worktree})`)
  for (const [k, v] of Object.entries(evidence)) console.log(`  ${k}: ${v}`)
}
