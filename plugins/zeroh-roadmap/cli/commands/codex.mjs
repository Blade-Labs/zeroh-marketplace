/**
 * roadmap codex — the sanctioned Codex delegation lane: launch a detached Codex CLI run
 * against queued phase(s) in an isolated worktree, and read its typed status.
 *
 *   roadmap codex run <N> [<N2>…] [--worktree <path>] [--base <ref>]
 *   roadmap codex review <N> [<N2>…] [--doc <path>] [--focus <text>]
 *   roadmap codex plan <N> --brief <path> [--worktree <path>] [--base <ref>]
 *   roadmap codex status <N> [--review|--plan]
 *
 * THREE LANES, one set of launch mechanics. `run` IMPLEMENTS a plan (worktree on a branch,
 * npm ci, per-task commits, its own gate). `plan` AUTHORS one, committing exactly one phase file.
 * `review` runs review-phase against one, report-only,
 * landing a CODEX-REVIEW.md and nothing else. The review lane exists because a
 * plan authored and then reviewed by the same model has only ever been marked by its own
 * author — and because `/codex:rescue`, the other route to an outside read, cannot run on this
 * host at all (its runtime sandboxes every command through bubblewrap, which fails before
 * argv: bwrap RTM_NEWADDR, AppArmor's apparmor_restrict_unprivileged_userns). Lanes never
 * share a journal, a worktree, or a report name, so a review and an implementation of the same
 * phase cannot read each other's verdict; they DO share the liveness guard, so neither
 * launches over the other.
 *
 * A LANE DELIVERS A PROTOCOL, IT NEVER RESTATES ONE. Every envelope hands over the path to its
 * mission's SKILL.md — skills/do-phase for `run`, skills/plan-phase for `plan`, skills/review-phase
 * for `review` — and overrides only disposition. This is load-bearing for cross-model comparison:
 * the eval scorecard slices `drivers` / `planners` / `reviewers` by model, and those cells only mean something if every
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
 * Division of labor (the user ruling do-phase SKILL.md states): the delegated driver
 * runs each phase FULLY — tasks, per-task commits, and its own gate to green. The supervising
 * session owns the back half only: audit the commits and gate claims against the plan, then
 * integrate and clean up. This command never merges and never pushes.
 */
import { copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gitToplevel } from '../lib/gitroot.mjs'
import { integrationRefOf, loadConfig } from '../lib/config.mjs'
import { driverStamp, launchArgv, resolveDriver } from '../lib/drivers.mjs'
import { disposeWorktree, groupAlive, isSlotDir } from '../lib/worktree.mjs'
import {
  LANES, prevReportName, journalPath, journalDeclineReason,
  JournalUnreadableError, findJournal, findClosedJournal,
} from '../lib/codex-journal.mjs'

// The journal mechanics live in cli/lib/codex-journal.mjs; `findJournal` alone is re-exported
// because codex.test.mjs pins it as a contract OF THIS MODULE — `codex status` and the gate
// reconcile must read the one lookup, and that pin is how a second copy stays impossible.
export { findJournal }

const SENTINEL_RE = /CODEX-RUN-(COMPLETE|BLOCKED)/

/**
 * A flag value that may arrive absolute, as a path RELATIVE to the checkout. `join(root, '/abs')`
 * yields `<root>/abs`, so an absolute path that exists refuses as missing and the carry-in copies
 * from nowhere; and a path outside the checkout would carry IN to a location outside the worktree.
 */
function repoRelative(root, p, flag) {
  if (!p) return p
  // resolve() FIRST: an unnormalized `docs/../../x.md` passes a raw startsWith('..') test and still
  // escapes. Compare segment-wise after, or a legal `..cfg.md` refuses as an escape.
  const rel = relative(root, resolve(root, p))
  if (rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error(`${flag} must name a path inside this checkout (${root}) — got ${p}, which resolves outside it`)
  }
  return rel
}

/** The run protocol is the do-phase SKILL, resolved from THIS file so a plugin move follows. */
export const RUN_SKILL = fileURLToPath(new URL('../../skills/do-phase/SKILL.md', import.meta.url))

/** The role bindings the run lane's fill-a-role override sends the driver to, same resolution. */
const ROLE_BINDINGS = fileURLToPath(new URL('../../MULTI-DRIVER.md', import.meta.url))

/**
 * The run lane's envelope: which phases, what this lane overrides, where the hand-off goes.
 * The protocol body stays in the skill and is read at run time, so every driver implements under
 * the same one — a per-lane copy would leave the scorecard's per-model cells comparing briefings
 * instead of models.
 */
export function buildPrompt(root, ids) {
  const phaseFiles = ids.map((n) => `roadmap/phases/phase-${n}.phase.ts`)
  for (const f of phaseFiles) {
    if (!existsSync(join(root, f))) throw new Error(`phase file missing: ${f}`)
  }
  if (!existsSync(RUN_SKILL)) throw new Error(`run protocol missing: ${RUN_SKILL}`)
  if (!existsSync(ROLE_BINDINGS)) throw new Error(`role bindings missing: ${ROLE_BINDINGS}`)
  return [
    `Implement ${ids.length > 1 ? `${ids.length} roadmap phases` : 'ONE roadmap phase'} end-to-end as driver of record. Work ONLY in this worktree.`,
    '',
    `YOUR PROTOCOL IS A FILE — read it in full, first, before touching anything: ${RUN_SKILL}`,
    `Its \`references/\` siblings (in ${dirname(RUN_SKILL)}/references/) are part of the protocol — read each one when it sends you there. Follow it as written, end to end, including every part it hands to the driver rather than to a supervising session. This envelope adds only the targets and the overrides below; where the two disagree, the protocol wins.`,
    '',
    `TARGETS — run once per phase, in order: ${phaseFiles.join(', ')}. Notes pre-make every decision; implement, never re-decide.`,
    '',
    'WHAT THIS LANE OVERRIDES — everything else in the protocol runs unchanged:',
    '- THIS WORKTREE ONLY. Never merge, never push, never switch branches, never touch the primary checkout or backlog.ts — the supervising session audits, integrates and cleans up. Stage explicit paths; never `git add -A` (siblings share this checkout).',
    '- CROSS-REPO PHASES: a plan naming paths in ANOTHER checkout (a different git toplevel) means what it says — commit the PRODUCT work in that other checkout on its current branch, while every roadmap-state commit (the phase file, gate artifacts) stays in THIS worktree. There too: stage explicit paths, never push, never merge, never switch branches.',
    '- RESUME: `done: true` plus its commit in git log is FINISHED — skip it; resume at the first unfinished task, never redo or amend.',
    `- SHARED HOST (~5 AI sessions on 16 GB — breaking these can freeze the box): wrap every suite / type-check / build as \`capbuild <cmd>\`; ${existsSync(join(root, 'scripts/test/run-tier.sh')) ? 'scoped tiers run EXACTLY `bash scripts/test/run-tier.sh <slot> <files…>`' : 'this consumer has NO scripts/test/run-tier.sh (checked at launch), so scoped tiers run the consumer\u2019s own bound test command from roadmap.config.json gateCommands, narrowed to the touched project, under capbuild — that substitution is PRE-RATIFIED here and is never an escalation'}; never pipe tier output through tail/head/grep; no dev servers; no full-suite run outside the gate slot naming one.`,
    '- End every commit with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.',
    '- NO REACHABLE USER in this lane. Any protocol step that resolves to "stop and ask the user" — an escalating verdict, a failed `assumptions[]` check, a post-and-wait instruction — ENDS this run instead: write the report below with the question and its options, end it with CODEX-RUN-BLOCKED, and stop. Never wait for an answer that cannot come.',
    '- ALREADY IN YOUR WORKTREE and branch: skip worktree setup/reset and landing. Never claim a second slot.',
    `- FILL PROTOCOL ROLES rather than substituting yourself for them: the table in ${ROLE_BINDINGS} §1 (resolveRole in cli/lib/roles.mjs) names the model and how to reach it — spawn it natively when it is yours, else as a headless child (Claude family: \`claude -p [--agents <json>]\`). Record every firing; a role you fill yourself is recorded inline and labelled your own, never as a review that did not run. Reviews recorded as \`self-review\` never satisfy completion — a codex-lane phase needs at least one independent recorded round, and \`--verify-complete\` refuses without it.`,
    '- ATTRIBUTION: stamp `executionResult.driver` as `{ model: <your model id>, lane: "codex" }`; it must match the launcher journal.',
    '',
    `WHEN FINISHED (or blocked): write ${LANES.run.report} in the worktree root (do NOT commit it) with per-task commit sha + the verify commands run and their outcomes + gate results + any deviation, ending with the single line CODEX-RUN-COMPLETE (or CODEX-RUN-BLOCKED).`,
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
    '- THIS LANE REVIEWS INLINE BY DESIGN — not for want of a spawn: independence here is the fresh read, and the verdict must be attributable to the model that formed it. Wherever the protocol spawns an agent per phase or per criterion, run that step yourself, once per target.',
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

/** The plan protocol is the plan-phase SKILL, resolved from THIS file so a plugin move follows. */
const PLAN_SKILL = fileURLToPath(new URL('../../skills/plan-phase/SKILL.md', import.meta.url))

/**
 * The plan lane's envelope: which number, which input, what this lane overrides, where the
 * hand-off goes. The protocol body stays in the skill and is read at run time, so every driver
 * plans under the same one — a per-lane copy would leave the scorecard's per-model cells comparing
 * briefings instead of models.
 */
function buildPlanPrompt(root, ids, { brief } = {}) {
  if (ids.length !== 1) throw new Error(`plan lane: exactly ONE phase number per run (got ${ids.length}) \u2014 one plan act authors one phase file`)
  if (!brief || brief.startsWith('--')) {
    throw new Error(
      'plan lane: --brief <path> is REQUIRED \u2014 a plan with no stated input is an invitation to invent one. '
        + `Write the request down (one line per item) and re-run: roadmap codex plan ${ids[0]} --brief <path/to/brief.md>`,
    )
  }
  const briefPath = join(root, brief)
  if (!existsSync(briefPath) || !statSync(briefPath).isFile()) throw new Error(`plan lane: brief missing (or not a file): ${brief}`)
  const phaseFile = `roadmap/phases/phase-${ids[0]}.phase.ts`
  if (existsSync(join(root, phaseFile))) {
    throw new Error(
      `plan lane: ${phaseFile} already exists \u2014 this lane authors a NEWLY reserved number, so an existing file means the wrong number was passed. `
        + 'Reserve a fresh one and re-run; editing an existing plan is a supervised act, not a detached one.',
    )
  }
  if (!existsSync(PLAN_SKILL)) throw new Error(`plan protocol missing: ${PLAN_SKILL}`)
  if (!existsSync(ROLE_BINDINGS)) throw new Error(`role bindings missing: ${ROLE_BINDINGS}`)
  return [
    'You are PLANNING one roadmap phase \u2014 authoring its phase file, and nothing else. Work ONLY in this worktree.',
    '',
    `YOUR PROTOCOL IS A FILE \u2014 read it in full, first, before investigating anything: ${PLAN_SKILL}`,
    `Its \`references/\` siblings (in ${dirname(PLAN_SKILL)}/references/) are part of the protocol \u2014 read each one when it sends you there. Follow it as written, end to end, including every part it hands to the author rather than to a supervising session. This envelope adds only the target and the overrides below; where the two disagree, the protocol wins.`,
    '',
    `TARGET \u2014 author exactly ${phaseFile}. That number is ALREADY RESERVED for you by the launching session: skip the protocol's number-reservation step, never renumber, and never author a second phase.`,
    '',
    `PLAN INPUT \u2014 the request you are planning, read it before the code: ${join(root, brief)} (also at ${brief} in this worktree). It states WHAT to plan; HOW is yours to decide from the code, per the protocol. An item you cannot plan to a known diff is reported below, never softened into a vague task.`,
    '',
    'WHAT THIS LANE OVERRIDES \u2014 everything else in the protocol runs unchanged:',
    '- THIS WORKTREE ONLY. Never merge, never push, never switch branches, never touch the primary checkout \u2014 the supervising session integrates and cleans up. Stage explicit paths; never `git add -A` (siblings share this checkout).',
    `- ONE FILE MAY CHANGE: ${phaseFile}. Never roadmap/backlog.ts, never source, never another phase file, never a doc. The protocol's closing auto-invoked review pass and the queueing that follows it are DISABLED here \u2014 the supervising session runs that pass, which owns the queue. Still DO the reasoning and report what it would have found.`,
    '- COMMIT: exactly one commit, subject `docs(roadmap): phase <N> \u2014 <desc>`, staging that one path explicitly, and end it with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` \u2014 a lane convention the protocol does not carry.',
    '- SHARED HOST (~5 AI sessions on 16 GB \u2014 breaking these can freeze the box): reading and grepping are free, so read widely; wrap any suite / type-check / build you run as `capbuild <cmd>`; no dev servers.',
    '- NO REACHABLE USER in this lane. Any protocol step that resolves to "stop and ask the user" \u2014 an interview, an unresolvable ambiguity, a placement ruling \u2014 ENDS this run instead: write the report below with the question and its options, end it with CODEX-RUN-BLOCKED, and stop. Never wait for an answer that cannot come.',
    '- YOU ARE ALREADY IN YOUR WORKTREE, on your own branch, both made by the launcher. Never claim a second slot.',
    `- FILL PROTOCOL ROLES rather than substituting yourself for them: the table in ${ROLE_BINDINGS} \u00a71 (resolveRole in cli/lib/roles.mjs) names the model and how to reach it \u2014 spawn it natively when it is yours, else as a headless child (Claude family: \`claude -p [--agents <json>]\`). Record every firing in the report; a role you fill yourself is labelled your own, never as a consult that did not run.`,
    "- ATTRIBUTION: the phase file's `plannedBy` is `{ model: <your own model id> }` \u2014 yours, never the launching session's. The launcher journalled the driver it started, and a disagreement is a finding.",
    '',
    `WHEN FINISHED (or blocked): write ${LANES.plan.report} in the worktree root (do NOT commit it) with the phase number + file, the commit sha, each probe you ran and what it yielded, every role firing, and any decision you could not make, ending with the single line CODEX-RUN-COMPLETE (or CODEX-RUN-BLOCKED).`,
  ].join('\n')
}

/** The refusal an unreadable journal earns at LAUNCH time: exit 1, not the exit 2 a proven-live
 *  run earns — nothing was proven, the evidence is unreadable. */
function refuseUnreadableJournal(lane, ids, failures) {
  const e = new JournalUnreadableError(failures)
  process.stderr.write(
    `roadmap codex: ${e.name} — a ${lane} for ${ids.join(',')} was NOT launched: a ${lane} journal NAMING these `
      + 'phase(s) cannot be read as a journal, so a live run underneath it cannot be ruled out.\n'
      + `${e.message}\n`,
  )
  return 1
}

/** Why findJournal declined a journal that is on disk — a parse failure, or the same
 *  decline reason the lookup applied. Asking journalDeclineReason rather than assuming
 *  "it must not have parsed" is what keeps the disagreement throw below meaning what it says:
 *  a file that parses AND is a well-formed journal, yet was declined, is a real contradiction
 *  between the lookup and this guard — never to launch over, and never to blame on the file. */
function journalParseFailure(path) {
  let value
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    return e.message
  }
  const declined = journalDeclineReason(value)
  if (declined) return declined
  throw new Error(
    `roadmap codex: ${path} parsed on re-read after findJournal declined it — the journal lookup and the launch `
      + 'guard disagree about the same file; fix the lookup before relaunching this lane.',
  )
}

/**
 * Every lane refuses to launch over live work: the same-lane journal first (an id set
 * relaunching itself), then ANY journal of ANY lane whose worktree is this one — a live
 * review reading a worktree must not get an implementation run started underneath it.
 *
 * The same-lane read goes through findJournal so an UNREADABLE journal is a typed refusal
 * carrying its path and the deletion remedy; a raw JSON.parse here surfaced the truncated
 * launch record as a bare SyntaxError. Two questions, scoped differently: LIVENESS is answered
 * by the EXACT journal this launch would overwrite alone, so a readable arc journal that merely
 * covers these ids falls through to the worktree-level check below, which names the file it
 * found. READABILITY is not scoped that way — any journal NAMING these ids that findJournal
 * declines refuses the launch, because a covering journal nobody can read cannot be shown to
 * be dead.
 */
function refuseIfLive(root, ids, lane, worktree, jPath, relaunchNote) {
  const building = join(root, '.building')
  let found
  try {
    found = findJournal(root, ids, lane)
  } catch (e) {
    if (!(e instanceof JournalUnreadableError)) throw e
    return refuseUnreadableJournal(lane, ids, e.failures)
  }
  // findJournal returns the exact journal whenever it parses AND is a journal object, so a
  // broader match while that file sits on disk means the broader one MASKED an unreadable
  // exact journal — journalParseFailure asks WHICH decline it was.
  if (existsSync(jPath) && found?.path !== jPath)
    return refuseUnreadableJournal(lane, ids, [{ path: jPath, message: journalParseFailure(jPath) }])
  if (found?.path === jPath) {
    const j = found.journal
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
  const prev = prevReportName(reportName)
  renameSync(stale, join(worktree, prev))
  process.stderr.write(`roadmap codex: preserved the previous run's ${reportName} as ${prev}\n`)
}

/**
 * The shared detached launch: prompt on STDIN, own process group, journal + log in .building/.
 *
 * The journal records the DRIVER the registry pinned, so attribution never depends on the model
 * remembering to self-report what the launcher already commanded. `driver.lane` is the registry
 * id (the DriverShape lane vocabulary) — deliberately not this function's `lane`, which is the
 * run/plan/review mission.
 */
function launch(root, ids, lane, { worktree, base, prompt, carriedIn = null }) {
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
      // `carriedIn` is the repo-relative path carryIn() copied INTO the worktree, recorded because
      // nothing else can recover it: the copy lands untracked at a path only the launcher knew, and
      // a done-moment that cannot name it refuses on the launcher's own artifact — the same trap
      // RUN_LANE_ARTIFACTS exists to stop for CODEX-REPORT.md. Absent when nothing was carried in.
      { phases: ids, lane, driver: driverStamp(entry), report: LANES[lane].report, worktree, base, pgid: child.pid, log: logPath, prompt: promptPath, ...(carriedIn ? { carriedIn } : {}), startedAt: new Date().toISOString() },
      null,
      2,
    ) + '\n',
  )
  const poll = `roadmap codex status ${ids[0]}${LANES[lane].flag ? ` ${LANES[lane].flag}` : ''}`
  process.stderr.write(`roadmap codex: launched pgid ${child.pid} in ${worktree} — journal ${jPath}, log ${logPath}. Poll: ${poll}\n`)
  return 0
}

/**
 * The shared worktree setup: a branch when the mission COMMITS (run, plan), detached when it only
 * reads (review), and `npm ci` only where the mission needs the consumer's toolchain — the plan
 * act validates its phase file through the consumer's tsx. Returns 0 or an exit to propagate.
 */
function ensureWorktree(root, { worktree, base, branch, install }) {
  if (existsSync(worktree)) return 0
  const addArgs = branch ? [worktree, '-b', branch, base] : ['--detach', worktree, base]
  const wt = spawnSync('git', ['worktree', 'add', ...addArgs], { cwd: root, stdio: 'inherit' })
  if (wt.status !== 0) return wt.status ?? 1
  if (!install) return 0
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
  return 0
}

/** A gitignored input (a release plan, a plan brief) is absent from a fresh worktree — carry it in,
 *  or the mission's first read fails on a path the launcher just validated. */
function carryIn(root, worktree, rel) {
  if (!rel || existsSync(join(worktree, rel))) return
  mkdirSync(dirname(join(worktree, rel)), { recursive: true })
  copyFileSync(join(root, rel), join(worktree, rel))
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

  const made = ensureWorktree(root, { worktree, base, branch: `codex/${ids.join('-')}`, install: true })
  if (made !== 0) return made

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
  const doc = repoRelative(root, di >= 0 ? argv[di + 1] : undefined, '--doc')
  const focus = fi >= 0 ? argv[fi + 1] : undefined
  const prompt = buildReviewPrompt(root, ids, { doc, focus })

  const made = ensureWorktree(root, { worktree, base, branch: null, install: false })
  if (made !== 0) return made
  carryIn(root, worktree, doc)
  preserveStaleReport(worktree, LANES.review.report)
  return launch(root, ids, 'review', { worktree, base, prompt })
}

/**
 * The plan lane. A branch and an install like `run` (the plan act commits its phase file and
 * validates it through the consumer's tsx), but exactly one file may change and the number is
 * reserved before launch — the planner never picks its own.
 */
function planCodex(root, ids, argv) {
  const wi = argv.indexOf('--worktree')
  const bi = argv.indexOf('--base')
  const fi = argv.indexOf('--brief')
  const base = bi >= 0 ? argv[bi + 1] : 'develop'
  const worktree = wi >= 0 ? argv[wi + 1] : `${root}-codex-plan-${ids.join('-')}`
  mkdirSync(join(root, '.building'), { recursive: true })
  const jPath = journalPath(root, ids, 'plan')

  const refused = refuseIfLive(root, ids, 'plan', worktree, jPath, ' — a plan re-authors from scratch')
  if (refused !== 0) return refused

  // Resolve the prompt against the PRIMARY checkout before any worktree work, so a missing
  // --brief or a taken number fails loudly and destroys no previous hand-off.
  const brief = repoRelative(root, fi >= 0 ? argv[fi + 1] : undefined, '--brief')
  const prompt = buildPlanPrompt(root, ids, { brief })

  // --base may carry a phase file the primary checkout does not. Checked from the PRIMARY, before
  // the worktree and its npm ci, so a taken number costs no install and leaves no orphan branch.
  const phaseFile = `roadmap/phases/phase-${ids[0]}.phase.ts`
  if (spawnSync('git', ['cat-file', '-e', `${base}:${phaseFile}`], { cwd: root }).status === 0) {
    process.stderr.write(
      `roadmap codex: ${phaseFile} already exists on ${base} — this lane authors a newly reserved number. `
        + 'Reserve a fresh one and re-run; editing an existing plan is a supervised act, not a detached one.\n',
    )
    return 1
  }

  const made = ensureWorktree(root, { worktree, base, branch: `codex-plan/${ids.join('-')}`, install: true })
  if (made !== 0) return made
  // Present here but NOT on base means a PREVIOUS run of this number authored it (refuseIfLive
  // relaunches over a dead one) — a different cause needing the opposite remedy.
  if (existsSync(join(worktree, phaseFile))) {
    process.stderr.write(
      `roadmap codex: ${phaseFile} already exists in ${worktree} but NOT on ${base} — a previous plan run of this number `
        + 'committed it. Inspect or harvest that commit; this lane never authors over a predecessor\'s output.\n',
    )
    return 1
  }
  carryIn(root, worktree, brief)
  preserveStaleReport(worktree, LANES.plan.report)
  return launch(root, ids, 'plan', { worktree, base, prompt, carriedIn: brief })
}

/**
 * The review lane's done-moment, executed.
 *
 * A review lane is a detached read-only worktree: no branch, no commits, no land — so it has no
 * done-VERB, and the operator ruling forbids inventing one (no standalone close, no timer reaper).
 * Consuming the verdict is therefore the only honest close, which is why `status` gains a side
 * effect here rather than somewhere more polite.
 *
 * Order is the safety: COPY the verdict out FIRST, then dispose. A move would leave an operator
 * sent to resolve a refusal standing in a worktree whose report is gone. Disposal is
 * untracked-tolerant because everything a review lane leaves behind is untracked BY DESIGN — its
 * own CODEX-REVIEW.md, the --doc copy carryIn() wrote — so only a MODIFIED TRACKED file, the one
 * thing a read-only lane should never have produced, refuses. No branch is ever passed: the lane
 * owns none, and disposeWorktree deletes a merged branch it is given.
 *
 * The journal keeps its LIVE name and is stamped in place. Renaming it to .closed.json here would
 * drop it out of findJournal, and the very next `status` would regress to "no journal covers".
 */
function archiveReviewLane(root, jPath, journal, reportPath) {
  const archived = jPath.replace(/\.json$/, '-REPORT.md')
  let stamped = journal
  // The RELOCATION is one-shot, keyed on archivedAt: the copy is unconditional within that (a
  // relaunched review of the same ids finds the PREVIOUS verdict sitting at exactly this path,
  // and skipping the write would leave `status` serving a superseded review forever).
  if (!journal.archivedAt) {
    if (existsSync(reportPath)) copyFileSync(reportPath, archived)
    stamped = { ...journal, archivedAt: new Date().toISOString(), archivedReport: archived }
    writeFileSync(jPath, JSON.stringify(stamped, null, 2) + '\n')
  }
  // The DISPOSAL is not: a refusal is a state that can change. `state === 'complete'` with a LIVE
  // group is reachable — a driver writes its sentinel before its process group exits, and the
  // poll loop reads status in between — so a one-shot done-moment would refuse 'live' once and
  // leave the worktree forever, which is the leak class this rail exists to close and which no
  // sweep verb is allowed to mop up. Retry on every read until the lane is actually gone.
  // The third disposal call site, and the one that fires from a READ command — so it needs the
  // same slot refusal the two landing verbs carry. `codex review <N> --worktree <root>-wt-3`
  // names a provisioned slot, and untracked-tolerance means even its node_modules would not
  // refuse: the slot would be force-removed while its registry row still claims a live path.
  if (isSlotDir(root, journal.worktree)) {
    process.stderr.write(
      `roadmap codex: the review verdict is archived at ${archived}, but ${journal.worktree} is a session SLOT, not a review lane — `
        + 'refusing to remove it; slot retirement is a held human act\n',
    )
    return { journal: stamped, archived }
  }
  const r = disposeWorktree(root, journal.worktree, { branch: null, untrackedTolerant: true, pgid: journal.pgid ?? null })
  if (!r.disposed && !r.alreadyDisposed) {
    process.stderr.write(
      `roadmap codex: the review verdict is archived at ${archived}, but its worktree was KEPT (${r.reason}) — ${r.detail}\n`,
    )
  }
  return { journal: stamped, archived }
}

/**
 * The plan lane's done-moment, executed.
 *
 * The plan lane had no close at all. Its ONE output — roadmap/phases/phase-<N>.phase.ts — is
 * cherry-picked to the primary by the supervising session, and the worktree plus its
 * `codex-plan/<ids>` branch then squat forever (atlas-codex-plan-22 outlived its plan by weeks).
 * The review lane's ratified pattern is the arc-LOCKED design to mirror: consume the hand-off on a
 * status READ, archive it, dispose the lane. Order is the same safety — COPY the plan out FIRST,
 * then remove, so a refusal never leaves an operator standing in a worktree whose plan is gone.
 *
 * What cannot be mirrored is disposeWorktree. Its orphan check is SHA-REACHABILITY, and a harvest
 * is a cherry-pick: the landed commit carries the same bytes under a different sha, so the rail
 * would read every legitimately harvested lane as committed-nowhere-else and refuse it forever.
 * Harvest is CONTENT-carried, and the plan lane's ONE-FILE invariant (the plan envelope's "ONE FILE
 * MAY CHANGE") is what makes a content proof TOTAL — one file, one blob, one question. Guards
 * (a)-(d) below re-provide the liveness and dirt safety the rail would have given, at equal
 * strictness; weakening disposeWorktree with an override flag was considered and rejected, because
 * it would soften that rail for every other caller.
 *
 * THE HARVEST PROOF HAS TWO ARMS (architect amendment A2). Strict byte-equality at the integration
 * tip alone would refuse the NORMAL flow: a Mode A repair routinely edits the harvested phase file
 * again on the integration ref. So the lane counts as harvested when its committed blob either IS
 * the blob at `<integrationRef>:<phaseFile>`, or appears anywhere in that path's committed history
 * there. Both arms read `git rev-parse <ref>:<path>` — committed objects on both sides, never a
 * working-tree file. A never-harvested lane, and a re-plan of the same number, put that blob in
 * neither place.
 *
 * Every refusal KEEPS the lane, names its reason, and names what to do about it. Refusing is never
 * an error: the caller's own act — the status read — already succeeded.
 *
 * The journal keeps its LIVE name and is stamped in place, exactly as archiveReviewLane does:
 * renaming it to .closed.json would drop it out of findJournal and the very next read would regress
 * to "no journal covers".
 */
function archivePlanLane(root, jPath, journal, reportPath) {
  const wt = journal.worktree
  const ids = (journal.phases ?? []).map(String)
  const branch = `codex-plan/${ids.join('-')}`
  const base = journal.base ?? 'develop'
  const phaseFile = `roadmap/phases/phase-${ids[0]}.phase.ts`
  // stderr, never stdout: stdout is the parsed stream every poll loop reads.
  const keep = (reason) => {
    process.stderr.write(`roadmap codex: the plan lane at ${wt} was KEPT — ${reason}\n`)
    return { journal, archived: null }
  }
  const q = (dir, args) => {
    // cwd root, always (the landing.mjs METERTENANT rule): this function removes the very tree a
    // caller may be standing in, and a spawn inheriting a deleted cwd fails ENOENT before git ever
    // parses argv. Only the pre-removal INSPECTION addresses the worktree, because it is the thing
    // being judged.
    const r = spawnSync('git', ['-C', dir, ...args], { cwd: root, encoding: 'utf8' })
    return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
  }

  // RE-ENTRY on an ALREADY-CONSUMED lane. The tree is gone and the plan is archived, so the only
  // thing that can still be stranded is the BRANCH: a `branch -D` that lost to a ref lock on the
  // closing read is announced once and then never retried and never re-reported, because both
  // re-entry conditions have gone false. That is a silent leak of exactly the class this phase
  // exists to end, so the retry lives here rather than in a sweep verb nobody is allowed to add.
  if (journal.archivedAt && !existsSync(wt)) {
    const stranded = q(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
    if (!stranded.ok) return { journal, archived: journal.archivedReport ?? null }
    const retry = q(root, ['branch', '-D', branch])
    process.stderr.write(
      retry.ok
        ? `roadmap codex: ${branch} was stranded by an earlier close (its worktree is already gone) and is now deleted\n`
        : `roadmap codex: ${branch} is STILL stranded — its worktree was disposed on an earlier read, but the branch will not delete: ${retry.out.trim()}\n`
          + `  Delete it by hand: git -C ${root} branch -D ${branch}\n`,
    )
    return { journal, archived: journal.archivedReport ?? null }
  }

  // (a) LIVENESS. `state === 'complete'` with a live group is reachable — a driver writes its
  // sentinel before its process group exits, and the poll reads status in between.
  if (journal.pgid && groupAlive(journal.pgid)) {
    return keep(`its process group (pgid ${journal.pgid}) is still LIVE. Wait for it to exit, then read this status again; in-flight work is never disposed`)
  }
  // The slot refusal every disposal site carries: `codex plan --worktree <root>-wt-3` journals a
  // SLOT, and removing one takes its node_modules with it while the registry keeps a live claim on
  // a deleted path. Slot retirement is a held human act.
  if (isSlotDir(root, wt)) {
    return keep(`${wt} is a session SLOT, not a plan lane. Retire it by hand if it is really spent: roadmap worktree status`)
  }

  // (b) DIRT. Everything a plan lane legitimately leaves untracked is named: its own CODEX-PLAN.md
  // (never committed, by contract), the .building/ the launcher carried in, and the brief carryIn()
  // copied. Anything else — and any MODIFIED TRACKED file — is unexplained work, and removing the
  // tree destroys its only copy.
  const st = q(wt, ['status', '--porcelain', '-uall'])
  if (!st.ok) return keep(`its working state could not be read, so it cannot be shown to be spent — ${st.out.trim()}`)
  // The lane's own untracked outputs, plus the brief the LAUNCHER carried in: carryIn() copies it
  // only when the worktree lacks it, i.e. exactly when it is not committed on base, so it lands
  // untracked at a repo-relative path nothing else records. Without it the close refuses on a file
  // this command created — the trap RUN_LANE_ARTIFACTS exists to stop for the run lane's report.
  const artifacts = new Set([LANES.plan.report, prevReportName(LANES.plan.report), journal.carriedIn].filter(Boolean))
  const blocking = []
  for (const line of st.out.split('\n').filter(Boolean)) {
    const code = line.slice(0, 2)
    const path = line.slice(3).trim().replace(/^"|"$/g, '')
    if (code !== '??') {
      blocking.push(`${code.trim()} ${path} (modified TRACKED file)`)
      continue
    }
    if (path === '.building/' || path.startsWith('.building/')) continue
    if (artifacts.has(path)) continue
    blocking.push(`?? ${path} (untracked, not a named lane artifact)`)
  }
  if (blocking.length > 0) {
    return keep(`it is DIRTY beyond its own lane artifacts — commit, move or delete this first:\n  ${blocking.join('\n  ')}`)
  }

  // (c) THE ONE-FILE INVARIANT. THREE dots: `base` is a moving ref the harvest itself advances, so a
  // two-dot tree diff would report every sibling landing as a change this lane made and refuse
  // every harvested plan. The merge-base diff asks only what the LANE did.
  const diff = q(wt, ['diff', '--name-only', `${base}...HEAD`])
  if (!diff.ok) return keep(`its diff against ${base} could not be read, so the one-file invariant cannot be checked — ${diff.out.trim()}`)
  const changed = diff.out.split('\n').map((s) => s.trim()).filter(Boolean)
  if (changed.length !== 1 || changed[0] !== phaseFile) {
    return keep(
      `it breaches the plan lane's ONE-FILE invariant: ${base}...HEAD changed ${changed.length} file(s) — ${changed.join(', ') || '(none)'} — where exactly ${phaseFile} was allowed. `
        + (changed.length === 0
          ? // An empty diff has TWO causes wanting opposite acts, distinguished HERE rather than by
            // a command handed to the operator: `merge-base --is-ancestor` answers yes to both (a
            // lane that never committed sits ON the merge-base), so prescribing it would route the
            // never-committed lane into a removal that destroys its only record.
            //
            // The probe below asks whether the phase file EXISTS at this lane's HEAD, which is not
            // quite "did this lane author it" — a lane reset onto a base that already carried the
            // file takes the first arm while having authored nothing. So NEITHER arm prescribes a
            // bare removal: both send the operator to read first, and the destructive half names
            // the archive copy ahead of it, because nothing on this path has archived anything (the
            // copy happens only on the PASS path below).
            (q(wt, ['cat-file', '-e', `HEAD:${phaseFile}`]).ok
              ? `An empty diff with ${phaseFile} present at HEAD usually means ${base} already CONTAINS this lane's commit — a merge does that, a cherry-pick does not. `
                + `Confirm with git -C ${wt} log --oneline ${base}..HEAD (empty = the lane added nothing of its own). `
              : `${phaseFile} is not committed at this lane's HEAD at all, so there is no plan here to harvest and nothing this close can prove. `)
            + `Either way ${join(wt, LANES.plan.report)} is the only record of what this lane did: read it, and if you then remove the lane, keep that record — `
            + `cp ${join(wt, LANES.plan.report)} ${jPath.replace(/\.json$/, '-REPORT.md')} && git -C ${root} worktree remove --force ${wt} && git -C ${root} branch -D ${branch}. `
          : '')
        + 'The harvest proof covers that one path, so anything else would ride out of the lane unproven; inspect the branch and land or drop the extra work by hand',
    )
  }

  // (d) THE HARVEST, proven off committed blob ids on both sides.
  const laneBlob = q(wt, ['rev-parse', `HEAD:${phaseFile}`])
  if (!laneBlob.ok) return keep(`${phaseFile} is not committed at this lane's HEAD, so there is nothing to prove harvested — ${laneBlob.out.trim()}`)
  const lb = laneBlob.out.trim()
  // The configured integration ref is the plan's ruling; an UNCONFIGURED consumer falls back to the
  // ref this lane was branched from, which is the launcher's own recorded answer to the same
  // question — never a bare literal, and never a throw: `codex status` is a read.
  let integrationRef
  try {
    integrationRef = integrationRefOf(loadConfig(root))
  } catch {
    integrationRef = base
  }
  const atTip = q(root, ['rev-parse', `${integrationRef}:${phaseFile}`])
  let harvested = atTip.ok && atTip.out.trim() === lb
  if (!harvested) {
    const history = q(root, ['log', '--format=%H', integrationRef, '--', phaseFile])
    for (const sha of history.ok ? history.out.split('\n').map((s) => s.trim()).filter(Boolean) : []) {
      const b = q(root, ['rev-parse', `${sha}:${phaseFile}`])
      if (b.ok && b.out.trim() === lb) {
        harvested = true
        break
      }
    }
  }
  if (!harvested) {
    const tip = q(root, ['rev-parse', branch])
    return keep(
      `its plan was never HARVESTED: the committed blob of ${phaseFile} at this lane's HEAD is neither at ${integrationRef}:${phaseFile} nor anywhere in that path's history there, `
        + `so removing the lane would destroy the only copy of the plan. Harvest it first: git -C ${root} cherry-pick ${tip.ok ? tip.out.trim() : branch}`,
    )
  }

  // PASS. Copy the plan out BEFORE anything is removed. The relocation is one-shot, keyed on
  // archivedAt exactly as archiveReviewLane keys it. archivedReport stays NULL when there was
  // nothing to copy — a tree that died before this read took its hand-off with it, and stamping a
  // path to a file that exists nowhere is worse than saying there is none.
  const archived = existsSync(reportPath) ? jPath.replace(/\.json$/, '-REPORT.md') : null
  let stamped = journal
  if (!journal.archivedAt) {
    if (archived) copyFileSync(reportPath, archived)
    stamped = { ...journal, archivedAt: new Date().toISOString(), archivedReport: archived }
    writeFileSync(jPath, JSON.stringify(stamped, null, 2) + '\n')
  }
  const removed = q(root, ['worktree', 'remove', '--force', wt])
  if (!removed.ok) {
    process.stderr.write(
      `roadmap codex: the plan is ${archived ? `archived at ${archived}` : 'gone with its hand-off (nothing to archive)'}, but its worktree ${wt} could NOT be removed — ${removed.out.trim()}\n`
        + `  No sweep verb will come back for it: finish by hand from ${root} — git worktree remove --force ${wt} && git branch -D ${branch} && git worktree prune\n`,
    )
    return { journal: stamped, archived }
  }
  // A branch that will not delete is a leak the caller would otherwise print "consumed" over.
  const del = q(root, ['branch', '-D', branch])
  if (!del.ok) {
    process.stderr.write(`roadmap codex: the plan lane was removed, but its branch ${branch} could NOT be deleted — ${del.out.trim()}\n`)
  }
  q(root, ['worktree', 'prune'])
  process.stderr.write(
    // `archived` is this read's copy; on a re-entry after a failed removal the earlier read's copy
    // is the honest answer, and reporting "nothing to archive" over it would be a lie.
    `roadmap codex: plan lane consumed — ${archived ?? stamped.archivedReport ? `plan archived at ${archived ?? stamped.archivedReport}` : `no ${LANES.plan.report} was left to archive`}`
      + `; worktree ${wt}${del.ok ? ` and branch ${branch}` : ''} disposed\n`,
  )
  return { journal: stamped, archived }
}

/**
 * The runnable next step for a terminal lane state, or null.
 *
 * A dead or finished lane printed its state and stopped there, so recovery was improvised every
 * time (the atlas arc hand-finished 9/9 quota deaths; "no resume verb" was the standing complaint).
 * Every verb below already existed — the state read simply never named one. STDERR only: stdout is
 * a parsed stream (the do-phase poll loop, the gate reconcile), so it may gain no key and no prose.
 *
 * Two states are deliberately silent. `running` has no next step — naming the relaunch invites a
 * double-run into a live worktree, which refuseIfLive exists to refuse, and naming the land invites
 * landing half a phase. The whole `review` lane is silent because its done-moment fires on this
 * very read (archiveReviewLane, above): a hint there would name a verb that has already run.
 *
 * The ids come from the JOURNAL, not from the poll: an arc lane launched as `222 223` and polled by
 * `223` must be relaunched with both, or the operator is handed a command that abandons 222.
 */
function nextStepHint(lane, state, journal, reportPath, root) {
  const ids = (journal.phases ?? []).map(String)
  const wt = journal.worktree
  if (lane === 'plan') {
    // A plan lane whose DIRECTORY died UNCONSUMED (a /tmp reaper, a hand rm before anyone read it)
    // has no CODEX-PLAN.md, so it can never read `complete` and can never reach the consume-close —
    // it lands here, as dead-no-report, and this is the only place an operator is told anything at
    // all. The answer is the report-only one the operator ruling allows and `roadmap audit` check 15
    // gives the same lane: prune the stale registration, and READ the surviving branch before
    // deleting it, because if the plan was never harvested those commits are its only copy.
    //
    // THREE conditions, each earned by a way this fired wrongly. `archivedAt` unset: a CONSUMED lane
    // has a missing directory too — the close on this very read removed it — and the hint then told
    // the operator to prune what was already pruned and read a branch that was just deleted, one
    // line under "plan lane consumed". `state !== 'running'`: a live group whose tree was swept is
    // still in flight, and surveyLanes asks this same prunable question only after liveness for
    // exactly that reason. `root`: the remedies are anchored at the primary checkout.
    if (wt && !existsSync(wt) && root && !journal.archivedAt && state !== 'running') {
      return `${wt} is gone, so this lane can never report its verdict — git -C ${root} worktree prune clears the stale registration; `
        + `read git -C ${root} log --oneline codex-plan/${ids.join('-')} before deleting that branch, since an unharvested plan lives only there`
    }
    if (state !== 'complete') return null
    // Only while the lane is still standing. A CONSUMED plan lane (this read closed it, or an
    // earlier one did) has no next step, and naming its own consume read would send an operator to
    // a done-moment that has already fired. A SLOT is the other lane the close will never take —
    // it refuses by design, so promising "then this read closes the lane" there is a hint that can
    // never come true, printed on every read forever.
    if (!wt || !existsSync(wt) || (root && isSlotDir(root, wt))) return null
    return `roadmap codex status ${ids.join(' ')} --plan — the plan lane's done-moment: harvest the phase file to the primary checkout, then this read closes the lane`
  }
  if (lane !== 'run' || ids.length === 0) return null
  const relaunch = `roadmap codex run ${ids.join(' ')}`
  if (state === 'complete') {
    // `phase land` resolves its checkout from cwd, so the cd is part of the command, not context.
    // ONE land, even for an arc lane covering several ids: landPhase moves the whole scratch head
    // (the phase number never scopes the commits) and then disposes the worktree, so a chained
    // second land would run from a deleted cwd — a hint that cannot finish is worse than none.
    if (!wt) return null
    return `cd ${wt} && roadmap phase land ${ids[0]}`
      + (ids.length > 1 ? `  (one land moves the whole lane head, covering ${ids.join(' ')})` : '')
  }
  if (state === 'dead-no-report') {
    return `${relaunch} — the lane died without a hand-off; the prompt's RESUME RULE skips tasks already done with a commit, and a previous report is preserved as its .prev twin rather than clobbered`
  }
  if (state === 'blocked') {
    return `read ${reportPath} for the question it stopped on, resolve it, then relaunch: ${relaunch} (the RESUME RULE skips the tasks it already finished)`
  }
  return null
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
    // A LANDED lane is not a missing one. Probe the archived twin before reporting a miss, or a
    // phase whose lane ran, landed and was cleaned up reads exactly like a phase that never ran.
    const closed = findClosedJournal(root, ids, lane)
    if (closed) {
      // `report: null`, never the journal's bare NAME: the run lane's report is an allowUntracked
      // artifact, so the land force-removed it with the worktree and there is no relocated copy
      // (unlike the review lane, whose verdict IS copied out). Naming a file that exists nowhere
      // is worse than saying there is none.
      process.stdout.write(
        JSON.stringify({ ...closed.journal, state: 'closed', alive: false, sentinel: null, report: null, journal: closed.path }, null, 2) + '\n',
      )
      return 0
    }
    // A journal sitting right there under another lane's prefix is the likeliest cause of this
    // miss; reporting only "none" sends the reader hunting for a run that never existed.
    // An unreadable journal in ANOTHER lane cannot prove coverage, and the miss being reported
    // is the message that matters — it must not be replaced by a hint's own failure.
    const covers = (l) => {
      try {
        return Boolean(findJournal(root, ids, l))
      } catch {
        return false
      }
    }
    const elsewhere = Object.keys(LANES).filter((l) => l !== lane && covers(l))
    // ONE runnable command per covering lane: the flags are alternatives, and concatenating them
    // yields a command whose lane selector silently takes the first match.
    const hint = elsewhere.length > 0
      ? ` — but ${elsewhere.length > 1 ? 'these lanes DO' : 'this lane DOES'} cover them: `
        + elsewhere.map((l) => `${l} → \`roadmap codex status ${ids.join(' ')}${LANES[l].flag ? ` ${LANES[l].flag}` : ''}\``).join(' · ')
      : ''
    process.stderr.write(`roadmap codex: no ${lane} journal covers phase(s) ${ids.join(',')} in ${join(root, '.building')}${hint}\n`)
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
  // The archived copy answers only once the worktree's own is GONE. Preferring it while both
  // exist would hand a refused-disposal lane the relocated path and quietly retire the resolved
  // worktree path every other reader (and the stale-report guard below) is written against; a
  // disposal that refused has changed nothing about where the live hand-off lives.
  const archived = j.archivedReport && !reportExists && existsSync(j.archivedReport) ? j.archivedReport : null
  const readFrom = fresh ? reportPath : archived
  const report = readFrom ? readFileSync(readFrom, 'utf8') : ''
  const sentinel = report.match(SENTINEL_RE)?.[0] ?? null
  const alive = j.pgid ? groupAlive(j.pgid) : false
  const state = sentinel === 'CODEX-RUN-COMPLETE' ? 'complete' : sentinel === 'CODEX-RUN-BLOCKED' ? 'blocked' : alive ? 'running' : 'dead-no-report'
  const staleReport = reportExists && !fresh ? reportPath : undefined
  // THE REVIEW LANE'S DONE-MOMENT. Keyed on the VERDICT (`state`), never on the file: a stale
  // sentinel the freshness guard just rejected must not archive a lane from behind, which would
  // delete a live reviewer's worktree out from under it.
  let journal = j
  let reported = readFrom
  if (lane === 'review' && state === 'complete' && (!j.archivedAt || existsSync(j.worktree))) {
    const done = archiveReviewLane(root, jPath, j, reportPath)
    journal = done.journal
    reported = existsSync(reportPath) ? reportPath : done.archived
  }
  // THE PLAN LANE'S DONE-MOMENT, keyed on the VERDICT, never on the file, so a stale sentinel the
  // freshness guard just rejected can never close a lane from behind. Unlike the review site this
  // enters on EVERY complete read: an already-consumed lane can still be carrying a branch that
  // failed to delete, and archivePlanLane's own first arm is what retries and re-reports it.
  if (lane === 'plan' && state === 'complete') {
    const done = archivePlanLane(root, jPath, j, reportPath)
    journal = done.journal
    if (done.archived) reported = existsSync(reportPath) ? reportPath : done.archived
  }
  // The journal spreads FIRST: `j.report` is the bare report NAME, so spreading it last would
  // overwrite both the path status resolved and the `null` that marks a stale report.
  process.stdout.write(JSON.stringify({ ...journal, state, alive, sentinel, report: reported ?? null, ...(staleReport ? { staleReport } : {}) }, null, 2) + '\n')
  const hint = nextStepHint(lane, state, journal, reportPath, root)
  if (hint) process.stderr.write(`next: ${hint}\n`)
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
  const flagValues = new Set(['--worktree', '--base', '--doc', '--focus', '--brief', '--arc'].flatMap((f) => (argv.indexOf(f) >= 0 ? [argv.indexOf(f) + 1] : [])))
  const ids = arcId ? arcPhases(root, arcId) : argv.slice(1).filter((a, i) => /^\d+$/.test(a) && !flagValues.has(i + 1))
  // Lane flags are ALTERNATIVES. First-match would silently drop the second one — the very trap
  // the status hint refuses to print as a single command.
  const laneFlags = Object.keys(LANES).filter((l) => LANES[l].flag && argv.includes(LANES[l].flag))
  if (laneFlags.length > 1) {
    process.stderr.write(
      `roadmap codex: ${laneFlags.map((l) => LANES[l].flag).join(' and ')} are alternatives, not a set — pass exactly one lane flag (or none for the run lane)\n`,
    )
    return 1
  }
  if (laneFlags.length === 1 && ['run', 'review', 'plan'].includes(sub) && laneFlags[0] !== sub) {
    process.stderr.write(
      `roadmap codex: the '${sub}' subcommand already selects its lane — ${LANES[laneFlags[0]].flag} contradicts it (lane flags select a lane for 'status' only)\n`,
    )
    return 1
  }
  const lane = laneFlags[0] ?? 'run'
  if (sub === 'run' && ids.length > 0) return runCodex(root, ids, argv)
  if (sub === 'review' && ids.length > 0) return reviewCodex(root, ids, argv)
  if (sub === 'plan' && ids.length > 0) return planCodex(root, ids, argv)
  if (sub === 'status' && ids.length > 0) return statusCodex(root, ids, lane)
  process.stderr.write(
    'roadmap codex: usage: roadmap codex run <N> [<N2>…] | run --arc <ID> [--worktree <path>] [--base <ref>]\n' +
      '                     roadmap codex review <N> [<N2>…] [--doc <path>] [--focus <text>] [--worktree <path>] [--base <ref>]\n' +
      '                     roadmap codex plan <N> --brief <path> [--worktree <path>] [--base <ref>]\n' +
      '                     roadmap codex status <N> [<N2>…] [--review|--plan] | status --arc <ID>\n',
  )
  return 1
}
