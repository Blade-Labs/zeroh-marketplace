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
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, realpathSync, statSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
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
  assert.ok(
    !prompt.includes('--verify-complete'),
    'the completion protocol is the skill\'s — restating its steps beside the attribution override is how the two copies drift; fix cli/commands/codex.mjs buildPrompt',
  )
})

// ── review lane ────────────────────────────────────────────────────────────

/** A premade worktree + fake `codex` on PATH: the launch path runs, nothing real spawns. */
function fakeLaunchEnv(root, worktree) {
  mkdirSync(worktree, { recursive: true })
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
