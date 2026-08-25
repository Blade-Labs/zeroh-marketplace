/**
 * eval-collect — the ArcTrace COLLECTOR (arc EVALCORE, 1996.2). Everything the scorer is
 * allowed to look at, gathered from DISK ALONE: the arc file and its member phase files
 * (through the consumer schema, over the tsx bridge), the roadmap/.gate run records, the
 * recorded sweep + verdicts artifacts, the regenerable RunnerSummary, and git.
 *
 * ## Absence is a field, not a value
 * The collector never mints a stand-in. An artifact that is not on disk produces an ABSENT
 * FIELD; the SCORER owns the single absence→sentinel mapping, so the closed sentinel
 * vocabulary has exactly one application site instead of two that can drift apart.
 *
 * ## Where the contract is enforced
 * Phase files are parsed by the CONSUMER's own `definePhase` at import time (the tsx
 * bridge) — that IS the schema check, and it is the same one `roadmap result check` uses.
 * The JSON artifacts (sweep / verdicts / summary) ride the trace verbatim and are validated
 * where the trace itself is validated: `ArcTraceShape` composes SweepReportShape,
 * ArcVerdictsFileShape and RunnerSummaryShape by reference, so one `.parse()` of the trace
 * at the CLI boundary checks all of them. Only a file that is not READABLE (absent, or not
 * valid JSON) is dropped here — with a warning naming it, never silently.
 *
 * ## Quarantining emit
 * A phase file that will not import is RECORDED (`parseError`) and named in `warnings`,
 * never dropped: a silently missing phase would quietly improve every average it should
 * have dragged down.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultExec } from './exec.mjs'
import { GateRunReportShape } from './gate-report.mjs'
import { flowTokens } from '../commands/measure.mjs'
import { bridgeImport, bridgeImportMany, bridgeParseShape, consumerSchemaPath } from './tsx-bridge.mjs'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * The one workflow profile that exists. A profile names how an arc was RUN — which gate chain,
 * which review depth, which model tier — so a score shift can be attributed to the workflow
 * rather than to the actor. Only the cheap STAMP ships here: the per-profile seam stays unbuilt
 * until a second profile has a concrete consumer (rule of three), and building it now would be
 * an abstraction over a set of size one.
 */
export const WORKFLOW_PROFILE = 'prod-grade'

/**
 * Which plugin BUILD is producing this report: `{ pluginVersion, pluginSha, protocolLoadTokens,
 * profile }`, or null when ANY component is underivable — in which case `warn` is called naming
 * which one. A partial stamp is a fabricated stamp: a workflow block missing its sha still looks
 * like provenance to a reader, and half a provenance record is worse than an absent one that the
 * report names as a gap.
 *
 * `pluginSha` is the HEAD short sha, suffixed `-dirty` when the plugin worktree carries
 * uncommitted changes: a report produced from an edited tree was not produced by the commit
 * the sha names, and the suffix is the difference between provenance and a plausible number.
 *
 * Stamped at PRODUCTION time only. It is deliberately not restampable: the build behind a
 * historical report was never recorded, and writing today's sha onto it would invent the fact.
 */
export function assembleWorkflowStamp({ exec = defaultExec, pluginRoot = PLUGIN_ROOT, warn = () => {} } = {}) {
  let pluginVersion
  try {
    pluginVersion = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8')).version
  } catch (e) {
    warn(`workflow stamp: cannot read the plugin package.json (${e.message}) — no workflow block written`)
    return null
  }
  if (!pluginVersion) {
    warn('workflow stamp: the plugin package.json records no version — no workflow block written')
    return null
  }

  const rev = exec('git', ['-C', pluginRoot, 'rev-parse', '--short=12', 'HEAD'])
  const head = rev.status === 0 ? rev.stdout.trim() : ''
  if (!head) {
    warn('workflow stamp: the plugin checkout has no resolvable HEAD sha — no workflow block written')
    return null
  }
  // A bare sha claims the report was produced BY that commit, which is false whenever the
  // plugin is edited and run before the commit lands — the normal state of a phase in flight.
  // The `-dirty` suffix is the honest form of the same fact; without it the stamp quietly
  // names a build the reader could diff and would not recognise.
  const status = exec('git', ['-C', pluginRoot, 'status', '--porcelain', '.'])
  if (status.status !== 0) {
    warn('workflow stamp: cannot tell whether the plugin worktree is clean — no workflow block written')
    return null
  }
  const pluginSha = status.stdout.trim() === '' ? head : `${head}-dirty`

  const measured = flowTokens('do-arc', { manifestPath: join(pluginRoot, 'cli', 'measure-manifest.json'), baseDir: pluginRoot })
  if (!measured) {
    warn("workflow stamp: the do-arc protocol load is not derivable (missing manifest or path) — no workflow block written")
    return null
  }

  return { pluginVersion, pluginSha, protocolLoadTokens: measured.totalTokens, profile: WORKFLOW_PROFILE }
}

/**
 * Which CONSUMER produced this report, so numbers from two repos are comparable. Every
 * component is derived OFFLINE from the checkout — `repo` is a basename rather than a git
 * remote, because a remote read is a network call and a rename would silently repartition
 * the corpus mid-history.
 *
 * `identityRoot` splits the two questions the toplevel used to answer at once. IDENTITY (which
 * repository is this) comes from identityRoot, so a linked worktree lands in the same cohort as
 * the checkout it was cut from instead of partitioning one repository in two. The DERIVED facts
 * (language, corpusSize) keep reading the ACTIVE checkout, because a worktree legitimately holds
 * its own phase files and its own tsconfig, and normalizing those would mis-count the corpus in
 * exchange for nothing. Defaults to toplevel, so a one-argument call is unchanged.
 */
export function assembleConsumerFingerprint(toplevel, { identityRoot = toplevel } = {}) {
  const language = existsSync(join(toplevel, 'tsconfig.json'))
    ? 'typescript'
    : existsSync(join(toplevel, 'package.json'))
      ? 'javascript'
      : 'unknown'
  let corpusSize = 0
  try {
    corpusSize = readdirSync(join(toplevel, 'roadmap', 'phases')).filter((f) => /^phase-.*\.phase\.ts$/.test(f)).length
  } catch {
    corpusSize = 0 // an absent phases dir is an empty corpus, not a failure
  }
  return { repo: basename(identityRoot), language, corpusSize }
}

/**
 * The REAL validator for the record archive: the WHOLE directory rides ONE tsx spawn through
 * the consumer's PhaseEvalRecordListShape. Seam 3 forbids a plugin-side copy of a consumer
 * contract, and a spawn per file would make reading the archive cost more than producing it
 * (a 700-phase consumer is the target case) — so batching is the only affordable honest form.
 */
export const phaseEvalValidator = (repoRoot) => (docs) =>
  bridgeParseShape(repoRoot, consumerSchemaPath(repoRoot), 'PhaseEvalRecordListShape', docs)

/**
 * Lift one validated record into the per-phase sample shape `collectArcTrace`'s `phases[]`
 * uses, so the scorecard slices both sources through ONE code path rather than two.
 *
 * `gateRuns` stays EMPTY deliberately: a record carries slot results, not reviewer rounds, and
 * a synthesized round would seat a reviewer in a cell it never sat in. Reviewer attribution
 * stays arc-fed — parsing gateRounds into records is a NAMED follow-up, not a half-build.
 *
 * `driver` sits FLAT rather than under a synthesized `executionResult`: a record has no status
 * and no round count, and inventing a PhaseExecutionResult to carry one field would be a
 * fabricated document wearing a contract's name.
 */
function pevalSample(record) {
  const sample = {
    phase: record.phase,
    keyFiles: record.keyFiles ?? [],
    taskCount: record.taskCount ?? 0,
    transparency: [],
    gateRuns: [],
  }
  if (record.metrics) sample.metrics = record.metrics
  if (record.attribution?.driver) sample.driver = record.attribution.driver
  if (record.attribution?.plannedBy) sample.plannedBy = record.attribution.plannedBy
  return sample
}

/**
 * Read every `roadmap/arc-evals/*.peval.json` into per-phase samples. `validate` defaults to
 * the real bridge validator; injection exists for tests, never to skip validation.
 *
 * TWO PASSES, on the ERROR path only. The batch is validated once; when zod names offending
 * ELEMENTS by array index, those are warned about BY FILENAME, dropped, and the survivors are
 * re-validated. Dropping WITHOUT the second pass would let unvalidated documents through under
 * the cover of a batch that failed — they would carry no defaults and no guarantee, which is
 * exactly the silent degradation this reader exists to make visible.
 *
 * A batch failure that names NO element is a toolchain or schema-load problem, not a bad
 * record: nothing is safely droppable, so the whole class is reported ABSENT with the reason
 * named. Absent is a claim the data supports; a partial read presented as complete is not.
 */
export function readPhaseEvalSamples(repoRoot, { validate = phaseEvalValidator(repoRoot) } = {}) {
  const warnings = []
  const dir = join(repoRoot, 'roadmap', 'arc-evals')
  if (!existsSync(dir)) return { samples: [], warnings }
  let entries
  try {
    entries = readdirSync(dir)
  } catch (e) {
    warnings.push(`${dir}: unreadable (${e.message}) — no per-phase eval samples`)
    return { samples: [], warnings }
  }
  const docs = []
  const paths = []
  // Ordered by PHASE NUMBER, never by filename: a lexical sort puts '8801' before '99', so the
  // sample list would not read in the order a human asks for it and two archives with the same
  // records could serialize differently.
  const named = []
  for (const f of entries) {
    const m = f.match(PEVAL_NAME_RE)
    if (m) named.push({ f, n: Number(m[1]) })
  }
  for (const { f } of named.sort((a, b) => a.n - b.n)) {
    const path = join(dir, f)
    const read = readJson(path)
    if (read.error) {
      warnings.push(`${path}: unreadable (${read.error}) — excluded from the scorecard`)
      continue
    }
    docs.push(read.value)
    paths.push(path)
  }
  if (docs.length === 0) return { samples: [], warnings }

  const failureReason = (res) => (res?.stderr || res?.kind || 'unknown').toString().trim().split('\n')[0]
  let res = validate(docs)
  if (!res.ok) {
    // Grouped BY FILE, never per issue: one record with three broken fields is one dropped
    // record, and three near-identical lines would make the operator's count of what was lost
    // wrong in the direction of panic.
    const bad = new Map()
    const unattributed = []
    for (const iss of res.res?.issues ?? []) {
      const i = Array.isArray(iss.path) ? iss.path[0] : undefined
      const where = (iss.path ?? []).slice(1).join('.') || '(root)'
      const detail = `${where}: ${iss.message}`
      if (typeof i === 'number') {
        if (!bad.has(i)) bad.set(i, [])
        bad.get(i).push(detail)
      } else unattributed.push(detail)
    }
    for (const [i, reasons] of [...bad.entries()].sort((a, b) => a[0] - b[0]))
      warnings.push(`${paths[i] ?? dir}: does not match PhaseEvalRecordShape (${reasons.join('; ')}) — excluded from the scorecard`)
    for (const detail of unattributed)
      warnings.push(`${dir}: does not match PhaseEvalRecordShape (${detail})`)
    if (bad.size === 0) {
      warnings.push(
        `${dir}: the per-phase eval records could not be validated (${failureReason(res.res)}) — NO phase-record samples fed the scorecard`,
      )
      return { samples: [], warnings }
    }
    const survivors = docs.filter((_, i) => !bad.has(i))
    if (survivors.length === 0) return { samples: [], warnings }
    res = validate(survivors)
    if (!res.ok) {
      warnings.push(
        `${dir}: the surviving per-phase eval records still fail validation (${failureReason(res.res)}) — NO phase-record samples fed the scorecard`,
      )
      return { samples: [], warnings }
    }
  }
  return { samples: res.parsed.map(pevalSample), warnings }
}

/** A typed collection failure. kind ∈ 'no-arc' | 'tsx-absent' | 'load'. */
export class CollectError extends Error {
  constructor(kind, messageLines) {
    super(messageLines.join('\n'))
    this.name = 'CollectError'
    this.kind = kind
    this.messageLines = messageLines
  }
}

/** Conventional fix-commit grammar — the escape-rate candidate filter. */
const FIX_SUBJECT_RE = /^fix[(:]/

/** The dated-artifact filename axis: <ARCID>-<YYYY-MM-DD>[-<suffix>].json. */
const DATE_RE = '(\\d{4}-\\d{2}-\\d{2})'

const arcFilePath = (repoRoot, arcId) => join(repoRoot, 'roadmap', 'arcs', `${arcId}.arc.ts`)
const phaseFilePath = (repoRoot, n) => join(repoRoot, 'roadmap', 'phases', `phase-${n}.phase.ts`)

/** Regex-escape an arc id so an id containing regex metacharacters cannot widen the match. */
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The newest dated artifact for an arc in `dir`, or null. `suffix` selects the artifact
 * family ('sweep', 'verdicts'); pass null for the un-suffixed RunnerSummary form. Newest
 * is decided by the DATE IN THE NAME (ISO dates sort lexicographically), never by mtime —
 * a re-checkout rewrites mtimes and would silently reorder the archive.
 */
export function newestArtifact(dir, arcId, suffix) {
  return newestArtifactDated(dir, arcId, suffix)?.path ?? null
}

/**
 * The same resolution, keeping the DATE the filename carries instead of discarding it. That
 * date is a fact about the artifact rather than about the filesystem, which is exactly what
 * the land-record escape anchor needs: the RunnerSummary is minted at land time, so its
 * filename date is the land date, and no later commit can move it.
 *
 * Returns `{ path, date }` or null. `newestArtifact` is its path projection.
 */
export function newestArtifactDated(dir, arcId, suffix) {
  if (!existsSync(dir)) return null
  const re = new RegExp(`^${escapeRe(arcId)}-${DATE_RE}${suffix ? `-${escapeRe(suffix)}` : ''}\\.json$`)
  let best = null
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return null // an unreadable dir is an absent artifact, never a throw
  }
  for (const f of entries) {
    const m = f.match(re)
    if (!m) continue
    if (best === null || m[1] > best.date) best = { path: join(dir, f), date: m[1] }
  }
  return best
}

// ── Per-phase eval records (arc POLYSEAT plane 1) ────────────────────────────────────

/**
 * The per-phase record's filename class: `phase-<N>.peval.json`, DATE-FREE by design.
 *
 * Every arc-side scan of roadmap/arc-evals/ is anchored on a trailing `-YYYY-MM-DD` before
 * `.json` (`newestArtifactDated` here; REPORT_NAME_RE and arcsWithReports in
 * commands/eval.mjs), and this pattern requires a `.peval.json` tail no dated artifact
 * carries. The two name classes are therefore DISJOINT BY CONSTRUCTION, not by convention —
 * a record must never be read as an arc report, and an arc report must never be read as a
 * record. eval-collect.test.mjs falsifies that in BOTH directions.
 */
export const PEVAL_NAME_RE = /^phase-(\d+)\.peval\.json$/

/** Where one phase's record lives. ONE home for the convention, so the gate writer and the
 *  scorecard reader cannot drift into two spellings of the same path. */
export const phaseEvalRecordPath = (repoRoot, phase) =>
  join(repoRoot, 'roadmap', 'arc-evals', `phase-${phase}.peval.json`)

/** Did this gate row execute a command? The gate marks a declared-absent slot with a flag but a
 *  SKIPPED one only by its synthetic `(skipped: …)` command string, so both spellings are read
 *  here — one place, rather than each consumer rediscovering the convention. */
const didNotRun = (s) => s.declaredAbsent === true || /^\(skipped:/.test(String(s.command ?? ''))

/**
 * Assemble a per-phase eval record from what a gate run already holds. PURE: `date` and
 * `fingerprint` are passed IN, never derived here — the SweepReportShape discipline (a
 * recorder that reads its own wall clock makes a silent re-record indistinguishable from the
 * original). The gate passes the run report's own `startedAt`, so the date is a recorded
 * fact about the run rather than a fresh reading.
 *
 * `taskCount` and `keyFiles` are the COHORT KEYS computeScorecard slices on
 * (bandFor x surfaceOf), which is why they are lifted from the phase file rather than left
 * to the reader: a record without them does not lose detail, it MIS-COHORTS.
 *
 * Attribution is copied FIELD BY FIELD, never spread: PhaseEvalRecordShape is strict, and a
 * consumer phase file carrying an extra key under executionResult.driver would otherwise
 * turn a measurement write into a refusal.
 *
 * Returns { record, warnings }: projecting the per-firing role list onto a one-model-per-role
 * record can drop an ambiguous role (projectRoleModels), and a caller that could not SAY so
 * would be dropping it in silence. Warnings never fail anything — the caller prints them.
 */
/**
 * Project the per-firing `executionResult.roles` ARRAY onto the model-only RECORD
 * `PhaseEvalRecordShape.attribution.roles` accepts — plus the warnings that projection owes.
 *
 * The two shapes disagree on purpose-built ground: the source records EVERY firing (a role that
 * fired twice, or fell down its tier chain the second time, appears twice), while the target
 * holds one model per role. So `via` and `substituted` cannot travel at all, and a role whose
 * firings DISAGREE on the model is OMITTED and named rather than collapsed to one of them:
 * seating one model in a cell it only half-occupied is the direction that flatters the record.
 * An absent roles list stays absent; an EMPTY one becomes `{}`, because "the resolver bound
 * nothing" is a different fact from "no bindings were recorded" and both must stay readable.
 *
 * Object.fromEntries, never obj[role] — a plain-object assignment for a role named
 * `__proto__` creates no own property, and the role would vanish in silence.
 */
export function projectRoleModels(phase, roles) {
  if (!Array.isArray(roles)) return { roles: undefined, warnings: [] }
  const byRole = new Map()
  const warnings = []
  for (const firing of roles) {
    const role = firing?.role
    const model = firing?.model
    // PhaseExecutionResultShape requires both, so a firing missing either did not come through
    // the bridge. Unreachable is not a licence to drop it in silence — the reader needs to know
    // an entry was there and could not be read.
    if (!role || !model) {
      warnings.push(
        `phase ${phase}: an executionResult.roles entry is missing ${!role ? 'role' : 'model'} `
          + `(${JSON.stringify(firing)}) and was NOT projected into attribution.roles`,
      )
      continue
    }
    if (!byRole.has(role)) byRole.set(role, [])
    byRole.get(role).push(model)
  }
  const entries = []
  for (const [role, models] of byRole) {
    const distinct = [...new Set(models)]
    if (distinct.length === 1) {
      entries.push([role, { model: distinct[0] }])
      continue
    }
    warnings.push(
      `phase ${phase}: role '${role}' was filled by MORE THAN ONE model (${distinct.join(', ')}) and `
        + 'attribution.roles holds one model per role — the role is OMITTED rather than collapsed to one of '
        + `them; the full per-firing list stays in roadmap/phases/phase-${phase}.phase.ts executionResult.roles`,
    )
  }
  return { roles: Object.fromEntries(entries), warnings }
}

export function assemblePhaseEvalRecord({ phase, parsed, green, slots, fingerprint, date }) {
  const tasks = Array.isArray(parsed?.tasks) ? parsed.tasks : []
  const record = {
    phase,
    date,
    consumerFingerprint: fingerprint,
    taskCount: tasks.length,
    keyFiles: Array.isArray(parsed?.keyFiles) ? parsed.keyFiles : [],
    gate: {
      green: green === true,
      slots: (slots ?? []).map((s) => {
        // A slot that did not RUN carries NO exitCode. The gate stamps `exitCode: 0,
        // durationMs: 0` on both declared-absent and skipped rows, so copying the number
        // through would record a PASS for a command that never executed — the one direction
        // that flatters the record, and the exact thing this shape's contract forbids. Only
        // the declared-absent row is flagged as such; a skipped row is distinguished by
        // carrying neither an exitCode nor the flag.
        if (didNotRun(s)) return s.declaredAbsent === true ? { slot: s.slot, declaredAbsent: true } : { slot: s.slot }
        return {
          slot: s.slot,
          ...(typeof s.exitCode === 'number' ? { exitCode: s.exitCode } : {}),
          ...(typeof s.durationMs === 'number' ? { durationMs: s.durationMs } : {}),
        }
      }),
    },
  }
  if (parsed?.metrics) record.metrics = parsed.metrics
  const attribution = {}
  if (parsed?.plannedBy?.model) attribution.plannedBy = { model: parsed.plannedBy.model }
  const driver = parsed?.executionResult?.driver
  if (driver?.model && driver?.lane) attribution.driver = { model: driver.model, lane: driver.lane }
  const projected = projectRoleModels(phase, parsed?.executionResult?.roles)
  if (projected.roles) attribution.roles = projected.roles
  if (Object.keys(attribution).length > 0) record.attribution = attribution
  return { record, warnings: projected.warnings }
}

/** Read + JSON.parse an artifact. Returns { value } or { error } — never throws. */
function readJson(path) {
  try {
    return { value: JSON.parse(readFileSync(path, 'utf8')) }
  } catch (e) {
    return { error: e.message }
  }
}

/**
 * Flatten every gate run report for one phase into the summaries the eval needs: when it
 * started, whether it went green, the ordered reviewer rounds (the TRAJECTORY is the
 * signal — a first-round `findings-fixed` followed by a clean second round says something
 * a round COUNT cannot), and how many slots failed.
 *
 * A run file that will not read or will not match GateRunReportShape is SKIPPED, never
 * thrown and never half-counted: a corrupt record is missing data, not a reason to refuse
 * an entire arc. A FILTERED run (`slotFilter` present) is skipped for the opposite reason —
 * it read fine and says nothing about the phase. The filter stays keyed on `run-<seq>-*.json` so the bridge's sibling
 * `.typed-cache/` mirror under roadmap/.gate/ can never be read as a run.
 */
export function summarizeGateRuns(repoRoot, phaseNum) {
  const dir = join(repoRoot, 'roadmap', '.gate', String(phaseNum))
  if (!existsSync(dir)) return []
  let files
  try {
    files = readdirSync(dir)
  } catch {
    return []
  }
  const runs = files
    .filter((f) => /^run-\d+-.*\.json$/.test(f))
    .map((f) => ({ f, seq: Number(f.match(/^run-(\d+)-/)[1]) }))
    .sort((a, b) => a.seq - b.seq)
  const out = []
  for (const { f } of runs) {
    const read = readJson(join(dir, f))
    if (read.error) continue
    const parsed = GateRunReportShape.safeParse(read.value)
    if (!parsed.success) continue
    const report = parsed.data
    // A --slots run proves a SUBSET on purpose: its green covers the filtered rows alone and its
    // agents[] belong to that projection, not to the phase. Counting one as a gate round inflates
    // the round count of every phase whose driver debugged with --slots — which is the routine
    // per-task path, so the inflation is systematic rather than occasional.
    if (report.slotFilter) continue
    out.push({
      startedAt: report.startedAt,
      green: report.green,
      rounds: report.agents.map((a) => ({ round: a.round, agent: a.agent, verdict: a.verdict, ...(a.model ? { model: a.model } : {}) })),
      // A slot with no exitCode did not RUN (skipped/declared-absent); only a recorded
      // non-zero exit is a failure. Counting a skip as a failure would invent a red.
      slotFailures: report.slots.filter((s) => typeof s.exitCode === 'number' && s.exitCode !== 0).length,
    })
  }
  return out
}

/**
 * The member commits of a phase, by SUBJECT. `--grep` narrows server-side (an unfiltered
 * full-history log overruns the exec buffer on a real repo) and a subject-only regex then
 * confirms each hit — git's --grep searches the whole message, so a commit that merely
 * MENTIONS the phase in its body would otherwise be read as a member commit and drag the
 * land boundary forward past any escape fix behind it. The digit boundary is what keeps
 * `phase 900` from matching `phase 9001`.
 */
function memberCommits(repoRoot, phaseNum, exec) {
  const r = exec('git', ['-C', repoRoot, 'log', `--grep=phase ${phaseNum}`, '--format=%H%x09%aI%x09%s'])
  if (r.status !== 0) return []
  const re = new RegExp(`(?:^|[^0-9])phase ${phaseNum}(?:[^0-9]|$)`)
  const out = []
  for (const line of r.stdout.split('\n')) {
    const [sha, date, ...rest] = line.split('\t')
    const subject = rest.join('\t')
    if (!sha || !date || !subject) continue
    if (re.test(subject)) out.push({ sha, date, subject })
  }
  return out
}

/** The file paths one commit touched. */
function commitFiles(repoRoot, sha, exec) {
  const r = exec('git', ['-C', repoRoot, 'show', '--name-only', '--format=', sha])
  if (r.status !== 0) return []
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean)
}

/**
 * The arc's git facts: when it landed, which files it owns, and which post-land fixes
 * escaped it.
 *
 * - `landedAt`: the date of the MERGE that carried the arc's newest member commit into the
 *   current branch. Not the tip itself: every member-commit grammar here is in-phase work
 *   (`fix(scope): phase N gate R2` is an ordinary gate round and is routinely the phase's
 *   LAST commit), so any tip-derived boundary would score in-phase rework as an escape. No
 *   such merge (a fast-forward land, or the arc is still on this branch) ⇒ the tip's own
 *   date, which leaves the escape window empty — no evidence of a post-land window is not
 *   the same as evidence of escapes. No member commits at all ⇒ no boundary, never today.
 * - `arcFiles`: the union of the files the member commits touched.
 * - `escapeFixes` (SCORED): commits after `landedAt` carrying the conventional fix grammar
 *   whose SUBJECT NAMES A MEMBER PHASE — rework the arc's own gate let through, attributed
 *   by the same subject-anchored discipline `memberCommits` uses. `files` is the SIZE OF
 *   THE INTERSECTION with the arc's files, not the commit's diff size.
 * - `escapeFixesFileIntersection` (UNSCORED): the count under the previous, unbounded rule
 *   — any post-land fix touching any arc file. It measured how LONG AGO the arc landed as
 *   much as its quality, so it no longer scores; it stays here as an inspectable signal,
 *   because a scoring-model change whose old number vanishes cannot be audited.
 *
 * `landAnchorDate` (option C) is the dated RunnerSummary's filename date — the LAND RECORD,
 * written at land time by a source outside the arc's own commit set. Given one, it bounds the
 * window outright and the merge/tip derivation is skipped: only a non-member anchor can hold
 * still while phase-named post-land fixes accumulate behind it.
 */
export function findArcGitFacts(repoRoot, memberNums, { exec = defaultExec, landAnchorDate } = {}) {
  const members = new Map()
  for (const n of memberNums) {
    for (const c of memberCommits(repoRoot, n, exec)) members.set(c.sha, c)
  }
  // No member commits ⇒ no land boundary ⇒ there is nothing to scan AFTER. That is a
  // complete scan of an empty window, not a failed one.
  if (members.size === 0)
    return {
      landedAt: undefined,
      escapeScan: 'complete',
      escapeFixes: [],
      escapeFixesFileIntersection: 0,
      arcFiles: [],
    }

  let landedAt
  let escapeWindow
  if (landAnchorDate) {
    // END of the land day, not its start. In-phase gate-fix commits carry the same subject
    // grammar as an escape, and a same-day one must not be scored as rework the gate let
    // through. The cost is real and accepted: an escape landed on the land day itself is
    // invisible. Erring toward the arc is the honest direction for an attribution rule whose
    // false positives are accusations.
    landedAt = `${landAnchorDate}T23:59:59.999Z`
    escapeWindow = 'land-record-anchored'
  } else {
    landedAt = deriveCommitAnchoredBoundary(repoRoot, members, exec)
    escapeWindow = landedAt === undefined ? 'tip-anchored' : 'merge-anchored'
    // No merge landed the tip: the arc reached the branch by direct commits (this consumer's
    // autonomous develop landings) or has not landed. The tip's own date then bounds the window,
    // which leaves it EMPTY — absence of a derivable boundary, not evidence of zero escapes. The
    // caller reports that difference rather than letting an empty list read as a spotless arc.
    landedAt ??= [...members.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0].date
  }

  // The scored window's attribution: a member phase named in the SUBJECT. Same digit-boundary
  // discipline as `memberCommits` — `phase 900` must not match `phase 9001`.
  const memberPhaseRe = new RegExp(`(?:^|[^0-9])phase (?:${[...memberNums].join('|')})(?:[^0-9]|$)`)

  const arcFileSet = new Set()
  for (const sha of members.keys()) for (const f of commitFiles(repoRoot, sha, exec)) arcFileSet.add(f)
  return finishGitFacts({ repoRoot, exec, members, landedAt, escapeWindow, memberPhaseRe, arcFileSet })
}

/**
 * The pre-option-C boundary, kept verbatim as the fallback for an arc with no land record on
 * disk. The boundary is the merge that carried the arc's NEWEST member commit onto this branch.
 * Only that commit is asked: an older member's merge would sit in the arc's own middle and
 * score the phases that came after it as escapes (this repo commits many task commits with
 * `fix(scope): phase N — ...` grammar, so "later member commit" and "escape fix" look
 * identical from the subject alone; only the merge boundary separates them).
 *
 * Returns the merge's ISO date, or undefined when no merge landed the tip.
 */
function deriveCommitAnchoredBoundary(repoRoot, members, exec) {
  const byNewest = [...members.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
  const tip = byNewest[0]
  // `--ancestry-path` narrows to merges the tip can reach, `--reverse` puts the oldest first.
  // Reachability alone is NOT enough: once an arc is on the base branch EVERY later topic merge
  // has it as an ancestor. The merge that LANDED it is the one whose first parent — the base
  // branch as it stood before the merge — did not contain it yet. Without that test a
  // direct-committed arc would silently borrow the next unrelated merge's date, pushing the
  // window forward, which is an error in the flattering direction.
  const merges = exec('git', [
    '-C', repoRoot, 'log', '--merges', '--ancestry-path', '--reverse', '--format=%H%x09%aI', `${tip.sha}..HEAD`,
  ])
  if (merges.status !== 0) return undefined
  for (const line of merges.stdout.split('\n')) {
    const [sha, date] = line.split('\t')
    if (!sha || !date) continue
    if (exec('git', ['-C', repoRoot, 'merge-base', '--is-ancestor', tip.sha, `${sha}^1`]).status === 0) continue
    return date
  }
  return undefined
}

/**
 * The escape scan itself, identical under every window: the boundary is already decided, and
 * this only asks which post-boundary commits are attributable rework. Split out so the two
 * boundary derivations (land record vs merge/tip) cannot drift into two scan rules.
 */
function finishGitFacts({ repoRoot, exec, members, landedAt, escapeWindow, memberPhaseRe, arcFileSet }) {
  const escapeFixes = []
  let fileIntersectionCount = 0
  // BOUNDED at the land boundary: an unfiltered full-history log is megabytes on a real repo
  // and every commit older than the boundary is irrelevant by definition. `--since` is
  // inclusive of the boundary commit itself, which the explicit date compare below drops.
  const all = exec('git', ['-C', repoRoot, 'log', '--no-merges', `--since=${landedAt}`, '--format=%H%x09%aI%x09%s'])
  let escapeScan = 'complete'
  if (all.status !== 0) {
    // The scan did not run. Recording an empty escape list here would read as a spotless arc
    // and RAISE the code-confidence score, so the failure travels as data instead.
    escapeScan = 'unavailable'
  } else {
    const landedMs = Date.parse(landedAt)
    // Oldest-first so the escape list reads in the order the fixes actually happened.
    for (const line of all.stdout.split('\n').reverse()) {
      const [sha, date, ...rest] = line.split('\t')
      const subject = rest.join('\t')
      if (!sha || !date || !subject) continue
      if (Date.parse(date) <= landedMs) continue
      if (!FIX_SUBJECT_RE.test(subject)) continue
      const files = commitFiles(repoRoot, sha, exec).filter((f) => arcFileSet.has(f))
      // The old, unbounded rule — retained as a signal, no longer scored.
      if (files.length > 0 && !members.has(sha)) fileIntersectionCount += 1
      if (!memberPhaseRe.test(subject)) continue
      escapeFixes.push({ sha, subject, files: files.length })
    }
  }

  // Canonicalize to a Z-suffixed instant: git's %aI emits a local offset (+00:00), which is
  // a valid ISO string but not the datetime form the contract pins. Normalizing HERE keeps
  // one comparable time format across the whole trace instead of per-reader parsing.
  const facts = {
    landedAt: new Date(landedAt).toISOString(),
    escapeScan,
    escapeWindow,
    escapeFixes,
    arcFiles: [...arcFileSet].sort(),
  }
  // A scan that did not run knows NOTHING, including the old count — absent, not zero.
  if (escapeScan === 'complete') facts.escapeFixesFileIntersection = fileIntersectionCount
  return facts
}

/** Lift one parsed phase file into its trace entry. */
function phaseEntry(num, parsed) {
  const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : []
  const entry = {
    phase: num,
    keyFiles: Array.isArray(parsed.keyFiles) ? parsed.keyFiles : [],
    taskCount: tasks.length,
    transparency: tasks.map((t) => t?.transparencyReport).filter(Boolean),
    gateRuns: [],
  }
  if (parsed.executionResult) entry.executionResult = parsed.executionResult
  if (parsed.metrics) entry.metrics = parsed.metrics
  if (parsed.plannedBy) entry.plannedBy = parsed.plannedBy
  return entry
}

/**
 * Collect one arc's whole trace. Returns `{ trace, warnings }` — `warnings` names every
 * artifact that was present-but-unreadable and every phase file that would not import, so
 * a degraded collect is visible in the run output and in the report's notes rather than
 * inferred from a suspiciously good score.
 *
 * Idempotent by construction: a pure function of disk state plus `collectedAt` (injectable,
 * which is what makes the idempotence assertion possible at all).
 */
export function collectArcTrace(
  repoRoot,
  arcId,
  { exec = defaultExec, collectedAt = new Date().toISOString(), consumerRoot = repoRoot } = {},
) {
  const warnings = []
  const arcPath = arcFilePath(repoRoot, arcId)
  if (!existsSync(arcPath))
    throw new CollectError('no-arc', [
      `roadmap eval: no arc file at ${arcPath}`,
      'an arc that does not exist cannot be collected — a zero-phase trace would score as a perfect arc',
    ])

  const arcRes = bridgeImport(arcPath, { consumerRoot })
  if (!arcRes.ok) {
    const kind = arcRes.kind === 'tsx-absent' ? 'tsx-absent' : 'load'
    throw new CollectError(kind, [`roadmap eval: cannot typed-read ${arcPath}`, (arcRes.stderr ?? '').trim()])
  }
  const memberNums = [...new Set((arcRes.parsed.planes ?? []).flatMap((p) => p.phases ?? []))].sort((a, b) => a - b)

  // ONE tsx process for every member (a per-file spawn costs ~7s each on a real arc).
  const paths = memberNums.map((n) => phaseFilePath(repoRoot, n))
  const present = paths.filter((p) => existsSync(p))
  const byPath = present.length > 0 ? bridgeImportMany(present, { consumerRoot }) : { ok: true, byPath: {} }
  if (!byPath.ok && byPath.kind === 'tsx-absent')
    throw new CollectError('tsx-absent', ['roadmap eval: cannot typed-read the member phase files', (byPath.stderr ?? '').trim()])

  const phases = memberNums.map((n) => {
    const p = phaseFilePath(repoRoot, n)
    const r = byPath.ok ? byPath.byPath[p] : undefined
    if (!existsSync(p)) {
      warnings.push(`phase ${n}: no file at ${p} — recorded as an unreadable phase`)
      return { phase: n, keyFiles: [], taskCount: 0, transparency: [], gateRuns: [], parseError: `no file at ${p}` }
    }
    if (!r || !r.ok) {
      const reason = ((r?.stderr ?? '') || 'phase file failed to import').trim().split('\n')[0] || 'phase file failed to import'
      warnings.push(`phase ${n}: ${reason}`)
      return { phase: n, keyFiles: [], taskCount: 0, transparency: [], gateRuns: [], parseError: reason }
    }
    const entry = phaseEntry(n, r.parsed)
    entry.gateRuns = summarizeGateRuns(repoRoot, n)
    return entry
  })
  // Gate runs for the quarantined phases too — the gate record survives a broken phase file.
  for (const entry of phases) if (entry.parseError) entry.gateRuns = summarizeGateRuns(repoRoot, entry.phase)

  // Resolved BEFORE the git facts, not with the other artifact reads below: the RunnerSummary's
  // filename date is the land record the escape window anchors on (option C), so the collector
  // must know it before it derives a boundary. The one resolution feeds both uses.
  const summaryDated = newestArtifactDated(join(repoRoot, 'roadmap', 'arc-summaries'), arcId, null)

  const trace = {
    arcId,
    collectedAt,
    phases,
    git: findArcGitFacts(repoRoot, memberNums, { exec, landAnchorDate: summaryDated?.date }),
  }
  // Every other degraded read warns; a failed escape scan is the one that most flatters the
  // arc, so it warns loudest rather than living only in a field nobody prints.
  if (trace.git.escapeScan === 'unavailable')
    warnings.push('the post-land escape scan could not run — escapeFixes is UNKNOWN, not zero')
  // `arcFiles` is a working set for the escape-fix intersection, not part of the contract.
  delete trace.git.arcFiles
  if (trace.git.landedAt === undefined) delete trace.git.landedAt

  const evalsDir = join(repoRoot, 'roadmap', 'arc-evals')
  for (const [field, suffix] of [
    ['sweep', 'sweep'],
    ['verdicts', 'verdicts'],
  ]) {
    const path = newestArtifact(evalsDir, arcId, suffix)
    if (!path) continue // honest absence — the scorer maps it to its sentinel
    const read = readJson(path)
    if (read.error) {
      warnings.push(`${path}: unreadable (${read.error}) — treated as absent`)
      continue
    }
    trace[field] = read.value
  }
  // roadmap/arc-summaries/ is gitignored by design: absent on a fresh clone is EXPECTED,
  // never a defect, which is why it warns only when a file exists and will not read.
  if (summaryDated) {
    const read = readJson(summaryDated.path)
    if (read.error) warnings.push(`${summaryDated.path}: unreadable (${read.error}) — treated as absent`)
    else trace.summary = read.value
  }

  return { trace, warnings }
}
