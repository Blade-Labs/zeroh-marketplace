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
 * The review-lane tests below pin the property that makes two lanes safe to share one
 * command: separate journals, prompts and report names, so a review and an implementation of
 * the same phase can never read each other's verdict — plus the read-only mission rules,
 * which are the only thing standing between an unsandboxed Codex and the plans it reviews.
 *
 * Hermetic-tmp-git-repo pattern from cli/commands/claim.test.mjs; the launch-path tests put a
 * fake `codex` executable on PATH and pre-make the worktree so nothing real launches.
 *
 * Run: node --test cli/commands/codex.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync, spawn } from 'node:child_process'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, realpathSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DRIVERS } from '../lib/drivers.mjs'

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
function writeBrief(root, name = '.building/plan-brief.md') {
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
