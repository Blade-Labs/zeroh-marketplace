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
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gitToplevel, mainCheckout } from '../lib/gitroot.mjs'
import { findClosedJournal, findJournal, JournalUnreadableError } from '../lib/codex-journal.mjs'
import { derivePhaseStartSha, GitScanError, phaseOwnPatterns, SUBJECT_GRAMMAR } from '../lib/gitscan.mjs'
import { productRepos } from '../lib/product-repos.mjs'
import { bridgeImport, bridgeParseShape, consumerSchemaPath, TSX_ABSENT_HINT } from '../lib/tsx-bridge.mjs'
import {
  assembleConsumerFingerprint,
  assemblePhaseEvalRecord,
  phaseEvalRecordPath,
  CORRECTNESS_ROUND_CAP,
} from '../lib/eval-collect.mjs'
import {
  gateCell,
  specialistFloor,
  deriveTestScope,
  deriveReviewScope,
  classifyBand,
  EXECUTABLE_EXTS,
  isTestFile,
} from '../lib/ladder.mjs'
import { resolveSlot, resolveScopedOrFallback, resolveAffectedOrFallback, createScopeManifest, runSlot, resolveHygieneSlots, resolveConditionalSlots, historyCommentFindings, probeScopedSlot } from '../lib/slots.mjs'
import {
  writeReport,
  latestReport,
  appendAgentRound,
  checkPhaseConsistency,
  gateDir,
  AgentRoundInputShape,
  GateReportUnreadableError,
} from '../lib/gate-report.mjs'
import { roadmapRoot, roadmapRootRel } from '../lib/roadmap-root.mjs'

/**
 * Leave the per-phase eval record beside the gate's own artifacts — the measurement pipe's
 * inlet (arc POLYSEAT plane 1). Called at BOTH completions where slot results exist: the
 * execute path (which captures plannedBy) and --verify-complete (the refresh that captures
 * executionResult.driver and metrics, neither of which exists yet at execute time). A
 * --slots-FILTERED execute run does not call this: its `green` covers the filtered rows only,
 * so recording it would degrade the sample on every routine per-task run (gate R1, phase 1).
 * Latest-run-wins: one file per phase, history lives in git if the consumer commits it.
 *
 * NEVER THROWS AND NEVER CHANGES AN EXIT CODE. Every failure mode — no consumer schema, no
 * tsx, an unwritable directory, a shape refusal — prints one loud stderr line and returns
 * null. Measurement that can fail a gate is measurement that gets deleted the first time it
 * blocks a release; the gate's verdict belongs to the slots alone.
 *
 * `date` comes from the run report's own `startedAt`, never a fresh clock read: the record
 * dates the RUN it describes, which is a fact already on disk.
 */
export function emitPhaseEvalRecord(toplevel, phaseNum, { parsed, report, findingsRecorded = false }) {
  const path = phaseEvalRecordPath(toplevel, phaseNum)
  try {
    const schemaPath = consumerSchemaPath(toplevel)
    const { record, warnings } = assemblePhaseEvalRecord({
      phase: phaseNum,
      parsed,
      green: report.green,
      slots: report.slots,
      agents: report.agents,
      report,
      findingsRecorded,
      // A linked codex worktree is the SAME repository as the checkout it was cut from, so its
      // identity comes from the primary checkout; the corpus facts still come from `toplevel`.
      // Placement is unaffected — the record lands beside this checkout's own gate artifacts.
      fingerprint: assembleConsumerFingerprint(toplevel, { identityRoot: mainCheckout(toplevel) }),
      date: String(report.startedAt).slice(0, 10),
    })
    // Printed BEFORE validation: an ambiguous role binding is a true fact about the phase even
    // on a run whose shape check then refuses, and it would be lost in the catch below.
    for (const w of warnings) process.stderr.write(`gate run: ${w} — the gate verdict is unaffected\n`)
    const validated = bridgeParseShape(toplevel, schemaPath, 'PhaseEvalRecordShape', record)
    if (!validated.ok) {
      const { res } = validated
      const detail =
        res.kind === 'zod'
          ? res.issues.map((i) => `${(i.path ?? []).join('.') || '(root)'}: ${i.message}`).join('; ')
          : (res.stderr || '').trim() || res.kind
      throw new Error(`${res.kind}: ${detail}`)
    }
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(validated.parsed, null, 2) + '\n')
    return path
  } catch (e) {
    // Names the ARTIFACT, not just the phase: the reader's next question is always "where
    // was it supposed to land", and a diagnostic that omits the path costs a grep.
    process.stderr.write(
      `gate run: the per-phase eval record ${path} was NOT written (${e.message}) — the gate ` +
        `verdict is unaffected, but the eval scorecard gets no sample for phase ${phaseNum}\n`,
    )
    return null
  }
}

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
const isExecutable = (p) => EXECUTABLE_EXTS.some((e) => p.endsWith(e))

/**
 * baseSha = the two-tier derivation over the commits phaseOwnPatterns(N) reads as this
 * phase's own — parent (^) of the NEWEST move-to-in-progress commit, else of the OLDEST
 * own match. --base overrides. Thin wrapper over the shared gitscan.derivePhaseStartSha
 * (pre-made decision 3: ONE ownership rule; derive.mjs's resume.startSha uses the same
 * helper) — this wrapper only maps the typed GitScanError onto gate's exit-code contract
 * (no-match ⇒ GateError(1) naming the expected move-to-in-progress commit form).
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

/** Files touched by the PHASE's OWN commits over base..HEAD (phaseOwnPatterns), unique. */
function phaseOwnFiles(cwd, phaseNum, base) {
  const own = phaseOwnPatterns(phaseNum)
  let out
  try {
    out = git(cwd, [
      'log',
      '-E',
      `--grep=${own.ere}`,
      '--name-only',
      '--format=%H%x09%s',
      `${base}..HEAD`,
    ])
  } catch {
    return []
  }
  const files = new Set()
  let include = false
  for (const line of out.split('\n')) {
    const tab = line.indexOf('\t')
    // Width-agnostic: %H is 40 hex under SHA-1 and 64 under SHA-256, and a hardcoded 40 drops
    // EVERY header row in a sha256 repo — the phase-own set then silently empties and scope
    // under-derives with nothing surfacing it.
    if (/^[0-9a-f]{40,64}\t/.test(line)) {
      include = own.test(line.slice(tab + 1))
    } else if (include && line.trim()) {
      files.add(line.trim())
    }
  }
  return [...files]
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

/** WARN when a tolerated legacy subject deviates from the canonical write grammar. */
export function deviantGrammarFindings(cwd, phaseNum, base) {
  let log
  try {
    log = git(cwd, ['log', '--format=%H%x09%s', `${base}..HEAD`])
  } catch {
    return []
  }
  const P = String(phaseNum)
  const own = phaseOwnPatterns(P)
  const { dash, type, typePrefix } = SUBJECT_GRAMMAR
  const offDash = '(–|-)' // every dash the read tolerates EXCEPT the canonical em dash
  const checks = [
    { name: 'D1 phase N task N.X', re: new RegExp(`^${typePrefix}phase ${P} task ${P}\\.[0-9]+ ${dash}`) },
    { name: 'D2 scope-carried (phase-N)', re: new RegExp(`^${type}\\(phase-${P}\\):`) },
    {
      name: 'D4 noncanonical dash',
      re: new RegExp(`^${typePrefix}phase ${P} (${offDash}|task ${P}\\.[0-9]+ ${offDash}|task ${P}\\.[0-9]+ \\([0-9]+/[0-9]+\\) ${offDash}|${P}\\.[0-9]+ ${offDash}|gate R[0-9]+ ${offDash})`),
    },
    { name: 'D5 phase N N.X', re: new RegExp(`^${typePrefix}phase ${P} ${P}\\.[0-9]+ ${dash}`) },
  ]
  const findings = []
  for (const line of log.split('\n').filter(Boolean)) {
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const sha = line.slice(0, tab)
    const subject = line.slice(tab + 1)
    if (!own.test(subject)) continue
    const classes = checks.filter(({ re }) => re.test(subject)).map(({ name }) => name)
    if (classes.length === 0) continue
    findings.push(
      `attribution-breaking commit grammar (${classes.join(' + ')}): ${sha.slice(0, 7)} "${subject}" — use "type(scope): phase N — <imperative summary>"`,
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
  if (r.skipped != null) out.skipped = r.skipped
  return out
}

/**
 * Build the resolved gate plan for `phaseNum`. Impure (git + fs + tsx bridge); returns
 * the plan object + a `refused` flag the caller maps to exit 2. Throws GateError(1) on
 * a usage/toolchain problem (missing phase file, tsx absent in this strict context).
 */
export function buildPlan(cwd, phaseNum, opts = {}) {
  const toplevel = gitToplevel(cwd)
  const mode = opts.mode ?? (existsSync(join(roadmapRoot(toplevel), '.arc-mode')) ? 'arc' : 'inline')

  const phaseFile = join(roadmapRoot(toplevel), 'phases', `phase-${phaseNum}.phase.ts`)
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
  const foreignProductRepos = productRepos(phase?.keyFiles, { worktree: toplevel, maxRepos: Infinity })
  if (foreignProductRepos.length > 0) {
    reviewScope.derived = 'full'
    reviewScope.effective = 'full'
    reviewScope.notes = [] // the rung-below-full honesty notes ("Round 0 skipped") are false at the floor
    if (reviewScope.declared && reviewScope.declared !== 'full') {
      const crossRepoRefusal =
        `reviewScope '${reviewScope.declared}' declared but product repositories ${foreignProductRepos.join(', ')} ` +
        'make the local diff structurally blind — cross-repo floor: full'
      reviewScope.refused = reviewScope.refused
        ? `${reviewScope.refused}; ${crossRepoRefusal}`
        : crossRepoRefusal
    }
  }

  // ── slots — the non-test frame from the cell + test slots per effective testScope ──
  const cell = gateCell(kind, mode, opts.cfg)
  const nonTest = cell.slots.filter((s) => s !== 'unit' && s !== 'integration')
  const wantsTests = cell.slots.includes('unit') || cell.slots.includes('integration') || cell.scopedTests ||
    (testScope.effective !== 'static' && testScope.effective !== 'full')
  const slots = []
  for (const s of nonTest) slots.push(compactSlot(resolveSlot(opts.cfg, s)))
  // Per-phase hygiene (1792.1): the diff-scoped consumer lint, {base}-substituted; an unbound
  // consumer renders the NAMED skip in the plan — visible, never a silent hole.
  // Only files that still EXIST can be linted — a phase that deleted a file still carries it in
  // its own-file set, and handing a linter a missing path is an error, not a finding.
  const livingOwnFiles = ownFiles.filter((f) => existsSync(join(toplevel, f)))
  for (const h of resolveHygieneSlots(opts.cfg, base, livingOwnFiles)) {
    const compact = compactSlot(h)
    if (h.files != null) compact.files = h.files
    slots.push(compact)
  }
  // Conditional slots (1792.2): diff-triggered consumer slots, each carrying WHY it joined.
  for (const c of resolveConditionalSlots(opts.cfg, ownFiles)) {
    const compact = compactSlot(c)
    if (c.reason != null) compact.reason = c.reason
    slots.push(compact)
  }
  const testFiles = selectTestFiles(toplevel, ownFiles)
  const hasUncoveredSource = livingOwnFiles.some((file) => {
    if (!isExecutable(file) || isTestFile(file)) return false
    const stem = file.replace(/\.[^./]+$/, '')
    return !COLOCATED_TEST_EXTS.some((ext) => existsSync(join(toplevel, stem + ext)))
  })
  const hasDeletedExecutable = ownFiles.some((file) => isExecutable(file) && !existsSync(join(toplevel, file)))
  const emptyScopeSkip = []
  if (wantsTests && testScope.effective !== 'static' && !testScope.refused) {
    if (testScope.effective === 'full') {
      slots.push(compactSlot(resolveSlot(opts.cfg, 'unit')))
      slots.push(compactSlot(resolveSlot(opts.cfg, 'integration')))
    } else if (hasDeletedExecutable) {
      slots.push(compactSlot(resolveSlot(opts.cfg, 'unit')))
      slots.push(compactSlot(resolveSlot(opts.cfg, 'integration')))
    } else if (testFiles.length > 0 && !hasUncoveredSource) {
      const manifest = createScopeManifest(toplevel, testFiles)
      for (const tier of ['unit', 'integration']) {
        const template = opts.cfg?.gateCommands?.[`${tier}-scoped`]
        const resolved = manifest && template?.includes('{manifest}')
          ? resolveSlot(opts.cfg, `${tier}-scoped`, { manifest: manifest.token })
          : resolveScopedOrFallback(opts.cfg, tier, testFiles)
        slots.push(compactSlot({ ...resolved, files: testFiles }))
      }
    } else if (livingOwnFiles.some(isExecutable) || (ownFiles.length > 0 && livingOwnFiles.length === 0)) {
      const manifest = createScopeManifest(toplevel, livingOwnFiles)
      if (manifest) {
        slots.push(compactSlot({ ...resolveAffectedOrFallback(opts.cfg, 'unit', manifest.token), files: livingOwnFiles }))
        slots.push(compactSlot({ ...resolveAffectedOrFallback(opts.cfg, 'integration', manifest.token), files: livingOwnFiles }))
      } else {
        slots.push(compactSlot(resolveSlot(opts.cfg, 'unit')))
        slots.push(compactSlot(resolveSlot(opts.cfg, 'integration')))
      }
    } else {
      // An EMPTY scoped selection is a skip, not a refusal: running a scoped tier with no
      // files exits 2 and paints the whole gate RED over nothing (the 1737 gate run-000001
      // incident — a consumer-side docs/roadmap diff whose tests all live out-of-repo).
      emptyScopeSkip.push('scoped test slots skipped — no test files in the phase-own set (an empty scope is a skip, never a refusal)')
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
    ...emptyScopeSkip,
    'reviewScope: the "adds no new governed surface / contract / ledger event kind" light-exclusion is plan-time judgment (review-phase Mode A), not machine-decided (pre-made decision 2b)',
    // Unconditional: guards get authored under any kind, so keying this to kind/reviewScope would
    // drop the obligation exactly where it is least expected. A no-op row for a phase authoring none.
    'a NEW guard (ratchet/tripwire/scan assertion) must carry its quoted mutation proof — planted violation RED, anchor drift loud, decoy GREEN — in the task transparencyReport before review (skills/do-phase/references/guard-mutation-proof.md)',
  ]
  if (cell.closureItest) notes.push('hardening closure integration test required — never defers (both modes)')
  if (cell.e2e === 'deferred') notes.push('e2e defers to the arc end (do-arc Step 8)')
  if (foreignProductRepos.length > 0)
    notes.push(
      `cross-repo: derivation is structurally blind to ${foreignProductRepos.join(', ')} — reviewScope floored to full; ` +
        'mechanical slots run against THIS repo only, the product diff is reviewed from the foreign checkout',
    )
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
    ...(foreignProductRepos.length > 0 ? { productRepos: foreignProductRepos } : {}),
    designParity: designParity(phase),
    ...(foreign.length > 0 ? { foreignCommitsInRange: foreign } : {}),
    notes,
  }
  // `parsed` rides back beside the plan because the caller needs the phase's OWN fields
  // (plannedBy, executionResult, metrics, tasks, keyFiles) for the per-phase eval record, and
  // re-importing the file would pay the tsx bridge a second time for bytes already in hand.
  return { plan, refused, parsed: phase }
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
    else if (a === '--cap-override') opts.capOverride = argv[++i] ?? ''
    else if (a === '--verify-complete') opts.verifyComplete = true
    else if (!a.startsWith('--')) positional.push(a)
  }
  return { opts, positional }
}

/** Probe only the scoped templates selected by `gate plan`, caching by template while
 * retaining per-slot warnings. `gate run` never calls this helper. */
export async function annotateScopedProbeWarnings(built, cfg, cwd, { timeoutMs } = {}) {
  const probes = new Map()
  for (const slot of built.plan.slots) {
    const template = cfg?.gateCommands?.[slot.slot]
    if (typeof template !== 'string' || !template.includes('{files}')) continue
    if (!probes.has(template)) probes.set(template, probeScopedSlot(template, { cwd, timeoutMs }))
    const result = await probes.get(template)
    if (result.vacuous === true) {
      const warning = `${slot.slot} ${result.message}`
      built.plan.notes.push(warning)
      process.stderr.write(`warning: ${warning}\n`)
    } else if (result.vacuous === null) {
      built.plan.notes.push(`${slot.slot} scoped runner probe unanswerable — ${result.message}`)
    }
  }
}

/** Dispatch: `gate plan <phase>` | `gate run <phase>` | `gate round-brief <phase>`. */
export default async function run(argv) {
  const sub = argv[0]
  if (sub === '--help' || sub === '-h' || !sub) {
    process.stdout.write('roadmap gate plan <phase> [--base <sha>] [--mode inline|arc] [--sequence-member] [--json]\n')
    process.stdout.write('roadmap gate run  <phase> [--base <sha>] [--slots a,b] [--record-round <json>] [--cap-override <reason>] [--verify-complete] [--json]\n')
    process.stdout.write('roadmap gate round-brief <phase> [--json]\n')
    return sub ? 0 : 1
  }
  const { opts, positional } = parseArgs(argv.slice(1))
  const phaseNum = Number(positional[0])
  if (!Number.isFinite(phaseNum)) {
    process.stderr.write(`roadmap gate ${sub}: a numeric <phase> is required\n`)
    return 1
  }

  // --slots filters the slots buildPlan is about to EXECUTE. Both modes below return before
  // buildPlan is ever reached, so the flag cannot narrow anything there — accepting it hands
  // back a full-scope action to an operator who asked for a subset. Refused at the dispatch
  // boundary, before any report is read or written, and scoped to `run`: neither mode exists
  // under another subcommand, so firing there would lecture about flags the command ignores
  // and shadow the diagnostic that subcommand actually owes.
  const unfilterable = opts.recordRound != null ? '--record-round' : opts.verifyComplete ? '--verify-complete' : null
  if (sub === 'run' && opts.slots && unfilterable) {
    process.stderr.write(
      `roadmap gate ${sub}: --slots ${opts.slots} cannot be combined with ${unfilterable} — ${unfilterable} reads and `
        + 'writes the existing report and never executes slots, so there is nothing for --slots to filter. Drop --slots, '
        + `or run \`roadmap gate run ${phaseNum} --slots ${opts.slots}\` on its own to execute that subset.\n`,
    )
    return 1
  }

  if (sub === 'plan') {
    let built
    try {
      const { loadConfig } = await import('../lib/config.mjs')
      const cfg = loadConfig(process.cwd())
      built = buildPlan(process.cwd(), phaseNum, { ...opts, cfg })
      await annotateScopedProbeWarnings(built, cfg, gitToplevel(process.cwd()))
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

  if (sub === 'round-brief') {
    let latest
    try {
      latest = latestReport(gitToplevel(process.cwd()), phaseNum)
    } catch (e) {
      process.stderr.write(`roadmap gate round-brief: ${e.message}\n`)
      return 1
    }
    if (!latest) {
      process.stderr.write(`roadmap gate round-brief: no gate report exists for phase ${phaseNum}\n`)
      return 1
    }
    const correctnessRounds = latest.report.agents.filter((round) => round.round >= 1)
    const last = correctnessRounds.at(-1)
    if (!last) {
      process.stderr.write(`roadmap gate round-brief: phase ${phaseNum} has no recorded correctness round\n`)
      return 1
    }
    const blocking = last.findings.some((finding) => finding.severity === 'CRITICAL' || finding.severity === 'HIGH')
    const legacyUnknown = last.verdict === 'findings-fixed' && last.findings.length === 0
    const rule = correctnessRounds.length >= CORRECTNESS_ROUND_CAP || last.round >= CORRECTNESS_ROUND_CAP
      ? 'cap'
      : last.verdict === 'clean'
        ? 'clean'
        : blocking || legacyUnknown
          ? 'continue'
          : 'close'
    const brief = {
      nextRound: last.round + 1,
      rule,
      sinceSha: last.sha ?? null,
      priorFindings: last.findings,
    }
    process.stdout.write(opts.json ? `${JSON.stringify(brief)}\n` : `${rule}\n`)
    return 0
  }

  process.stderr.write(`roadmap gate: unknown subcommand '${sub}' (plan | run | round-brief)\n`)
  return 1
}

/**
 * Reconcile the landed phase file's self-reported driver against the LAUNCHER's journal.
 *
 * The journal is launcher truth (it records the driver the registry pinned on the argv); the
 * phase file is model self-report. A disagreement means one of them lies, so it is an ERROR
 * naming both — unlike the absent-driver WARNING, which covers inline sessions with no
 * launcher to ask.
 *
 * Journals live under the PRIMARY checkout's .building/ while verify-complete runs INSIDE the
 * codex worktree, so the lookup is rooted at mainCheckout — gitToplevel alone never sees them.
 * No journal at all = an inline session = no check; a journal that EXISTS and will not parse is
 * a PROBLEM, never an absence — silently skipping it would disarm this seam on a corrupt file.
 *
 * A journal whose driver.model is null pins no model, so the model is announced UNRECONCILED
 * rather than silently skipped; its lane is still reconciled. Returns { problems, notes } —
 * `notes` are announcements that are not failures, and the CALLER writes both.
 */
function driverReconcile(cwd, fallbackRoot, phaseNum, parsed) {
  let root
  try {
    root = mainCheckout(cwd)
  } catch {
    root = fallbackRoot
  }
  let found
  const worktree = cwd === root ? undefined : cwd
  try {
    found = findJournal(root, [phaseNum], 'run', { worktree })
  } catch (e) {
    if (!(e instanceof JournalUnreadableError)) throw e
    // An unreadable journal is not an absent one: passing it as "inline session" would drop the
    // reconcile without a word, which is exactly the silence this seam exists to remove.
    return { problems: [`phase ${phaseNum} attribution could NOT be reconciled: ${e.message}`], notes: [] }
  }
  // A LANDED lane's journal was renamed `.closed.json` by the land verb, which the live scan
  // class deliberately excludes — but it is still the launcher's record, and dropping the
  // reconcile for it would mean every gate re-run after a delegated phase lands stops checking
  // the phase file's claim, silently, exactly where the claim is least likely to be self-checked.
  try {
    if (!found) found = findClosedJournal(root, [phaseNum], 'run', { strict: true, worktree })
  } catch (e) {
    if (!(e instanceof JournalUnreadableError)) throw e
    return { problems: [`phase ${phaseNum} attribution could NOT be reconciled: ${e.message}`], notes: [] }
  }
  if (!found) return {
    problems: [],
    notes: worktree ? [`phase ${phaseNum} driver UNRECONCILED — no run journal names worktree ${worktree}; treating it as an inline session`] : [],
  }
  const j = found.journal.driver
  if (!j) return { problems: [], notes: [] }
  const where = `${found.path} (startedAt ${found.journal.startedAt ?? 'unrecorded'})`
  const claimed = parsed.executionResult?.driver
  if (!claimed) {
    return {
      problems: [
        `phase ${phaseNum} was launched by the ${j.lane} lane but its executionResult.driver is ABSENT — `
          + `the launcher journalled { model: ${JSON.stringify(j.model)}, lane: ${JSON.stringify(j.lane)} } in ${where}. `
          + 'A run the launcher recorded cannot land unattributed: record that driver in executionResult. '
          + `If that lane run was ABANDONED, the journal is stale — delete ${found.path} (nothing prunes journals).`,
      ],
      notes: [],
    }
  }
  const problems = []
  if (j.model != null && claimed.model !== j.model) {
    problems.push(
      `phase ${phaseNum} driver.model disagrees with the launcher: journal says ${JSON.stringify(j.model)}, `
        + `the phase file claims ${JSON.stringify(claimed.model)} (journal ${where}). `
        + 'The journal is what was launched; the file is self-report — one of them is wrong. '
        + 'If that lane run was ABANDONED and this phase was completed some other way, the journal is stale: '
        + `delete ${found.path} (nothing prunes journals) and re-run --verify-complete.`,
    )
  }
  if (claimed.lane !== j.lane) {
    problems.push(
      `phase ${phaseNum} driver.lane disagrees with the launcher: journal says ${JSON.stringify(j.lane)}, `
        + `the phase file claims ${JSON.stringify(claimed.lane)} (journal ${where}). `
        + 'If that lane run was ABANDONED and this phase was completed some other way, the journal is stale: '
        + `delete ${found.path} (nothing prunes journals) and re-run --verify-complete.`,
    )
  }
  const notes = j.model == null
    ? [
        `gate run --verify-complete: lane '${j.lane}' declares no pinned model in cli/lib/drivers.mjs — `
          + `driver.model is self-report only, UNRECONCILED (journal ${where})`,
      ]
    : []
  return { problems, notes }
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
    if (opts.capOverride != null && (!opts.capOverride.trim() || opts.capOverride.startsWith('--'))) {
      process.stderr.write('gate run --record-round: --cap-override requires a non-empty reason\n')
      return 2
    }
    if (check.data.round > CORRECTNESS_ROUND_CAP && !opts.capOverride) {
      process.stderr.write(`gate run --record-round: correctness round cap is ${CORRECTNESS_ROUND_CAP}; pass --cap-override "<reason>" to record round ${check.data.round}\n`)
      return 2
    }
    try {
      // The same rule the --verify-complete refresh already applies: a --slots report covers
      // that subset alone. A round recorded there is not a round about the PHASE — and since
      // summarizeGateRuns skips filtered reports outright, it reaches the eval as nothing at
      // all. The same-invocation form is refused at dispatch; this is the sequential form the
      // per-task ritual actually produces.
      const latest = latestReport(toplevel, phaseNum)
      if (latest?.report.slotFilter) {
        process.stderr.write(
          `gate run --record-round: the latest report ${latest.path} is a --slots ${latest.report.slotFilter} run, so it `
            + 'covers that subset alone and is not evidence about the phase — a round recorded there is dropped by the eval. '
            + `Re-run the full gate (roadmap gate run ${phaseNum}) and record the round into that report.\n`,
        )
        return 2
      }
      appendAgentRound(toplevel, phaseNum, { ...check.data, ...(opts.capOverride ? { capOverride: opts.capOverride } : {}) })
    } catch (e) {
      // The CLASS is named as well as the message: "no report yet" and "the report on disk will
      // not read" send the reader to opposite remedies, and only one of them is a corruption.
      process.stderr.write(`gate run --record-round: ${e instanceof GateReportUnreadableError ? `${e.name}: ` : ''}${e.message}\n`)
      return 2
    }
    const counts = Object.fromEntries(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((severity) => [
      severity,
      check.data.findings.filter((finding) => finding.severity === severity).length,
    ]))
    process.stdout.write(
      `recorded round ${check.data.round} (${check.data.agent}: ${check.data.verdict}; C/H/M/L = `
        + `${counts.CRITICAL}/${counts.HIGH}/${counts.MEDIUM}/${counts.LOW})\n`,
    )
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
    const phaseFile = join(roadmapRoot(toplevel), 'phases', `phase-${phaseNum}.phase.ts`)
    const imp = bridgeImport(phaseFile, { consumerRoot: toplevel })
    if (!imp.ok) {
      if (imp.kind === 'tsx-absent') process.stderr.write(TSX_ABSENT_HINT + '\n')
      else process.stderr.write(`gate run --verify-complete: cannot read ${phaseFile}: ${imp.stderr || imp.kind}\n`)
      return 1
    }
    let latest
    try {
      latest = latestReport(toplevel, phaseNum)
    } catch (e) {
      if (!(e instanceof GateReportUnreadableError)) throw e
      process.stderr.write(`gate run --verify-complete: ${e.name}: ${e.message}\n`)
      return 1
    }
    if (!latest) {
      process.stderr.write(`gate run --verify-complete: no run report under roadmap/.gate/${phaseNum}/ (the directory exists but holds no run-<seq>-*.json)\n`)
      return 1
    }
    // MECHRATCHET rank 9 — recompute the untested-gate-fix warnings over the FULL phase range
    // (the moment all fix commits exist) and print them BEFORE the verdict. WARN ONLY: the exit
    // code is decided by consistency alone (0 consistent / 2 problems), warnings notwithstanding.
    let warnBase = null
    try { warnBase = deriveBaseSha(toplevel, phaseNum, { base: opts.base }) } catch { /* no move-to-in-progress commit ⇒ no warnings */ }
    if (warnBase) for (const w of untestedGateFixFindings(toplevel, phaseNum, warnBase)) process.stdout.write(`warning: ${w}\n`)
    if (warnBase) for (const w of deviantGrammarFindings(toplevel, phaseNum, warnBase)) process.stdout.write(`warning: ${w}\n`)
    // WARN ONLY, same lane as above: a done completion that never recorded who drove it lands
    // in the scorecard's unrecorded cohort — visible here, while the executor can still fix it.
    if (imp.parsed.status === 'done' && !imp.parsed.executionResult?.driver?.model)
      process.stdout.write(
        'warning: executionResult.driver absent: this completion will attribute to the unrecorded cohort in the eval scorecard (record { model, lane } in executionResult)\n',
      )
    // The REFRESH: by now the phase file carries executionResult.driver and metrics, which did
    // not exist when the execute path wrote this record. Emitted before the verdict returns so
    // an INCONSISTENT completion is sampled too — excluding it would quietly drop the runs
    // most worth measuring.
    // ...unless the latest report is a FILTERED run. latestReport() returns the newest run file
    // whatever produced it, so without this the routine per-task `--slots types` becomes a second
    // door onto the record: the refresh would overwrite a full sample with a subset projection,
    // and a green subset landing after a RED full run would rewrite the record to green.
    if (latest.report.slotFilter)
      process.stderr.write(
        `gate run --verify-complete: the latest report ${latest.path} is a --slots ` +
          `${latest.report.slotFilter} run, so the per-phase eval record ` +
          `${phaseEvalRecordPath(toplevel, phaseNum)} was NOT refreshed from it — a filtered run ` +
          `is not a sample; re-run the full gate\n`,
      )
    else emitPhaseEvalRecord(toplevel, phaseNum, {
      parsed: imp.parsed,
      report: latest.report,
      findingsRecorded: latest.findingsRecorded,
    })
    // Attribution is reconciled against the launcher BEFORE the consistency verdict, and both
    // report: a misattributed completion and an inconsistent one are separate failures, and
    // hiding one behind the other costs a round to discover.
    const { problems: misattributed, notes } = driverReconcile(process.cwd(), toplevel, phaseNum, imp.parsed)
    for (const n of notes) process.stderr.write(`${n}\n`)
    if (misattributed.length > 0) {
      process.stderr.write(`gate run --verify-complete: phase ${phaseNum} attribution disagrees with the lane journal:\n`)
      for (const p of misattributed) process.stderr.write(`  - ${p}\n`)
    }
    const result = checkPhaseConsistency(imp.parsed, latest.report)
    if (!result.ok) {
      process.stderr.write(`gate run --verify-complete: phase ${phaseNum} inconsistent with ${latest.path}:\n`)
      for (const p of result.problems) process.stderr.write(`  - ${p}\n`)
    }
    if (misattributed.length > 0 || !result.ok) return 2
    if (!latest.report.notes.some((note) => /verify-complete passed/i.test(note))) {
      latest.report.notes.push('gate run --verify-complete passed')
      writeFileSync(latest.path, JSON.stringify(latest.report, null, 2) + '\n')
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
    const base = resolved.replace(/-(scoped|affected|impacted)$/, '')
    return base !== resolved && wanted.has(base)
  }
  if (wanted) {
    const matchable = new Set(plan.slots.map((s) => s.slot).flatMap((n) => [n, n.replace(/-(scoped|affected|impacted)$/, '')]))
    if (cfg.exec?.preReview) matchable.add('preReview')
    matchable.add('history-comments')
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
    if (s.skipped) {
      rows.push({ slot: s.slot, command: `(skipped: ${s.skipped})`, exitCode: 0, durationMs: 0, logPath: null })
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

  // Plugin-native history-comment hygiene (1792.1 decision 2): scan the phase diff's ADDED
  // comment lines for phase-number/date/version narration — the front-runner of the consumer's
  // historyComment ratchet, at the commit that writes it instead of the release PR. Foreign
  // files in the range are excluded (the phase-own discipline).
  if (!wanted || wanted.has('history-comments')) {
    let findings = []
    let scanErr = null
    try {
      const diffText = execFileSync('git', ['-C', toplevel, 'diff', `${plan.baseSha}..HEAD`], {
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 64 * 1024 * 1024,
      })
      const foreign = new Set(plan.foreignCommitsInRange ?? [])
      findings = historyCommentFindings(diffText, roadmapRootRel(toplevel)).filter((f) => !foreign.has(f.file))
    } catch (e) {
      scanErr = e.message
    }
    const red = scanErr != null || findings.length > 0
    rows.push({
      slot: 'history-comments',
      command: `(plugin-native scan of ${plan.baseSha}..HEAD added comment lines)`,
      exitCode: red ? 2 : 0,
      durationMs: 0,
      logPath: null,
      ...(findings.length > 0 ? { findings: findings.map((f) => `${f.file}:${f.line} — "${f.match}"`) } : {}),
      ...(scanErr ? { note: `scan failed: ${scanErr}` } : {}),
    })
    if (red) {
      green = false
      if (scanErr) process.stderr.write(`history-comments: scan failed: ${scanErr}\n`)
      for (const f of findings)
        process.stderr.write(
          `history-comments: ${f.file}:${f.line} — comment narrates history ("${f.match}"); reword to the non-obvious WHY (this front-runs the codehealth historyComment ratchet)\n`,
        )
    }
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
    ...(wanted ? { slotFilter: opts.slots } : {}),
    notes: [
      ...plan.notes,
      ...untestedGateFixFindings(toplevel, phaseNum, plan.baseSha),
      ...deviantGrammarFindings(toplevel, phaseNum, plan.baseSha),
    ],
  }
  let written
  try {
    written = writeReport(toplevel, report)
  } catch (e) {
    process.stderr.write(`gate run: failed to write report: ${e.message}\n`)
    return 1
  }

  // A --slots run is a SUBSET projection, not a sample: `green` is computed over the filtered
  // rows alone, so writing it into the phase's latest-run-wins record would silently degrade
  // the durable measurement on every routine per-task `--slots types` run. Named, never silent.
  if (wanted) {
    // The verb branches on what is actually on disk: do-phase runs `--slots types` after task
    // 1, before any full run has written a record, so "left untouched" would name a file that
    // does not exist. A diagnostic that asserts a false fact is worse than none.
    const rec = phaseEvalRecordPath(toplevel, phaseNum)
    const verb = existsSync(rec) ? 'was left untouched' : 'has not been written yet'
    process.stderr.write(
      `gate run: --slots ${opts.slots} is a PARTIAL run, so the per-phase eval record ${rec} ` +
        `${verb} — a filtered run is not a sample; the next full gate run writes it\n`,
    )
  }
  else emitPhaseEvalRecord(toplevel, phaseNum, { parsed: built.parsed, report: written.report })

  if (opts.json) process.stdout.write(JSON.stringify(written.report) + '\n')
  else {
    process.stdout.write(`\ngate run phase ${phaseNum} — ${green ? 'GREEN' : 'RED'} (${written.path})\n`)
    for (const r of rows)
      process.stdout.write(`  ${r.slot.padEnd(20)} ${r.declaredAbsent ? 'declared-none' : `exit ${r.exitCode} (${r.durationMs}ms)`}${r.note ? ` — ${r.note}` : ''}\n`)
  }
  return green ? 0 : 2
}
