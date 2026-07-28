/**
 * eval-collect — the ArcTrace COLLECTOR (arc EVALCORE, 1996.2). Everything the scorer is
 * allowed to look at, gathered from DISK ALONE: the arc file and its member phase files
 * (through the consumer schema, over the tsx bridge), the roadmap/.gate run records, the
 * recorded sweep + verdicts artifacts, the regenerable RunnerSummary, and git.
 *
 * ## Absence is a field, not a value
 * The collector never mints a stand-in. An artifact that is not on disk produces an ABSENT
 * FIELD; the SCORER owns the single absence→sentinel mapping, so the closed sentinel
 * vocabulary has exactly one application site instead of two that can drift apart.
 *
 * ## Where the contract is enforced
 * Phase files are parsed by the CONSUMER's own `definePhase` at import time (the tsx
 * bridge) — that IS the schema check, and it is the same one `roadmap result check` uses.
 * The JSON artifacts (sweep / verdicts / summary) ride the trace verbatim and are validated
 * where the trace itself is validated: `ArcTraceShape` composes SweepReportShape,
 * ArcVerdictsFileShape and RunnerSummaryShape by reference, so one `.parse()` of the trace
 * at the CLI boundary checks all of them. Only a file that is not READABLE (absent, or not
 * valid JSON) is dropped here — with a warning naming it, never silently.
 *
 * ## Quarantining emit
 * A phase file that will not import is RECORDED (`parseError`) and named in `warnings`,
 * never dropped: a silently missing phase would quietly improve every average it should
 * have dragged down.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultExec } from './exec.mjs'
import { GateRunReportShape } from './gate-report.mjs'
import { bridgeImport, bridgeImportMany } from './tsx-bridge.mjs'

/** A typed collection failure. kind ∈ 'no-arc' | 'tsx-absent' | 'load'. */
export class CollectError extends Error {
  constructor(kind, messageLines) {
    super(messageLines.join('\n'))
    this.name = 'CollectError'
    this.kind = kind
    this.messageLines = messageLines
  }
}

/** Conventional fix-commit grammar — the escape-rate candidate filter. */
const FIX_SUBJECT_RE = /^fix[(:]/

/** The dated-artifact filename axis: <ARCID>-<YYYY-MM-DD>[-<suffix>].json. */
const DATE_RE = '(\\d{4}-\\d{2}-\\d{2})'

const arcFilePath = (repoRoot, arcId) => join(repoRoot, 'roadmap', 'arcs', `${arcId}.arc.ts`)
const phaseFilePath = (repoRoot, n) => join(repoRoot, 'roadmap', 'phases', `phase-${n}.phase.ts`)

/** Regex-escape an arc id so an id containing regex metacharacters cannot widen the match. */
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The newest dated artifact for an arc in `dir`, or null. `suffix` selects the artifact
 * family ('sweep', 'verdicts'); pass null for the un-suffixed RunnerSummary form. Newest
 * is decided by the DATE IN THE NAME (ISO dates sort lexicographically), never by mtime —
 * a re-checkout rewrites mtimes and would silently reorder the archive.
 */
export function newestArtifact(dir, arcId, suffix) {
  if (!existsSync(dir)) return null
  const re = new RegExp(`^${escapeRe(arcId)}-${DATE_RE}${suffix ? `-${escapeRe(suffix)}` : ''}\\.json$`)
  let best = null
  let bestDate = null
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return null // an unreadable dir is an absent artifact, never a throw
  }
  for (const f of entries) {
    const m = f.match(re)
    if (!m) continue
    if (bestDate === null || m[1] > bestDate) {
      bestDate = m[1]
      best = join(dir, f)
    }
  }
  return best
}

/** Read + JSON.parse an artifact. Returns { value } or { error } — never throws. */
function readJson(path) {
  try {
    return { value: JSON.parse(readFileSync(path, 'utf8')) }
  } catch (e) {
    return { error: e.message }
  }
}

/**
 * Flatten every gate run report for one phase into the summaries the eval needs: when it
 * started, whether it went green, the ordered reviewer rounds (the TRAJECTORY is the
 * signal — a first-round `findings-fixed` followed by a clean second round says something
 * a round COUNT cannot), and how many slots failed.
 *
 * A run file that will not read or will not match GateRunReportShape is SKIPPED, never
 * thrown and never half-counted: a corrupt record is missing data, not a reason to refuse
 * an entire arc. The filter stays keyed on `run-<seq>-*.json` so the bridge's sibling
 * `.typed-cache/` mirror under roadmap/.gate/ can never be read as a run.
 */
export function summarizeGateRuns(repoRoot, phaseNum) {
  const dir = join(repoRoot, 'roadmap', '.gate', String(phaseNum))
  if (!existsSync(dir)) return []
  let files
  try {
    files = readdirSync(dir)
  } catch {
    return []
  }
  const runs = files
    .filter((f) => /^run-\d+-.*\.json$/.test(f))
    .map((f) => ({ f, seq: Number(f.match(/^run-(\d+)-/)[1]) }))
    .sort((a, b) => a.seq - b.seq)
  const out = []
  for (const { f } of runs) {
    const read = readJson(join(dir, f))
    if (read.error) continue
    const parsed = GateRunReportShape.safeParse(read.value)
    if (!parsed.success) continue
    const report = parsed.data
    out.push({
      startedAt: report.startedAt,
      green: report.green,
      rounds: report.agents.map((a) => ({ round: a.round, agent: a.agent, verdict: a.verdict })),
      // A slot with no exitCode did not RUN (skipped/declared-absent); only a recorded
      // non-zero exit is a failure. Counting a skip as a failure would invent a red.
      slotFailures: report.slots.filter((s) => typeof s.exitCode === 'number' && s.exitCode !== 0).length,
    })
  }
  return out
}

/**
 * The member commits of a phase, by SUBJECT. `--grep` narrows server-side (an unfiltered
 * full-history log overruns the exec buffer on a real repo) and a subject-only regex then
 * confirms each hit — git's --grep searches the whole message, so a commit that merely
 * MENTIONS the phase in its body would otherwise be read as a member commit and drag the
 * land boundary forward past any escape fix behind it. The digit boundary is what keeps
 * `phase 900` from matching `phase 9001`.
 */
function memberCommits(repoRoot, phaseNum, exec) {
  const r = exec('git', ['-C', repoRoot, 'log', `--grep=phase ${phaseNum}`, '--format=%H%x09%aI%x09%s'])
  if (r.status !== 0) return []
  const re = new RegExp(`(?:^|[^0-9])phase ${phaseNum}(?:[^0-9]|$)`)
  const out = []
  for (const line of r.stdout.split('\n')) {
    const [sha, date, ...rest] = line.split('\t')
    const subject = rest.join('\t')
    if (!sha || !date || !subject) continue
    if (re.test(subject)) out.push({ sha, date, subject })
  }
  return out
}

/** The file paths one commit touched. */
function commitFiles(repoRoot, sha, exec) {
  const r = exec('git', ['-C', repoRoot, 'show', '--name-only', '--format=', sha])
  if (r.status !== 0) return []
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean)
}

/**
 * The arc's git facts: when it landed, which files it owns, and which post-land fixes
 * escaped it.
 *
 * - `landedAt`: the date of the MERGE that carried the arc's newest member commit into the
 *   current branch. Not the tip itself: every member-commit grammar here is in-phase work
 *   (`fix(scope): phase N gate R2` is an ordinary gate round and is routinely the phase's
 *   LAST commit), so any tip-derived boundary would score in-phase rework as an escape. No
 *   such merge (a fast-forward land, or the arc is still on this branch) ⇒ the tip's own
 *   date, which leaves the escape window empty — no evidence of a post-land window is not
 *   the same as evidence of escapes. No member commits at all ⇒ no boundary, never today.
 * - `arcFiles`: the union of the files the member commits touched.
 * - `escapeFixes` (SCORED): commits after `landedAt` carrying the conventional fix grammar
 *   whose SUBJECT NAMES A MEMBER PHASE — rework the arc's own gate let through, attributed
 *   by the same subject-anchored discipline `memberCommits` uses. `files` is the SIZE OF
 *   THE INTERSECTION with the arc's files, not the commit's diff size.
 * - `escapeFixesFileIntersection` (UNSCORED): the count under the previous, unbounded rule
 *   — any post-land fix touching any arc file. It measured how LONG AGO the arc landed as
 *   much as its quality, so the user ruling of 2026-07-28 removed it from the score; it
 *   stays here as an inspectable signal so the old number never silently disappears.
 */
export function findArcGitFacts(repoRoot, memberNums, { exec = defaultExec } = {}) {
  const members = new Map()
  for (const n of memberNums) {
    for (const c of memberCommits(repoRoot, n, exec)) members.set(c.sha, c)
  }
  // No member commits ⇒ no land boundary ⇒ there is nothing to scan AFTER. That is a
  // complete scan of an empty window, not a failed one.
  if (members.size === 0)
    return {
      landedAt: undefined,
      escapeScan: 'complete',
      escapeFixes: [],
      escapeFixesFileIntersection: 0,
      arcFiles: [],
    }

  // Newest member first. The land is the merge that carried the newest member commit which was
  // MERGED at all: a member committed straight onto the base branch after that merge is exactly
  // the escape we are looking for, so it must not be allowed to define the boundary it belongs
  // behind. The walk stops at the first member that yields a merge, so it costs one git call
  // plus one per post-land direct commit — not one per member.
  const byNewest = [...members.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
  let landedAt
  for (const c of byNewest) {
    // `--ancestry-path` keeps only merges on a path from THIS commit to HEAD, so an unrelated
    // merge elsewhere in the history cannot be mistaken for this arc's land; `--reverse` puts
    // the FIRST such merge (the land itself) on top rather than the newest one.
    const merge = exec('git', [
      '-C', repoRoot, 'log', '--merges', '--ancestry-path', '--reverse', '--format=%H%x09%aI', `${c.sha}..HEAD`,
    ])
    const row = merge.status === 0 ? merge.stdout.split('\n').find((l) => l.includes('\t')) : undefined
    if (row) {
      landedAt = row.split('\t')[1]
      break
    }
  }
  // Nothing merged anywhere ⇒ a fast-forward land or an arc still on this branch. The tip's own
  // date leaves the window empty: absence of evidence of a post-land window, not zero escapes.
  landedAt ??= byNewest[0].date

  // The scored window's attribution: a member phase named in the SUBJECT. Same digit-boundary
  // discipline as `memberCommits` — `phase 900` must not match `phase 9001`.
  const memberPhaseRe = new RegExp(`(?:^|[^0-9])phase (?:${[...memberNums].join('|')})(?:[^0-9]|$)`)

  const arcFileSet = new Set()
  for (const sha of members.keys()) for (const f of commitFiles(repoRoot, sha, exec)) arcFileSet.add(f)

  const escapeFixes = []
  let fileIntersectionCount = 0
  // BOUNDED at the land boundary: an unfiltered full-history log is megabytes on a real repo
  // and every commit older than the boundary is irrelevant by definition. `--since` is
  // inclusive of the boundary commit itself, which the explicit date compare below drops.
  const all = exec('git', ['-C', repoRoot, 'log', '--no-merges', `--since=${landedAt}`, '--format=%H%x09%aI%x09%s'])
  let escapeScan = 'complete'
  if (all.status !== 0) {
    // The scan did not run. Recording an empty escape list here would read as a spotless arc
    // and RAISE the code-confidence score, so the failure travels as data instead.
    escapeScan = 'unavailable'
  } else {
    const landedMs = Date.parse(landedAt)
    // Oldest-first so the escape list reads in the order the fixes actually happened.
    for (const line of all.stdout.split('\n').reverse()) {
      const [sha, date, ...rest] = line.split('\t')
      const subject = rest.join('\t')
      if (!sha || !date || !subject) continue
      if (Date.parse(date) <= landedMs) continue
      if (!FIX_SUBJECT_RE.test(subject)) continue
      const files = commitFiles(repoRoot, sha, exec).filter((f) => arcFileSet.has(f))
      // The old, unbounded rule — retained as a signal, no longer scored.
      if (files.length > 0 && !members.has(sha)) fileIntersectionCount += 1
      if (!memberPhaseRe.test(subject)) continue
      escapeFixes.push({ sha, subject, files: files.length })
    }
  }

  // Canonicalize to a Z-suffixed instant: git's %aI emits a local offset (+00:00), which is
  // a valid ISO string but not the datetime form the contract pins. Normalizing HERE keeps
  // one comparable time format across the whole trace instead of per-reader parsing.
  const facts = {
    landedAt: new Date(landedAt).toISOString(),
    escapeScan,
    escapeFixes,
    arcFiles: [...arcFileSet].sort(),
  }
  // A scan that did not run knows NOTHING, including the old count — absent, not zero.
  if (escapeScan === 'complete') facts.escapeFixesFileIntersection = fileIntersectionCount
  return facts
}

/** Lift one parsed phase file into its trace entry. */
function phaseEntry(num, parsed) {
  const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : []
  const entry = {
    phase: num,
    keyFiles: Array.isArray(parsed.keyFiles) ? parsed.keyFiles : [],
    taskCount: tasks.length,
    transparency: tasks.map((t) => t?.transparencyReport).filter(Boolean),
    gateRuns: [],
  }
  if (parsed.executionResult) entry.executionResult = parsed.executionResult
  if (parsed.metrics) entry.metrics = parsed.metrics
  if (parsed.plannedBy) entry.plannedBy = parsed.plannedBy
  return entry
}

/**
 * Collect one arc's whole trace. Returns `{ trace, warnings }` — `warnings` names every
 * artifact that was present-but-unreadable and every phase file that would not import, so
 * a degraded collect is visible in the run output and in the report's notes rather than
 * inferred from a suspiciously good score.
 *
 * Idempotent by construction: a pure function of disk state plus `collectedAt` (injectable,
 * which is what makes the idempotence assertion possible at all).
 */
export function collectArcTrace(
  repoRoot,
  arcId,
  { exec = defaultExec, collectedAt = new Date().toISOString(), consumerRoot = repoRoot } = {},
) {
  const warnings = []
  const arcPath = arcFilePath(repoRoot, arcId)
  if (!existsSync(arcPath))
    throw new CollectError('no-arc', [
      `roadmap eval: no arc file at ${arcPath}`,
      'an arc that does not exist cannot be collected — a zero-phase trace would score as a perfect arc',
    ])

  const arcRes = bridgeImport(arcPath, { consumerRoot })
  if (!arcRes.ok) {
    const kind = arcRes.kind === 'tsx-absent' ? 'tsx-absent' : 'load'
    throw new CollectError(kind, [`roadmap eval: cannot typed-read ${arcPath}`, (arcRes.stderr ?? '').trim()])
  }
  const memberNums = [...new Set((arcRes.parsed.planes ?? []).flatMap((p) => p.phases ?? []))].sort((a, b) => a - b)

  // ONE tsx process for every member (a per-file spawn costs ~7s each on a real arc).
  const paths = memberNums.map((n) => phaseFilePath(repoRoot, n))
  const present = paths.filter((p) => existsSync(p))
  const byPath = present.length > 0 ? bridgeImportMany(present, { consumerRoot }) : { ok: true, byPath: {} }
  if (!byPath.ok && byPath.kind === 'tsx-absent')
    throw new CollectError('tsx-absent', ['roadmap eval: cannot typed-read the member phase files', (byPath.stderr ?? '').trim()])

  const phases = memberNums.map((n) => {
    const p = phaseFilePath(repoRoot, n)
    const r = byPath.ok ? byPath.byPath[p] : undefined
    if (!existsSync(p)) {
      warnings.push(`phase ${n}: no file at ${p} — recorded as an unreadable phase`)
      return { phase: n, keyFiles: [], taskCount: 0, transparency: [], gateRuns: [], parseError: `no file at ${p}` }
    }
    if (!r || !r.ok) {
      const reason = ((r?.stderr ?? '') || 'phase file failed to import').trim().split('\n')[0] || 'phase file failed to import'
      warnings.push(`phase ${n}: ${reason}`)
      return { phase: n, keyFiles: [], taskCount: 0, transparency: [], gateRuns: [], parseError: reason }
    }
    const entry = phaseEntry(n, r.parsed)
    entry.gateRuns = summarizeGateRuns(repoRoot, n)
    return entry
  })
  // Gate runs for the quarantined phases too — the gate record survives a broken phase file.
  for (const entry of phases) if (entry.parseError) entry.gateRuns = summarizeGateRuns(repoRoot, entry.phase)

  const trace = {
    arcId,
    collectedAt,
    phases,
    git: findArcGitFacts(repoRoot, memberNums, { exec }),
  }
  // Every other degraded read warns; a failed escape scan is the one that most flatters the
  // arc, so it warns loudest rather than living only in a field nobody prints.
  if (trace.git.escapeScan === 'unavailable')
    warnings.push('the post-land escape scan could not run — escapeFixes is UNKNOWN, not zero')
  // `arcFiles` is a working set for the escape-fix intersection, not part of the contract.
  delete trace.git.arcFiles
  if (trace.git.landedAt === undefined) delete trace.git.landedAt

  const evalsDir = join(repoRoot, 'roadmap', 'arc-evals')
  for (const [field, suffix] of [
    ['sweep', 'sweep'],
    ['verdicts', 'verdicts'],
  ]) {
    const path = newestArtifact(evalsDir, arcId, suffix)
    if (!path) continue // honest absence — the scorer maps it to its sentinel
    const read = readJson(path)
    if (read.error) {
      warnings.push(`${path}: unreadable (${read.error}) — treated as absent`)
      continue
    }
    trace[field] = read.value
  }
  // roadmap/arc-summaries/ is gitignored by design: absent on a fresh clone is EXPECTED,
  // never a defect, which is why it warns only when a file exists and will not read.
  const summaryPath = newestArtifact(join(repoRoot, 'roadmap', 'arc-summaries'), arcId, null)
  if (summaryPath) {
    const read = readJson(summaryPath)
    if (read.error) warnings.push(`${summaryPath}: unreadable (${read.error}) — treated as absent`)
    else trace.summary = read.value
  }

  return { trace, warnings }
}
