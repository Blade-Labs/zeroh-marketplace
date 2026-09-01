#!/usr/bin/env node
/**
 * WIRED tests for `roadmap codex status` + the launch path's stale-report clearing.
 *
 * The stale-sentinel bug (2026-08-11): a relaunch reused the previous run's worktree, and
 * `codex status` read the OLD CODEX-REPORT.md's sentinel as the live run's verdict — a
 * working run polled "blocked". Two defenses, both tested here:
 *   - status trusts a report only when its mtime is >= the journal's startedAt (older = a
 *     previous run's hand-off, surfaced as staleReport, never as the verdict);
 *   - `codex run` deletes any existing CODEX-REPORT.md before spawning (the report is never
 *     committed, so the launching run owns the file).
 *
 * The review- and plan-lane tests below pin the property that makes three lanes safe to share
 * one command: separate journals, prompts and report names, so lanes can never read each other's
 * verdict — plus the read-only mission rules, which are the only thing standing between an
 * unsandboxed Codex and the plans it reviews.
 *
 * Hermetic-tmp-git-repo pattern from cli/commands/claim.test.mjs; the launch-path tests put a
 * fake `codex` executable on PATH and pre-make the worktree so nothing real launches.
 *
 * Run: node --test cli/commands/codex.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmodSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, existsSync, realpathSync, statSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DRIVERS } from '../lib/drivers.mjs'
import { findJournal as mod_findJournal } from './codex.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const BIN = join(HERE, '..', '..', 'bin', 'roadmap.mjs')

const cleanups = []
process.on('exit', () => cleanups.forEach((fn) => fn()))

function tmpRepo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'codex-test-')))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  execFileSync('git', ['init', '-q'], { cwd: root })
  mkdirSync(join(root, '.building'), { recursive: true })
  return root
}

function writeJournal(root, ids, extra = {}) {
  const worktree = join(root, `wt-${ids.join('-')}`)
  mkdirSync(worktree, { recursive: true })
  const j = {
    phases: ids.map(String),
    worktree,
    base: 'develop',
    pgid: 999999999, // never a live group
    log: join(root, '.building', 'x.log'),
    startedAt: new Date().toISOString(),
    ...extra,
  }
  writeFileSync(join(root, '.building', `codex-${ids.join('-')}.json`), JSON.stringify(j) + '\n')
  return j
}

function status(root, id) {
  const r = spawnSync('node', [BIN, 'codex', 'status', String(id)], { cwd: root, encoding: 'utf8' })
  return { code: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr }
}

/** Backdate a file to well before any startedAt written in this test run. */
function backdate(path) {
  const old = (Date.now() - 3600_000) / 1000
  utimesSync(path, old, old)
}

test('stale sentinel: a report older than startedAt is NOT the verdict (dead run)', () => {
  const root = tmpRepo()
  const j = writeJournal(root, [42])
  const report = join(j.worktree, 'CODEX-REPORT.md')
  writeFileSync(report, 'old hand-off\nCODEX-RUN-BLOCKED\n')
  backdate(report)
  const { code, out } = status(root, 42)
  assert.equal(out.state, 'dead-no-report', 'a stale sentinel must not read as blocked')
  assert.equal(out.report, null)
  assert.equal(out.staleReport, report, 'the stale report is surfaced, not silently ignored')
  assert.equal(code, 2)
})

test('stale sentinel: a live relaunch over a stale report reads running', () => {
  const root = tmpRepo()
  // A real detached process group standing in for the live run.
  const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' })
  child.unref()
  cleanups.push(() => {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {}
  })
  const j = writeJournal(root, [43], { pgid: child.pid })
  const report = join(j.worktree, 'CODEX-REPORT.md')
  writeFileSync(report, 'previous run\nCODEX-RUN-BLOCKED\n')
  backdate(report)
  const { code, out } = status(root, 43)
  assert.equal(out.state, 'running', 'alive group + stale report = running, never blocked')
  assert.equal(out.alive, true)
  assert.equal(code, 3)
})

test('fresh report: sentinel written after launch is the verdict', () => {
  const root = tmpRepo()
  const j = writeJournal(root, [44], { startedAt: new Date(Date.now() - 60_000).toISOString() })
  writeFileSync(join(j.worktree, 'CODEX-REPORT.md'), 'done\nCODEX-RUN-COMPLETE\n')
  const { code, out } = status(root, 44)
  assert.equal(out.state, 'complete')
  assert.equal(out.report, join(j.worktree, 'CODEX-REPORT.md'))
  assert.equal(code, 0)
})

test('codex run preserves a leftover CODEX-REPORT.md as .prev before launching', () => {
  const root = tmpRepo()
  // Phase file so buildPrompt resolves; premade worktree so no git-worktree/npm-ci runs.
  mkdirSync(join(root, 'roadmap', 'phases'), { recursive: true })
  writeFileSync(join(root, 'roadmap', 'phases', 'phase-45.phase.ts'), 'export default {}\n')
  const j = writeJournal(root, [45]) // dead pgid → relaunch path
  const report = join(j.worktree, 'CODEX-REPORT.md')
  writeFileSync(report, 'previous run\nCODEX-RUN-BLOCKED\n')
  // Fake `codex` on PATH: exits immediately, launches nothing real.
  const fakeBin = join(root, 'fakebin')
  mkdirSync(fakeBin)
  writeFileSync(join(fakeBin, 'codex'), '#!/bin/sh\nexit 0\n')
  chmodSync(join(fakeBin, 'codex'), 0o755)
  const r = spawnSync('node', [BIN, 'codex', 'run', '45', '--worktree', j.worktree], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
  })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(!existsSync(report), 'the stale report must be moved aside at launch')
  assert.ok(existsSync(join(j.worktree, 'CODEX-REPORT.prev.md')), 'the hand-off is preserved, never deleted')
  assert.match(r.stderr, /preserved the previous run's CODEX-REPORT\.md/)
})

test('a relaunch whose phase file is missing destroys no evidence', () => {
  const root = tmpRepo()
  // No roadmap/phases/phase-48.phase.ts — buildPrompt throws.
  const j = writeJournal(root, [48])
  const report = join(j.worktree, 'CODEX-REPORT.md')
  writeFileSync(report, 'previous run\nCODEX-RUN-BLOCKED\n')
  const r = spawnSync('node', [BIN, 'codex', 'run', '48', '--worktree', j.worktree], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.notEqual(r.status, 0)
  assert.ok(existsSync(report), 'a failed relaunch must leave the previous hand-off untouched')
})

test('a LIVE run under a different journal id refuses a launch into the same worktree', () => {
  const root = tmpRepo()
  const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' })
  child.unref()
  cleanups.push(() => {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {}
  })
  const j = writeJournal(root, [50, 51], { pgid: child.pid }) // an arc journal, alive
  const report = join(j.worktree, 'CODEX-REPORT.md')
  writeFileSync(report, 'live run in progress\n')
  mkdirSync(join(root, 'roadmap', 'phases'), { recursive: true })
  writeFileSync(join(root, 'roadmap', 'phases', 'phase-50.phase.ts'), 'export default {}\n')
  const r = spawnSync('node', [BIN, 'codex', 'run', '50', '--worktree', j.worktree], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.equal(r.status, 2, r.stderr)
  assert.match(r.stderr, /LIVE run .* in this worktree — refusing/)
  assert.ok(existsSync(report), "the live run's report is untouched")
})

test('a journal with a malformed startedAt trusts the report', () => {
  const root = tmpRepo()
  const j = writeJournal(root, [47], { startedAt: 'not-a-date' })
  writeFileSync(join(j.worktree, 'CODEX-REPORT.md'), 'done\nCODEX-RUN-COMPLETE\n')
  const { code, out } = status(root, 47)
  assert.equal(out.state, 'complete', 'an unparseable startedAt must not eat a real verdict')
  assert.equal(code, 0)
})

test('the lane prompt carries the cross-repo instruction', () => {
  const root = tmpRepo()
  mkdirSync(join(root, 'roadmap', 'phases'), { recursive: true })
  writeFileSync(join(root, 'roadmap', 'phases', 'phase-46.phase.ts'), 'export default {}\n')
  const j = writeJournal(root, [46])
  const fakeBin = join(root, 'fakebin')
  mkdirSync(fakeBin)
  writeFileSync(join(fakeBin, 'codex'), '#!/bin/sh\nexit 0\n')
  chmodSync(join(fakeBin, 'codex'), 0o755)
  const r = spawnSync('node', [BIN, 'codex', 'run', '46', '--worktree', j.worktree], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
  })
  assert.equal(r.status, 0, r.stderr)
  const prompt = execFileSync('cat', [join(root, '.building', 'codex-46-prompt.txt')], { encoding: 'utf8' })
  assert.match(prompt, /CROSS-REPO PHASES/, 'the cross-repo rule ships in every lane prompt')
  assert.match(prompt, /roadmap-state commit .*stays in THIS worktree/i)
})

// ── run lane: the mission DELIVERS do-phase, it never restates it ─────────────
// Mirrors the review lane below, and matters for the same reason: the eval scorecard slices
// `drivers` by model, so a per-lane PARAPHRASE of do-phase turns those cells into a comparison of
// BRIEFINGS rather than of models — silently, because the confound never reaches the output. A
// delegated run must read the same protocol an inline one does, from the same file.

/** The run lane's protocol, resolved the way codex.mjs must resolve it (plugin-move follows). */
const DO_PHASE_SKILL = join(HERE, '..', '..', 'skills', 'do-phase', 'SKILL.md')

/**
 * Strings do-phase/SKILL.md OWNS — protocol BODY, never this lane's disposition:
 *  - `PRIME RULE 1` / `PROCEED_WITH_FIX` / `ESCALATE_TO_USER` — the architect-escalation rails and
 *    the Decision Contract verdict tokens: WHEN to escalate and what the verdicts mean is identical
 *    for every driver, so a second copy is a second protocol.
 *  - `transparencyReport` / `decisionRef` / `roadmap eval lesson` — the per-task transparency
 *    contract, the ratification ref a non-"None" debt line requires, and the lesson flush.
 *  - `Commit grammar (BINDING` — the CLI PARSES those subjects; the grammar belongs where the
 *    parser's contract is documented, not in one launcher's briefing.
 *  - `roadmap gate plan <N>` / `--record-round` — the gate protocol and its recorded rounds.
 *  - `roadmap phase curate <N>` — the curate step and its foreign-commit fallback.
 *  - `guard-mutation-proof.md` — the guard-mutation-proof rule (a references/ sibling).
 *  - `codex-self-review` — the label is defined by the skill's OWN delegation section.
 * Lane material by contrast (asserted present further down): worktree discipline, the resume rule,
 * the cross-repo instruction, the shared-host capbuild rules, the CODEX-REPORT.md hand-off.
 */
const DO_PHASE_OWNED = [
  'PRIME RULE 1',
  'PROCEED_WITH_FIX',
  'ESCALATE_TO_USER',
  'transparencyReport',
  'decisionRef',
  'roadmap eval lesson',
  'Commit grammar (BINDING',
  'roadmap gate plan <N>',
  '--record-round',
  'roadmap phase curate <N>',
  'guard-mutation-proof.md',
  'codex-self-review',
]

test('run: the mission DELIVERS do-phase by path, references included', () => {
  const root = tmpRepo()
  writePhase(root, 80)
  const worktree = join(root, 'wt-run-80')
  const env = fakeLaunchEnv(root, worktree)
  const r = spawnSync('node', [BIN, 'codex', 'run', '80', '--worktree', worktree], { cwd: root, encoding: 'utf8', env })
  assert.equal(r.status, 0, r.stderr)
  const prompt = readFileSync(join(root, '.building', 'codex-80-prompt.txt'), 'utf8')

  assert.ok(existsSync(DO_PHASE_SKILL), `a lane naming a missing protocol briefs on nothing — no do-phase protocol at ${DO_PHASE_SKILL}`)
  assert.ok(
    prompt.includes(DO_PHASE_SKILL),
    `the run prompt must NAME the resolved protocol path ${DO_PHASE_SKILL} — fix cli/commands/codex.mjs buildPrompt: hand the SKILL over as a file, the way buildReviewPrompt hands over review-phase`,
  )
  assert.match(prompt, /YOUR PROTOCOL IS A FILE/, 'the run lane must point at the protocol it runs, in the review lane\'s own words — cli/commands/codex.mjs buildPrompt')

  const refs = join(dirname(DO_PHASE_SKILL), 'references')
  assert.ok(existsSync(refs), `precondition: do-phase's references/ siblings must exist at ${refs} — an empty pointer would make the next assertion decorative`)
  assert.ok(
    prompt.includes(refs),
    `the prompt must point at the protocol's references/ siblings (${refs}) — a driver that never reads guard-mutation-proof.md runs a thinner protocol; fix cli/commands/codex.mjs buildPrompt`,
  )
  assert.match(
    prompt,
    /including every part it hands to the driver rather than to a supervising session/,
    'the envelope must explicitly hand the driver the protocol-owned supervisory duties',
  )
  assert.match(
    prompt,
    /protocol wins/,
    'the envelope must preserve the protocol as the authority when an override conflicts',
  )

  assert.ok(
    prompt.includes('roadmap/phases/phase-80.phase.ts'),
    'the envelope must still carry its TARGETS — fix cli/commands/codex.mjs buildPrompt: delivering the protocol must not drop the phase files it runs against',
  )
})

test('run: the do-phase protocol BODY stays in the skill — the lane restates none of it', () => {
  const root = tmpRepo()
  writePhase(root, 82)
  const worktree = join(root, 'wt-run-82')
  const env = fakeLaunchEnv(root, worktree)
  const r = spawnSync('node', [BIN, 'codex', 'run', '82', '--worktree', worktree], { cwd: root, encoding: 'utf8', env })
  assert.equal(r.status, 0, r.stderr)
  const prompt = readFileSync(join(root, '.building', 'codex-82-prompt.txt'), 'utf8')
  const protocol = readFileSync(DO_PHASE_SKILL, 'utf8')

  for (const owned of DO_PHASE_OWNED) {
    assert.ok(
      protocol.includes(owned),
      `precondition: skills/do-phase/SKILL.md must own "${owned}" — it was reworded or removed there, so this guard would pass on nothing; re-anchor DO_PHASE_OWNED to the skill's current text`,
    )
    assert.ok(
      !prompt.includes(owned),
      `"${owned}" belongs to skills/do-phase/SKILL.md — the run prompt restating it forks the protocol and makes the eval scorecard's per-model cells compare briefings; fix cli/commands/codex.mjs buildPrompt (deliver the skill, override only disposition)`,
    )
  }
})

test('run: the lane-only overrides SURVIVE the delivery', () => {
  const root = tmpRepo()
  writePhase(root, 83)
  const worktree = join(root, 'wt-run-83')
  const env = fakeLaunchEnv(root, worktree)
  const r = spawnSync('node', [BIN, 'codex', 'run', '83', '--worktree', worktree], { cwd: root, encoding: 'utf8', env })
  assert.equal(r.status, 0, r.stderr)
  const prompt = readFileSync(join(root, '.building', 'codex-83-prompt.txt'), 'utf8')
  const protocol = readFileSync(DO_PHASE_SKILL, 'utf8')

  // Worktree discipline: an unsandboxed driver's only fence.
  assert.match(prompt, /work only (here|in this worktree)/i, 'the delegated run must be fenced to its worktree — fix cli/commands/codex.mjs buildPrompt')
  assert.match(prompt, /never push/i, 'a driver that may push can land unreviewed work on the integration branch — fix cli/commands/codex.mjs buildPrompt')
  assert.ok(prompt.includes('stage explicit paths'), 'sibling sessions share this checkout; `git add -A` scoops their work — fix cli/commands/codex.mjs buildPrompt')
  assert.ok(prompt.includes('git add -A'), 'the staging rule must NAME the forbidden command, not gesture at it — fix cli/commands/codex.mjs buildPrompt')

  // The resume rule: a relaunch over a half-done worktree must not redo or amend landed tasks.
  assert.match(
    prompt,
    /done: true[^\n]*git log|git log[^\n]*done: true/,
    'the resume rule must survive: a task already done: true whose commit is in git log is FINISHED — without it a relaunch amends landed commits; fix cli/commands/codex.mjs buildPrompt',
  )
  assert.match(
    prompt,
    /never redo|never amend|redo or amend/i,
    'the resume rule must forbid the harm, not just describe the state: redoing or amending a landed task commit rewrites history the supervising session already has — fix cli/commands/codex.mjs buildPrompt',
  )

  // Cross-repo: the existing test above pins CROSS-REPO PHASES + the roadmap-state commit. What it
  // does not pin is the write discipline in the OTHER checkout, which the skill never states.
  assert.match(prompt, /other checkout/i, 'the cross-repo instruction must still name the other checkout — fix cli/commands/codex.mjs buildPrompt')
  assert.match(
    prompt,
    /never switch branches/i,
    'the other checkout is a live sibling working tree — the branch-switch prohibition is lane material the skill never carries; fix cli/commands/codex.mjs buildPrompt',
  )

  // Shared-host rules are lane material precisely BECAUSE the protocol has none: proven, not assumed.
  assert.ok(
    !protocol.includes('capbuild'),
    'precondition: skills/do-phase/SKILL.md must NOT carry the shared-host rules — if it now does, they stopped being lane material and belong in DO_PHASE_OWNED instead',
  )
  assert.ok(
    prompt.includes('capbuild'),
    'the shared-host memory cap is absent from the protocol, so only the lane can carry it — an unwrapped suite on this 16 GB box freezes ~5 sessions; fix cli/commands/codex.mjs buildPrompt',
  )

  // The four overrides added at gate R1. Each is lane-owned and unreachable from the skill, and
  // the envelope now sits close to its byte ceiling — without these, the cheapest way to get the
  // parity bound green again would be deleting a rule.
  assert.match(
    prompt,
    /NO REACHABLE USER[^\n]*CODEX-RUN-BLOCKED/,
    'a detached run cannot ask anyone: the delivered protocol says post-and-wait, so the lane MUST say that ends the run with CODEX-RUN-BLOCKED — fix cli/commands/codex.mjs buildPrompt',
  )
  assert.match(
    prompt,
    /ALREADY IN YOUR WORKTREE/i,
    "the launcher already made this worktree and branch; without the override the delivered protocol's worktree-lane setup tells the driver to claim a second slot — fix cli/commands/codex.mjs buildPrompt",
  )
  assert.match(
    prompt,
    /resolveRole/,
    'the lane fills protocol roles through the resolver rather than substituting itself for them — dropping this bullet re-asserts the false "no subagents" claim; fix cli/commands/codex.mjs buildPrompt',
  )
  assert.ok(
    prompt.includes('Co-Authored-By:'),
    'the commit trailer is a lane convention the protocol does not carry — without it delegated task commits land untrailered; fix cli/commands/codex.mjs buildPrompt',
  )

  // The hand-off contract `codex status` parses.
  assert.ok(prompt.includes('CODEX-REPORT.md'), 'the report name is the lane\'s hand-off, read by codex status — fix cli/commands/codex.mjs buildPrompt')
  assert.match(prompt, /do not commit|never commit/i, 'CODEX-REPORT.md is never committed — the launching run owns the file (stale-sentinel bug 2026-08-11); fix cli/commands/codex.mjs buildPrompt')
  assert.ok(prompt.includes('CODEX-RUN-COMPLETE'), 'without the terminal sentinel every finished run polls as dead-no-report — fix cli/commands/codex.mjs buildPrompt')
  assert.ok(prompt.includes('CODEX-RUN-BLOCKED'), 'a blocked run must be able to SAY so; missing, it is indistinguishable from a crash — fix cli/commands/codex.mjs buildPrompt')
})

test('run: the lane stamps driver attribution without restating the completion protocol', () => {
  const root = tmpRepo()
  writePhase(root, 84)
  const worktree = join(root, 'wt-run-84')
  const env = fakeLaunchEnv(root, worktree)
  const r = spawnSync('node', [BIN, 'codex', 'run', '84', '--worktree', worktree], { cwd: root, encoding: 'utf8', env })
  assert.equal(r.status, 0, r.stderr)
  const prompt = readFileSync(join(root, '.building', 'codex-84-prompt.txt'), 'utf8')
  const protocol = readFileSync(DO_PHASE_SKILL, 'utf8')

  // The SKILL can only say "your own model id"; WHICH lane launched is knowledge only the launcher
  // has, so the lane override names it. Absent, the phase scores as unrecorded in the scorecard.
  assert.match(
    prompt,
    /executionResult\.driver[^\n]*lane[^\n]*codex/,
    'the envelope must still stamp executionResult.driver with lane "codex" — an unattributed run scores as unrecorded on the eval scorecard; fix cli/commands/codex.mjs buildPrompt',
  )

  assert.ok(protocol.includes('--verify-complete'), 'precondition: the completion protocol (and its --verify-complete step) lives in skills/do-phase/SKILL.md')
  const approvedTeachingLine =
    'Reviews recorded as `self-review` never satisfy completion — a codex-lane phase needs at least one independent recorded round, and `--verify-complete` refuses without it.'
  assert.ok(
    !prompt.replace(approvedTeachingLine, '').includes('--verify-complete'),
    'only the architect-approved no-self-judge teaching line may name --verify-complete; every other completion step belongs to the skill — fix cli/commands/codex.mjs buildPrompt',
  )
})

// The no-self-judge rule (gate-report.mjs checkPhaseConsistency) refuses a codex-lane completion
// whose recorded rounds are all self-review. Enforced at --verify-complete, that lands AFTER the
// lane has finished — too late to spawn the round it is missing. Only the RUN lane commits and
// records gate rounds, so the teaching line is run-lane material: the review lane writes no
// phase file and the plan lane runs no gate, and neither can act on it.

test('run: the envelope names the independence bar the completion gate enforces', () => {
  const root = tmpRepo()
  writePhase(root, 85)
  const worktree = join(root, 'wt-run-85')
  const env = fakeLaunchEnv(root, worktree)
  const r = spawnSync('node', [BIN, 'codex', 'run', '85', '--worktree', worktree], { cwd: root, encoding: 'utf8', env })
  assert.equal(r.status, 0, r.stderr)
  const prompt = readFileSync(join(root, '.building', 'codex-85-prompt.txt'), 'utf8')

  // Precondition: the rule the envelope teaches must really be the one the gate enforces —
  // otherwise this test pins a sentence no refusal backs.
  const enforcement = readFileSync(join(HERE, '..', 'lib', 'gate-report.mjs'), 'utf8')
  assert.ok(
    enforcement.includes('self-review') && /satisfy completion/.test(enforcement),
    'precondition: cli/lib/gate-report.mjs must own the no-self-judge completion rule — if it moved or was reworded, re-anchor this test to its new home before trusting the envelope assertions below',
  )

  assert.ok(
    prompt.includes('never satisfy completion'),
    'the run envelope must state the completion bar in the gate\'s own terms — without it the lane meets the refusal at --verify-complete, after the roles it could have spawned are gone; fix cli/commands/codex.mjs buildPrompt (extend the FILL PROTOCOL ROLES bullet)',
  )
  assert.match(
    prompt,
    /self-review[^\n]*never satisfy completion/i,
    'the bar must name WHAT fails to satisfy completion: a rule that omits self-review reads as "reviews are optional" rather than "your own review does not count"; fix cli/commands/codex.mjs buildPrompt',
  )
  assert.match(
    prompt,
    /at least one independent[^\n]*round/i,
    'stating the prohibition without the remedy leaves the driver no action: the envelope must require at least one INDEPENDENT recorded round, which is the thing the lane can still do at work time; fix cli/commands/codex.mjs buildPrompt',
  )
})

test('review and plan lanes stay silent about the gate-round rule they cannot act on', () => {
  const root = tmpRepo()
  writePhase(root, 68)
  const reviewWt = join(root, 'wt-review-68')
  const reviewEnv = fakeLaunchEnv(root, reviewWt)
  const rr = spawnSync('node', [BIN, 'codex', 'review', '68', '--worktree', reviewWt], { cwd: root, encoding: 'utf8', env: reviewEnv })
  assert.equal(rr.status, 0, rr.stderr)

  const brief = writeBrief(root)
  const planWt = join(root, 'wt-plan-113')
  const planEnv = fakeLaunchEnv(root, planWt)
  const pr = spawnSync('node', [BIN, 'codex', 'plan', '113', '--brief', brief, '--worktree', planWt], { cwd: root, encoding: 'utf8', env: planEnv })
  assert.equal(pr.status, 0, pr.stderr)

  for (const [lane, file] of [['review', 'codex-review-68-prompt.txt'], ['plan', 'codex-plan-113-prompt.txt']]) {
    const prompt = readFileSync(join(root, '.building', file), 'utf8')
    // Guard the negatives: a mis-pathed or empty read would satisfy them vacuously.
    assert.match(prompt, /YOUR PROTOCOL IS A FILE/, `precondition: ${file} must be the ${lane} lane's real envelope, or the two assertions below pass on nothing`)
    assert.doesNotMatch(
      prompt,
      /never satisfy completion/i,
      `the ${lane} lane records no gate rounds — the completion bar is run-lane disposition, and copying it here briefs a driver on a step it cannot take; fix cli/commands/codex.mjs (run-lane copy ONLY)`,
    )
    assert.doesNotMatch(
      prompt,
      /recorded round/i,
      `the ${lane} lane never reaches a gate round, so a recorded-round instruction is dead text that dilutes the overrides it can act on; fix cli/commands/codex.mjs (run-lane copy ONLY)`,
    )
  }
})

// ── review lane ────────────────────────────────────────────────────────────

/** A premade worktree + fake `codex` on PATH: the launch path runs, nothing real spawns. */
function fakeLaunchEnv(root, worktree) {
  mkdirSync(worktree, { recursive: true })
  return fakeCodexPath(root)
}

/** fakeLaunchEnv's PATH half alone — for the tests that must assert NO worktree was made. */
function fakeCodexPath(root) {
  const fakeBin = join(root, 'fakebin')
  mkdirSync(fakeBin, { recursive: true })
  writeFileSync(join(fakeBin, 'codex'), '#!/bin/sh\nexit 0\n')
  chmodSync(join(fakeBin, 'codex'), 0o755)
  return { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` }
}

function writePhase(root, n) {
  mkdirSync(join(root, 'roadmap', 'phases'), { recursive: true })
  writeFileSync(join(root, 'roadmap', 'phases', `phase-${n}.phase.ts`), 'export default {}\n')
}

test('review: the mission DELIVERS review-phase rather than restating it', () => {
  const root = tmpRepo()
  writePhase(root, 60)
  const worktree = join(root, 'wt-review-60')
  const env = fakeLaunchEnv(root, worktree)
  const r = spawnSync('node', [BIN, 'codex', 'review', '60', '--worktree', worktree], { cwd: root, encoding: 'utf8', env })
  assert.equal(r.status, 0, r.stderr)
  const prompt = readFileSync(join(root, '.building', 'codex-review-60-prompt.txt'), 'utf8')

  // The protocol is handed over as a readable path, never pasted in.
  const skill = join(HERE, '..', '..', 'skills', 'review-phase', 'SKILL.md')
  assert.ok(existsSync(skill), 'a lane that names a missing protocol would brief on nothing')
  assert.match(prompt, /YOUR PROTOCOL IS A FILE/, 'the lane points at the protocol it runs')
  assert.ok(prompt.includes(skill), `the prompt must name the real skill path (${skill})`)

  // The duplication guard, and the reason this lane exists in this shape: the protocol BODY
  // stays in the skill so every driver reads the SAME one. These strings are Mode A's own —
  // finding them in the prompt means a second copy has been started.
  const protocol = readFileSync(skill, 'utf8')
  for (const owned of ['promise ledger', 'Step V', 'H4']) {
    assert.ok(protocol.includes(owned), `precondition: the skill owns "${owned}"`)
    assert.ok(!prompt.includes(owned), `"${owned}" belongs to the skill — the lane must not restate it`)
  }

  assert.match(prompt, /REPORT-ONLY/, 'a delegated review must not repair the plan it is judging')
  assert.match(prompt, /judged by:` in the verdict block is YOUR OWN model id/, 'attribution is per-driver, not per-lane')
  assert.match(prompt, /CODEX-REVIEW\.md/, "the review lane hands off its own report, never the run lane's")
  assert.doesNotMatch(prompt, /one commit|transparencyReport|roadmap gate run/i, 'implementation grammar must not leak into a review')
})

test('review: journal, prompt and report are separate from the run lane', () => {
  const root = tmpRepo()
  writePhase(root, 61)
  const worktree = join(root, 'wt-review-61')
  const env = fakeLaunchEnv(root, worktree)
  assert.equal(spawnSync('node', [BIN, 'codex', 'review', '61', '--worktree', worktree], { cwd: root, encoding: 'utf8', env }).status, 0)
  const j = JSON.parse(readFileSync(join(root, '.building', 'codex-review-61.json'), 'utf8'))
  assert.equal(j.lane, 'review')
  assert.equal(j.report, 'CODEX-REVIEW.md')
  assert.ok(!existsSync(join(root, '.building', 'codex-61.json')), 'a review must not write the run lane\'s journal')

  // The run-lane status must not adopt a review journal as its own verdict.
  const bare = spawnSync('node', [BIN, 'codex', 'status', '61'], { cwd: root, encoding: 'utf8' })
  assert.equal(bare.status, 1, 'run-lane status must not see a review journal')
  assert.match(bare.stderr, /no run journal covers/)

  writeFileSync(join(worktree, 'CODEX-REVIEW.md'), 'findings\nCODEX-RUN-COMPLETE\n')
  const reviewed = spawnSync('node', [BIN, 'codex', 'status', '61', '--review'], { cwd: root, encoding: 'utf8' })
  assert.equal(reviewed.status, 0, reviewed.stderr)
  assert.equal(JSON.parse(reviewed.stdout).state, 'complete')
})

test('review: a journal predating the lane still reads CODEX-REPORT.md', () => {
  const root = tmpRepo()
  // No `report` field — the pre-review-lane journal shape. startedAt is backdated for the same
  // reason as the fresh-report test: a report written in the launch millisecond can stat below
  // it, and this test is about the report NAME, not the freshness guard.
  const j = writeJournal(root, [62], { startedAt: new Date(Date.now() - 60_000).toISOString() })
  writeFileSync(join(j.worktree, 'CODEX-REPORT.md'), 'done\nCODEX-RUN-COMPLETE\n')
  const { code, out } = status(root, 62)
  assert.equal(out.state, 'complete', 'an old journal must not lose its verdict to the new report name')
  assert.equal(code, 0)
})

test('review: a missing --doc fails loudly and destroys no previous review', () => {
  const root = tmpRepo()
  writePhase(root, 63)
  const worktree = join(root, 'wt-review-63')
  const env = fakeLaunchEnv(root, worktree)
  const prior = join(worktree, 'CODEX-REVIEW.md')
  writeFileSync(prior, 'previous findings\nCODEX-RUN-COMPLETE\n')
  const r = spawnSync('node', [BIN, 'codex', 'review', '63', '--worktree', worktree, '--doc', '.building/nope.md'], { cwd: root, encoding: 'utf8', env })
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /context doc missing/)
  assert.equal(readFileSync(prior, 'utf8'), 'previous findings\nCODEX-RUN-COMPLETE\n', 'a failed launch must leave the previous hand-off intact')
})

test('review: an untracked --doc is copied into the worktree it names', () => {
  const root = tmpRepo()
  writePhase(root, 64)
  const worktree = join(root, 'wt-review-64')
  const env = fakeLaunchEnv(root, worktree)
  writeFileSync(join(root, '.building', 'PLAN.md'), '# the release plan\n')
  const r = spawnSync('node', [BIN, 'codex', 'review', '64', '--worktree', worktree, '--doc', '.building/PLAN.md'], { cwd: root, encoding: 'utf8', env })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(readFileSync(join(worktree, '.building', 'PLAN.md'), 'utf8'), '# the release plan\n', 'a gitignored plan is absent from a fresh worktree — the lane must carry it in')
  assert.match(readFileSync(join(root, '.building', 'codex-review-64-prompt.txt'), 'utf8'), /CONTEXT DOC \(read before the phase files/)
})

test('review: --focus lands as the protocol\'s trailing prompt, not as a replacement step', () => {
  const root = tmpRepo()
  writePhase(root, 65)
  const worktree = join(root, 'wt-review-65')
  const env = fakeLaunchEnv(root, worktree)
  const r = spawnSync('node', [BIN, 'codex', 'review', '65', '--worktree', worktree, '--focus', 'weigh the shared policy release'], { cwd: root, encoding: 'utf8', env })
  assert.equal(r.status, 0, r.stderr)
  const prompt = readFileSync(join(root, '.building', 'codex-review-65-prompt.txt'), 'utf8')
  assert.match(prompt, /weigh the shared policy release/)
  // review-phase already defines what a trailing ask is ("extra checks AFTER the protocol");
  // --focus rides that convention instead of inventing a second one.
  assert.match(prompt, /TRAILING PROMPT/, 'a focus must enter through the protocol\'s own door')
  assert.match(prompt, /never displaces a step/, 'a focus must not become the whole mission')
})

test('review: a live review refuses an implementation run into the same worktree', () => {
  const root = tmpRepo()
  const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' })
  child.unref()
  cleanups.push(() => {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {}
  })
  const worktree = join(root, 'wt-shared')
  mkdirSync(worktree, { recursive: true })
  writeFileSync(
    join(root, '.building', 'codex-review-66.json'),
    JSON.stringify({ phases: ['66'], lane: 'review', report: 'CODEX-REVIEW.md', worktree, pgid: child.pid, startedAt: new Date().toISOString() }) + '\n',
  )
  writePhase(root, 66)
  const r = spawnSync('node', [BIN, 'codex', 'run', '66', '--worktree', worktree], { cwd: root, encoding: 'utf8' })
  assert.equal(r.status, 2, r.stderr)
  assert.match(r.stderr, /LIVE run .* in this worktree — refusing/, 'the liveness guard must span both lanes')
})

test("review: a flag's value is never parsed as a phase id", () => {
  const root = tmpRepo()
  writePhase(root, 67)
  const worktree = join(root, 'wt-review-67')
  const env = fakeLaunchEnv(root, worktree)
  // --base 719 is a ref; only 67 is a phase. A naive numeric filter would review both.
  const r = spawnSync('node', [BIN, 'codex', 'review', '67', '--worktree', worktree, '--base', '719'], { cwd: root, encoding: 'utf8', env })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(existsSync(join(root, '.building', 'codex-review-67.json')))
  assert.ok(!existsSync(join(root, '.building', 'codex-review-67-719.json')), "a --base ref must not join the phase list")
})

// ── lane attribution: the LAUNCHER journals who ran ────────────────────────────
// A delegated run is attributable only if the side that KNOWS the identity records it. Asking
// the model to self-report the driver the launcher already chose is an honesty rail with no
// floor under it, and nothing at landing time can then contradict a wrong claim.
// The expected model id is read from the registry (cli/lib/drivers.mjs is the ONE home for a
// model id): a literal here would fork that home and go stale silently.

test('run lane: the launch journal records the driver { model, lane } read from the registry', () => {
  const root = tmpRepo()
  writePhase(root, 70)
  const worktree = join(root, 'wt-run-70')
  const env = fakeLaunchEnv(root, worktree)
  const r = spawnSync('node', [BIN, 'codex', 'run', '70', '--worktree', worktree], { cwd: root, encoding: 'utf8', env })
  assert.equal(r.status, 0, r.stderr)

  const model = DRIVERS.codex.model
  assert.equal(typeof model, 'string', 'the registry must DECLARE codex\'s model id — an undeclared one makes every attribution below vacuous')
  assert.ok(model.length > 0, 'a driver entry with an empty model id cannot attribute anything')

  const j = JSON.parse(readFileSync(join(root, '.building', 'codex-70.json'), 'utf8'))
  assert.equal(j.driver?.model, model, 'the journalled model is the registry entry\'s, never a literal in the launcher')
  assert.equal(j.driver?.lane, 'codex', 'driver.lane names the DRIVER that ran')
  // Additive: the key JOINS the journal — everything the poller and the reconcile read survives.
  assert.deepEqual(j.phases, ['70'])
  assert.equal(j.lane, 'run')
  assert.equal(j.worktree, worktree)
  assert.equal(j.report, 'CODEX-REPORT.md')
  assert.ok(Number.isInteger(j.pgid), 'the liveness probe still has its pgid')
  assert.ok(Number.isFinite(Date.parse(j.startedAt)), 'the freshness guard still has a parseable startedAt')
})

test('review lane: driver.lane names the DRIVER, never the run/review lane it launched', () => {
  const root = tmpRepo()
  writePhase(root, 71)
  const worktree = join(root, 'wt-review-71')
  const env = fakeLaunchEnv(root, worktree)
  const r = spawnSync('node', [BIN, 'codex', 'review', '71', '--worktree', worktree], { cwd: root, encoding: 'utf8', env })
  assert.equal(r.status, 0, r.stderr)
  const j = JSON.parse(readFileSync(join(root, '.building', 'codex-review-71.json'), 'utf8'))
  assert.equal(j.lane, 'review', 'precondition: this journal is the review lane\'s')
  assert.equal(typeof DRIVERS.codex.model, 'string', 'the registry must DECLARE codex\'s model id — undefined === undefined would pass the next line on nothing')
  assert.equal(j.driver?.model, DRIVERS.codex.model, 'both lanes attribute to the same registry entry')
  assert.equal(j.driver?.lane, 'codex', 'the two lane fields are different axes — driver.lane must not mirror journal.lane')
})

// ── findJournal: the ONE journal lookup both `codex status` and the gate reconcile read ──
// Two cases the lookup has always had to serve: the exact single-phase name, and a multi-phase
// (arc) journal that covers an id without being named for it. A second, divergent copy of this
// resolution is how a gate reconcile silently stops finding arc runs.

test('findJournal: resolves the exact single-phase name AND the multi-phase journal that covers an id', async () => {
  const mod = await import('./codex.mjs')
  assert.equal(typeof mod.findJournal, 'function', 'codex.mjs must export findJournal — the shared journal lookup')
  const root = tmpRepo()
  writeJournal(root, [72])
  writeJournal(root, [73, 74])

  const exact = mod.findJournal(root, [72], 'run')
  assert.ok(exact, 'the exact-name journal must resolve')
  assert.equal(exact.path, join(root, '.building', 'codex-72.json'))
  assert.deepEqual(exact.journal.phases, ['72'], 'the parsed journal comes back with it, not just a path')

  // An id inside an arc journal: numeric ids (the gate passes a phase number) must resolve the
  // same journal a string id does — a strict comparison against the journal's string phases
  // would leave every arc run unreconciled.
  const scanned = mod.findJournal(root, [74], 'run')
  assert.ok(scanned, 'a multi-phase journal covering 74 must resolve for the NUMBER 74')
  assert.equal(scanned.path, join(root, '.building', 'codex-73-74.json'))
  assert.deepEqual(mod.findJournal(root, ['74'], 'run'), scanned, 'the string id resolves the identical result')
})

test('findJournal: a review journal never answers for lane run, and a miss is null', async () => {
  const mod = await import('./codex.mjs')
  assert.equal(typeof mod.findJournal, 'function', 'codex.mjs must export findJournal — the shared journal lookup')
  const root = tmpRepo()
  writeJournal(root, [76])
  writeFileSync(
    join(root, '.building', 'codex-review-75.json'),
    JSON.stringify({ phases: ['75'], lane: 'review', report: 'CODEX-REVIEW.md', worktree: join(root, 'wt-75'), startedAt: new Date().toISOString() }) + '\n',
  )

  assert.equal(mod.findJournal(root, [75], 'run'), null, 'a review of phase 75 is not an implementation run of it')
  const review = mod.findJournal(root, [75], 'review')
  assert.ok(review, 'the same id resolves under its OWN lane')
  assert.equal(review.path, join(root, '.building', 'codex-review-75.json'))
  assert.equal(mod.findJournal(root, [99], 'run'), null, 'no journal covers 99 — a miss is null, never a nearby journal')
})

test('findJournal: a journal that EXISTS and will not parse THROWS — never reported as "no journal"', async () => {
  const mod = await import('./codex.mjs')
  const root = tmpRepo()
  mkdirSync(join(root, '.building'), { recursive: true })
  const corrupt = join(root, '.building', 'codex-77.json')
  writeFileSync(corrupt, '{ "phases": ["77"], "driver": { "model": "gpt')

  assert.throws(
    () => mod.findJournal(root, [77], 'run'),
    (e) => {
      assert.equal(e.name, 'JournalUnreadableError', `an unreadable journal must be its own class; got ${e.name}: ${e.message}`)
      assert.ok(e.message.includes(corrupt), `the unreadable file must be NAMED; got: ${e.message}`)
      assert.ok(/inline session/.test(e.message), `and distinguished from the inline-session case; got: ${e.message}`)
      return true
    },
    'a truncated journal is a launch that died mid-write — reporting it as absent disarms the reconcile in silence',
  )
})

test('findJournal: a corrupt journal for OTHER phases is not this phase\'s problem — only a journal NAMING these ids throws', async () => {
  // Nothing prunes .building. If any unparseable file in the directory threw, one truncated
  // journal left by an abandoned run would block `codex status` and the gate reconcile for every
  // OTHER phase in the checkout — including inline sessions that never had a journal at all.
  // The filename is launch()'s own record of the ids it wrote into `phases`, so it is the honest
  // candidacy test: the corrupt file below still throws for the phase it names.
  const mod = await import('./codex.mjs')
  const root = tmpRepo()
  const corrupt = join(root, '.building', 'codex-91.json')
  writeFileSync(corrupt, '{ "phases": ["91"], "driver": { "model": "gpt')

  assert.equal(mod.findJournal(root, [3], 'run'), null, 'phase 3 has no journal of its own — that is an inline session, not a corrupt one')
  writeJournal(root, [3])
  assert.ok(mod.findJournal(root, [3], 'run'), 'and a healthy journal beside the corrupt one still resolves')
  assert.throws(
    () => mod.findJournal(root, [91], 'run'),
    (e) => e.name === 'JournalUnreadableError' && e.message.includes(corrupt),
    'the corrupt file is still loud for the ids its NAME covers — the scoping narrows blast radius, not the guard',
  )

  // The multi-phase (arc) journal shape: a corrupt codex-92-93.json covers 92, so it throws there.
  const arcCorrupt = join(root, '.building', 'codex-92-93.json')
  writeFileSync(arcCorrupt, '{ "phases": ["92", "93"')
  assert.throws(
    () => mod.findJournal(root, [92], 'run'),
    (e) => e.name === 'JournalUnreadableError' && e.message.includes(arcCorrupt),
    'an arc journal names every id it covers, so a member id must still find it',
  )
  assert.equal(mod.findJournal(root, [94], 'run'), null, 'a phase named by neither corrupt file is unaffected')
})

test('codex status: an unreadable journal reports the PARSE failure, never "no journal covers"', () => {
  const root = tmpRepo()
  mkdirSync(join(root, '.building'), { recursive: true })
  writeFileSync(join(root, '.building', 'codex-78.json'), '{ "phases": ["78"')
  const r = spawnSync('node', [BIN, 'codex', 'status', '78'], { cwd: root, encoding: 'utf8' })
  assert.equal(r.status, 1, `an unreadable journal is still a failure exit; stderr: ${r.stderr}`)
  assert.ok(r.stderr.includes('codex-78.json'), `the file the reader choked on must be named; got: ${r.stderr}`)
  assert.ok(
    !/no run journal covers/.test(r.stderr),
    `the journal is right there — claiming none covers the phase sends the reader to the wrong place; got: ${r.stderr}`,
  )
})

// ── plan lane: a third mission on the SAME launch mechanics ────────────────────
// The privilege the arc's any-model-full-protocol criterion forbids is a protocol only one model
// family can read. run and review already deliver theirs by path; without a plan lane no
// non-Claude driver can author a phase at all, and the scorecard's `planners` cells hold exactly
// one family no matter how many models ran.

/** The plan lane's protocol, resolved the way codex.mjs must resolve it (plugin-move follows). */
const PLAN_PHASE_SKILL = join(HERE, '..', '..', 'skills', 'plan-phase', 'SKILL.md')

/** A brief on disk (the lane refuses to plan without an input) → its repo-relative path. */
function writeBrief(root) {
  const name = '.building/plan-brief.md'
  const p = join(root, name)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, '# follow-up fixes\n- one line per item\n')
  return name
}

test('plan: the mission DELIVERS plan-phase by path, references included', () => {
  const root = tmpRepo()
  const brief = writeBrief(root)
  const worktree = join(root, 'wt-plan-100')
  const env = fakeLaunchEnv(root, worktree)
  const r = spawnSync('node', [BIN, 'codex', 'plan', '100', '--brief', brief, '--worktree', worktree], { cwd: root, encoding: 'utf8', env })
  assert.equal(r.status, 0, r.stderr)
  const prompt = readFileSync(join(root, '.building', 'codex-plan-100-prompt.txt'), 'utf8')

  assert.ok(existsSync(PLAN_PHASE_SKILL), `a lane naming a missing protocol briefs on nothing — no plan-phase protocol at ${PLAN_PHASE_SKILL}`)
  assert.ok(
    prompt.includes(PLAN_PHASE_SKILL),
    `the plan prompt must NAME the resolved protocol path ${PLAN_PHASE_SKILL} — fix cli/commands/codex.mjs buildPlanPrompt: hand the SKILL over as a file, the way buildReviewPrompt hands over review-phase`,
  )
  assert.match(prompt, /YOUR PROTOCOL IS A FILE/, 'the plan lane must point at the protocol it runs, in the other lanes\' own words — cli/commands/codex.mjs buildPlanPrompt')

  const refs = join(dirname(PLAN_PHASE_SKILL), 'references')
  assert.ok(existsSync(refs), `precondition: plan-phase's references/ siblings must exist at ${refs} — an empty pointer would make the next assertion decorative`)
  assert.ok(
    prompt.includes(refs),
    `the prompt must point at the protocol's references/ siblings (${refs}) — a planner that never reads verify-rehearsal.md authors backward verifies; fix cli/commands/codex.mjs buildPlanPrompt`,
  )

  assert.ok(
    prompt.includes('roadmap/phases/phase-100.phase.ts'),
    'the envelope must carry its TARGET — the one file the plan act may create; fix cli/commands/codex.mjs buildPlanPrompt',
  )
  assert.ok(prompt.includes(brief), 'the envelope must name the brief it was given — the plan input is the whole point of the flag; fix cli/commands/codex.mjs buildPlanPrompt')
})

test('plan: --brief is MANDATORY and the refusal names the flag', () => {
  const root = tmpRepo()
  const worktree = join(root, 'wt-plan-101')
  const env = fakeLaunchEnv(root, worktree)
  const r = spawnSync('node', [BIN, 'codex', 'plan', '101', '--worktree', worktree], { cwd: root, encoding: 'utf8', env })
  assert.notEqual(r.status, 0, `a plan with no input is a hallucination invitation — it must refuse; stderr: ${r.stderr}`)
  assert.match(r.stderr, /--brief/, `the refusal must NAME the flag that fixes it, not just say no; got: ${r.stderr}`)
  assert.ok(!existsSync(join(root, '.building', 'codex-plan-101.json')), 'a refused launch must journal nothing')
})

test('plan: a --brief pointing at nothing fails loudly and journals nothing', () => {
  const root = tmpRepo()
  const worktree = join(root, 'wt-plan-102')
  const env = fakeLaunchEnv(root, worktree)
  const r = spawnSync('node', [BIN, 'codex', 'plan', '102', '--brief', '.building/nope.md', '--worktree', worktree], { cwd: root, encoding: 'utf8', env })
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /brief missing/, `an unreadable plan input must be named, never planned around; got: ${r.stderr}`)
  assert.ok(!existsSync(join(root, '.building', 'codex-plan-102.json')), 'a refused launch must journal nothing')
})

test('plan: the gitignored brief is copied into the worktree it names', () => {
  const root = tmpRepo()
  const brief = writeBrief(root)
  const worktree = join(root, 'wt-plan-103')
  const env = fakeLaunchEnv(root, worktree)
  const r = spawnSync('node', [BIN, 'codex', 'plan', '103', '--brief', brief, '--worktree', worktree], { cwd: root, encoding: 'utf8', env })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(
    readFileSync(join(worktree, brief), 'utf8'),
    readFileSync(join(root, brief), 'utf8'),
    'a brief under .building/ is gitignored and absent from a fresh worktree — the lane must carry it in, or the mission\'s first read fails on a path it just validated',
  )
})

test('plan: journal, prompt and report are separate from run and review', () => {
  const root = tmpRepo()
  const brief = writeBrief(root)
  const worktree = join(root, 'wt-plan-104')
  const env = fakeLaunchEnv(root, worktree)
  assert.equal(spawnSync('node', [BIN, 'codex', 'plan', '104', '--brief', brief, '--worktree', worktree], { cwd: root, encoding: 'utf8', env }).status, 0)
  const j = JSON.parse(readFileSync(join(root, '.building', 'codex-plan-104.json'), 'utf8'))
  assert.equal(j.lane, 'plan')
  assert.equal(j.report, 'CODEX-PLAN.md')
  assert.ok(!existsSync(join(root, '.building', 'codex-104.json')), 'a plan must not write the run lane\'s journal')
  assert.ok(!existsSync(join(root, '.building', 'codex-review-104.json')), 'a plan must not write the review lane\'s journal')

  // The launcher stamps attribution: asking the model to self-report the driver the launcher
  // already commanded is an honesty rail with no floor under it.
  assert.equal(typeof DRIVERS.codex.model, 'string', 'the registry must DECLARE codex\'s model id — undefined === undefined would pass the next line on nothing')
  assert.equal(j.driver?.model, DRIVERS.codex.model, 'the journalled model is the registry entry\'s, never a literal in the launcher')
  assert.equal(j.driver?.lane, 'codex', 'driver.lane names the DRIVER that ran, never the run/review/plan mission')

  // Everything the poller and the reconcile read survives on the new lane.
  assert.deepEqual(j.phases, ['104'])
  assert.equal(j.worktree, worktree)
  assert.ok(Number.isInteger(j.pgid), 'the liveness probe still has its pgid')
  assert.ok(Number.isFinite(Date.parse(j.startedAt)), 'the freshness guard still has a parseable startedAt')
})

test('plan: findJournal and status resolve the codex-plan- prefix, and no other lane answers for it', async () => {
  const mod = await import('./codex.mjs')
  const root = tmpRepo()
  const worktree = join(root, 'wt-plan-105')
  mkdirSync(worktree, { recursive: true })
  writeFileSync(
    join(root, '.building', 'codex-plan-105.json'),
    JSON.stringify({ phases: ['105'], lane: 'plan', report: 'CODEX-PLAN.md', worktree, pgid: 999999999, startedAt: new Date(Date.now() - 60_000).toISOString() }) + '\n',
  )

  assert.equal(mod.findJournal(root, [105], 'run'), null, 'a PLAN of phase 105 is not an implementation run of it')
  assert.equal(mod.findJournal(root, [105], 'review'), null, 'nor a review of it')
  const found = mod.findJournal(root, [105], 'plan')
  assert.ok(found, 'the same id resolves under its OWN lane')
  assert.equal(found.path, join(root, '.building', 'codex-plan-105.json'))

  // The lane's verdict is readable through the same status command, selected by its own flag.
  writeFileSync(join(worktree, 'CODEX-PLAN.md'), 'planned\nCODEX-RUN-COMPLETE\n')
  const planned = spawnSync('node', [BIN, 'codex', 'status', '105', '--plan'], { cwd: root, encoding: 'utf8' })
  assert.equal(planned.status, 0, planned.stderr)
  assert.equal(JSON.parse(planned.stdout).state, 'complete')

  // A default (run-lane) poll must not adopt it — and must say where the journal actually is,
  // rather than sending the reader off to look for a run that never existed.
  const bare = spawnSync('node', [BIN, 'codex', 'status', '105'], { cwd: root, encoding: 'utf8' })
  assert.equal(bare.status, 1, 'run-lane status must not see a plan journal')
  assert.match(bare.stderr, /--plan/, `the miss must name the flag that finds the journal sitting right there; got: ${bare.stderr}`)
})

test('plan: a live plan refuses an implementation run into the same worktree', () => {
  const root = tmpRepo()
  const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' })
  child.unref()
  cleanups.push(() => {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {}
  })
  const worktree = join(root, 'wt-plan-shared')
  mkdirSync(worktree, { recursive: true })
  writeFileSync(
    join(root, '.building', 'codex-plan-106.json'),
    JSON.stringify({ phases: ['106'], lane: 'plan', report: 'CODEX-PLAN.md', worktree, pgid: child.pid, startedAt: new Date().toISOString() }) + '\n',
  )
  writePhase(root, 106)
  const r = spawnSync('node', [BIN, 'codex', 'run', '106', '--worktree', worktree], { cwd: root, encoding: 'utf8' })
  assert.equal(r.status, 2, r.stderr)
  assert.match(r.stderr, /LIVE run .* in this worktree — refusing/, 'the liveness guard must span all three lanes')
})

test('plan: the lane-only overrides SURVIVE the delivery', () => {
  const root = tmpRepo()
  const brief = writeBrief(root)
  const worktree = join(root, 'wt-plan-107')
  const env = fakeLaunchEnv(root, worktree)
  const r = spawnSync('node', [BIN, 'codex', 'plan', '107', '--brief', brief, '--worktree', worktree], { cwd: root, encoding: 'utf8', env })
  assert.equal(r.status, 0, r.stderr)
  const prompt = readFileSync(join(root, '.building', 'codex-plan-107-prompt.txt'), 'utf8')
  const protocol = readFileSync(PLAN_PHASE_SKILL, 'utf8')

  assert.match(prompt, /work only (here|in this worktree)/i, 'the delegated plan must be fenced to its worktree — fix cli/commands/codex.mjs buildPlanPrompt')
  assert.match(prompt, /never push/i, 'a driver that may push can land an unreviewed plan on the integration branch — fix cli/commands/codex.mjs buildPlanPrompt')
  assert.match(prompt, /stage explicit paths/i, 'sibling sessions share this checkout — fix cli/commands/codex.mjs buildPlanPrompt')
  assert.ok(prompt.includes('git add -A'), 'the staging rule must NAME the forbidden command, not gesture at it — `git add -A` scoops a sibling session\'s work; fix cli/commands/codex.mjs buildPlanPrompt')

  // The number is the launcher's, not the planner's: the protocol reserves one, this lane already did.
  assert.match(
    prompt,
    /ALREADY RESERVED/,
    'the launcher claimed the number before spawning; without the override the planner reserves a SECOND one and plans into a file nobody is waiting for — fix cli/commands/codex.mjs buildPlanPrompt',
  )

  // Queueing is review-phase's act and the supervising session runs it. A delegated planner that
  // edits backlog.ts queues a plan no one has reviewed.
  assert.ok(prompt.includes('roadmap/backlog.ts'), 'the queue file must be named as off-limits, not gestured at — fix cli/commands/codex.mjs buildPlanPrompt')
  assert.ok(
    protocol.includes('backlog.ts'),
    'precondition: plan-phase must still be the protocol that talks about the queue — if it stopped, this override is guarding nothing',
  )

  assert.match(
    prompt,
    /NO REACHABLE USER[^\n]*CODEX-RUN-BLOCKED/,
    'a detached planner cannot ask anyone: the delivered protocol interviews and escalates to the user, so the lane MUST say that ends the run — fix cli/commands/codex.mjs buildPlanPrompt',
  )
  assert.match(
    prompt,
    /plannedBy/,
    'the plan artifact carries its own author field — unstamped, the scorecard\'s planner cells cannot tell which family authored it; fix cli/commands/codex.mjs buildPlanPrompt',
  )
  assert.match(prompt, /resolveRole/, 'the plan protocol spawns the architect; the lane fills that role through the resolver rather than substituting itself — fix cli/commands/codex.mjs buildPlanPrompt')

  assert.ok(
    !protocol.includes('capbuild'),
    'precondition: skills/plan-phase/SKILL.md must NOT carry the shared-host rules — if it now does, they stopped being lane material',
  )
  assert.ok(prompt.includes('capbuild'), 'the shared-host memory cap is absent from the protocol, so only the lane can carry it — fix cli/commands/codex.mjs buildPlanPrompt')

  assert.ok(prompt.includes('CODEX-PLAN.md'), 'the plan lane hands off its OWN report, never the run lane\'s — fix cli/commands/codex.mjs buildPlanPrompt')
  assert.match(prompt, /do not commit|never commit/i, 'the report is never committed — the launching run owns the file (stale-sentinel bug 2026-08-11)')
  assert.ok(prompt.includes('CODEX-RUN-COMPLETE'), 'without the terminal sentinel every finished plan polls as dead-no-report')
  assert.ok(prompt.includes('CODEX-RUN-BLOCKED'), 'a blocked plan must be able to SAY so; missing, it is indistinguishable from a crash')
})

test('plan: a number whose phase file already exists is refused, not planned over', () => {
  const root = tmpRepo()
  const brief = writeBrief(root)
  writePhase(root, 108)
  const worktree = join(root, 'wt-plan-108')
  const env = fakeLaunchEnv(root, worktree)
  const r = spawnSync('node', [BIN, 'codex', 'plan', '108', '--brief', brief, '--worktree', worktree], { cwd: root, encoding: 'utf8', env })
  assert.notEqual(r.status, 0, 'this lane authors a NEWLY reserved number — an existing file means the wrong number was passed')
  assert.match(r.stderr, /already exists/, `the collision must be named; got: ${r.stderr}`)
  assert.equal(readFileSync(join(root, 'roadmap', 'phases', 'phase-108.phase.ts'), 'utf8'), 'export default {}\n', 'the existing plan is untouched')
})

/**
 * Strings plan-phase/SKILL.md OWNS — protocol BODY, never this lane's disposition:
 *  - `KNOW THE DIFF BEFORE WRITING THE TASK` / `ESCALATE TO ARCHITECT` / `PROCEED_WITH_TASK` —
 *    the two prime rules and the architect verdict token: WHEN a plan is precise enough and when
 *    to escalate is identical for every planner, so a second copy is a second protocol.
 *  - `roadmap claim` — the number-reservation mechanics. This lane reserves BEFORE launching, so
 *    the envelope overrides the step; restating its command would have the planner do it twice.
 *  - `[NEEDS CLARIFICATION]` — the marker contract, and the queueing ban that rides on it.
 *  - `roadmap phase validate` — the validate step the protocol commands.
 *  - `timing-stats.json` — the timing reference class the docblock must cite.
 *  - `verify-rehearsal.md` / `closure-checklist.md` — references/ siblings, reached through the
 *    protocol's own pointer, never summarized by a launcher.
 * Lane material by contrast (asserted present in the overrides test above): worktree discipline,
 * the one-file rule, the reserved number, the commit trailer, the shared-host rules, the
 * CODEX-PLAN.md hand-off.
 */
const PLAN_PHASE_OWNED = [
  'KNOW THE DIFF BEFORE WRITING THE TASK',
  'ESCALATE TO ARCHITECT',
  'PROCEED_WITH_TASK',
  'roadmap claim',
  '[NEEDS CLARIFICATION]',
  'roadmap phase validate',
  'timing-stats.json',
  'verify-rehearsal.md',
  'closure-checklist.md',
]

test('plan: the plan-phase protocol BODY stays in the skill — the lane restates none of it', () => {
  const root = tmpRepo()
  const brief = writeBrief(root)
  const worktree = join(root, 'wt-plan-109')
  const env = fakeLaunchEnv(root, worktree)
  const r = spawnSync('node', [BIN, 'codex', 'plan', '109', '--brief', brief, '--worktree', worktree], { cwd: root, encoding: 'utf8', env })
  assert.equal(r.status, 0, r.stderr)
  const prompt = readFileSync(join(root, '.building', 'codex-plan-109-prompt.txt'), 'utf8')
  const protocol = readFileSync(PLAN_PHASE_SKILL, 'utf8')

  for (const owned of PLAN_PHASE_OWNED) {
    assert.ok(
      protocol.includes(owned),
      `precondition: skills/plan-phase/SKILL.md must own "${owned}" — it was reworded or removed there, so this guard would pass on nothing; re-anchor PLAN_PHASE_OWNED to the skill's current text`,
    )
    assert.ok(
      !prompt.includes(owned),
      `"${owned}" belongs to skills/plan-phase/SKILL.md — the plan prompt restating it forks the protocol and makes the eval scorecard's planner cells compare briefings rather than models; fix cli/commands/codex.mjs buildPlanPrompt (deliver the skill, override only disposition)`,
    )
  }
})

test('every lane prints the poll command that actually reads ITS journal', () => {
  const root = tmpRepo()
  const brief = writeBrief(root)
  writePhase(root, 111)
  // Each case gets its OWN worktree: the fake codex is detached, and a launch into a worktree
  // whose previous fake has not yet exited is refused by the cross-lane liveness guard.
  fakeLaunchEnv(root, join(root, 'wt-poll-110'))
  fakeLaunchEnv(root, join(root, 'wt-poll-111-run'))
  const env = fakeLaunchEnv(root, join(root, 'wt-poll-111'))

  // The launcher's own hint is the only poll instruction most callers ever see. A hint naming a
  // lane other than the one just launched sends them to `no journal covers` on a live run.
  const cases = [
    ['plan', ['plan', '110', '--brief', brief, '--worktree', join(root, 'wt-poll-110')], /status 110 --plan/],
    ['review', ['review', '111', '--worktree', join(root, 'wt-poll-111')], /status 111 --review/],
    ['run', ['run', '111', '--worktree', join(root, 'wt-poll-111-run')], /status 111(?! --)/],
  ]
  for (const [lane, args, expected] of cases) {
    const r = spawnSync('node', [BIN, 'codex', ...args], { cwd: root, encoding: 'utf8', env })
    assert.equal(r.status, 0, `${lane}: ${r.stderr}`)
    assert.match(r.stderr, expected, `the ${lane} lane must print the poll command that reads its OWN journal — fix the poll hint in cli/commands/codex.mjs launch()`)
  }
})

test('status: `report` is the resolved PATH, never the journal\'s bare report name', () => {
  const root = tmpRepo()
  const worktree = join(root, 'wt-report-112')
  mkdirSync(worktree, { recursive: true })
  // A journal carrying `report` — every journal written since the review lane landed does.
  writeFileSync(
    join(root, '.building', 'codex-review-112.json'),
    JSON.stringify({ phases: ['112'], lane: 'review', report: 'CODEX-REVIEW.md', worktree, pgid: 999999999, startedAt: new Date(Date.now() - 60_000).toISOString() }) + '\n',
  )
  const reportPath = join(worktree, 'CODEX-REVIEW.md')
  writeFileSync(reportPath, 'findings\nCODEX-RUN-COMPLETE\n')

  const fresh = spawnSync('node', [BIN, 'codex', 'status', '112', '--review'], { cwd: root, encoding: 'utf8' })
  assert.equal(fresh.status, 0, fresh.stderr)
  assert.equal(
    JSON.parse(fresh.stdout).report,
    reportPath,
    'a reader given `CODEX-REVIEW.md` cannot open it — the journal must not overwrite the path status resolved; fix the output spread order in cli/commands/codex.mjs statusCodex',
  )

  // And the stale case must still read null: a report older than the launch is a PREVIOUS run's
  // hand-off, and reporting a name there is indistinguishable from a fresh verdict.
  backdate(reportPath)
  const stale = spawnSync('node', [BIN, 'codex', 'status', '112', '--review'], { cwd: root, encoding: 'utf8' })
  const out = JSON.parse(stale.stdout)
  assert.equal(out.report, null, 'a stale report is not this run\'s verdict, and `report` must say so')
  assert.equal(out.staleReport, reportPath, 'the stale report is surfaced, not silently dropped')
})

test('status: when TWO other lanes cover the ids, each gets its own runnable command', () => {
  const root = tmpRepo()
  // A phase that was codex-planned AND codex-reviewed — the realistic multi-lane case.
  for (const [lane, prefix, report] of [['review', 'codex-review-', 'CODEX-REVIEW.md'], ['plan', 'codex-plan-', 'CODEX-PLAN.md']]) {
    const worktree = join(root, `wt-${lane}-113`)
    mkdirSync(worktree, { recursive: true })
    writeFileSync(
      join(root, '.building', `${prefix}113.json`),
      JSON.stringify({ phases: ['113'], lane, report, worktree, pgid: 999999999, startedAt: new Date().toISOString() }) + '\n',
    )
  }
  const r = spawnSync('node', [BIN, 'codex', 'status', '113'], { cwd: root, encoding: 'utf8' })
  assert.equal(r.status, 1, 'run-lane status still must not adopt another lane\'s journal')

  // Concatenating the flags into one command is the trap: run()'s selector takes the FIRST
  // LANES match, so `status 113 --review --plan` silently means --review and the plan journal the
  // reader was just pointed at is never shown.
  assert.doesNotMatch(
    r.stderr,
    /--review --plan|--plan --review/,
    `the flags are ALTERNATIVES — one command per covering lane, never a concatenation nobody can run as printed; got: ${r.stderr}`,
  )
  assert.match(r.stderr, /roadmap codex status 113 --review/, `the review lane needs its own runnable command; got: ${r.stderr}`)
  assert.match(r.stderr, /roadmap codex status 113 --plan/, `and so does the plan lane; got: ${r.stderr}`)
})

test('an ABSOLUTE --brief is honored, and one pointing outside the checkout is refused', () => {
  const root = tmpRepo()
  const brief = writeBrief(root)
  const abs = join(root, brief)
  const worktree = join(root, 'wt-plan-114')
  const env = fakeLaunchEnv(root, worktree)

  // join(root, '/abs/path') yields '<root>/abs/path', so an absolute brief that EXISTS would
  // refuse as missing — naming a path the caller can see on disk. --worktree beside it takes
  // absolute paths everywhere in this file.
  const r = spawnSync('node', [BIN, 'codex', 'plan', '114', '--brief', abs, '--worktree', worktree], { cwd: root, encoding: 'utf8', env })
  assert.equal(r.status, 0, `an absolute --brief that exists must launch, not refuse as missing; stderr: ${r.stderr}`)
  assert.equal(readFileSync(join(worktree, brief), 'utf8'), readFileSync(abs, 'utf8'), 'and it must still be carried into the worktree')

  // Outside the checkout the carry-in would write OUTSIDE the worktree — refuse by name.
  const outside = join(tmpdir(), 'codex-outside-brief.md')
  writeFileSync(outside, '# not in this repo\n')
  cleanups.push(() => rmSync(outside, { force: true }))
  const esc = spawnSync('node', [BIN, 'codex', 'plan', '115', '--brief', outside, '--worktree', join(root, 'wt-plan-115')], { cwd: root, encoding: 'utf8', env })
  assert.notEqual(esc.status, 0, 'a brief outside the checkout must not be planned from')
  assert.match(esc.stderr, /inside this checkout/, `the refusal must say WHY; got: ${esc.stderr}`)
})

test('two lane flags are refused as alternatives, never first-match-wins', () => {
  const root = tmpRepo()
  const r = spawnSync('node', [BIN, 'codex', 'status', '116', '--review', '--plan'], { cwd: root, encoding: 'utf8' })
  assert.equal(r.status, 1, 'a command naming two lanes asks for something impossible — it must not silently pick one')
  assert.match(r.stderr, /alternatives/, `the refusal must name the conflict; got: ${r.stderr}`)
  assert.match(r.stderr, /--review and --plan|--plan and --review/, `and name BOTH flags it saw; got: ${r.stderr}`)
})

test('plan: a phase file present on --base but not on the primary is still refused', () => {
  const root = tmpRepo()
  const brief = writeBrief(root)
  const worktree = join(root, 'wt-plan-117')
  const env = fakeLaunchEnv(root, worktree)
  // Only the worktree holds the file, so the primary-checkout guard passes and the worktree-side
  // one must catch it: otherwise the planner's one-file target clobbers a real plan and still
  // audits as one commit against one file.
  mkdirSync(join(worktree, 'roadmap', 'phases'), { recursive: true })
  const planted = join(worktree, 'roadmap', 'phases', 'phase-117.phase.ts')
  writeFileSync(planted, 'export default { real: true }\n')
  assert.ok(!existsSync(join(root, 'roadmap', 'phases', 'phase-117.phase.ts')), 'precondition: the primary must NOT have it, or this tests the other guard')

  const r = spawnSync('node', [BIN, 'codex', 'plan', '117', '--brief', brief, '--worktree', worktree], { cwd: root, encoding: 'utf8', env })
  assert.notEqual(r.status, 0, 'the number is taken on the branch the planner will work from')
  assert.match(r.stderr, /already exists/, `the collision must be named; got: ${r.stderr}`)
  // Not on base: the cause is a PREDECESSOR run's own output, and telling the operator to burn a
  // fresh number would duplicate the plan instead of harvesting the commit that already has it.
  assert.match(r.stderr, /previous plan run|harvest/, `the message must name the cause it can prove; got: ${r.stderr}`)
  assert.equal(readFileSync(planted, 'utf8'), 'export default { real: true }\n', 'the existing plan is untouched')
  assert.ok(!existsSync(join(root, '.building', 'codex-plan-117.json')), 'a refused launch must journal nothing')
})

test('repoRelative: an unnormalized relative escape is refused, and a legal ..-prefixed name is not', () => {
  const root = tmpRepo()
  const worktree = join(root, 'wt-plan-118')
  const env = fakeLaunchEnv(root, worktree)

  // `docs/../../out.md` never starts with '..' as written, but resolves outside the checkout —
  // a raw startsWith test passes it straight through to a carry-in that writes outside the worktree.
  const outside = join(dirname(root), 'codex-escape-brief.md')
  writeFileSync(outside, '# outside\n')
  cleanups.push(() => rmSync(outside, { force: true }))
  mkdirSync(join(root, 'docs'), { recursive: true })
  const sneaky = `docs/../../${'codex-escape-brief.md'}`
  assert.ok(existsSync(join(root, sneaky)), 'precondition: the escaping path must actually resolve to a real file, or this proves nothing')
  const esc = spawnSync('node', [BIN, 'codex', 'plan', '118', '--brief', sneaky, '--worktree', worktree], { cwd: root, encoding: 'utf8', env })
  assert.notEqual(esc.status, 0, 'an unnormalized relative path that resolves outside the checkout must be refused')
  assert.match(esc.stderr, /inside this checkout/, `got: ${esc.stderr}`)

  // And the mirror: a file INSIDE whose name merely begins with two dots is legal.
  const dotted = '..config.md'
  writeFileSync(join(root, dotted), '# a legal name\n')
  const ok = spawnSync('node', [BIN, 'codex', 'plan', '119', '--brief', dotted, '--worktree', join(root, 'wt-plan-119')], {
    cwd: root,
    encoding: 'utf8',
    env: fakeLaunchEnv(root, join(root, 'wt-plan-119')),
  })
  assert.equal(ok.status, 0, `a path inside the checkout must not be refused for how its name is spelled; stderr: ${ok.stderr}`)
})

test('a lane flag contradicting its subcommand is refused, not ignored', () => {
  const root = tmpRepo()
  writePhase(root, 120)
  const worktree = join(root, 'wt-contradict-120')
  const env = fakeLaunchEnv(root, worktree)
  // `review 120 --plan` asks for two different lanes. Silently launching a review is the same
  // drop-contradictory-input class as the two-flag case.
  const r = spawnSync('node', [BIN, 'codex', 'review', '120', '--plan', '--worktree', worktree], { cwd: root, encoding: 'utf8', env })
  assert.equal(r.status, 1, `got status ${r.status}: ${r.stderr}`)
  assert.match(r.stderr, /contradicts/, `the refusal must name the contradiction; got: ${r.stderr}`)
  assert.ok(!existsSync(join(root, '.building', 'codex-review-120.json')), 'a refused launch must journal nothing')

  // The redundant-but-consistent form still works: the flag agrees with the subcommand.
  const agree = spawnSync('node', [BIN, 'codex', 'review', '120', '--review', '--worktree', worktree], { cwd: root, encoding: 'utf8', env })
  assert.equal(agree.status, 0, `a flag AGREEING with its subcommand is not a contradiction; stderr: ${agree.stderr}`)
})

// ── refuseIfLive: the same-lane journal read must be GUARDED, not a raw JSON.parse ────────
// A journal the lookup declines — truncated mid-write, or parsing to something that is not a
// journal object — must reach the operator as a NAMED error carrying the file and the delete-
// and-relaunch remedy, the way findJournal already serves every other caller. The failure these
// pin is a raw, unnamed SyntaxError with no path and no remedy, or an internal
// lookup-disagreement throw that blames the code for a file's contents.

test('refuseIfLive — a truncated same-lane journal never reports raw SyntaxError', () => {
  const root = tmpRepo()
  const brief = writeBrief(root)
  const worktree = join(root, 'wt-plan-900')
  const env = fakeLaunchEnv(root, worktree)
  const jPath = join(root, '.building', 'codex-plan-900.json')
  // A launch that died mid-write: valid JSON prefix, then nothing.
  writeFileSync(jPath, '{"phases":["900"],"pgid":')

  const r = spawnSync('node', [BIN, 'codex', 'plan', '900', '--brief', brief, '--worktree', worktree], { cwd: root, encoding: 'utf8', env })

  assert.notEqual(r.status, 0, `a truncated same-lane journal must refuse the relaunch, not silently proceed; stderr: ${r.stderr}`)
  assert.ok(
    !existsSync(join(root, '.building', 'codex-plan-900-prompt.txt')),
    'a refused relaunch must never spawn — the prompt file is only written by launch()',
  )
  assert.ok(
    r.stderr.includes('JournalUnreadableError'),
    `a truncated journal must be diagnosed by its own named class, the way findJournal's callers already are; got: ${r.stderr}`,
  )
  assert.ok(
    r.stderr.includes(jPath),
    `the diagnostic must NAME the exact journal file refuseIfLive choked on (${jPath}) — a path-less report sends the reader hunting; got: ${r.stderr}`,
  )
  assert.ok(
    r.stderr.includes('delete it if that run is gone'),
    `the diagnostic must carry the deletion/relaunch remedy JournalUnreadableError already states for every other caller; got: ${r.stderr}`,
  )
  assert.ok(
    !r.stderr.includes('SyntaxError'),
    `refuseIfLive must never let the bare JSON.parse failure surface as the whole diagnostic (it may appear only as a wrapped cause detail, never as the unnamed report itself); got: ${r.stderr}`,
  )
})

test('refuseIfLive — a well-formed dead-pgid same-lane journal still relaunches (the fix must not refuse everything)', () => {
  const root = tmpRepo()
  const brief = writeBrief(root)
  const worktree = join(root, 'wt-plan-901')
  const env = fakeLaunchEnv(root, worktree)
  const jPath = join(root, '.building', 'codex-plan-901.json')
  writeFileSync(
    jPath,
    JSON.stringify({
      phases: ['901'],
      lane: 'plan',
      worktree,
      base: 'develop',
      pgid: 999999999, // never a live group
      log: join(root, '.building', 'x.log'),
      startedAt: new Date().toISOString(),
    }) + '\n',
  )

  const r = spawnSync('node', [BIN, 'codex', 'plan', '901', '--brief', brief, '--worktree', worktree], { cwd: root, encoding: 'utf8', env })

  assert.equal(r.status, 0, `a well-formed dead-pgid same-lane journal must still relaunch; stderr: ${r.stderr}`)
  assert.match(
    r.stderr,
    /previous run \(pgid 999999999\) is dead — relaunching/,
    `the existing dead-pgid relaunch diagnostic must still fire — a fix that refuses every same-lane journal (corrupt or not) passes the test above for the wrong reason; got: ${r.stderr}`,
  )
})

test('refuseIfLive — a readable ARC journal covering these ids never masks an unreadable exact journal', () => {
  // findJournal answers with the multi-phase journal when the exact name is absent — but when
  // the exact name is PRESENT and corrupt, that broader answer would let the launch proceed and
  // overwrite the very file whose liveness could not be read. The exact journal owns the
  // same-lane question; the arc journal is the worktree-level check's business.
  const root = tmpRepo()
  const brief = writeBrief(root)
  const worktree = join(root, 'wt-plan-910')
  const env = fakeLaunchEnv(root, worktree)
  const exact = join(root, '.building', 'codex-plan-910.json')
  writeFileSync(exact, '{"phases":["910"],"pgid":')
  writeFileSync(
    join(root, '.building', 'codex-plan-910-911.json'),
    JSON.stringify({
      phases: ['910', '911'],
      lane: 'plan',
      worktree: join(root, 'wt-plan-910-911'),
      base: 'develop',
      pgid: 999999999, // dead, and readable — the mask
      log: join(root, '.building', 'x.log'),
      startedAt: new Date().toISOString(),
    }) + '\n',
  )

  const r = spawnSync('node', [BIN, 'codex', 'plan', '910', '--brief', brief, '--worktree', worktree], { cwd: root, encoding: 'utf8', env })

  assert.notEqual(r.status, 0, `the unreadable exact journal must still refuse; stderr: ${r.stderr}`)
  assert.ok(
    !existsSync(join(root, '.building', 'codex-plan-910-prompt.txt')),
    'a refused relaunch must never spawn — the prompt file is only written by launch()',
  )
  assert.ok(r.stderr.includes('JournalUnreadableError'), `the named class must survive the arc journal beside it; got: ${r.stderr}`)
  assert.ok(r.stderr.includes(exact), `the EXACT journal is the one that could not be read — it must be the one named; got: ${r.stderr}`)
})

test('refuseIfLive — the same-lane check reads the EXACT journal, leaving an arc journal to the worktree guard', () => {
  // The worktree-level guard is the only one that names the FILE holding the live run. Widening
  // the same-lane read to any journal covering these ids would shadow it with a message that
  // never says which journal to look at.
  const root = tmpRepo()
  const brief = writeBrief(root)
  const worktree = join(root, 'wt-plan-920')
  const env = fakeLaunchEnv(root, worktree)
  const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' })
  child.unref()
  cleanups.push(() => {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {}
  })
  writeFileSync(
    join(root, '.building', 'codex-plan-920-921.json'),
    JSON.stringify({
      phases: ['920', '921'],
      lane: 'plan',
      worktree,
      base: 'develop',
      pgid: child.pid,
      log: join(root, '.building', 'x.log'),
      startedAt: new Date().toISOString(),
    }) + '\n',
  )

  const r = spawnSync('node', [BIN, 'codex', 'plan', '920', '--brief', brief, '--worktree', worktree], { cwd: root, encoding: 'utf8', env })

  assert.equal(r.status, 2, `a live run in this worktree is a proven double-run (exit 2); stderr: ${r.stderr}`)
  assert.match(
    r.stderr,
    /journal codex-plan-920-921\.json has a LIVE run .* in this worktree — refusing/,
    `the refusal must name the journal file holding the live run; got: ${r.stderr}`,
  )
})

test('refuseIfLive — a journal parsing to a FALSY literal is unreadable, not a lookup disagreement', () => {
  // JSON.parse succeeds on `null`, so the value passed the try/catch while failing the truthiness
  // check that decides whether a journal was found. The launch guard then re-read a file that
  // parses and blamed the CODE — an operator staring at "fix the lookup" gets no remedy for the
  // file that is actually at fault.
  const root = tmpRepo()
  const brief = writeBrief(root)
  const worktree = join(root, 'wt-plan-930')
  const env = fakeLaunchEnv(root, worktree)
  const jPath = join(root, '.building', 'codex-plan-930.json')
  writeFileSync(jPath, 'null\n')

  const r = spawnSync('node', [BIN, 'codex', 'plan', '930', '--brief', brief, '--worktree', worktree], { cwd: root, encoding: 'utf8', env })

  assert.notEqual(r.status, 0, `a journal that carries no pgid cannot clear a live run; stderr: ${r.stderr}`)
  assert.ok(
    !existsSync(join(root, '.building', 'codex-plan-930-prompt.txt')),
    'a refused relaunch must never spawn — the prompt file is only written by launch()',
  )
  assert.ok(r.stderr.includes('JournalUnreadableError'), `the FILE is at fault, so it earns the file's error; got: ${r.stderr}`)
  assert.ok(r.stderr.includes(jPath), `named concretely; got: ${r.stderr}`)
  assert.ok(r.stderr.includes('delete it if that run is gone'), `with the remedy that actually applies; got: ${r.stderr}`)
  assert.ok(
    !/fix the lookup/.test(r.stderr),
    `and never the lookup-disagreement diagnostic, which sends the reader to debug working code; got: ${r.stderr}`,
  )
})

test('refuseIfLive — an UNREADABLE arc journal covering these ids refuses, and the message says covering, not same-lane', () => {
  // Readability is not scoped the way liveness is: a covering journal nobody can parse cannot be
  // shown to be dead, so it refuses even with no exact journal on disk. The wording has to match
  // — naming a "same-lane journal" that does not exist sends the reader looking for the wrong file.
  const root = tmpRepo()
  const brief = writeBrief(root)
  const worktree = join(root, 'wt-plan-940')
  const env = fakeLaunchEnv(root, worktree)
  const arcPath = join(root, '.building', 'codex-plan-940-941.json')
  writeFileSync(arcPath, '{"phases":["940","941"],"pgid":')
  assert.ok(!existsSync(join(root, '.building', 'codex-plan-940.json')), 'fixture: there is NO exact same-lane journal')

  const r = spawnSync('node', [BIN, 'codex', 'plan', '940', '--brief', brief, '--worktree', worktree], { cwd: root, encoding: 'utf8', env })

  assert.notEqual(r.status, 0, `an unreadable covering journal cannot be proven dead; stderr: ${r.stderr}`)
  assert.ok(
    !existsSync(join(root, '.building', 'codex-plan-940-prompt.txt')),
    'a refused relaunch must never spawn — the prompt file is only written by launch()',
  )
  assert.ok(r.stderr.includes('JournalUnreadableError'), `the named class; got: ${r.stderr}`)
  assert.ok(r.stderr.includes(arcPath), `naming the ARC journal it could not read; got: ${r.stderr}`)
  assert.ok(
    !/same-lane journal/.test(r.stderr),
    `no exact same-lane journal exists here, so calling it one names a file the operator will not find; got: ${r.stderr}`,
  )
})

test('refuseIfLive — a journal parsing to a TRUTHY non-object never reads as a dead run', () => {
  // Falsiness is the wrong test. `[]`, `"text"`, `42` and `true` all parse and are truthy, so a
  // truthiness-only guard hands them to the launch path as a journal — where `j.pgid` is
  // undefined, which reads as "previous run is dead" and RELAUNCHES over a file nobody could
  // read. That is precisely the "cannot be shown to be dead" hazard this guard exists to stop.
  for (const [label, body] of [['an array', '[]'], ['a string', '"text"'], ['a number', '42'], ['a boolean', 'true']]) {
    const root = tmpRepo()
    const brief = writeBrief(root)
    const worktree = join(root, `wt-plan-950-${label.replace(/\W+/g, '')}`)
    const env = fakeLaunchEnv(root, worktree)
    const jPath = join(root, '.building', 'codex-plan-950.json')
    writeFileSync(jPath, `${body}\n`)

    const r = spawnSync('node', [BIN, 'codex', 'plan', '950', '--brief', brief, '--worktree', worktree], { cwd: root, encoding: 'utf8', env })

    assert.ok(
      !existsSync(join(root, '.building', 'codex-plan-950-prompt.txt')),
      `${label}: a journal that cannot be read must never be launched over — the prompt file proves launch() ran; stderr: ${r.stderr}`,
    )
    assert.notEqual(r.status, 0, `${label}: and the launch is refused; stderr: ${r.stderr}`)
    assert.ok(r.stderr.includes('JournalUnreadableError'), `${label}: with the file's own named error; got: ${r.stderr}`)
    assert.ok(r.stderr.includes(jPath), `${label}: naming the file; got: ${r.stderr}`)
    assert.ok(
      !/pgid undefined/.test(r.stderr),
      `${label}: it must never be narrated as a dead run with no pgid; got: ${r.stderr}`,
    )
  }
})

test('findJournal — an OBJECT still parses through; only non-objects are unreadable', () => {
  // The boundary must not over-refuse: an object missing `phases` is a different question (the
  // coverage check answers it), and narrowing to "must have phases" here would change what the
  // scan means rather than what readability means.
  const root = tmpRepo()
  writeJournal(root, [960])
  assert.ok(mod_findJournal(root, [960], 'run'), 'a well-formed journal object still resolves')

  writeFileSync(join(root, '.building', 'codex-961.json'), '{}\n')
  const empty = mod_findJournal(root, [961], 'run')
  assert.ok(empty, 'an OBJECT with no phases is readable — the exact-name branch still answers with it')
  assert.deepEqual(empty.journal, {}, 'and it comes back verbatim, not coerced')
})

test('refuseIfLive — a declined-but-parseable journal MASKED by a covering one still blames the FILE, not the lookup', () => {
  // The lookup declines two different ways: a file that will not parse, and a file that parses
  // to something that is not a journal. When a readable covering journal masks the throw, the
  // launch guard re-reads the exact file — and if it only asks "did it parse?", the second kind
  // comes back parseable and it accuses the CODE, withholding the delete-and-relaunch remedy
  // from an operator whose file is the whole problem.
  for (const body of ['[]', '"text"', '42', 'true']) {
    const root = tmpRepo()
    const brief = writeBrief(root)
    const worktree = join(root, 'wt-plan-970')
    const env = fakeLaunchEnv(root, worktree)
    const exact = join(root, '.building', 'codex-plan-970.json')
    writeFileSync(exact, `${body}\n`)
    writeFileSync(
      join(root, '.building', 'codex-plan-970-971.json'),
      JSON.stringify({
        phases: ['970', '971'],
        lane: 'plan',
        worktree: join(root, 'wt-plan-970-971'),
        base: 'develop',
        pgid: 999999999, // dead and READABLE — the mask
        log: join(root, '.building', 'x.log'),
        startedAt: new Date().toISOString(),
      }) + '\n',
    )

    const r = spawnSync('node', [BIN, 'codex', 'plan', '970', '--brief', brief, '--worktree', worktree], { cwd: root, encoding: 'utf8', env })

    assert.notEqual(r.status, 0, `${body}: the declined exact journal still refuses; stderr: ${r.stderr}`)
    assert.ok(
      !existsSync(join(root, '.building', 'codex-plan-970-prompt.txt')),
      `${body}: and never launches; stderr: ${r.stderr}`,
    )
    assert.ok(r.stderr.includes('JournalUnreadableError'), `${body}: the FILE's named error; got: ${r.stderr}`)
    assert.ok(r.stderr.includes(exact), `${body}: naming the exact file, not the mask; got: ${r.stderr}`)
    assert.ok(r.stderr.includes('delete it if that run is gone'), `${body}: with the remedy that applies; got: ${r.stderr}`)
    assert.ok(
      !/fix the lookup/.test(r.stderr),
      `${body}: never the internal disagreement throw — the lookup is working exactly as written; got: ${r.stderr}`,
    )
  }
})

// ── the review lane's done-moment: consuming the verdict archives the lane ─────
// A REVIEW lane is a detached read-only worktree. It never commits, never lands, never merges —
// so it has no done-VERB, and such worktrees outlive their verdicts indefinitely. The operator
// ruling forbids both a standalone close/sweep verb and a timer reaper, which leaves exactly
// one honest done-moment: the verdict being CONSUMED. So
// `codex status` gains a completion SIDE EFFECT deliberately — reading a COMPLETE review lane
// IS that lane's close. The tests below pin the three things that makes safe: the verdict must
// SURVIVE the disposal (relocated, byte-identical, readable forever), the disposal must go
// through the shared rail (refusing rather than destroying), and NOTHING non-complete may fire
// it — least of all a sentinel the stale-report mtime guard already rejected.

/**
 * A REAL detached review worktree, made the way reviewCodex makes one (`git worktree add
 * --detach`, no branch), plus its journal in the PRIMARY `.building/`. Real because the archival
 * runs through disposeWorktree, whose every answer — dirty, unpushed, alreadyDisposed — is read
 * off actual git state; a mkdir stand-in would let a broken disposal look clean.
 *
 * `develop` is created so the rail's default integrationRef resolves: without it a branch handed
 * to the rail could never test as merged, and the "this lane owns NO branch" assertions below
 * would pass on a rail that simply failed to delete.
 */
function reviewLane(root, ids, { body = 'findings\nCODEX-RUN-COMPLETE\n', startedAt = new Date(Date.now() - 60_000).toISOString(), pgid = 999999999 } = {}) {
  const git = (...args) =>
    execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  writeFileSync(join(root, 'seed.txt'), 'seed\n')
  git('add', 'seed.txt')
  git('commit', '-q', '-m', 'seed')
  git('branch', '-f', 'develop')
  const worktree = join(root, `wt-review-${ids.join('-')}`)
  git('worktree', 'add', '--detach', '-q', worktree, 'HEAD')
  const jPath = join(root, '.building', `codex-review-${ids.join('-')}.json`)
  writeFileSync(
    jPath,
    JSON.stringify(
      { phases: ids.map(String), lane: 'review', report: 'CODEX-REVIEW.md', worktree, base: 'HEAD', pgid, log: join(root, '.building', 'x.log'), startedAt },
      null,
      2,
    ) + '\n',
  )
  const reportPath = join(worktree, 'CODEX-REVIEW.md')
  if (body !== null) writeFileSync(reportPath, body)
  return { worktree, jPath, reportPath, git, archived: join(root, '.building', `codex-review-${ids.join('-')}-REPORT.md`) }
}

/** `codex status <ids…>` under an explicit lane flag. */
function laneStatus(root, ids, ...flags) {
  const r = spawnSync('node', [BIN, 'codex', 'status', ...ids.map(String), ...flags], { cwd: root, encoding: 'utf8' })
  return { code: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr }
}

function journalOf(lane) {
  return JSON.parse(readFileSync(lane.jPath, 'utf8'))
}

/** The whole no-side-effect claim in one place: nothing copied, nothing stamped, nothing removed. */
function assertLaneUntouched(lane, why) {
  assert.ok(!existsSync(lane.archived), `${why}: no report may be relocated — ${lane.archived} exists`)
  const j = journalOf(lane)
  assert.equal(j.archivedAt, undefined, `${why}: the journal must carry no archivedAt — got ${j.archivedAt}`)
  assert.equal(j.archivedReport, undefined, `${why}: the journal must carry no archivedReport — got ${j.archivedReport}`)
  assert.ok(existsSync(lane.worktree), `${why}: the worktree must survive — ${lane.worktree} was removed`)
}

test('review archive: a COMPLETE lane self-archives on the first status read', () => {
  const root = tmpRepo()
  const lane = reviewLane(root, [200])
  const verdict = readFileSync(lane.reportPath, 'utf8')
  // A detached review lane owns NO branch. These two are the names a lane-branch convention would
  // produce, and both are merged into develop, so a disposal handed a branch WOULD delete them.
  lane.git('branch', 'codex-review/200')
  lane.git('branch', 'codex/200')

  const { code, out, err } = laneStatus(root, [200], '--review')

  assert.equal(out?.state, 'complete', `the verdict is still the verdict; stderr: ${err}`)
  assert.equal(code, 0, `a consumed COMPLETE review exits 0; stderr: ${err}`)
  assert.ok(
    existsSync(lane.archived),
    `the verdict must be COPIED into the primary's .building/ before the worktree goes — expected ${lane.archived}; fix statusCodex in cli/commands/codex.mjs`,
  )
  assert.equal(readFileSync(lane.archived, 'utf8'), verdict, 'the relocated verdict is byte-identical — a summarized or re-rendered copy is a second source of truth')
  assert.equal(
    out.report,
    lane.archived,
    `\`report\` must be the RELOCATED path: a reader handed a path inside a removed worktree cannot open it; got ${out.report}`,
  )
  assert.ok(!existsSync(lane.worktree), `the review worktree's done-moment has passed — ${lane.worktree} must be disposed`)
  assert.ok(
    !lane.git('worktree', 'list', '--porcelain').includes(lane.worktree),
    'the disposal must go through disposeWorktree (remove + prune), never an rmSync — a hand-deleted directory leaves its repo metadata haunting `git worktree list`',
  )

  const j = journalOf(lane)
  assert.ok(existsSync(lane.jPath), 'the journal keeps its codex-review-<ids>.json NAME — renaming it is how findJournal loses the archived lane and the second read regresses to "no journal covers"')
  assert.ok(Number.isFinite(Date.parse(j.archivedAt)), `the journal must be STAMPED with an ISO archivedAt — got ${JSON.stringify(j.archivedAt)}`)
  assert.equal(j.archivedReport, lane.archived, `archivedReport must be the ABSOLUTE relocated path — got ${JSON.stringify(j.archivedReport)}`)

  const branches = lane.git('branch', '--list')
  assert.match(branches, /codex-review\/200/, 'a detached review lane owns no branch — the archival must never hand one to the rail')
  assert.match(branches, /codex\/200/, 'nor the run lane\'s branch name — disposeWorktree deletes a merged branch it is given')
})

test('review archive: the disposal is untracked-tolerant — a carried-in --doc never refuses the archive', () => {
  const root = tmpRepo()
  const lane = reviewLane(root, [201])
  // Everything a real review lane leaves behind is untracked: its own CODEX-REVIEW.md, and the
  // --doc copy carryIn() writes in. The lane never commits, so none of it is work — but the rail
  // refuses on ANY untracked file unless the caller says untrackedTolerant.
  mkdirSync(join(lane.worktree, 'docs'), { recursive: true })
  writeFileSync(join(lane.worktree, 'docs', 'RELEASE-PLAN.md'), '# the release plan\n')
  writeFileSync(join(lane.worktree, 'scratch-notes.md'), 'reading notes\n')

  const { code, out, err } = laneStatus(root, [201], '--review')

  assert.equal(out?.state, 'complete', `stderr: ${err}`)
  assert.equal(code, 0, `stderr: ${err}`)
  assert.ok(
    !existsSync(lane.worktree),
    `a review lane's untracked leftovers are copies and notes, never work — disposeWorktree must be called with untrackedTolerant: true or EVERY review lane refuses on its own carried-in files; stderr: ${err}`,
  )
})

test('review archive: a refused disposal still delivers the verdict, and says why the worktree stayed', () => {
  const root = tmpRepo()
  const lane = reviewLane(root, [202])
  const verdict = readFileSync(lane.reportPath, 'utf8')
  // A MODIFIED TRACKED file is the one thing a read-only lane should never have produced — so it
  // is unexplained work, and the rail refuses. The verdict is what the operator came for; it must
  // not be held hostage to the cleanup.
  writeFileSync(join(lane.worktree, 'seed.txt'), 'the reviewer edited a tracked file\n')

  const { code, out, err } = laneStatus(root, [202], '--review')

  assert.equal(out?.state, 'complete', `a refused CLEANUP is not a refused verdict; stderr: ${err}`)
  assert.equal(code, 0, `and it still exits 0; stderr: ${err}`)
  assert.ok(existsSync(lane.archived), `the verdict is relocated regardless of the disposal's answer — expected ${lane.archived}`)
  assert.equal(readFileSync(lane.archived, 'utf8'), verdict, 'byte-identical, refusal or not')
  // WHICH copy `report` names here is the one thing the contract leaves open, and pinning it to
  // the relocated path would fork the pre-existing `report` is the resolved PATH test (whose
  // review lane's disposal also refuses). The invariant that actually matters is the one the
  // relocation exists to serve: `report` must name a path the reader can OPEN.
  assert.ok(existsSync(out.report), `\`report\` must name a path that exists — a reader cannot open ${out.report}`)
  assert.equal(readFileSync(out.report, 'utf8'), verdict, 'and opening it must yield the verdict, whichever copy it names')
  assert.ok(Number.isFinite(Date.parse(journalOf(lane).archivedAt)), 'the journal is stamped: the verdict HAS been consumed, whatever happened to the directory')

  assert.ok(existsSync(lane.worktree), `${lane.worktree} carries a modified TRACKED file — disposing it would destroy the only copy`)
  assert.ok(existsSync(join(lane.worktree, 'seed.txt')), 'and the file that blocked it is untouched')
  assert.equal(
    readFileSync(lane.reportPath, 'utf8'),
    verdict,
    'the relocation is a COPY, never a move — a worktree that survived its disposal must keep its own verdict, or the operator sent there to resolve the refusal finds the report gone',
  )
  assert.ok(
    err.includes(lane.worktree),
    `the refusal must NAME the worktree the operator now has to deal with — a silent survival is how seven of these accumulated; got: ${err}`,
  )
  assert.match(err, /refus|dirty|kept/i, `and say that it was kept rather than removed; got: ${err}`)
  assert.match(
    err,
    /seed\.txt/,
    `and carry the rail's own detail naming the blocking file — reason without detail sends the operator to a directory with no idea what is holding it (the phase land precedent writes both); got: ${err}`,
  )
})

test('review archive: a second status on an archived lane still delivers the verdict', () => {
  const root = tmpRepo()
  const lane = reviewLane(root, [203])
  const verdict = readFileSync(lane.reportPath, 'utf8')

  const first = laneStatus(root, [203], '--review')
  assert.equal(first.out?.state, 'complete', `precondition: the first read archives; stderr: ${first.err}`)
  assert.ok(!existsSync(lane.worktree), 'precondition: the worktree is gone after the first read')
  const stampedAt = journalOf(lane).archivedAt
  const copiedAt = statSync(lane.archived).mtimeMs

  const { code, out, err } = laneStatus(root, [203], '--review')

  assert.equal(out?.state, 'complete', `an archived lane is READABLE FOREVER — a consumed verdict must never decay to dead-no-report; stderr: ${err}`)
  assert.equal(code, 0, `stderr: ${err}`)
  assert.equal(out.report, lane.archived, `and still points at the relocated report; got ${out.report}`)
  assert.equal(readFileSync(lane.archived, 'utf8'), verdict, 'which still holds the verdict')
  assert.ok(
    !/ENOENT|no such file|Error/i.test(err),
    `the second read must not go looking in the removed worktree — the archived-journal path bypasses it entirely; got: ${err}`,
  )
  assert.equal(journalOf(lane).archivedAt, stampedAt, 're-stamping an already-archived lane rewrites when the verdict was consumed')
  assert.equal(statSync(lane.archived).mtimeMs, copiedAt, 'and the report is not re-copied — its source no longer exists')
})

test('review archive: a RUNNING lane is never archived', () => {
  const root = tmpRepo()
  const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' })
  child.unref()
  cleanups.push(() => {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {}
  })
  const lane = reviewLane(root, [204], { body: null, pgid: child.pid })

  const { code, out, err } = laneStatus(root, [204], '--review')

  assert.equal(out?.state, 'running', `precondition: a live group with no report is running; stderr: ${err}`)
  assert.equal(code, 3)
  assertLaneUntouched(lane, 'a running review has not delivered a verdict, so nothing has been consumed')
})

test('review archive: a BLOCKED verdict is not a done-moment', () => {
  const root = tmpRepo()
  const lane = reviewLane(root, [205], { body: 'could not review\nCODEX-RUN-BLOCKED\n' })

  const { code, out, err } = laneStatus(root, [205], '--review')

  assert.equal(out?.state, 'blocked', `precondition: a fresh BLOCKED sentinel is the verdict; stderr: ${err}`)
  assert.equal(code, 2)
  assertLaneUntouched(lane, 'a blocked lane is the one an operator must go READ — archiving it removes the evidence')
  assert.ok(existsSync(lane.reportPath), 'and its report stays where the operator was told to look')
})

test('review archive: a STALE sentinel is not a verdict, so it is not a done-moment either', () => {
  const root = tmpRepo()
  // The stale-sentinel bug in its archival form: a previous run's CODEX-RUN-COMPLETE, older than
  // this journal's startedAt. The mtime guard already refuses to read it as the verdict — and the
  // archival must fire on the VERDICT, not on the file, or the guard is defeated from behind and
  // a live lane's worktree is deleted out from under it.
  const lane = reviewLane(root, [206], { startedAt: new Date().toISOString() })
  backdate(lane.reportPath)

  const { code, out, err } = laneStatus(root, [206], '--review')

  assert.equal(out?.state, 'dead-no-report', `a stale sentinel must not read as a verdict; stderr: ${err}`)
  assert.equal(out.report, null, 'nor be reported as a readable report')
  assert.equal(out.staleReport, lane.reportPath, 'the stale report is surfaced from the WORKTREE, unchanged by the archival path')
  assert.equal(code, 2)
  assertLaneUntouched(lane, 'the freshness guard rejected this sentinel, so the archival must never have seen it')
  assert.equal(readFileSync(lane.reportPath, 'utf8'), 'findings\nCODEX-RUN-COMPLETE\n', 'and the stale hand-off is still on disk, unread and unmoved')
})

// ── the RUN lane's archived journal: a landed lane reads CLOSED, never "no journal" ────────────
// `phase land` renames codex-<ids>.json → codex-<ids>.closed.json (stamped, never deleted) so the
// live-lane scans drop it: the journalRe class /^codex-[\d-]+\.json$/ has no '.' in [\d-]. That
// exclusion is deliberate and correct for the LAUNCH guards — and it makes `codex status <N>`
// exit 1 with "no journal covers phase(s) N" over a journal sitting right there in .building/.

/** The post-land state: a stamped .closed.json, and no worktree (land disposed it). */
function writeClosedJournal(root, ids, extra = {}) {
  const j = {
    phases: ids.map(String),
    lane: 'run',
    report: 'CODEX-REPORT.md',
    worktree: join(root, `wt-${ids.join('-')}`), // removed by the land — deliberately absent
    base: 'develop',
    pgid: 999999999,
    log: join(root, '.building', 'x.log'),
    startedAt: new Date(Date.now() - 3600_000).toISOString(),
    closedAt: new Date().toISOString(),
    closedBy: 'phase land',
    ...extra,
  }
  const path = join(root, '.building', `codex-${ids.join('-')}.closed.json`)
  writeFileSync(path, JSON.stringify(j, null, 2) + '\n')
  return { path, journal: j }
}

test('status: an ARCHIVED run journal reports a CLOSED lane, never "no journal covers"', () => {
  const root = tmpRepo()
  const closed = writeClosedJournal(root, [210])

  const { code, out, err } = status(root, 210)

  assert.ok(
    !/no run journal covers/.test(err),
    `${closed.path} is sitting right there — claiming none covers the phase sends the reader hunting for a run that DID happen and landed; got: ${err}`,
  )
  assert.equal(out?.state, 'closed', `a landed lane's honest state is 'closed'; stderr: ${err}`)
  assert.equal(code, 0, `and a closed lane is not a failure to report; stderr: ${err}`)
  assert.equal(out.closedBy, 'phase land', 'the archived journal\'s fields come back with it — who closed it')
  assert.equal(out.closedAt, closed.journal.closedAt, 'and when')
  assert.deepEqual(out.phases, ['210'], 'and which phases it covered')
})

test('status: a MULTI-PHASE closed journal covers a member id it is not named for', () => {
  const root = tmpRepo()
  // The same two-lookup shape findJournal already has: the exact name, THEN a scan. An arc lands
  // as one journal, so an exact-name-only closed probe reports "no journal covers 212" for every
  // arc member but the first — the arc case regressing in silence.
  const closed = writeClosedJournal(root, [211, 212])

  const { code, out, err } = status(root, 212)

  assert.ok(!/no run journal covers/.test(err), `${closed.path} covers 212 without being named for it alone; got: ${err}`)
  assert.equal(out?.state, 'closed', `an arc member resolves through the closed-journal SCAN, not just the exact name; stderr: ${err}`)
  assert.equal(code, 0, `stderr: ${err}`)
  assert.deepEqual(out.phases, ['211', '212'], 'and it comes back carrying the whole arc it closed')
})

test('status: a phase with NO journal at all still misses — the closed probe manufactures nothing', () => {
  const root = tmpRepo()
  // The falsification for the two tests above: a probe made unconditional would turn every
  // inline session — a phase that never had a lane — into a false 'closed', which is exactly the
  // "landed and cleaned up" claim an unrun phase must never be able to make.
  const { code, out, err } = status(root, 213)

  assert.equal(code, 1, `an absent journal is still a miss; stdout: ${JSON.stringify(out)}`)
  assert.match(err, /no run journal covers/, `with the message that has always named it; got: ${err}`)
  assert.equal(out, null, 'and no state is printed for a lane that never ran')
})

test('review archive: a SECOND review of the same phase archives ITS verdict, never the previous one', () => {
  const root = tmpRepo()
  const lane = reviewLane(root, [207], { body: 'first pass: NEEDS WORK\nCODEX-RUN-COMPLETE\n' })
  assert.equal(laneStatus(root, [207], '--review').out?.state, 'complete', 'precondition: the first review archives')
  assert.ok(!existsSync(lane.worktree), 'precondition: and its worktree is gone')

  // The relaunch: `codex review 207` again writes a FRESH journal (no archivedAt) and a new
  // detached worktree, exactly as reviewCodex does. The archived name is keyed on the ids, so
  // the previous verdict is sitting at the very path this run must write.
  const second = 'second pass: READY\nCODEX-RUN-COMPLETE\n'
  execFileSync('git', ['-C', root, 'worktree', 'add', '--detach', '-q', lane.worktree, 'HEAD'])
  writeFileSync(join(lane.worktree, 'CODEX-REVIEW.md'), second)
  writeFileSync(
    lane.jPath,
    JSON.stringify({ ...journalOf(lane), archivedAt: undefined, archivedReport: undefined, startedAt: new Date(Date.now() - 60_000).toISOString() }) + '\n',
  )

  const { code, out, err } = laneStatus(root, [207], '--review')

  assert.equal(out?.state, 'complete', `stderr: ${err}`)
  assert.equal(code, 0, `stderr: ${err}`)
  assert.equal(
    readFileSync(lane.archived, 'utf8'),
    second,
    'the archived verdict is THIS run\'s — a copy skipped because the path was already occupied leaves `status` serving a superseded review from a lane it just disposed',
  )
  assert.ok(!existsSync(lane.worktree), 'and the second lane is disposed like the first')
})

test('review archive: a disposal refused while the lane was still LIVE is RETRIED on the next status', async () => {
  const root = tmpRepo()
  // Deliberately NOT unref'd, unlike the running-lane test above: this one has to AWAIT the
  // child's exit, and an unref'd handle lets node drain the loop out from under the await
  // (the whole test then cancels with "event loop has already resolved").
  const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' })
  cleanups.push(() => {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {}
  })
  // The reachable window this pins: a driver writes CODEX-RUN-COMPLETE and its process group
  // exits a moment later, and do-phase polls `codex status` in a loop. A poll landing inside that
  // window sees the verdict AND a live group — so the rail correctly refuses 'live'. If the
  // done-moment were one-shot, no later status would ever retry and the worktree would leak
  // forever, with no sweep verb allowed to mop it up.
  const lane = reviewLane(root, [208], { pgid: child.pid })

  const first = laneStatus(root, [208], '--review')
  assert.equal(first.out?.state, 'complete', `precondition: the verdict is complete; stderr: ${first.err}`)
  assert.ok(existsSync(lane.worktree), 'precondition: a LIVE group refuses the disposal, so the worktree stays')
  assert.match(first.err, /live/i, `precondition: and the refusal says so; got: ${first.err}`)
  assert.ok(existsSync(lane.archived), 'the verdict is archived even though the worktree stayed')

  // AWAIT the exit, never a sleep: a SIGKILLed child stays a zombie until node reaps it, and
  // kill(-pgid, 0) succeeds on a zombie group — a timed wait would read as still-live.
  process.kill(-child.pid, 'SIGKILL')
  await once(child, 'exit')

  const { code, out, err } = laneStatus(root, [208], '--review')

  assert.equal(out?.state, 'complete', `stderr: ${err}`)
  assert.equal(code, 0, `stderr: ${err}`)
  assert.ok(
    !existsSync(lane.worktree),
    `the group is dead now, so the retry must dispose — a done-moment that fires once leaves exactly the leak this phase exists to kill; stderr: ${err}`,
  )
})

test('status: a CLOSED lane reports report: null — its worktree, and the report inside it, are gone', () => {
  const root = tmpRepo()
  writeClosedJournal(root, [214])

  const { out } = status(root, 214)

  assert.equal(out.state, 'closed')
  assert.equal(
    out.report,
    null,
    'the journal carries the bare report NAME, and land force-removed that file with the worktree — spreading it unresolved hands the reader a path that exists nowhere',
  )
})

test('review archive: a journal naming a SLOT worktree is never disposed by a status read', () => {
  const root = tmpRepo()
  const lane = reviewLane(root, [209])
  // `codex review 209 --worktree <root>-wt-3` names a provisioned slot (reviewCodex honours
  // --worktree, and ensureWorktree early-returns for a dir that exists). untrackedTolerant means
  // node_modules would not even refuse, and a detached HEAD on develop passes the orphan check —
  // so without the guard a READ command force-removes a slot while the registry keeps a live
  // claim on the deleted path.
  // The slot NAMESPACE is a sibling of the repo root — `${root}-wt-<k>`, ensureWorktree's own
  // construction — not a child. A child named `x-wt-3` is not a slot and must not be treated as one.
  const slot = `${root}-wt-3`
  cleanups.push(() => rmSync(slot, { recursive: true, force: true }))
  execFileSync('git', ['-C', root, 'worktree', 'add', '--detach', '-q', slot, 'HEAD'])
  writeFileSync(join(slot, 'CODEX-REVIEW.md'), 'findings\nCODEX-RUN-COMPLETE\n')
  writeFileSync(lane.jPath, JSON.stringify({ ...journalOf(lane), worktree: slot }) + '\n')

  const { code, out, err } = laneStatus(root, [209], '--review')

  assert.equal(out?.state, 'complete', `the verdict is still delivered; stderr: ${err}`)
  assert.equal(code, 0)
  assert.ok(
    existsSync(slot),
    `a slot is not a review lane: disposing one takes its node_modules and leaves the slot registry holding a live claim on a deleted path; stderr: ${err}`,
  )
})

// ── the next-step hint: a terminal state NAMES the verb that closes it ─────────────────────────
// A dead or finished lane printed its state and stopped there, so recovery was improvised every
// time (the atlas arc hand-finished 9/9 quota deaths; "no resume verb" was the standing
// complaint). The verbs all existed already — the state read simply never named them. So `status`
// gains ONE stderr line, `next:`-prefixed, keyed on the pair (lane, state):
//   run + complete       → `cd <worktree> && roadmap phase land <N>` (the run lane's done-moment)
//   run + dead-no-report → relaunch `roadmap codex run <ids…>` (the RESUME RULE skips done tasks,
//                          and the previous report survives as its .prev twin)
//   run + blocked        → read the report AT ITS PATH, resolve, then the same relaunch
//   plan + complete      → the plan lane's consume read, `roadmap codex status <N> --plan`
//   running              → nothing. There is nothing to do but wait.
//   review (any state)   → nothing. Its done-moment already fired on this very read.
// The hint is stderr-ONLY and pasteable: STDOUT is a parsed stream (do-phase polls it, the gate
// reconcile reads it), so it may gain no key and carry no prose, and a hint holding `<N>` where a
// phase id belongs is a sentence, not a command.

/** `codex status` driven exactly as laneStatus drives it, keeping the RAW stdout bytes as well —
 *  the byte-compatibility case asserts on the stream itself, not only on what it parses to. */
function statusRaw(root, ids, ...flags) {
  const r = spawnSync('node', [BIN, 'codex', 'status', ...ids.map(String), ...flags], { cwd: root, encoding: 'utf8' })
  return { code: r.status, stdout: r.stdout, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr }
}

/** The one stderr line the hint owns, or null. Every other line this command writes is prefixed
 *  `roadmap codex:`; the `next:` key is what lets an operator (and this suite) tell them apart. */
function nextHint(err) {
  return (err ?? '').split('\n').find((l) => l.includes('next:')) ?? null
}

/** A journal pgid is only evidence of a DEAD lane once the group is proven gone — otherwise a
 *  recycled pid turns a dead-lane case into a running one and the assertion below lies. */
function assertGroupDead(pgid, why) {
  assert.throws(() => process.kill(-pgid, 0), `${why}: pgid ${pgid} must be a DEAD process group for this fixture to mean what it says`)
}

/** A live detached group that cannot expire mid-test (a `sleep` can), reaped by the suite's own
 *  cleanup rail. Never awaited: an unref'd child's 'exit' can drain the runner's loop. */
function liveGroup() {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)'], { detached: true, stdio: 'ignore' })
  child.unref()
  cleanups.push(() => {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {}
  })
  return child.pid
}

test('next-step hint: a COMPLETE run lane names its done-moment — `cd <worktree> && roadmap phase land <N>`, pasteable', () => {
  const root = tmpRepo()
  const j = writeJournal(root, [230], { lane: 'run', report: 'CODEX-REPORT.md', startedAt: new Date(Date.now() - 60_000).toISOString() })
  writeFileSync(join(j.worktree, 'CODEX-REPORT.md'), 'per-task shas, gate green\nCODEX-RUN-COMPLETE\n')
  assertGroupDead(j.pgid, 'a finished run is not a live one')

  const { code, out, stdout, err } = statusRaw(root, [230])

  assert.equal(out?.state, 'complete', `precondition: a fresh COMPLETE sentinel is the verdict; stderr: ${err}`)
  assert.equal(code, 0, `and a complete lane still exits 0 — a hint may never be bought with an exit code; stderr: ${err}`)

  const hint = nextHint(err)
  assert.ok(hint, `a COMPLETE run lane has a done-VERB and this read is where the operator learns it; got stderr: ${err}`)
  assert.ok(
    hint.includes('roadmap phase land 230'),
    `the run lane's done-moment lands the work AND disposes the lane — it must be named, with THIS lane's phase id; got: ${hint}`,
  )
  assert.ok(
    hint.includes(`cd ${j.worktree} && roadmap phase land 230`),
    `\`phase land\` resolves its checkout from cwd, so the hint is only runnable with the cd in front of it — expected \`cd ${j.worktree} && roadmap phase land 230\`; got: ${hint}`,
  )
  assert.ok(!/<N>|<worktree>|<ids/.test(hint), `a placeholder is a sentence, not a command — the operator must be able to paste this line; got: ${hint}`)

  // STDOUT is the parsed stream. It may not gain the hint in any form.
  assert.equal(out.state, 'complete', 'stdout still parses, and still carries the state every consumer reads')
  assert.ok(!('next' in out), `the hint is stderr-only: a new key on the parsed object breaks byte-compatibility for every consumer of this stream; got keys ${Object.keys(out).join(',')}`)
  assert.ok(!stdout.includes('next:'), `nor may the hint leak onto stdout as text — it would sit inside the JSON the poll loop parses; got stdout: ${stdout}`)
})

test('next-step hint: a DEAD run lane names the relaunch with ITS OWN ids, and says it resumes rather than redoes', () => {
  const root = tmpRepo()
  // An ARC journal, queried by a member id: the relaunch needs the whole id set the lane was
  // launched with, not the one id the operator happened to poll — `codex run 223` alone would
  // start a second lane over the same worktree and abandon 222.
  const j = writeJournal(root, [222, 223], { lane: 'run', report: 'CODEX-REPORT.md' })
  assertGroupDead(j.pgid, 'this is the quota-death case — the group must really be gone')

  const { code, out, stdout, err } = statusRaw(root, [223])

  assert.equal(out?.state, 'dead-no-report', `precondition: a dead group with no report is the quota-death state; stderr: ${err}`)
  assert.equal(code, 2, `dead-no-report still exits 2; stderr: ${err}`)

  const hint = nextHint(err)
  assert.ok(hint, `a dead lane with no hand-off is the state operators improvised through 9 times — this read must name the relaunch; got stderr: ${err}`)
  assert.ok(
    hint.includes('roadmap codex run 222 223'),
    `the relaunch must carry the LANE's own ids (222 223), or the arc's other members are abandoned by the command the operator was handed; got: ${hint}`,
  )
  assert.ok(
    /resum|skip|already[- ]done|\.prev/i.test(hint),
    `a relaunch that looks like a REDO will not be run: the hint must say the prompt's RESUME RULE skips already-done tasks (or that the previous report is preserved as its .prev twin); got: ${hint}`,
  )
  assert.ok(!/<N>|<ids/.test(hint), `and it must be pasteable, not a template; got: ${hint}`)

  assert.ok(!('next' in out), `stdout must not gain a \`next\` key; got keys ${Object.keys(out).join(',')}`)
  assert.ok(!stdout.includes('next:'), `and the hint must not leak onto the parsed stream; got stdout: ${stdout}`)
})

test('next-step hint: a BLOCKED run lane names the REPORT PATH to read, then the relaunch verb', () => {
  const root = tmpRepo()
  const j = writeJournal(root, [231], { lane: 'run', report: 'CODEX-REPORT.md', startedAt: new Date(Date.now() - 60_000).toISOString() })
  const reportPath = join(j.worktree, 'CODEX-REPORT.md')
  writeFileSync(reportPath, 'Q: which ref does the land target?\nCODEX-RUN-BLOCKED\n')
  assertGroupDead(j.pgid, 'a blocked lane has stopped')

  const { code, out, stdout, err } = statusRaw(root, [231])

  assert.equal(out?.state, 'blocked', `precondition: a fresh BLOCKED sentinel is the verdict; stderr: ${err}`)
  assert.equal(code, 2, `blocked still exits 2; stderr: ${err}`)

  const hint = nextHint(err)
  assert.ok(hint, `BLOCKED means a question is waiting in a file — a state read that does not say where is the improvisation this hint exists to end; got stderr: ${err}`)
  assert.ok(
    hint.includes(reportPath),
    `the operator must be sent to the report by PATH — the report name alone cannot be opened from the primary checkout; expected ${reportPath}; got: ${hint}`,
  )
  assert.ok(
    hint.includes('roadmap codex run 231'),
    `and resolving the question is only half the recovery: the hint must name the relaunch that finishes the phase; got: ${hint}`,
  )

  assert.ok(!('next' in out), `stdout must not gain a \`next\` key; got keys ${Object.keys(out).join(',')}`)
  assert.ok(!stdout.includes('next:'), `and the hint must not leak onto the parsed stream; got stdout: ${stdout}`)
})

test('next-step hint: a RUNNING lane gets NO hint — there is nothing to do but wait', () => {
  const root = tmpRepo()
  const pgid = liveGroup()
  const j = writeJournal(root, [232], { lane: 'run', report: 'CODEX-REPORT.md', pgid })

  const { code, out, err } = statusRaw(root, [232])

  assert.equal(out?.state, 'running', `precondition: a live group with no report is running; stderr: ${err}`)
  assert.equal(code, 3, `running still exits 3; stderr: ${err}`)
  assert.equal(
    nextHint(err),
    null,
    `a running lane has no next step: naming the relaunch here invites a double-run into a live worktree (the very thing refuseIfLive exists to refuse), and naming the land invites landing half a phase; got stderr: ${err}`,
  )
  assert.equal(out.alive, true, 'and the liveness this case turns on is real, not a stale pgid')
  assert.ok(existsSync(j.worktree), 'the live lane is untouched by the read')
})

test('next-step hint: a COMPLETE plan lane names its consume read, `roadmap codex status <N> --plan`', () => {
  const root = tmpRepo()
  const worktree = join(root, 'wt-plan-233')
  mkdirSync(worktree, { recursive: true })
  writeFileSync(
    join(root, '.building', 'codex-plan-233.json'),
    JSON.stringify({ phases: ['233'], lane: 'plan', report: 'CODEX-PLAN.md', worktree, base: 'develop', pgid: 999999999, log: join(root, '.building', 'x.log'), startedAt: new Date(Date.now() - 60_000).toISOString() }, null, 2) + '\n',
  )
  writeFileSync(join(worktree, 'CODEX-PLAN.md'), 'authored roadmap/phases/phase-233.phase.ts @ abc1234\nCODEX-RUN-COMPLETE\n')
  assertGroupDead(999999999, 'the plan act has finished')

  const { code, out, stdout, err } = statusRaw(root, [233], '--plan')

  assert.equal(out?.state, 'complete', `precondition: the plan lane reports its own verdict; stderr: ${err}`)
  assert.equal(code, 0, `and exits 0 like any complete lane; stderr: ${err}`)

  const hint = nextHint(err)
  assert.ok(hint, `the plan lane's done-moment is its consume read, and no other verb closes it — the hint must name it; got stderr: ${err}`)
  assert.ok(
    hint.includes('roadmap codex status 233 --plan'),
    `with the REAL id and the plan lane's own flag: a run-lane command here reads the wrong journal ("no run journal covers 233"); got: ${hint}`,
  )
  assert.ok(!hint.includes('roadmap phase land'), `a plan lane makes no commits the integration branch wants — sending it to \`phase land\` sends it to a verb that refuses; got: ${hint}`)

  assert.ok(!('next' in out), `stdout must not gain a \`next\` key; got keys ${Object.keys(out).join(',')}`)
  assert.ok(!stdout.includes('next:'), `and the hint must not leak onto the parsed stream; got stdout: ${stdout}`)
})

test('next-step hint: the REVIEW lane gets NO hint in any state — its done-moment fires on this very read', () => {
  // COMPLETE: the archival above already ran as a side effect of this read, so a hint would name
  // a done-moment that has already fired. BLOCKED: the operator is at the report, and the review
  // lane has no relaunch-to-finish — a fresh review is a new act, not a resumption.
  // A repo each: reviewLane seeds and COMMITS, and a second seed in one root has nothing to commit.
  const root = tmpRepo()
  const complete = reviewLane(root, [234])
  const done = laneStatus(root, [234], '--review')
  assert.equal(done.out?.state, 'complete', `precondition: the verdict is complete; stderr: ${done.err}`)
  assert.equal(done.code, 0, `stderr: ${done.err}`)
  assert.ok(existsSync(complete.archived), 'precondition: and the read consumed it — the done-moment has already happened')
  assert.equal(
    nextHint(done.err),
    null,
    `nothing is left for the operator to run: this read archived the verdict and disposed the lane; got stderr: ${done.err}`,
  )

  const blockedRoot = tmpRepo()
  const blocked = reviewLane(blockedRoot, [235], { body: 'could not review: the phase file is unparseable\nCODEX-RUN-BLOCKED\n' })
  const r = laneStatus(blockedRoot, [235], '--review')
  assert.equal(r.out?.state, 'blocked', `precondition: a fresh BLOCKED sentinel is the verdict; stderr: ${r.err}`)
  assert.equal(r.code, 2, `stderr: ${r.err}`)
  assert.equal(
    nextHint(r.err),
    null,
    `a review lane owns no landing, no relaunch-to-resume and no consume verb beyond this read — a hint here would name a command that does not close it; got stderr: ${r.err}`,
  )
  assert.ok(existsSync(blocked.reportPath), 'and the blocked review\'s report stays where it is')
})

test('next-step hint: STDOUT stays byte-compatible — the same object, the same key set, no `next` anywhere on it', () => {
  const root = tmpRepo()
  const j = writeJournal(root, [236], { lane: 'run', report: 'CODEX-REPORT.md', startedAt: new Date(Date.now() - 60_000).toISOString() })
  writeFileSync(join(j.worktree, 'CODEX-REPORT.md'), 'gate green\nCODEX-RUN-COMPLETE\n')

  const { out, stdout, err } = statusRaw(root, [236])
  assert.ok(nextHint(err), `precondition: this is the terminal state whose hint must NOT be visible on stdout; got stderr: ${err}`)

  // The documented shape: the journal's own fields, plus the four `status` resolves. Asserted as
  // a SET rather than field by field — a hint delivered as a key is exactly the regression a
  // per-field assertion would miss, and every consumer of this stream (the do-phase poll loop,
  // the gate reconcile) was written against this shape.
  assert.deepEqual(
    Object.keys(out).sort(),
    ['alive', 'base', 'lane', 'log', 'pgid', 'phases', 'report', 'sentinel', 'startedAt', 'state', 'worktree'],
    `the stdout object gained or lost a key — the hint lane is stderr, and this stream is parsed by callers who never asked for a new field; got ${JSON.stringify(Object.keys(out))}`,
  )
  assert.ok(!('next' in out), 'and `next` in particular is never a field: the contract puts the hint on stderr precisely so this object does not move')
  assert.ok(!stdout.includes('next:'), `nor may a hint be written to stdout as prose — it would land inside (or beside) the JSON and break the parse; got stdout: ${stdout}`)

  // The whole stream is the pretty-printed object and one newline: nothing prepended, nothing
  // appended. This is the byte-level statement the per-case assertions above only approximate.
  assert.equal(
    stdout,
    JSON.stringify(out, null, 2) + '\n',
    `stdout must be EXACTLY the JSON object status has always printed — any extra byte on this stream is a parse failure in someone else's poll loop; got: ${JSON.stringify(stdout)}`,
  )
})

// ── consume-the-plan: the plan lane's done-moment ──────────────────────────────────────────────
// The plan lane had no close. Its one output — roadmap/phases/phase-<N>.phase.ts — is cherry-picked
// to the primary by the supervising session, and the worktree plus its `codex-plan/<ids>` branch
// then squat forever (atlas-codex-plan-22 outlived its plan by weeks). The review lane's ratified
// pattern is the arc-LOCKED design to mirror: consume the verdict on a status READ, archive it, and
// dispose the lane. What cannot be mirrored is disposeWorktree's reachability question — a
// cherry-pick rewrites the sha, so a landed plan looks exactly as unpushed as an abandoned one.
// Harvest is therefore CONTENT-carried, proven off committed BLOB IDS on both sides, and the lane's
// ONE-FILE invariant is what makes such a proof total: one file, one blob, one question.
//
// Two arms, because strict byte-equality alone would refuse the NORMAL flow (architect amendment
// A2): a Mode A repair routinely edits the harvested phase file again on the integration ref, so
// the lane's blob must also count as harvested when it appears anywhere in that path's committed
// history. Everything below drives the REAL git objects — a mkdir stand-in would let a proof that
// reads working-tree files pass, which is the one implementation this contract forbids.

/**
 * A REAL plan lane: a `codex-plan/<ids>` branch worktree off `develop`, carrying exactly ONE
 * committed file (the phase file — that single-file commit IS the one-file invariant), its journal
 * in the PRIMARY `.building/` with the launcher's own field set, and a fresh CODEX-PLAN.md.
 *
 * `develop` is the integration ref (integrationRefOf's documented fallback, no config written) and
 * is deliberately NOT the branch the primary has checked out, so the harvest below can advance it
 * the way a supervising session does without touching the primary's HEAD.
 *
 * `authored` overrides what the lane COMMITTED as its plan. The default stays the minimal entity
 * every close test above already pins, and it is load-bearing beyond those tests: it must PASS
 * `roadmap phase validate`, because the close validates the authored entity (15.4) and a fixture
 * the validator rejected would refuse every one of them. It carries no `import` for the same
 * reason the plan file it stands for cannot here — a tmp consumer has no lib/roadmap/schema, and
 * the validator judges the PARSED entity, so a plain object exercises the real engine end to end.
 */
function planLane(root, ids, { body = null, authored = null, startedAt = new Date(Date.now() - 60_000).toISOString(), pgid = 999999999 } = {}) {
  const at = (dir) => (...args) =>
    execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  const git = at(root)
  writeFileSync(join(root, 'seed.txt'), 'seed\n')
  git('add', 'seed.txt')
  git('commit', '-q', '-m', 'seed')
  git('branch', '-f', 'develop')

  const n = ids[0]
  const phaseFile = `roadmap/phases/phase-${n}.phase.ts`
  const branch = `codex-plan/${ids.join('-')}`
  // planCodex's OWN default path shape. Never `${root}-wt-<k>`: that namespace is a session slot,
  // which no read command may ever remove.
  const worktree = `${root}-codex-plan-${ids.join('-')}`
  cleanups.push(() => rmSync(worktree, { recursive: true, force: true }))
  git('worktree', 'add', '-q', '-b', branch, worktree, 'develop')
  const lgit = at(worktree)
  mkdirSync(join(worktree, 'roadmap', 'phases'), { recursive: true })
  writeFileSync(join(worktree, phaseFile), authored ?? `export default { id: ${n}, tasks: [] }\n`)
  lgit('add', phaseFile)
  lgit('commit', '-q', '-m', `plan(${n}): author the phase`)
  const tip = lgit('rev-parse', 'HEAD').trim()

  const jPath = join(root, '.building', `codex-plan-${ids.join('-')}.json`)
  writeFileSync(
    jPath,
    JSON.stringify(
      {
        phases: ids.map(String),
        lane: 'plan',
        driver: { model: DRIVERS.codex.model, lane: 'codex' },
        report: 'CODEX-PLAN.md',
        worktree,
        base: 'develop',
        pgid,
        log: join(root, '.building', 'x.log'),
        prompt: join(root, '.building', `codex-plan-${ids.join('-')}-prompt.txt`),
        startedAt,
      },
      null,
      2,
    ) + '\n',
  )
  const reportPath = join(worktree, 'CODEX-PLAN.md')
  // Written AFTER startedAt (60s ago) so the freshness guard reads this sentinel as the verdict.
  writeFileSync(reportPath, body ?? `authored ${phaseFile} @ ${tip.slice(0, 7)}\nCODEX-RUN-COMPLETE\n`)
  return { root, ids, git, lgit, worktree, branch, phaseFile, tip, jPath, reportPath, archived: jPath.replace(/\.json$/, '-REPORT.md') }
}

/**
 * The harvest, performed the way a supervising session performs it: a REAL `git cherry-pick` onto
 * `develop`, in its own checkout so the primary's HEAD never moves. The landed commit therefore has
 * a DIFFERENT sha and the SAME blob — which is the whole point, and why a sha-reachability proof
 * cannot answer this question. `amend` adds the Mode A repair: a further commit editing the same
 * phase file at the integration ref, after the harvest.
 *
 * `develop` also MOVES here, by an unrelated commit, because that is what an integration ref does
 * while a lane runs. It is load-bearing twice over: a cherry-pick onto an unmoved develop
 * reproduces the lane's commit object byte for byte (same tree, same parent, same author) and this
 * fixture would silently stop testing a sha change at all; and it is the reason the one-file diff
 * must be a THREE-dot merge-base diff — `git diff --name-only develop HEAD` would report this
 * unrelated file as a change the lane made, refusing every harvested lane as an invariant breach.
 */
function harvest(lane, { commit = lane.tip, amend = null } = {}) {
  const dir = `${lane.root}-harvest`
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  lane.git('worktree', 'add', '-q', dir, 'develop')
  const hgit = (...args) =>
    execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  mkdirSync(join(dir, 'docs'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'other-work.md'), 'a sibling session landed this while the lane ran\n')
  hgit('add', 'docs/other-work.md')
  hgit('commit', '-q', '-m', 'docs: unrelated work on the integration ref')
  hgit('cherry-pick', commit)
  const landed = hgit('rev-parse', 'HEAD').trim()
  if (amend !== null) {
    writeFileSync(join(dir, lane.phaseFile), amend)
    hgit('add', lane.phaseFile)
    hgit('commit', '-q', '-m', `fix(plan): Mode A repair on the harvested phase file`)
  }
  lane.git('worktree', 'remove', '--force', dir)
  return landed
}

/** The committed blob id of `path` at `ref`, read from `dir` — never the working tree. */
function blobAt(dir, ref, path) {
  const r = spawnSync('git', ['-C', dir, 'rev-parse', `${ref}:${path}`], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : null
}

/** Every blob id this path has ever carried at `ref`, newest first — the second harvest arm. */
function blobHistoryAt(dir, ref, path) {
  return execFileSync('git', ['-C', dir, 'log', '--format=%H', ref, '--', path], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((sha) => blobAt(dir, sha, path))
}

function branchResolves(lane) {
  return spawnSync('git', ['-C', lane.root, 'rev-parse', '--verify', '--quiet', `refs/heads/${lane.branch}`], { encoding: 'utf8' }).status === 0
}

/**
 * "It refused" is half the contract; "it removed NOTHING" is the other half. A refusal that
 * deleted the tree anyway is strictly worse than no done-moment at all, because the plan commit
 * then exists nowhere but a dangling branch nobody was told about.
 */
function assertPlanLaneKept(lane, why) {
  assert.ok(existsSync(lane.worktree), `${why}: the worktree must SURVIVE a refusal — ${lane.worktree} was removed`)
  assert.ok(
    lane.git('worktree', 'list', '--porcelain').includes(lane.worktree),
    `${why}: and stay registered — a tree removed from git's metadata is unusable even while its files sit there`,
  )
  assert.ok(branchResolves(lane), `${why}: refs/heads/${lane.branch} must still resolve — the branch tip is the ONLY handle on an unharvested plan commit`)
  assert.equal(lane.lgit('rev-parse', 'HEAD').trim(), lane.tip, `${why}: pointing at the same commit it did before the read`)
  assert.ok(!existsSync(lane.archived), `${why}: and no archived twin may be written — ${lane.archived} exists, so the lane was treated as consumed`)
  const j = journalOf(lane)
  assert.equal(j.archivedAt, undefined, `${why}: the journal must carry no archivedAt — got ${j.archivedAt}`)
  assert.equal(j.archivedReport, undefined, `${why}: nor an archivedReport — got ${j.archivedReport}`)
}

test('consume-the-plan: a HARVESTED lane closes on the next status read, and the re-read still serves it', () => {
  const root = tmpRepo()
  const lane = planLane(root, [300])
  const plan = readFileSync(lane.reportPath, 'utf8')
  const landed = harvest(lane)
  assertGroupDead(999999999, 'the plan act has finished')

  // The fixture's own claim, asserted rather than assumed: same CONTENT, different COMMIT. A test
  // whose harvest fast-forwarded develop would pass under a sha-reachability proof and prove nothing.
  assert.notEqual(landed, lane.tip, 'precondition: a cherry-pick rewrites the sha — this fixture must not be a fast-forward')
  assert.equal(
    blobAt(root, 'develop', lane.phaseFile),
    blobAt(lane.worktree, 'HEAD', lane.phaseFile),
    'precondition: and leaves the committed BLOB identical on both sides — the only thing that can prove a harvest',
  )
  assert.ok(
    blobAt(root, 'develop', 'docs/other-work.md'),
    'precondition: develop MOVED while this lane ran, as an integration ref does — so the one-file check must be a THREE-dot merge-base diff; a two-dot `git diff develop HEAD` reports this sibling commit as the lane\'s own second file and refuses a perfectly good lane',
  )

  const { code, out, err } = laneStatus(root, [300], '--plan')

  assert.equal(out?.state, 'complete', `precondition: the plan lane's verdict is still the verdict; stderr: ${err}`)
  assert.equal(code, 0, `a consumed plan lane exits 0 — the close is a side effect of a successful read, never a failure; stderr: ${err}`)
  assert.ok(
    existsSync(lane.archived),
    `the plan must be COPIED beside its journal before the worktree goes — expected ${lane.archived} (jPath with .json → -REPORT.md, exactly as archiveReviewLane derives it); fix statusCodex in cli/commands/codex.mjs`,
  )
  assert.equal(readFileSync(lane.archived, 'utf8'), plan, 'byte-identical: a summarized or re-rendered copy is a second source of truth for what was planned')
  assert.ok(!existsSync(lane.worktree), `the harvested lane's done-moment has passed — ${lane.worktree} must be removed, or it squats like atlas-codex-plan-22 did`)
  assert.ok(
    !lane.git('worktree', 'list', '--porcelain').includes(lane.worktree),
    'the disposal must PRUNE the metadata too — a hand-deleted directory leaves its registration haunting `git worktree list`',
  )
  assert.ok(
    !branchResolves(lane),
    `${lane.branch} must be deleted: its content is on the integration ref under another sha, so the branch is a duplicate that no merge test will ever retire; fix statusCodex in cli/commands/codex.mjs`,
  )

  const j = journalOf(lane)
  assert.ok(
    existsSync(lane.jPath),
    'the journal keeps its LIVE codex-plan-<ids>.json name — renaming it is how findJournal loses the lane and the very next read regresses to "no journal covers"',
  )
  assert.ok(Number.isFinite(Date.parse(j.archivedAt)), `the journal must be STAMPED with an ISO archivedAt — got ${JSON.stringify(j.archivedAt)}`)
  assert.equal(j.archivedReport, lane.archived, `archivedReport must be the ABSOLUTE relocated path — got ${JSON.stringify(j.archivedReport)}`)

  // THE SECOND READ. The lane is gone; the journal is not. This is the state a supervising session
  // actually polls, and the one an archival that renamed or deleted the journal would break.
  const again = laneStatus(root, [300], '--plan')
  assert.equal(again.code, 0, `an archived plan lane is READABLE FOREVER — a consumed verdict must never decay into a failure exit; stderr: ${again.err}`)
  assert.equal(again.out?.state, 'complete', `nor into dead-no-report; stderr: ${again.err}`)
  assert.ok(
    !/no plan journal covers/.test(again.err),
    `the journal is sitting right there — claiming none covers the phase sends the reader hunting for a plan that DID happen; got: ${again.err}`,
  )
  assert.equal(again.out.report, lane.archived, `and \`report\` must be the ARCHIVED path: the worktree copy no longer exists to open; got ${again.out.report}`)
  assert.equal(readFileSync(again.out.report, 'utf8'), plan, 'which still holds the plan the lane produced')
  assert.equal(journalOf(lane).archivedAt, j.archivedAt, 're-stamping an already-archived lane rewrites when the plan was consumed — the one-shot key is archivedAt, as in archiveReviewLane')
})

test('consume-the-plan: an unharvested lane REFUSES, names the cherry-pick that fixes it, and removes NOTHING', () => {
  const root = tmpRepo()
  const lane = planLane(root, [301])
  assertGroupDead(999999999, 'the plan act has finished — only the harvest is missing')
  assert.equal(
    blobAt(root, 'develop', lane.phaseFile),
    null,
    `precondition: ${lane.phaseFile} must be absent from develop — an unharvested lane is the whole case`,
  )

  const { out, err } = laneStatus(root, [301], '--plan')

  assert.equal(out?.state, 'complete', `the verdict is still delivered — a refused CLEANUP is not a refused read; stderr: ${err}`)
  assert.match(
    err,
    /harvest/i,
    `an unharvested lane must be REFUSED by name: removing it destroys the only copy of the plan commit; got: ${err}`,
  )
  assert.ok(
    err.includes(`git -C ${root} cherry-pick ${lane.tip}`),
    `and the refusal must carry the runnable recovery — the lane branch tip is about to become unreachable, so \`git -C ${root} cherry-pick ${lane.tip}\` is the only thing standing between the operator and a lost plan; got: ${err}`,
  )
  assertPlanLaneKept(lane, 'the plan was never harvested')
  assert.equal(readFileSync(join(lane.worktree, lane.phaseFile), 'utf8'), `export default { id: 301, tasks: [] }\n`, 'and the authored phase file is still there to harvest')
})

test('consume-the-plan: a LIVE process group refuses even with the harvest proven, and names the pgid', () => {
  const root = tmpRepo()
  // Reachable, not contrived: a driver writes CODEX-RUN-COMPLETE and its process group exits a
  // moment later, and the poll loop reads status in between. The verdict is real; the lane is not
  // yet dead. Removing a live driver's worktree out from under it is the one unrecoverable act here.
  const pgid = liveGroup()
  const lane = planLane(root, [302], { pgid })
  harvest(lane)
  assert.equal(blobAt(root, 'develop', lane.phaseFile), blobAt(lane.worktree, 'HEAD', lane.phaseFile), 'precondition: the harvest IS proven, so liveness is the only guard left to fire')

  const { out, err } = laneStatus(root, [302], '--plan')

  assert.equal(out?.state, 'complete', `the sentinel is fresh, so the verdict stands; stderr: ${err}`)
  assert.equal(out.alive, true, 'and the liveness this case turns on is REAL, not a recycled pid')
  assert.match(err, /live/i, `a live lane must be refused, not raced; got: ${err}`)
  assert.ok(
    err.includes(String(pgid)),
    `naming the process group the operator can go look at — a bare "it is live" cannot be checked or waited on; expected pgid ${pgid} in: ${err}`,
  )
  assertPlanLaneKept(lane, 'a live plan lane is still running')
})

test('consume-the-plan: a SECOND changed file breaches the one-file invariant — the refusal names it and keeps the lane', () => {
  const root = tmpRepo()
  const lane = planLane(root, [303])
  // A second COMMITTED file, not an untracked artifact: this is the invariant guard, not the dirt
  // guard. The harvest of the phase-file commit is real, so nothing else can be refusing here.
  writeFileSync(join(lane.worktree, 'notes.md'), 'stray working notes the plan act committed\n')
  lane.lgit('add', 'notes.md')
  lane.lgit('commit', '-q', '-m', 'plan(303): stray second file')
  lane.tip = lane.lgit('rev-parse', 'HEAD').trim()
  harvest(lane, { commit: `${lane.tip}~1` })
  assert.equal(
    blobAt(root, 'develop', lane.phaseFile),
    blobAt(lane.worktree, 'HEAD', lane.phaseFile),
    'precondition: the phase file IS harvested — the ONLY thing wrong with this lane is that it changed a second file',
  )

  const { out, err } = laneStatus(root, [303], '--plan')

  assert.equal(out?.state, 'complete', `the verdict is still delivered; stderr: ${err}`)
  assert.match(
    err,
    /one[- ]file|exactly one|invariant/i,
    `a plan lane that changed more than its phase file is not a plan lane — the harvest proof covers ONE path, so a second file rides out of the lane unproven and unreviewed; got: ${err}`,
  )
  assert.ok(err.includes('notes.md'), `and the refusal must NAME the offending file — a reason with no detail sends the operator to a branch with no idea what is on it; got: ${err}`)
  assertPlanLaneKept(lane, 'the lane breached the one-file invariant')
  assert.ok(existsSync(join(lane.worktree, 'notes.md')), 'and the unproven file is still on disk where its author left it')
})

test('consume-the-plan: a harvest AMENDED at the integration ref still closes — the proof reads blob HISTORY, not byte-equality', () => {
  const root = tmpRepo()
  const lane = planLane(root, [304])
  const plan = readFileSync(lane.reportPath, 'utf8')
  // The Mode A repair flow, which is the NORMAL one: the supervising session cherry-picks the plan,
  // then fixes it in place on develop. Strict byte-equality would refuse every such lane — and the
  // operator's only recourse would be to re-harvest a plan that is already landed.
  harvest(lane, { amend: 'export default { id: 304, tasks: [], repaired: true }\n' })

  const laneBlob = blobAt(lane.worktree, 'HEAD', lane.phaseFile)
  assert.notEqual(
    blobAt(root, 'develop', lane.phaseFile),
    laneBlob,
    'precondition: arm 1 must FAIL here — if the tip blobs still matched, this case would prove nothing beyond the harvested one',
  )
  assert.ok(
    blobHistoryAt(root, 'develop', lane.phaseFile).includes(laneBlob),
    "precondition: and arm 2 must hold — the lane's blob is in the committed history of that path on develop, which is what proves the harvest happened",
  )

  const { code, out, err } = laneStatus(root, [304], '--plan')

  assert.equal(out?.state, 'complete', `stderr: ${err}`)
  assert.equal(code, 0, `stderr: ${err}`)
  assert.ok(
    !existsSync(lane.worktree),
    `an amended harvest is STILL a harvest: the plan is on the integration ref and the lane is spent, so it must close — refusing here strands every lane that got the repair it was supposed to get; stderr: ${err}`,
  )
  assert.ok(!branchResolves(lane), `and ${lane.branch} goes with it — a branch kept "just in case" here is the squat this phase exists to end`)
  assert.equal(readFileSync(lane.archived, 'utf8'), plan, 'with the plan archived beside its journal, byte-identical, before any of that happened')
  assert.ok(Number.isFinite(Date.parse(journalOf(lane).archivedAt)), 'and the journal stamped in place under its live name')
})

test('consume-the-plan: a modified TRACKED file refuses as dirty, while untracked lane artifacts alone never do', () => {
  // Guard (b) in both directions, one repo each — planLane seeds and COMMITS, and a second seed in
  // one root has nothing to commit.
  const dirtyRoot = tmpRepo()
  const dirty = planLane(dirtyRoot, [305])
  harvest(dirty)
  writeFileSync(join(dirty.worktree, 'seed.txt'), 'the plan act edited a tracked file it never committed\n')

  const refused = laneStatus(dirtyRoot, [305], '--plan')

  assert.equal(refused.out?.state, 'complete', `the verdict is still delivered; stderr: ${refused.err}`)
  assert.match(refused.err, /dirty|refus|kept/i, `uncommitted work in a tracked file is unexplained work — disposing the tree destroys the only copy; got: ${refused.err}`)
  assert.ok(
    refused.err.includes('seed.txt'),
    `and the refusal carries the blocking path, the way the phase-land precedent writes reason AND detail; got: ${refused.err}`,
  )
  assertPlanLaneKept(dirty, 'the lane holds uncommitted work in a tracked file')
  assert.equal(readFileSync(join(dirty.worktree, 'seed.txt'), 'utf8'), 'the plan act edited a tracked file it never committed\n', 'and that work is untouched')

  // The other direction. EVERY plan lane ends with these two untracked: its own CODEX-PLAN.md
  // (never committed, by contract) and the .building/ the launcher carried in. If either refused,
  // no plan lane would ever close and this whole done-moment would be dead on arrival.
  const cleanRoot = tmpRepo()
  const clean = planLane(cleanRoot, [306])
  harvest(clean)
  mkdirSync(join(clean.worktree, '.building'), { recursive: true })
  writeFileSync(join(clean.worktree, '.building', 'plan-brief.md'), '# the brief the lane was launched with\n')
  assert.match(
    clean.lgit('status', '--porcelain'),
    /CODEX-PLAN\.md|\.building/,
    'precondition: those artifacts really are untracked in this fixture — a gitignore would make the next assertion decorative',
  )

  const closed = laneStatus(cleanRoot, [306], '--plan')

  assert.equal(closed.out?.state, 'complete', `stderr: ${closed.err}`)
  assert.equal(closed.code, 0, `stderr: ${closed.err}`)
  assert.ok(
    !existsSync(clean.worktree),
    `a lane's own hand-off and carried-in brief are artifacts, never work — the disposal must be untracked-tolerant or the plan lane's done-moment never fires once; stderr: ${closed.err}`,
  )
  assert.ok(!branchResolves(clean), `and ${clean.branch} is deleted with it`)
})

test('consume-the-plan: a branch that failed to delete is RETRIED and re-reported, never silently stranded', () => {
  // The gate R0 finding. The close's two re-entry conditions (no archivedAt, or the worktree still
  // standing) both go false the moment the tree is removed — so a `branch -D` that lost to a ref
  // lock was announced exactly once and then never retried and never mentioned again, leaving the
  // duplicate branch to squat. That is the leak class this whole phase exists to end, and no sweep
  // verb is allowed to come back for it.
  const root = tmpRepo()
  const lane = planLane(root, [307])
  const plan = readFileSync(lane.reportPath, 'utf8') // captured BEFORE any read, so the last assertion has a constant to compare against
  harvest(lane)
  // A held ref lock — the shape a crashed sibling git leaves behind. `branch -D` refuses for a
  // reason that has nothing to do with the worktree, so the removal still succeeds.
  const lock = join(root, '.git', 'refs', 'heads', `${lane.branch}.lock`)
  mkdirSync(dirname(lock), { recursive: true })
  writeFileSync(lock, '')

  const closed = laneStatus(root, [307], '--plan')

  assert.equal(closed.out?.state, 'complete', `stderr: ${closed.err}`)
  assert.ok(!existsSync(lane.worktree), `the worktree still goes — its removal is unaffected by a branch that will not delete; stderr: ${closed.err}`)
  assert.ok(branchResolves(lane), 'fixture: and the lock really did strand the branch, or the retry below tests nothing')
  assert.ok(
    closed.err.includes(lane.branch),
    `a branch that leaked must be NAMED at the moment it leaks — the caller otherwise prints "consumed" over it; got: ${closed.err}`,
  )

  // The next read, with nothing changed: the leak must still be REPORTED, not forgotten.
  const nagged = laneStatus(root, [307], '--plan')
  assert.ok(
    nagged.err.includes(lane.branch),
    `a stranded branch must be re-reported on every read until it is gone — announcing it once and going quiet is how 19 stray worktrees accumulated unnoticed; got: ${nagged.err}`,
  )
  assert.ok(branchResolves(lane), 'and it is still there, because the lock is still there')
  assert.equal(journalOf(lane).archivedAt !== undefined, true, 'the journal stays stamped — re-entry is a retry, never a re-archive')

  // Clear the cause. The very next read must SELF-HEAL, with no verb the operator had to know.
  rmSync(lock, { force: true })
  const healed = laneStatus(root, [307], '--plan')

  assert.equal(healed.out?.state, 'complete', `stderr: ${healed.err}`)
  assert.ok(
    !branchResolves(lane),
    `once the cause is cleared the retry must actually delete it — a report that never acts is the sweep verb the operator ruling refused, wearing a nag's clothes; stderr: ${healed.err}`,
  )
  assert.equal(
    readFileSync(lane.archived, 'utf8'),
    plan,
    'and the archived plan survived all three reads byte-identical — the retry is a branch act, and it must never re-copy or re-render the hand-off',
  )
})

test('consume-the-plan: a lane whose DIRECTORY died is never closed on an unseen verdict, and nothing is removed', () => {
  // Gate R1, corrected by the fixture that found it. A plan lane whose directory was swept (a /tmp
  // reaper, a hand rm) CANNOT reach the consume-close by the front door: with no tree there is no
  // CODEX-PLAN.md, so the read computes `dead-no-report`, and the close is gated on the COMPLETE
  // verdict. That is the right refusal — closing a lane whose verdict was never seen would be
  // guessing — but the branch and the stale registration must not squat with nobody told. The
  // operator ruling forbids a sweep verb, so the answer is REPORT: this read names the prune in its
  // next-step hint (the case below pins that text), and
  // `roadmap audit` check 15 reports the same lane as a prunable row with the same prune.
  const root = tmpRepo()
  const lane = planLane(root, [308])
  harvest(lane)
  rmSync(lane.worktree, { recursive: true, force: true })
  assert.ok(
    lane.git('worktree', 'list', '--porcelain').includes(lane.worktree),
    'fixture: git still LISTS the vanished worktree — that is the prunable shape a swept /tmp leaves, not an absent one',
  )

  const { code, out, err } = laneStatus(root, [308], '--plan')

  assert.equal(
    out?.state,
    'dead-no-report',
    `a hand-off that died with its directory is not a verdict: the read must say dead-no-report rather than infer completion from a journal; stderr: ${err}`,
  )
  assert.equal(code, 2, `and carry the non-terminal exit; stderr: ${err}`)
  assert.ok(
    branchResolves(lane),
    `NOTHING is removed on an unseen verdict — the branch is the only named handle on that plan, harvested or not; stderr: ${err}`,
  )
  assert.ok(
    lane.git('worktree', 'list', '--porcelain').includes(lane.worktree),
    'and the registration is left for the operator to prune — a read command never prunes on its own',
  )
  assert.equal(journalOf(lane).archivedAt, undefined, 'nor is the journal stamped closed over a verdict nobody saw')
})

test('next-step hint: a plan lane whose DIRECTORY is gone gets the prune hint — the one path that state reaches', () => {
  // Gate R2. Such a lane can never read `complete` (no tree, no CODEX-PLAN.md), so the consume-close
  // is unreachable and every refusal inside it is dead text. dead-no-report IS the state it reaches,
  // and before this the plan lane was silent there — the operator got a JSON blob and nothing else.
  const root = tmpRepo()
  const lane = planLane(root, [310])
  rmSync(lane.worktree, { recursive: true, force: true })

  const { out, err } = laneStatus(root, [310], '--plan')

  assert.equal(out?.state, 'dead-no-report', `precondition: with no tree there is no hand-off, so no verdict; stderr: ${err}`)
  const hint = nextHint(err)
  assert.ok(hint, `this is the ONLY place a dead plan lane is told anything — silence here is how a stale registration and a branch squat unnoticed; got stderr: ${err}`)
  assert.ok(
    hint.includes(`git -C ${root} worktree prune`),
    `the act that actually clears what is left is the prune — every command addressing the missing directory exits 128; got: ${hint}`,
  )
  assert.ok(
    hint.includes(`codex-plan/310`),
    `and the surviving BRANCH must be named: if the plan was never harvested those commits are its only copy, so the hint says read it before deleting; got: ${hint}`,
  )
  assert.match(hint, /read|log/i, `named as something to READ first, never as a delete; got: ${hint}`)
  assert.ok(branchResolves(lane), 'and nothing was removed by the read itself')
})

test('next-step hint: a CONSUMED plan lane stays silent — the close removed its directory, which is not the same as losing it', () => {
  // Gate R3, and the sharpest regression of the phase. The missing-worktree arm added at R2 fired
  // for a lane the close had JUST disposed: `roadmap codex status` printed "plan lane consumed —
  // plan archived at …; worktree … and branch codex-plan/300 disposed" and then, one line later,
  // told the operator to prune what was already pruned and to read a branch that had just been
  // deleted (that `git log` exits 128) "since an unharvested plan lives only there" — of a plan
  // that was harvested and archived. And it repeated on every read, forever. A missing directory
  // means two opposite things; `archivedAt` is what tells them apart.
  const root = tmpRepo()
  const lane = planLane(root, [311])
  harvest(lane)

  const closing = laneStatus(root, [311], '--plan')
  assert.equal(closing.out?.state, 'complete', `precondition: the harvested lane closes on this read; stderr: ${closing.err}`)
  assert.ok(!existsSync(lane.worktree), 'precondition: and its directory is gone — the state the bad arm keyed on')
  assert.ok(!branchResolves(lane), 'precondition: its branch is gone too, so any hint naming it is unrunnable')
  assert.equal(
    nextHint(closing.err),
    null,
    `a lane this read CONSUMED has no next step — the close already happened, and the hint contradicted the line printed just above it; got stderr: ${closing.err}`,
  )

  const again = laneStatus(root, [311], '--plan')
  assert.equal(
    nextHint(again.err),
    null,
    `nor on any later read: a consumed lane that nags forever is how an operator learns to ignore \`next:\` entirely; got stderr: ${again.err}`,
  )
  assert.equal(again.code, 0, `and the archived lane still reads clean; stderr: ${again.err}`)
})

test('consume-the-plan: an EMPTY one-file diff refuses both ways, and neither way says "just remove it"', () => {
  // Gate R4. Acceptance criterion 2 wants each refusal direction tested, and the empty-diff branch
  // had none through three rounds of churn — R2 shipped a discriminator that answered yes to both
  // causes and R3 replaced it, with nothing pinning either. An empty `base...HEAD` means the lane
  // added nothing of its own, which happens when base already carries its commit (a merge) and when
  // the lane never authored the file at all. The two want opposite acts, and BOTH must send the
  // operator to CODEX-PLAN.md first: nothing on this path has archived it, so a bare removal
  // destroys the only record of what the lane did.
  const merged = tmpRepo()
  const lane = planLane(merged, [312])
  // A MERGE landing, not a cherry-pick: base gains the lane's own commit, so the merge-base moves
  // up to it and the three-dot diff empties out.
  lane.git('branch', '-f', 'develop', lane.tip)
  assert.equal(
    lane.lgit('diff', '--name-only', 'develop...HEAD').trim(),
    '',
    'fixture: the three-dot diff really is empty — that is the branch under test',
  )

  const m = laneStatus(merged, [312], '--plan')
  assert.match(m.err, /ONE-FILE invariant/, `an empty diff still fails the one-file check; got: ${m.err}`)
  assert.match(m.err, /0 file\(s\)/, `and says so with the count that made it fail; got: ${m.err}`)
  assert.ok(m.err.includes(join(lane.worktree, 'CODEX-PLAN.md')), `the hand-off is the only record of what the lane did, so the refusal names it BY PATH; got: ${m.err}`)
  assert.ok(
    m.err.includes(`cp ${join(lane.worktree, 'CODEX-PLAN.md')}`),
    `and if the operator removes the lane anyway, the remedy keeps that record FIRST — nothing on this path archived it; got: ${m.err}`,
  )
  assert.ok(existsSync(lane.worktree) && branchResolves(lane), 'and the lane itself is untouched by a refusal')

  // The other cause: the lane committed something, but never the phase file.
  const empty = tmpRepo()
  const never = planLane(empty, [313])
  never.lgit('rm', '-q', never.phaseFile)
  never.lgit('commit', '-q', '-m', 'plan(313): drop the phase file again')
  never.git('branch', '-f', 'develop', never.lgit('rev-parse', 'HEAD').trim())

  const n = laneStatus(empty, [313], '--plan')
  assert.match(
    n.err,
    /not committed at this lane's HEAD at all/,
    `a lane with no phase file at HEAD must be told THAT, not that its plan was already merged — the two want opposite acts; got: ${n.err}`,
  )
  assert.ok(n.err.includes(join(never.worktree, 'CODEX-PLAN.md')), `this direction names the hand-off too; got: ${n.err}`)
  assert.ok(existsSync(never.worktree) && branchResolves(never), 'nothing removed here either')
})

test('next-step hint: a plan lane journalled at a SLOT is promised no close, because the close refuses slots', () => {
  // Gate R4. The slot refusal and the consume hint disagreed: the read printed "is a session SLOT
  // … Retire it by hand" and one line later promised "then this read closes the lane" — a hint that
  // can never come true, on every read forever. Same shape as the R3 HIGH, narrower trigger.
  const root = tmpRepo()
  const slot = `${root}-wt-3`
  cleanups.push(() => rmSync(slot, { recursive: true, force: true }))
  const lane = planLane(root, [314])
  // Re-journal the same real lane at a SLOT path, which `codex plan --worktree <root>-wt-3` does.
  execFileSync('git', ['-C', root, 'worktree', 'move', lane.worktree, slot], { encoding: 'utf8' })
  const j = JSON.parse(readFileSync(lane.jPath, 'utf8'))
  writeFileSync(lane.jPath, JSON.stringify({ ...j, worktree: slot }, null, 2) + '\n')

  const { err } = laneStatus(root, [314], '--plan')

  assert.match(err, /session SLOT/, `precondition: the close must refuse a slot — that refusal is what the hint contradicted; got: ${err}`)
  assert.equal(
    nextHint(err),
    null,
    `and no hint may promise a close the very next line refused: an operator who runs it gets the same refusal, forever; got: ${err}`,
  )
  assert.ok(existsSync(slot), 'and the slot is untouched — slot retirement is a held human act')
})

// ── the close VALIDATES the authored entity, through the consumer bridge ───────────────────────
// Task 15.4. Everything above proves the lane is spent, clean, one-file and harvested — and not one
// of those guards ever OPENS the file. A plan lane that wrote a broken phase file therefore reports
// CODEX-RUN-COMPLETE, closes as consumed, and takes its worktree and branch with it; the operator
// finds out when something downstream trips over the file, with the lane that authored it gone.
// Nothing downstream catches it mechanically either: `roadmap status` hides parse errors (azure
// lesson 2329) and the write-hook adapter no-ops as a CLI (2333). The consume-close is the choke
// point, so the question it must ask is the plugin's OWN `phase validate` — the same engine the
// write-hook calls — run against the file as the LANE committed it, before the harvest proof.
//
// The refusal must carry the validator's real diagnostic, not a paraphrase of it: "the plan does
// not validate" tells an operator nothing they can act on, and the file is sitting in a worktree
// this close is about to remove. Every test below therefore runs the real validator ITSELF to learn
// what it says about its fixture, and demands that exact line back out of the refusal — no coupling
// to esbuild's or the engine's current wording, and no way for an implementation to pass by
// swallowing stderr and printing a summary.

/** A plan file with a syntax error — the malformed authored entity, byte-committed by the lane. */
const brokenPlan = (n) => `export default { phase: ${n}, name: 'broken', tasks: [ }\n`

/**
 * A plan file that PARSES but breaks a structural phase rule (done-with-open-task). The distinction
 * matters: a `node --check`, a JSON.parse or a bare import would wave this through, and the seam is
 * specified as the plugin's validator precisely because the entity's RULES are the question.
 */
const openTaskPlan = (n) =>
  `export default { phase: ${n}, name: 'closes over an open task', status: 'done', tasks: [{ id: '${n}.1', done: false }] }\n`

/** A valid plan: the twin, structured as a real phase entity rather than the minimum fixture. */
const validPlan = (n) =>
  `export default {\n`
  + `  phase: ${n},\n`
  + `  name: 'the plan this lane was launched to author',\n`
  + `  status: 'backlog',\n`
  + `  category: 'feature',\n`
  + `  tasks: [{ id: '${n}.1', title: 'the one task', done: false }],\n`
  + `}\n`

/** What the REAL validator says about the file this lane committed, asked exactly where the close asks. */
function validatorSays(lane) {
  const r = spawnSync('node', [BIN, 'phase', 'validate', lane.phaseFile], { cwd: lane.worktree, encoding: 'utf8' })
  return { code: r.status, err: r.stderr }
}

/** The one diagnostic line an operator needs, lifted from a real validator run so no test hardcodes wording. */
function diagnosticLine(err, pattern) {
  const line = err.split('\n').find((l) => pattern.test(l))
  assert.ok(line, `fixture precondition: the validator must emit a ${pattern} line to demand back — got: ${err}`)
  return line.trim()
}

test('consume-the-plan: a harvested lane whose authored file does NOT PARSE refuses, quoting the validator, and keeps the lane', () => {
  const root = tmpRepo()
  const lane = planLane(root, [320], { authored: brokenPlan(320) })
  harvest(lane)
  assertGroupDead(999999999, 'the plan act has finished')

  // Every OTHER guard is satisfied: dead group, clean tree, one file, blob proven harvested. The
  // file's contents are the only thing wrong with this lane, so a close here can only be a close
  // that never opened it.
  assert.equal(
    blobAt(root, 'develop', lane.phaseFile),
    blobAt(lane.worktree, 'HEAD', lane.phaseFile),
    'precondition: the harvest IS proven — validation is the only guard left that can fire',
  )
  const validator = validatorSays(lane)
  assert.notEqual(validator.code, 0, `precondition: the authored file must really fail \`phase validate\`; got exit ${validator.code} / ${validator.err}`)
  const diagnostic = diagnosticLine(validator.err, /ERROR:/)

  const { code, out, err } = laneStatus(root, [320], '--plan')

  assert.equal(out?.state, 'complete', `the verdict is still delivered — a refused CLEANUP is not a refused read; stderr: ${err}`)
  assert.equal(code, 0, `and the read itself still succeeds: refusing to close is a side effect, never a failed status; stderr: ${err}`)
  assert.match(
    err,
    /does not validate as a phase entity/,
    `a plan that is not a phase entity must NEVER close as consumed — CODEX-RUN-COMPLETE is the lane's own claim, and this close is the only thing that checks it; got: ${err}`,
  )
  assert.ok(
    err.includes(diagnostic),
    `and the refusal must carry the VALIDATOR's own line — "${diagnostic}" — verbatim: the file is in a worktree this close was about to remove, and an operator told only "it does not validate" has nothing to fix; got: ${err}`,
  )
  assertPlanLaneKept(lane, 'the authored file does not parse')
  assert.equal(
    readFileSync(join(lane.worktree, lane.phaseFile), 'utf8'),
    brokenPlan(320),
    'and the broken file is still there to READ — keeping the lane is the whole point of refusing: the fix happens in this worktree, then the lane closes',
  )
})

test('consume-the-plan: the VALID twin still closes — validation refuses broken entities, not the flow', () => {
  // The other direction of the same guard, and the regression pin on the 14.6 close: a validation
  // step wired to the wrong file, the wrong cwd or the wrong exit-code reading refuses EVERY lane,
  // which retires the plan lane's done-moment entirely while looking like a safety improvement.
  const root = tmpRepo()
  const lane = planLane(root, [321], { authored: validPlan(321) })
  harvest(lane)
  assertGroupDead(999999999, 'the plan act has finished')
  assert.equal(validatorSays(lane).code, 0, 'precondition: this authored entity really does validate — the twin differs from the case above ONLY in its contents')

  const { code, out, err } = laneStatus(root, [321], '--plan')

  assert.equal(code, 0, `a consumed plan lane exits 0; stderr: ${err}`)
  assert.equal(out?.state, 'complete', `and still serves the verdict; stderr: ${err}`)
  assert.doesNotMatch(err, /does not validate as a phase entity/, `a valid entity must not be refused; got: ${err}`)
  assert.ok(existsSync(lane.archived), `the plan is copied out before the worktree goes — expected ${lane.archived}; stderr: ${err}`)
  assert.ok(!existsSync(lane.worktree), `and the harvested lane is disposed — ${lane.worktree} must be removed; stderr: ${err}`)
  assert.ok(!branchResolves(lane), `and ${lane.branch} deleted, exactly as before validation existed; stderr: ${err}`)
  assert.ok(Number.isFinite(Date.parse(journalOf(lane).archivedAt)), 'and the journal stamped: this lane WAS consumed')
})

test('consume-the-plan: an entity that parses but breaks a phase RULE is refused too, carrying that rule', () => {
  // The seam is the plugin's validator, not a syntax check. A phase file can be perfectly valid
  // JavaScript and still be a broken phase entity — status:'done' over an open task is the
  // 1281.7/1282.6 defect the engine already names — and a lane that authored one is exactly as
  // unconsumable as a lane that authored a parse error.
  const root = tmpRepo()
  const lane = planLane(root, [322], { authored: openTaskPlan(322) })
  harvest(lane)
  assertGroupDead(999999999, 'the plan act has finished')
  const validator = validatorSays(lane)
  assert.notEqual(validator.code, 0, `precondition: the rule must really fire; got exit ${validator.code} / ${validator.err}`)
  const diagnostic = diagnosticLine(validator.err, /done-with-open-task/)

  const { code, err } = laneStatus(root, [322], '--plan')

  assert.equal(code, 0, `the read still succeeds; stderr: ${err}`)
  assert.match(err, /does not validate as a phase entity/, `an entity the plugin's own validator rejects cannot close as consumed either; got: ${err}`)
  assert.ok(
    err.includes(diagnostic),
    `and the refusal carries the RULE that fired — "${diagnostic}": a close that only reported "invalid" would send an operator to look for a syntax error that is not there; got: ${err}`,
  )
  assertPlanLaneKept(lane, 'the authored entity breaks a phase rule')
})

test('consume-the-plan: a broken plan is refused for being broken FIRST — never sent off to be harvested', () => {
  // Ordering, and it is not cosmetic. The harvest refusal hands over a runnable
  // `git cherry-pick <tip>`; run against a lane whose file does not validate, that instruction
  // lands the broken plan on the integration ref, which is the one outcome this task exists to
  // prevent. Validation therefore precedes the harvest proof: the operator is told what is wrong
  // with the file, not how to ship it.
  const root = tmpRepo()
  const lane = planLane(root, [323], { authored: brokenPlan(323) })
  assertGroupDead(999999999, 'the plan act has finished — the harvest is missing AND the file is broken')
  assert.equal(blobAt(root, 'develop', lane.phaseFile), null, 'precondition: unharvested, so the harvest guard would otherwise be the one to speak')

  const { err } = laneStatus(root, [323], '--plan')

  assert.match(err, /does not validate as a phase entity/, `the file is broken, and that is what an operator must hear about it; got: ${err}`)
  assert.ok(
    !err.includes(`cherry-pick ${lane.tip}`),
    `and must NOT be handed \`git cherry-pick ${lane.tip}\` for a plan that does not validate — the refusal's own recovery would put the broken file on the integration ref; got: ${err}`,
  )
  assertPlanLaneKept(lane, 'a broken plan is neither consumed nor harvested')
})


// ── detectInstaller: the install decision, keyed on the LOCKFILE the consumer committed ────────
// ensureWorktree used to hardcode `npm ci`, which meant (a) the decision could not be exercised
// without a network install, and (b) a pnpm consumer discovered the mismatch only AFTER the
// worktree and the branch existed. Holding the decision in a pure function keeps both the recipe
// and its precedence testable from real files in a tmp dir — no spawns, no network.
//
// The four branches are DISTINCT return shapes, and the distinction is load-bearing for 15.2:
// a recipe means "install with this"; `null` means "a package dir I cannot decide" (the caller
// must refuse BEFORE creating anything); `undefined` means "not a package dir" (skip it silently).
// Collapsing null into undefined would turn a loud refusal into a silent skip, so every test below
// pins the sentinel identity, not just falsiness.
//
// The export is loaded through the namespace, the way the findJournal tests above do it: a missing
// named import would fail the whole file at link time and take the unrelated lanes down with it.

/** The two supported recipes, spelled out here so a drift in codex.mjs has something to fail against. */
const PNPM_RECIPE = { bin: 'pnpm', args: ['install', '--frozen-lockfile'] }
const NPM_RECIPE = { bin: 'npm', args: ['ci', '--no-audit', '--no-fund'] }

const A_PACKAGE_JSON = '{ "name": "consumer", "private": true }\n'

/** A tmp dir holding exactly the named files — real files on disk, nothing installed. */
function fixtureDir(files) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'installer-')))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body)
  return dir
}

async function loadDetectInstaller() {
  const mod = await import('./codex.mjs')
  assert.equal(
    typeof mod.detectInstaller,
    'function',
    'cli/commands/codex.mjs must export detectInstaller(dir) — the lockfile-keyed install decision ensureWorktree (15.2) and worktree.mjs installDeps both consume; without the export every assertion below is vacuous',
  )
  return mod.detectInstaller
}

/** bin + args only: the recorded reason is asserted where it belongs, on the both-lockfiles case. */
function recipeOf(result) {
  assert.ok(result && typeof result === 'object', `detectInstaller must return a recipe OBJECT here, got ${JSON.stringify(result)}`)
  return { bin: result.bin, args: result.args }
}

test('detectInstaller: a pnpm lockfile keys the pnpm recipe, verbatim', async () => {
  const detectInstaller = await loadDetectInstaller()
  const dir = fixtureDir({ 'package.json': A_PACKAGE_JSON, 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n" })

  const got = detectInstaller(dir)
  assert.deepEqual(
    recipeOf(got),
    PNPM_RECIPE,
    'a committed pnpm-lock.yaml must spawn `pnpm install --frozen-lockfile` — the frozen flag is what makes a lane install reproduce the lockfile instead of quietly resolving a newer tree',
  )
  assert.ok(
    !JSON.stringify(got).includes('package-lock.json'),
    'this dir has ONE lockfile: nothing here may record a precedence that was never exercised, or the both-lockfiles reason below proves nothing',
  )
})

test('detectInstaller: a package-lock keys the npm recipe, byte-identical to the ci that ships today', async () => {
  const detectInstaller = await loadDetectInstaller()
  const dir = fixtureDir({ 'package.json': A_PACKAGE_JSON, 'package-lock.json': '{ "lockfileVersion": 3 }\n' })

  assert.deepEqual(
    recipeOf(detectInstaller(dir)),
    NPM_RECIPE,
    'the npm recipe must stay exactly `npm ci --no-audit --no-fund` — 15.2 replaces the hardcoded spawn with this value, and an npm consumer must not notice the refactor at all',
  )
})

test('detectInstaller: BOTH lockfiles → pnpm wins, and the win is RECORDED', async () => {
  const detectInstaller = await loadDetectInstaller()
  // Written pnpm-first here and package-lock-first below: a precedence that depends on directory
  // order is not a precedence, it is whichever readdir/statSync happened to run first.
  const pnpmFirst = fixtureDir({
    'package.json': A_PACKAGE_JSON,
    'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
    'package-lock.json': '{ "lockfileVersion": 3 }\n',
  })
  const npmFirst = fixtureDir({
    'package.json': A_PACKAGE_JSON,
    'package-lock.json': '{ "lockfileVersion": 3 }\n',
    'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
  })

  for (const [label, dir] of [['pnpm-lock written first', pnpmFirst], ['package-lock written first', npmFirst]]) {
    const got = detectInstaller(dir)
    assert.deepEqual(
      recipeOf(got),
      PNPM_RECIPE,
      `both lockfiles present (${label}) must resolve to the pnpm recipe — pnpm-lock.yaml is the stricter claim, and running npm ci against a tree pnpm installed rebuilds node_modules in the wrong shape`,
    )
    assert.equal(
      typeof got.reason,
      'string',
      `an ambiguous dir that resolves silently teaches nobody why (${label}): detectInstaller must record WHY pnpm won on the returned recipe, e.g. a \`reason\` string`,
    )
    assert.ok(got.reason.length > 0, `an empty reason records nothing (${label})`)
    assert.match(
      got.reason,
      /pnpm-lock\.yaml/,
      `the recorded reason must name the lockfile that WON (${label}) — an operator reading it should not have to guess which file decided; got: ${got.reason}`,
    )
    assert.match(
      got.reason,
      /package-lock\.json/,
      `and the lockfile it beat (${label}): a reason that omits the loser is indistinguishable from the single-lockfile case and records no precedence at all; got: ${got.reason}`,
    )
  }
})

test('detectInstaller: a package dir with NEITHER lockfile is null — undecidable, never guessed', async () => {
  const detectInstaller = await loadDetectInstaller()
  const dir = fixtureDir({ 'package.json': A_PACKAGE_JSON })

  const got = detectInstaller(dir)
  // Strict equality, so this also pins the sentinel APART from undefined: 15.2 refuses loudly on
  // null and skips silently on undefined, so an undecidable package dir answering undefined would
  // launch a lane with no install at all.
  assert.equal(
    got,
    null,
    `a package dir with no lockfile is a decision the function may not invent: falling back to npm is exactly the failure 15.1 exists to end. Got ${JSON.stringify(got)}`,
  )
})

test('detectInstaller: a dir with no package.json is undefined — a non-package dir is skipped, not refused', async () => {
  const detectInstaller = await loadDetectInstaller()
  const empty = fixtureDir({})

  const got = detectInstaller(empty)
  // Strict again, and in this direction it is null that must not appear: 15.2 refuses on null, so a
  // non-package dir reported as undecidable would make every consumer without a web/ unlaunchable.
  assert.equal(
    got,
    undefined,
    `a dir that is not a package (no package.json) must read as "nothing to install here" — the caller walks worktree and worktree/web and most consumers have no web/. Got ${JSON.stringify(got)}`,
  )

  // The boundary: package.json is what makes a dir a package dir. A stray lockfile beside no
  // manifest (a leftover, a docs fixture) is still not a package dir — deciding on the lockfile
  // alone would have the caller install in a directory with nothing to install.
  const strayLock = fixtureDir({ 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n" })
  assert.equal(
    detectInstaller(strayLock),
    undefined,
    `a lockfile without a package.json is not a package dir — the manifest is the gate, the lockfile only picks the manager. Got ${JSON.stringify(detectInstaller(strayLock))}`,
  )
})

test('detectInstaller: the decision is a pure read — it installs nothing and is stable across calls', async () => {
  const detectInstaller = await loadDetectInstaller()
  const dir = fixtureDir({ 'package.json': A_PACKAGE_JSON, 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n" })
  const before = readdirSync(dir).sort()

  const first = detectInstaller(dir)
  const second = detectInstaller(dir)

  assert.deepEqual(
    readdirSync(dir).sort(),
    before,
    'detectInstaller must decide from filesystem reads alone: a probe that spawns a manager (or writes a node_modules/, a lockfile, a cache) is the un-testable install this task exists to remove',
  )
  assert.deepEqual(second, first, 'the same dir must decide the same way twice — a decision that drifts between the pre-creation probe and the post-creation re-run (15.2) refuses on nothing')
})

// ── 15.2: ensureWorktree CONSUMES the detector — and an undecidable consumer costs nothing ─────
// The order used to be inverted: `git worktree add` first, then a hardcoded `npm ci`. A pnpm
// consumer therefore paid a full checkout AND an orphan `codex/<N>` branch for a refusal it was
// always going to get (atlas worked around it by pre-creating worktrees by hand). What these tests
// pin is the ORDER — the decision happens while there is still nothing to clean up — and the
// per-package-dir recipe, asserted on the argv that was really spawned.
//
// Nothing installs here: `npm`, `pnpm` and `capbuild` are replaced on PATH by shims that RECORD
// their cwd + argv and exit 0. `capbuild` is shimmed deliberately — it exists for real on this
// host, so an unshimmed one would run the true install and reach the network.

/** Appends "<cwd>\t<bin>\t<arg>…" per invocation. `pwd -P` (not $PWD, which the parent's env
 *  carries in stale) is what makes the per-dir cwd assertions mean anything. */
const RECORDING_SHIM = [
  '#!/bin/sh',
  '{',
  '  printf \'%s\\t%s\' "$(pwd -P)" "$(basename "$0")"',
  '  for a in "$@"; do printf \'\\t%s\' "$a"; done',
  '  printf \'\\n\'',
  '} >> "$ZR_INSTALL_RECORD"',
  'exit 0',
  '',
].join('\n')

/**
 * A consumer whose lockfiles are COMMITTED: `git worktree add` checks the base out, so the
 * post-creation re-detect reads the worktree's own files rather than the primary checkout's.
 */
function installRepo(files, phaseId) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'codex-install-')))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const git = (...a) =>
    execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  git('init', '-q')
  writeFileSync(join(root, '.gitignore'), '.building/\n')
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, body)
  }
  mkdirSync(join(root, 'roadmap', 'phases'), { recursive: true })
  writeFileSync(join(root, 'roadmap', 'phases', `phase-${phaseId}.phase.ts`), 'export default {}\n')
  git('add', '--all')
  git('commit', '-q', '-m', 'seed: the consumer exactly as its lockfiles describe it')
  mkdirSync(join(root, '.building'), { recursive: true })
  const worktree = `${root}-codex-${phaseId}`
  cleanups.push(() => rmSync(worktree, { recursive: true, force: true }))
  return {
    root,
    worktree,
    base: git('rev-parse', 'HEAD'),
    /** Absolute paths of every worktree git knows about, primary checkout first. */
    worktrees: () =>
      git('worktree', 'list', '--porcelain')
        .split('\n')
        .filter((l) => l.startsWith('worktree '))
        .map((l) => l.slice('worktree '.length)),
    branchExists: (name) => {
      try {
        git('rev-parse', '--verify', `refs/heads/${name}`)
        return true
      } catch {
        return false
      }
    },
  }
}

/** PATH shims that record instead of installing, plus the fake `codex` driver so a successful
 *  probe still launches nothing real. */
function recordingEnv(root) {
  const binDir = join(root, 'shimbin')
  mkdirSync(binDir, { recursive: true })
  const record = join(root, 'installs.tsv')
  for (const name of ['npm', 'pnpm', 'capbuild']) {
    writeFileSync(join(binDir, name), RECORDING_SHIM)
    chmodSync(join(binDir, name), 0o755)
  }
  writeFileSync(join(binDir, 'codex'), '#!/bin/sh\nexit 0\n')
  chmodSync(join(binDir, 'codex'), 0o755)
  return {
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, ZR_INSTALL_RECORD: record },
    /** One { cwd, argv } per spawned install, sorted by cwd, with the capbuild wrapper stripped:
     *  WHETHER capbuild wraps is today's behavior and stays out of the recipe assertions. */
    installs: () =>
      (existsSync(record) ? readFileSync(record, 'utf8') : '')
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((line) => {
          const [cwd, ...argv] = line.split('\t')
          return { cwd, argv: argv[0] === 'capbuild' ? argv.slice(1) : argv }
        })
        .sort((a, b) => (a.cwd < b.cwd ? -1 : a.cwd > b.cwd ? 1 : 0)),
  }
}

const runLane = (fx, rec, id) =>
  spawnSync('node', [BIN, 'codex', 'run', String(id), '--worktree', fx.worktree, '--base', fx.base], {
    cwd: fx.root,
    encoding: 'utf8',
    env: rec.env,
  })

test('codex run: an undecidable consumer refuses naming both lockfiles, BEFORE worktree, branch or journal exist', () => {
  const fx = installRepo({ 'package.json': A_PACKAGE_JSON }, 151)
  const rec = recordingEnv(fx.root)

  const r = runLane(fx, rec, 151)

  assert.equal(
    r.status,
    1,
    `a package dir with no lockfile is undecidable: the lane must refuse with exit 1 rather than guess a manager; stderr:\n${r.stderr}`,
  )
  assert.ok(
    r.stderr.includes('pnpm-lock.yaml') && r.stderr.includes('package-lock.json'),
    `the refusal must name both supported lockfiles — an operator's fix is to commit one, and a message that names neither leaves them guessing; got:\n${r.stderr}`,
  )
  assert.ok(r.stderr.includes(fx.root), `and it must name the DIR it could not decide; got:\n${r.stderr}`)

  // The pre-state criterion: the probe runs BEFORE `git worktree add`, so the refusal is free.
  assert.equal(existsSync(fx.worktree), false, 'no worktree directory may survive a refusal the launcher could have made first')
  assert.deepEqual(
    fx.worktrees(),
    [fx.root],
    `git must still know exactly ONE worktree — a doomed install that runs AFTER the checkout is the cost this task removes; got: ${fx.worktrees().join(', ')}`,
  )
  assert.equal(
    fx.branchExists('codex/151'),
    false,
    'nor an orphan codex/151 branch: every retry against an undecidable consumer would leave another one behind',
  )
  assert.equal(existsSync(join(fx.root, '.building', 'codex-151.json')), false, 'and no journal — a refused lane has no run to reconcile')
  assert.equal(existsSync(join(fx.root, '.building', 'codex-151-prompt.txt')), false, 'nor a prompt for a mission that never launched')
  assert.deepEqual(rec.installs(), [], 'and no package manager was spawned at all — the decision is a filesystem read')
})

test('codex run: a pnpm consumer installs with `pnpm install --frozen-lockfile`, never npm ci', () => {
  const fx = installRepo({ 'package.json': A_PACKAGE_JSON, 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n" }, 152)
  const rec = recordingEnv(fx.root)

  const r = runLane(fx, rec, 152)

  assert.equal(r.status, 0, `a decidable consumer must launch; stderr:\n${r.stderr}`)
  assert.deepEqual(
    rec.installs(),
    [{ cwd: fx.worktree, argv: [PNPM_RECIPE.bin, ...PNPM_RECIPE.args] }],
    'the lockfile the consumer committed picks the manager: running npm ci against a pnpm tree is the bootstrap failure this task exists to end',
  )
  assert.equal(existsSync(join(fx.worktree, 'pnpm-lock.yaml')), true, 'and the re-detect read the WORKTREE — its own committed lockfile is what decided')
})

test('codex run: an npm consumer keeps the exact `npm ci --no-audit --no-fund` argv it ships today', () => {
  const fx = installRepo({ 'package.json': A_PACKAGE_JSON, 'package-lock.json': '{ "lockfileVersion": 3 }\n' }, 153)
  const rec = recordingEnv(fx.root)

  const r = runLane(fx, rec, 153)

  assert.equal(r.status, 0, `an npm consumer must still launch; stderr:\n${r.stderr}`)
  assert.deepEqual(
    rec.installs(),
    [{ cwd: fx.worktree, argv: [NPM_RECIPE.bin, ...NPM_RECIPE.args] }],
    'the npm path is a REGRESSION pin, argv byte-identical: every consumer of this lane today is an npm consumer, and routing them through the detector must change nothing they observe',
  )
})

test('codex run: a mixed-manager consumer gives the nested web/ package dir its OWN manager', () => {
  const fx = installRepo(
    {
      'package.json': A_PACKAGE_JSON,
      'package-lock.json': '{ "lockfileVersion": 3 }\n',
      'web/package.json': '{ "name": "web", "private": true }\n',
      'web/pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
    },
    154,
  )
  const rec = recordingEnv(fx.root)

  const r = runLane(fx, rec, 154)

  assert.equal(r.status, 0, `a mixed-manager consumer is decidable in both dirs and must launch; stderr:\n${r.stderr}`)
  assert.deepEqual(
    rec.installs(),
    [
      { cwd: fx.worktree, argv: [NPM_RECIPE.bin, ...NPM_RECIPE.args] },
      { cwd: join(fx.worktree, 'web'), argv: [PNPM_RECIPE.bin, ...PNPM_RECIPE.args] },
    ],
    'each package dir is decided by ITS OWN lockfile: one manager chosen at the root and applied to web/ is the same wrong-shaped node_modules, one level down',
  )
})

// ── 15.3: the envelope names the CLI it expects, and the grammar that BINDS ─────────────────────
// Two recorded failures, one channel. Both azure lane reports deviate on the same thing — "Bare
// `roadmap` was absent from PATH" (exit 127): `roadmap` is a shell convenience of the supervising
// session, and a detached driver inherits none of it. And three repos' curation broke because the
// executor was never told the subject grammar the CLI PARSES (mudarabah2: 11 phases whose curation
// never ran). The envelope is the one channel that reaches every delegated driver in every family,
// so both facts are pinned here — on the prompt file the launcher actually wrote, which is what the
// driver reads, not on a builder's return value.

/** Launch a lane with the fake `codex` on PATH and hand back the envelope the launcher wrote. */
function lanePrompt(root, argv, journalName) {
  const worktree = join(root, `wt-153-${journalName}`)
  const env = fakeLaunchEnv(root, worktree)
  const r = spawnSync('node', [BIN, 'codex', ...argv, '--worktree', worktree], { cwd: root, encoding: 'utf8', env })
  assert.equal(r.status, 0, `the ${journalName} lane must launch for its envelope to be observable; stderr:\n${r.stderr}`)
  return readFileSync(join(root, '.building', `${journalName}-prompt.txt`), 'utf8')
}

test('15.3 — every lane envelope names the roadmap CLI by ABSOLUTE path, and says why', () => {
  const root = tmpRepo()
  writePhase(root, 120)
  writePhase(root, 121)
  const brief = writeBrief(root)

  assert.ok(isAbsolute(BIN), 'precondition: the CLI path pinned below has to be absolute — a relative one would make every assertion here decorative')
  assert.ok(existsSync(BIN), `precondition: the CLI the envelopes must name has to exist at ${BIN} — an envelope naming a missing file briefs on nothing`)

  const lanes = [
    ['run', lanePrompt(root, ['run', '120'], 'codex-120')],
    ['review', lanePrompt(root, ['review', '121'], 'codex-review-121')],
    ['plan', lanePrompt(root, ['plan', '122', '--brief', brief], 'codex-plan-122')],
  ]

  for (const [lane, prompt] of lanes) {
    assert.ok(
      prompt.includes(BIN),
      `the ${lane} envelope never names ${BIN}, so a driver whose PATH has no \`roadmap\` cannot reach the CLI at all — both azure lane reports died exactly there (exit 127); fix cli/commands/codex.mjs: resolve the bin from import.meta.url the way RUN_SKILL does, and put that path in the envelope`,
    )
    assert.match(
      prompt,
      /absent from PATH/i,
      `the ${lane} envelope must SAY that bare \`roadmap\` may not be there — handed a long path with no reason, a driver still types the short command it has seen in every doc; fix cli/commands/codex.mjs`,
    )
  }
})

/**
 * The binding subject forms, as an executor must be able to COPY them. The `—` boundary is the
 * load-bearing part (it prevents prefix-number matches), so each form is pinned with the em dash
 * directly after the number — a prompt that teaches `phase N:` teaches an unparseable subject.
 */
const COMMIT_GRAMMAR = [
  {
    form: 'task',
    re: /phase N — N\.X:/,
    why: 'a task commit without `phase N — N.X:` is invisible to the unverified-done check and to curation — the mudarabah2 shape: 11 phases whose curation never ran',
  },
  {
    form: 'gate fix',
    re: /fix\([^)]*\): phase N gate R/,
    why: 'gate-round fixes that do not say `gate RX` cannot be told apart from task work when the round is reconstructed',
  },
  {
    form: 'roadmap-state',
    re: /docs\(roadmap\): phase N —/,
    why: 'the state commit is what base-SHA derivation keys on; a driver that invents its own subject moves the base of every later read',
  },
]

test('15.3 — the COMMITTING lanes (run, plan) are taught the binding subject grammar', () => {
  const root = tmpRepo()
  writePhase(root, 123)
  const brief = writeBrief(root)

  const lanes = [
    ['run', 'buildPrompt', lanePrompt(root, ['run', '123'], 'codex-123')],
    ['plan', 'buildPlanPrompt', lanePrompt(root, ['plan', '124', '--brief', brief], 'codex-plan-124')],
  ]

  for (const [lane, builder, prompt] of lanes) {
    for (const { form, re, why } of COMMIT_GRAMMAR) {
      assert.match(
        prompt,
        re,
        `the ${lane} envelope never names the ${form} subject form (${re}) — ${why}; fix cli/commands/codex.mjs ${builder}`,
      )
    }
    const grammarLine = prompt.split('\n').find((l) => /N\.X:/.test(l))
    assert.match(
      grammarLine ?? '',
      /bind/i,
      `the ${lane} grammar must carry its REASON — attribution binds on \`phase N —\`, and a rule with no why is the first thing a driver drops when its own habit disagrees; fix cli/commands/codex.mjs ${builder}`,
    )
  }
})

test('15.3 — the READ-ONLY review lane carries no commit grammar, and the run lane does (both directions)', () => {
  const root = tmpRepo()
  writePhase(root, 125)
  writePhase(root, 126)

  const runPrompt = lanePrompt(root, ['run', '125'], 'codex-125')
  const reviewPrompt = lanePrompt(root, ['review', '126'], 'codex-review-126')

  for (const { form, re } of COMMIT_GRAMMAR) {
    assert.match(
      runPrompt,
      re,
      `positive control: the run lane commits, so it must carry the ${form} form — without this side, the negative below would pass on a grammar the implementation never ships`,
    )
    assert.doesNotMatch(
      reviewPrompt,
      re,
      `the review lane is REPORT-ONLY and never commits: handing it the ${form} subject form briefs it for the one act the lane exists to forbid, and the existing "implementation grammar must not leak into a review" guard is what that costs; fix cli/commands/codex.mjs buildReviewPrompt`,
    )
  }
})

// ── 15.5: `plan --arc` is a SUPERVISED act — the refusal teaches the flow, never a traceback ─────
// The current path reaches an uncaught buildPlanPrompt count throw over `at` frames, none of
// which contains the string `--arc`. The operator learns that a counter disagreed, not WHY arc
// planning is not a lane mission: plan-arc owns the design-first gate, and that gate needs the user,
// while this lane is no-reachable-user by contract. There IS a supervised path (reserve each number,
// write each brief, delegate `codex plan <N> --brief <path>` per member), and a refusal that does
// not name it strands the operator at exactly the moment they asked the right question.
//
// So the tests below pin a REFUSAL, not a message: the count is not the reason (a ONE-member arc is
// refused too, and today it silently LAUNCHES), the refusal precedes every other plan-lane check
// (the no-brief invocation is the real one an operator types), and it creates nothing — no journal,
// no prompt, no worktree, no branch. Each absence is paired with a control proving this fixture
// could have produced that state, or the assertion would pass on a lane that never got that far.

/** An arc entity in the shape arcPhases() actually reads: `planes: [{ … phases: [ids] }]`. */
function writeArc(root, id, ids) {
  mkdirSync(join(root, 'roadmap', 'arcs'), { recursive: true })
  writeFileSync(
    join(root, 'roadmap', 'arcs', `${id}.arc.ts`),
    `export default { id: '${id}', planes: [{ name: 'only', phases: [${ids.join(', ')}] }] }\n`,
  )
  return id
}

/** One commit + a `develop` integration ref, so a launch reaching ensureWorktree really makes one. */
function seedDevelop(root) {
  const git = (...args) =>
    execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  writeFileSync(join(root, 'seed.txt'), 'seed\n')
  git('add', 'seed.txt')
  git('commit', '-q', '-m', 'seed')
  git('branch', '-f', 'develop')
  return git
}

/** planCodex's OWN default worktree shape — a SIBLING of the checkout, so it needs its own cleanup. */
function planWorktreeOf(root, ids) {
  const wt = `${root}-codex-plan-${ids.join('-')}`
  cleanups.push(() => rmSync(wt, { recursive: true, force: true }))
  return wt
}

/** A V8 frame — `\n    at fn (file:///…)`. The shape an operator must never be handed by a refusal. */
const STACK_FRAME = /\n\s+at \S+ \(?file:\/\//

test('15.5 — plan --arc refuses with the SUPERVISED flow: plan-arc, the per-member delegation, and no traceback', () => {
  const root = tmpRepo()
  const git = seedDevelop(root)
  writeArc(root, 'PLANARC', [130, 131])
  const env = fakeCodexPath(root)
  const arcWorktree = planWorktreeOf(root, [130, 131])

  // The invocation an operator actually types: no --brief, because they are asking for a whole arc.
  const r = spawnSync('node', [BIN, 'codex', 'plan', '--arc', 'PLANARC'], { cwd: root, encoding: 'utf8', env })

  assert.doesNotMatch(
    r.stderr,
    /needs a valid arc id/,
    `precondition: the fixture arc must RESOLVE, or every assertion below would pass on the WRONG refusal; got: ${r.stderr}`,
  )
  assert.equal(r.status, 1, `an arc plan must refuse with a clean exit 1, not crash out; got status ${r.status}: ${r.stderr}`)

  assert.match(
    r.stderr,
    /plan-arc/,
    `the refusal must NAME the supervised flow that owns this act — plan-arc holds the design-first gate, and that gate needs the user this lane contractually cannot reach; fix cli/commands/codex.mjs run(): refuse \`sub === 'plan' && arcId\` before planCodex; got: ${r.stderr}`,
  )
  assert.match(
    r.stderr,
    /codex plan\s+(?:<N>|130|131)\s+--brief/,
    `the refusal must hand back the per-member DELEGATION form (\`roadmap codex plan <N> --brief <path>\`, or the members spelled out) — an operator told only "no" has nowhere to go, and the lane can plan every member once each number is reserved and each brief written; got: ${r.stderr}`,
  )
  assert.doesNotMatch(
    r.stderr,
    /exactly ONE phase number/,
    `the one-number count error is an INTERNAL invariant of buildPlanPrompt, not an answer to "plan this arc" — it names neither --arc nor the flow that does plan arcs; refuse in run() BEFORE planCodex so this message is never what an arc call reaches; got: ${r.stderr}`,
  )
  assert.doesNotMatch(
    r.stderr,
    /at planCodex/,
    `an uncaught throw is not a refusal: the operator gets a traceback through the lane's own internals instead of the flow to use; got: ${r.stderr}`,
  )
  assert.doesNotMatch(
    r.stderr,
    STACK_FRAME,
    `no stack frame belongs in a REFUSAL — a refused command is a decision the CLI made, not a bug it hit; got: ${r.stderr}`,
  )

  // Nothing created. `.building/` predates the command (tmpRepo makes it), so each named artifact is
  // checked on its own — a directory listing would read as state the fixture itself provided.
  assert.ok(!existsSync(join(root, '.building', 'codex-plan-130-131.json')), 'a refused arc plan must journal nothing')
  assert.ok(!existsSync(join(root, '.building', 'codex-plan-130-131-prompt.txt')), 'a refused arc plan must write no prompt')
  assert.ok(!existsSync(join(root, '.building', 'codex-plan-130-131.log')), 'a refused arc plan must open no log')
  for (const n of [130, 131]) {
    assert.ok(
      !existsSync(join(root, '.building', `codex-plan-${n}.json`)),
      `the refusal DELEGATES per member, it does not fan out and launch them: no lane may be started for phase ${n}`,
    )
  }
  assert.ok(!existsSync(arcWorktree), `a refused arc plan must leave no worktree at ${arcWorktree}`)
  assert.doesNotMatch(git('branch', '--list'), /codex-plan\//, 'a refused arc plan must leave no orphan codex-plan/ branch')

  // CONTROL: the same seeded repo DOES produce all of that for a plain number — so the absences
  // above are the refusal's doing, not a fixture that could never reach ensureWorktree.
  const brief = writeBrief(root)
  const soloWorktree = planWorktreeOf(root, [136])
  const ok = spawnSync('node', [BIN, 'codex', 'plan', '136', '--brief', brief], { cwd: root, encoding: 'utf8', env })
  assert.equal(ok.status, 0, `control: a plain-number plan must still launch in this fixture; stderr: ${ok.stderr}`)
  assert.ok(existsSync(join(root, '.building', 'codex-plan-136.json')), 'control: a launched plan lane journals')
  assert.ok(existsSync(soloWorktree), 'control: a launched plan lane makes its worktree — which is what the arc call above must NOT do')
  assert.match(git('branch', '--list'), /codex-plan\/136/, 'control: a launched plan lane makes its branch')
})

test('15.5 — the refusal keys on --arc, not on the COUNT: a ONE-member arc is refused too, and launches nothing', () => {
  const root = tmpRepo()
  writeArc(root, 'SOLOARC', [132])
  const brief = writeBrief(root)
  // Pre-made worktree + a valid brief: every other plan-lane guard is satisfied, so today this call
  // sails through to a real launch. The arc question is the ONLY thing standing in front of it.
  const worktree = join(root, 'wt-plan-arc-132')
  const env = fakeLaunchEnv(root, worktree)

  const r = spawnSync('node', [BIN, 'codex', 'plan', '--arc', 'SOLOARC', '--brief', brief, '--worktree', worktree], { cwd: root, encoding: 'utf8', env })

  assert.equal(
    r.status,
    1,
    `--arc asks for ARC planning, and that is supervised whether the arc holds one member or seven — a one-member arc that plans anyway makes the refusal a count check wearing a lesson's clothes; got status ${r.status}: ${r.stderr}`,
  )
  assert.match(r.stderr, /plan-arc/, `the same teaching refusal is owed here; got: ${r.stderr}`)
  assert.doesNotMatch(r.stderr, STACK_FRAME, `a refusal carries no stack frame; got: ${r.stderr}`)
  assert.ok(!existsSync(join(root, '.building', 'codex-plan-132.json')), 'a refused arc plan must journal nothing — a one-member arc is not a shortcut into the lane')
  assert.ok(!existsSync(join(root, '.building', 'codex-plan-132-prompt.txt')), 'a refused arc plan must write no prompt')
  assert.ok(!existsSync(join(root, '.building', 'codex-plan-132.log')), 'a refused arc plan must open no log')
  assert.ok(!existsSync(join(root, 'roadmap', 'phases', 'phase-132.phase.ts')), 'a refused arc plan must author nothing')
})

test('15.5 — the one-number backstop SURVIVES: a multi-id NON-arc plan still refuses, naming the count rule', () => {
  const root = tmpRepo()
  const brief = writeBrief(root)
  const worktree = join(root, 'wt-plan-multi')
  const env = fakeLaunchEnv(root, worktree)
  // No --arc anywhere: the arc refusal must not have REPLACED the count invariant, and the count
  // invariant must not have been relaxed to make room for it. One plan act authors one phase file.
  const r = spawnSync('node', [BIN, 'codex', 'plan', '133', '134', '--brief', brief, '--worktree', worktree], { cwd: root, encoding: 'utf8', env })

  assert.notEqual(r.status, 0, `two numbers is still two plans — the backstop must refuse; stderr: ${r.stderr}`)
  assert.match(
    r.stderr,
    /exactly ONE phase number/,
    `the buildPlanPrompt backstop stays for the multi-id NON-arc call: the 15.5 refusal narrows to --arc, it does not take the count rule with it; got: ${r.stderr}`,
  )
  assert.ok(!existsSync(join(root, '.building', 'codex-plan-133-134.json')), 'a refused launch must journal nothing')
})

test('15.5 — `codex run --arc` is UNTOUCHED: the arc still resolves to its members and launches as one run', () => {
  const root = tmpRepo()
  writeArc(root, 'RUNARC', [130, 131])
  writePhase(root, 130)
  writePhase(root, 131)
  const worktree = join(root, 'wt-run-arc')
  const env = fakeLaunchEnv(root, worktree)

  const r = spawnSync('node', [BIN, 'codex', 'run', '--arc', 'RUNARC', '--worktree', worktree], { cwd: root, encoding: 'utf8', env })
  assert.equal(r.status, 0, `the RUN lane plans nothing and needs no design-first gate — an arc run is exactly what --arc was built for; stderr: ${r.stderr}`)
  assert.doesNotMatch(r.stderr, /plan-arc/, 'the plan-lane refusal must be scoped to the plan subcommand — a run must never be taught the plan flow')

  const j = JSON.parse(readFileSync(join(root, '.building', 'codex-130-131.json'), 'utf8'))
  assert.deepEqual(j.phases, ['130', '131'], 'the arc still resolves to its member phases, in planes order, under ONE journal')
  assert.equal(j.lane, 'run')
  assert.equal(j.worktree, worktree)
  assert.equal(j.report, 'CODEX-REPORT.md')

  const prompt = readFileSync(join(root, '.building', 'codex-130-131-prompt.txt'), 'utf8')
  for (const n of [130, 131]) {
    assert.ok(prompt.includes(`roadmap/phases/phase-${n}.phase.ts`), `the arc run still targets every member — phase ${n} is missing from the envelope`)
  }
})

// ── The two branches phase 15's own review found unexercised (gate R1, substituted reviewer) ──

test('run: a worktree checked out from a base ref carrying NO lockfile refuses after creation', () => {
  // The pre-check reads the PRIMARY root; the post-creation check reads the CREATED tree, and the
  // two can disagree — a base ref whose commit predates the lockfile yields a package dir that
  // declares no manager. That arm must refuse rather than guess, and it is the only way to reach
  // it (a pre-created --worktree is a provisioned slot the launcher deliberately does not install).
  const root = tmpRepo()
  writeFileSync(join(root, 'package.json'), '{ "name": "consumer", "private": true }\n')
  execFileSync('git', ['add', 'package.json'], { cwd: root })
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base without a lockfile'], { cwd: root })
  execFileSync('git', ['branch', 'base-nolock'], { cwd: root })
  // The primary now carries one, so the PRE-check passes and the refusal must come from the tree.
  writeFileSync(join(root, 'package-lock.json'), '{ "lockfileVersion": 3 }\n')
  writePhase(root, 92)

  const r = spawnSync('node', [BIN, 'codex', 'run', '92', '--base', 'base-nolock'], {
    cwd: root,
    encoding: 'utf8',
    env: fakeCodexPath(root),
  })

  assert.notEqual(r.status, 0, 'a created worktree whose package dir declares no lockfile must REFUSE, never install with a guessed manager')
  assert.match(
    r.stderr,
    /cannot select a package manager/,
    `the refusal must name the undecidable dir and both accepted lockfiles — got: ${r.stderr}`,
  )
  assert.ok(
    !existsSync(join(root, '.building', 'codex-92.json')),
    'the refusal precedes launch(), so no journal may claim this lane ran',
  )
})

test('plan close: a toolchain gap is reported as one, never as an invalid authored file', async () => {
  // The validator exits 1 for toolchain-missing and 2 for a bad entity. A lane launched over a
  // pre-created worktree never installs, so exit 1 is reachable with a perfectly good plan —
  // blaming the file would send the operator to rewrite something that is fine.
  const src = readFileSync(new URL('./codex.mjs', import.meta.url), 'utf8')
  assert.match(
    src,
    /the lane's toolchain is incomplete, which says nothing about the authored file/,
    'archivePlanLane must separate validator exit 1 (toolchain) from exit 2 (invalid entity) — cli/commands/codex.mjs',
  )
  assert.match(
    src,
    /validation\.status === 1/,
    'the split must key on the validator EXIT CODE, not on message text — cli/commands/codex.mjs',
  )
  assert.match(
    src,
    /validation\.error\?\.message/,
    'a spawn that never ran leaves its cause in error.message; dropping it makes the refusal undebuggable — cli/commands/codex.mjs',
  )
})
