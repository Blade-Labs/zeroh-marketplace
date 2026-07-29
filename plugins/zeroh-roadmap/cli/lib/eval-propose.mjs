/**
 * eval-propose — the ELICIT stage: the committed eval corpus in, ratify-only proposals out
 * (arc EVALLOOP, phase 2016). ONE clustering implementation beside eval-collect / eval-score /
 * eval-scorecard, consumed by `roadmap eval propose` AND the trend page, so no second reader can
 * disagree about what recurs.
 *
 * ## Deterministic by construction, not by discipline
 * Every cluster key is read off a TYPED field — a ratchet row's dimension, a dimension's
 * sentinel, a workflow profile, a token extracted from a lesson by a fixed rule. Free-text
 * similarity would make two runs over one corpus disagree, and a loop whose output churns is a
 * loop nobody can diff. The classes below are the whole vocabulary; the pass cannot invent a
 * sixth, because FindingClassShape would refuse it and the rulings table is closed over the same
 * enum.
 *
 * ## The >=2 floor, and why a skip is COUNTED
 * A finding observed once is an anecdote. It emits nothing — but it is reported by count, never
 * dropped in silence: a silent drop is how a loop loses the finding it existed to surface. The
 * same holds for a cluster whose home lane cannot be derived. Both are refusals a reader can see.
 *
 * ## Lane is derived, never guessed
 * Capture gaps and protocol diet live in this plugin; a measured slide in scores is a habit of
 * the CONSUMER repo that produced it. A lesson key routes by its own home. A key with no
 * derivable home yields no proposal at all — "improve this, somewhere" is an observation, not a
 * proposal (arc EVALLOOP: a lane-less proposal is not ready).
 */
import { PENDING_JUDGE_SENTINEL } from './eval-score.mjs'

/** Below this a dimension is a recurring weak spot. Strict: a score sitting exactly on the
 *  threshold is not scoring below it, and a boundary that drifts by a rounding error would
 *  manufacture findings out of noise. */
export const LOW_SCORE_THRESHOLD = 70

/** The measured do-arc protocol-load budget recorded in the plugin's DIET-LEDGER.md, the same
 *  number `roadmap measure --assert 12000` gates on. Strictly greater is a breach: at the budget
 *  is within it. Sourcing the figure from the ledger rather than inventing one is what lets a
 *  reduction proposal cite tokens instead of a fabricated cost. */
export const PROTOCOL_LOAD_BUDGET_TOKENS = 12000

/** The corpus home, repo-relative, so every citation opens from the consumer root. */
const ARC_EVALS_DIR = 'roadmap/arc-evals'
const LESSONS_PATH = `${ARC_EVALS_DIR}/lessons.jsonl`

/** Where a proposal's home repo is, per finding class. `recurring-lesson-key` is absent on
 *  purpose: its lane comes from the KEY, not the class, and a default here would hand every
 *  un-homed lesson a lane it did not earn. */
const CLASS_LANE = {
  'recurring-sentinel': 'plugin-generic',
  'protocol-load-over-budget': 'plugin-generic',
  'recurring-regression': 'consumer-specific',
  'recurring-low-score': 'consumer-specific',
}

/** What SHAPE of change each class asks for. A measured slide proposes a review focus; a
 *  measurement gap proposes a tighter contract; a shared lesson proposes a process change; an
 *  over-budget load proposes a reduction. */
const CLASS_KIND = {
  'recurring-regression': 'review-focus-candidate',
  'recurring-low-score': 'review-focus-candidate',
  'recurring-sentinel': 'schema-tightening',
  'recurring-lesson-key': 'process-change',
  'protocol-load-over-budget': 'reduction',
}

/** Path fragments that identify a lesson key living in the PLUGIN repo. Anything else that is
 *  still path-shaped belongs to the consumer; anything not path-shaped has no home at all. */
const PLUGIN_HOME_MARKERS = ['zeroh-marketplace/plugins/zeroh-roadmap', 'cli/lib', 'skills/']

/** A backticked token, and a slash-bearing path token. The extractor takes whichever appears
 *  FIRST in the lesson text, so one rule reads both spellings and the key does not depend on
 *  which pattern happened to be tried first. */
const BACKTICK_TOKEN_RE = /`([^`\n]+)`/
const PATH_TOKEN_RE = /(^|[\s(])([A-Za-z0-9_.@-]*\/[A-Za-z0-9_./@-]+)/

/**
 * The repo-relative path a report was read from, reconstructed from the document itself. The
 * archive's naming rule (`<arcId>-<date>.json`, the inverse of the reader's REPORT_NAME_RE) is
 * what makes this exact, and reconstructing keeps the corpus reader — `readPriorReports` in
 * cli/commands/eval.mjs — as the ONE definition of "a report" instead of forking a second one
 * that also carries filenames.
 */
const reportPath = (r) => `${ARC_EVALS_DIR}/${r.arcId}-${r.date}.json`

/** Slug for a proposal id: the ProposalShape id regex is /^[a-z0-9-]+$/, so every other
 *  character folds to a hyphen. Stable over a cluster key, which is what makes a re-run land on
 *  the same file instead of accumulating near-duplicates. */
export const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** A cluster's proposal id — derived, so two runs over one corpus address the same file. */
export const proposalId = (cluster) => `${cluster.findingClass}-${slug(cluster.clusterKey)}`

/** The key a lesson is grouped by: the first backticked or path-shaped token in its text,
 *  lowercased so two spellings of one file (`SKILL.md` / `skill.md`) are one key rather than
 *  two singletons that each fall under the floor. */
export function extractLessonKey(text) {
  const s = String(text ?? '')
  const back = BACKTICK_TOKEN_RE.exec(s)
  const path = PATH_TOKEN_RE.exec(s)
  const backAt = back ? back.index : Infinity
  const pathAt = path ? path.index : Infinity
  if (backAt === Infinity && pathAt === Infinity) return null
  const token = backAt <= pathAt ? back[1] : path[2]
  const key = token.trim().toLowerCase()
  return key === '' ? null : key
}

/**
 * Every recurring-finding candidate the corpus supports, one per (class x key x SOURCE document).
 * Grouping happens later: this stage only reads, so a corpus that supports nothing yields an
 * empty array rather than a shrug.
 *
 * @param {object[]} reports parsed arc-eval reports, as `readPriorReports` returns them
 * @param {object[]} lessons parsed lesson records from the sidecar (absent sidecar => [])
 */
export function extractFindings(reports, lessons) {
  const findings = []
  const add = (findingClass, clusterKey, file, jsonPath, excerpt) =>
    findings.push({ findingClass, clusterKey, evidence: { file, jsonPath, excerpt } })

  for (const r of reports ?? []) {
    const file = reportPath(r)

    r.ratchet?.forEach((row, i) => {
      if (row?.regression !== true || !row.dimension) return
      add(
        'recurring-regression',
        row.dimension,
        file,
        `ratchet[${i}]`,
        `${row.dimension} regressed to ${row.value} against a baseline of ${row.baseline} (delta ${row.delta})`,
      )
    })

    for (const [dimension, d] of Object.entries(r.dimensions ?? {})) {
      // A sentinel and a score are mutually exclusive by contract, so the two branches below can
      // never both fire for one dimension.
      if (d?.sentinel) {
        // `pending-judge` is a PROMISE of a coming judge pass, not a measurement gap — proposing a
        // schema tightening for it would ask the user to fix something already scheduled to fix
        // itself. Every OTHER sentinel is a gap that will not close on its own.
        if (d.sentinel === PENDING_JUDGE_SENTINEL) continue
        add(
          'recurring-sentinel',
          `${dimension}:${d.sentinel}`,
          file,
          `dimensions.${dimension}.sentinel`,
          `${dimension} carries the ${d.sentinel} sentinel instead of a score`,
        )
      } else if (typeof d?.score === 'number' && d.score < LOW_SCORE_THRESHOLD) {
        add(
          'recurring-low-score',
          dimension,
          file,
          `dimensions.${dimension}.score`,
          `${dimension} scored ${d.score}, below the ${LOW_SCORE_THRESHOLD} threshold`,
        )
      }
    }

    // An absent workflow block records no token count, and an absent measurement is never a
    // breach — a pre-stamp report must not be read as a report that came in under budget either.
    const wf = r.workflow
    if (wf && typeof wf.protocolLoadTokens === 'number' && wf.protocolLoadTokens > PROTOCOL_LOAD_BUDGET_TOKENS)
      add(
        'protocol-load-over-budget',
        wf.profile,
        file,
        'workflow.protocolLoadTokens',
        `protocol load measured ${wf.protocolLoadTokens} tokens against the ${PROTOCOL_LOAD_BUDGET_TOKENS} budget on profile ${wf.profile}`,
      )
  }

  lessons?.forEach((l, i) => {
    const key = extractLessonKey(l?.text)
    if (key === null) return
    add('recurring-lesson-key', key, LESSONS_PATH, `lines[${i}]`, String(l.text))
  })

  return findings
}

/**
 * The importance half of the opportunity score: static, versioned DATA, in the
 * SPEED_REFERENCE_MINUTES_PER_TASK mould (cli/lib/eval-score.mjs). It is compile-time constants
 * rather than configuration for the reason the ratchet cannot survive otherwise — two machines
 * reading one corpus must not produce incomparable priorities. Changing a value here is a knowing
 * re-prioritization of every consumer's queue: bump `version`, so the change arrives as a visible
 * diff in a versioned table instead of as a quietly different ordering.
 *
 * The ranking these encode: a measured slide outranks a low absolute score (a slide is the loop's
 * reason to exist); an unmeasured dimension outranks neither but beats a shared lesson, because a
 * gap in measurement is the scores lying by omission while a shared lesson is already written down.
 */
export const IMPORTANCE_RULINGS = {
  version: 1,
  ratified: '2026-07-28',
  rulings: [
    {
      id: 'importance-recurring-regression',
      findingClass: 'recurring-regression',
      importance: 8,
      rationale: 'a measured slide against a rolling baseline is the loop\'s reason to exist, so it outranks every other class',
    },
    {
      id: 'importance-recurring-low-score',
      findingClass: 'recurring-low-score',
      importance: 7,
      rationale: 'a dimension that is repeatedly weak is a standing cost, but a stable weakness is less urgent than a fresh slide',
    },
    {
      id: 'importance-recurring-sentinel',
      findingClass: 'recurring-sentinel',
      importance: 6,
      rationale: 'an unmeasured dimension is the scores lying by omission, and a gap that recurs will not close on its own',
    },
    {
      id: 'importance-protocol-load-over-budget',
      findingClass: 'protocol-load-over-budget',
      importance: 6,
      rationale: 'protocol load over the measured budget is a cost paid on every run, and the ledger already says what it costs',
    },
    {
      id: 'importance-recurring-lesson-key',
      findingClass: 'recurring-lesson-key',
      importance: 5,
      rationale: 'a lesson repeated across arcs is real signal, but it is already written down, so it is the least urgent class',
    },
  ],
}

/** The named refusal a null satisfaction carries. ONE literal for every unmeasurable case, so a
 *  reader can grep the corpus for what the loop declined to measure; free prose that varied per
 *  cluster would make that impossible. */
export const SATISFACTION_UNMEASURED = 'satisfaction-unmeasured'

/** Six places: enough to keep a real difference, few enough that float noise cannot fake one. */
const round6 = (n) => Math.round(n * 1e6) / 1e6

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length

/** The reports a cluster actually CITED, matched by the path its evidence names. The measured
 *  input has to come from the cluster's own citations rather than from a re-filter of the corpus:
 *  a reader checking the number opens exactly those files, and a second filtering rule here could
 *  disagree with the one that built the evidence. */
function citedReports(cluster, reports) {
  const cited = new Set(cluster.evidence.map((e) => e.file))
  return (reports ?? []).filter((r) => cited.has(reportPath(r)))
}

/** The dimension a cluster is about: the key itself, or the part before the sentinel name. */
const clusterDimension = (cluster) =>
  cluster.findingClass === 'recurring-sentinel' ? cluster.clusterKey.slice(0, cluster.clusterKey.indexOf(':')) : cluster.clusterKey

/**
 * The MEASURED half. Returns { satisfaction, satisfactionSource } — satisfaction on the 0..10
 * scale, or null when the corpus cannot measure it at all.
 *
 * Every branch reads the corpus and names what it read. The one thing none of them may do is
 * substitute a zero for an absent measurement: a zero reads as "measured, and terrible", which
 * would float exactly the proposals nobody has evidence for to the top of the queue.
 */
function measureSatisfaction(cluster, reports) {
  const all = reports ?? []
  const dimension = clusterDimension(cluster)

  if (cluster.findingClass === 'recurring-lesson-key')
    // No dimension backs a lesson key. There is nothing in the corpus to be satisfied ABOUT.
    return { satisfaction: null, satisfactionSource: SATISFACTION_UNMEASURED }

  if (cluster.findingClass === 'protocol-load-over-budget') {
    const measured = citedReports(cluster, all)
      .map((r) => r.workflow?.protocolLoadTokens)
      .filter((t) => typeof t === 'number')
    if (measured.length === 0) return { satisfaction: null, satisfactionSource: SATISFACTION_UNMEASURED }
    const measuredMean = mean(measured)
    // Clamped at 1 before scaling: a load UNDER budget is fully satisfied and no more than fully.
    // An unclamped ratio would leave the 0..10 range every other class is compared on.
    return {
      satisfaction: round6(10 * Math.min(PROTOCOL_LOAD_BUDGET_TOKENS / measuredMean, 1)),
      satisfactionSource: `budget ${PROTOCOL_LOAD_BUDGET_TOKENS} over a measured mean of ${round6(measuredMean)} tokens across ${measured.length} cited report(s)`,
    }
  }

  const scored = all.map((r) => r.dimensions?.[dimension]).filter((d) => typeof d?.score === 'number')

  if (cluster.findingClass === 'recurring-sentinel')
    // COVERAGE as satisfaction: the finding IS that the dimension goes unmeasured, so how often it
    // IS measured is the honest read of how satisfied that need already is.
    return {
      satisfaction: all.length === 0 ? null : round6((10 * scored.length) / all.length),
      satisfactionSource:
        all.length === 0
          ? SATISFACTION_UNMEASURED
          : `${dimension} scored in ${scored.length} of ${all.length} reports (coverage as satisfaction)`,
    }

  // Dimension-backed: how well the corpus scores the dimension IS how satisfied the need is. A
  // sentinelled report carries no score and is EXCLUDED rather than averaged in as a zero.
  if (scored.length === 0) return { satisfaction: null, satisfactionSource: SATISFACTION_UNMEASURED }
  return {
    satisfaction: round6(mean(scored.map((d) => d.score)) / 10),
    satisfactionSource: `mean of ${scored.length} scored ${dimension} values across ${all.length} reports`,
  }
}

/**
 * The proposal prioritizer (design doc, Numbers program):
 *   score = importance + max(importance - satisfaction, 0)
 *
 * ONE exported function, so the CLI, the trend page and any later consumer rank identically. The
 * gap term is floored at zero: a well-served class must never score BELOW its own ruling, because
 * a negative contribution would let satisfaction DEMOTE a class rather than merely fail to promote
 * it. An unmeasured satisfaction contributes nothing at all — exactly importance, never importance
 * doubled — which is what stops an unmeasurable class out-ranking a measured one on nothing.
 */
export function computeOpportunity(cluster, reports) {
  const ruling = IMPORTANCE_RULINGS.rulings.find((r) => r.findingClass === cluster.findingClass)
  if (!ruling)
    // Unreachable while the table and FindingClassShape stay closed over the same enum — which is
    // why this must throw rather than default. A default importance is precisely what would let
    // editing one without the other ship as a plausible number nobody ratified.
    throw new Error(
      `eval-propose: no importance ruling for finding class '${cluster.findingClass}' — IMPORTANCE_RULINGS v${IMPORTANCE_RULINGS.version} ` +
        'must carry exactly one row per finding class',
    )

  const { satisfaction, satisfactionSource } = measureSatisfaction(cluster, reports)
  return {
    importance: ruling.importance,
    satisfaction,
    score: satisfaction === null ? ruling.importance : ruling.importance + Math.max(ruling.importance - satisfaction, 0),
    rulingId: ruling.id,
    rulingsVersion: IMPORTANCE_RULINGS.version,
    satisfactionSource,
  }
}

/** The loop's own write-origin stamp. Consolidation touches a file only when it reads back this
 *  exact literal: anything else — including a value this code has never seen — is somebody else's. */
export const WRITE_ORIGIN = 'roadmap-eval-loop'

/** The one reason string an auto-archive carries, so a reader can grep for it. */
const ARCHIVED_REASON_DISSOLVED = 'no-longer-clustered'

/** The flow the protocol-load budget is measured over, and the ledger that recorded it. */
const REDUCTION_FLOW = 'do-arc'
const DIET_LEDGER = 'DIET-LEDGER.md'

/** A human sentence for a class, used in titles and rationales. */
const CLASS_PHRASE = {
  'recurring-regression': 'regressed repeatedly',
  'recurring-low-score': 'scores below the low-score threshold repeatedly',
  'recurring-sentinel': 'goes unmeasured repeatedly',
  'recurring-lesson-key': 'recurs across captured lessons',
  'protocol-load-over-budget': 'runs over the measured protocol-load budget',
}

/** Key-sorted JSON, for comparing two documents without depending on key order. */
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`)
      .join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

/**
 * The document a cluster becomes: a complete ProposalShape payload, stamped `surfaced` and
 * origin-marked as the loop's own.
 *
 * `surfaced` is the ONLY status this function can produce. `ratified` and `rejected` are user
 * acts, and a pass able to mint them would be a pass able to approve its own proposals — the
 * proposer-is-never-the-actor rail, expressed as the one value this code may write.
 */
export function buildProposal(cluster, reports, nowIso) {
  const opportunity = computeOpportunity(cluster, reports)
  const doc = {
    id: proposalId(cluster),
    findingClass: cluster.findingClass,
    lane: cluster.lane,
    kind: cluster.kind,
    title: `${cluster.clusterKey} ${CLASS_PHRASE[cluster.findingClass]} across ${cluster.evidence.length} arc evals`,
    rationale:
      `${cluster.evidence.length} independent sources in the committed eval corpus record that ${cluster.clusterKey} ` +
      `${CLASS_PHRASE[cluster.findingClass]}. Routed to the ${cluster.lane} lane; opportunity ${opportunity.score} ` +
      `(importance ${opportunity.importance}, satisfaction ${opportunity.satisfaction === null ? 'unmeasured' : opportunity.satisfaction}). ` +
      'SURFACED ONLY: nothing changes until a human ratifies this.',
    evidence: cluster.evidence,
    opportunity,
    writeOrigin: WRITE_ORIGIN,
    status: 'surfaced',
    createdAt: nowIso,
    updatedAt: nowIso,
  }

  if (cluster.kind === 'review-focus-candidate') doc.candidateReviewFocus = cluster.candidateReviewFocus ?? candidateReviewFocusFor(cluster)
  if (cluster.kind === 'reduction') {
    const measured = cluster.evidence
      .map((e) => Number(/measured (\d+) tokens/.exec(e.excerpt)?.[1]))
      .filter((n) => Number.isFinite(n) && n > 0)
    doc.reductionTarget = {
      flow: REDUCTION_FLOW,
      // The MEAN of the cited measurements, rounded to a whole token. Derived from the cluster's
      // own citations, so the figure a reader recomputes from the evidence is the figure here —
      // and it is TOKENS, never a currency estimate the corpus cannot support.
      measuredTokens: Math.round(mean(measured)),
      budgetTokens: PROTOCOL_LOAD_BUDGET_TOKENS,
      ledger: DIET_LEDGER,
    }
  }
  return doc
}

/**
 * Consolidate the pass's own prior proposals and write the current set.
 *
 * Every seam is INJECTED and required — `fs`, `now`, `validate`. A defaulted fs is how a
 * test-time pass writes to the real tree, and a defaulted validator is how an unparseable
 * document reaches disk; neither has a safe fallback, so neither gets one.
 *
 * ## What this function may touch
 * Files directly under `proposalsDir`, named `<id>.json`, whose parsed `writeOrigin` is this
 * loop's own. Nothing else, ever. A foreign-origin or unparseable file is left byte-identical —
 * not reformatted, not repaired — and reported by name. A `ratified` or `rejected` file is the
 * USER'S verdict and outranks a regenerated cluster carrying the same id; an `archived` file the
 * loop wrote is likewise not revived. The two refusals are counted apart because "you decided"
 * and "the loop archived it" are different facts.
 *
 * ## Why nothing is ever removed
 * A dissolved cluster's proposal is ARCHIVED IN PLACE: status flipped, reason stamped, bytes kept.
 * There is no removal path in this module at all, and its test asserts that by scanning the source
 * as well as by recording the fs calls — the Hermes lesson is that a self-writing artifact needs a
 * structural bound, not a careful author.
 *
 * ## Why a validated document is buffered before any of it is written
 * Every document that WILL be written is built and validated first; only then does anything reach
 * the fs seam. A validation failure therefore leaves the directory exactly as it found it, rather
 * than half a run's worth of files and one exception.
 */
export function consolidateAndWrite(clusters, reports, proposalsDir, deps) {
  if (!deps || typeof deps !== 'object') throw new Error('eval-propose: consolidateAndWrite requires a deps object carrying fs, now and validate')
  for (const name of ['fs', 'now', 'validate'])
    if (!deps[name]) throw new Error(`eval-propose: consolidateAndWrite requires an injected '${name}' — there is no safe default for it`)
  const { fs, now, validate } = deps
  const nowIso = now()

  fs.mkdirSync(proposalsDir, { recursive: true })

  // ── read what is already there, and sort it by who owns it ──────────────────────────
  const existingOwn = new Map()
  const foreignSkipped = []
  const unreadable = []
  // Guarded rather than assumed: under a no-op fs (the --dry-run lane) mkdirSync creates nothing,
  // and a missing directory there is an empty prior set, not a crash.
  for (const name of fs.existsSync(proposalsDir) ? fs.readdirSync(proposalsDir) : []) {
    // A non-JSON file in this directory is not a proposal and is none of the loop's business.
    if (!name.endsWith('.json')) continue
    const path = `${proposalsDir}/${name}`
    let doc
    try {
      doc = JSON.parse(fs.readFileSync(path, 'utf8'))
    } catch {
      unreadable.push(name)
      continue
    }
    if (!doc || doc.writeOrigin !== WRITE_ORIGIN) {
      foreignSkipped.push(name)
      continue
    }
    existingOwn.set(doc.id ?? name.replace(/\.json$/, ''), { name, path, doc })
  }

  // ── decide, build and validate; write nothing yet ───────────────────────────────────
  const pending = []
  const proposals = []
  let created = 0
  let refreshed = 0
  let unchanged = 0
  let archived = 0
  let alreadyAdjudicated = 0
  let skippedArchived = 0

  const liveIds = new Set()
  for (const cluster of clusters ?? []) {
    const id = proposalId(cluster)
    liveIds.add(id)
    const existing = existingOwn.get(id)

    if (existing && (existing.doc.status === 'ratified' || existing.doc.status === 'rejected')) {
      alreadyAdjudicated += 1
      continue
    }
    if (existing && existing.doc.status === 'archived') {
      skippedArchived += 1
      continue
    }

    const fresh = buildProposal(cluster, reports, nowIso)
    if (!existing) {
      created += 1
      pending.push({ path: `${proposalsDir}/${id}.json`, doc: fresh })
      proposals.push(fresh)
      continue
    }

    // A refresh keeps the proposal's birthday and moves its updatedAt only when the content
    // actually moved: bumping the stamp on every run would churn the committed diff and make
    // "what changed since I last looked" unanswerable.
    const candidate = { ...fresh, createdAt: existing.doc.createdAt ?? fresh.createdAt, updatedAt: existing.doc.updatedAt ?? nowIso }
    if (stableJson(candidate) === stableJson(existing.doc)) {
      unchanged += 1
      proposals.push(existing.doc)
      continue
    }
    candidate.updatedAt = nowIso
    refreshed += 1
    pending.push({ path: existing.path, doc: candidate })
    proposals.push(candidate)
  }

  // A surfaced proposal whose cluster dissolved: archived IN PLACE, never removed.
  for (const [id, existing] of existingOwn) {
    if (liveIds.has(id) || existing.doc.status !== 'surfaced') continue
    archived += 1
    pending.push({
      path: existing.path,
      doc: { ...existing.doc, status: 'archived', archivedReason: ARCHIVED_REASON_DISSOLVED, updatedAt: nowIso },
    })
  }

  // ── the ONE write path: validate at the seam, refuse any target outside the directory ──
  const writes = []
  const serialized = pending.map(({ path, doc }) => {
    if (path !== `${proposalsDir}/${doc.id}.json`)
      throw new Error(`eval-propose: refusing to write ${path} — a proposal writes to <proposalsDir>/<id>.json and nowhere else`)
    return { path, bytes: `${JSON.stringify(validate(doc), null, 2)}\n` }
  })
  for (const { path, bytes } of serialized) {
    fs.writeFileSync(path, bytes)
    writes.push(path)
  }

  return { proposals, created, refreshed, unchanged, archived, alreadyAdjudicated, skippedArchived, foreignSkipped, unreadable, writes }
}

/** Which repo a cluster asks to change, or null when the corpus cannot say. */
function deriveLane(findingClass, clusterKey) {
  const byClass = CLASS_LANE[findingClass]
  if (byClass) return byClass
  if (findingClass !== 'recurring-lesson-key') return null
  // Not path-shaped => a bare token naming no file in any repo. It clears the evidence floor and
  // still cannot be routed, which is exactly the case the skippedNoLane count exists to show.
  if (!clusterKey.includes('/')) return null
  return PLUGIN_HOME_MARKERS.some((m) => clusterKey.includes(m)) ? 'plugin-generic' : 'consumer-specific'
}

/**
 * The CANDIDATE reviewFocus entry a review-focus class proposes, mirroring the consumer's
 * roadmap.config.json {id, signature, guidance} entry shape.
 *
 * The signature names the FAILURE CLASS, not yet a code pattern, and the guidance says so out
 * loud. Synthesizing a plausible-looking regex here would hand the user something that greps
 * real files for a rule nobody wrote — a fabricated artifact wearing a ratified one's clothes.
 * The candidate carries what the corpus actually knows; ratification supplies the rest.
 */
function candidateReviewFocusFor(cluster) {
  return {
    id: proposalId(cluster),
    signature: cluster.clusterKey,
    guidance:
      `CANDIDATE ONLY, not a ratified reviewFocus entry: ${cluster.evidence.length} arc evals recorded a ` +
      `${cluster.findingClass.replace('recurring-', 'recurring ')} on ${cluster.clusterKey}. The signature names that ` +
      'failure class rather than a code pattern; ratification is where it becomes a grep worth running.',
  }
}

/**
 * Group findings into emittable clusters.
 *
 * @returns {{clusters: object[], skippedSingletons: number, skippedNoLane: number}}
 *   `clusters` carry >=2 evidence entries AND a lane, always. The two counts are the refusals,
 *   reported so the caller can print them: what the loop declined to propose is as informative
 *   as what it did.
 */
export function clusterFindings(findings) {
  // Insertion-ordered, so cluster order follows corpus order rather than hash order — a re-run
  // must not churn the output's shape.
  const groups = new Map()
  for (const f of findings ?? []) {
    // JSON.stringify over the pair, so a key containing the separator (sentinel keys carry ':')
    // can never collide with a different pair that happens to spell the same joined string.
    const k = JSON.stringify([f.findingClass, f.clusterKey])
    const g = groups.get(k)
    if (g) g.evidence.push(f.evidence)
    else groups.set(k, { findingClass: f.findingClass, clusterKey: f.clusterKey, evidence: [f.evidence] })
  }

  const clusters = []
  let skippedSingletons = 0
  let skippedNoLane = 0
  for (const g of groups.values()) {
    if (g.evidence.length < 2) {
      skippedSingletons += 1
      continue
    }
    const lane = deriveLane(g.findingClass, g.clusterKey)
    if (lane === null) {
      skippedNoLane += 1
      continue
    }
    const cluster = {
      findingClass: g.findingClass,
      clusterKey: g.clusterKey,
      lane,
      kind: CLASS_KIND[g.findingClass],
      evidence: g.evidence,
    }
    if (cluster.kind === 'review-focus-candidate') cluster.candidateReviewFocus = candidateReviewFocusFor(cluster)
    clusters.push(cluster)
  }
  return { clusters, skippedSingletons, skippedNoLane }
}
