/**
 * roadmap phase validate <N|file> [--json] [--assumptions] — validate and optionally run tripwires
 * (same engine cli/lib/validate.mjs the write-hook calls). Unlike the hook, this is a
 * STRICT context (design §2): tsx absence is exit 1 here, not fail-open.
 *
 * roadmap phase start <N> (1737.3) — the ATOMIC backlog→in-progress flip the do-phase
 * Step 0 prose used to own (1702 ran 5/6 tasks under status:'backlog'): first-match
 * regex flip (the phasescan tier — the status: field precedes notes, so match #1 is
 * the field, a notes-string literal is untouched), ONE commit with the exact
 * move-to-in-progress subject gitscan's newest-move-commit base rule prefers, then an
 * executor-start beacon. Idempotent on in-progress (exit 0, no second commit);
 * terminal status refuses exit 2; no recognizable status pattern refuses exit 1.
 *
 * roadmap phase curate <N> [--apply] [--groups "1-3,4-6"] — the born-clean squash step
 * (cli/lib/curate.mjs): dry run by default, --apply lands the phase's task/gate history
 * as 1-3 curated commits, a foreign interleave refuses rather than rewrite it.
 *
 * roadmap phase land <N> — the lane's closing act: rebase onto the integration ref, guarded
 * fast-forward, push when authorized, then dispose the lane just landed. Only a lane may run it:
 * the session worktree lane, or a journal-confirmed codex lane whatever executionIsolation says.
 *
 * Exit: 0 clean · 1 usage/config/toolchain · 2 validation failed / refused.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, relative } from 'node:path'
import { gitToplevel, mainCheckout } from '../lib/gitroot.mjs'
import { validateRoadmapFile, renderZodIssues } from '../lib/validate.mjs'
import { runCaptured } from '../lib/exec.mjs'
import { TSX_ABSENT_HINT, bridgeImport } from '../lib/tsx-bridge.mjs'
import { appendExecutorEvent } from '../lib/beacon.mjs'
import { matchStatusField } from '../lib/phasescan.mjs'
import { deriveCurationRange, executeCurate, composeLandedMessage, CurateError } from '../lib/curate.mjs'
import { landPhase, disposeWorktree, isSlotDir, samePath } from '../lib/worktree.mjs'
import { archiveJournal, findJournal, JournalUnreadableError, RUN_LANE_ARTIFACTS } from '../lib/codex-journal.mjs'
import { loadConfig, executionIsolationOf, integrationRefOf } from '../lib/config.mjs'
import { mergeLaneLessons } from '../lib/landing.mjs'

function runStart(argv) {
  const n = argv.find((a) => /^\d+$/.test(a))
  if (!n) {
    process.stderr.write('roadmap phase start: usage: roadmap phase start <N>\n')
    return 1
  }
  const toplevel = gitToplevel(process.cwd())
  const file = join(toplevel, 'roadmap', 'phases', `phase-${n}.phase.ts`)
  if (!existsSync(file)) {
    process.stderr.write(`roadmap phase start: no such file: ${file}\n`)
    return 1
  }
  const src = readFileSync(file, 'utf8')
  // Field-anchored match (phasescan.matchStatusField): a status literal in the doc-comment
  // header must never shadow the real field (phase 1787 false refusal).
  const m = matchStatusField(src)
  const status = m?.status
  if (!status || (status !== 'backlog' && status !== 'in-progress')) {
    if (status === 'done' || status === 'historical') {
      process.stderr.write(`roadmap phase start: phase ${n} is terminal (status '${status}') — refusing to flip\n`)
      return 2
    }
    process.stderr.write(
      `roadmap phase start: phase ${n} carries no status: 'backlog'|'in-progress' pattern (found: ${status ?? 'none'}) — nothing to flip\n`,
    )
    return 1
  }
  if (status === 'in-progress') {
    process.stderr.write(`roadmap phase start: phase ${n} is already in-progress — idempotent no-op\n`)
    return 0
  }
  // Field-only flip: replace exactly the matched field occurrence.
  const flipped = src.slice(0, m.index) + src.slice(m.index).replace("'backlog'", "'in-progress'")
  writeFileSync(file, flipped)
  const rel = relative(toplevel, file)
  // Pathspec-scoped commit: the move-commit must be provably the phase file ONLY — a
  // bare `git commit` commits the whole index, sweeping a shared worktree's
  // sibling-session dirt under the move subject that gitscan's Tier-1 base derivation
  // keys off (CLAUDE.md: stage explicit paths only).
  try {
    execFileSync('git', ['-C', toplevel, 'commit', rel, '-m', `docs(roadmap): phase ${n} — move to in-progress`], {
      timeout: 30_000,
      stdio: 'ignore',
    })
  } catch (e) {
    // The flip is atomic WITH its commit: a failed commit (index-lock contention, a
    // failing hook) must not leave the file flipped-but-uncommitted — a retry would
    // then hit the idempotent branch and return 0 with NO move-commit and NO beacon,
    // silently reintroducing the 1702 class. Revert and refuse so a retry re-attempts.
    writeFileSync(file, src)
    process.stderr.write(`roadmap phase start: the move-commit FAILED (${e?.message?.split('\n')[0] ?? e}) — flip reverted, nothing landed; fix the repo state and retry\n`)
    return 2
  }
  const sid = process.env.CLAUDE_CODE_SESSION_ID ?? process.env.CLAUDE_SESSION_ID
  appendExecutorEvent(toplevel, n, 'executor-start', sid ? { session_id: sid } : {})
  process.stderr.write(`roadmap phase start: phase ${n} → in-progress (move-commit landed, executor-start beacon stamped)\n`)
  return 0
}

function parseArgs(argv) {
  const opts = {}
  const positional = []
  for (const a of argv) {
    if (a === '--json') opts.json = true
    else if (a === '--assumptions') opts.assumptions = true
    else if (!a.startsWith('--')) positional.push(a)
  }
  return { opts, positional }
}

const ASSUMPTION_TIMEOUT_MS = 120_000

/** Execute every declared assumption tripwire from the repository toplevel. */
export async function runAssumptions({
  toplevel,
  phaseNum,
  loadPhase,
  timeoutMs = ASSUMPTION_TIMEOUT_MS,
  out = process.stdout,
  err = process.stderr,
}) {
  let phase
  try {
    phase = loadPhase()
  } catch (error) {
    err.write(`phase validate --assumptions: failed to load phase ${phaseNum}: ${error.message}\n`)
    return 1
  }
  const assumptions = Array.isArray(phase?.assumptions) ? phase.assumptions : []
  if (assumptions.length === 0) {
    out.write(`phase validate --assumptions: phase ${phaseNum} has no assumptions to execute\n`)
    return 0
  }

  let green = true
  for (const assumption of assumptions) {
    const claim = String(assumption?.claim ?? '')
    const command = String(assumption?.verify ?? '')
    const result = await runCaptured(command, { cwd: toplevel, timeoutMs })
    if (result.timedOut) {
      green = false
      out.write(`${claim} — TIMEOUT\n`)
    } else if (result.spawnError) {
      green = false
      out.write(`${claim} — STALE (spawn error: ${result.spawnError})\n`)
    } else if (result.exitCode !== 0) {
      green = false
      out.write(`${claim} — STALE (exit ${result.exitCode})\n`)
    } else {
      out.write(`${claim} — ok\n`)
    }
  }
  return green ? 0 : 2
}

function resolveTarget(arg) {
  if (/^\d+$/.test(arg)) {
    const toplevel = gitToplevel(process.cwd())
    return join(toplevel, 'roadmap', 'phases', `phase-${arg}.phase.ts`)
  }
  return arg
}

/** The production phase-record loader: the tsx bridge, consumer-rooted. */
function bridgeLoadPhase(phaseFile, toplevel) {
  const imp = bridgeImport(phaseFile, { consumerRoot: toplevel })
  if (!imp.ok) {
    if (imp.kind === 'tsx-absent') throw new Error(TSX_ABSENT_HINT)
    throw new Error(`phase curate: failed to read ${phaseFile}: ${imp.stderr || `bridge ${imp.kind}`}`)
  }
  return imp.parsed
}

/** Parse a --groups spec ("1-3,4-6,7") into inclusive task-index ranges. */
function parseGroupsSpec(spec) {
  const ranges = String(spec)
    .split(',')
    .map((part) => {
      const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim())
      if (!m) throw new Error(`phase curate: unparseable --groups segment '${part.trim()}'`)
      return [Number(m[1]), Number(m[2] ?? m[1])]
    })
  if (ranges.length > 3) throw new Error(`phase curate: --groups asks for ${ranges.length} groups — the ceiling is 3 (born-clean means 1-3 logical commits)`)
  return ranges
}

/**
 * `roadmap phase curate <N>` — dry-run by default (a destructive tool shows its hand);
 * only --apply executes. Groups: default ONE; a --groups task-id spec yields up to
 * three, with non-task commits folding into the group of the nearest PRECEDING task
 * commit (the first group when none precedes). A foreign interleave refuses with exit
 * 2 and every offender named — never forced.
 */
export function runCurate({
  cwd,
  toplevel,
  phaseNum,
  apply = false,
  groupsSpec = null,
  loadPhase = (phaseFile) => bridgeLoadPhase(phaseFile, toplevel),
  out = process.stdout,
  err = process.stderr,
}) {
  const range = deriveCurationRange(cwd, phaseNum)
  if (!range.ok) {
    err.write(`${range.reason}\n`)
    for (const f of range.foreign) err.write(`  foreign: ${f.sha} ${f.subject}\n`)
    return 2
  }

  let ranges
  try {
    ranges = groupsSpec ? parseGroupsSpec(groupsSpec) : null
  } catch (e) {
    err.write(`${e.message}\n`)
    return 1
  }

  const taskIndexOf = (subject) => {
    const m = new RegExp(`\\b${phaseNum}\\.(\\d+)\\b`).exec(subject)
    return m ? Number(m[1]) : null
  }
  const groupOfIndex = (idx) => {
    if (!ranges) return 0
    return ranges.findIndex(([lo, hi]) => idx >= lo && idx <= hi)
  }
  // A spec must cover every task index the range actually carries: silently bucketing an
  // uncovered task would land its diff in one commit while the bodies claim otherwise.
  if (ranges) {
    const uncovered = [
      ...new Set(
        range.commits
          .filter((c) => c.kind === 'task')
          .map((c) => taskIndexOf(c.subject))
          .filter((idx) => idx !== null && groupOfIndex(idx) === -1),
      ),
    ]
    if (uncovered.length > 0) {
      err.write(
        `phase curate: --groups '${groupsSpec}' covers no group for task index(es) ${uncovered.join(', ')} — every task in the range must have a group\n`,
      )
      return 1
    }
  }
  const groupCount = ranges ? ranges.length : 1
  const buckets = Array.from({ length: groupCount }, () => [])
  let current = 0
  for (const c of range.commits) {
    if (c.kind === 'task') {
      const idx = taskIndexOf(c.subject)
      if (idx !== null) current = groupOfIndex(idx)
    }
    buckets[current].push(c)
  }
  const nonEmpty = buckets.filter((b) => b.length > 0)

  const phaseFile = join(toplevel, 'roadmap', 'phases', `phase-${phaseNum}.phase.ts`)
  const record = loadPhase(phaseFile)
  const groups = nonEmpty.map((commits) => ({ commits, message: composeLandedMessage(record, { commits }) }))

  out.write(`phase ${phaseNum} curation plan — base ${range.base}\n`)
  for (const c of range.commits) out.write(`  ${c.sha.slice(0, 9)} [${c.kind}] ${c.subject}\n`)
  for (const [i, g] of groups.entries()) {
    out.write(`group ${i + 1}/${groups.length} (${g.commits.length} commits):\n`)
    out.write(`  subject: ${g.message.subject}\n`)
    out.write(`${g.message.body.replace(/^/gm, '  ')}\n`)
  }

  if (!apply) {
    out.write('dry run — nothing moved; re-run with --apply to land the curated commits\n')
    return 0
  }
  // Evidence before surgery: pair each scratch commit with its Revert twin so the
  // RED-proof record lands in the gate report before the SHAs become unreachable. The
  // ritual runs curate AFTER the gate, so a missing report is a real ordering violation
  // and the recorder's throw (curate aborted, history intact) is the correct answer.
  const redProofs = []
  const revertPool = range.commits.filter((c) => c.kind === 'scratch' && /^Revert "/.test(c.subject))
  for (const c of range.commits) {
    if (c.kind !== 'scratch' || /^Revert "/.test(c.subject)) continue
    // Pair by the revert's EXACT inner subject (git writes `Revert "<subject>"`), consuming
    // each revert once — a scratch subject that is a strict prefix of another must not
    // steal the longer one's twin.
    const at = revertPool.findIndex((r) => r.subject.slice('Revert "'.length) === `${c.subject}"`)
    if (at >= 0) redProofs.push({ scratch: c.sha, revert: revertPool.splice(at, 1)[0].sha, subject: c.subject })
  }
  try {
    const { tip } = executeCurate(cwd, { base: range.base, groups }, { toplevel, phase: phaseNum, redProofs })
    out.write(`landed ${groups.length} curated commit(s), tip ${tip}\n`)
    for (const g of groups) out.write(`  ${g.message.subject}\n`)
    return 0
  } catch (e) {
    err.write(`${e.message}\n`)
    return e instanceof CurateError ? 2 : 1
  }
}

/**
 * `cwd` as a codex RUN-lane source, or null — the ONE question that lets a delegated lane
 * reach `phase land` at all.
 *
 * Journals live in the PRIMARY checkout's .building/ (the launcher wrote them where it stood),
 * while `phase land` runs INSIDE the lane worktree, so the lookup roots at mainCheckout(cwd);
 * gitToplevel alone never sees them. The confirmation is path EQUALITY between the journal's
 * `worktree` and `cwd`, never mere existence: "a journal exists" would turn the isolation knob
 * off for every checkout that ever delegated anything, where "this journal names THIS tree" is
 * the source-keyed reading the acceptance rests on.
 *
 * An unreadable journal proves nothing about this source and is not this command's business
 * (the launch guard and `gate --verify-complete` both refuse loudly on it already) — it falls
 * through to null, which means the ordinary isolation refusal answers.
 */
function codexLaneSource(cwd, phaseNum) {
  let root
  try {
    root = mainCheckout(cwd)
  } catch {
    return null
  }
  // The PRIMARY checkout is never a lane, whatever a journal claims: `codex run --worktree <dir>`
  // journals any directory that already exists, and confirming the shared tree here would bypass
  // the isolation refusal and run the rebase, the ref move and the push on it.
  if (samePath(root, cwd)) return null
  let found
  try {
    found = findJournal(root, [phaseNum], 'run')
  } catch (e) {
    // An unreadable journal is NOT an absent one. Falling through silently hands the operator the
    // isolation message, whose remedy — flip the knob — makes the land succeed and then take the
    // not-a-lane branch, so the worktree is never disposed and nobody learns why.
    if (e instanceof JournalUnreadableError) return { unreadable: e.message }
    return null
  }
  const dir = found?.journal?.worktree
  if (!dir || !samePath(dir, cwd)) return null
  // A SLOT is not a lane either. Reusing a provisioned slot as a `--worktree` target (to skip the
  // npm ci) is exactly what the squatting exec lanes did; disposing one would delete the slot and
  // its wt/<k> branch while the registry keeps a live claim row pointing at a removed directory,
  // and slot retirement is deliberately out of this rail's scope.
  if (isSlotDir(root, cwd)) return null
  return { root, journalPath: found.path, journal: found.journal }
}

/**
 * `roadmap phase land <N>` — the closing act for BOTH work-producing lanes: curate --apply has
 * already run, so this rebases the scratch head onto the integration branch, advances it by
 * guarded fast-forward, pushes when the ref is push-authorized, and then disposes what it just
 * landed.
 *
 * WHO MAY LAND. The worktree lane, always. And a JOURNAL-CONFIRMED codex lane, whatever
 * `executionIsolation` says — source-keyed safety, by operator ruling. The knob exists
 * because landing rewrites and moves refs, which is only safe when the tree doing it is not the
 * shared checkout; a codex lane worktree satisfies that by construction, and gating it on a knob
 * this consumer never sets is what left the lane landing by hand-typed rebase + ff-merge, with
 * "remove the worktree" as prose. Every OTHER source keeps the refusal.
 *
 * DISPOSAL. A codex lane's land IS its done-moment: the worktree goes, the now-merged codex/<N>
 * branch goes, and the journal is archived. A slot lane keeps its worktree — a slot's lifecycle
 * is reuse-via-reset and recreating one costs a full npm ci — but still rides the prune along, so
 * a sibling slot whose /tmp directory died stops haunting `git worktree list`. Disposal runs LAST,
 * after the push, because it removes the very directory the earlier acts run in; and a refusal is
 * reported on stderr with exit 0 intact — the land succeeded, and cleanup reports beside it.
 */
export function runLand({ cwd, toplevel, phaseNum, loadPhase, config, out = process.stdout, err = process.stderr, mergeLessons = mergeLaneLessons }) {
  const lane = codexLaneSource(cwd, phaseNum)
  if (lane?.unreadable) {
    err.write(`phase land: ${lane.unreadable}\n`)
    return 1
  }
  const isolation = executionIsolationOf(config)
  if (isolation !== 'worktree' && !lane) {
    err.write(
      `phase land: executionIsolation is '${isolation}' and ${cwd} is not a journal-confirmed codex lane — landing is a lane act; `
        + 'set executionIsolation: "worktree" in roadmap.config.json to activate the session worktree lane\n',
    )
    return 1
  }
  const baseRef = integrationRefOf(config)
  // A release is a HELD human act (the landing.mjs discipline): the lane never rewrites
  // or pushes master/main autonomously, whatever the config names.
  if (baseRef === 'master' || baseRef === 'main') {
    err.write(`phase land: refusing to land onto ${baseRef} — a release branch is a held human act, never a lane act\n`)
    return 1
  }
  // The lane branch is read BEFORE the land, while HEAD is still the lane's own: after the
  // rebase+ff it is the same commit as the integration tip, and after the removal there is no
  // worktree left to ask. The journal records no branch, so the checkout is the only witness.
  const laneBranch = lane ? headBranchOf(cwd) : null
  // Land is the LAND act only. Curation is its own earlier protocol step (gate → curate
  // → done flip): by land time the range carries the completion/groom commits, whose
  // subjects the curation grammar deliberately reads as foreign — re-curating here would
  // refuse every properly-sequenced phase (and re-squash a deliberate --groups split).
  // Whatever sits on the scratch head, curated commits and closing state commits alike,
  // lands as-is.
  let landed
  try {
    landed = landPhase(cwd, baseRef)
  } catch (e) {
    err.write(`${e.message}\n`)
    return 2
  }
  out.write(`landed ${landed.landed} commit(s) on ${baseRef}, tip ${landed.tip}\n`)
  const hasOrigin = (() => {
    try {
      execFileSync('git', ['-C', cwd, 'remote', 'get-url', 'origin'], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  })()
  if (hasOrigin && (config?.mergePolicy?.autonomousPushRefs ?? []).includes(baseRef)) {
    try {
      execFileSync('git', ['-C', cwd, 'push', 'origin', baseRef], { stdio: 'ignore', timeout: 120_000 })
      out.write(`pushed ${baseRef} to origin\n`)
    } catch (e) {
      err.write(`phase land: the local land succeeded but the push failed — push ${baseRef} manually (${e.message})\n`)
      return 2
    }
  }
  if (lane) {
    try {
      const { merged } = mergeLessons(lane.root, cwd)
      if (merged > 0) err.write(`phase land: merged ${merged} lane lesson(s) into the primary corpus\n`)
    } catch (e) {
      err.write(
        `phase land: the land is complete, but lane lessons could NOT be merged (${e?.message?.split('\n')[0] ?? e}) — `
          + `the lane worktree was KEPT; recover its roadmap/arc-evals/lessons.jsonl before disposal\n`,
      )
      return 0
    }
  }
  disposeSource(lane, { cwd, laneBranch, baseRef, out, err })
  return 0
}

/** The lane worktree's own branch name, or null on a detached head. */
function headBranchOf(cwd) {
  try {
    const name = execFileSync('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim()
    return name === 'HEAD' ? null : name
  } catch {
    return null
  }
}

/** The post-land disposal act. Never throws and never changes the land's verdict. */
function disposeSource(lane, { cwd, laneBranch, baseRef, out, err }) {
  if (!lane) {
    // Slot lane: the slot itself is kept (reuse-via-reset), but its repo METADATA is shared,
    // so a sibling slot whose directory died is ours to clear on the way past.
    try {
      const root = mainCheckout(cwd)
      execFileSync('git', ['-C', root, 'worktree', 'prune'], { cwd: root, stdio: 'ignore', timeout: 60_000 })
    } catch {
      // a prune that cannot run leaves stale metadata, which is cosmetic — never a land failure
    }
    return
  }
  let r
  try {
    r = disposeWorktree(lane.root, cwd, {
      branch: laneBranch,
      integrationRef: baseRef,
      allowUntracked: RUN_LANE_ARTIFACTS,
      pgid: lane.journal?.pgid ?? null,
    })
  } catch (e) {
    err.write(`phase land: the land is complete, but disposing ${cwd} threw — ${e?.message ?? e}\n`)
    return
  }
  if (!r.disposed) {
    err.write(`phase land: LANDED, but the lane worktree was KEPT (${r.reason}) — ${r.detail}\n`)
    return
  }
  // Its OWN try, mirroring the arc side: the merge and the push are already done, and an EACCES
  // on the primary's .building must report beside a completed land, never as a stack trace over
  // one. The two landing verbs must not disagree about that.
  let closed
  try {
    closed = archiveJournal(lane.journalPath, lane.journal, 'phase land')
  } catch (e) {
    err.write(
      `phase land: the lane was disposed but its journal could NOT be archived (${e?.message?.split('\n')[0] ?? e}) — `
        + `\`codex status\` will keep reading it as live until ${lane.journalPath} is renamed to .closed.json by hand\n`,
    )
    return
  }
  out.write(
    `disposed the codex lane ${cwd}${r.branchDeleted ? ` and its merged ${laneBranch} branch` : ''}; journal archived to ${closed}\n`,
  )
  // The rail reports a merged branch it could NOT delete in `detail` on the pass path. Dropping
  // it would print "disposed the codex lane" over a leak the operator never hears about — which
  // is the accumulation class in miniature, and would leave the field dead.
  if (r.detail) err.write(`phase land: ${r.detail}\n`)
}

function runLandCli(argv) {
  const n = argv.find((a) => /^\d+$/.test(a))
  if (!n) {
    process.stderr.write('roadmap phase land: usage: roadmap phase land <N>\n')
    return 1
  }
  const toplevel = gitToplevel(process.cwd())
  const config = loadConfig(toplevel)
  return runLand({ cwd: toplevel, toplevel, phaseNum: Number(n), config })
}

function runCurateCli(argv) {
  const gi = argv.indexOf('--groups')
  const groupsSpec = gi >= 0 ? argv[gi + 1] : null
  // A --groups that lost its value must refuse, never fall through to the ONE-group
  // default: under --apply that silently squashes a split the caller asked to keep apart.
  if (gi >= 0 && (!groupsSpec || groupsSpec.startsWith('--'))) {
    process.stderr.write('roadmap phase curate: --groups needs a spec, e.g. --groups "1-3,4-6"\n')
    return 1
  }
  // The phase number is never read out of the --groups value: `curate --groups 3 --apply`
  // with the number forgotten would otherwise curate phase 3.
  const specIdx = gi >= 0 ? gi + 1 : -1
  const n = argv.find((a, i) => i !== specIdx && /^\d+$/.test(a))
  if (!n) {
    process.stderr.write('roadmap phase curate: usage: roadmap phase curate <N> [--apply] [--groups "1-3,4-6,7"]\n')
    return 1
  }
  const apply = argv.includes('--apply')
  const toplevel = gitToplevel(process.cwd())
  return runCurate({ cwd: toplevel, toplevel, phaseNum: Number(n), apply, groupsSpec })
}

export default async function run(argv) {
  const sub = argv[0]
  if (sub === 'start') return runStart(argv.slice(1))
  if (sub === 'curate') return runCurateCli(argv.slice(1))
  if (sub === 'land') return runLandCli(argv.slice(1))
  if (sub !== 'validate') {
    process.stderr.write(
      'roadmap phase: usage: roadmap phase validate <N|file> [--json] [--assumptions] | start <N> | curate <N> [--apply] [--groups "1-3,4-6,7"] | land <N>\n',
    )
    return 1
  }
  const { opts, positional } = parseArgs(argv.slice(1))
  const arg = positional[0]
  if (!arg) {
    process.stderr.write('roadmap phase validate: a phase number or file path is required\n')
    return 1
  }

  let target
  try {
    target = resolveTarget(arg)
  } catch (e) {
    process.stderr.write(`roadmap phase validate: ${e.message}\n`)
    return 1
  }
  if (!existsSync(target)) {
    process.stderr.write(`roadmap phase validate: no such file: ${target}\n`)
    return 1
  }

  const result = validateRoadmapFile(target, { strict: true })

  if (opts.json) {
    process.stdout.write(JSON.stringify(result) + '\n')
  } else {
    // WARN-level authoring lints print on BOTH faces of the one engine (the write-hook bin
    // does the same) and never change the exit code. A lint only this face swallows is a lint
    // nobody reads: plan-phase Step 4 mandates exactly this command.
    for (const w of result.warnings ?? []) process.stderr.write(w + '\n')
    if (result.kind === 'toolchain-missing') process.stderr.write(TSX_ABSENT_HINT + '\n')
    else if (result.kind === 'load-error') {
      process.stderr.write(`[zeroh-roadmap] roadmap file failed to load:\n${result.loadError}\n`)
    } else if (result.kind === 'zod') {
      for (const l of renderZodIssues(result.zod.file, result.zod.issues, { debug: process.env.ZEROH_ROADMAP_DEBUG === '1' }))
        process.stderr.write(l + '\n')
    } else if (result.kind === 'errors') {
      for (const e of result.errors) {
        if (e.rawLines) for (const l of e.rawLines) process.stderr.write(l + '\n')
        else process.stderr.write(`[zeroh-roadmap] ${e.rule}: ${e.msg} — fix: ${e.fix}\n`)
      }
    } else {
      process.stdout.write(`phase validate: ${target} — OK\n`)
    }
  }

  if (result.kind === 'ok' || result.kind === 'skip') {
    if (!opts.assumptions) return 0
    const toplevel = gitToplevel(process.cwd())
    const phaseNum = /^\d+$/.test(arg) ? Number(arg) : Number(/phase-(\d+)\.phase\.ts$/.exec(target)?.[1])
    return await runAssumptions({
      toplevel,
      phaseNum,
      loadPhase: () => bridgeLoadPhase(target, toplevel),
      ...(opts.json ? { out: { write() {} } } : {}),
    })
  }
  if (result.kind === 'toolchain-missing') return 1
  return 2 // zod / load-error / errors
}
