/**
 * roadmap gate plan <phase> — the resolved gate decision table as JSON (slots, scopes,
 * floors, agent chain, baseSha, design parity — WHY included). A floor violation is an
 * exit code (2), not a paragraph the caller can narrate around.
 * roadmap gate run <phase>  — lands in 1656.5 (executes the mechanical half + writes
 * the GateRunReport).
 *
 * Home per pre-made decision 9 (plan + run share this module). deriveBaseSha is a NAMED
 * export so 1657's derive.mjs imports it rather than re-implementing the em-dash rule.
 * Exit-code contract (pre-made decision 10): 0 clean · 1 usage/config/toolchain · 2
 * refused (floor violation / missing slot binding).
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { gitToplevel } from '../lib/gitroot.mjs'
import { derivePhaseStartSha, GitScanError } from '../lib/gitscan.mjs'
import { bridgeImport, TSX_ABSENT_HINT } from '../lib/tsx-bridge.mjs'
import {
  gateCell,
  specialistFloor,
  deriveTestScope,
  deriveReviewScope,
  classifyBand,
  EXECUTABLE_EXTS,
} from '../lib/ladder.mjs'
import { resolveSlot, resolveScopedOrFallback, runSlot } from '../lib/slots.mjs'
import {
  writeReport,
  latestReport,
  appendAgentRound,
  checkPhaseConsistency,
  gateDir,
  AgentRoundInputShape,
} from '../lib/gate-report.mjs'

/** A typed gate failure carrying its exit code + stderr lines. */
export class GateError extends Error {
  constructor(code, lines) {
    super(lines.join('\n'))
    this.name = 'GateError'
    this.code = code
    this.lines = lines
  }
}

const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { timeout: 15_000, encoding: 'utf8' }).trim()
const isTestFile = (p) => /(?:\.|-)(?:test|itest|spec)\.[cm]?[jt]sx?$/.test(p)
const isExecutable = (p) => EXECUTABLE_EXTS.some((e) => p.endsWith(e))

/**
 * baseSha = parent (^) of the OLDEST commit matching `phase <N> —` (the em-dash
 * boundary prevents 136 matching 1369 — do-phase SKILL.md:127-135). --base overrides.
 * Thin wrapper over the shared gitscan.derivePhaseStartSha (pre-made decision 3: ONE
 * em-dash rule; derive.mjs's resume.startSha uses the same helper) — this wrapper only
 * maps the typed GitScanError onto gate's exit-code contract (no-match ⇒ GateError(1)
 * naming the expected move-to-in-progress commit form).
 */
export function deriveBaseSha(cwd, phaseNum, { base } = {}) {
  try {
    return derivePhaseStartSha(cwd, phaseNum, { base })
  } catch (e) {
    if (e instanceof GitScanError && e.kind === 'no-match') {
      throw new GateError(1, [
        `gate plan: no commit matching "phase ${phaseNum} —" — expected the move-to-in-progress`,
        `commit (e.g. "plan(roadmap): phase ${phaseNum} — …" or "feat(scope): phase ${phaseNum} — …").`,
        'Pass --base <sha> to override.',
      ])
    }
    if (e instanceof GitScanError) throw new GateError(1, e.messageLines)
    throw e
  }
}

/** Files touched by the PHASE's OWN commits over base..HEAD (the em-dash grep), unique. */
function phaseOwnFiles(cwd, phaseNum, base) {
  const grep = `phase ${phaseNum} —`
  let out
  try {
    out = git(cwd, ['log', `--grep=${grep}`, '--name-only', '--format=', `${base}..HEAD`])
  } catch {
    return []
  }
  return [...new Set(out.split('\n').map((s) => s.trim()).filter(Boolean))]
}

/**
 * Findings for gate-fix commits that patched ONLY source with no test in their diff
 * (MECHRATCHET rank 9): a `fix(scope): phase <N> gate R<k>` commit (the em-dash-free
 * gate-fix convention `fix(scope): phase N gate RX`) whose file set is non-empty, every
 * file isExecutable, and NONE isTestFile. WARN ONLY — the caller appends these to the
 * report notes / prints them; exit codes never change. Conservative on any git failure ([]).
 * The trailing ` gate` boundary keeps `phase 940` from matching `phase 9401 gate` (the
 * em-dash rule's analogue for this convention).
 */
export function untestedGateFixFindings(cwd, phaseNum, base) {
  let log
  try {
    log = git(cwd, ['log', '--format=%H%x09%s', `${base}..HEAD`])
  } catch {
    return []
  }
  const re = new RegExp(`^fix\\(.*\\): phase ${phaseNum} gate R\\d+`)
  const findings = []
  for (const line of log.split('\n').filter(Boolean)) {
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const sha = line.slice(0, tab)
    const subject = line.slice(tab + 1)
    if (!re.test(subject)) continue
    let files
    try {
      files = git(cwd, ['show', '--name-only', '--format=', sha]).split('\n').map((s) => s.trim()).filter(Boolean)
    } catch {
      continue
    }
    if (files.length === 0) continue
    if (!files.every((f) => isExecutable(f))) continue
    if (files.some((f) => isTestFile(f))) continue
    findings.push(
      `untested gate-fix: ${sha.slice(0, 7)} "${subject}" touches only source files with no test in its diff — reviewer judges (MECHRATCHET rank 9)`,
    )
  }
  return findings
}

/** The raw base..HEAD file set (all commits in range) — the cross-check for foreign commits. */
function rawRangeFiles(cwd, base) {
  try {
    return git(cwd, ['diff', '--name-only', `${base}..HEAD`]).split('\n').filter(Boolean)
  } catch {
    return []
  }
}

/** Sum of added+removed lines over `files` (numstat; binary '-' counts 0). */
function changedLinesFor(cwd, base, files) {
  let out
  try {
    out = git(cwd, ['diff', '--numstat', `${base}..HEAD`])
  } catch {
    return 0
  }
  const set = new Set(files)
  let total = 0
  for (const line of out.split('\n').filter(Boolean)) {
    const [add, del, file] = line.split('\t')
    if (set.has(file)) total += (Number(add) || 0) + (Number(del) || 0)
  }
  return total
}

/** The colocated-sibling extensions the purity predicate and the scoped file selection
 *  must agree on — ONE list so the two lookups can never drift apart. */
const COLOCATED_TEST_EXTS = ['.test.ts', '.test.tsx', '.test.js', '.test.mjs', '.test.cjs', '.itest.ts', '.itest.mjs', '.spec.ts']

/** A precomputed Set of exec paths that are a test or have a colocated sibling test on
 *  disk (the ONLY on-disk lookup — passed to ladder.mjs so it stays pure). */
function colocatedTestSet(toplevel, paths) {
  const set = new Set()
  for (const p of paths) {
    if (isTestFile(p)) {
      set.add(p)
      continue
    }
    if (!isExecutable(p)) continue
    const stem = p.replace(/\.[^./]+$/, '')
    if (COLOCATED_TEST_EXTS.some((ext) => existsSync(join(toplevel, stem + ext)))) set.add(p)
  }
  return set
}

/** The scoped test-file selection for a narrowed run: phase-own test files + existing
 *  colocated siblings of changed exec files (relative paths). */
function selectTestFiles(toplevel, paths) {
  const out = []
  for (const p of paths) {
    if (isTestFile(p)) {
      out.push(p)
      continue
    }
    if (!isExecutable(p)) continue
    const stem = p.replace(/\.[^./]+$/, '')
    for (const ext of COLOCATED_TEST_EXTS) if (existsSync(join(toplevel, stem + ext))) out.push(stem + ext)
  }
  return [...new Set(out)]
}

function classOf(p) {
  if (isTestFile(p)) return 'test'
  if (p.startsWith('docs/') || p.endsWith('.md')) return 'docs'
  return p.split('/')[0] || 'root'
}

function designParity(parsed) {
  const refs = []
  const collect = (arr) => {
    for (const d of arr ?? []) if (d && d.kind === 'ux' && d.ref) refs.push(d.ref)
  }
  collect(parsed?.designRefs)
  for (const t of parsed?.tasks ?? []) collect(t?.designRefs)
  return { required: refs.length > 0, designRef: refs[0] ?? null }
}

const compactSlot = (r) => {
  const out = { slot: r.slot }
  if (r.command != null) out.command = r.command
  if (r.files != null) out.files = r.files
  if (r.note != null) out.note = r.note
  if (r.refused != null) out.refused = r.refused
  if (r.declaredAbsent) out.declaredAbsent = true
  return out
}

/**
 * Build the resolved gate plan for `phaseNum`. Impure (git + fs + tsx bridge); returns
 * the plan object + a `refused` flag the caller maps to exit 2. Throws GateError(1) on
 * a usage/toolchain problem (missing phase file, tsx absent in this strict context).
 */
export function buildPlan(cwd, phaseNum, opts = {}) {
  const toplevel = gitToplevel(cwd)
  const mode = opts.mode ?? (existsSync(join(toplevel, 'roadmap', '.arc-mode')) ? 'arc' : 'inline')

  const phaseFile = join(toplevel, 'roadmap', 'phases', `phase-${phaseNum}.phase.ts`)
  if (!existsSync(phaseFile)) throw new GateError(1, [`gate plan: no phase file at ${phaseFile}`])
  const imp = bridgeImport(phaseFile, { consumerRoot: toplevel })
  if (!imp.ok) {
    if (imp.kind === 'tsx-absent') throw new GateError(1, [TSX_ABSENT_HINT])
    throw new GateError(1, [`gate plan: failed to read ${phaseFile}:`, imp.stderr || `bridge ${imp.kind}`])
  }
  const phase = imp.parsed
  const kind = phase?.kind ?? 'logic'

  const base = deriveBaseSha(cwd, phaseNum, { base: opts.base })
  const ownFiles = phaseOwnFiles(cwd, phaseNum, base)
  const rawFiles = rawRangeFiles(cwd, base)
  const ownSet = new Set(ownFiles)
  const foreign = rawFiles.filter((f) => !ownSet.has(f))

  const diff = {
    paths: ownFiles,
    changedLines: changedLinesFor(cwd, base, ownFiles),
    colocatedTest: colocatedTestSet(toplevel, ownFiles),
  }

  const floor = specialistFloor(diff, opts.cfg)
  const testScope = deriveTestScope(diff, phase, opts.cfg, { sequenceMember: !!opts.sequenceMember })
  const reviewScope = deriveReviewScope(diff, phase, opts.cfg)

  // ── slots — the non-test frame from the cell + test slots per effective testScope ──
  const cell = gateCell(kind, mode)
  const nonTest = cell.slots.filter((s) => s !== 'unit' && s !== 'integration')
  const wantsTests = cell.slots.includes('unit') || cell.slots.includes('integration') || cell.scopedTests
  const slots = []
  for (const s of nonTest) slots.push(compactSlot(resolveSlot(opts.cfg, s)))
  const testFiles = selectTestFiles(toplevel, ownFiles)
  if (wantsTests && testScope.effective !== 'static' && !testScope.refused) {
    if (testScope.effective === 'full') {
      slots.push(compactSlot(resolveSlot(opts.cfg, 'unit')))
      slots.push(compactSlot(resolveSlot(opts.cfg, 'integration')))
    } else {
      slots.push(compactSlot({ ...resolveScopedOrFallback(opts.cfg, 'unit', testFiles), files: testFiles }))
      slots.push(compactSlot({ ...resolveScopedOrFallback(opts.cfg, 'integration', testFiles), files: testFiles }))
    }
  }
  if (cell.e2e === 'inline') slots.push(compactSlot(resolveSlot(opts.cfg, 'e2e')))

  // ── agent chain from reviewScope + specialists ──
  const reviewEff = reviewScope.effective
  const agents = {
    round0: reviewEff === 'full' ? 'quality-pass' : `skipped — reviewScope ${reviewEff}`,
    reviewers: reviewEff === 'none' ? [] : ['code-reviewer', ...(reviewEff === 'full' ? floor.agents : [])],
  }

  // ── notes: honesty records + the standing decision-2b residual-judgment note + closure/e2e/foreign ──
  const notes = [
    ...testScope.notes,
    ...reviewScope.notes,
    'reviewScope: the "adds no new governed surface / contract / ledger event kind" light-exclusion is plan-time judgment (review-phase Mode A), not machine-decided (pre-made decision 2b)',
  ]
  if (cell.closureItest) notes.push('hardening closure integration test required — never defers (both modes)')
  if (cell.e2e === 'deferred') notes.push('e2e defers to the arc end (do-arc Step 8)')
  if (foreign.length > 0)
    notes.push(`foreignCommitsInRange: scope/floor bind to the phase-own file set; ${foreign.length} foreign file(s) in base..HEAD are excluded`)

  const refused = !!(testScope.refused || reviewScope.refused || slots.some((s) => s.refused))

  // Execution band — the same classifyBand `arc next` emits, echoed here so `gate plan`
  // is a COMPLETE decision table (the workflow surfaces banding to the user at plan time).
  const band = classifyBand(phase, opts.cfg)

  const plan = {
    phase: phaseNum,
    kind,
    mode,
    band: band.band,
    bandReason: band.reason,
    baseSha: base,
    diff: {
      files: ownFiles.length,
      classes: [...new Set(ownFiles.map(classOf))],
      specialistPaths: floor.paths,
    },
    testScope: pickScope(testScope),
    reviewScope: pickScope(reviewScope),
    slots,
    agents,
    designParity: designParity(phase),
    ...(foreign.length > 0 ? { foreignCommitsInRange: foreign } : {}),
    notes,
  }
  return { plan, refused }
}

function pickScope(s) {
  const out = { derived: s.derived, declared: s.declared, effective: s.effective }
  if (s.floorReason) out.floorReason = s.floorReason
  if (s.refused) out.refused = s.refused
  return out
}

function parseArgs(argv) {
  const opts = {}
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--base') opts.base = argv[++i]
    else if (a === '--mode') opts.mode = argv[++i]
    else if (a === '--sequence-member') opts.sequenceMember = true
    else if (a === '--json') opts.json = true
    else if (a === '--slots') opts.slots = argv[++i]
    else if (a === '--record-round') opts.recordRound = argv[++i]
    else if (a === '--verify-complete') opts.verifyComplete = true
    else if (!a.startsWith('--')) positional.push(a)
  }
  return { opts, positional }
}

/** Dispatch: `gate plan <phase>` | `gate run <phase>` (run lands in 1656.5). */
export default async function run(argv) {
  const sub = argv[0]
  if (sub === '--help' || sub === '-h' || !sub) {
    process.stdout.write('roadmap gate plan <phase> [--base <sha>] [--mode inline|arc] [--sequence-member] [--json]\n')
    process.stdout.write('roadmap gate run  <phase> [--base <sha>] [--slots a,b] [--record-round <json>] [--verify-complete] [--json]\n')
    return sub ? 0 : 1
  }
  const { opts, positional } = parseArgs(argv.slice(1))
  const phaseNum = Number(positional[0])
  if (!Number.isFinite(phaseNum)) {
    process.stderr.write(`roadmap gate ${sub}: a numeric <phase> is required\n`)
    return 1
  }

  if (sub === 'plan') {
    let built
    try {
      const { loadConfig } = await import('../lib/config.mjs')
      const cfg = loadConfig(process.cwd())
      built = buildPlan(process.cwd(), phaseNum, { ...opts, cfg })
    } catch (e) {
      if (e instanceof GateError) {
        for (const l of e.lines) process.stderr.write(l + '\n')
        return e.code
      }
      if (e?.name === 'ConfigError') {
        for (const l of e.messageLines) process.stderr.write(l + '\n')
        return 1
      }
      throw e
    }
    process.stdout.write(JSON.stringify(built.plan, null, opts.json ? 0 : 2) + '\n')
    return built.refused ? 2 : 0
  }

  if (sub === 'run') return runGate(phaseNum, opts)

  process.stderr.write(`roadmap gate: unknown subcommand '${sub}' (plan | run)\n`)
  return 1
}

/**
 * gate run <phase> — three modes:
 *   --record-round '<json>'  append an agent round to the latest report (exit 2 malformed)
 *   --verify-complete        phase-file ↔ latest-report consistency (exit 1 no report, 2 problems)
 *   (default)                execute the mechanical slots, persist the GateRunReport (exit 2 any red)
 */
export async function runGate(phaseNum, opts) {
  let toplevel, cfg
  try {
    toplevel = gitToplevel(process.cwd())
    const { loadConfig } = await import('../lib/config.mjs')
    cfg = loadConfig(process.cwd())
  } catch (e) {
    if (e?.name === 'ConfigError') {
      for (const l of e.messageLines) process.stderr.write(l + '\n')
      return 1
    }
    process.stderr.write(`roadmap gate run: ${e.message}\n`)
    return 1
  }

  // ── --record-round: append to the latest report ──
  if (opts.recordRound != null) {
    let input
    try {
      input = JSON.parse(opts.recordRound)
    } catch (e) {
      process.stderr.write(`gate run --record-round: input is not valid JSON: ${e.message}\n`)
      return 2
    }
    const check = AgentRoundInputShape.safeParse(input)
    if (!check.success) {
      for (const iss of check.error.issues)
        process.stderr.write(`gate run --record-round: ${iss.path.join('.') || '(root)'}: ${iss.message}\n`)
      return 2
    }
    try {
      appendAgentRound(toplevel, phaseNum, check.data)
    } catch (e) {
      process.stderr.write(`gate run --record-round: ${e.message}\n`)
      return 2
    }
    process.stdout.write(`recorded round ${check.data.round} (${check.data.agent}: ${check.data.verdict})\n`)
    return 0
  }

  // ── --verify-complete: phase ↔ report consistency ──
  if (opts.verifyComplete) {
    if (!existsSync(gateDir(toplevel, phaseNum))) {
      process.stderr.write(
        `gate run --verify-complete: no roadmap/.gate/${phaseNum}/ — a verify-complete requires the code gate to have run (roadmap gate run ${phaseNum})\n`,
      )
      return 1
    }
    const phaseFile = join(toplevel, 'roadmap', 'phases', `phase-${phaseNum}.phase.ts`)
    const imp = bridgeImport(phaseFile, { consumerRoot: toplevel })
    if (!imp.ok) {
      if (imp.kind === 'tsx-absent') process.stderr.write(TSX_ABSENT_HINT + '\n')
      else process.stderr.write(`gate run --verify-complete: cannot read ${phaseFile}: ${imp.stderr || imp.kind}\n`)
      return 1
    }
    const latest = latestReport(toplevel, phaseNum)
    if (!latest) {
      process.stderr.write(`gate run --verify-complete: no readable report under roadmap/.gate/${phaseNum}/\n`)
      return 1
    }
    // MECHRATCHET rank 9 — recompute the untested-gate-fix warnings over the FULL phase range
    // (the moment all fix commits exist) and print them BEFORE the verdict. WARN ONLY: the exit
    // code is decided by consistency alone (0 consistent / 2 problems), warnings notwithstanding.
    let warnBase = null
    try { warnBase = deriveBaseSha(toplevel, phaseNum) } catch { /* no move-to-in-progress commit ⇒ no warnings */ }
    if (warnBase) for (const w of untestedGateFixFindings(toplevel, phaseNum, warnBase)) process.stdout.write(`warning: ${w}\n`)
    const result = checkPhaseConsistency(imp.parsed, latest.report)
    if (!result.ok) {
      process.stderr.write(`gate run --verify-complete: phase ${phaseNum} inconsistent with ${latest.path}:\n`)
      for (const p of result.problems) process.stderr.write(`  - ${p}\n`)
      return 2
    }
    process.stdout.write(`phase ${phaseNum} consistent with the latest green gate report\n`)
    return 0
  }

  // ── default: execute the mechanical half + persist the report ──
  let built
  try {
    built = buildPlan(process.cwd(), phaseNum, { ...opts, cfg })
  } catch (e) {
    if (e instanceof GateError) {
      for (const l of e.lines) process.stderr.write(l + '\n')
      return e.code
    }
    throw e
  }
  if (built.refused) {
    process.stdout.write(JSON.stringify(built.plan, null, 2) + '\n')
    process.stderr.write('gate run: the plan is refused (a floor violation) — no slot ran\n')
    return 2
  }
  const plan = built.plan
  // --slots matches the RESOLVED slot name, its base tier ('unit' matches 'unit-scoped' —
  // the ladder resolves scoped names the caller can't predict), or 'preReview'. A wanted
  // name matching NOTHING is exit 2, never a silent zero-slot green run.
  const wanted = opts.slots ? new Set(opts.slots.split(',').map((s) => s.trim())) : null
  const slotMatches = (resolved) => {
    if (!wanted) return true
    if (wanted.has(resolved)) return true
    const base = resolved.replace(/-(scoped|impacted)$/, '')
    return base !== resolved && wanted.has(base)
  }
  if (wanted) {
    const matchable = new Set(plan.slots.map((s) => s.slot).flatMap((n) => [n, n.replace(/-(scoped|impacted)$/, '')]))
    if (cfg.exec?.preReview) matchable.add('preReview')
    const unmatched = [...wanted].filter((w) => !matchable.has(w))
    if (unmatched.length > 0) {
      process.stderr.write(`gate run: --slots name(s) match no plan slot: ${unmatched.join(', ')} (plan has: ${plan.slots.map((s) => s.slot).join(', ')})\n`)
      return 2
    }
  }
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const logsDir = join(gateDir(toplevel, phaseNum), 'logs')

  const rows = []
  let green = true
  for (const s of plan.slots) {
    if (!slotMatches(s.slot)) continue
    if (s.declaredAbsent) {
      rows.push({ slot: s.slot, command: '(declared none)', exitCode: 0, durationMs: 0, logPath: null, declaredAbsent: true })
      continue
    }
    if (s.refused || !s.command) continue // buildPlan.refused already gated true refusals
    const logPath = join(logsDir, `${s.slot}-${ts}.log`)
    const res = await runSlot({ slot: s.slot, command: s.command, note: s.note }, { cwd: toplevel, logPath })
    rows.push({
      slot: res.slot,
      command: res.command,
      ...(s.files ? { files: s.files } : {}),
      exitCode: res.exitCode,
      durationMs: res.durationMs,
      logPath: res.logPath,
      ...(res.note ? { note: res.note } : {}),
    })
    if (res.exitCode !== 0) green = false
  }

  // exec.preReview — ONE extra recorded slot AFTER the mechanical slots, BEFORE the agent
  // rounds. Absent key ⇒ skipped silently (today's rule).
  if (cfg.exec?.preReview && (!wanted || wanted.has('preReview'))) {
    const logPath = join(logsDir, `preReview-${ts}.log`)
    const command = `${cfg.exec.preReview} ${plan.baseSha}`
    const res = await runSlot({ slot: 'preReview', command }, { cwd: toplevel, logPath })
    rows.push({ slot: 'preReview', command, exitCode: res.exitCode, durationMs: res.durationMs, logPath: res.logPath })
    if (res.exitCode !== 0) green = false
  }

  const report = {
    phase: phaseNum,
    startedAt: new Date().toISOString(),
    baseSha: plan.baseSha,
    mode: plan.mode,
    kind: plan.kind,
    testScope: { derived: plan.testScope.derived, declared: plan.testScope.declared ?? null, effective: plan.testScope.effective },
    reviewScope: { derived: plan.reviewScope.derived, declared: plan.reviewScope.declared ?? null, effective: plan.reviewScope.effective },
    slots: rows,
    agents: [],
    green,
    notes: [...plan.notes, ...untestedGateFixFindings(toplevel, phaseNum, plan.baseSha)],
  }
  let written
  try {
    written = writeReport(toplevel, report)
  } catch (e) {
    process.stderr.write(`gate run: failed to write report: ${e.message}\n`)
    return 1
  }

  if (opts.json) process.stdout.write(JSON.stringify(written.report) + '\n')
  else {
    process.stdout.write(`\ngate run phase ${phaseNum} — ${green ? 'GREEN' : 'RED'} (${written.path})\n`)
    for (const r of rows)
      process.stdout.write(`  ${r.slot.padEnd(20)} ${r.declaredAbsent ? 'declared-none' : `exit ${r.exitCode} (${r.durationMs}ms)`}${r.note ? ` — ${r.note}` : ''}\n`)
  }
  return green ? 0 : 2
}
