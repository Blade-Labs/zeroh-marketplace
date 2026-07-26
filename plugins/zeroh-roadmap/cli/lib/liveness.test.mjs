#!/usr/bin/env node
/**
 * liveness.test.mjs — the PORTED executor-liveness suite driving the CLI entry
 * `node bin/roadmap.mjs watch --once <sidecar> --json` (arc ROADCODE 1657.6). Every case
 * keeps its assertion verbatim from scripts/executor-liveness.test.mjs; only the entry
 * invocation changed (the verdict engine is now cli/lib/liveness.mjs). Hermetic via the
 * LIVENESS_* seams. Run: node --test cli/lib/liveness.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const BIN = join(HERE, '..', '..', 'bin', 'roadmap.mjs')

const tmps = []
function newTmp() {
  const d = mkdtempSync(join(tmpdir(), 'zr-liveness-'))
  tmps.push(d)
  return d
}
process.on('exit', () => {
  for (const d of tmps) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* best-effort */
    }
  }
})

const isoAgo = (min) => new Date(Date.now() - min * 60_000).toISOString()

function makeArc(dir, arcId, beaconLines) {
  const registry = join(dir, '.building')
  mkdirSync(registry, { recursive: true })
  const sidecar = join(registry, `${arcId}.json`)
  writeFileSync(sidecar, JSON.stringify({ arcId, worktree: dir, branch: 'develop', baseRef: 'develop', mode: 'inline' }))
  if (beaconLines) writeFileSync(join(registry, `${arcId}-executor.jsonl`), beaconLines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return sidecar
}

function run(sidecar, extraArgs = [], env = {}) {
  const merged = { ...process.env, LIVENESS_PGREP_CMD: 'true', LIVENESS_PROBE_MS: '20', ...env }
  for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k]
  const out = execFileSync('node', [BIN, 'watch', '--once', sidecar, '--json', ...extraArgs], { encoding: 'utf8', env: merged })
  return JSON.parse(out)
}

function agentRecord(type, stopReason, text, tsIso) {
  return {
    type,
    timestamp: tsIso,
    message: type === 'assistant' ? { role: 'assistant', stop_reason: stopReason, content: [{ type: 'text', text }] } : { role: 'user', content: [] },
  }
}
function makeAgentTranscript(dir, records) {
  const tdir = join(dir, 'transcripts')
  mkdirSync(tdir, { recursive: true })
  const target = join(tdir, 'agent-abc123.jsonl')
  writeFileSync(target, records.map((r) => JSON.stringify(r)).join('\n') + '\n')
  symlinkSync(target, join(tdir, 'aabc123.output'))
  return tdir
}
function startAppender(file) {
  const p = spawn('sh', ['-c', `for i in $(seq 1 100); do printf x >> "${file}"; sleep 0.02; done`], { stdio: 'ignore' })
  return () => {
    try {
      p.kill('SIGKILL')
    } catch {
      /* gone */
    }
  }
}

test('1) fresh commit beacon → ALIVE', () => {
  const d = newTmp()
  const r = run(makeArc(d, 'A1', [{ ts: isoAgo(2), phase: 100, event: 'commit', detail: 'abc123 feat: x' }]))
  assert.equal(r.verdict, 'ALIVE')
  assert.match(r.evidence.beacon, /age 2\.\dmin/)
})

test('2) 30-min gate-stage-start beacon → QUIET', () => {
  const d = newTmp()
  const r = run(makeArc(d, 'A2', [{ ts: isoAgo(30), phase: null, event: 'gate-stage-start', detail: 'code-review' }]))
  assert.equal(r.verdict, 'QUIET')
  assert.match(r.evidence.beacon, /gate-stage-start/)
})

test('3) 90-min beacon + symlink .output not growing + no pgrep → STALLED (symlink trap dead)', () => {
  const d = newTmp()
  const sc = makeArc(d, 'A3', [{ ts: isoAgo(90), phase: 100, event: 'commit', detail: 'abc123 feat: x' }])
  const tdir = join(d, 'transcripts')
  mkdirSync(tdir, { recursive: true })
  const target = join(tdir, 'real-transcript.jsonl')
  writeFileSync(target, 'x'.repeat(5000))
  symlinkSync(target, join(tdir, 'agent.output'))
  const r = run(sc, ['--transcript-dir', tdir])
  assert.equal(r.verdict, 'STALLED')
  assert.match(r.evidence.transcript, /5000B/, 'reports the realpath TARGET size, not a symlink stub')
})

test('4) background-run beacon + a log that grows between probes → ALIVE', () => {
  const d = newTmp()
  const logFile = join(d, 'bg.log')
  writeFileSync(logFile, '')
  const sc = makeArc(d, 'A4', [{ ts: isoAgo(30), phase: 100, event: 'background-run', detail: 'full suite', log: logFile }])
  const stop = startAppender(logFile)
  try {
    const r = run(sc, [], { LIVENESS_PROBE_MS: '400' })
    assert.equal(r.verdict, 'ALIVE')
    assert.match(r.evidence.log, /grew: true/)
  } finally {
    stop()
  }
})

test('6) DEFAULT pgrep path must not self-match its own invocation', () => {
  const d = newTmp()
  const sc = makeArc(d, 'A6', [{ ts: isoAgo(90), phase: 100, event: 'commit', detail: 'abc123 feat: x' }])
  const r = run(sc, [], { LIVENESS_PGREP_CMD: undefined })
  assert.equal(r.verdict, 'STALLED')
  assert.match(r.evidence.pgrep, /^0 process/)
})

test('7) final transcript record = assistant end_turn (old) → EXITED, outranking a fresh beacon', () => {
  const d = newTmp()
  const sc = makeArc(d, 'A7', [{ ts: isoAgo(2), phase: 100, event: 'commit', detail: 'abc123 feat: x' }])
  const tdir = makeAgentTranscript(d, [
    agentRecord('assistant', 'tool_use', 'committing task 1', isoAgo(12)),
    agentRecord('assistant', 'end_turn', 'Task 1397.1 committed. Preparing 1397.2 next.', isoAgo(10)),
  ])
  const r = run(sc, ['--transcript-dir', tdir])
  assert.equal(r.verdict, 'EXITED')
  assert.match(r.evidence.exit, /end_turn/)
  assert.match(r.evidence.finalMessage, /Preparing 1397\.2/)
})

test('8) mid-turn transcript → no EXITED, normal rows decide', () => {
  const d = newTmp()
  const sc = makeArc(d, 'A8', [{ ts: isoAgo(90), phase: 100, event: 'commit', detail: 'abc123 feat: x' }])
  const tdir = makeAgentTranscript(d, [agentRecord('assistant', 'end_turn', 'earlier turn', isoAgo(60)), agentRecord('user', null, '', isoAgo(10))])
  const r = run(sc, ['--transcript-dir', tdir])
  assert.equal(r.verdict, 'STALLED')
  assert.equal(r.evidence.exit, undefined)
})

test('9) end_turn younger than the settle window → not yet EXITED', () => {
  const d = newTmp()
  const sc = makeArc(d, 'A9', [{ ts: isoAgo(2), phase: 100, event: 'commit', detail: 'abc123 feat: x' }])
  const tdir = makeAgentTranscript(d, [agentRecord('assistant', 'end_turn', 'done-ish', isoAgo(1))])
  const r = run(sc, ['--transcript-dir', tdir])
  assert.equal(r.verdict, 'ALIVE')
})

test('5) no beacon + growing transcript → pre-beacon QUIET', () => {
  const d = newTmp()
  const sc = makeArc(d, 'A5', null)
  const tdir = join(d, 'transcripts')
  mkdirSync(tdir, { recursive: true })
  const out = join(tdir, 'agent.output')
  writeFileSync(out, '')
  const stop = startAppender(out)
  try {
    const r = run(sc, ['--transcript-dir', tdir], { LIVENESS_PROBE_MS: '400' })
    assert.equal(r.verdict, 'pre-beacon QUIET')
    assert.equal(r.preBeacon, true)
    assert.match(r.evidence.transcript, /grew: true/)
  } finally {
    stop()
  }
})

test('10) PRODUCTION layout — beacon in <worktree>/.building keyed by PHASE → discovered, ALIVE', () => {
  const d = newTmp()
  const registry = join(d, 'roadmap', 'arcs', '.building')
  mkdirSync(registry, { recursive: true })
  const sidecar = join(registry, 'MKT.json')
  writeFileSync(sidecar, JSON.stringify({ arcId: 'MKT', worktree: d, branch: 'arc/mkt', baseRef: 'develop', mode: 'mixed' }))
  const beaconDir = join(d, '.building')
  mkdirSync(beaconDir, { recursive: true })
  writeFileSync(join(beaconDir, '1333-executor.jsonl'), JSON.stringify({ ts: isoAgo(2), phase: 1333, event: 'task-start' }) + '\n')
  const r = run(sidecar)
  assert.equal(r.verdict, 'ALIVE')
  assert.equal(r.preBeacon, false)
  assert.match(r.evidence.beacon, /1333-executor\.jsonl/)
})

test('11) stale beacon but a worktree file touched moments ago → ALIVE (activity row)', () => {
  const d = newTmp()
  const sc = makeArc(d, 'A11', [{ ts: isoAgo(90), phase: 100, event: 'commit', detail: 'abc123 feat: x' }])
  mkdirSync(join(d, 'src'), { recursive: true })
  writeFileSync(join(d, 'src', 'turn.ts'), 'export {}\n')
  const r = run(sc)
  assert.equal(r.verdict, 'ALIVE')
  assert.match(r.evidence.activity, /newest worktree file/)
})

test('12) stale beacon but a git commit minutes ago → ALIVE (activity row, commit signal)', () => {
  const d = newTmp()
  const sc = makeArc(d, 'A12', [{ ts: isoAgo(90), phase: 100, event: 'commit', detail: 'abc123 feat: x' }])
  const g = (...a) => execFileSync('git', ['-C', d, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { stdio: ['ignore', 'pipe', 'ignore'] })
  g('init', '-q')
  writeFileSync(join(d, 'work.txt'), 'x')
  g('add', 'work.txt')
  g('commit', '-qm', 'work')
  const r = run(sc)
  assert.equal(r.verdict, 'ALIVE')
  assert.match(r.evidence.activity, /last commit/)
})

test('13) no beacon, nothing else, sidecar just written → pre-beacon QUIET (grace window)', () => {
  const d = newTmp()
  const r = run(makeArc(d, 'A13', null))
  assert.equal(r.verdict, 'pre-beacon QUIET')
  assert.match(r.evidence.grace, /grace window/)
})

test('14) no beacon, grace expired, no activity → pre-beacon STALLED', () => {
  const d = newTmp()
  const r = run(makeArc(d, 'A14', null), [], { LIVENESS_PREBEACON_GRACE_MIN: '0' })
  assert.equal(r.verdict, 'pre-beacon STALLED')
  assert.equal(r.evidence.grace, undefined)
})

// ── arc scoping: a shared checkout runs several arcs at once, and adopting a sibling lane's
// beacon reported a stalled executor as ALIVE (the one direction this verdict must not fail in).
function writePhaseFile(dir, phase, arcId) {
  const pdir = join(dir, 'roadmap', 'phases')
  mkdirSync(pdir, { recursive: true })
  const p = join(pdir, `phase-${phase}.phase.ts`)
  writeFileSync(p, `export default definePhase({\n  phase: ${phase},\n  status: 'in-progress',\n  arcId: '${arcId}',\n})\n`)
  // Age it out of the activity row: a fixture file written moments ago would answer ALIVE through
  // the newest-worktree-file signal and hide the beacon rule these cases exist to pin.
  const old = new Date(Date.now() - 6 * 3600_000)
  utimesSync(p, old, old)
}

test('15) a SIBLING arc\'s fresh phase beacon is not adopted — the stalled arc reads STALLED, not ALIVE', () => {
  const d = newTmp()
  // This arc's own beacon is 90 minutes cold; the sibling's is seconds old and would win on mtime.
  const sc = makeArc(d, 'MINE', [{ ts: isoAgo(90), phase: 500, event: 'task-start' }])
  writePhaseFile(d, 500, 'MINE')
  writePhaseFile(d, 900, 'SIBLING')
  writeFileSync(
    join(d, '.building', '900-executor.jsonl'),
    JSON.stringify({ ts: isoAgo(0), phase: 900, event: 'task-start' }) + '\n',
  )
  const r = run(sc, [], { LIVENESS_PREBEACON_GRACE_MIN: '0' })
  assert.equal(r.verdict, 'STALLED', 'a sibling lane must not vouch for this arc')
  assert.match(r.evidence.beacon, /age 9\d\.\dmin/, 'the verdict rests on THIS arc\'s own cold beacon')
  assert.match(r.evidence.beacon, /1 beacon\(s\) skipped: not this arc/)
})

test('16) a phase beacon whose file declares THIS arc is still adopted', () => {
  const d = newTmp()
  const sc = makeArc(d, 'MINE', null)
  writePhaseFile(d, 501, 'MINE')
  writeFileSync(
    join(d, '.building', '501-executor.jsonl'),
    JSON.stringify({ ts: isoAgo(1), phase: 501, event: 'task-start' }) + '\n',
  )
  const r = run(sc)
  assert.equal(r.verdict, 'ALIVE')
  assert.match(r.evidence.beacon, /501-executor\.jsonl/)
})

test('17) an UNRESOLVABLE phase file stays adopted — unknown is not proof of foreignness', () => {
  const d = newTmp()
  const sc = makeArc(d, 'MINE', null)
  // No phase file written at all: the engine cannot prove ownership either way.
  writeFileSync(
    join(d, '.building', '502-executor.jsonl'),
    JSON.stringify({ ts: isoAgo(1), phase: 502, event: 'task-start' }) + '\n',
  )
  const r = run(sc)
  assert.equal(r.verdict, 'ALIVE', 'trading a false ALIVE for a false STALLED is not a fix')
})

test('18) another ARC-keyed beacon in the shared registry is proof by name alone', () => {
  const d = newTmp()
  const sc = makeArc(d, 'MINE', [{ ts: isoAgo(90), phase: 503, event: 'task-start' }])
  writeFileSync(
    join(d, '.building', 'OTHERARC-executor.jsonl'),
    JSON.stringify({ ts: isoAgo(0), phase: 999, event: 'task-start' }) + '\n',
  )
  const r = run(sc, [], { LIVENESS_PREBEACON_GRACE_MIN: '0' })
  assert.equal(r.verdict, 'STALLED')
  assert.match(r.evidence.beacon, /1 beacon\(s\) skipped: not this arc/)
})

// ── residuals: prose-vs-field arcId, arcless phase beacons, and the worktree-wide activity rows
// that vouch for whichever lane is busy rather than for the arc being asked about.
function armSibling(dir, arcId, worktree) {
  writeFileSync(join(dir, '.building', `${arcId}.json`), JSON.stringify({ arcId, worktree, branch: 'develop', mode: 'inline' }))
}

test('19) a DOCSTRING naming another arc does not hand this arc a sibling beacon', () => {
  const d = newTmp()
  const sc = makeArc(d, 'MINE', [{ ts: isoAgo(90), phase: 600, event: 'task-start' }])
  writePhaseFile(d, 600, 'MINE')
  const pdir = join(d, 'roadmap', 'phases')
  // The prose names MINE above a field that declares SIBLING: a whole-file first match reads the
  // docstring and wrongly adopts this beacon.
  const p = join(pdir, 'phase-901.phase.ts')
  writeFileSync(p, `/**\n * supersedes arcId: 'MINE'\n */\nexport default definePhase({\n  phase: 901,\n  status: 'in-progress',\n  arcId: 'SIBLING',\n})\n`)
  const old = new Date(Date.now() - 6 * 3600_000)
  utimesSync(p, old, old)
  writeFileSync(join(d, '.building', '901-executor.jsonl'), JSON.stringify({ ts: isoAgo(0), phase: 901, event: 'task-start' }) + '\n')
  const r = run(sc, [], { LIVENESS_PREBEACON_GRACE_MIN: '0' })
  assert.equal(r.verdict, 'STALLED', 'the arcId FIELD decides ownership, never the prose above it')
  assert.match(r.evidence.beacon, /1 beacon\(s\) skipped: not this arc/)
})

test('20) an ARCLESS phase beacon is not adopted — a standalone run is nobody\'s executor', () => {
  const d = newTmp()
  const sc = makeArc(d, 'MINE', [{ ts: isoAgo(90), phase: 601, event: 'task-start' }])
  writePhaseFile(d, 601, 'MINE')
  const p = join(join(d, 'roadmap', 'phases'), 'phase-902.phase.ts')
  writeFileSync(p, `export default definePhase({\n  phase: 902,\n  status: 'in-progress',\n})\n`)
  const old = new Date(Date.now() - 6 * 3600_000)
  utimesSync(p, old, old)
  writeFileSync(join(d, '.building', '902-executor.jsonl'), JSON.stringify({ ts: isoAgo(0), phase: 902, event: 'task-start' }) + '\n')
  const r = run(sc, [], { LIVENESS_PREBEACON_GRACE_MIN: '0' })
  assert.equal(r.verdict, 'STALLED')
  assert.match(r.evidence.beacon, /1 beacon\(s\) skipped: not this arc/)
})

test('21) SHARED worktree: a sibling lane\'s commit no longer vouches for a stalled arc', () => {
  const d = newTmp()
  const sc = makeArc(d, 'MINE', [{ ts: isoAgo(90), phase: 700, event: 'task-start' }])
  writePhaseFile(d, 700, 'MINE')
  writePhaseFile(d, 800, 'SIBLING')
  armSibling(d, 'SIBLING', d)
  const g = (...a) => execFileSync('git', ['-C', d, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { stdio: ['ignore', 'pipe', 'ignore'] })
  g('init', '-q')
  writeFileSync(join(d, 'work.txt'), 'x')
  g('add', 'work.txt')
  g('commit', '-qm', 'feat(x): phase 800 — 800.1 the sibling lane moves')
  const r = run(sc, [], { LIVENESS_PREBEACON_GRACE_MIN: '0' })
  assert.equal(r.verdict, 'STALLED', 'a sibling commit is not this arc moving')
  assert.match(r.evidence.shared, /shared with 1 other armed arc/)
})

test('22) SHARED worktree: this arc\'s OWN phase commit still reads ALIVE', () => {
  const d = newTmp()
  const sc = makeArc(d, 'MINE', [{ ts: isoAgo(90), phase: 701, event: 'task-start' }])
  writePhaseFile(d, 701, 'MINE')
  armSibling(d, 'SIBLING', d)
  const g = (...a) => execFileSync('git', ['-C', d, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { stdio: ['ignore', 'pipe', 'ignore'] })
  g('init', '-q')
  writeFileSync(join(d, 'work.txt'), 'x')
  g('add', 'work.txt')
  g('commit', '-qm', 'feat(x): phase 701 — 701.1 this arc moves')
  const r = run(sc, [], { LIVENESS_PREBEACON_GRACE_MIN: '0' })
  assert.equal(r.verdict, 'ALIVE')
  assert.match(r.evidence.activity, /naming one of this arc's phases/)
})

test('23) SOLO worktree keeps the unattributed commit row exactly as it was', () => {
  const d = newTmp()
  const sc = makeArc(d, 'MINE', [{ ts: isoAgo(90), phase: 702, event: 'task-start' }])
  const g = (...a) => execFileSync('git', ['-C', d, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { stdio: ['ignore', 'pipe', 'ignore'] })
  g('init', '-q')
  writeFileSync(join(d, 'work.txt'), 'x')
  g('add', 'work.txt')
  g('commit', '-qm', 'chore: a commit naming no phase at all')
  const r = run(sc, [], { LIVENESS_PREBEACON_GRACE_MIN: '0' })
  assert.equal(r.verdict, 'ALIVE', 'no sibling arc is armed here, so the worktree signals still speak for it')
  assert.equal(r.evidence.shared, undefined)
})

test('24) SHARED worktree: this arc\'s own commit is found behind a burst of sibling commits', () => {
  const d = newTmp()
  const sc = makeArc(d, 'MINE', [{ ts: isoAgo(90), phase: 703, event: 'task-start' }])
  writePhaseFile(d, 703, 'MINE')
  writePhaseFile(d, 804, 'SIBLING')
  armSibling(d, 'SIBLING', d)
  const g = (...a) => execFileSync('git', ['-C', d, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { stdio: ['ignore', 'pipe', 'ignore'] })
  g('init', '-q')
  writeFileSync(join(d, 'ours.txt'), 'x')
  g('add', 'ours.txt')
  g('commit', '-qm', 'feat(x): phase 703 — 703.1 this arc moves')
  // A busy tree buries it: a count-capped scan would never reach our commit and would call a
  // working lane stalled. The window is TIME, so the burst cannot hide it.
  for (let i = 0; i < 35; i++) {
    writeFileSync(join(d, `sib-${i}.txt`), 'x')
    g('add', `sib-${i}.txt`)
    g('commit', '-qm', `chore(x): phase 804 — 804.${i} sibling noise`)
  }
  const r = run(sc, [], { LIVENESS_PREBEACON_GRACE_MIN: '0' })
  assert.equal(r.verdict, 'ALIVE')
  assert.match(r.evidence.activity, /naming one of this arc's phases/)
})
