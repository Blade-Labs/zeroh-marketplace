/**
 * codex-journal — the ONE home of the codex lane journal mechanics: the LANES table, the
 * journal path grammar, the unreadable-journal contract, the live and closed lookups, and the
 * landed-lane archive stamp. Extracted from cli/commands/codex.mjs (phase 13.1) so that lib
 * modules (landing.mjs) and sibling commands (phase, gate) consume journal truth without
 * pulling the lane launcher's prompt builders and spawn machinery along — the range's one
 * lib→command dependency inversion. Bodies and docblocks moved verbatim, a MOVE not a rewrite;
 * every consumer — the launcher included — imports the names from HERE, so there is one home.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * One entry per mission. Adding a lane is adding an entry here — the launcher, the liveness guard,
 * the journal lookup and `status` all read the table, so a fourth mission never grows a fourth
 * launcher. `flag` is how `status` is pointed at the lane (the run lane is the default, hence null).
 */
export const LANES = {
  run: { prefix: 'codex-', report: 'CODEX-REPORT.md', journalRe: /^codex-[\d-]+(?:\.(?!closed\.)[a-z0-9]+)?\.json$/, closedRe: /^codex-[\d-]+(?:\.[a-z0-9]+)?\.closed\.json$/, flag: null },
  review: { prefix: 'codex-review-', report: 'CODEX-REVIEW.md', journalRe: /^codex-review-[\d-]+\.json$/, closedRe: /^codex-review-[\d-]+\.closed\.json$/, flag: '--review' },
  plan: { prefix: 'codex-plan-', report: 'CODEX-PLAN.md', journalRe: /^codex-plan-[\d-]+\.json$/, closedRe: /^codex-plan-[\d-]+\.closed\.json$/, flag: '--plan' },
}

/** A previous run's hand-off, preserved rather than deleted; the name is a lane's report with
 *  `.prev` before the extension. */
export const prevReportName = (report) => report.replace(/\.md$/, '.prev.md')

/**
 * The run lane's hand-off files. Written into the lane worktree and NEVER committed by contract
 * (the header's hand-off note), which is why the disposal rail takes them as its named untracked
 * exceptions: without them every codex-lane disposal would refuse on the lane's own report.
 */
export const RUN_LANE_ARTIFACTS = [LANES.run.report, prevReportName(LANES.run.report)]

export function journalPath(root, ids, lane = 'run', { label } = {}) {
  return join(root, '.building', `${LANES[lane].prefix}${ids.join('-')}${label ? `.${label}` : ''}.json`)
}

export function writeJournal(root, journal, { label } = {}) {
  const path = journalPath(root, journal.phases, journal.lane ?? 'run', { label })
  mkdirSync(join(root, '.building'), { recursive: true })
  writeFileSync(path, JSON.stringify(journal, null, 2) + '\n')
  return path
}

const matchesWorktree = (journal, worktree) => !worktree || (journal?.worktree && resolve(journal.worktree) === resolve(worktree))

/** A journal that EXISTS and cannot be read as one — it will not parse, or it parses to
 *  something that is not a journal object. Never folded into "no journal": an absent journal
 *  means an inline session (nothing to reconcile), an unreadable one means the launcher's record
 *  is there and unreadable, and treating those alike disarms the reconcile in silence. */
export class JournalUnreadableError extends Error {
  constructor(failures) {
    super(
      `roadmap codex: ${failures.length} journal file(s) NAMING these phase(s) could not be read as a journal, so no `
        + 'lane journal could be resolved \u2014 this is NOT the same as an inline session with no journal:\n'
        + failures.map(({ path, message }) => `  - ${path}: ${message}`).join('\n')
        + '\nRead the file: a truncated journal is a launch that died mid-write, and a file that parses to anything but '
        + 'an object is not a journal at all \u2014 delete it if that run is gone, and relaunch the lane.',
    )
    this.name = 'JournalUnreadableError'
    this.failures = failures
  }
}

/**
 * Why a PARSED journal is still unreadable, or null when it is fine. ONE definition, because two
 * readers must agree: a journal is an OBJECT, and anything else JSON yields — null, a bare number
 * or string, an array — carries no pgid and no phases while still sitting on disk. Falsiness is
 * not the test: `[]` and `"text"` are truthy and would reach the launch guard as a journal with
 * `pgid undefined`, which reads as a dead run and relaunches over a file nobody could read.
 * Completeness is a different question — an object missing `phases` is the coverage check's
 * business, and journals predating a field are deliberately tolerated elsewhere in this lane.
 */
export function journalDeclineReason(value) {
  return !value || typeof value !== 'object' || Array.isArray(value)
    ? `parsed to ${JSON.stringify(value)} — a journal must be an object`
    : null
}

/**
 * The lane journal covering every id in `ids` → { path, journal }, or null.
 *
 * Two lookups, in order: the exact single-phase name, then a scan for the multi-phase journal
 * an arc run writes. Ids are compared as STRINGS on both sides — a journal's `phases` may hold
 * either, and a strict compare would leave every arc run unreconciled.
 *
 * Shared rather than private because the reconcile at landing (gate --verify-complete) must
 * find the same journal `codex status` does; two lookups would drift.
 *
 * THROWS JournalUnreadableError when nothing matched but a candidate file that COULD have covered
 * these ids was DECLINED — it would not parse, or it parsed to something journalDeclineReason
 * refuses: a null there would report "no journal" over a journal that is sitting right on disk. Candidacy is read off the FILENAME, which launch() builds from the very ids it
 * writes into `phases` — so a corrupt journal belonging to other phases is not this lookup's
 * business, and nothing is skipped in silence: that file still throws for the ids it names.
 * Scoping matters because nothing prunes .building, so one truncated journal would otherwise
 * block the reconcile for every phase in the checkout, including inline ones.
 */
export function findJournal(root, ids, lane = 'run', { worktree } = {}) {
  const wanted = ids.map(String)
  const failures = []
  const read = (p, candidate) => {
    let value
    try {
      value = JSON.parse(readFileSync(p, 'utf8'))
    } catch (e) {
      if (candidate) failures.push({ path: p, message: e.message })
      return null
    }
    const declined = journalDeclineReason(value)
    if (declined) {
      if (candidate) failures.push({ path: p, message: declined })
      return null
    }
    return value
  }
  const exact = journalPath(root, ids, lane)
  if (existsSync(exact)) {
    const journal = read(exact, true)
    if (journal && matchesWorktree(journal, worktree)) return { path: exact, journal }
  }
  const dir = join(root, '.building')
  for (const f of existsSync(dir) ? readdirSync(dir) : []) {
    if (!LANES[lane].journalRe.test(f)) continue
    const path = join(dir, f)
    if (path === exact && failures.some((x) => x.path === exact)) continue
    const named = f.match(/\d+/g) ?? []
    const journal = read(path, wanted.every((n) => named.includes(n)))
    const phases = (journal?.phases ?? []).map(String)
    if (journal && wanted.every((n) => phases.includes(n)) && matchesWorktree(journal, worktree)) return { path, journal }
  }
  if (failures.length > 0) throw new JournalUnreadableError(failures)
  return null
}

/**
 * Archive a landed lane's journal: `codex-<ids>.json` → `codex-<ids>.closed.json`, stamped with
 * who closed it and when, never deleted.
 *
 * ONE home, because two done-verbs land lanes — `phase land` for a single delegated phase, `arc
 * land` for every member of a delegated arc — and a lane that got two different post-disposal
 * answers depending on which verb closed it is a lane nobody can report on. The name leaves both
 * live scans by construction: the journalRe class `[\d-]` has no '.', so no launch guard can
 * mistake a closed lane for a live one, while findClosedJournal still resolves it.
 */
export function archiveJournal(journalPath, journal, closedBy) {
  const closed = journalPath.replace(/\.json$/, '.closed.json')
  writeFileSync(closed, JSON.stringify({ ...journal, closedAt: new Date().toISOString(), closedBy }, null, 2) + '\n')
  rmSync(journalPath, { force: true })
  return closed
}

/**
 * The ARCHIVED journal covering every id, or null — the closed twin of findJournal.
 *
 * `phase land` renames a landed run journal `codex-<ids>.json` → `codex-<ids>.closed.json`
 * (stamped, never deleted). That name leaves both live scans on purpose: the journalRe class
 * `[\d-]` has no '.', so no launch guard can ever mistake a closed lane for a live one. The cost
 * is that `status` would report "no journal covers phase(s) N" over a journal sitting right there
 * in .building/ — sending the reader hunting for a run that DID happen and landed. Same two
 * lookups as the live one (the exact name, then a scan), because an arc lands as ONE journal and
 * an exact-name-only probe would miss every member but the first.
 *
 * QUIET by default and LOUD on demand, because the two readers want opposite things from a
 * corrupt file. `codex status` asks about liveness, which a closed lane cannot prove either way,
 * so an unreadable one is simply not an answer there. The gate's attribution reconcile asks
 * whether the launcher's record agrees with the phase file's claim, and its contract is explicit
 * that a journal which EXISTS and will not parse is a PROBLEM, never an absence — archiveJournal's
 * write is not atomic, so a crash mid-write produces exactly that file, and answering null would
 * let landing a delegated phase turn a loud guard quiet. `strict` throws JournalUnreadableError.
 */
export function findClosedJournal(root, ids, lane = 'run', { strict = false, worktree } = {}) {
  const wanted = ids.map(String)
  const failures = []
  const read = (p, candidate) => {
    let value
    try {
      value = JSON.parse(readFileSync(p, 'utf8'))
    } catch (e) {
      if (candidate) failures.push({ path: p, message: e.message })
      return null
    }
    const declined = journalDeclineReason(value)
    if (declined) {
      if (candidate) failures.push({ path: p, message: declined })
      return null
    }
    return value
  }
  const exact = journalPath(root, ids, lane).replace(/\.json$/, '.closed.json')
  if (existsSync(exact)) {
    const journal = read(exact, true)
    if (journal && matchesWorktree(journal, worktree)) return { path: exact, journal }
  }
  const dir = join(root, '.building')
  for (const f of existsSync(dir) ? readdirSync(dir) : []) {
    if (!LANES[lane].closedRe.test(f)) continue
    const path = join(dir, f)
    if (path === exact) continue
    // Candidacy off the FILENAME, the scoping findJournal uses: a corrupt journal belonging to
    // OTHER phases is not this lookup's business, and nothing is skipped in silence — that file
    // still throws for the ids it names.
    const named = f.match(/\d+/g) ?? []
    const journal = read(path, wanted.every((n) => named.includes(n)))
    const phases = (journal?.phases ?? []).map(String)
    if (journal && wanted.every((n) => phases.includes(n)) && matchesWorktree(journal, worktree)) return { path, journal }
  }
  if (strict && failures.length > 0) throw new JournalUnreadableError(failures)
  return null
}
