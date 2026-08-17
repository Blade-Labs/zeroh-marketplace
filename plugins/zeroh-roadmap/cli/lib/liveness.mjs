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
 * an ATTRIBUTED commit <15min in a PRODUCT repo derived from the phase keyFiles OR newest
 * declared keyFile <10min OR newest worktree file <10min → ALIVE · no beacon & sidecar
 * within grace → QUIET · else STALLED. A MISSING beacon prefixes the verdict `pre-beacon`.
 *
 * 2026-08-17 scar (the cross-repo false STALLED): a phase whose bookkeeping lived in the arc
 * worktree and whose product code lived in a SIBLING REPOSITORY had no signal at all — the
 * activity row scanned the worktree alone, so an executor committing normally read STALLED and a
 * second executor was spawned onto the live phase. The row now also reads the repositories the
 * phase's own keyFiles point into. Those two arms are the ONLY widening: a product repo is shared
 * with the whole world, so its commits count only when the subject names a phase this arc owns,
 * and the keyFile mtime arm is phase-scoped (hence attributable even on a shared checkout).
 * The derivation is always reported as evidence.crossRepo, on every path — "no product repo" and
 * "a product repo with no attributable commit" are different diagnoses and the reader needs both.
 *
 * Injectable env seams (hermetic tests): LIVENESS_PGREP_CMD, LIVENESS_PROBE_MS (10000),
 * LIVENESS_EXITED_MIN_AGE_MIN (3), LIVENESS_PREBEACON_GRACE_MIN (15).
 */
import { readFileSync, statSync, realpathSync, readdirSync, existsSync, openSync, readSync, closeSync } from 'node:fs'
import { execSync, execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { readBeaconLine, ALIVE_MAX_MIN, GATE_QUIET_MAX_MIN } from './beacon.mjs'
import { scanPhaseFile } from './phasescan.mjs'
import { productRepos, newestKeyFileAgeMin } from './product-repos.mjs'

const ACTIVITY_COMMIT_MAX_MIN = 15
const ACTIVITY_FILE_MAX_MIN = 10
const ACTIVITY_SKIP_DIRS = new Set(['.git', 'node_modules', '.building', 'transcripts', 'dist', 'build', '.next', '.turbo', 'coverage'])
const ACTIVITY_SCAN_CAP = 50_000

/**
 * Per-directory cache of parsed phase records, keyed on a CONTENT SIGNATURE (file count + newest
 * mtime) rather than on the directory alone.
 *
 * The distinction is the whole point. `scanProgress` memoizes unconditionally for the process
 * lifetime, which is why D2 forbade it: `roadmap watch` loop mode calls readLiveness repeatedly in
 * ONE process, and a status flip mid-loop would never be seen. Re-reading instead means parsing
 * every phase file on every poll — on this estate 4282 files and ~130MB per verdict, on a spot
 * check that runs at every executor notification. Signing the directory with a stat sweep costs
 * one cheap syscall per file and invalidates on any edit, so the scan stays as fresh as a full
 * re-read while doing the work only when something actually changed.
 */
const phaseRecordCache = new Map()

function scanPhasesDir(dir) {
  let names = []
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.phase.ts'))
  } catch {
    return [] // no phases dir here — not an error, the layout varies
  }
  let newest = 0
  for (const name of names) {
    try {
      const m = statSync(join(dir, name)).mtimeMs
      if (m > newest) newest = m
    } catch {
      /* raced away — the signature simply omits it */
    }
  }
  const signature = `${names.length}:${newest}`
  const hit = phaseRecordCache.get(dir)
  if (hit && hit.signature === signature) return hit.records
  const records = []
  for (const name of names) {
    try {
      const scanned = scanPhaseFile(join(dir, name))
      if (scanned) records.push(scanned)
    } catch {
      /* unreadable — skipped, never a crash */
    }
  }
  phaseRecordCache.set(dir, { signature, records })
  return records
}

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
  // executor.jsonl AND <worktree>/.building/<phase>-executor.jsonl — scan both, newest by mtime,
  // but ONLY among the beacons this arc owns. Both directories are SHARED: the registry holds a
  // file per arc, and a busy checkout runs several arcs at once, so an unscoped newest-by-mtime
  // scan hands one arc a sibling lane's beacon and reports a stalled executor as ALIVE. That is
  // the one direction a liveness verdict must never fail in, because the caller's whole reason to
  // ask is to decide whether to nudge or respawn.
  //   <otherArcId>-executor.jsonl → provably another arc's, by NAME.
  //   <N>-executor.jsonl          → another arc's when phase N's own file declares a DIFFERENT arcId.
  // The test is PROVABLY-FOREIGN, not provably-ours, and the asymmetry is deliberate. Membership
  // comes from the phase SOURCE (a hermetic regex, no TS bridge), which is not always resolvable:
  // a phase file can be missing, unreadable, or living in a layout this engine cannot see. Treating
  // unknown as foreign would silently blind the arc to its own beacon, trading a false ALIVE for a
  // false STALLED. Unknown therefore stays adopted, exactly as before this filter existed, and only
  // a beacon we can PROVE belongs elsewhere is skipped.
  const phasesDirs = [...new Set([join(worktree, 'roadmap', 'phases'), join(dirname(registryDir), '..', 'phases')])]
  // Per phase: 'ours' | 'foreign' | 'unknown'. A phase file that PARSES but declares no arcId is
  // 'foreign' rather than 'unknown', because an arc only ever executes phases carrying its arcId
  // (that is how membership is derived), so an arcless phase beacon is a standalone do-phase run
  // and can never be this arc's executor. Only a missing or unparseable file is genuinely unknown.
  const ownershipByPhase = new Map()
  function phaseOwnership(phaseNum) {
    if (ownershipByPhase.has(phaseNum)) return ownershipByPhase.get(phaseNum)
    let owner = 'unknown'
    for (const dir of phasesDirs) {
      const p = join(dir, `phase-${phaseNum}.phase.ts`)
      if (!existsSync(p)) continue
      try {
        const scanned = scanPhaseFile(p)
        if (scanned) owner = scanned.arcId === arcId ? 'ours' : 'foreign'
      } catch {
        owner = 'unknown' // unreadable is unknown, and unknown is not proof
      }
      break
    }
    ownershipByPhase.set(phaseNum, owner)
    return owner
  }

  // Is this worktree shared with ANOTHER armed arc? On a shared checkout the worktree-wide activity
  // signals below (a recent commit, a freshly touched file, a pgrep hit) are produced by whichever
  // lane happens to be busy, so they vouch for an arc that has not moved in hours. A solo worktree
  // keeps those signals exactly as they were.
  function otherArcsSharingWorktree() {
    let others = 0
    try {
      for (const name of readdirSync(registryDir)) {
        if (!name.endsWith('.json') || name === `${arcId}.json`) continue
        try {
          const s = JSON.parse(readFileSync(join(registryDir, name), 'utf8'))
          if (s.worktree === worktree && s.arcId !== arcId) others += 1
        } catch {
          /* unreadable sidecar — not evidence of sharing */
        }
      }
    } catch {
      /* no registry — treat as solo */
    }
    return others
  }
  const sharedWith = otherArcsSharingWorktree()
  const sharedWorktree = sharedWith > 0

  /** Age of the newest commit in `repoDir` whose subject names a phase THIS arc owns. The
   *  task-commit grammar
   *  ("phase N — ...") is binding, so attribution is a read rather than a guess. Bounded by TIME
   *  rather than by a commit COUNT: the row it feeds asks "did this arc commit inside the window",
   *  and on a shared tree several lanes can push past any count cap well inside that window, which
   *  would drop this arc's own commit and report a false stall. */
  function ourCommitAgeMin(repoDir = worktree) {
    try {
      const out = execSync(`git -C ${JSON.stringify(repoDir)} log --since="${ACTIVITY_COMMIT_MAX_MIN} minutes ago" --format=%ct%x09%s`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
      for (const line of out.split('\n')) {
        const tab = line.indexOf('\t')
        if (tab < 0) continue
        const phaseNum = line.slice(tab + 1).match(/phase[ -](\d+)/i)?.[1]
        if (!phaseNum || phaseOwnership(phaseNum) !== 'ours') continue
        return (now / 1000 - Number(line.slice(0, tab))) / 60
      }
    } catch {
      /* not a repo — no attributable commit */
    }
    return null
  }

  let foreignBeacons = 0
  // The phase number behind the ADOPTED beacon, when the beacon is phase-keyed. It is one half of
  // "which phases is this arc actually executing" (D2), and discoverBeacon is the only place that
  // knows it — the arc-keyed naming carries no phase at all.
  let beaconPhase = null
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
        const owner = name.slice(0, -'-executor.jsonl'.length)
        const isPhaseKeyed = /^\d+$/.test(owner)
        // A non-numeric owner IS an arcId, so a name that is not ours is proof on its own.
        const foreign = isPhaseKeyed ? phaseOwnership(owner) === 'foreign' : owner !== arcId
        if (foreign) {
          foreignBeacons += 1
          continue
        }
        const p = join(d, name)
        try {
          const st = statSync(p)
          if (!best || st.mtimeMs > best.mtimeMs) best = { path: p, mtimeMs: st.mtimeMs, phase: isPhaseKeyed ? owner : null }
        } catch {
          /* unreadable — skip */
        }
      }
    }
    beaconPhase = best?.phase ?? null
    return best?.path ?? null
  }
  const beaconPath = discoverBeacon()

  /**
   * The absolute keyFiles this arc's live work declares (D2): the union of the adopted beacon's
   * phase and every in-progress phase carrying this arcId. Read through scanPhaseFile per file
   * rather than scanProgress, because scanProgress memoizes per directory for the whole process
   * lifetime and `roadmap watch` loop mode calls readLiveness repeatedly in ONE process — a memo
   * would freeze the phase set at whatever it was when the loop started.
   *
   * Memoized only within THIS invocation, which is one verdict.
   */
  let keyFilesMemo = null
  function ourKeyFiles() {
    if (keyFilesMemo) return keyFilesMemo
    const ours = []
    const seen = new Set()
    // Every path declared by a phase belonging to some OTHER lane. A keyFile is only evidence of
    // THIS arc moving if this arc is the only one that declares it — see the mtime arm below.
    const coDeclared = new Set()
    for (const dir of phasesDirs) {
      for (const scanned of scanPhasesDir(dir)) {
        const isBeaconPhase = beaconPhase != null && String(scanned.phase) === String(beaconPhase)
        const isOurLivePhase = scanned.status === 'in-progress' && scanned.arcId === arcId
        const isOurs = isBeaconPhase || isOurLivePhase
        for (const keyFile of scanned.keyFiles ?? []) {
          if (isOurs) {
            if (seen.has(keyFile)) continue
            seen.add(keyFile)
            ours.push(keyFile)
          } else if (scanned.arcId !== arcId) {
            // An arcless phase counts as another lane too: it is a standalone do-phase run.
            coDeclared.add(keyFile)
          }
        }
      }
    }
    keyFilesMemo = { ours, exclusive: ours.filter((k) => !coDeclared.has(k)) }
    return keyFilesMemo
  }

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
  // The skipped count is REPORTED, not just applied: on a shared checkout the difference between
  // "this arc has no beacon" and "this arc has no beacon but four sibling lanes do" is the whole
  // diagnosis, and it used to be invisible because a sibling's beacon was silently adopted.
  const foreignNote = foreignBeacons > 0 ? ` [${foreignBeacons} beacon(s) skipped: not this arc]` : ''
  evidence.beacon =
    (beacon.exists
      ? `last event '${beacon.lastEvent}', age ${beacon.ageMin.toFixed(1)}min (${beaconPath})`
      : beacon.malformed
        ? 'present but unparseable last line (treated as pre-beacon)'
        : 'absent in both beacon dirs (pre-beacon executor)') + foreignNote

  // Reported on EVERY path, not only when the activity row runs, for the same reason the skipped-
  // beacon count is: on a cross-repo arc the difference between "no product repo" and "a product
  // repo with no attributable commit" is the whole diagnosis, and in the incident it was invisible.
  const { ours: ourKeys, exclusive: exclusiveKeys } = ourKeyFiles()
  const derivedRepos = productRepos(ourKeys, { worktree })
  // The mtime arm reads only the EXCLUSIVELY-declared paths (see the arm itself for why).
  const keyFileAgeMin = newestKeyFileAgeMin(exclusiveKeys, now)
  const sharedNote = ourKeys.length > exclusiveKeys.length
    ? ` [${ourKeys.length - exclusiveKeys.length} keyFile(s) also declared by another lane — evidence only]`
    : ''
  evidence.crossRepo = (derivedRepos.length
    ? `${derivedRepos.length} product repo(s) from keyFiles: ${derivedRepos.join(', ')}; newest exclusively-declared keyFile `
      + `${keyFileAgeMin == null ? 'not written yet' : `${keyFileAgeMin.toFixed(1)}min old`}`
    : `none (${ourKeys.length ? `${ourKeys.length} keyFile(s) declared, all in this worktree's own repository` : 'no keyFiles declared by this arc\'s live phases'})`)
    + sharedNote

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
    // On a SHARED worktree the three worktree-wide signals cannot tell WHICH lane produced them, so
    // they stop deciding the verdict and stay evidence only. The commit signal survives in an
    // attributable form, because the task-commit grammar names the phase. Letting a sibling's
    // activity hold an arc at ALIVE is the same false-ALIVE the beacon scoping fixed, one row down.
    const commitAgeMin = sharedWorktree ? ourCommitAgeMin() : git.lastCommitAgeMin
    if (sharedWorktree) {
      evidence.shared = `worktree shared with ${sharedWith} other armed arc(s): the pgrep and newest-file rows cannot attribute a lane, so they do not decide this verdict`
      evidence.pgrep += ' (not lane-attributable, evidence only)'
    }

    // A product repo is shared with the whole world by definition — other arcs, other branches, the
    // human — so attribution is unconditional there (D3). That adds no new false-ALIVE direction,
    // which is the one direction this verdict must never fail in.
    let productCommit = null
    for (const repo of derivedRepos) {
      const age = ourCommitAgeMin(repo)
      if (age != null && (productCommit == null || age < productCommit.ageMin)) productCommit = { repo, ageMin: age }
    }
    if (derivedRepos.length) {
      evidence.crossRepo += productCommit
        ? `; attributed commit in ${productCommit.repo} ${productCommit.ageMin.toFixed(1)}min ago`
        : '; no commit naming one of this arc\'s phases in any of them'
    }

    if (beacon.exists && beacon.lastEvent === 'background-run' && logGrew) verdict = 'ALIVE'
    else if (transcriptGrew || (hits > 0 && !sharedWorktree)) verdict = 'QUIET'
    else if (commitAgeMin != null && commitAgeMin < ACTIVITY_COMMIT_MAX_MIN) {
      verdict = 'ALIVE'
      evidence.activity = sharedWorktree
        ? `last commit naming one of this arc's phases ${commitAgeMin.toFixed(1)}min ago (< ${ACTIVITY_COMMIT_MAX_MIN}min)`
        : `last commit ${commitAgeMin.toFixed(1)}min ago (< ${ACTIVITY_COMMIT_MAX_MIN}min)`
    } else if (productCommit != null && productCommit.ageMin < ACTIVITY_COMMIT_MAX_MIN) {
      verdict = 'ALIVE'
      evidence.activity =
        `last commit naming one of this arc's phases in the product repo ${productCommit.repo} `
        + `${productCommit.ageMin.toFixed(1)}min ago (< ${ACTIVITY_COMMIT_MAX_MIN}min)`
    } else if (keyFileAgeMin != null && keyFileAgeMin < ACTIVITY_FILE_MAX_MIN) {
      // Unlike the worktree-wide row below, this one survives a shared checkout — but only for
      // paths THIS arc alone declares. A path is scoped to a FILE, not to a lane, and popular
      // spine files are declared by many arcs at once; a sibling lane (or an editor save, or a
      // checkout) touching a co-declared file would otherwise hold a dead executor at ALIVE for
      // ten minutes. Excluding co-declared paths is what makes "attributable by construction"
      // actually true rather than merely intended.
      verdict = 'ALIVE'
      evidence.activity = `newest exclusively-declared keyFile touched ${keyFileAgeMin.toFixed(1)}min ago (< ${ACTIVITY_FILE_MAX_MIN}min)`
    } else if (!sharedWorktree && fileAgeMin != null && fileAgeMin < ACTIVITY_FILE_MAX_MIN) {
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
