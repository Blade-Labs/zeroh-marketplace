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
import { bridgeImport, TSX_ABSENT_HINT } from '../lib/tsx-bridge.mjs'
import {
  gateCell,
  specialistFloor,
  deriveTestScope,
  deriveReviewScope,
  EXECUTABLE_EXTS,
} from '../lib/ladder.mjs'
import { resolveSlot, resolveScopedOrFallback } from '../lib/slots.mjs'

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
 * No match → GateError(1) naming the expected move-to-in-progress commit form. A root
 * commit with no parent falls back to itself.
 */
export function deriveBaseSha(cwd, phaseNum, { base } = {}) {
  if (base) {
    try {
      return git(cwd, ['rev-parse', base])
    } catch {
      return base
    }
  }
  const grep = `phase ${phaseNum} —` // em-dash boundary
  let out
  try {
    out = execFileSync('git', ['-C', cwd, 'log', '--reverse', `--grep=${grep}`, '--format=%H'], {
      timeout: 15_000,
      encoding: 'utf8',
    }).trim()
  } catch (e) {
    throw new GateError(1, [`gate: git log failed in ${cwd}: ${e.message}`])
  }
  const oldest = out.split('\n').filter(Boolean)[0]
  if (!oldest) {
    throw new GateError(1, [
      `gate plan: no commit matching "phase ${phaseNum} —" — expected the move-to-in-progress`,
      `commit (e.g. "plan(roadmap): phase ${phaseNum} — …" or "feat(scope): phase ${phaseNum} — …").`,
      'Pass --base <sha> to override.',
    ])
  }
  try {
    return git(cwd, ['rev-parse', `${oldest}^`])
  } catch {
    return oldest // root commit — no parent
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

/** A precomputed Set of exec paths that are a test or have a colocated sibling test on
 *  disk (the ONLY on-disk lookup — passed to ladder.mjs so it stays pure). */
function colocatedTestSet(toplevel, paths) {
  const set = new Set()
  const cands = ['.test.ts', '.test.tsx', '.test.js', '.test.mjs', '.test.cjs', '.itest.ts', '.itest.mjs', '.spec.ts']
  for (const p of paths) {
    if (isTestFile(p)) {
      set.add(p)
      continue
    }
    if (!isExecutable(p)) continue
    const stem = p.replace(/\.[^./]+$/, '')
    if (cands.some((ext) => existsSync(join(toplevel, stem + ext)))) set.add(p)
  }
  return set
}

/** The scoped test-file selection for a narrowed run: phase-own test files + existing
 *  colocated siblings of changed exec files (relative paths). */
function selectTestFiles(toplevel, paths) {
  const out = []
  const cands = ['.test.ts', '.test.tsx', '.test.js', '.test.mjs', '.test.cjs', '.itest.ts', '.itest.mjs', '.spec.ts']
  for (const p of paths) {
    if (isTestFile(p)) {
      out.push(p)
      continue
    }
    if (!isExecutable(p)) continue
    const stem = p.replace(/\.[^./]+$/, '')
    for (const ext of cands) if (existsSync(join(toplevel, stem + ext))) out.push(stem + ext)
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

  const plan = {
    phase: phaseNum,
    kind,
    mode,
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
    else if (a === '--report') opts.report = argv[++i]
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
    process.stdout.write('roadmap gate run  <phase> [--base <sha>] [--slots a,b] [--report <path>] [--record-round <json>] [--verify-complete] [--json]\n')
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

  if (sub === 'run') {
    // gate run lands in 1656.5 (mechanical slot execution + the GateRunReport).
    process.stderr.write('roadmap gate run: not yet implemented (lands in ROADCODE 1656.5)\n')
    return 1
  }

  process.stderr.write(`roadmap gate: unknown subcommand '${sub}' (plan | run)\n`)
  return 1
}
