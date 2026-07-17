/**
 * ladder — the FIVE pure scope/band/cell derivation functions (arc ROADCODE
 * singleSeam #5). The gate-protocol.md prose tables become CODE here: diff DATA +
 * phase fields + config in, a decision OUT. NOTHING in this module reads fs, git,
 * child_process, or process.env — purity is the contract (the ladder.test.mjs suite
 * freezes its config to prove no mutation, and asserts no such imports appear here).
 *
 * The ported spec (every constant/row is line-anchored in ladder.test.mjs so the
 * 1659 gate-protocol.md DELETION can point at the surviving fixtures):
 *   - gateCell            ← gate-protocol.md:88-93 (kind rows) + :340-345 (kind × mode cells)
 *   - specialistFloor     ← gate-protocol.md:188-197 (test floor) + :252-260 (review floor)
 *   - deriveTestScope     ← gate-protocol.md:164-174 opt-in, :180-186 table, :188-197 floor,
 *                            :205-210 honesty record, :217-230 sequence cadence
 *   - deriveReviewScope   ← gate-protocol.md:244-250 table, :252-260 declaration semantics,
 *                            :262-265 gateRounds honesty note
 *   - deriveDocsOnly      ← gate-protocol.md:289 executable-extension classifier
 *   - classifyBand        ← do-arc SKILL.md:52-75 execution-band rules
 *
 * A refused floor is DATA (a `refused` string on the return) — the CALLER exit-2s;
 * ladder.mjs itself NEVER calls process.exit (honesty rail: refusal is legible data).
 */

// ── ported named constants ───────────────────────────────────────────────────────

/** gate-protocol.md:289 — the executable-code extension set (the docs-only classifier). */
export const EXECUTABLE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rego', '.sql']

/** gate-protocol.md:249 — the review `light` upper line bound. */
export const REVIEW_LIGHT_MAX_LINES = 150

/** do-arc SKILL.md:60-74 — the four tunable band thresholds, named in ONE place. */
export const HEAVY_MIN_TASKS = 10
export const HEAVY_MIN_TDD_E2E = 4
export const MID_MIN_TASKS = 3
export const TRIVIAL_MAX_TASKS = 2
export const TRIVIAL_LIGHT_MAX_TASKS = 4

const TEST_RUNGS = ['static', 'scoped', 'relevant', 'full']
const REVIEW_RUNGS = ['none', 'light', 'full']
const testRungLt = (a, b) => TEST_RUNGS.indexOf(a) < TEST_RUNGS.indexOf(b)
const reviewRungLt = (a, b) => REVIEW_RUNGS.indexOf(a) < REVIEW_RUNGS.indexOf(b)

// ── glob matching (the ** / * subset the config schema documents; minimatch-free) ──

/**
 * Anchored glob match — `**` matches any run including `/`, `*` matches any run
 * except `/`. Only the subset gateSpecialists[].paths documents (`src/relay/**`,
 * `src/masking*`, …); no brace/char-class support (unneeded, so unimplemented).
 */
export function matchGlob(glob, path) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i++
      } else {
        re += '[^/]*'
      }
    } else if ('\\^$.|?+()[]{}'.includes(c)) {
      re += '\\' + c
    } else {
      re += c
    }
  }
  return new RegExp('^' + re + '$').test(path)
}

/**
 * Glob match that tolerates an absolute/prefixed path (a phase keyFile is an absolute
 * path; a gateSpecialists glob is repo-relative). Tries the whole path, then each
 * `/`-anchored tail — so `/home/x/src/relay/y` matches `src/relay/**`. Repo-relative
 * diff paths (the gate's own `git diff --name-only` output) match on the first try.
 */
export function matchGlobPath(glob, path) {
  if (matchGlob(glob, path)) return true
  const segs = path.split('/')
  for (let i = 1; i < segs.length; i++) {
    if (matchGlob(glob, segs.slice(i).join('/'))) return true
  }
  return false
}

const isTestFile = (p) => /(?:\.|-)(?:test|itest|spec)\.[cm]?[jt]sx?$/.test(p)
const isExecutable = (p) => EXECUTABLE_EXTS.some((ext) => p.endsWith(ext))

// ── gateCell(kind, mode) — the kind × mode mechanical slot cell ────────────────────

const LOGIC_INLINE_SLOTS = ['lint', 'types', 'unit', 'integration', 'build']
const ARC_SLOTS = ['lint', 'types', 'build']

/**
 * gate-protocol.md:88-93 kind rows × :340-345 inline|arc columns → a DATA cell (slot
 * NAMES + markers, never commands). `mode` ∈ 'inline' | 'arc'. Arc mode narrows the
 * broad unit+integration tiers to `scopedTests:true` (relevant-to-diff, run via the
 * scoped slots), with the arc-end full run as the backstop (do-arc Step 8).
 *   - closureItest: the hardening closure integration test — NEVER defers (both modes).
 *   - e2e: 'inline' (release inline, Round-1 mechanical) | 'deferred' (release arc, →
 *          arc end) | false (all other kinds).
 */
export function gateCell(kind, mode) {
  const arc = mode === 'arc'
  const notes = []
  if (arc) notes.push('arc-mode: unit+integration narrow to relevant-to-diff; full tiers defer to the arc-end run (do-arc Step 8)')
  switch (kind) {
    case 'mockup':
      return { slots: ['lint', 'types'], closureItest: false, e2e: false, scopedTests: false, notes }
    case 'logic':
      return {
        slots: arc ? [...ARC_SLOTS] : [...LOGIC_INLINE_SLOTS],
        closureItest: false,
        e2e: false,
        scopedTests: arc,
        notes,
      }
    case 'hardening':
      return {
        slots: arc ? [...ARC_SLOTS] : [...LOGIC_INLINE_SLOTS],
        closureItest: true, // the closure criterion never defers — both modes
        e2e: false,
        scopedTests: arc,
        notes,
      }
    case 'release':
      return {
        slots: arc ? [...ARC_SLOTS] : [...LOGIC_INLINE_SLOTS],
        closureItest: false,
        e2e: arc ? 'deferred' : 'inline',
        scopedTests: arc,
        notes,
      }
    default:
      // legacy phase with no kind → treat as logic (gate-protocol.md:98)
      return {
        slots: arc ? [...ARC_SLOTS] : [...LOGIC_INLINE_SLOTS],
        closureItest: false,
        e2e: false,
        scopedTests: arc,
        notes: [...notes, `unknown kind '${kind}' → treated as logic (legacy fallback)`],
      }
  }
}

// ── deriveDocsOnly(paths) — the :289 executable-extension classifier ───────────────

/** True iff NO changed path carries an executable extension (gate-protocol.md:289 —
 *  the mechanical docs-only test the Round-0 skip and both derive functions share). */
export function deriveDocsOnly(paths) {
  return !(paths ?? []).some(isExecutable)
}

// ── specialistFloor(diff, cfg) — the two DIVERGENT floors ──────────────────────────

/**
 * Match diff.paths against cfg.gateSpecialists[].paths globs. The test floor and the
 * review floor DELIBERATELY DIVERGE (gate-protocol.md:188-197): a specialist path
 * floors the TEST scope to `relevant` (its module suites run at the gate) but NOT to
 * `full` (distant-consumer coverage is what the `## Test cadence` backstop re-covers);
 * it floors the REVIEW scope to `full` (reviewer judgment on spine diffs has real catch
 * history). Returns testFloor/reviewFloor = null when nothing matched.
 */
export function specialistFloor(diff, cfg) {
  const specialists = cfg?.gateSpecialists ?? []
  const paths = diff?.paths ?? []
  const matchedPaths = []
  const agents = []
  for (const spec of specialists) {
    for (const p of paths) {
      if (spec.paths.some((g) => matchGlobPath(g, p))) {
        if (!matchedPaths.includes(p)) matchedPaths.push(p)
        if (!agents.includes(spec.agent)) agents.push(spec.agent)
      }
    }
  }
  const matched = matchedPaths.length > 0
  return {
    matched,
    paths: matchedPaths,
    agents,
    testFloor: matched ? 'relevant' : null,
    reviewFloor: matched ? 'full' : null,
  }
}

// ── deriveTestScope(diff, phase, cfg) ──────────────────────────────────────────────

/**
 * Derive the effective TEST scope. Pure: `diff` carries { paths, changedLines,
 * colocatedTest } where colocatedTest is a precomputed Set of exec paths that are
 * themselves a test OR have a colocated `<name>.test.*`/`<name>.itest.*` sibling on
 * disk — the ONLY on-disk lookup, precomputed by the (impure) caller so this stays pure.
 *
 * opts.sequenceMember caps effective at `relevant` with the sequence-end deferral note
 * (gate-protocol.md:217-230). Returns { derived, declared, effective, floorReason?,
 * refused?, ladder?, notes }.
 */
export function deriveTestScope(diff, phase, cfg, opts = {}) {
  const declared = phase?.testScope ?? null

  // :164-174 opt-in — no `## Test cadence` (testCadence.enabled) ⇒ ladder OFF, full default.
  if (cfg?.testCadence?.enabled !== true) {
    return { derived: 'full', declared, effective: 'full', ladder: 'off', notes: [] }
  }

  const floor = specialistFloor(diff, cfg)
  const paths = diff?.paths ?? []

  // :180-186 derivation (pre-made decision 2a).
  let derived
  if (phase?.kind === 'release') {
    derived = 'full'
  } else if (deriveDocsOnly(paths)) {
    derived = 'static'
  } else {
    const execFiles = paths.filter(isExecutable)
    const scopedProvable =
      execFiles.length > 0 &&
      execFiles.every((p) => isTestFile(p) || diff?.colocatedTest?.has?.(p))
    derived = scopedProvable ? 'scoped' : 'relevant'
  }
  // :188-197 — a `## Gate specialists` path floors the derived TEST scope to `relevant`
  // (never below), never to `full`.
  let floorReason
  if (floor.matched && testRungLt(derived, 'relevant')) {
    derived = 'relevant'
    floorReason = `## Gate specialists path → floor relevant (${floor.paths.join(', ')})`
  } else if (floor.matched) {
    floorReason = `## Gate specialists path → floor relevant (${floor.paths.join(', ')})`
  }

  // :188-197 floor rule — a declared testScope may only RAISE the derived floor.
  let effective = derived
  let refused
  if (declared) {
    if (testRungLt(declared, derived)) {
      refused =
        `testScope '${declared}' declared but the diff floor is '${derived}'` +
        (floor.matched ? ` (## Gate specialists floor: relevant — ${floor.paths.join(', ')})` : '')
    } else {
      effective = declared // raise-only
    }
  }

  // :217-230 sequence cadence — cap a member's test slots at `relevant` (a member that
  // declared `full` defers its full run to the sequence-end pass).
  const notes = []
  if (!refused && opts.sequenceMember && testRungLt('relevant', effective)) {
    effective = 'relevant'
    notes.push(`deferred → sequence-end suite after phase ${phase?.phase ?? '?'}`)
  }

  // :205-210 honesty record — any rung below full names the backstop.
  if (!refused && testRungLt(effective, 'full')) {
    const backstop = cfg?.testCadence?.backstop ?? 'the declared ## Test cadence backstop'
    notes.push(`deferred: full unit+integration tiers → ${backstop} per ## Test cadence`)
  }

  return {
    derived,
    declared,
    effective,
    ...(floorReason ? { floorReason } : {}),
    ...(refused ? { refused } : {}),
    notes,
  }
}

// ── deriveReviewScope(diff, phase, cfg) ────────────────────────────────────────────

/**
 * Derive the effective REVIEW scope (gate-protocol.md:244-260, pre-made decision 2b):
 *   none  = docs-only diff OR kind: mockup
 *   light = executable AND changedLines <= REVIEW_LIGHT_MAX_LINES AND no specialist match
 *   full  = anything else — ALWAYS when a `## Gate specialists` path is touched
 * Declaration is HONORED in BOTH directions (:252-260) EXCEPT the specialist hard floor
 * to `full`, which returns a `refused` string. The machine-decidable derivation lives
 * here; the LEGITIMACY of a plan-declared low rung stays review-phase Mode A judgment.
 */
export function deriveReviewScope(diff, phase, cfg) {
  const floor = specialistFloor(diff, cfg)
  const paths = diff?.paths ?? []
  const docsOnly = deriveDocsOnly(paths)

  let derived
  if (docsOnly || phase?.kind === 'mockup') derived = 'none'
  else if (!floor.matched && (diff?.changedLines ?? 0) <= REVIEW_LIGHT_MAX_LINES) derived = 'light'
  else derived = 'full'
  if (floor.matched) derived = 'full' // hard floor

  const declared = phase?.reviewScope ?? null
  let effective = derived
  let refused
  if (declared) {
    if (floor.matched && reviewRungLt(declared, 'full')) {
      refused =
        `reviewScope '${declared}' declared but the diff touches ${floor.paths.join(', ')} — ` +
        '## Gate specialists floor: full'
    } else {
      effective = declared // honored both directions
    }
  }

  // :262-265 — a rung below full carries its gateRounds honesty-note strings.
  const notes = []
  if (!refused && reviewRungLt(effective, 'full')) {
    if (effective === 'none') {
      notes.push('no review agents — reviewScope none')
    } else {
      notes.push('Round 0 skipped — reviewScope light (plan-ratified)')
      notes.push('1 reviewer — reviewScope light')
    }
  }

  return { derived, declared, effective, ...(refused ? { refused } : {}), notes }
}

// ── classifyBand(phase, cfg) ───────────────────────────────────────────────────────

/** A phase is CONTENDED when any of its keyFiles / tasks[].files matches a
 *  gateSpecialists glob (do-arc SKILL.md:57 — the same anchor the gate uses). */
function phaseTouchesSpecialist(phase, cfg) {
  const specialists = cfg?.gateSpecialists ?? []
  if (specialists.length === 0) return false
  const paths = [...(phase?.keyFiles ?? [])]
  for (const t of phase?.tasks ?? []) for (const f of t?.files ?? []) paths.push(f)
  return paths.some((p) => specialists.some((s) => s.paths.some((g) => matchGlobPath(g, p))))
}

/**
 * do-arc SKILL.md:52-75 execution band. Order: HEAVY, then TRIVIAL (checked BEFORE MID
 * exactly as :68 mandates), then MID, else TRIVIAL fallback. Signal is context pressure
 * + reliability, NOT phase.kind. Returns { band: 'heavy'|'mid'|'trivial', reason }.
 */
export function classifyBand(phase, cfg) {
  const tasks = phase?.tasks ?? []
  const taskCount = tasks.length
  const tddE2e = tasks.filter((t) => t?.testMode === 'tdd' || t?.testMode === 'e2e').length
  const contended = phaseTouchesSpecialist(phase, cfg)
  const kind = phase?.kind
  const reviewScope = phase?.reviewScope

  // HEAVY — taskCount >= 10 OR (tdd/e2e >= 4 AND contended).
  if (taskCount >= HEAVY_MIN_TASKS) {
    return { band: 'heavy', reason: `taskCount ${taskCount} >= ${HEAVY_MIN_TASKS}` }
  }
  if (tddE2e >= HEAVY_MIN_TDD_E2E && contended) {
    return {
      band: 'heavy',
      reason: `${tddE2e} tdd/e2e tasks >= ${HEAVY_MIN_TDD_E2E} AND touches a contended (## Gate specialists) path`,
    }
  }

  // TRIVIAL — checked BEFORE MID (:68). taskCount <= 2, a mockup, OR taskCount <= 4 with
  // a plan-declared light/none reviewScope (the light-gated branch, :70-72).
  const lightGated = reviewScope === 'light' || reviewScope === 'none'
  if (taskCount <= TRIVIAL_MAX_TASKS) {
    return { band: 'trivial', reason: `taskCount ${taskCount} <= ${TRIVIAL_MAX_TASKS}` }
  }
  if (kind === 'mockup') {
    return { band: 'trivial', reason: 'mockup/docs-only phase runs inline' }
  }
  if (taskCount <= TRIVIAL_LIGHT_MAX_TASKS && lightGated) {
    return {
      band: 'trivial',
      reason: `taskCount ${taskCount} <= ${TRIVIAL_LIGHT_MAX_TASKS} with plan-declared reviewScope '${reviewScope}' (light-gated)`,
    }
  }

  // MID — a gate-weighty phase that is neither heavy nor trivial.
  if (['logic', 'hardening', 'release'].includes(kind) && taskCount >= MID_MIN_TASKS) {
    return { band: 'mid', reason: `kind ${kind}, taskCount ${taskCount} >= ${MID_MIN_TASKS}, not heavy/trivial` }
  }

  return { band: 'trivial', reason: 'small/unbanded phase runs inline' }
}
