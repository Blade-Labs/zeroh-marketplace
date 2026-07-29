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
