#!/usr/bin/env node
/**
 * Fixtures for the NEW validate surface (the ported rules stay covered by the UNMODIFIED
 * bin/validate-roadmap-file.test.mjs — no duplicate fixtures here): the gate-report
 * done-flip consistency rule (four clauses + green pass + no-dir pass), the
 * `roadmap phase validate` CLI exit mapping, and the arc `rejectedAlternatives` lane
 * (append-only ERROR + adoption WARN). Phase cases drive the real bin over tmp git repos
 * with plain-object phase files; arc cases call `validateRoadmapFile` directly over the real
 * schema (the `phase validate` CLI face is phase-only).
 * Run: node --test cli/lib/validate.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeReport, gateDir } from './gate-report.mjs'
import { validateRoadmapFile } from './validate.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const BIN = join(HERE, '..', '..', 'bin', 'roadmap.mjs')

const bases = []
process.on('exit', () => bases.forEach((b) => rmSync(b, { recursive: true, force: true })))

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'zr-validate-'))
  bases.push(root)
  mkdirSync(join(root, 'roadmap', 'phases'), { recursive: true })
  execFileSync('git', ['-C', root, 'init', '-q'], { stdio: 'ignore' })
  return root
}
function writePhase(root, num, obj) {
  writeFileSync(join(root, 'roadmap', 'phases', `phase-${num}.phase.ts`), `export default ${JSON.stringify(obj, null, 2)}\n`)
  return join(root, 'roadmap', 'phases', `phase-${num}.phase.ts`)
}
function validate(root, num) {
  try {
    execFileSync('node', [BIN, 'phase', 'validate', String(num)], { cwd: root, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, stderr: '' }
  } catch (err) {
    return { code: err.status ?? 1, stderr: (err.stderr ?? '').toString() }
  }
}

const report = (num, over = {}) => ({
  phase: num,
  startedAt: '2026-07-16T10:00:00.000Z',
  baseSha: 'abc',
  mode: 'arc',
  kind: 'logic',
  testScope: { derived: 'relevant', declared: 'relevant', effective: 'relevant' },
  reviewScope: { derived: 'full', declared: 'full', effective: 'full' },
  slots: [{ slot: 'types', command: 'true', exitCode: 0, durationMs: 1, logPath: null }],
  agents: [{ round: 1, agent: 'code-reviewer', verdict: 'clean', summary: '0 findings', recordedAt: 't' }],
  green: true,
  notes: [],
  ...over,
})
const donePhase = (num, over = {}) => ({
  phase: num,
  status: 'done',
  testScope: 'relevant',
  reviewScope: 'full',
  gateRounds: [{ round: 0 }, { round: 1 }],
  tasks: [{ id: `${num}.1`, done: true }],
  ...over,
})

test('done-flip rule — a done phase with NO .gate dir keeps today\'s behavior (exit 0)', () => {
  const root = makeRepo()
  writePhase(root, 2000, donePhase(2000))
  assert.equal(validate(root, 2000).code, 0)
})

test('done-flip rule — a done phase with a GREEN coherent report passes (exit 0)', () => {
  const root = makeRepo()
  writePhase(root, 2001, donePhase(2001))
  writeReport(root, report(2001))
  assert.equal(validate(root, 2001).code, 0)
})

test('done-flip rule — retained codex reports are bounded by the no-self-judge enforcement time', () => {
  const selfReviewedPhase = (num) =>
    donePhase(num, {
      executionResult: { phase: num, status: 'done', driver: { model: 'codex-model', lane: 'codex' } },
      gateRounds: [{ round: 1, agent: 'self-review' }],
    })
  const selfReviewedReport = (num, startedAt) =>
    report(num, {
      startedAt,
      agents: [{ round: 1, agent: 'self-review', verdict: 'clean', summary: 'driver review', recordedAt: 't' }],
    })

  const historicalRoot = makeRepo()
  writePhase(historicalRoot, 2010, selfReviewedPhase(2010))
  writeReport(historicalRoot, selfReviewedReport(2010, '2026-09-01T07:30:26.999Z'))
  assert.equal(validate(historicalRoot, 2010).code, 0, 'a retained pre-enforcement report remains valid historical evidence')

  const currentRoot = makeRepo()
  writePhase(currentRoot, 2011, selfReviewedPhase(2011))
  writeReport(currentRoot, selfReviewedReport(2011, '2026-09-01T07:30:27.000Z'))
  const current = validate(currentRoot, 2011)
  assert.equal(current.code, 2, 'the same retained report at the enforcement boundary is refused')
  assert.match(current.stderr, /no-self-judge/)
})

test('done-flip rule — a NOT-GREEN latest report fails exit 2 naming the rule + report path', () => {
  const root = makeRepo()
  writePhase(root, 2002, donePhase(2002))
  const { path } = writeReport(root, report(2002, { green: false }))
  const r = validate(root, 2002)
  assert.equal(r.code, 2)
  assert.match(r.stderr, /done-without-green-gate-report/)
  assert.match(r.stderr, /not green/)
  assert.ok(r.stderr.includes(path.split('/').pop()), 'names the report file')
})

test('done-flip rule — a SCOPE mismatch and a gateRounds-count mismatch each fail exit 2', () => {
  const scopeRepo = makeRepo()
  writePhase(scopeRepo, 2003, donePhase(2003))
  writeReport(scopeRepo, report(2003, { reviewScope: { derived: 'full', declared: 'light', effective: 'light' } }))
  const scope = validate(scopeRepo, 2003)
  assert.equal(scope.code, 2)
  assert.match(scope.stderr, /scope mismatch/)

  const roundRepo = makeRepo()
  writePhase(roundRepo, 2004, donePhase(2004))
  writeReport(roundRepo, report(2004, { agents: [] })) // 0 rounds vs phase's 1 → mismatch
  const rounds = validate(roundRepo, 2004)
  assert.equal(rounds.code, 2)
  assert.match(rounds.stderr, /gateRounds count mismatch/)
})

test('CLI exit mapping — a done-with-open-task fixture exits 2; its corrected twin exits 0', () => {
  const root = makeRepo()
  writePhase(root, 2005, donePhase(2005, { tasks: [{ id: '2005.1', done: true }, { id: '2005.2', done: false }] }))
  const bad = validate(root, 2005)
  assert.equal(bad.code, 2)
  assert.match(bad.stderr, /done-with-open-task/)
  // corrected twin — all tasks done, no gate dir → clean
  writePhase(root, 2005, donePhase(2005, { tasks: [{ id: '2005.1', done: true }, { id: '2005.2', done: true }] }))
  assert.equal(validate(root, 2005).code, 0)
})

test('validateRoadmapFile — strict flag returns kind ok on a valid file (engine reused, no process.exit)', () => {
  const root = makeRepo()
  const p = writePhase(root, 2006, { phase: 2006, status: 'backlog', tasks: [] })
  const res = validateRoadmapFile(p, { strict: true })
  assert.equal(res.kind, 'ok')
  assert.equal(res.ok, true)
})

// ── the corrupt-latest-report lane (phase 9.2) ───────────────────────────────────────
//
// The done-flip rule reads the phase's newest gate report through latestReport(), which
// answers `null` both for "no report" and for "the newest run file cannot be read" — and the
// rule's `if (!latest) return []` then treats the second as the first. A done phase whose
// only evidence is a corrupt run file therefore validates CLEAN: the one guard that exists to
// stop a narrated done flip goes silent exactly when the evidence stopped being readable.
// The rule must instead REPORT it — a finding naming the file and why it could not be read —
// and it must not crash validation to do so (an exception here would surface as exit 1, the
// usage/toolchain lane, and read as a broken validator rather than a broken report).

/** Drop `body` into a phase's gate dir as the NEWEST run file (seq = highest + 1). */
function writeNewestRun(root, phase, body) {
  const dir = gateDir(root, phase)
  mkdirSync(dir, { recursive: true })
  const seqs = readdirSync(dir)
    .filter((f) => /^run-\d+-.*\.json$/.test(f))
    .map((f) => Number(f.match(/^run-(\d+)-/)[1]))
  const seq = (seqs.length ? Math.max(...seqs) : 0) + 1
  const path = join(dir, `run-${String(seq).padStart(6, '0')}-2026-08-25T10-00-00-000Z.json`)
  writeFileSync(path, body)
  return path
}

test('phase validate — corrupt newest gate report is a named finding, never a silent pass', () => {
  const root = makeRepo()
  const phaseFile = writePhase(root, 2007, donePhase(2007))
  // An OLDER green, coherent report: on its own this phase validates clean, so the ONLY
  // difference between the two halves of this test is the unreadable newest file. A rule that
  // fell back to the newest READABLE report would pass here — certifying a done flip from a
  // report that is no longer the record.
  const { path: olderPath } = writeReport(root, report(2007))
  const body = '{ "phase": 2007, "green": tru }\n'
  const corruptPath = writeNewestRun(root, 2007, body)
  let parseDetail = null
  try {
    JSON.parse(body)
  } catch (e) {
    parseDetail = e.message
  }
  assert.ok(parseDetail, 'fixture bug: the corrupt body must not parse')

  const res = validateRoadmapFile(phaseFile)

  assert.equal(res.kind, 'errors', `an unreadable gate report is a FINDING, not a pass and not a crash (got kind ${res.kind})`)
  const finding = res.errors.find((e) => e.rule === 'done-without-green-gate-report')
  assert.ok(
    finding,
    `the done-flip rule must fire: a done phase whose newest report cannot be read has no readable green evidence (got ${JSON.stringify(res.errors)})`,
  )
  assert.ok(finding.msg.includes(corruptPath), `the finding NAMES the unreadable run file (got: ${finding.msg})`)
  assert.ok(
    finding.msg.includes(parseDetail),
    `and carries WHY it could not be read — '${parseDetail}' (got: ${finding.msg})`,
  )
  assert.equal(
    finding.msg.includes(olderPath),
    false,
    'the finding is about the newest report, not the older one the rule declined to fall back to',
  )

  // The CLI face: exit 2 (check failed), never 1 (a thrown error would land there) and never 0.
  const r = validate(root, 2007)
  assert.equal(r.code, 2, `the corrupt report reds the phase; stderr: ${r.stderr}`)
  assert.match(r.stderr, /done-without-green-gate-report/)
  assert.ok(r.stderr.includes(corruptPath), `stderr names the file too; stderr: ${r.stderr}`)
  assert.equal(readFileSync(corruptPath, 'utf8'), body, 'validation never repairs or rewrites the evidence it read')

  // Positive control: make the newest report readable and coherent → clean again, exit 0.
  writeFileSync(corruptPath, readFileSync(olderPath, 'utf8'))
  assert.equal(validate(root, 2007).code, 0, 'the ONLY thing this phase was red for was the unreadable report')
})

// ── the rejectedAlternatives lane (phase 10.4) ───────────────────────────────────────
//
// ArcShape.rejectedAlternatives is a TYPED, append-only record of options a human or a
// recorded architect verdict already ruled OUT. Two guards keep it from decaying back into
// prose:
//
//   (1) APPEND-ONLY. A building arc whose rejectedAlternatives array lost entries against
//       git HEAD is deleting history — the resurrection leak the field closes. This must be
//       INDEPENDENT of the acceptanceCriteria-immutable branch that shares the function:
//       that branch stops looking the moment AC are unchanged (and again the moment a
//       ratification was appended), so a shrink riding either shortcut would go unseen.
//   (2) ADOPTION. An arc NEW to git that writes REJECTED in prose but carries no
//       `rejectedAlternatives:` key gets a WARN — pressure at the one cheap moment
//       (authoring), never an error (committed arcs are grandfathered exactly like the
//       phase-file lint family).
//
// The git-HEAD + `.building/<id>.json` sidecar machinery below is the bin suite's arc fixture
// (bin/validate-roadmap-file.test.mjs case (e)), ported here over the real schema so the
// entries are shape-valid rejections and not just text the counter can see.

const SCHEMA = join(HERE, '..', '..', 'templates', 'schema.ts')

const REJECT_A = {
  option: 'a Phase-level rejectedAlternatives field',
  why: 'Phase-schema churn is the wider blast radius and standalone rejections persist in decisionRef',
  decidedBy: 'software-architect verdict 2026-08-26',
  decidedAt: '2026-08-26',
}
const REJECT_B = {
  option: 'extend descopes to also carry rejections',
  why: 'a rejected alternative is not a scope narrowing and would force every descopes reader to filter',
  decidedBy: 'user',
  decidedAt: '2026-08-26',
}
const REJECT_C = {
  option: 'keep rejections in LOCKED DECISIONS prose only',
  why: 'prose is not greppable by a future planner, which is the resurrection leak itself',
  decidedBy: 'user',
  decidedAt: '2026-08-27',
}

/**
 * An arc source file. `rejected: null` omits the key entirely (the deletion an author
 * actually performs); `[]` writes an empty array. `rails` and `ratifications` are the
 * benign-edit and AC-ratification levers the cases below need.
 */
function arcSource({ signal = 'the original signal text', rejected = null, rails = [], ratifications = null } = {}) {
  const railBlock = rails.length ? `\n  honestyRails: [${rails.map((r) => `'${r}'`).join(', ')}],` : ''
  const rejBlock =
    rejected === null
      ? ''
      : `\n  rejectedAlternatives: [\n${rejected
          .map((r) => `    { option: '${r.option}', why: '${r.why}', decidedBy: '${r.decidedBy}', decidedAt: '${r.decidedAt}' },`)
          .join('\n')}\n  ],`
  const ratBlock = ratifications === null ? '' : `\n  criteriaRatifications: [${ratifications.map((r) => `'${r}'`).join(', ')}],`
  return `import { defineArc } from '${SCHEMA}'
export default defineArc({
  id: 'TESTARC', name: 'a fixture test arc', baseRef: 'develop',
  planes: [{ name: 'only plane', phases: [9006] }],${railBlock}
  acceptanceCriteria: [{ id: 'ac-1', job: 'as a user I want the thing', surfaces: ['cli'], signal: '${signal}', tier: 'wired', bar: 'the bar is cleared' }],${rejBlock}${ratBlock}
})
`
}

/** A tmp consumer repo holding roadmap/arcs/TESTARC.arc.ts, plus its git + sidecar levers. */
function makeArcRepo() {
  const base = mkdtempSync(join(tmpdir(), 'zr-validate-arc-'))
  bases.push(base)
  const arcsDir = join(base, 'roadmap', 'arcs')
  mkdirSync(arcsDir, { recursive: true })
  const arcPath = join(arcsDir, 'TESTARC.arc.ts')
  const git = (...args) =>
    execFileSync('git', ['-C', base, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { stdio: 'ignore' })
  git('init', '-q')
  return {
    base,
    arcPath,
    write: (opts) => writeFileSync(arcPath, arcSource(opts)),
    commitAll: (msg) => {
      git('add', '-A')
      git('commit', '-q', '-m', msg)
    },
    /** The `.building/<id>.json` marker: the arc is past planning, so its record is frozen. */
    markBuilding: () => {
      mkdirSync(join(arcsDir, '.building'), { recursive: true })
      writeFileSync(join(arcsDir, '.building', 'TESTARC.json'), JSON.stringify({ arcId: 'TESTARC' }))
    },
  }
}

const rulesOf = (res) => (res.errors ?? []).map((e) => e.rule)
const appendOnly = (res) => (res.errors ?? []).find((e) => e.rule === 'rejectedAlternatives-append-only')

test('rejectedAlternatives — a building arc that DELETES a recorded rejection is an append-only ERROR, on every path the AC branch short-circuits', () => {
  const repo = makeArcRepo()
  // HEAD holds TWO recorded rejections.
  repo.write({ rejected: [REJECT_A, REJECT_B] })
  repo.commitAll('v1: two recorded rejections')
  repo.markBuilding()

  // (a) MINIMAL shrink — 2 → 1, acceptanceCriteria byte-identical. Today the shared
  // arcImmutabilityChecks returns [] at `if (curAC === headAC)` before it could look.
  repo.write({ rejected: [REJECT_A] })
  const shrunk = validateRoadmapFile(repo.arcPath)
  assert.equal(shrunk.kind, 'errors', `dropping a recorded rejection must RED (got kind ${shrunk.kind})`)
  const finding = appendOnly(shrunk)
  assert.ok(finding, `expected a rejectedAlternatives-append-only error; got rules ${JSON.stringify(rulesOf(shrunk))}`)
  assert.ok(finding.msg.includes('TESTARC'), `the finding names the arc (got: ${finding.msg})`)
  assert.match(finding.msg, /\b2\b/, `and the count it had — 2 (got: ${finding.msg})`)
  assert.match(finding.msg, /\b1\b/, `and the count it now has — 1 (got: ${finding.msg})`)
  assert.match(
    String(finding.fix),
    /append/i,
    `the fix tells the author to APPEND a superseding entry rather than delete (got: ${finding.fix})`,
  )
  assert.equal(
    rulesOf(shrunk).includes('acceptanceCriteria-immutable'),
    false,
    'acceptanceCriteria did not change, so the AC rule must stay silent — this error is its own',
  )

  // (b) BOUNDARY: the whole key deleted (2 → 0) — the deletion an author actually performs.
  repo.write({ rejected: null })
  const gone = validateRoadmapFile(repo.arcPath)
  assert.ok(
    appendOnly(gone),
    `removing the rejectedAlternatives key outright is the same deletion; got rules ${JSON.stringify(rulesOf(gone))}`,
  )

  // (c) The OTHER short-circuit: acceptanceCriteria changed WITH a fresh ratification, which
  // makes the AC branch return [] on `curRat > headRat`. A shrink smuggled into that same edit
  // must still red — the two records are independent.
  repo.write({
    signal: 'a RATIFIED broadened signal',
    rejected: [REJECT_A],
    ratifications: ['2026-08-27: broadened ac-1 signal per user ratification'],
  })
  const ratified = validateRoadmapFile(repo.arcPath)
  assert.ok(
    appendOnly(ratified),
    `a ratified AC change does not license deleting a rejection; got rules ${JSON.stringify(rulesOf(ratified))}`,
  )
  assert.equal(
    rulesOf(ratified).includes('acceptanceCriteria-immutable'),
    false,
    'and the ratification still satisfies the AC rule — the shrink is the only complaint',
  )
})

test('rejectedAlternatives — growth or an unchanged count on a building arc is CLEAN, even when acceptanceCriteria never changed', () => {
  const repo = makeArcRepo()
  repo.write({ rejected: [REJECT_A, REJECT_B] })
  repo.commitAll('v1: two recorded rejections')
  repo.markBuilding()

  // UNCHANGED count, with a real edit elsewhere so the file genuinely differs from HEAD
  // (an identical file would pass for the wrong reason).
  repo.write({ rejected: [REJECT_A, REJECT_B], rails: ['every claim in this arc names the run that proved it'] })
  const same = validateRoadmapFile(repo.arcPath)
  assert.notEqual(
    readFileSync(repo.arcPath, 'utf8'),
    execFileSync('git', ['-C', repo.base, 'show', 'HEAD:roadmap/arcs/TESTARC.arc.ts'], { encoding: 'utf8' }),
    'fixture bug: the working copy must differ from HEAD',
  )
  assert.equal(same.ok, true, `an unchanged rejection count is not a finding; got ${JSON.stringify(same.errors ?? [])}`)
  assert.equal(appendOnly(same), undefined, 'no append-only error on an unchanged count')

  // GROWTH — 2 → 3, acceptanceCriteria still byte-identical to HEAD.
  repo.write({ rejected: [REJECT_A, REJECT_B, REJECT_C] })
  const grown = validateRoadmapFile(repo.arcPath)
  assert.equal(grown.ok, true, `appending a rejection is the intended motion; got ${JSON.stringify(grown.errors ?? [])}`)
  assert.equal(appendOnly(grown), undefined, 'no append-only error on growth')

  // ARMED-check: the two clean verdicts above are only worth something if this fixture CAN
  // red. Shrink the very same file and demand the error — without this, deleting the guard
  // outright leaves this test green.
  repo.write({ rejected: [REJECT_A] })
  assert.ok(
    appendOnly(validateRoadmapFile(repo.arcPath)),
    'the guard is armed on this fixture — the clean verdicts above are about the count, not about a dead check',
  )
})

test('rejectedAlternatives — a count-preserving substitution or in-place rewrite on a building arc is the same erasure', () => {
  const repo = makeArcRepo()
  repo.write({ rejected: [REJECT_A, REJECT_B] })
  repo.commitAll('v1: two recorded rejections')
  repo.markBuilding()

  // SUBSTITUTION: delete B while appending C — the count stays 2, a recorded rejection is gone.
  repo.write({ rejected: [REJECT_A, REJECT_C] })
  const swapped = validateRoadmapFile(repo.arcPath)
  assert.ok(appendOnly(swapped), `a delete hidden behind an append must red; got rules ${JSON.stringify(rulesOf(swapped))}`)

  // IN-PLACE REWRITE: same count, same slot, different content — the entry HEAD recorded is gone.
  const softened = { ...REJECT_B, why: 'quietly softened after the fact, the overwrite the guard must catch' }
  repo.write({ rejected: [REJECT_A, softened] })
  const overwrote = validateRoadmapFile(repo.arcPath)
  assert.ok(appendOnly(overwrote), `rewriting a recorded rejection must red; got rules ${JSON.stringify(rulesOf(overwrote))}`)

  // REORDER of the same surviving entries is NOT an erasure — pins the multiset semantics.
  repo.write({ rejected: [REJECT_B, REJECT_A] })
  const reordered = validateRoadmapFile(repo.arcPath)
  assert.equal(appendOnly(reordered), undefined, `reordering surviving entries is clean; got ${JSON.stringify(rulesOf(reordered))}`)
})

const adoptionWarns = (res) => (res.warnings ?? []).filter((w) => /rejectedAlternatives/.test(w))

test('rejectedAlternatives — a NEW-to-git arc writing REJECTED in prose with no typed field gets an adoption WARN, never an error', () => {
  const repo = makeArcRepo()
  // HEAD exists but does NOT hold this arc file: the lint fires on authoring, not on edits.
  writeFileSync(join(repo.base, 'README.md'), '# fixture consumer\n')
  repo.commitAll('v0: repo without the arc')
  repo.write({ rails: ['the streaming-writer option was REJECTED at the design gate — do not resurrect it'] })
  const content = readFileSync(repo.arcPath, 'utf8')
  assert.match(content, /\bREJECTED\b/, 'fixture bug: the prose the lint keys on must be present')
  assert.equal(/rejectedAlternatives:/.test(content), false, 'fixture bug: the typed key must be ABSENT')

  const res = validateRoadmapFile(repo.arcPath)
  assert.equal(res.ok, true, `the nudge is advisory — it must never red the file (got ${JSON.stringify(res.errors ?? [])})`)
  assert.equal(res.kind, 'ok')
  const warns = adoptionWarns(res)
  assert.equal(warns.length, 1, `expected exactly one rejectedAlternatives nudge; got ${JSON.stringify(res.warnings ?? [])}`)
  assert.match(warns[0], /WARN/, `it is labelled a WARN (got: ${warns[0]})`)
  assert.ok(warns[0].includes('TESTARC'), `and names the arc it is about (got: ${warns[0]})`)

  // Grandfathering: the SAME bytes, once git has them, stop warning — the ~committed arcs
  // are not a backlog of lint debt.
  repo.commitAll('v1: the arc as authored')
  assert.deepEqual(
    adoptionWarns(validateRoadmapFile(repo.arcPath)),
    [],
    'a committed arc is grandfathered exactly like the phase-file lint family',
  )
})

test('rejectedAlternatives — the same new-to-git arc WITH a rejectedAlternatives key gets no adoption WARN', () => {
  const repo = makeArcRepo()
  writeFileSync(join(repo.base, 'README.md'), '# fixture consumer\n')
  repo.commitAll('v0: repo without the arc')
  // Identical to the previous fixture EXCEPT the typed key — the prose stays, so a pass here
  // can only come from the key being seen, never from the trigger having vanished.
  repo.write({
    rails: ['the streaming-writer option was REJECTED at the design gate — do not resurrect it'],
    rejected: [REJECT_A],
  })
  const content = readFileSync(repo.arcPath, 'utf8')
  assert.match(content, /\bREJECTED\b/, 'fixture bug: the trigger prose must still be present')
  assert.match(content, /rejectedAlternatives:/, 'fixture bug: the typed key must be present')

  const res = validateRoadmapFile(repo.arcPath)
  assert.equal(res.ok, true, `a well-formed arc stays green; got ${JSON.stringify(res.errors ?? [])}`)
  assert.deepEqual(
    adoptionWarns(res),
    [],
    'the author already used the typed field — nudging them again is noise',
  )

  // ARMED-check: drop ONLY the key from this same new-to-git file and the nudge must appear,
  // proving the silence above came from the key and not from an absent lint.
  repo.write({ rails: ['the streaming-writer option was REJECTED at the design gate — do not resurrect it'] })
  assert.equal(
    adoptionWarns(validateRoadmapFile(repo.arcPath)).length,
    1,
    'the lint is armed on this fixture — the silence above is about the typed key, not about a dead lint',
  )
})
