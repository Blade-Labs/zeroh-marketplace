#!/usr/bin/env node
/**
 * eval-collect.test.mjs — the ArcTrace COLLECTOR (arc EVALCORE, 1996.2): everything the
 * scorer is allowed to look at, read from disk alone. Fixtures come from the shared
 * corpus builder (cli/testdata/eval-arc/build-fixture.mjs), which materializes a real
 * consumer repo — real phase files parsed through the REAL consumer schema over the REAL
 * tsx bridge, real roadmap/.gate run reports, real dated artifacts and a scripted git
 * history with ONE planted post-land escape fix and two decoys (an unrelated fix, and a
 * body-only phase mention that must never move the land boundary).
 *
 * The invariants under test are absence invariants: an absent artifact must surface as an
 * ABSENT FIELD (the scorer owns the single absence→sentinel mapping), a phase file that
 * will not import must be RECORDED as a parse failure and named in warnings (a silently
 * dropped phase would quietly improve every average it should have dragged down), and a
 * collect must never mint a driver, a plannedBy or a landedAt it cannot evidence.
 *
 * Run: node --test cli/lib/eval-collect.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { defaultExec } from './exec.mjs'
import { bridgeEval } from './tsx-bridge.mjs'
import { buildEvalFixture, ARC_ID, PHASE_NUMS, SUMMARY_DATE } from '../testdata/eval-arc/build-fixture.mjs'
import { GateRunReportShape, writeReport } from './gate-report.mjs'
import { MODEL_IDS } from './drivers.mjs'
import {
  collectArcTrace,
  summarizeGateRuns,
  findArcGitFacts,
  newestArtifact,
  newestArtifactDated,
  assembleWorkflowStamp,
  assembleConsumerFingerprint,
  assemblePhaseEvalRecord,
  phaseEvalRecordPath,
  phaseEvalValidator,
  readPhaseEvalSamples,
  PEVAL_NAME_RE,
  WORKFLOW_PROFILE,
  CollectError,
} from './eval-collect.mjs'
// The OTHER dated scan over the same directory. Imported here on purpose: the collision the
// peval reader has to survive is a whole-DIRECTORY property, and pinning only the two scans
// that happen to live in this module would leave the third free to claim a record.
import { readPriorReports } from '../commands/eval.mjs'

const scratch = []
process.on('exit', () => scratch.forEach((d) => rmSync(d, { recursive: true, force: true })))

/** Fixture roots are expensive (a git script + tsx bridge reads) — build each variant once. */
const memo = new Map()
const fixture = (opts = {}) => {
  const key = JSON.stringify(opts)
  if (!memo.has(key)) memo.set(key, buildEvalFixture(opts))
  return memo.get(key)
}

/**
 * ArcTraceShape lives in the consumer's TypeScript schema, which a .mjs test cannot
 * import directly — so the trace is validated the way production validates it: shipped
 * through the tsx bridge into the fixture repo's own `lib/roadmap/schema.ts` and
 * `.parse()`d there. This is the REAL contract, not a restatement of it.
 */
function parsesArcTraceShape(root, trace) {
  const jsonPath = join(root, 'trace-under-test.json')
  writeFileSync(jsonPath, JSON.stringify(trace))
  const schema = join(root, 'lib', 'roadmap', 'schema.ts')
  const script = `import('${schema}').then(async (M) => {
    const S = M.default ?? M
    const { readFileSync } = await import('node:fs')
    const r = S.ArcTraceShape.safeParse(JSON.parse(readFileSync('${jsonPath}', 'utf8')))
    process.stdout.write(r.success ? 'TRACE_OK' : 'TRACE_BAD:' + JSON.stringify(r.error.issues))
  }).catch((e) => { process.stderr.write(String((e && e.stack) || e)); process.exit(9) })`
  const res = bridgeEval(root, script)
  if (!res.ok) return { ok: false, detail: res.stderr }
  return res.stdout.includes('TRACE_OK')
    ? { ok: true, detail: '' }
    : { ok: false, detail: res.stdout.slice(0, 2000) }
}

const byNum = (trace, n) => trace.phases.find((p) => p.phase === n)

// ── 1. the collected trace ────────────────────────────────────────────────────────────
test('collectArcTrace — both member phases, ASCENDING, each populated from its phase file', () => {
  const root = fixture()
  const { trace, warnings } = collectArcTrace(root, ARC_ID)

  assert.equal(trace.arcId, ARC_ID)
  assert.deepEqual(trace.phases.map((p) => p.phase), PHASE_NUMS, 'ascending phase order, both planes flattened')
  assert.deepEqual(warnings, [], 'a fully-recorded corpus warns about nothing')

  const p1 = byNum(trace, 9001)
  assert.equal(p1.taskCount, 4)
  assert.equal(p1.transparency.length, 4, 'every task report is carried, not just the last')
  assert.equal(p1.transparency[0].whatWasDone, 'added the collector entry point over the arc file and its members')
  assert.equal(p1.executionResult.status, 'done')
  assert.equal(p1.executionResult.gateRounds, 2)
  assert.deepEqual(p1.executionResult.driver, { model: 'claude-opus-5', lane: 'session' })
  assert.equal(p1.metrics.startedAt, '2026-07-16T10:00:00.000Z')
  assert.equal(p1.metrics.completedAt, '2026-07-16T10:40:00.000Z')
  assert.equal(p1.metrics.haltCount, 0, 'a recorded zero is data — only an UNRECORDED haltCount is absent')
  assert.ok(
    p1.keyFiles.includes('web/src/panels/eval-panel.tsx'),
    'keyFiles travel verbatim — the surface-cohort heuristic reads them downstream',
  )
  assert.equal(p1.parseError, undefined)

  const p2 = byNum(trace, 9002)
  assert.equal(p2.taskCount, 2)
  assert.equal(p2.transparency.length, 2)
  assert.equal(p2.executionResult.status, 'done')
  assert.equal(p2.metrics.haltCount, 2, 'the interrupted phase carries its halt count')
  assert.ok(!p2.keyFiles.some((f) => f.startsWith('web/')), 'the non-surface cohort has no web/ keyFile')

  // Arc-level artifacts: newest sweep, the verdicts panel, the regenerable summary.
  assert.equal(trace.sweep.date, '2026-07-20')
  assert.equal(trace.sweep.overall, 'green')
  assert.equal(trace.verdicts.judgeModel, 'claude-sonnet-5')
  assert.equal(trace.verdicts.verdicts.length, 3)
  assert.equal(trace.verdicts.verdicts.filter((v) => v.status === 'gap').length, 1)
  assert.equal(trace.summary.outcome, 'shipped')

  // Gate runs land flattened on the phase entries.
  assert.equal(p1.gateRuns.length, 1)
  assert.equal(p1.gateRuns[0].rounds.length, 3)
  assert.equal(p1.gateRuns[0].slotFailures, 0)
  assert.equal(p2.gateRuns[0].slotFailures, 1)
})

// ── 2. the contract ───────────────────────────────────────────────────────────────────
test('collectArcTrace — the trace .parse()s ArcTraceShape from the REAL consumer schema', () => {
  const root = fixture()
  const { trace } = collectArcTrace(root, ARC_ID)
  const r = parsesArcTraceShape(root, trace)
  assert.equal(r.ok, true, `the trace must satisfy ArcTraceShape; got: ${r.detail}`)
})

// ── 3. idempotence (the acceptance criterion) ─────────────────────────────────────────
test('collectArcTrace — two runs over one fixture are deep-equal modulo collectedAt', () => {
  const root = fixture()
  const a = collectArcTrace(root, ARC_ID).trace
  const b = collectArcTrace(root, ARC_ID).trace
  assert.notEqual(a.collectedAt, undefined, 'collectedAt is stamped, not omitted')
  delete a.collectedAt
  delete b.collectedAt
  assert.deepEqual(a, b, 'the collector is a pure function of disk state plus the timestamp')
})

// ── 4. field-level absence: the verdicts artifact ─────────────────────────────────────
test('collectArcTrace — a missing verdicts file is an ABSENT FIELD, never a throw or a stub', () => {
  const root = fixture({ omitVerdicts: true })
  const { trace } = collectArcTrace(root, ARC_ID)
  assert.equal(trace.verdicts, undefined, 'absence is the field being absent — the scorer maps it to its sentinel')
  assert.ok(!('verdicts' in trace) || trace.verdicts === undefined, 'never an empty verdicts stub standing in for absent')
  // Every other field survives the absence.
  assert.equal(trace.sweep.date, '2026-07-20')
  assert.equal(trace.summary.outcome, 'shipped')
  assert.deepEqual(trace.phases.map((p) => p.phase), PHASE_NUMS)
  assert.equal(parsesArcTraceShape(root, trace).ok, true, 'a verdict-less trace is still a valid ArcTrace')
})

// ── 5. the quarantining-emit stance ───────────────────────────────────────────────────
test('collectArcTrace — an unimportable phase file is RECORDED (parseError) + WARNED, its sibling intact', () => {
  const root = fixture({ malformedPhase: 9002 })
  const { trace, warnings } = collectArcTrace(root, ARC_ID)

  assert.deepEqual(trace.phases.map((p) => p.phase), PHASE_NUMS, 'the broken phase is recorded, NEVER dropped')
  const bad = byNum(trace, 9002)
  assert.equal(typeof bad.parseError, 'string')
  assert.ok(bad.parseError.length > 0, 'the parse failure carries its reason, not an empty marker')
  assert.equal(bad.executionResult, undefined, 'no execution result is invented for a file that would not load')
  assert.equal(bad.metrics, undefined)
  assert.equal(bad.taskCount, 0, 'an uncountable task list is 0 tasks recorded alongside the parseError, not a guess')

  const good = byNum(trace, 9001)
  assert.equal(good.parseError, undefined, 'the sibling phase is untouched by its neighbour failing')
  assert.equal(good.taskCount, 4)
  assert.deepEqual(good.executionResult.driver, { model: 'claude-opus-5', lane: 'session' })

  assert.ok(warnings.some((w) => /9002/.test(w)), `warnings must name the failing phase; got ${JSON.stringify(warnings)}`)
  assert.ok(!warnings.some((w) => /\b9001\b/.test(w)), 'the healthy phase is not named in a warning')
  assert.equal(parsesArcTraceShape(root, trace).ok, true, 'a quarantined phase still yields a valid ArcTrace')
})

// ── 6. git facts: the land boundary + the escape rate ─────────────────────────────────
test('findArcGitFacts — the SCORED escape window is bounded to PHASE-NAMED fixes after the land merge', () => {
  const root = fixture()
  const facts = findArcGitFacts(root, PHASE_NUMS, { exec: defaultExec })

  // The arc's newest member commit is `fix(x): phase 9001 gate R1 …`, committed straight onto
  // the base branch: no merge carried it in, so the window is TIP-anchored and the boundary is
  // that commit's own date. Critically NOT the unrelated `topic/other` merge at 16:00 — every
  // arc commit is an ancestor of that one too, and adopting it would silently push the boundary
  // past real escapes.
  assert.equal(facts.escapeWindow, 'tip-anchored')
  assert.equal(new Date(facts.landedAt).toISOString(), '2026-07-21T15:00:00.000Z')

  // A tip-anchored window is empty by construction. That is an ABSENT measurement, and the
  // scorer is what says so — here we only pin that nothing was invented to fill it.
  assert.deepEqual(facts.escapeFixes, [], 'no window ⇒ no escapes claimed')

  // The old rule's number is still REPORTED (it is what the previous scoring model counted), and
  // it is bounded by the same window — here that window is empty, so it is a real zero rather
  // than a missing key.
  assert.equal(facts.escapeFixesFileIntersection, 0, 'the unscored figure is present, not dropped')

  assert.ok(facts.arcFiles.includes('src/collector.ts'))
  assert.ok(facts.arcFiles.includes('src/scorer.ts'))
  assert.ok(!facts.arcFiles.includes('src/unrelated.ts'), 'only the member commits contribute arc files')
})

/**
 * THE KNOWN LIMIT OF THE BOUNDED RULE, pinned so nobody reads a zero as a clean record. A
 * scored escape must name a member phase in its subject — but `memberCommits` recognises a
 * member by exactly that grammar, so a post-land phase-named fix is ALSO a member commit and
 * becomes the tip the boundary is derived from. The window therefore closes at or after the
 * escape's own date and the scored list comes back empty. That is a scoring-model question
 * (which set anchors the boundary vs which set is attributed), not something this collector can
 * decide, so it is recorded as a test rather than papered over.
 */
test('findArcGitFacts — a post-land phase-named fix becomes the TIP, so the scored list stays empty', () => {
  const TIP = 't000000000000000000000000000000000000000'
  const ESC = 'e000000000000000000000000000000000000000'
  const has = (args, s) => args.some((a) => String(a) === s || String(a).startsWith(s))
  // Faithful git: `--grep=phase 9001` matches BOTH the arc commit and the later escape fix.
  const stub = (_file, args) => {
    if (has(args, '--grep=phase 9001'))
      return {
        status: 0,
        stdout:
          `${ESC}\t2026-07-19T09:00:00+00:00\tfix(x): phase 9001 gate R1 — the escape\n` +
          `${TIP}\t2026-07-18T11:00:00+00:00\tfeat(x): phase 9001 — 9001.1 land it`,
        stderr: '',
      }
    if (has(args, '--merges')) return { status: 0, stdout: '', stderr: '' }
    if (has(args, '--since=')) return { status: 0, stdout: '', stderr: '' }
    if (has(args, 'show')) return { status: 0, stdout: 'src/collector.ts', stderr: '' }
    return { status: 0, stdout: '', stderr: '' }
  }

  const facts = findArcGitFacts('/nowhere', [9001], { exec: stub })
  assert.equal(new Date(facts.landedAt).toISOString(), '2026-07-19T09:00:00.000Z', 'the escape itself set the boundary')
  assert.equal(facts.escapeWindow, 'tip-anchored')
  assert.deepEqual(facts.escapeFixes, [], 'the rule as ruled cannot score this commit — the scorer must say so, not bank it')
})

test('findArcGitFacts — a member number with no commits yields no landedAt and no escapes (never a guessed boundary)', () => {
  const root = fixture()
  // 'phase 900' is a PREFIX of 'phase 9001': a loose --grep would match it and mint a
  // land boundary for an arc that never ran.
  const facts = findArcGitFacts(root, [900], { exec: defaultExec })
  assert.equal(facts.landedAt, undefined, "'phase 900' must not match 'phase 9001'")
  assert.deepEqual(facts.escapeFixes, [])
  assert.deepEqual(facts.arcFiles, [])
})

test('findArcGitFacts — a FAILED escape scan reports escapeScan unavailable, never zero escapes', () => {
  const root = fixture()
  // Member lookups and `git show` succeed; only the post-land log fails (the ENOBUFS shape
  // the 1 MiB exec buffer used to produce on a real repo). An empty escapeFixes here would
  // read as a spotless arc and RAISE the score, so the failure must travel as data.
  const failingLog = (file, args, opts) =>
    args.includes('--format=%H%x09%aI%x09%s') && args.some((a) => String(a).startsWith('--since='))
      ? { status: 1, stdout: '', stderr: 'ENOBUFS' }
      : defaultExec(file, args, opts)

  const facts = findArcGitFacts(root, PHASE_NUMS, { exec: failingLog })
  assert.equal(facts.escapeScan, 'unavailable', 'a scan that could not run says so')
  assert.deepEqual(facts.escapeFixes, [], 'and reports no fixes — which is UNKNOWN, not zero')
  assert.ok(facts.landedAt, 'the land boundary is still derivable from the member commits')

  // The collector turns that into a WARNING, so a degraded collect is visible in the run
  // output rather than inferred from a suspiciously good score.
  const { trace, warnings } = collectArcTrace(root, ARC_ID, { exec: failingLog })
  assert.equal(trace.git.escapeScan, 'unavailable')
  assert.ok(
    warnings.some((w) => /escape scan/i.test(w) && /not zero/i.test(w)),
    `the run must say the escape count is unknown; got ${JSON.stringify(warnings)}`,
  )
})

/**
 * OPTION C, the whole point of the anchor change. The dated RunnerSummary is a NON-member
 * source, so the planted post-land phase-named fix can no longer be the tip that closes the
 * window it belongs behind. The two halves of this test are the proof that the anchor is
 * non-member: the SAME repo scores the SAME commit or not, depending only on whether the land
 * record is on disk.
 */
test('collectArcTrace — the land-record window SCORES the post-land phase-named fix the tip window swallowed', () => {
  const root = fixture()
  const { trace } = collectArcTrace(root, ARC_ID, { exec: defaultExec })

  assert.equal(trace.git.escapeWindow, 'land-record-anchored', 'the dated RunnerSummary anchors the window')
  assert.equal(
    new Date(trace.git.landedAt).toISOString(),
    `${SUMMARY_DATE}T23:59:59.999Z`,
    'the anchor is the END of the land day — deliberately conservative',
  )

  const subjects = trace.git.escapeFixes.map((f) => f.subject)
  assert.deepEqual(
    subjects,
    ['fix(x): phase 9001 gate R1 — re-guard the collector'],
    'exactly the post-land phase-named fix — a MEASURED escape at last',
  )
  assert.equal(trace.git.escapeFixes[0].files, 1, 'sized by the intersection with the arc files')
  assert.ok(
    !subjects.includes('fix(x): phase 9002 gate R2 — same-day member rework'),
    'same-day member rework sits BEFORE the end-of-day anchor and never scores as an escape',
  )
  assert.equal(trace.git.escapeFixesFileIntersection, 0, 'the unscored old-rule count still rides the trace')
})

test('collectArcTrace — with NO dated RunnerSummary the same repo falls back to the merge/tip window', () => {
  const root = fixture({ omitSummary: true })
  const { trace } = collectArcTrace(root, ARC_ID, { exec: defaultExec })

  assert.equal(trace.git.escapeWindow, 'tip-anchored', 'no land record ⇒ the pre-option-C derivation, verbatim')
  assert.equal(new Date(trace.git.landedAt).toISOString(), '2026-07-21T15:00:00.000Z', 'the escape itself is the tip')
  assert.deepEqual(trace.git.escapeFixes, [], 'the self-defeating empty list — pinned as the honest fallback')
  assert.equal(trace.summary, undefined, 'and the summary field is absent, never stubbed')
})

// ── the three stamps ──────────────────────────────────────────────────────────────────
test('assembleWorkflowStamp — a complete stamp over the real plugin checkout, warning-free', () => {
  const warnings = []
  const stamp = assembleWorkflowStamp({ warn: (l) => warnings.push(l) })
  assert.ok(stamp, 'the plugin checkout can derive its own provenance')
  assert.deepEqual(warnings, [], 'a complete stamp warns about nothing')
  // `-dirty` is tolerated HERE only because this runs against the live plugin checkout, which
  // a sibling session may have edited; both states are pinned exactly in the test below.
  assert.match(stamp.pluginSha, /^[0-9a-f]{12}(-dirty)?$/, 'a 12-char short sha, not a branch name or a guess')
  assert.ok(stamp.pluginVersion.length > 0)
  assert.ok(Number.isInteger(stamp.protocolLoadTokens) && stamp.protocolLoadTokens > 0)
  assert.equal(stamp.profile, WORKFLOW_PROFILE)
})

test('assembleWorkflowStamp — an EDITED plugin worktree stamps `-dirty`, a clean one stamps the bare sha', () => {
  // The report is produced by the tree, not by the commit. A phase in flight runs edited code
  // against an unchanged HEAD, so a bare sha there names a build that would not reproduce the
  // report — the exact fabricated-provenance failure the block exists to prevent.
  const execWith = (porcelain) => (bin, args) =>
    args.includes('rev-parse')
      ? { status: 0, stdout: 'abc123def456\n', stderr: '' }
      : { status: 0, stdout: porcelain, stderr: '' }

  assert.equal(assembleWorkflowStamp({ exec: execWith('') }).pluginSha, 'abc123def456', 'a clean tree IS its commit')
  assert.equal(
    assembleWorkflowStamp({ exec: execWith(' M cli/lib/eval-score.mjs\n') }).pluginSha,
    'abc123def456-dirty',
    'an uncommitted edit is disclosed, never rounded down to the parent commit',
  )

  // Cleanliness that cannot be READ is not cleanliness: an unknown answer drops the block
  // rather than guessing the flattering one.
  const warnings = []
  assert.equal(
    assembleWorkflowStamp({
      exec: (bin, args) =>
        args.includes('rev-parse')
          ? { status: 0, stdout: 'abc123def456\n', stderr: '' }
          : { status: 128, stdout: '', stderr: 'fatal' },
      warn: (l) => warnings.push(l),
    }),
    null,
  )
  assert.match(warnings[0], /clean/i, 'and the warning names which component was underivable')
})

test('assembleWorkflowStamp — ANY underivable component yields NULL plus a warning naming it', () => {
  // A partial stamp is a fabricated one: a block carrying a version and no sha still reads as
  // provenance. Each leg drops the WHOLE block and says which component failed.
  const gitDown = { status: 1, stdout: '', stderr: 'not a git repository' }
  const warnings = []
  assert.equal(
    assembleWorkflowStamp({ exec: () => gitDown, warn: (l) => warnings.push(l) }),
    null,
    'no resolvable HEAD ⇒ no block',
  )
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /sha/i, 'the warning names WHICH component was underivable')

  const noPkg = []
  assert.equal(
    assembleWorkflowStamp({ pluginRoot: join(fixture(), 'no', 'such', 'dir'), warn: (l) => noPkg.push(l) }),
    null,
    'no readable package.json ⇒ no block',
  )
  assert.match(noPkg[0], /package\.json/)
})

test('assembleConsumerFingerprint — derived offline from the checkout, never from a remote', () => {
  const root = fixture()
  const fp = assembleConsumerFingerprint(root)
  assert.equal(fp.repo, basename(root), 'the toplevel basename, so no network read decides the identity')
  assert.equal(fp.corpusSize, 2, 'the fixture carries exactly the two member phase files')

  // The language ladder, each rung on its own tree so no rung can be inferred from a sibling.
  const scratchRoot = (files) => {
    const d = mkdtempSync(join(tmpdir(), 'zr-evalfix-fp-'))
    scratch.push(d)
    for (const f of files) writeFileSync(join(d, f), '{}\n')
    return d
  }
  assert.equal(assembleConsumerFingerprint(scratchRoot(['tsconfig.json', 'package.json'])).language, 'typescript')
  assert.equal(assembleConsumerFingerprint(scratchRoot(['package.json'])).language, 'javascript')

  const bare = scratchRoot([])
  assert.deepEqual(assembleConsumerFingerprint(bare), { repo: basename(bare), language: 'unknown', corpusSize: 0 })
})

/**
 * Two checkouts that agree on NOTHING the fingerprint reads: different basename, different
 * language rung, and different NON-ZERO corpus sizes. A linked worktree is exactly this shape —
 * one repository seen from a directory with another name — and the divergence is what makes an
 * implementation that fingerprints the identityRoot WHOLESALE fail on all three fields instead
 * of quietly agreeing on two of them.
 */
function fingerprintDivergentPair() {
  const make = (stem, files, corpus) => {
    const d = mkdtempSync(join(tmpdir(), stem))
    scratch.push(d)
    for (const f of files) writeFileSync(join(d, f), '{}\n')
    mkdirSync(join(d, 'roadmap', 'phases'), { recursive: true })
    for (let i = 1; i <= corpus; i += 1)
      writeFileSync(join(d, 'roadmap', 'phases', `phase-${1000 + i}.phase.ts`), 'export default {}\n')
    return d
  }
  return {
    active: make('zr-fp-linked-', ['tsconfig.json', 'package.json'], 3),
    primary: make('zr-fp-primary-', ['package.json'], 1),
  }
}

test('assembleConsumerFingerprint — identityRoot normalizes only repo identity', () => {
  const { active, primary } = fingerprintDivergentPair()
  assert.notEqual(basename(active), basename(primary), 'fixture precondition: the two checkouts have different basenames')

  const solo = assembleConsumerFingerprint(active)
  const normalized = assembleConsumerFingerprint(active, { identityRoot: primary })

  // The WHOLE contract in one comparison: identityRoot moves `repo` and touches nothing else.
  assert.deepEqual(
    normalized,
    { ...solo, repo: basename(primary) },
    'identityRoot must move repo ALONE — every other field stays what the active checkout derived',
  )
  assert.equal(normalized.repo, basename(primary), 'the identity is the primary checkout, so one repository is ONE cohort')
  assert.notEqual(normalized.repo, basename(active), 'a linked checkout must not open a cohort of its own in the corpus')

  // Calling with one argument (and with an empty options object) is unchanged: every existing
  // call site keeps fingerprinting the tree it was handed.
  assert.equal(solo.repo, basename(active))
  assert.deepEqual(assembleConsumerFingerprint(active, {}), solo, 'an empty options object is the no-options call')
  assert.deepEqual(
    assembleConsumerFingerprint(active, { identityRoot: active }),
    solo,
    'identityRoot defaulting to the toplevel is the same call by another spelling',
  )
})

test('assembleConsumerFingerprint — the active checkout still owns language and corpusSize', () => {
  const { active, primary } = fingerprintDivergentPair()
  const soloActive = assembleConsumerFingerprint(active)
  const soloPrimary = assembleConsumerFingerprint(primary)

  // Falsification anchors: both derived fields DISAGREE across the pair, and neither corpus is
  // empty — so "reads the identityRoot wholesale" cannot pass by accidentally matching zero.
  assert.equal(soloActive.language, 'typescript', 'fixture precondition: the active tree carries a tsconfig')
  assert.equal(soloPrimary.language, 'javascript', 'fixture precondition: the identity tree carries only a package.json')
  assert.equal(soloActive.corpusSize, 3, 'fixture precondition: the active corpus is non-zero')
  assert.equal(soloPrimary.corpusSize, 1, 'fixture precondition: the identity corpus is non-zero AND different')

  const normalized = assembleConsumerFingerprint(active, { identityRoot: primary })

  assert.equal(normalized.repo, basename(primary), 'the identity half IS normalized — that is the only thing identityRoot buys')
  assert.equal(
    normalized.language,
    soloActive.language,
    'a linked checkout may carry its own tsconfig/package: language describes the tree that was measured',
  )
  assert.equal(
    normalized.corpusSize,
    soloActive.corpusSize,
    'a linked checkout may legitimately hold a different phase count: reading the identity tree would under- or over-count the corpus',
  )
  assert.notEqual(normalized.language, soloPrimary.language, 'the identity tree\'s language must not leak into the measurement')
  assert.notEqual(normalized.corpusSize, soloPrimary.corpusSize, 'the identity tree\'s corpus must not leak into the measurement')
})

test('newestArtifactDated — returns the newest file WITH its filename date; absent stays null', () => {
  const root = fixture()
  const dir = join(root, 'roadmap', 'arc-summaries')
  assert.deepEqual(newestArtifactDated(dir, ARC_ID, null), {
    path: join(dir, `${ARC_ID}-${SUMMARY_DATE}.json`),
    date: SUMMARY_DATE,
  })
  assert.equal(newestArtifactDated(dir, 'OTHERARC', null), null, 'another arc never borrows this land record')
  assert.equal(
    newestArtifact(dir, ARC_ID, null),
    join(dir, `${ARC_ID}-${SUMMARY_DATE}.json`),
    'newestArtifact stays the path projection of the same resolution',
  )
})

// ── 7. gate run summaries ─────────────────────────────────────────────────────────────
test('summarizeGateRuns — rounds and slotFailures per phase; an absent .gate dir is [] not a throw', () => {
  const root = fixture()

  const g1 = summarizeGateRuns(root, 9001)
  assert.equal(g1.length, 1)
  assert.equal(g1[0].green, true)
  assert.equal(g1[0].startedAt, '2026-07-16T10:05:00.000Z')
  assert.deepEqual(
    g1[0].rounds,
    [
      { round: 0, agent: 'quality-pass', verdict: 'clean' },
      { round: 1, agent: 'code-reviewer', verdict: 'findings-fixed' },
      { round: 2, agent: 'code-reviewer', verdict: 'clean' },
    ],
    'every round in order, with the agent that produced it — the reviewer trajectory is the signal',
  )
  assert.equal(g1[0].slotFailures, 0, 'four exit-0 slots is zero failures')

  const g2 = summarizeGateRuns(root, 9002)
  assert.equal(g2.length, 1)
  assert.deepEqual(g2[0].rounds, [{ round: 1, agent: 'code-reviewer', verdict: 'clean' }])
  assert.equal(g2[0].slotFailures, 1, 'the one exit-1 slot is counted; the two exit-0 slots are not')

  assert.deepEqual(summarizeGateRuns(root, 9999), [], 'a phase with no .gate dir has no runs — never a throw')
})

/**
 * The reviewer MODEL on a gate round (2158.1). A round names its role (code-reviewer,
 * quality-pass) but not the model that ran it, which makes reviewer attribution impossible for
 * the evals. The field is optional on the report, so the collector owes two behaviours that
 * only a per-round assertion can tell apart: carry it when it is there, and add NO key when it
 * is not — a `model: undefined` on every round would read as "attribution attempted and empty"
 * to every downstream consumer that checks presence.
 */
const MODEL_RUN = 'run-000002-2026-07-16T12-00-00-000Z.json'
const MODEL_ROUND = { round: 0, agent: 'quality-pass', verdict: 'clean', model: 'claude-opus-5' }
const PLAIN_ROUND = { round: 1, agent: 'code-reviewer', verdict: 'clean' }

/**
 * A dedicated fixture root: this corpus is MUTATED (a second gate run is planted), and the
 * shared `fixture()` memo would hand that mutation to every later test keyed on the same opts.
 * Built once, lazily, so the git script runs only when these tests do.
 */
let modelRoot = null
const modelRoundFixture = () => {
  if (modelRoot) return modelRoot
  modelRoot = buildEvalFixture()
  const run = {
    phase: 9001,
    startedAt: '2026-07-16T12:00:00.000Z',
    baseSha: '0000000000000000000000000000000000000002',
    mode: 'phase',
    kind: 'logic',
    testScope: { derived: 'relevant', declared: null, effective: 'relevant' },
    reviewScope: { derived: 'full', declared: null, effective: 'full' },
    slots: [{ slot: 'lint', command: 'npm run lint', exitCode: 0, durationMs: 1200, logPath: null }],
    agents: [
      { ...MODEL_ROUND, summary: 'no simplifications owed', recordedAt: '2026-07-16T12:05:00.000Z' },
      { ...PLAIN_ROUND, summary: '0 findings', recordedAt: '2026-07-16T12:20:00.000Z' },
    ],
    green: true,
    notes: [],
  }
  // Precondition, not the assertion under test: a run the shape REJECTS is silently skipped by
  // summarizeGateRuns, which would red the tests below for a reason that is not the model field.
  assert.equal(GateRunReportShape.safeParse(run).success, true, 'fixture: the planted run must be a valid report')
  writeFileSync(join(modelRoot, 'roadmap', '.gate', '9001', MODEL_RUN), JSON.stringify(run, null, 2) + '\n')
  return modelRoot
}

/** The planted run as the collector flattened it onto the phase entry (one collect, two tests). */
let plantedRunCache = null
const plantedRun = () => {
  if (plantedRunCache) return plantedRunCache
  const { trace } = collectArcTrace(modelRoundFixture(), ARC_ID)
  const runs = byNum(trace, 9001).gateRuns
  assert.equal(runs.length, 2, 'fixture: the planted run is collected alongside the shipped one')
  plantedRunCache = runs[1]
  return plantedRunCache
}

test('collectArcTrace — a round records the MODEL that ran it, all the way onto the trace', () => {
  const run = plantedRun()
  assert.equal(
    run.rounds[0].model,
    'claude-opus-5',
    'the reviewer model must survive report → summarizeGateRuns → trace; a dropped one makes attribution impossible',
  )
  assert.equal(run.rounds[0].agent, 'quality-pass', 'the ROLE still travels — the model is additional, not a replacement')
  assert.equal(run.rounds[0].verdict, 'clean')
})

test('collectArcTrace — a round with no recorded model carries NO model key (never a stub)', () => {
  const run = plantedRun()
  assert.equal(
    'model' in run.rounds[1],
    false,
    'an unrecorded model is an ABSENT KEY — the scorer owns the single absence→sentinel mapping, not the collector',
  )
  // Whole-round deepEqual, so a summary/recordedAt leaking into the trace (or a `model: undefined`
  // key on the second round) fails here rather than travelling unnoticed into the eval corpus.
  assert.deepEqual(
    run.rounds,
    [MODEL_ROUND, PLAIN_ROUND],
    'exactly round/agent/verdict, plus model only where one was recorded',
  )
})

test('summarizeGateRuns — the shipped model-less corpus is unchanged by the new field', () => {
  const root = fixture()
  const rounds = summarizeGateRuns(root, 9001)[0].rounds
  assert.equal(rounds.every((r) => !('model' in r)), true, 'no model key is invented for rounds recorded without one')
})

test('summarizeGateRuns — a mis-shaped run file is SKIPPED, never thrown, and never half-counted', () => {
  const root = fixture()
  const dir = join(root, 'roadmap', '.gate', '9001')
  writeFileSync(join(dir, 'run-000002-2026-07-16T11-00-00-000Z.json'), '{"phase": 9001, "green":')
  const g = summarizeGateRuns(root, 9001)
  assert.equal(g.length, 1, 'the corrupt run is dropped from the list, the readable one survives')
  assert.equal(g[0].slotFailures, 0)
})

// ── 8. newest-wins artifact selection ─────────────────────────────────────────────────
test('newestArtifact — the newest dated file wins; a suffix with no files is null', () => {
  const root = fixture()
  const dir = join(root, 'roadmap', 'arc-evals')
  const sweep = newestArtifact(dir, ARC_ID, 'sweep')
  assert.equal(sweep, join(dir, `${ARC_ID}-2026-07-20-sweep.json`), 'the 2026-07-20 sweep beats the 2026-07-10 one')
  assert.equal(newestArtifact(dir, ARC_ID, 'verdicts'), join(dir, `${ARC_ID}-2026-07-20-verdicts.json`))
  assert.equal(newestArtifact(dir, ARC_ID, 'nosuchsuffix'), null, 'no file ⇒ null, never a fabricated path')
  assert.equal(newestArtifact(dir, 'OTHERARC', 'sweep'), null, 'another arc id never borrows this arc artifacts')

  const empty = mkdtempSync(join(tmpdir(), 'zr-evalfix-empty-'))
  scratch.push(empty)
  assert.equal(newestArtifact(empty, ARC_ID, 'sweep'), null, 'an empty (or absent) dir is null, never a throw')
})

// ── 9. the typed refusal ──────────────────────────────────────────────────────────────
test('collectArcTrace — an absent arc file throws CollectError kind no-arc (never an empty trace)', () => {
  const root = fixture({ omitArc: true })
  assert.throws(
    () => collectArcTrace(root, ARC_ID),
    (e) => e instanceof CollectError && e.kind === 'no-arc',
    'an arc that does not exist must refuse, not collect a zero-phase trace that scores as perfect',
  )
})

// ── 10. plannedBy: recorded or absent, never guessed ──────────────────────────────────
test('collectArcTrace — plannedBy travels from the phase file; an unrecorded one stays undefined', () => {
  const root = fixture()
  const { trace } = collectArcTrace(root, ARC_ID)
  assert.deepEqual(byNum(trace, 9001).plannedBy, { model: 'claude-opus-5' })
  assert.equal(byNum(trace, 9002).plannedBy, undefined, 'no plannedBy on the file ⇒ no plannedBy on the trace')
  // Same rule one level down: the driver is self-reported or absent.
  assert.equal(byNum(trace, 9002).executionResult.driver, undefined, 'an unrecorded driver is never back-filled')
})

// ══ 11. the PER-PHASE eval record inlet (arc POLYSEAT plane 1) ═════════════════════════
// `computeScorecard` only ever sees ARC traces, so a consumer that executes ordinary phases
// without arcs renders zero driver and zero planner cells however much work it does (measured
// in mudarabah2). `roadmap gate run` now leaves a record per phase at
// roadmap/arc-evals/phase-<N>.peval.json; `readPhaseEvalSamples` is the reader that turns that
// archive into scorecard samples.
//
// Two failure classes are pinned here, and only these two:
//
//   COLLISION. The records land in roadmap/arc-evals/, the SAME directory three dated scans
//   already walk (`newestArtifactDated` / `newestArtifact` here, `readPriorReports` in
//   commands/eval.mjs) and the same one two undated projections live in (scorecard.json,
//   timing-stats.json). A record read as an arc report drags every future ratchet baseline
//   toward a document that scores no dimension at all; an arc report read as a record invents
//   phase samples out of a sweep. Both directions are asserted, and each carries a
//   FALSIFICATION — the same fixture renamed the wrong way, so the boundary is proven to sit
//   on the filename class rather than on some accident of the corpus.
//
//   THE SILENT SKIP. A record that will not read is missing MEASUREMENT. Dropping it quietly
//   makes a shrinking corpus indistinguishable from a stable one, so every unreadable file is
//   named in `warnings` and its siblings still load.

/** A minimal-but-REAL PhaseEvalRecord. Validated against the consumer's PhaseEvalRecordShape
 *  by the reader itself — every field here is the production spelling, not a test dialect. */
const pevalRecord = (phase, o = {}) => ({
  phase,
  date: o.date ?? '2026-08-20',
  consumerFingerprint: o.consumerFingerprint ?? { repo: 'zr-evalfix', language: 'typescript', corpusSize: 12 },
  taskCount: o.taskCount ?? 3,
  keyFiles: o.keyFiles ?? ['src/collector.ts'],
  gate: o.gate ?? { green: true, slots: [{ slot: 'lint', exitCode: 0, durationMs: 1200 }] },
  ...(o.metrics === null
    ? {}
    : {
        metrics: o.metrics ?? {
          commits: 3,
          linesAdded: 120,
          linesRemoved: 10,
          filesChanged: 4,
          testsAtStart: 100,
          testsAtEnd: 108,
          testsAdded: 8,
          startedAt: '2026-08-20T10:00:00.000Z',
          completedAt: '2026-08-20T10:30:00.000Z',
          haltCount: 0,
        },
      }),
  ...(o.attribution === null
    ? {}
    : {
        attribution: o.attribution ?? {
          plannedBy: { model: 'claude-fable-5' },
          driver: { model: 'claude-opus-5', lane: 'session' },
        },
      }),
})

/** Write a record under its PRODUCTION path helper — a test that spelled the filename itself
 *  would keep passing after the convention moved out from under the gate writer. */
function plantPeval(root, phase, o = {}) {
  const path = phaseEvalRecordPath(root, phase)
  writeFileSync(path, JSON.stringify(pevalRecord(phase, o), null, 2) + '\n')
  assert.match(basename(path), PEVAL_NAME_RE, `fixture precondition: ${basename(path)} must be in the record name class`)
  return path
}

/** Write raw bytes into the arc-evals dir under an arbitrary name (the collision fixtures). */
function plantRaw(root, name, body) {
  const path = join(root, 'roadmap', 'arc-evals', name)
  writeFileSync(path, typeof body === 'string' ? body : JSON.stringify(body, null, 2) + '\n')
  return path
}

const evalsDirOf = (root) => join(root, 'roadmap', 'arc-evals')
const pevalNames = (dir) => readdirSync(dir).filter((f) => PEVAL_NAME_RE.test(f)).sort()
const phasesOf = (samples) => samples.map((s) => s.phase)

/** A dated report the ratchet accepts: readPriorReports checks only for a `dimensions` record. */
const datedReport = (arcId, date) => ({ arcId, date, dimensions: { 'code-confidence': { owner: 'deterministic', score: 60 } } })

test('readPhaseEvalSamples — each record becomes a SAMPLE in the arc-trace entry shape, ascending by phase', { timeout: 120_000 }, () => {
  const root = buildEvalFixture()
  // 99 / 880 / 8801 sort LEXICALLY as 880, 8801, 99 — a reader that sorted filenames instead
  // of phase numbers would hand the projection a different order on the same corpus, and the
  // committed scorecard would churn on a re-run over unchanged inputs.
  plantPeval(root, 880, { taskCount: 5, keyFiles: ['web/src/panels/eval-panel.tsx'] })
  plantPeval(root, 8801)
  plantPeval(root, 99, { attribution: { plannedBy: { model: 'gpt-5-codex' } } })

  const { samples, warnings } = readPhaseEvalSamples(root)
  assert.deepEqual(warnings, [], 'a corpus of valid records warns about nothing')
  assert.deepEqual(phasesOf(samples), [99, 880, 8801], 'ascending by PHASE NUMBER, not by filename')

  const byPhase = (n) => samples.find((s) => s.phase === n)

  // The cohort keys travel verbatim: computeScorecard slices on bandFor(taskCount) ×
  // surfaceOf(keyFiles), so a dropped keyFile does not lose detail, it MIS-COHORTS.
  assert.equal(byPhase(880).taskCount, 5)
  assert.deepEqual(byPhase(880).keyFiles, ['web/src/panels/eval-panel.tsx'])
  assert.equal(byPhase(8801).taskCount, 3)
  assert.deepEqual(byPhase(8801).keyFiles, ['src/collector.ts'])

  // The arc-trace entry shape, so one slicer reads both sources without a per-source branch.
  const s = byPhase(8801)
  assert.deepEqual(s.transparency, [], 'a phase record carries no transparency reports — an EMPTY list, never absent')
  assert.deepEqual(s.gateRuns, [], 'v1 does not lift gate rounds off the record; the list is empty, not invented')
  assert.equal(s.metrics.startedAt, '2026-08-20T10:00:00.000Z')
  assert.equal(s.metrics.completedAt, '2026-08-20T10:30:00.000Z')
  assert.equal(s.metrics.haltCount, 0, 'a RECORDED zero is data — the scorer tells it apart from an absent one')

  // `driver` sits FLAT on the sample: a phase record has no executionResult, because it never
  // had a status or a round count to record. A nested one here would be a shape the record
  // cannot evidence.
  assert.deepEqual(s.driver, { model: 'claude-opus-5', lane: 'session' })
  assert.equal('executionResult' in s, false, 'no executionResult is synthesized around the driver')
  assert.deepEqual(s.plannedBy, { model: 'claude-fable-5' }, 'plannedBy keeps the arc-trace spelling')

  // Absence stays absence: the record for 99 recorded a planner and no driver.
  assert.deepEqual(byPhase(99).plannedBy, { model: 'gpt-5-codex' })
  assert.equal(byPhase(99).driver, undefined, 'an unrecorded driver is never back-filled — the scorer owns the unrecorded cohort')

  assert.deepEqual(readPhaseEvalSamples(buildEvalFixture()), { samples: [], warnings: [] }, 'no records ⇒ no samples and nothing to warn about')
})

test('readPhaseEvalSamples — the whole archive rides ONE validate call, never one per file', { timeout: 120_000 }, () => {
  const root = buildEvalFixture()
  for (const n of [8801, 8802, 8803, 8804]) plantPeval(root, n)

  const calls = []
  const validate = (docs) => {
    calls.push(docs)
    return { ok: true, parsed: docs }
  }
  const { samples } = readPhaseEvalSamples(root, { validate })

  assert.equal(calls.length, 1, `the archive is validated as a BATCH — one tsx spawn per file makes reading it cost more than producing it; got ${calls.length} calls`)
  assert.equal(calls[0].length, 4, 'every record is in that one batch')
  assert.deepEqual(calls[0].map((d) => d.phase), [8801, 8802, 8803, 8804], 'the batch carries the PARSED documents, in the reader order')
  assert.deepEqual(phasesOf(samples), [8801, 8802, 8803, 8804])
})

test('phaseEvalValidator — the real consumer shape, and a bad element is named by its ARRAY INDEX', { timeout: 120_000 }, () => {
  const root = buildEvalFixture()
  const validate = phaseEvalValidator(root)

  const good = validate([pevalRecord(8801), pevalRecord(8802)])
  assert.equal(good.ok, true, `two valid records must parse through the consumer's PhaseEvalRecordListShape; got ${JSON.stringify(good.res ?? {}).slice(0, 800)}`)
  assert.deepEqual(good.parsed.map((d) => d.phase), [8801, 8802], 'the PARSED list comes back, in order')

  // PhaseEvalRecordShape is a strictObject at every level: an unknown key is a parse ERROR,
  // never a silent strip. A dropped key in a measurement record is a number no later reader
  // could even discover was missing.
  const bad = validate([pevalRecord(8801), { ...pevalRecord(8802), notAField: true }])
  assert.equal(bad.ok, false, 'an unknown key must REFUSE the batch, not travel stripped')
  assert.equal(bad.res.kind, 'zod', `a shape refusal is a zod refusal, not a toolchain failure; got ${JSON.stringify(bad.res).slice(0, 800)}`)
  const indices = bad.res.issues.map((i) => (i.path ?? [])[0])
  assert.ok(
    indices.includes(1),
    `the offending element must be named by its array index 1, or a batch refusal cannot be traced back to a file; issues were ${JSON.stringify(bad.res.issues)}`,
  )
  assert.equal(indices.includes(0), false, 'the VALID element at index 0 is not blamed for its neighbour')
})

// ── 11a. COLLISION, direction (a): the dated scans never claim a record ────────────────
test('readPhaseEvalSamples — the DATED scans over the same directory claim NONE of the .peval.json files', { timeout: 120_000 }, () => {
  const root = buildEvalFixture()
  const dir = evalsDirOf(root)
  for (const n of [8801, 8802, 8803, 8804, 8805]) plantPeval(root, n)
  plantRaw(root, `${ARC_ID}-2026-07-22.json`, datedReport(ARC_ID, '2026-07-22'))

  // Without this every assertion below is vacuous — an empty directory claims nothing either.
  assert.equal(pevalNames(dir).length, 5, `fixture precondition: five records share the scans' directory; got ${JSON.stringify(readdirSync(dir))}`)

  // (1) newestArtifactDated / newestArtifact — the arc artifact resolver.
  assert.equal(newestArtifactDated(dir, 'phase-8801', null), null, 'a record is not a dated arc artifact for an arc named after it')
  assert.equal(newestArtifactDated(dir, 'phase-8805', 'peval'), null, 'nor under any suffix')
  assert.equal(
    newestArtifact(dir, ARC_ID, 'sweep'),
    join(dir, `${ARC_ID}-2026-07-20-sweep.json`),
    'and the real arc artifacts still resolve unchanged beside them',
  )

  // (2) readPriorReports — the RATCHET's corpus. A record read as a prior would drag every
  // future baseline toward a document that scores no dimension at all.
  const warned = []
  const priors = readPriorReports(dir, { onWarn: (l) => warned.push(l) })
  assert.deepEqual(priors.map((d) => d.date), ['2026-07-22'], 'exactly the one dated report — no record enrolled itself as a prior')
  assert.deepEqual(warned, [], 'and no record was even REACHED: a warning here would mean the scan opened one')

  // FALSIFICATION — the same bytes under a name the dated scans DO claim. This is what proves
  // the boundary sits on the filename class and not on some accident of this corpus.
  const wrongWay = join(dir, 'phase-8801-2026-08-23.json')
  renameSync(join(dir, 'phase-8801.peval.json'), wrongWay)
  assert.equal(PEVAL_NAME_RE.test('phase-8801-2026-08-23.json'), false, 'the renamed file has left the record class')
  assert.deepEqual(
    newestArtifactDated(dir, 'phase-8801', null),
    { path: wrongWay, date: '2026-08-23' },
    'renamed the wrong way the artifact scan CLAIMS it — the date-free .peval.json tail is the only thing keeping it out',
  )
  const warnedAfter = []
  readPriorReports(dir, { onWarn: (l) => warnedAfter.push(l) })
  assert.ok(
    warnedAfter.some((l) => l.includes('phase-8801-2026-08-23.json')),
    `renamed the wrong way the ratchet scan reaches it too and refuses it by name; warnings were ${JSON.stringify(warnedAfter)}`,
  )
  assert.deepEqual(phasesOf(readPhaseEvalSamples(root).samples), [8802, 8803, 8804, 8805], 'and the reader has correspondingly LOST it — the two classes are disjoint in both directions')
})

// ── 11b. COLLISION, direction (b): the reader never claims an arc artifact ─────────────
test('readPhaseEvalSamples — dated arc artifacts and the undated projections are NOT records', { timeout: 120_000 }, () => {
  const root = buildEvalFixture()
  const dir = evalsDirOf(root)
  plantPeval(root, 8801)
  // Every non-record filename class that really occurs in this directory. There is no
  // `*.eval.json` class on disk — the arc form is `<ARCID>-<YYYY-MM-DD>[-sweep|-verdicts].json`
  // (two of which the fixture already ships) and the projections are undated.
  plantRaw(root, `${ARC_ID}-2026-07-20.json`, datedReport(ARC_ID, '2026-07-20'))
  plantRaw(root, 'scorecard.json', { generatedAt: '2026-08-23T00:00:00.000Z', nFloor: 5, drivers: [], reviewers: [], notes: [] })
  plantRaw(root, 'timing-stats.json', { generatedAt: '2026-08-23T00:00:00.000Z', cohorts: [] })

  const nonRecords = readdirSync(dir).filter((f) => !PEVAL_NAME_RE.test(f)).sort()
  assert.deepEqual(
    nonRecords,
    [
      `${ARC_ID}-2026-07-10-sweep.json`,
      `${ARC_ID}-2026-07-20-sweep.json`,
      `${ARC_ID}-2026-07-20-verdicts.json`,
      `${ARC_ID}-2026-07-20.json`,
      'scorecard.json',
      'timing-stats.json',
    ],
    'fixture precondition: every real non-record class is present to be ignored',
  )

  const { samples, warnings } = readPhaseEvalSamples(root)
  assert.deepEqual(phasesOf(samples), [8801], 'exactly the one record; a sweep read as a record would invent a phase sample out of an arc aggregate')
  assert.deepEqual(warnings, [], 'and an ignored file is not a DEGRADED one — it must not warn either')

  // FALSIFICATION — the projection, byte-for-byte, under a record name. The reader claims it
  // immediately, which is what proves the six files above were skipped on their NAME.
  renameSync(join(dir, 'scorecard.json'), join(dir, 'phase-4242.peval.json'))
  const after = readPhaseEvalSamples(root)
  assert.deepEqual(phasesOf(after.samples), [8801], 'the projection still produces no sample — it is not a record whatever it is called')
  assert.ok(
    after.warnings.some((w) => w.includes('phase-4242.peval.json')),
    `renamed into the record class the reader DOES claim it, and refuses it BY NAME; warnings were ${JSON.stringify(after.warnings)}`,
  )
})

// ── 11c. an unreadable record is NAMED, never silently skipped ─────────────────────────
test('readPhaseEvalSamples — an unparseable record is a WARNING naming the file, and its siblings still load', { timeout: 120_000 }, () => {
  const root = buildEvalFixture()
  const dir = evalsDirOf(root)
  for (const n of [8801, 8802, 8803]) plantPeval(root, n)
  plantRaw(root, 'phase-8899.peval.json', '{"phase": 8899, "date": "2026-08-20",')
  // Not JSON-broken but SHAPE-broken: taskCount is a cohort key, and a record that lost it
  // does not lose detail, it mis-cohorts. Both failures owe the same named warning.
  plantRaw(root, 'phase-8898.peval.json', { ...pevalRecord(8898), taskCount: 'three' })

  assert.equal(pevalNames(dir).length, 5, `fixture precondition: three good records and two broken ones; got ${JSON.stringify(pevalNames(dir))}`)

  const { samples, warnings } = readPhaseEvalSamples(root)
  assert.deepEqual(phasesOf(samples), [8801, 8802, 8803], 'a corrupt record is missing data, not a reason to refuse the archive')

  for (const name of ['phase-8899.peval.json', 'phase-8898.peval.json'])
    assert.ok(
      warnings.some((w) => typeof w === 'string' && w.includes(name)),
      `${name} must be NAMED in the warnings — a silent skip makes a shrinking corpus indistinguishable from a stable one; warnings were ${JSON.stringify(warnings)}`,
    )
  assert.equal(warnings.length, 2, `exactly one warning per unreadable record — no warning for the three that loaded; got ${JSON.stringify(warnings)}`)
})

// ── 12. a --slots SUBSET run is not a gate round ───────────────────────────────────────
//
//   `roadmap gate run <N> --slots types` is the routine debugging projection a driver runs
//   once per task: it proves ONE slot, on purpose, and its `green` says nothing about the
//   plan's other slots. `GateRunReportShape.slotFilter` is set exactly when a run was
//   filtered that way, and both checkPhaseConsistency and the --verify-complete eval refresh
//   already refuse such a report as evidence about the phase. summarizeGateRuns is the
//   remaining door: every filtered subset check it emits is counted by the eval as a
//   complete gate round, which inflates the round count of any phase whose driver debugged
//   with --slots — the phases that needed the most iteration read as the most disciplined.

/** A bare repo root. summarizeGateRuns reads `roadmap/.gate/<phase>` and NOTHING else, so the
 *  slotFilter contract is pinned without the corpus builder's git script or tsx bridge. */
function gateScratch() {
  const root = mkdtempSync(join(tmpdir(), 'zr-evalfix-slotfilter-'))
  scratch.push(root)
  return root
}

/** A REAL GateRunReport — written through the production `writeReport`, so these fixtures are
 *  the same bytes, the same run-<seq>-<ts>.json names and the same Zod validation a real gate
 *  run produces. A test that hand-spelled the filename would keep passing after the writer moved. */
const gateRun = (phase, o = {}) => ({
  phase,
  startedAt: o.startedAt,
  baseSha: o.baseSha ?? '0'.repeat(40),
  mode: 'phase',
  kind: 'logic',
  testScope: { derived: 'relevant', declared: null, effective: 'relevant' },
  reviewScope: { derived: 'full', declared: null, effective: 'full' },
  slots: o.slots ?? [{ slot: 'lint', command: 'npm run lint', exitCode: 0, durationMs: 1200, logPath: null }],
  agents: (o.agents ?? []).map((a, i) => ({ summary: `round ${i}`, recordedAt: '2026-07-16T12:05:00.000Z', ...a })),
  green: o.green ?? true,
  notes: [],
  ...(o.slotFilter ? { slotFilter: o.slotFilter } : {}),
})

/** The agent round only a FILTERED run recorded — its presence anywhere in the output means a
 *  subset check's reviewer round was counted as one of the phase's rounds. */
const SUBSET_ROUND = { round: 9, agent: 'subset-only-reviewer', verdict: 'clean' }

/** Written as the rounds of a full run, and — since `gateRun` supplies the summary/recordedAt
 *  the report shape requires — also exactly how summarizeGateRuns must project them back. */
const FULL_ROUNDS = [
  { round: 0, agent: 'quality-pass', verdict: 'clean', model: 'claude-opus-5' },
  { round: 1, agent: 'code-reviewer', verdict: 'findings-fixed' },
]

test('summarizeGateRuns — excludes slotFilter reports (a subset check is not a gate round)', () => {
  const root = gateScratch()
  // INTERLEAVED on purpose: full, filtered, full, filtered. A skip that only looked at the
  // first element, or only at the newest, would survive a corpus that grouped them.
  writeReport(root, gateRun(7001, { startedAt: '2026-07-16T10:00:00.000Z', agents: FULL_ROUNDS }))
  writeReport(root, gateRun(7001, { startedAt: '2026-07-16T10:30:00.000Z', slotFilter: 'types', agents: [SUBSET_ROUND] }))
  writeReport(root, gateRun(7001, {
    startedAt: '2026-07-16T11:00:00.000Z',
    agents: [{ round: 2, agent: 'code-reviewer', verdict: 'clean' }],
    slots: [
      { slot: 'lint', command: 'npm run lint', exitCode: 0, durationMs: 900, logPath: null },
      { slot: 'types', command: 'npm run type-check', exitCode: 1, durationMs: 4200, logPath: null },
      { slot: 'e2e', note: 'skipped', declaredAbsent: true },
    ],
    green: false,
  }))
  writeReport(root, gateRun(7001, { startedAt: '2026-07-16T11:30:00.000Z', slotFilter: 'lint,types', agents: [SUBSET_ROUND] }))

  const out = summarizeGateRuns(root, 7001)

  assert.equal(
    out.length,
    2,
    `exactly the two FULL runs: a --slots run proves a subset on purpose, so counting it as a gate round inflates ` +
      `the round count of every phase whose driver debugged with --slots; got ${JSON.stringify(out)}`,
  )
  assert.deepEqual(
    out.map((r) => r.startedAt),
    ['2026-07-16T10:00:00.000Z', '2026-07-16T11:00:00.000Z'],
    'the surviving full runs keep run-<seq> order — filtering removes entries, it never reorders them',
  )
  // Whole-array deepEqual: the filter must not alter what a FULL run projects. A dropped model,
  // a leaked slotFilter key or a re-counted slotFailure fails here rather than travelling on.
  assert.deepEqual(
    out,
    [
      { startedAt: '2026-07-16T10:00:00.000Z', green: true, rounds: FULL_ROUNDS, slotFailures: 0 },
      {
        startedAt: '2026-07-16T11:00:00.000Z',
        green: false,
        rounds: [{ round: 2, agent: 'code-reviewer', verdict: 'clean' }],
        slotFailures: 1,
      },
    ],
    'the projected shape of a full run is byte-identical to today — startedAt/green/rounds/slotFailures, nothing added',
  )

  // A filtered run's reviewer round is a round about a SUBSET, not a round about the phase.
  const rounds = out.flatMap((r) => r.rounds)
  assert.equal(
    rounds.some((r) => r.agent === SUBSET_ROUND.agent),
    false,
    `no round from a --slots run may appear in the output; rounds were ${JSON.stringify(rounds)}`,
  )
  assert.equal(rounds.length, 3, 'three rounds total — the two filtered runs contribute none')
})

test('summarizeGateRuns — the newest filtered report is still excluded, and so is the oldest', () => {
  const root = gateScratch()
  // The non-initial, non-terminal cases both: seq 1 filtered, seq 2 full, seq 3 filtered. An
  // implementation that skipped only a leading filtered report, or that stopped scanning at the
  // newest file, passes the naive corpus and fails here.
  writeReport(root, gateRun(7002, { startedAt: '2026-07-17T09:00:00.000Z', slotFilter: 'types', agents: [SUBSET_ROUND] }))
  writeReport(root, gateRun(7002, { startedAt: '2026-07-17T09:30:00.000Z', agents: FULL_ROUNDS }))
  writeReport(root, gateRun(7002, { startedAt: '2026-07-17T10:00:00.000Z', slotFilter: 'lint', agents: [SUBSET_ROUND] }))

  const out = summarizeGateRuns(root, 7002)

  assert.equal(out.length, 1, `only the one full run survives; got ${JSON.stringify(out)}`)
  assert.deepEqual(
    out,
    [{ startedAt: '2026-07-17T09:30:00.000Z', green: true, rounds: FULL_ROUNDS, slotFailures: 0 }],
    'the newest run being a --slots subset does not make it the phase gate round — the full run in the middle is',
  )
  assert.equal(
    out.at(-1).startedAt,
    '2026-07-17T09:30:00.000Z',
    'the LAST entry is the newest FULL run, never the newest filtered one (the eval reads the tail as the final gate)',
  )
})

test('summarizeGateRuns — an all-full corpus is unchanged; an all-filtered one is [] (never null, never a throw)', () => {
  const full = gateScratch()
  for (const [startedAt, round] of [
    ['2026-07-18T09:00:00.000Z', 0],
    ['2026-07-18T10:00:00.000Z', 1],
    ['2026-07-18T11:00:00.000Z', 2],
  ])
    writeReport(full, gateRun(7003, { startedAt, agents: [{ round, agent: 'code-reviewer', verdict: 'clean' }] }))
  assert.deepEqual(
    summarizeGateRuns(full, 7003),
    [
      { startedAt: '2026-07-18T09:00:00.000Z', green: true, rounds: [{ round: 0, agent: 'code-reviewer', verdict: 'clean' }], slotFailures: 0 },
      { startedAt: '2026-07-18T10:00:00.000Z', green: true, rounds: [{ round: 1, agent: 'code-reviewer', verdict: 'clean' }], slotFailures: 0 },
      { startedAt: '2026-07-18T11:00:00.000Z', green: true, rounds: [{ round: 2, agent: 'code-reviewer', verdict: 'clean' }], slotFailures: 0 },
    ],
    'POSITIVE CONTROL: with no filtered report in the dir, every run is emitted exactly as today',
  )
  // The shipped corpus too — the real report bytes, not this file's dialect.
  assert.equal(summarizeGateRuns(fixture(), 9001).length, 1, 'the shipped model-less corpus is untouched by the filter')

  const filtered = gateScratch()
  writeReport(filtered, gateRun(7004, { startedAt: '2026-07-19T09:00:00.000Z', slotFilter: 'types', agents: [SUBSET_ROUND] }))
  writeReport(filtered, gateRun(7004, { startedAt: '2026-07-19T10:00:00.000Z', slotFilter: 'types' }))
  const none = summarizeGateRuns(filtered, 7004)
  assert.equal(Array.isArray(none), true, 'a phase whose every run was a subset check returns an ARRAY')
  assert.deepEqual(
    none,
    [],
    'a phase that only ever ran --slots subsets has NO evidenced gate round — an empty list, not a fabricated one',
  )
})

// ── 14. assemblePhaseEvalRecord — the ROLE-BINDING projection ──────────────────────────
//
// PhaseExecutionResultShape.roles is an ARRAY of per-FIRING bindings
// (`{ role, model, via, substituted? }`); PhaseEvalRecordShape.attribution.roles is a strict
// RECORD keyed by role whose value is `{ model }` and nothing else. The projection is
// therefore LOSSY BY CONTRACT: `via`, `substituted` and the firing COUNT do not travel,
// because the field answers WHO filled the role, not how or how many times. Three things
// must survive it:
//
//   (1) ABSENT STAYS ABSENT. `roles: []` ("the resolver ran and bound nothing") must remain
//       distinguishable from an absent `roles` ("no bindings were recorded") — {} vs
//       undefined. Collapsing them would let a resolver that seated nobody read exactly like
//       a phase that predates the resolver.
//   (2) DETERMINISTIC KEY ORDER. The record is committed to disk; a re-run over unchanged
//       input that reorders keys is a diff with no fact behind it. Order is FIRST-FIRING.
//   (3) NO PLAUSIBLE COLLAPSE. When a role's firings disagree on the model, neither firing is
//       "the" model — first-wins and last-wins are both fabrications. The key is OMITTED and
//       the ambiguity is NAMED, which is the only form that a later reader can act on.

/** The role firings COMMITTED in roadmap/phases/phase-5.phase.ts executionResult.roles — the
 *  shape a real arc actually wrote, verbatim, rather than a dialect invented by this file. */
const phase5RoleFirings = () => [
  { role: 'quality-pass', model: 'claude-opus-5', via: 'child-cli' },
  { role: 'software-architect', model: 'claude-fable-5', via: 'child-cli' },
  { role: 'code-reviewer', model: 'claude-fable-5', via: 'child-cli' },
  { role: 'code-reviewer', model: 'claude-fable-5', via: 'child-cli' },
  { role: 'code-reviewer', model: 'claude-fable-5', via: 'child-cli' },
]

/** The gate's own call shape (cli/commands/gate.mjs). Only `parsed` varies across these tests. */
const assembleArgs = (phase, parsed) => ({
  phase,
  parsed,
  green: true,
  slots: [{ slot: 'lint', exitCode: 0, durationMs: 1200 }],
  fingerprint: { repo: 'zr-evalfix', language: 'typescript', corpusSize: 12 },
  date: '2026-08-20',
})

/** Round-trip an assembled record through the CONSUMER's REAL PhaseEvalRecordShape, over the
 *  same tsx bridge production validates with. The shape is strict at every level, so this is
 *  what proves the PROJECTION (`{ model }` only) rather than a restatement of it here. */
function assertValidatesAsRecord(root, record, why) {
  const res = phaseEvalValidator(root)([record])
  assert.equal(res.ok, true, `${why}; the shape refused it: ${JSON.stringify(res.res ?? {}).slice(0, 1500)}`)
  return res.parsed[0]
}

test('assemblePhaseEvalRecord — copies executionResult.roles into attribution.roles by role, model only', { timeout: 120_000 }, () => {
  const root = fixture()
  const parsed = () => ({
    tasks: [{ id: '5.1' }, { id: '5.2' }],
    keyFiles: ['src/collector.ts'],
    plannedBy: { model: 'claude-fable-5' },
    executionResult: { driver: { model: 'claude-opus-5', lane: 'session' }, roles: phase5RoleFirings() },
  })

  const { record, warnings } = assemblePhaseEvalRecord(assembleArgs(8811, parsed()))

  assert.deepEqual(warnings, [], 'no role disagrees with itself in this corpus — there is nothing to warn about')

  assert.deepEqual(
    record.attribution?.roles,
    {
      'quality-pass': { model: 'claude-opus-5' },
      'software-architect': { model: 'claude-fable-5' },
      'code-reviewer': { model: 'claude-fable-5' },
    },
    "three code-reviewer firings on one model collapse to ONE key: the field answers WHO filled " +
      'the role, and a firing COUNT recorded here would be a second, drifting copy of the gate rounds',
  )
  assert.deepEqual(
    Object.keys(record.attribution.roles),
    ['quality-pass', 'software-architect', 'code-reviewer'],
    'the key SET is the distinct roles and the key ORDER is FIRST FIRING — not alphabetical ' +
      '(code-reviewer would lead) and not last-firing: the record is committed to disk, so a ' +
      're-run over unchanged input must not churn it',
  )

  // The KNOWN-LOSSY half, pinned so it cannot quietly stop being lossy: the target value shape
  // is a strictObject of exactly `{ model }`, so a `via` or a `substituted` riding along would
  // not be extra detail — it would REFUSE the whole record at write time.
  for (const [role, binding] of Object.entries(record.attribution.roles)) {
    assert.deepEqual(Object.keys(binding), ['model'], `${role}: the binding is exactly { model }`)
    assert.equal('via' in binding, false, `${role}: 'via' does NOT travel into the record`)
    assert.equal('substituted' in binding, false, `${role}: 'substituted' does NOT travel into the record`)
  }

  // The role snapshot arrives BESIDE the two attribution fields that already worked, never
  // instead of them.
  assert.deepEqual(record.attribution.plannedBy, { model: 'claude-fable-5' }, 'plannedBy is unaffected')
  assert.deepEqual(record.attribution.driver, { model: 'claude-opus-5', lane: 'session' }, 'driver is unaffected')

  const parsedBack = assertValidatesAsRecord(root, record, 'the assembled record must satisfy PhaseEvalRecordShape')
  assert.deepEqual(
    parsedBack.attribution.roles,
    {
      'quality-pass': { model: 'claude-opus-5' },
      'software-architect': { model: 'claude-fable-5' },
      'code-reviewer': { model: 'claude-fable-5' },
    },
    'and it survives the real shape unchanged — the strict record is what proves the projection',
  )

  assert.equal(
    JSON.stringify(assemblePhaseEvalRecord(assembleArgs(8811, parsed())).record),
    JSON.stringify(record),
    'IDEMPOTENCE: the same input assembles BYTE-identically, so re-recording a phase produces no diff',
  )
})

test('assemblePhaseEvalRecord — roles stay absent when execution recorded none', { timeout: 120_000 }, () => {
  const root = fixture()
  const base = { tasks: [{ id: '5.1' }], keyFiles: ['src/collector.ts'] }

  // (a1) NOTHING recorded — no executionResult at all. Absence must not mint an empty block.
  const nothing = assemblePhaseEvalRecord(assembleArgs(8812, { ...base })).record
  assert.equal(nothing.attribution?.roles, undefined, 'no executionResult ⇒ no roles snapshot')
  assert.equal('attribution' in nothing, false, 'and with nothing else recorded, attribution itself is ABSENT — an empty block is a fabricated record')

  // (a2) An executionResult that recorded a driver but NO roles. The roles key must not appear
  // just because its neighbour did.
  const noRoles = assemblePhaseEvalRecord(
    assembleArgs(8813, { ...base, executionResult: { driver: { model: 'claude-opus-5', lane: 'session' } } }),
  ).record
  assert.deepEqual(noRoles.attribution, { driver: { model: 'claude-opus-5', lane: 'session' } }, 'the driver travels alone')
  assert.equal('roles' in noRoles.attribution, false, 'an unrecorded roles snapshot is an ABSENT KEY, never an empty record')

  // (b) The resolver RAN and bound nobody. That is a recorded fact, and it is not the same
  // fact as (a).
  const emptied = assemblePhaseEvalRecord(assembleArgs(8814, { ...base, executionResult: { roles: [] } })).record
  assert.deepEqual(emptied.attribution?.roles, {}, 'roles: [] ⇒ an EMPTY RECORD — the resolver ran and bound nothing')

  // THE POINT, pinned explicitly: these two must never converge. A reader asking "did the
  // resolver run?" gets a different answer from each, and only if they stay different.
  assert.notDeepStrictEqual(
    emptied.attribution?.roles,
    noRoles.attribution?.roles,
    '{} (bound nothing) and undefined (recorded nothing) are DIFFERENT claims — collapsing them makes a resolver that seated nobody read exactly like a phase that predates the resolver',
  )
  assert.equal(typeof emptied.attribution?.roles, 'object', 'the empty case is an object…')
  assert.equal(noRoles.attribution?.roles, undefined, '…and the absent case is undefined, not an object')

  for (const [record, why] of [
    [nothing, 'a record with no attribution at all'],
    [noRoles, 'a record whose attribution carries only a driver'],
    [emptied, 'a record whose roles snapshot is empty'],
  ])
    assertValidatesAsRecord(root, record, `${why} must satisfy PhaseEvalRecordShape`)
})

test('assemblePhaseEvalRecord — a role whose firings DISAGREE on the model is omitted and NAMED, never collapsed', { timeout: 120_000 }, () => {
  const root = fixture()
  // Four test-engineer firings, ONE of them on a different model (a tier substitution mid-phase),
  // interleaved with a code-reviewer that agrees with itself. The odd firing is LAST so that
  // first-wins and last-wins are DISTINGUISHABLE projections — otherwise falsifying one would
  // vacuously falsify the other.
  const agreeing = [
    { role: 'test-engineer', model: 'claude-fable-5', via: 'child-cli' },
    { role: 'code-reviewer', model: 'claude-opus-5', via: 'child-cli' },
    { role: 'test-engineer', model: 'claude-fable-5', via: 'child-cli' },
    { role: 'test-engineer', model: 'claude-fable-5', via: 'child-cli' },
    { role: 'code-reviewer', model: 'claude-opus-5', via: 'child-cli' },
  ]
  const dissenting = {
    role: 'test-engineer',
    model: MODEL_IDS.SOL,
    via: 'child-cli',
    substituted: { from: 'claude-fable-5', to: MODEL_IDS.SOL, reason: `unavailable: claude-fable-5 (no child CLI) — re-run at UNREDUCED rigor on ${MODEL_IDS.SOL}` },
  }
  const base = { tasks: [{ id: '9.4' }], keyFiles: ['src/collector.ts'] }

  const { record, warnings } = assemblePhaseEvalRecord(
    assembleArgs(8815, { ...base, executionResult: { roles: [...agreeing, dissenting] } }),
  )

  assert.deepEqual(
    record.attribution?.roles,
    { 'code-reviewer': { model: 'claude-opus-5' } },
    'the UNAMBIGUOUS role is unaffected: one bad neighbour drops one key, never the whole snapshot',
  )

  assert.equal(
    'test-engineer' in record.attribution.roles,
    false,
    'a role with two recorded models has no single answer to "who filled it" — the key is OMITTED rather than answered wrongly',
  )

  // Both plausible collapses, falsified BY NAME. Either one would look entirely reasonable in
  // the committed record and would silently assert a fact the firings do not support.
  assert.notDeepStrictEqual(
    record.attribution?.roles,
    { 'test-engineer': { model: 'claude-fable-5' }, 'code-reviewer': { model: 'claude-opus-5' } },
    'FIRST-WINS is not the rule — the majority/earliest model is still only one of two recorded',
  )
  assert.notDeepStrictEqual(
    record.attribution?.roles,
    { 'test-engineer': { model: MODEL_IDS.SOL }, 'code-reviewer': { model: 'claude-opus-5' } },
    'LAST-WINS is not the rule either — a substitution on the final firing does not retroactively fill the earlier ones',
  )

  assert.equal(warnings.length, 1, `exactly ONE warning for one ambiguous role; got ${JSON.stringify(warnings)}`)
  const w = warnings[0]
  assert.ok(w.includes('test-engineer'), `the warning must NAME the role it dropped; got ${JSON.stringify(w)}`)
  assert.ok(w.includes('8815'), `and the PHASE, or the operator cannot find the record it came from; got ${JSON.stringify(w)}`)
  assert.ok(w.includes('claude-fable-5'), `and every distinct model recorded, so the ambiguity is resolvable by hand; got ${JSON.stringify(w)}`)
  assert.ok(w.includes(MODEL_IDS.SOL), `including the substituted one; got ${JSON.stringify(w)}`)
  assert.ok(
    w.indexOf('claude-fable-5') < w.indexOf(MODEL_IDS.SOL),
    `the distinct models are named in FIRING order, not sorted — the order is itself the evidence; got ${JSON.stringify(w)}`,
  )

  assertValidatesAsRecord(root, record, 'a record that dropped an ambiguous role is still a VALID record')

  // FALSIFICATION CONTROL: the same input minus the one disagreeing firing. Three duplicate
  // test-engineer firings remain, so if the guard keyed on DUPLICATION rather than on
  // DISAGREEMENT this would still be dropped and still warn.
  const control = assemblePhaseEvalRecord(assembleArgs(8815, { ...base, executionResult: { roles: agreeing } }))
  assert.deepEqual(
    control.record.attribution?.roles,
    { 'test-engineer': { model: 'claude-fable-5' }, 'code-reviewer': { model: 'claude-opus-5' } },
    'with the dissenting firing removed the role is GAINED — the guard keys on disagreement, not on repeated firings',
  )
  assert.deepEqual(control.warnings, [], 'and the warning is LOST with it')
})
