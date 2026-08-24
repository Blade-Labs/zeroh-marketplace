/**
 * roadmap codex — the sanctioned Codex delegation lane: launch a detached Codex CLI run
 * against queued phase(s) in an isolated worktree, and read its typed status.
 *
 *   roadmap codex run <N> [<N2>…] [--worktree <path>] [--base <ref>]
 *   roadmap codex review <N> [<N2>…] [--doc <path>] [--focus <text>]
 *   roadmap codex status <N> [--review]
 *
 * TWO LANES, one set of launch mechanics. `run` IMPLEMENTS a plan (worktree on a branch,
 * npm ci, per-task commits, its own gate). `review` runs review-phase against one, report-only,
 * landing a CODEX-REVIEW.md and nothing else. The review lane exists because a
 * plan authored and then reviewed by the same model has only ever been marked by its own
 * author — and because `/codex:rescue`, the other route to an outside read, cannot run on this
 * host at all (its runtime sandboxes every command through bubblewrap, which fails before
 * argv: bwrap RTM_NEWADDR, AppArmor's apparmor_restrict_unprivileged_userns). Lanes never
 * share a journal, a worktree, or a report name, so a review and an implementation of the same
 * phase cannot read each other's verdict; they DO share the liveness guard, so neither
 * launches over the other.
 *
 * A LANE DELIVERS A PROTOCOL, IT NEVER RESTATES ONE. Both envelopes hand over the path to their
 * mission's SKILL.md — skills/do-phase for `run`, skills/review-phase for `review` — and override
 * only disposition. This is load-bearing for cross-model comparison: the eval scorecard slices
 * `drivers` / `planners` / `reviewers` by model, and those cells only mean something if every
 * driver read the SAME protocol — a per-lane copy turns that into a comparison of briefings,
 * silently, because the confound never reaches the output. codex.test.mjs greps each generated
 * prompt for its mission's protocol-owned strings and reds when one reappears.
 *
 * The whole point of this being ONE committed entrypoint is classifier hygiene: the
 * shared-host hook and the orphan-reaper pattern-match the VISIBLE command line, so the
 * hand-rolled launch (setsid + sandbox bypass + stdin prompt) kept tripping them. Every
 * hard-won invariant lives here instead (session lessons 2026-07-15/22):
 *  - direct CLI, binary and argv sourced from cli/lib/drivers.mjs (the ONE registry; the
 *    codex entry's bypass posture is there because the companion runtime's bubblewrap sandbox
 *    cannot create loopback on this host — bwrap RTM_NEWADDR);
 *  - the mission prompt goes via STDIN, never argv (the test-orphan-reaper kills any
 *    detached PPID-1 process whose args mention vitest/--test — a long prompt naming the
 *    verify commands looks exactly like a leaked test worker);
 *  - detached via setsid semantics (spawn detached:true + unref), log + journal in
 *    .building/ mirroring the arc-land detach pattern;
 *  - single-run-per-worktree: a live journal pgid refuses a double-run (two Codex runs in
 *    one worktree collide); the liveness probe is process-group kill(0), never pgrep
 *    (pgrep -f self-matches the probe's own argv);
 *  - the hand-off contract: Codex ends by writing CODEX-REPORT.md (never committed) with
 *    per-task shas + verify outcomes and a terminal sentinel CODEX-RUN-COMPLETE|BLOCKED.
 *
 * Division of labor (user ruling 2026-07-22, stated in do-phase SKILL.md): the delegated driver
 * runs each phase FULLY — tasks, per-task commits, and its own gate to green. The supervising
 * session owns the back half only: audit the commits and gate claims against the plan, then
 * integrate and clean up. This command never merges and never pushes.
 */
import { copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gitToplevel } from '../lib/gitroot.mjs'
import { driverStamp, launchArgv, resolveDriver } from '../lib/drivers.mjs'

const SENTINEL_RE = /CODEX-RUN-(COMPLETE|BLOCKED)/

const LANES = {
  run: { prefix: 'codex-', report: 'CODEX-REPORT.md', journalRe: /^codex-[\d-]+\.json$/ },
  review: { prefix: 'codex-review-', report: 'CODEX-REVIEW.md', journalRe: /^codex-review-[\d-]+\.json$/ },
}

function journalPath(root, ids, lane = 'run') {
  return join(root, '.building', `${LANES[lane].prefix}${ids.join('-')}.json`)
}

/** A journal that EXISTS and will not parse. Never folded into "no journal": an absent journal
 *  means an inline session (nothing to reconcile), an unreadable one means the launcher's record
 *  is there and unreadable, and treating those alike disarms the reconcile in silence. */
export class JournalUnreadableError extends Error {
  constructor(failures) {
    super(
      `roadmap codex: ${failures.length} journal file(s) NAMING these phase(s) could not be parsed, so no lane journal `
        + 'could be resolved \u2014 this is NOT the same as an inline session with no journal:\n'
        + failures.map(({ path, message }) => `  - ${path}: ${message}`).join('\n')
        + '\nRead the file: a truncated journal is a launch that died mid-write \u2014 delete it if that run is gone, '
        + 'and relaunch the lane.',
    )
    this.name = 'JournalUnreadableError'
    this.failures = failures
  }
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
 * these ids failed to parse: a null there would report "no journal" over a journal that is sitting
 * right on disk. Candidacy is read off the FILENAME, which launch() builds from the very ids it
 * writes into `phases` — so a corrupt journal belonging to other phases is not this lookup's
 * business, and nothing is skipped in silence: that file still throws for the ids it names.
 * Scoping matters because nothing prunes .building, so one truncated journal would otherwise
 * block the reconcile for every phase in the checkout, including inline ones.
 */
export function findJournal(root, ids, lane = 'run') {
  const wanted = ids.map(String)
  const failures = []
  const read = (p, candidate) => {
    try {
      return JSON.parse(readFileSync(p, 'utf8'))
    } catch (e) {
      if (candidate) failures.push({ path: p, message: e.message })
      return null
    }
  }
  const exact = journalPath(root, ids, lane)
  if (existsSync(exact)) {
    const journal = read(exact, true)
    if (journal) return { path: exact, journal }
  }
  const dir = join(root, '.building')
  for (const f of existsSync(dir) ? readdirSync(dir) : []) {
    if (!LANES[lane].journalRe.test(f)) continue
    const path = join(dir, f)
    if (path === exact && failures.some((x) => x.path === exact)) continue
    const named = f.match(/\d+/g) ?? []
    const journal = read(path, wanted.every((n) => named.includes(n)))
    const phases = (journal?.phases ?? []).map(String)
    if (journal && wanted.every((n) => phases.includes(n))) return { path, journal }
  }
  if (failures.length > 0) throw new JournalUnreadableError(failures)
  return null
}

/** Process-group liveness without pgrep (pgrep -f self-matches its own probe argv). */
function groupAlive(pgid) {
  try {
    process.kill(-pgid, 0)
    return true
  } catch {
    return false
  }
}

/** The run protocol is the do-phase SKILL, resolved from THIS file so a plugin move follows. */
const RUN_SKILL = fileURLToPath(new URL('../../skills/do-phase/SKILL.md', import.meta.url))

/**
 * The run lane's envelope: which phases, what this lane overrides, where the hand-off goes.
 * The protocol body stays in the skill and is read at run time, so every driver implements under
 * the same one — a per-lane copy would leave the scorecard's per-model cells comparing briefings
 * instead of models.
 */
function buildPrompt(root, ids) {
  const phaseFiles = ids.map((n) => `roadmap/phases/phase-${n}.phase.ts`)
  for (const f of phaseFiles) {
    if (!existsSync(join(root, f))) throw new Error(`phase file missing: ${f}`)
  }
  if (!existsSync(RUN_SKILL)) throw new Error(`run protocol missing: ${RUN_SKILL}`)
  return [
    `You are IMPLEMENTING ${ids.length > 1 ? `${ids.length} roadmap phases` : 'ONE roadmap phase'} end-to-end in this git worktree, as the driver of record. Work ONLY in this worktree.`,
    '',
    `YOUR PROTOCOL IS A FILE — read it in full, first, before touching anything: ${RUN_SKILL}`,
    `Its \`references/\` siblings (in ${dirname(RUN_SKILL)}/references/) are part of the protocol — read each one it sends you to, when it sends you there. Follow it as written, end to end, including every part it hands to the driver rather than to a supervising session. This envelope adds only the targets and the overrides below; where the two disagree about HOW to implement, the protocol wins.`,
    '',
    `TARGETS — run the protocol once per phase, in this order: ${phaseFiles.join(', ')}. Every decision is pre-made in their notes: implement, never re-decide.`,
    '',
    'WHAT THIS LANE OVERRIDES — everything else in the protocol runs unchanged:',
    '- THIS WORKTREE ONLY. Never merge, never push, never switch branches, never touch the primary checkout or backlog.ts — the supervising session double-checks your work, integrates, and cleans up. stage explicit paths; never `git add -A` (sibling sessions share this checkout).',
    "- CROSS-REPO PHASES: a plan whose steps/files name paths in ANOTHER checkout (a different git toplevel than this worktree) is a cross-repo phase, and the plan's own paths ARE the instruction — implement and commit the PRODUCT work in that checkout on its currently checked-out branch, while every roadmap-state commit (the phase file, gate artifacts) stays in THIS worktree. The never-touch-the-primary rule protects this roadmap repo's primary checkout only. In the other checkout too: stage explicit paths, never push, never merge, never switch branches.",
    '- RESUME RULE: a task already `done: true` in the phase file whose commit is present in git log is FINISHED — skip it, never redo or amend it (a relaunch over a half-done worktree resumes from the first unfinished task).',
    '- SHARED-HOST RULES (~5 concurrent AI sessions on 16 GB — violating these can freeze the box): every test suite / type-check / build runs wrapped as `capbuild <cmd>`; scoped tiers run EXACTLY `bash scripts/test/run-tier.sh <slot> <files…>` (self-wraps capbuild); NEVER pipe tier output through tail/head/grep; no dev servers.',
    '- YOU HAVE NO SUBAGENTS in this lane. Wherever the protocol spawns an agent, run that step yourself, inline, once per target, and record it under your own name — never claim an agent review that did not run.',
    '- ATTRIBUTION: this lane is `codex`, which only the launcher knows — `executionResult.driver` is `{ model: <your own model id>, lane: "codex" }`. The launcher wrote that same pair into its journal, and a disagreement fails the phase completion check.',
    '',
    `WHEN FINISHED (or blocked): write ${LANES.run.report} in the worktree root (do NOT commit it) with per-task commit sha + verify commands run + outcomes + gate results + any deviation, ending with the single line CODEX-RUN-COMPLETE (or CODEX-RUN-BLOCKED).`,
  ].join('\n')
}

/** The review protocol is the review-phase SKILL, resolved from THIS file so a plugin move follows. */
const REVIEW_SKILL = fileURLToPath(new URL('../../skills/review-phase/SKILL.md', import.meta.url))

/**
 * The review lane's envelope: which targets, what this lane overrides, where the verdict goes.
 * The protocol body stays in the skill and is read at run time, so every driver reviews under
 * the same one — a per-lane copy would leave the scorecard's per-model cells comparing
 * briefings instead of models.
 */
function buildReviewPrompt(root, ids, { doc, focus } = {}) {
  const phaseFiles = ids.map((n) => `roadmap/phases/phase-${n}.phase.ts`)
  for (const f of phaseFiles) {
    if (!existsSync(join(root, f))) throw new Error(`phase file missing: ${f}`)
  }
  if (doc && !existsSync(join(root, doc))) throw new Error(`context doc missing: ${doc}`)
  if (!existsSync(REVIEW_SKILL)) throw new Error(`review protocol missing: ${REVIEW_SKILL}`)
  return [
    'You are running the roadmap REVIEW-PHASE protocol as an INDEPENDENT reviewer, in this git worktree.',
    '',
    `YOUR PROTOCOL IS A FILE — read it in full, first, before forming any opinion: ${REVIEW_SKILL}`,
    `Its \`references/\` siblings (in ${dirname(REVIEW_SKILL)}/references/) are part of the protocol — read each one it sends you to, when it sends you there. Follow it as written. This envelope adds only the targets and the overrides below; where the two disagree about HOW to review, the protocol wins.`,
    '',
    `TARGETS — run the protocol once per phase, dispatching Mode A or Mode B from each phase's own status as it directs: ${phaseFiles.join(', ')}`,
    ...(doc
      ? ['', `CONTEXT DOC (read before the phase files — it states the release intent, the ordering tensions and the open questions these plans belong to): ${doc}`]
      : []),
    '',
    'WHAT THIS LANE OVERRIDES — everything else in the protocol runs unchanged:',
    `- REPORT-ONLY. Step F auto-repair and Step 8's queue mutation are DISABLED here. Never edit a phase file, never touch backlog.ts, never \`git add\`, commit, push, merge, or switch branches; the ONLY file you write is ${LANES.review.report}. Still DO the reasoning of both steps and report their outcome — a repair you would have applied belongs under \`Findings:\` as OPEN, and your placement ruling still goes on the \`Placement:\` line, phrased as a recommendation.`,
    '- You have NO subagents. Wherever the protocol spawns an agent per phase or per criterion, run that step yourself, inline, once per target.',
    '- `judged by:` in the verdict block is YOUR OWN model id. Never claim a review that did not run.',
    '- INDEPENDENCE IS THE POINT: a plan and the review already recorded in it may share an author, so treat that recorded review as a HYPOTHESIS to re-test, never as evidence, and "already reviewed" as grounds for more suspicion rather than less. Re-derive every claim from the code at HEAD.',
    '- Cross-repo targets: read the other checkout by full path (it is outside this worktree), and never write there either.',
    ...(focus ? ['', `TRAILING PROMPT — the protocol\'s "extra checks AFTER the protocol"; it never displaces a step: ${focus}`] : []),
    '',
    'SHARED-HOST RULES (~5 concurrent AI sessions on 16 GB): reading is free, so read widely. The protocol already forbids executing test suites in either mode — honor that. No dev servers, no builds.',
    '',
    `WHEN FINISHED (or blocked): write ${LANES.review.report} in the worktree root (do NOT commit it). It contains one \`## Phase N Review\` block per target in EXACTLY the structure the protocol specifies — downstream parsers consume those enums verbatim — plus, where a claim could not be checked, an explicit "Could not verify" list (never let missing evidence default favorable). End the file with the single line CODEX-RUN-COMPLETE (or CODEX-RUN-BLOCKED if you could not review).`,
  ].join('\n')
}

/**
 * Both lanes refuse to launch over live work: the same-lane journal first (an id set
 * relaunching itself), then ANY journal of EITHER lane whose worktree is this one — a live
 * review reading a worktree must not get an implementation run started underneath it.
 */
function refuseIfLive(root, ids, lane, worktree, jPath, relaunchNote) {
  const building = join(root, '.building')
  if (existsSync(jPath)) {
    const j = JSON.parse(readFileSync(jPath, 'utf8'))
    if (j.pgid && groupAlive(j.pgid)) {
      process.stderr.write(`roadmap codex: a ${lane} for ${ids.join(',')} is LIVE (pgid ${j.pgid}, log ${j.log}) — refusing a double-run\n`)
      return 2
    }
    process.stderr.write(`roadmap codex: previous run (pgid ${j.pgid}) is dead — relaunching${relaunchNote}\n`)
  }

  // The same-id check above cannot see a DIFFERENT id set living in the same worktree (an
  // arc journal codex-2101-2102.json vs `codex run 2101 --worktree <same>`), and launching
  // over a live run would disturb its files. Guard at the worktree level.
  for (const f of readdirSync(building).filter((n) => Object.values(LANES).some((l) => l.journalRe.test(n)))) {
    if (join(building, f) === jPath) continue
    try {
      const oj = JSON.parse(readFileSync(join(building, f), 'utf8'))
      // resolve() both sides: a relative --worktree must not slip past an absolute journal path.
      if (oj.worktree && resolve(oj.worktree) === resolve(worktree) && oj.pgid && groupAlive(oj.pgid)) {
        process.stderr.write(`roadmap codex: journal ${f} has a LIVE run (pgid ${oj.pgid}) in this worktree — refusing to launch over it\n`)
        return 2
      }
    } catch {
      /* an unreadable sibling journal cannot prove liveness */
    }
  }
  return 0
}

/**
 * A report left by a previous run makes `codex status` read its stale sentinel as this run's
 * verdict (bit 2026-08-11: a relaunch polled "blocked" while the live run worked). The report
 * is never committed, so the launching run owns the file — preserved as .prev, never deleted
 * (the status mtime guard already keeps the verdict safe).
 */
function preserveStaleReport(worktree, reportName) {
  const stale = join(worktree, reportName)
  if (!existsSync(stale)) return
  const prev = reportName.replace(/\.md$/, '.prev.md')
  renameSync(stale, join(worktree, prev))
  process.stderr.write(`roadmap codex: preserved the previous run's ${reportName} as ${prev}\n`)
}

/**
 * The shared detached launch: prompt on STDIN, own process group, journal + log in .building/.
 *
 * The journal records the DRIVER the registry pinned, so attribution never depends on the model
 * remembering to self-report what the launcher already commanded. `driver.lane` is the registry
 * id (the DriverShape lane vocabulary) — deliberately not this function's `lane`, which is the
 * run/review mission.
 */
function launch(root, ids, lane, { worktree, base, prompt }) {
  const building = join(root, '.building')
  const stem = `${LANES[lane].prefix}${ids.join('-')}`
  const promptPath = join(building, `${stem}-prompt.txt`)
  writeFileSync(promptPath, prompt)
  const logPath = join(building, `${stem}.log`)
  const logFd = openSync(logPath, 'a')

  // Prompt on STDIN (argv stays clean of test keywords), fully detached, own group.
  const entry = resolveDriver('codex')
  const child = spawn(
    entry.bin,
    launchArgv('codex', { worktree }),
    { detached: true, stdio: [openSync(promptPath, 'r'), logFd, logFd] },
  )
  child.unref()

  const jPath = journalPath(root, ids, lane)
  writeFileSync(
    jPath,
    JSON.stringify(
      { phases: ids, lane, driver: driverStamp(entry), report: LANES[lane].report, worktree, base, pgid: child.pid, log: logPath, prompt: promptPath, startedAt: new Date().toISOString() },
      null,
      2,
    ) + '\n',
  )
  const poll = lane === 'review' ? `roadmap codex status ${ids[0]} --review` : `roadmap codex status ${ids[0]}`
  process.stderr.write(`roadmap codex: launched pgid ${child.pid} in ${worktree} — journal ${jPath}, log ${logPath}. Poll: ${poll}\n`)
  return 0
}

function runCodex(root, ids, argv) {
  const wi = argv.indexOf('--worktree')
  const bi = argv.indexOf('--base')
  const base = bi >= 0 ? argv[bi + 1] : 'develop'
  const worktree = wi >= 0 ? argv[wi + 1] : `${root}-codex-${ids.join('-')}`
  const building = join(root, '.building')
  mkdirSync(building, { recursive: true })
  const jPath = journalPath(root, ids, 'run')

  const refused = refuseIfLive(root, ids, 'run', worktree, jPath, "; the prompt's resume rule skips already-done tasks")
  if (refused !== 0) return refused

  if (!existsSync(worktree)) {
    const wt = spawnSync('git', ['worktree', 'add', worktree, '-b', `codex/${ids.join('-')}`, base], { cwd: root, stdio: 'inherit' })
    if (wt.status !== 0) return wt.status ?? 1
    const capbuild = spawnSync('which', ['capbuild']).status === 0
    for (const dir of [worktree, join(worktree, 'web')]) {
      if (!existsSync(join(dir, 'package.json'))) continue
      const ci = capbuild
        ? spawnSync('capbuild', ['npm', 'ci', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit' })
        : spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit' })
      if (ci.status !== 0) {
        process.stderr.write(`roadmap codex: npm ci failed in ${dir} — not launching\n`)
        return 1
      }
    }
  }

  // buildPrompt can still throw (a renamed/renumbered phase file) — resolve it BEFORE
  // touching the previous run's hand-off, so a failed relaunch destroys no evidence.
  const prompt = buildPrompt(root, ids)
  preserveStaleReport(worktree, LANES.run.report)
  return launch(root, ids, 'run', { worktree, base, prompt })
}

/**
 * The review lane. No branch and no `npm ci`: the mission never builds and never commits, so
 * the worktree is a detached read-only copy — isolation that costs a checkout, not an install.
 */
function reviewCodex(root, ids, argv) {
  const wi = argv.indexOf('--worktree')
  const bi = argv.indexOf('--base')
  const di = argv.indexOf('--doc')
  const fi = argv.indexOf('--focus')
  const base = bi >= 0 ? argv[bi + 1] : 'HEAD'
  const worktree = wi >= 0 ? argv[wi + 1] : `${root}-codex-review-${ids.join('-')}`
  mkdirSync(join(root, '.building'), { recursive: true })
  const jPath = journalPath(root, ids, 'review')

  const refused = refuseIfLive(root, ids, 'review', worktree, jPath, ' — a review re-reads from scratch')
  if (refused !== 0) return refused

  // Resolve the prompt against the PRIMARY checkout before any worktree work, so a bad --doc
  // or a renumbered phase file fails loudly and destroys no previous hand-off.
  const doc = di >= 0 ? argv[di + 1] : undefined
  const focus = fi >= 0 ? argv[fi + 1] : undefined
  const prompt = buildReviewPrompt(root, ids, { doc, focus })

  if (!existsSync(worktree)) {
    const wt = spawnSync('git', ['worktree', 'add', '--detach', worktree, base], { cwd: root, stdio: 'inherit' })
    if (wt.status !== 0) return wt.status ?? 1
  }
  // A release plan usually lives in .building/, which is gitignored and therefore absent from
  // a fresh worktree — copy it in, or the mission's first read fails on a path just validated.
  if (doc && !existsSync(join(worktree, doc))) {
    mkdirSync(dirname(join(worktree, doc)), { recursive: true })
    copyFileSync(join(root, doc), join(worktree, doc))
  }
  preserveStaleReport(worktree, LANES.review.report)
  return launch(root, ids, 'review', { worktree, base, prompt })
}

function statusCodex(root, ids, lane = 'run') {
  let found
  try {
    found = findJournal(root, ids, lane)
  } catch (e) {
    process.stderr.write(`${e.message}\n`)
    return 1
  }
  if (!found) {
    process.stderr.write(`roadmap codex: no ${lane} journal covers phase(s) ${ids.join(',')} in ${join(root, '.building')}\n`)
    return 1
  }
  const { path: jPath, journal: j } = found
  // Journals written before the review lane existed carry no `report` — they are all run-lane.
  const reportPath = join(j.worktree, j.report ?? LANES.run.report)
  // A report older than this run's launch is a PREVIOUS run's hand-off — reading its sentinel
  // as the current verdict is the stale-sentinel bug (a live relaunch polled "blocked"). The
  // launch path also moves it aside; this mtime guard is the second, independent defense.
  const reportExists = existsSync(reportPath)
  // A malformed startedAt (a hand-edited journal) must trust the report — Date.parse(bad)
  // is NaN and `mtime >= NaN` is always false, which would read every COMPLETE run as
  // dead-no-report forever.
  const launchedAt = j.startedAt ? Date.parse(j.startedAt) : NaN
  const fresh = reportExists && (!Number.isFinite(launchedAt) || statSync(reportPath).mtimeMs >= launchedAt)
  const report = fresh ? readFileSync(reportPath, 'utf8') : ''
  const sentinel = report.match(SENTINEL_RE)?.[0] ?? null
  const alive = j.pgid ? groupAlive(j.pgid) : false
  const state = sentinel === 'CODEX-RUN-COMPLETE' ? 'complete' : sentinel === 'CODEX-RUN-BLOCKED' ? 'blocked' : alive ? 'running' : 'dead-no-report'
  const staleReport = reportExists && !fresh ? reportPath : undefined
  process.stdout.write(JSON.stringify({ state, alive, sentinel, report: fresh ? reportPath : null, ...(staleReport ? { staleReport } : {}), ...j }, null, 2) + '\n')
  return state === 'complete' ? 0 : state === 'running' ? 3 : 2
}

/** --arc <ID>: resolve the arc's member phases (planes order) so a whole arc delegates as one run. */
function arcPhases(root, arcId) {
  const src = readFileSync(join(root, 'roadmap', 'arcs', `${arcId}.arc.ts`), 'utf8')
  const ids = [...src.matchAll(/phases:\s*\[([\d,\s]+)\]/g)].flatMap((m) => m[1].match(/\d+/g) ?? [])
  if (ids.length === 0) throw new Error(`no member phases found in arc ${arcId}`)
  return ids
}

export default async function run(argv) {
  const sub = argv[0]
  const ai = argv.indexOf('--arc')
  const root = gitToplevel(process.cwd())
  const arcId = ai >= 0 ? argv[ai + 1] : undefined
  if (ai >= 0 && (!arcId || arcId.startsWith('--') || !existsSync(join(root, 'roadmap', 'arcs', `${arcId}.arc.ts`)))) {
    process.stderr.write(`roadmap codex: --arc needs a valid arc id (roadmap/arcs/<ID>.arc.ts not found for '${arcId ?? ''}')\n`)
    return 1
  }
  // A flag's VALUE must never be read as a phase id (`--base 719` is a ref, not a phase).
  const flagValues = new Set(['--worktree', '--base', '--doc', '--focus', '--arc'].flatMap((f) => (argv.indexOf(f) >= 0 ? [argv.indexOf(f) + 1] : [])))
  const ids = arcId ? arcPhases(root, arcId) : argv.slice(1).filter((a, i) => /^\d+$/.test(a) && !flagValues.has(i + 1))
  const lane = argv.includes('--review') ? 'review' : 'run'
  if (sub === 'run' && ids.length > 0) return runCodex(root, ids, argv)
  if (sub === 'review' && ids.length > 0) return reviewCodex(root, ids, argv)
  if (sub === 'status' && ids.length > 0) return statusCodex(root, ids, lane)
  process.stderr.write(
    'roadmap codex: usage: roadmap codex run <N> [<N2>…] | run --arc <ID> [--worktree <path>] [--base <ref>]\n' +
      '                     roadmap codex review <N> [<N2>…] [--doc <path>] [--focus <text>] [--worktree <path>] [--base <ref>]\n' +
      '                     roadmap codex status <N> [<N2>…] [--review] | status --arc <ID>\n',
  )
  return 1
}
