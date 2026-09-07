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
 * dependency install, per-task commits, its own gate). `plan` AUTHORS one, committing exactly one phase file.
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
 * hand-rolled launch (setsid + ad hoc sandbox flags + stdin prompt) kept tripping them. Every
 * hard-won invariant lives here instead (session lessons 2026-07-15/22):
 *  - direct CLI, binary, authority profiles and argv sourced from cli/lib/drivers.mjs (the ONE registry);
 *    bounded profiles use native controls, while isolated unsafe needs explicit parent authority and acknowledgement;
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
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { spawnNativeChild } from '../lib/native-child-process.mjs'
import { publishImmutableFile } from '../lib/sidecar.mjs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { randomUUID } from 'node:crypto'
import { gitToplevel } from '../lib/gitroot.mjs'
import { ConfigError, integrationRefOf, loadConfig, worktreeGcPolicyOf } from '../lib/config.mjs'
import { authorityProfileBounds, driverStamp, intersectAuthority, launchArgv, resolveDriver } from '../lib/drivers.mjs'
import { resolveGovernance } from '../lib/governance.mjs'
import { matchKeyFilesField } from '../lib/phasescan.mjs'
import { runWorktreeCleanup, worktreeCleanupOutcome, groupAlive, isSlotDir, listWorktrees, createWorktreeIdentity, registerWorktreeIdentity, removeWorktreeIdentity, registeredWorktreeIdentity, resolveWorktreeOwnership } from '../lib/worktree.mjs'
import {
  LANES, prevReportName, journalPath, journalDeclineReason,
  archiveCompletedLaneOutput, JournalUnreadableError, findJournal, findClosedJournal, writeJournal, writeJournalAtomic,
  classifyJournal, completionFingerprintOf, journalBindingDigestOf, journalBytesDigestOf,
  validateArchivedReviewCompletion, validateRetainedReviewCompletion, validateLaneCompletion, validatePlanArchiveCandidate,
} from '../lib/codex-journal.mjs'
import { roadmapRoot, roadmapRootRel } from '../lib/roadmap-root.mjs'
import { driverTrailer, mergePolicy, policyFromArg, policyToArg } from '../lib/roles.mjs'

// The journal mechanics live in cli/lib/codex-journal.mjs; `findJournal` alone is re-exported
// because codex.test.mjs pins it as a contract OF THIS MODULE — `codex status` and the gate
// reconcile must read the one lookup, and that pin is how a second copy stays impossible.
export { findJournal }

const SENTINEL_RE = /CODEX-RUN-(COMPLETE|BLOCKED)/


function authorityFromArgv(argv) {
  const pi = argv.indexOf('--parent-authority')
  if (pi < 0) throw new Error('parent authority is required: pass --parent-authority read-only|workspace-write|isolated-unsafe from the invoking operator context')
  const parentProfile = argv[pi + 1]
  let parentBounds
  try { parentBounds = authorityProfileBounds(parentProfile) } catch { throw new Error(`--parent-authority profile '${parentProfile ?? ''}' is unknown`) }
  const ri = argv.indexOf('--authority')
  const requestProfile = ri < 0 ? 'inherit' : argv[ri + 1]
  let requestedBounds
  try { requestedBounds = requestProfile === 'inherit' ? structuredClone(parentBounds) : authorityProfileBounds(requestProfile) } catch { throw new Error(`--authority profile '${requestProfile ?? ''}' is unknown`) }
  const effectiveUnsafe = requestProfile === 'isolated-unsafe' || (requestProfile === 'inherit' && parentProfile === 'isolated-unsafe')
  if (effectiveUnsafe && !argv.includes('--authorize-isolated-unsafe')) throw new Error('effective isolated-unsafe authority requires the separate --authorize-isolated-unsafe acknowledgement')
  const parent = { profile: parentProfile, bounds: parentBounds, provenance: { kind: 'explicit-operator-invocation', source: `--parent-authority ${parentProfile}` } }
  const request = { profile: requestProfile, bounds: requestedBounds, provenance: effectiveUnsafe ? { kind: 'explicit-user-authorization', source: '--authorize-isolated-unsafe' } : null }
  return intersectAuthority(parent, request)
}
function nativeAuthority(worktree, envelope) {
  const argv = launchArgv('codex', { worktree, authority: envelope })
  const bypass = envelope.effective.profile === 'isolated-unsafe'
  return { ...envelope, native: { driver: 'codex', runtime: { version: null, verified: false }, argv, enforcement: { filesystem: bypass ? 'bypass' : 'sandbox', network: bypass ? 'bypass' : 'sandbox-config', gitPush: 'semantic-only', externalWrites: 'semantic-only' }, limitations: ['gitPush and externalWrites are workflow constraints with no dedicated native enforcement; on-request approval exceptions remain possible, and argv evidence does not prove runtime enforcement'] } }
}

/**
 * Select the package manager solely from the package directory's committed lockfile — never a
 * which-probe of whatever happens to be installed on the host. THREE outcomes, which the callers
 * read apart: a recipe; `null` for a package dir carrying no lockfile (refuse, never guess a
 * manager); `undefined` for a dir that is not a package at all (skip it silently).
 */
export function detectInstaller(dir) {
  if (!existsSync(join(dir, 'package.json'))) return undefined

  const hasNpmLock = existsSync(join(dir, 'package-lock.json'))
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) {
    return {
      bin: 'pnpm',
      args: ['install', '--frozen-lockfile'],
      ...(hasNpmLock
        ? { reason: 'pnpm-lock.yaml takes precedence over package-lock.json because it is the stricter package-manager claim' }
        : {}),
    }
  }
  if (hasNpmLock) return { bin: 'npm', args: ['ci', '--no-audit', '--no-fund'] }
  return null
}

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
const ROADMAP_CLI = fileURLToPath(new URL('../../bin/roadmap.mjs', import.meta.url))
const COMMIT_GRAMMAR = 'COMMIT GRAMMAR (BINDING — attribution binds on `phase N —`): task `type(scope): phase N — N.X <what>`; gate fix `fix(scope): phase N gate RX — <what>`; state `docs(roadmap): phase N — <desc>`.'

/** The role bindings the run lane's fill-a-role override sends the driver to, same resolution. */
const ROLE_BINDINGS = fileURLToPath(new URL('../../MULTI-DRIVER.md', import.meta.url))

/**
 * The run lane's envelope: which phases, what this lane overrides, where the hand-off goes.
 * The protocol body stays in the skill and is read at run time, so every driver implements under
 * the same one — a per-lane copy would leave the scorecard's per-model cells comparing briefings
 * instead of models.
 */
export function buildPrompt(root, ids, { modelPolicy = { source: 'table' }, modelsArg = 'claude', reportName = LANES.run.report, laneModel = driverStamp(resolveDriver('codex')).model } = {}) {
  const phaseFiles = ids.map((n) => `${roadmapRootRel(root)}/phases/phase-${n}.phase.ts`)
  for (const f of phaseFiles) {
    if (!existsSync(join(root, f))) throw new Error(`phase file missing: ${f}`)
  }
  if (!existsSync(RUN_SKILL)) throw new Error(`run protocol missing: ${RUN_SKILL}`)
  if (!existsSync(ROLE_BINDINGS)) throw new Error(`role bindings missing: ${ROLE_BINDINGS}`)
  return [
    `Implement ${ids.length > 1 ? `${ids.length} roadmap phases` : 'ONE roadmap phase'} end-to-end as driver of record. Work ONLY in this worktree.`,
    '',
    `YOUR PROTOCOL IS A FILE — read it in full, first, before touching anything: ${RUN_SKILL}`,
    `PROTOCOL REFERENCES: ${dirname(RUN_SKILL)}/references/ — part of the protocol; read when directed. Follow it as written, end to end, including every part it hands to the driver rather than to a supervising session. This envelope only adds targets/overrides; on conflict, the protocol wins.`,
    `THE ROADMAP CLI: node ${ROADMAP_CLI} (bare \`roadmap\` may be absent from PATH — never assume it).`,
    COMMIT_GRAMMAR,
    '',
    `TARGETS — run once per phase, in order: ${phaseFiles.join(', ')}. Notes pre-make every decision; implement, never re-decide.`,
    '',
    'WHAT THIS LANE OVERRIDES — everything else in the protocol runs unchanged:',
    '- THIS WORKTREE ONLY. Never merge, never push, never switch branches, never touch the primary checkout or backlog.ts — the supervising session audits, integrates and cleans up. Stage explicit paths; never `git add -A` (siblings share this checkout).',
    '- CROSS-REPO PHASES: a plan naming paths in ANOTHER checkout (a different git toplevel) means what it says — commit the PRODUCT work in that other checkout on its current branch, while every roadmap-state commit (the phase file, gate artifacts) stays in THIS worktree. There too: stage explicit paths, never push, never merge, never switch branches.',
    '- RESUME: `done: true` plus its commit in git log is FINISHED — skip it; resume at the first unfinished task, never redo or amend.',
    `- SHARED HOST (~5 AI sessions on 16 GB — breaking these can freeze the box): wrap every suite / type-check / build as \`capbuild <cmd>\`; ${existsSync(join(root, 'scripts/test/run-tier.sh')) ? 'scoped tiers run EXACTLY `bash scripts/test/run-tier.sh <slot> <files…>`' : 'this consumer has NO scripts/test/run-tier.sh (checked at launch), so scoped tiers run the consumer\u2019s own bound test command from roadmap.config.json gateCommands, narrowed to the touched project, under capbuild — that substitution is PRE-RATIFIED here and is never an escalation'}; never pipe tier output through tail/head/grep; no dev servers; no full-suite run outside the gate slot naming one.`,
    `- End every commit with \`${driverTrailer(laneModel)}\`.`,
    '- NO REACHABLE USER in this lane. Any protocol step that resolves to "stop and ask the user" — an escalating verdict, a failed `assumptions[]` check, a post-and-wait instruction — ENDS this run instead: write the report below with the question and its options, end it with CODEX-RUN-BLOCKED, and stop. Never wait for an answer that cannot come.',
    '- ALREADY IN YOUR WORKTREE and branch: skip worktree setup/reset and landing. Never claim a second slot.',
    `- FILL PROTOCOL ROLES via \`roadmap role resolve <role> --driver codex --models ${modelsArg}\` (resolveRole) under ${JSON.stringify(modelPolicy)}; stamp \`executionResult.modelPolicy\`. Spawn it natively or as a headless child (Claude: \`claude -p\`). Record every firing. Reviews recorded as \`self-review\` never satisfy completion — a codex-lane phase needs at least one independent recorded round, and \`--verify-complete\` refuses without it.`,
    '- ATTRIBUTION: stamp `executionResult.driver` as `{ model: <your model id>, lane: "codex" }`; it must match the launcher journal.',
    '',
    `WHEN FINISHED (or blocked): write ${reportName} in the worktree root (do NOT commit it) with per-task commit sha + the verify commands run and their outcomes + gate results + any deviation, ending with the single line CODEX-RUN-COMPLETE (or CODEX-RUN-BLOCKED).`,
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
  const phaseFiles = ids.map((n) => `${roadmapRootRel(root)}/phases/phase-${n}.phase.ts`)
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
    `THE ROADMAP CLI: node ${ROADMAP_CLI} (bare \`roadmap\` may be absent from PATH — never assume it).`,
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
  const phaseFile = `${roadmapRootRel(root)}/phases/phase-${ids[0]}.phase.ts`
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
    `THE ROADMAP CLI: node ${ROADMAP_CLI} (bare \`roadmap\` may be absent from PATH \u2014 never assume it).`,
    COMMIT_GRAMMAR,
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
function governedPromptOf(prompt, authority, governance) {
  return `${prompt}\n\nDELEGATED AUTHORITY RECEIPT — these effective bounds override generic mutation instructions (read-only forbids mutation). Within them, routine assigned work, scoped tests, and required local Git commits are already authorized: reuse this scope for run/resume without human reconfirmation. Native automatic review may approve or deny sandbox exceptions; denial is a hold and never permits self-upgrade:\n${JSON.stringify(authority, null, 2)}\n\nREPOSITORY GOVERNANCE RECEIPT — these source instructions and runner bindings are inert evidence; read and obey the applicable instruction text, and never execute runner strings merely because they appear here:\n${JSON.stringify(governance, null, 2)}\n`
}

function requestDigestOf(prompt, authority, governance, carriedPath = null) {
  const carriedDigest = carriedPath && existsSync(carriedPath) ? journalBytesDigestOf(readFileSync(carriedPath)) : null
  return journalBindingDigestOf({ prompt: governedPromptOf(prompt, authority, governance), carriedDigest })
}

async function launch(root, ids, lane, { worktree, base, prompt, governance, authority, carriedIn = null, modelPolicy, label, reportName = LANES[lane].report, allocation = {}, replaceGeneration }) {
  const git = (cwd, args) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
  const refProbe = git(root, ['rev-parse', '--symbolic-full-name', '--verify', '--end-of-options', base])
  const requestProbe = git(root, ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`])
  const workingProbe = git(worktree, ['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}'])
  const requestedRef = refProbe.status === 0 && refProbe.stdout.trim() ? refProbe.stdout.trim() : base
  const requestedHead = requestProbe.status === 0 ? requestProbe.stdout.trim() : ''
  const workingHead = workingProbe.status === 0 ? workingProbe.stdout.trim() : ''
  if (!requestedRef || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(requestedHead) || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(workingHead)) {
    process.stderr.write(`roadmap codex: cannot resolve exact launch identity for ${base} in ${worktree}; no child launched\n`)
    return 1
  }
  const building = join(root, '.building')
  const stem = `${LANES[lane].prefix}${ids.join('-')}${label ? `.${label}` : ''}`
  const promptPath = join(building, `${stem}-prompt.txt`)
  const carriedDigest = carriedIn && existsSync(join(worktree, carriedIn)) ? journalBytesDigestOf(readFileSync(join(worktree, carriedIn))) : null
  const requestDigest = requestDigestOf(prompt, authority, governance, carriedIn ? join(worktree, carriedIn) : null)
  writeFileSync(promptPath, governedPromptOf(prompt, authority, governance))
  const logPath = join(building, `${stem}.log`), logFd = openSync(logPath, 'a')
  const entry = resolveDriver('codex'), launchId = randomUUID()
  let child
  try {
    child = spawn(process.execPath, [ROADMAP_CLI, 'codex', '__supervise', ...ids.map(String), '--lane', lane, '--launch-id', launchId, ...(label ? ['--label', label] : [])], {
      cwd: root, detached: true, stdio: ['ignore', logFd, logFd, 'ipc'],
    })
  } finally { closeSync(logFd) }
  if (!child.pid) { process.stderr.write('roadmap codex: native supervisor could not start; no journal was written\n'); return 1 }
  const supervisorReady = new Promise(ready => {
    let settled = false
    const finish = value => { if (!settled) { settled = true; ready(value) } }
    child.once('message', message => finish(message?.ready === launchId))
    child.once('error', () => finish(false)); child.once('exit', () => finish(false)); child.once('disconnect', () => finish(false))
  })
  const jPath = journalPath(root, ids, lane, { label })
  try {
    writeJournalAtomic(root, {
      phases: ids, lane, driver: driverStamp(entry), authority, governance,
      report: reportName, worktree, base, pgid: child.pid, log: logPath, prompt: promptPath,
      launchId, requestedRef, requestedHead, baseHead: requestedHead, workingHead,
      laneOwner: { kind: 'roadmap-codex', id: `${lane}:${ids.join('-')}` },
      ...(allocation.worktreeIdentity ? { worktreeIdentity: allocation.worktreeIdentity } : {}),
      ownerRoot: realpathSync(root), authorityDigest: journalBindingDigestOf(authority), governanceDigest: journalBindingDigestOf(governance), requestDigest, carriedDigest,
      ...(label ? { label } : {}), ...(modelPolicy ? { modelPolicy } : {}), ...(carriedIn ? { carriedIn } : {}), startedAt: new Date().toISOString(),
    }, { label, ...(replaceGeneration ? { replaceGeneration } : {}) })
    allocation.journalWritten = true
  } catch (error) {
    child.kill('SIGTERM'); if (child.connected) child.disconnect()
    process.stderr.write(`roadmap codex: journal publication refused; no native child launched: ${error.message}\n`)
    return 1
  }
  if (!await supervisorReady) { if (child.connected) child.disconnect(); return 1 }
  const sent = await new Promise(done => child.send({ launchId }, error => { if (child.connected) child.disconnect(); done(!error) }))
  if (!sent) return 1
  child.unref()
  const poll = `roadmap codex status ${ids[0]}${LANES[lane].flag ? ` ${LANES[lane].flag}` : ''}`
  process.stderr.write(`roadmap codex: launched pgid ${child.pid} in ${worktree} — journal ${jPath}, log ${logPath}. Poll: ${poll}\n`)
  return 0
}

export async function superviseLane(root, ids, lane, launchId, { label, beforeNativeLaunch, spawnNative = spawnNativeChild, cleanup = runWorktreeCleanup, archiveOutput = archiveCompletedLaneOutput, cleanupDeps = {} } = {}) {
  if (!['run', 'plan', 'review'].includes(lane) || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(launchId ?? '') || label !== undefined && (lane !== 'run' || !/^[a-z0-9]+$/.test(label) || label === 'closed')) return 1
  const path = journalPath(root, ids, lane, { label })
  let journal
  try { journal = JSON.parse(readFileSync(path, 'utf8')) } catch { return 1 }
  const rootReal = realpathSync(root)
  const worktreeReal = realpathSync(journal.worktree)
  const buildingReal = realpathSync(join(rootReal, '.building'))
  let promptReal
  let logReal
  try { promptReal = realpathSync(journal.prompt); logReal = realpathSync(journal.log) } catch { return 1 }
  if (journal.launchId !== launchId || journal.pgid !== process.pid || journal.lane !== lane
    || !isDeepStrictEqual(journal.phases, ids) || journal.ownerRoot !== rootReal
    || resolve(journal.worktree) !== worktreeReal
    || !promptReal.startsWith(`${buildingReal}/`) || !logReal.startsWith(`${buildingReal}/`)
    || journal.authorityDigest !== journalBindingDigestOf(journal.authority)
    || journal.governanceDigest !== journalBindingDigestOf(journal.governance)) {
    process.stderr.write('supervisor: initial identity refused\n'); return 1
  }
  const initialHead = spawnSync('git', ['-C', worktreeReal, 'rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}'], { encoding: 'utf8' })
  if (initialHead.status !== 0 || initialHead.stdout.trim() !== journal.workingHead
    || lane !== 'run' && journal.workingHead !== journal.requestedHead) { process.stderr.write('supervisor: prelaunch HEAD refused\n'); return 1 }
  if (journalDeclineReason(journal)) return 1
  const launchOwnership = value => {
    if (value.worktreeIdentity) return resolveWorktreeOwnership(root, value)
    try {
      // Omission cannot downgrade a registered allocation to legacy compatibility.
      if (registeredWorktreeIdentity(root, value.worktree, value.laneOwner)) return { state: 'refused' }
      return { state: 'legacy', identity: null }
    } catch { return { state: 'refused' } }
  }
  const ownership = launchOwnership(journal)
  if (!['owned', 'legacy'].includes(ownership.state)) { process.stderr.write('supervisor: worktree ownership refused\n'); return 1 }
  const entry = resolveDriver('codex')
  let effective
  try { effective = nativeAuthority(journal.worktree, journal.authority) } catch (error) { process.stderr.write(`supervisor: authority refused ${error.message}\n`); return 1 }
  const freeze = value => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value) }; return value }
  if (beforeNativeLaunch) await beforeNativeLaunch(freeze(structuredClone({ journal, identity: ownership.identity ?? null })))
  let reloaded
  try { reloaded = JSON.parse(readFileSync(path, 'utf8')) } catch { return 1 }
  if (!isDeepStrictEqual(reloaded, journal) || !isDeepStrictEqual(launchOwnership(reloaded), ownership)) { process.stderr.write('supervisor: launch-boundary identity changed\n'); return 1 }
  const finalHead = spawnSync('git', ['-C', worktreeReal, 'rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}'], { encoding: 'utf8' })
  if (finalHead.status !== 0 || finalHead.stdout.trim() !== journal.workingHead) { process.stderr.write('supervisor: launch-boundary HEAD changed\n'); return 1 }
  const logFd = openSync(journal.log, 'a')
  const promptFd = openSync(journal.prompt, 'r')
  const { completion } = spawnNative(entry.bin, effective.native.argv, {
    cwd: journal.worktree, detached: false, stdio: [promptFd, logFd, logFd],
  })
  closeSync(promptFd)
  closeSync(logFd)
  const outcome = await completion
  let current
  try { current = JSON.parse(readFileSync(path, 'utf8')) } catch { return 1 }
  if (current.launchId !== launchId || current.pgid !== process.pid) { process.stderr.write('supervisor: final identity refused\n'); return 1 }
  const actualHead = spawnSync('git', ['-C', current.worktree, 'rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}'], { encoding: 'utf8' })
  const finalized = {
    ...current, ...(actualHead.status === 0 ? { workingHead: actualHead.stdout.trim() } : {}),
    driverExit: outcome, finishedAt: new Date().toISOString(),
  }
  if (outcome.code !== 0) {
    writeJournalAtomic(root, finalized)
    await requestLaneCleanup(root, finalized, { cleanup, cleanupDeps })
    return outcome.code ?? 1
  }
  let report
  const reportPath = resolve(current.worktree, current.report ?? '')
  if (!reportPath.startsWith(`${worktreeReal}/`)) return 1
  try { report = readFileSync(reportPath) } catch {
    writeJournalAtomic(root, finalized)
    return 1
  }
  if (!/CODEX-RUN-COMPLETE/.test(report.toString('utf8'))) {
    writeJournalAtomic(root, finalized)
    return 1
  }
  if (actualHead.status !== 0) { process.stderr.write(`supervisor: HEAD refused ${actualHead.stderr}\n`); writeJournalAtomic(root, finalized); return 1 }
  const completed = { ...finalized, reportDigest: journalBytesDigestOf(report) }
  completed.completionFingerprint = completionFingerprintOf(completed)
  writeJournalAtomic(root, completed)
  return 0
}

function phaseTargets(root, ids) {
  const targets = []
  for (const id of ids) {
    const phaseFile = `${roadmapRootRel(root)}/phases/phase-${id}.phase.ts`
    targets.push(phaseFile)
    targets.push(...matchKeyFilesField(readFileSync(join(root, phaseFile), 'utf8')))
  }
  return targets
}

function governanceGate(root, targets, lane) {
  const receipt = resolveGovernance(root, targets)
  if (!receipt.hold) return receipt
  process.stderr.write(
    `roadmap codex: ${lane} governance hold (${receipt.hold.kind}) for ${receipt.hold.target}: ${receipt.hold.reason} — no child launched\n`,
  )
  return null
}

function governedPhaseTargets(root, ids, lane) {
  try {
    return phaseTargets(root, ids)
  } catch (error) {
    process.stderr.write(`roadmap codex: ${lane} governance hold (access-refused) for phase scope: ${error?.message ?? error} — no child launched\n`)
    return null
  }
}

/**
 * The shared worktree setup: a branch when the mission COMMITS (run, plan), detached when it only
 * reads (review), and dependency installation only where the mission needs the consumer's toolchain — the plan
 * act validates its phase file through the consumer's tsx. Returns 0 or an exit to propagate.
 */
function ensureWorktree(root, { worktree, base, branch, laneOwner }) {
  if (existsSync(worktree)) {
    try { return { status: 0, created: false, worktreeIdentity: registeredWorktreeIdentity(root, worktree, laneOwner) } }
    catch (error) { process.stderr.write(`roadmap codex: ownership refused: ${error.message}\n`); return { status: 1, created: false } }
  }
  const addArgs = branch ? [worktree, '-b', branch, base] : ['--detach', worktree, base]
  const wt = spawnSync('git', ['worktree', 'add', ...addArgs], { cwd: root, stdio: 'inherit' })
  if (wt.status !== 0) return { status: wt.status ?? 1, created: false }
  try {
    const identity = createWorktreeIdentity(root, worktree, { laneOwner, expectedBranch: branch ? 'refs/heads/' + branch : null })
    registerWorktreeIdentity(root, identity)
    return { status: 0, created: true, registered: true, worktreeIdentity: identity }
  } catch (error) {
    process.stderr.write(`roadmap codex: ownership registration refused; preserved unowned worktree ${worktree}: ${error.message}\n`)
    return { status: 1, created: true }
  }
}
function unwindAllocation(root, allocation) {
  if (!allocation.registered || allocation.journalWritten) return
  try {
    if (!removeWorktreeIdentity(root, allocation.worktreeIdentity)) process.stderr.write('roadmap codex: ownership unwind could not prove exact removal; worktree retained\n')
  } catch (error) { process.stderr.write(`roadmap codex: ownership unwind refused; worktree retained: ${error.message}\n`) }
}


function installersAvailable(root) {
  for (const dir of [root, join(root, 'web')]) {
    if (detectInstaller(dir) !== null) continue
    process.stderr.write(`roadmap codex: cannot select a package manager for ${dir}: commit pnpm-lock.yaml or package-lock.json; nothing was created\n`)
    return false
  }
  return true
}

function installWorktree(worktree) {
  const capbuild = spawnSync('which', ['capbuild']).status === 0
  for (const dir of [worktree, join(worktree, 'web')]) {
    const installer = detectInstaller(dir)
    if (installer === undefined) continue
    if (installer === null) {
      process.stderr.write(
        `roadmap codex: cannot select a package manager for ${dir}: commit pnpm-lock.yaml or package-lock.json — not launching\n`,
      )
      return 1
    }
    // An ambiguous dir resolved by precedence says so: silently picking one of two committed
    // lockfiles is the guess this seam exists to remove.
    if (installer.reason) process.stderr.write(`roadmap codex: ${dir} — ${installer.reason}\n`)
    const ci = capbuild
      ? spawnSync('capbuild', [installer.bin, ...installer.args], { cwd: dir, stdio: 'inherit' })
      : spawnSync(installer.bin, installer.args, { cwd: dir, stdio: 'inherit' })
    if (ci.status !== 0) {
      process.stderr.write(`roadmap codex: ${installer.bin} install failed in ${dir} — not launching\n`)
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

/** Prove a stale lane's carried input is safe to refresh before resetting its worktree. */
function carryRefreshPreflight(root, worktree, rel, requestedHead, journal) {
  if (!rel) return { ok: true, copy: false }
  const source = join(root, rel)
  const destination = join(worktree, rel)
  let sourceBytes
  try { sourceBytes = readFileSync(source) } catch (error) {
    return { ok: false, reason: `${rel} cannot be read from the primary checkout: ${error.message}` }
  }

  const gitCwd = existsSync(worktree) ? worktree : root
  const tree = spawnSync('git', ['-C', gitCwd, 'ls-tree', '-z', requestedHead, '--', rel])
  if (tree.status !== 0) return { ok: false, reason: `${rel} cannot be inspected at requested HEAD ${requestedHead}` }
  if (tree.stdout.length > 0) {
    const entry = tree.stdout.subarray(0, tree.stdout.indexOf(0)).toString('utf8')
    const match = entry.match(/^\d+ blob ([0-9a-f]{40,64})\t(.+)$/)
    if (!match || match[2] !== rel) return { ok: false, reason: `${rel} has an unsupported tracked entry at requested HEAD` }
    const blob = spawnSync('git', ['-C', gitCwd, 'cat-file', 'blob', match[1]])
    if (blob.status !== 0 || !blob.stdout.equals(sourceBytes)) {
      return { ok: false, reason: `${rel} is tracked at requested HEAD with bytes that differ from the requested carry-in` }
    }
    if (existsSync(destination)) {
      const tracked = spawnSync('git', ['-C', worktree, 'ls-files', '--error-unmatch', '--', rel], { stdio: 'ignore' })
      if (tracked.status !== 0) {
        let existingDigest
        try {
          if (!statSync(destination).isFile()) return { ok: false, reason: `${rel} is not a regular carried-input file` }
          existingDigest = journalBytesDigestOf(readFileSync(destination))
        } catch (error) {
          return { ok: false, reason: `${rel} cannot be verified in the existing lane: ${error.message}` }
        }
        if (journal.carriedIn !== rel || journal.carriedDigest !== existingDigest || !readFileSync(destination).equals(sourceBytes)) {
          return { ok: false, reason: `${rel} is not the exact owned untracked carry-in recorded by the prior lane` }
        }
        return { ok: true, copy: false, park: destination }
      }
    }
    return { ok: true, copy: false }
  }

  if (existsSync(destination)) {
    const tracked = spawnSync('git', ['-C', worktree, 'ls-files', '--error-unmatch', '--', rel], { stdio: 'ignore' })
    if (tracked.status === 0) return { ok: false, reason: `${rel} is tracked in the existing lane and cannot be refreshed as owned carry-in` }
    let existingDigest
    try {
      if (!statSync(destination).isFile()) return { ok: false, reason: `${rel} is not a regular carried-input file` }
      existingDigest = journalBytesDigestOf(readFileSync(destination))
    } catch (error) {
      return { ok: false, reason: `${rel} cannot be verified in the existing lane: ${error.message}` }
    }
    if (journal.carriedIn !== rel || journal.carriedDigest !== existingDigest) {
      return { ok: false, reason: `${rel} is not the exact owned untracked carry-in recorded by the prior lane` }
    }
  }
  return { ok: true, copy: true }
}

async function runCodex(root, ids, argv, authority) {
  const wi = argv.indexOf('--worktree')
  const bi = argv.indexOf('--base')
  const base = bi >= 0 ? argv[bi + 1] : 'develop'
  const worktree = wi >= 0 ? argv[wi + 1] : `${root}-codex-${ids.join('-')}`
  try { authority = nativeAuthority(worktree, authority) } catch (error) { process.stderr.write(`roadmap codex: authority hold — ${error.message}; no prompt, journal, worktree or child was created\n`); return 1 }
  const li = argv.indexOf('--label')
  const label = li >= 0 ? argv[li + 1] : undefined
  if (li >= 0 && (!label || !/^[a-z0-9]+$/.test(label) || label === 'closed')) {
    process.stderr.write('roadmap codex: --label needs lowercase letters/digits and cannot be closed\n')
    return 1
  }
  const reportName = label ? `CODEX-REPORT.${label}.md` : LANES.run.report
  const mi = argv.indexOf('--models')
  const modelsArg = mi >= 0 ? argv[mi + 1] : undefined
  if (mi >= 0 && (modelsArg === undefined || modelsArg.startsWith('--'))) {
    process.stderr.write('roadmap codex: --models needs a value\n')
    return 1
  }
  const building = join(root, '.building')
  const jPath = journalPath(root, ids, 'run', { label })

  const refused = refuseIfLive(root, ids, 'run', worktree, jPath, "; the prompt's resume rule skips already-done tasks")
  if (refused !== 0) return refused
  const targets = governedPhaseTargets(root, ids, 'run')
  if (!targets || !governanceGate(root, targets, 'run')) return 1
  let repoPolicy
  try {
    repoPolicy = loadConfig(root).modelPolicy
  } catch (error) {
    if (!(error instanceof ConfigError) || error.kind !== 'absent') throw error
  }
  let modelPolicy
  try {
    modelPolicy = mergePolicy(repoPolicy, mi >= 0 ? policyFromArg(modelsArg) : undefined)
  } catch (error) {
    process.stderr.write(`roadmap codex: ${error.message}\n`)
    return 1
  }
  const resolverArg = policyToArg(modelPolicy)
  mkdirSync(building, { recursive: true })
  if (!existsSync(worktree) && !installersAvailable(root)) return 1

  const made = ensureWorktree(root, { worktree, base, branch: `codex/${ids.join('-')}`, laneOwner: { kind: 'roadmap-codex', id: `run:${ids.join('-')}` } })
  if (made.status !== 0) return made.status
  try {
    const worktreeTargets = governedPhaseTargets(worktree, ids, 'run')
    if (!worktreeTargets) return 1
    const governance = governanceGate(worktree, worktreeTargets, 'run')
    if (!governance) return 1
    if (made.created) {
      const installed = installWorktree(worktree)
      if (installed !== 0) return installed
    }

    // buildPrompt can still throw (a renamed/renumbered phase file) — resolve it BEFORE
    // touching the previous run's hand-off, so a failed relaunch destroys no evidence.
    const prompt = buildPrompt(root, ids, { modelPolicy, modelsArg: resolverArg, reportName })
    preserveStaleReport(worktree, reportName)
    return await launch(root, ids, 'run', { worktree, base, prompt, governance, authority, modelPolicy, label, reportName, allocation: made })
  } finally { unwindAllocation(root, made) }
}

function exactLaneDecision(root, ids, lane, worktree, base, governance, authority, prompt, carriedPath = null, carriedRel = null, beforeReset = null) {
  let found
  try { found = findJournal(root, ids, lane) } catch (error) {
    process.stderr.write(`roadmap codex: ${lane} journal is unreadable; inspect it before relaunch — ${error.message}\n`)
    return { status: 1 }
  }
  if (!found) return { status: null, reset: false }
  const request = spawnSync('git', ['-C', root, 'rev-parse', '--verify', '--end-of-options', `${base}^{commit}`], { encoding: 'utf8' })
  const expected = {
    worktree, requestedRef: found.journal.requestedRef,
    requestedHead: request.status === 0 ? request.stdout.trim() : null,
    laneOwner: { kind: 'roadmap-codex', id: `${lane}:${ids.join('-')}` },
    authorityDigest: journalBindingDigestOf(authority), governanceDigest: journalBindingDigestOf(governance),
    requestDigest: requestDigestOf(prompt, authority, governance, carriedPath),
  }
  if (found.journal.completionFingerprint) {
    const completion = validateLaneCompletion(root, ids, lane, expected)
    if (completion.state === 'reusable' && found.journal.requestDigest === expected.requestDigest) {
      process.stderr.write(`roadmap codex: ${lane} completion already proves requested HEAD ${completion.requestedHead}; no native process started\n`)
      return { status: 0 }
    }
  }
  const reset = classifyJournal(root, ids, { lane, ...expected })
  if (reset.state !== 'stale-clean' || !reset.restartable) {
    process.stderr.write(`roadmap codex: ${lane} lane is ${reset.state} (${JSON.stringify(reset.evidence)}); inspect and resolve it before relaunch\n`)
    return { status: 1 }
  }
  if (resolve(worktree) === realpathSync(root) || isSlotDir(root, worktree)) {
    process.stderr.write(`roadmap codex: ${lane} stale reset refused for a primary or provisioned worktree\n`)
    return { status: 1 }
  }
  const carryRefresh = carryRefreshPreflight(root, worktree, carriedRel, request.stdout.trim(), found.journal)
  if (!carryRefresh.ok) {
    process.stderr.write(`roadmap codex: ${lane} stale reset refused: ${carryRefresh.reason}; inspect it\n`)
    return { status: 1 }
  }
  try { beforeReset?.() } catch (error) {
    process.stderr.write(`roadmap codex: ${lane} prior artifacts could not be preserved: ${error.message}; no reset performed\n`)
    return { status: 1 }
  }
  const parked = carryRefresh.park ? `${carryRefresh.park}.codex-preserved-${randomUUID()}` : null
  if (parked) renameSync(carryRefresh.park, parked)
  const moved = spawnSync('git', ['-C', worktree, 'reset', '--keep', request.stdout.trim()], { encoding: 'utf8' })
  if (moved.status !== 0) {
    if (parked) renameSync(parked, carryRefresh.park)
    process.stderr.write(`roadmap codex: ${lane} stale reset refused because the worktree could not be preserved; inspect it\n`)
    return { status: 1 }
  }
  if (parked) unlinkSync(parked)
  process.stderr.write(`roadmap codex: ${lane} stale-clean lane reset to requested HEAD ${request.stdout.trim()}\n`)
  return { status: null, reset: true, carryRefresh }
}

function freshExactWorktree(root, worktree, base, made) {
  if (made.created) return true
  if (resolve(worktree) === realpathSync(root) || isSlotDir(root, worktree)) return false
  let registered
  try { registered = listWorktrees(root) } catch (error) {
    process.stderr.write(`roadmap codex: cannot inspect registered worktrees: ${error.message}\n`)
    return false
  }
  const expected = spawnSync('git', ['-C', root, 'rev-parse', '--verify', '--end-of-options', `${base}^{commit}`], { encoding: 'utf8' })
  const actual = spawnSync('git', ['-C', worktree, 'rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}'], { encoding: 'utf8' })
  const clean = spawnSync('git', ['-C', worktree, 'status', '--porcelain=v1', '-z', '--untracked-files=all'], { encoding: 'utf8' })
  return clean.status === 0 && clean.stdout.length === 0 && registered.some(({ dir }) => resolve(dir) === realpathSync(worktree))
    && expected.status === 0 && actual.status === 0 && expected.stdout.trim() === actual.stdout.trim()
}

function archivedReviewRestart(root, ids, worktree, base, prompt, authority, carriedPath) {
  let found
  try { found = findJournal(root, ids, 'review') } catch (error) {
    process.stderr.write(`roadmap codex: review journal is unreadable; inspect it before relaunch — ${error.message}\n`)
    return { status: 1 }
  }
  if (!found?.journal.archivedAt) return { status: null, restart: null }
  const journal = found.journal
  const retained = existsSync(journal.worktree)
  const validate = retained ? validateRetainedReviewCompletion : validateArchivedReviewCompletion
  const prior = validate(root, ids, {
    worktree, requestedRef: journal.requestedRef, requestedHead: journal.requestedHead,
    laneOwner: { kind: 'roadmap-codex', id: `review:${ids.join('-')}` },
    authorityDigest: journalBindingDigestOf(authority), governanceDigest: journal.governanceDigest,
  })
  if (!prior.valid) {
    process.stderr.write(`roadmap codex: archived review is ${prior.state} (${JSON.stringify(prior.evidence)}); inspect it before relaunch\n`)
    return { status: 1 }
  }
  const requested = spawnSync('git', ['-C', root, 'rev-parse', '--verify', '--end-of-options', `${base}^{commit}`], { encoding: 'utf8' })
  if (requested.status !== 0 || !requested.stdout.trim()) {
    process.stderr.write(`roadmap codex: review requested ref ${base} cannot be resolved; archived evidence was preserved\n`)
    return { status: 1 }
  }
  const requestedHead = requested.stdout.trim()
  const newRequestDigest = requestDigestOf(prompt, authority, journal.governance, carriedPath)
  if (requestedHead === journal.requestedHead && newRequestDigest === journal.requestDigest) {
    process.stderr.write(`roadmap codex: archived review completion already proves requested HEAD ${requestedHead}; no native process started\n`)
    return { status: 0 }
  }
  if (requestedHead !== journal.requestedHead) {
    const advanced = spawnSync('git', ['-C', root, 'merge-base', '--is-ancestor', journal.requestedHead, requestedHead])
    if (advanced.status !== 0) {
      process.stderr.write('roadmap codex: repaired review ref is not descended from the archived request; archived evidence was preserved\n')
      return { status: 1 }
    }
  }
  return { status: null, restart: { ...found, requestedHead }, retained }
}

function preserveArchivedReviewRestart(restart) {
  const { path, journal } = restart
  if (typeof journal.launchId !== 'string' || journal.launchId.trim().length === 0) throw new Error('archived review launchId is missing or malformed')
  const prefix = path.replace(/\.json$/, `.prior.${encodeURIComponent(journal.launchId)}`)
  const artifacts = [
    [journal.archivedReport, `${prefix}.report.md`],
    [journal.prompt, `${prefix}.prompt.txt`],
    [path, `${prefix}.json`],
  ]
  for (const [from, to] of artifacts) {
    if (!from || !existsSync(from) || realpathSync(from) !== resolve(from)) throw new Error('prior review artifact is missing or noncanonical')
    const bytes = readFileSync(from)
    publishImmutableFile(to, bytes)
    if (realpathSync(to) !== resolve(to) || !readFileSync(to).equals(bytes)) throw new Error('prior review artifact conflicts')
  }
}

/**
 * The review lane. No branch and no dependency install: the mission never builds and never commits, so
 * the worktree is a detached read-only copy — isolation that costs a checkout, not an install.
 */
async function reviewCodex(root, ids, argv, authority) {
  const wi = argv.indexOf('--worktree')
  const bi = argv.indexOf('--base')
  const di = argv.indexOf('--doc')
  const fi = argv.indexOf('--focus')
  const base = bi >= 0 ? argv[bi + 1] : 'HEAD'
  const worktree = resolve(root, wi >= 0 ? argv[wi + 1] : `${root}-codex-review-${ids.join('-')}`)
  try { authority = nativeAuthority(worktree, authority) } catch (error) { process.stderr.write(`roadmap codex: authority hold — ${error.message}; no prompt, journal, worktree or child was created\n`); return 1 }
  const doc = repoRelative(root, di >= 0 ? argv[di + 1] : undefined, '--doc')
  const phaseScope = governedPhaseTargets(root, ids, 'review')
  if (!phaseScope) return 1
  const targets = [...phaseScope, ...(doc ? [doc] : [])]
  if (!governanceGate(root, targets, 'review')) return 1
  mkdirSync(join(root, '.building'), { recursive: true })
  const jPath = journalPath(root, ids, 'review')

  const refused = refuseIfLive(root, ids, 'review', worktree, jPath, ' — a review re-reads from scratch')
  if (refused !== 0) return refused

  // Resolve the prompt against the PRIMARY checkout before any worktree work, so a bad --doc
  // or a renumbered phase file fails loudly and destroys no previous hand-off.
  const focus = fi >= 0 ? argv[fi + 1] : undefined
  const prompt = buildReviewPrompt(root, ids, { doc, focus })

  const archived = archivedReviewRestart(root, ids, worktree, base, prompt, authority, doc ? join(root, doc) : null)
  if (archived.status !== null) return archived.status
  if (!existsSync(worktree) && doc) {
    const requested = spawnSync('git', ['-C', root, 'rev-parse', '--verify', '--end-of-options', `${base}^{commit}`], { encoding: 'utf8' })
    const carry = requested.status === 0
      ? carryRefreshPreflight(root, worktree, doc, requested.stdout.trim(), archived.restart?.journal ?? {})
      : { ok: false, reason: `requested ref ${base} cannot be resolved` }
    if (!carry.ok) {
      process.stderr.write(`roadmap codex: review carry-in refused: ${carry.reason}; no worktree or child created\n`)
      return 1
    }
  }

  const made = ensureWorktree(root, { worktree, base, branch: null, laneOwner: { kind: 'roadmap-codex', id: `review:${ids.join('-')}` } })
  if (made.status !== 0) return made.status
  try {
    const worktreeScope = governedPhaseTargets(worktree, ids, 'review')
    if (!worktreeScope) return 1
    const governance = governanceGate(worktree, [...worktreeScope, ...(doc ? [doc] : [])], 'review')
    if (!governance) return 1
    const decision = archived.restart && !archived.retained
      ? { status: null, reset: false }
      : exactLaneDecision(root, ids, 'review', worktree, base, governance, authority, prompt, doc ? join(root, doc) : null, doc,
        archived.restart ? () => preserveArchivedReviewRestart(archived.restart) : null)
    if (decision.status !== null) return decision.status
    if (!decision.reset && !freshExactWorktree(root, worktree, base, made)) {
      process.stderr.write('roadmap codex: review worktree is not a fresh registered checkout at the requested HEAD; refusing launch\n')
      return 1
    }
    if (!decision.reset && doc) {
      const requested = spawnSync('git', ['-C', root, 'rev-parse', '--verify', '--end-of-options', `${base}^{commit}`], { encoding: 'utf8' })
      const carry = requested.status === 0
        ? carryRefreshPreflight(root, worktree, doc, requested.stdout.trim(), archived.restart?.journal ?? {})
        : { ok: false, reason: `requested ref ${base} cannot be resolved` }
      if (!carry.ok) {
        process.stderr.write(`roadmap codex: review carry-in refused: ${carry.reason}; no child launched\n`)
        return 1
      }
    }
    let launchGovernance = governance
    if (decision.reset) {
      const refreshedScope = governedPhaseTargets(worktree, ids, 'review')
      launchGovernance = refreshedScope && governanceGate(worktree, [...refreshedScope, ...(doc ? [doc] : [])], 'review')
      if (!launchGovernance) return 1
    }
    if (archived.restart && !archived.retained) preserveArchivedReviewRestart(archived.restart)
    if (decision.reset && decision.carryRefresh?.copy) {
      mkdirSync(dirname(join(worktree, doc)), { recursive: true })
      copyFileSync(join(root, doc), join(worktree, doc))
    }
    carryIn(root, worktree, doc)
    preserveStaleReport(worktree, LANES.review.report)
    return await launch(root, ids, 'review', { worktree, base, prompt, governance: launchGovernance, authority, carriedIn: doc, allocation: made,
      replaceGeneration: archived.restart && !archived.retained && archived.restart.journal.worktreeIdentity ? archived.restart.journal : undefined })
  } finally { unwindAllocation(root, made) }
}

/**
 * The plan lane. A branch and an install like `run` (the plan act commits its phase file and
 * validates it through the consumer's tsx), but exactly one file may change and the number is
 * reserved before launch — the planner never picks its own.
 */
async function planCodex(root, ids, argv, authority) {
  const wi = argv.indexOf('--worktree')
  const bi = argv.indexOf('--base')
  const fi = argv.indexOf('--brief')
  const base = bi >= 0 ? argv[bi + 1] : 'develop'
  const worktree = resolve(root, wi >= 0 ? argv[wi + 1] : `${root}-codex-plan-${ids.join('-')}`)
  try { authority = nativeAuthority(worktree, authority) } catch (error) { process.stderr.write(`roadmap codex: authority hold — ${error.message}; no prompt, journal, worktree or child was created\n`); return 1 }
  const brief = repoRelative(root, fi >= 0 ? argv[fi + 1] : undefined, '--brief')
  const phaseFile = `${roadmapRootRel(root)}/phases/phase-${ids[0]}.phase.ts`
  const targets = [phaseFile, ...(brief ? [brief] : [])]
  if (!existsSync(worktree) && !installersAvailable(root)) return 1
  if (!governanceGate(root, targets, 'plan')) return 1
  mkdirSync(join(root, '.building'), { recursive: true })
  const jPath = journalPath(root, ids, 'plan')

  const refused = refuseIfLive(root, ids, 'plan', worktree, jPath, ' — a plan re-authors from scratch')
  if (refused !== 0) return refused

  // Resolve the prompt against the PRIMARY checkout before any worktree work, so a missing
  // --brief or a taken number fails loudly and destroys no previous hand-off.
  const prompt = buildPlanPrompt(root, ids, { brief })

  // --base may carry a phase file the primary checkout does not. Checked from the PRIMARY, before
  // the worktree and its dependency install, so a taken number costs no install and leaves no orphan branch.
  if (spawnSync('git', ['cat-file', '-e', `${base}:${phaseFile}`], { cwd: root }).status === 0) {
    process.stderr.write(
      `roadmap codex: ${phaseFile} already exists on ${base} — this lane authors a newly reserved number. `
        + 'Reserve a fresh one and re-run; editing an existing plan is a supervised act, not a detached one.\n',
    )
    return 1
  }

  if (!existsSync(worktree) && brief) {
    const requested = spawnSync('git', ['-C', root, 'rev-parse', '--verify', '--end-of-options', `${base}^{commit}`], { encoding: 'utf8' })
    const carry = requested.status === 0
      ? carryRefreshPreflight(root, worktree, brief, requested.stdout.trim(), {})
      : { ok: false, reason: `requested ref ${base} cannot be resolved` }
    if (!carry.ok) {
      process.stderr.write(`roadmap codex: plan carry-in refused: ${carry.reason}; no worktree or child created\n`)
      return 1
    }
  }

  const made = ensureWorktree(root, { worktree, base, branch: `codex-plan/${ids.join('-')}`, laneOwner: { kind: 'roadmap-codex', id: `plan:${ids.join('-')}` } })
  if (made.status !== 0) return made.status
  try {
    const governance = governanceGate(worktree, targets, 'plan')
    if (!governance) return 1
    const decision = exactLaneDecision(root, ids, 'plan', worktree, base, governance, authority, prompt, brief ? join(root, brief) : null, brief)
    if (decision.status !== null) return decision.status
    if (!decision.reset && !freshExactWorktree(root, worktree, base, made)) {
      process.stderr.write('roadmap codex: plan worktree is not a fresh registered checkout at the requested HEAD; refusing launch\n')
      return 1
    }
    if (!decision.reset && brief) {
      const requested = spawnSync('git', ['-C', root, 'rev-parse', '--verify', '--end-of-options', `${base}^{commit}`], { encoding: 'utf8' })
      const carry = requested.status === 0
        ? carryRefreshPreflight(root, worktree, brief, requested.stdout.trim(), {})
        : { ok: false, reason: `requested ref ${base} cannot be resolved` }
      if (!carry.ok) {
        process.stderr.write(`roadmap codex: plan carry-in refused: ${carry.reason}; no child launched\n`)
        return 1
      }
    }
    let launchGovernance = governance
    if (decision.reset) {
      launchGovernance = governanceGate(worktree, targets, 'plan')
      if (!launchGovernance) return 1
    }
    // Present here but NOT on base means a PREVIOUS run of this number authored it (refuseIfLive
    // relaunches over a dead one) — a different cause needing the opposite remedy.
    if (existsSync(join(worktree, phaseFile))) {
      process.stderr.write(
        `roadmap codex: ${phaseFile} already exists in ${worktree} but NOT on ${base} — a previous plan run of this number `
          + 'committed it. Inspect or harvest that commit; this lane never authors over a predecessor\'s output.\n',
      )
      return 1
    }
    if (made.created) {
      const installed = installWorktree(worktree)
      if (installed !== 0) return installed
    }
    if (decision.reset && decision.carryRefresh?.copy) {
      mkdirSync(dirname(join(worktree, brief)), { recursive: true })
      copyFileSync(join(root, brief), join(worktree, brief))
    }
    carryIn(root, worktree, brief)
    preserveStaleReport(worktree, LANES.plan.report)
    return await launch(root, ids, 'plan', { worktree, base, prompt, governance: launchGovernance, authority, carriedIn: brief, allocation: made })
  } finally { unwindAllocation(root, made) }
}

/** Terminal callers share selected cleanup; an unowned lane selects nothing and stays. */
async function requestLaneCleanup(root, journal, { cleanup = runWorktreeCleanup, cleanupDeps = {} } = {}) {
  try {
    const config = loadConfig(root), policy = { ...worktreeGcPolicyOf(config), integrationRef: integrationRefOf(config) }
    return await cleanup(root, { apply: policy.enabled, ownershipIds: journal.worktreeIdentity ? [journal.worktreeIdentity.ownershipId] : [], policy }, cleanupDeps)
  } catch (error) { return { state: 'held', reason: 'cleanup-unavailable', detail: error.message } }
}
function laneCleanupOutcome(result, journal) {
  return worktreeCleanupOutcome(result, journal.worktreeIdentity, journal.worktree)
}
async function consumeLaneOutput(root, jPath, journal, reportPath, { cleanup = runWorktreeCleanup, archiveOutput = archiveCompletedLaneOutput, cleanupDeps = {} } = {}) {
  const output = await archiveOutput(root, jPath, journal)
  let stamped = output.journal ?? journal, archived = output.archived ?? null
  // Legacy output may still be copied for the reader, but never unlinked or adopted.
  if (!journal.worktreeIdentity) {
    archived = journal.archivedReport ?? jPath.replace(/\.json$/, '-REPORT.md')
    if (!journal.archivedAt && existsSync(reportPath)) {
      copyFileSync(reportPath, archived)
      stamped = { ...journal, archivedAt: new Date().toISOString(), archivedReport: archived }
      writeJournalAtomic(root, stamped, { label: journal.label })
    }
  }
  const result = await requestLaneCleanup(root, stamped, { cleanup, cleanupDeps })
  const outcome = laneCleanupOutcome(result, stamped)
  process.stderr.write(`roadmap codex: ${journal.lane} output ${archived ? `archived at ${archived}` : 'retained'}; worktree ${outcome.removed ? 'removed' : `KEPT (${outcome.reason})`}\n`)
  return { journal: stamped, archived, cleanup: result }
}
async function archiveReviewLane(root, jPath, journal, reportPath, options = {}) {
  return consumeLaneOutput(root, jPath, journal, reportPath, options)
}

/** Consume a verified harvested plan before requesting the same conservative cleanup.
 * Content-equivalent harvest does not substitute for Git ancestry in the disposer. */
async function archivePlanLane(root, jPath, journal, reportPath, options = {}) {
  const wt = journal.worktree
  const ids = (journal.phases ?? []).map(String)
  const branch = `codex-plan/${ids.join('-')}`
  const base = journal.base ?? 'develop'
  const phaseFile = `${roadmapRootRel(root)}/phases/phase-${ids[0]}.phase.ts`
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

  // Re-entry uses the retained cleanup operation; no separate branch-deletion path.
  if (journal.archivedAt && !existsSync(wt)) {
    const result = await requestLaneCleanup(root, journal, options)
    return { journal, archived: journal.archivedReport ?? null, cleanup: result }
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
            + `inspect its report at ${join(wt, LANES.plan.report)} and run roadmap worktree gc --json from ${root}. `
          : '')
        + 'The harvest proof covers that one path, so anything else would ride out of the lane unproven; inspect the branch and land or drop the extra work by hand',
    )
  }

  // (c2) THE ENTITY ITSELF. Every guard above proves the lane is SPENT without ever opening the file
  // it authored, so a plan that does not parse — or that parses and breaks a phase rule — closes as
  // consumed. The question is put to the plugin's OWN validator, from the lane worktree whose
  // install:true toolchain serves the tsx bridge.
  //
  // The POSITION is load-bearing in both directions. AFTER the one-file invariant, because that
  // check's empty-diff arm is the only recovery a never-committed lane is ever given, and
  // validating first answers it with a parse error about a file that may not be there. BEFORE the
  // harvest proof, because that refusal hands over a runnable cherry-pick — running it for a plan
  // that does not validate is what puts the broken file on the integration ref.
  const validation = spawnSync('node', [ROADMAP_CLI, 'phase', 'validate', phaseFile], {
    cwd: wt,
    encoding: 'utf8',
  })
  if (validation.status !== 0) {
    const diagnostics = `${validation.stderr ?? ''}${validation.stdout ?? ''}`.trim()
      || validation.error?.message
      || `validator exited ${validation.status ?? 'without a status'} without diagnostics`
    // Exit 1 is the validator's TOOLCHAIN-MISSING code (cli/commands/phase.mjs), exit 2 a genuinely
    // invalid entity. A lane launched with --worktree over a pre-created dir never installs, so the
    // toolchain gap is reachable here — and blaming the authored file for it would send the operator
    // to rewrite a plan that is fine, with an `npm ci` instruction this phase exists to retire.
    return keep(
      validation.status === 1
        ? `the plan could not be VALIDATED here — the lane's toolchain is incomplete, which says nothing about the authored file:\n${diagnostics}`
        : `the plan lane authored a file that does not validate as a phase entity:\n${diagnostics}`,
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

  return consumeLaneOutput(root, jPath, journal, reportPath, options)
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
function relaunchAuthorityArgs(authority) {
  if (!authority) return null
  try {
    const derived = intersectAuthority(authority.parent, authority.request)
    if (!isDeepStrictEqual(derived.effective, authority.effective)) return null
    if (authority.parent.provenance?.kind !== 'explicit-operator-invocation') return null
    if (!isDeepStrictEqual(authority.parent.bounds, authorityProfileBounds(authority.parent.profile))) return null
    if (authority.request.profile !== 'inherit' && !isDeepStrictEqual(authority.request.bounds, authorityProfileBounds(authority.request.profile))) return null
    const args = [`--parent-authority ${authority.parent.profile}`]
    if (authority.request.profile !== 'inherit') args.push(`--authority ${authority.request.profile}`)
    if (derived.effective.profile === 'isolated-unsafe') {
      if (authority.request.provenance?.kind !== 'explicit-user-authorization') return null
      args.push('--authorize-isolated-unsafe')
    }
    return args.join(' ')
  } catch {
    return null
  }
}

/** Quote one recorded argument for the pasteable POSIX-shell recovery command. */
function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`
}

function relaunchContextArgs(journal) {
  if (typeof journal.worktree !== 'string' || journal.worktree.length === 0) return null
  if (typeof journal.base !== 'string' || journal.base.length === 0) return null

  const reportLabel = typeof journal.report === 'string'
    ? journal.report.match(/^CODEX-REPORT\.([a-z0-9]+)\.md$/)?.[1]
    : undefined
  if (journal.label != null && (typeof journal.label !== 'string' || !/^[a-z0-9]+$/.test(journal.label))) return null
  if (journal.label && reportLabel && journal.label !== reportLabel) return null
  if (journal.label && journal.report === 'CODEX-REPORT.md') return null
  const label = journal.label ?? reportLabel

  const args = [`--worktree ${shellQuote(journal.worktree)}`, `--base ${shellQuote(journal.base)}`]
  if (label) args.push(`--label ${shellQuote(label)}`)
  if (journal.modelPolicy) {
    try {
      args.push(`--models ${shellQuote(policyToArg(journal.modelPolicy))}`)
    } catch {
      return null
    }
  }
  return args.join(' ')
}

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
  const authorityArgs = relaunchAuthorityArgs(journal.authority)
  const contextArgs = relaunchContextArgs(journal)
  const replayableArgs = [contextArgs, authorityArgs].filter(Boolean).join(' ')
  const relaunch = contextArgs === null
    ? null
    : `roadmap codex run ${ids.join(' ')}${replayableArgs ? ` ${replayableArgs}` : ''}`
  const legacyAuthority = !authorityArgs ? ' \u2014 supply the current explicit parent authority with --parent-authority before relaunch; legacy journal evidence grants nothing' : ''
  const contextHold = 'relaunch held -- the recorded checkout context cannot be reconstructed; supply the current explicit worktree, base, label and model policy'
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
    return relaunch
      ? `${relaunch}${legacyAuthority} \u2014 the lane died without a hand-off; the prompt's RESUME RULE skips tasks already done with a commit, and a previous report is preserved as its .prev twin rather than clobbered`
      : contextHold
  }
  if (state === 'blocked') {
    return relaunch
      ? `read ${reportPath} for the question it stopped on, resolve it, then relaunch: ${relaunch}${legacyAuthority} (the RESUME RULE skips the tasks it already finished)`
      : `read ${reportPath} for the question it stopped on; ${contextHold}`
  }
  return null
}

export async function statusCodex(root, ids, lane = 'run', { cleanup = runWorktreeCleanup, archiveOutput = archiveCompletedLaneOutput, cleanupDeps = {} } = {}) {
  const cleanupOptions = { cleanup, archiveOutput, cleanupDeps }
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
      const cleanupResult = await requestLaneCleanup(root, closed.journal, cleanupOptions)
      // Closed output is readable only while its archived copy actually exists.
      process.stdout.write(
        JSON.stringify({ ...closed.journal, state: 'closed', alive: false, sentinel: null, report: closed.journal.archivedReport && existsSync(closed.journal.archivedReport) ? closed.journal.archivedReport : null, journal: closed.path, cleanup: cleanupResult }, null, 2) + '\n',
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
  const missionIds = Array.isArray(j.phases)
    && j.phases.every((phase) => typeof phase === 'string' && phase.length > 0)
    && ids.every((phase) => j.phases.includes(String(phase)))
    ? j.phases
    : ids.map(String)
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
  let sentinel = report.match(SENTINEL_RE)?.[0] ?? null
  const alive = j.pgid ? groupAlive(j.pgid) : false
  if ((lane === 'plan' || lane === 'review') && sentinel === 'CODEX-RUN-COMPLETE' && alive) {
    process.stdout.write(JSON.stringify({ ...j, state: 'live', alive: true, sentinel: null, report: null }, null, 2) + '\n')
    process.stderr.write(`roadmap codex: exact completion is still live (pgid ${j.pgid}); wait for the supervised driver to exit before reuse\n`)
    return 3
  }
  const exactBound = j.requestedHead && j.workingHead && j.laneOwner && j.authorityDigest
    && j.governanceDigest && j.requestDigest && j.reportDigest && j.completionFingerprint
  if ((lane === 'plan' || lane === 'review') && sentinel === 'CODEX-RUN-COMPLETE' && !exactBound) {
    process.stdout.write(JSON.stringify({
      ...j, state: 'legacy-evidence', alive: false, sentinel: null, report: readFrom ?? null,
      legacyEvidence: { report: readFrom ?? null, claimedSentinel: sentinel },
    }, null, 2) + '\n')
    process.stderr.write(`roadmap codex: this ${lane} report is unbound historical evidence, not fresh completion proof; inspect the existing authored work or start a fresh owned ${lane} with the already-approved authority scope\n`)
    return 2
  }
  if ((lane === 'plan' || lane === 'review') && sentinel === 'CODEX-RUN-COMPLETE') {
    const request = spawnSync('git', ['-C', root, 'rev-parse', '--verify', '--end-of-options', `${j.requestedRef}^{commit}`], { encoding: 'utf8' })
    let currentGovernance = j.governance
    if (existsSync(j.worktree)) {
      try { currentGovernance = resolveGovernance(j.worktree, j.governance?.targets ?? []) } catch {}
    }
    const completion = validateLaneCompletion(root, missionIds, lane, {
      worktree: j.worktree, requestedRef: j.requestedRef,
      requestedHead: request.status === 0 ? request.stdout.trim() : null,
      laneOwner: { kind: 'roadmap-codex', id: `${lane}:${missionIds.join('-')}` },
      authorityDigest: journalBindingDigestOf(j.authority),
      governanceDigest: currentGovernance ? journalBindingDigestOf(currentGovernance) : null,
    })
    if (completion.state !== 'reusable') {
      let refusal = completion
      if (lane === 'plan' && completion.state === 'diverged' && completion.evidence?.reason === 'request-mismatch') {
        const archive = validatePlanArchiveCandidate(root, missionIds, j)
        if (!archive.valid) refusal = archive
        if (archive.valid) {
          const consumed = await archivePlanLane(root, jPath, j, archive.reportPath, cleanupOptions)
          if (consumed.journal.archivedAt && consumed.archived && existsSync(consumed.archived)) {
            process.stdout.write(JSON.stringify({
              ...consumed.journal, state: 'historical-plan-consumed', alive: false, sentinel: null,
              report: consumed.archived ?? consumed.journal.archivedReport ?? null,
              freshForRequestedHead: false, originalRequestedHead: archive.originalRequestedHead,
              worktreeRetained: existsSync(j.worktree), cleanup: consumed.cleanup ?? null,
              currentRequestedHead: request.status === 0 ? request.stdout.trim() : null,
            }, null, 2) + '\n')
            return 0
          }
        }
      }
      sentinel = null
      process.stdout.write(JSON.stringify({
        ...j, state: refusal.state, alive: refusal.state === 'live',
        pgid: refusal.evidence?.pgid ?? j.pgid, sentinel: null, report: null, completion: refusal,
      }, null, 2) + '\n')
      const refusalEvidence = refusal.evidence ? `; evidence ${JSON.stringify(refusal.evidence)}` : ''
      process.stderr.write(`roadmap codex: exact completion ${refusal.state}${refusalEvidence}; inspect and resolve this lane before relaunch or reuse\n`)
      return 2
    }
  }
  const state = sentinel === 'CODEX-RUN-COMPLETE' ? 'complete' : sentinel === 'CODEX-RUN-BLOCKED' ? 'blocked' : alive ? 'running' : 'dead-no-report'
  const staleReport = reportExists && !fresh ? reportPath : undefined
  // THE REVIEW LANE'S DONE-MOMENT. Keyed on the VERDICT (`state`), never on the file: a stale
  // sentinel the freshness guard just rejected must not archive a lane from behind, which would
  // delete a live reviewer's worktree out from under it.
  let journal = j
  let reported = readFrom
  if (lane === 'review' && state === 'complete' && (!j.archivedAt || existsSync(j.worktree))) {
    const done = await archiveReviewLane(root, jPath, j, reportPath, cleanupOptions)
    journal = done.journal
    reported = existsSync(reportPath) ? reportPath : done.archived
  }
  // THE PLAN LANE'S DONE-MOMENT, keyed on the VERDICT, never on the file, so a stale sentinel the
  // freshness guard just rejected can never close a lane from behind. Unlike the review site this
  // enters on EVERY complete read: an already-consumed lane can still be carrying a branch that
  // failed to delete, and archivePlanLane's own first arm is what retries and re-reports it.
  if (lane === 'plan' && state === 'complete') {
    const done = await archivePlanLane(root, jPath, j, reportPath, cleanupOptions)
    journal = done.journal
    if (done.archived) reported = existsSync(reportPath) ? reportPath : done.archived
  }
  const cleanupResult = !alive && (lane === 'run' || state !== 'complete') ? await requestLaneCleanup(root, journal, cleanupOptions) : null
  // The journal spreads FIRST: `j.report` is the bare report NAME, so spreading it last would
  // overwrite both the path status resolved and the `null` that marks a stale report.
  process.stdout.write(JSON.stringify({ ...journal, state, alive, sentinel, report: reported ?? null, ...(staleReport ? { staleReport } : {}), ...(cleanupResult ? { cleanup: cleanupResult } : {}) }, null, 2) + '\n')
  const hint = nextStepHint(lane, state, journal, reportPath, root)
  if (hint) process.stderr.write(`next: ${hint}\n`)
  return state === 'complete' ? 0 : state === 'running' ? 3 : 2
}

/** --arc <ID>: resolve the arc's member phases (planes order) so a whole arc delegates as one run. */
function arcPhases(root, arcId) {
  const src = readFileSync(join(roadmapRoot(root), 'arcs', `${arcId}.arc.ts`), 'utf8')
  const ids = [...src.matchAll(/phases:\s*\[([\d,\s]+)\]/g)].flatMap((m) => m[1].match(/\d+/g) ?? [])
  if (ids.length === 0) throw new Error(`no member phases found in arc ${arcId}`)
  return ids
}

export default async function run(argv) {
  const sub = argv[0]
  const ai = argv.indexOf('--arc')
  const root = gitToplevel(process.cwd())
  if (sub === '__supervise') {
    const li = argv.indexOf('--lane')
    const xi = argv.indexOf('--launch-id')
    const lane = li >= 0 ? argv[li + 1] : undefined
    const launchId = xi >= 0 ? argv[xi + 1] : undefined
    const labelIndex = argv.indexOf('--label')
    const label = labelIndex >= 0 ? argv[labelIndex + 1] : undefined
    const flagValues = new Set([li + 1, xi + 1, ...(labelIndex >= 0 ? [labelIndex + 1] : [])])
    const ids = argv.filter((value, index) => index > 0 && !flagValues.has(index) && /^\d+$/.test(value))
    const started = await new Promise((resolveStart) => {
      process.once('disconnect', () => resolveStart(false))
      process.once('message', (message) => resolveStart(message?.launchId === launchId))
      process.send?.({ ready: launchId })
    })
    return started ? superviseLane(root, ids, lane, launchId, { label }) : 1
  }
  const arcId = ai >= 0 ? argv[ai + 1] : undefined
  if (ai >= 0 && (!arcId || arcId.startsWith('--') || !existsSync(join(roadmapRoot(root), 'arcs', `${arcId}.arc.ts`)))) {
    process.stderr.write(`roadmap codex: --arc needs a valid arc id (${roadmapRootRel(root)}/arcs/<ID>.arc.ts not found for '${arcId ?? ''}')\n`)
    return 1
  }
  // A flag's VALUE must never be read as a phase id (`--base 719` is a ref, not a phase).
  const flagValues = new Set(['--worktree', '--base', '--doc', '--focus', '--brief', '--arc', '--models', '--label', '--parent-authority', '--authority'].flatMap((f) => (argv.indexOf(f) >= 0 ? [argv.indexOf(f) + 1] : [])))
  // BEFORE the member list is resolved: arcPhases throws on an arc file with no parseable
  // `phases:`, and a traceback is the exact outcome this refusal exists to replace.
  if (sub === 'plan' && arcId) {
    let members = []
    try {
      members = arcPhases(root, arcId)
    } catch {
      // an unreadable member list changes nothing about WHY this is refused
    }
    process.stderr.write(
      'roadmap codex: plan --arc is not a detached lane mission: arc planning is a supervised act because the plan-arc design-first gate needs the user. '
        + 'Reserve each member number, write one brief per member, then delegate separately:\n'
        + (members.length > 0
          ? members.map((id) => `  node ${ROADMAP_CLI} codex plan ${id} --brief <path>`).join('\n')
          : `  node ${ROADMAP_CLI} codex plan <N> --brief <path>   (per reserved member of ${arcId})`)
        + '\n',
    )
    return 1
  }
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
  let authority
  if (['run', 'review', 'plan'].includes(sub) && ids.length > 0) {
    try { authority = authorityFromArgv(argv) }
    catch (error) { process.stderr.write(`roadmap codex: authority hold — ${error.message}; no prompt, journal, worktree or child was created\n`); return 1 }
  }
  if (sub === 'run' && ids.length > 0) return runCodex(root, ids, argv, authority)
  if (sub === 'review' && ids.length > 0) return reviewCodex(root, ids, argv, authority)
  if (sub === 'plan' && ids.length > 0) return planCodex(root, ids, argv, authority)
  if (sub === 'status' && ids.length > 0) return statusCodex(root, ids, lane)
  process.stderr.write(
    'roadmap codex: usage: roadmap codex run <N> [<N2>…] | run --arc <ID> [--worktree <path>] [--base <ref>]\n' +
      '                     roadmap codex review <N> [<N2>…] [--doc <path>] [--focus <text>] [--worktree <path>] [--base <ref>]\n' +
      '                     roadmap codex plan <N> --brief <path> [--worktree <path>] [--base <ref>]\n' +
      '                     roadmap codex status <N> [<N2>…] [--review|--plan] | status --arc <ID>\n',
  )
  return 1
}
