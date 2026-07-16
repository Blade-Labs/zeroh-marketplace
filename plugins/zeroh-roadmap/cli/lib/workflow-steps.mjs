/**
 * workflow-steps — the PURE decision seams the per-plane workflow composes from
 * (ROADCODE-DESIGN §4). The §4 workflow is ~30 lines of composition; its decisions —
 * what halts, what ends a plane, what counts as a self-descope, what the executor prompt
 * contains, how a backlog entry grooms — live HERE as pure data-in/data-out functions so a
 * test can pin every branch without running a workflow (the arc's honesty rail: typed
 * payloads and exit codes, never narration).
 *
 * PURE by contract: no fs, no child_process, no network — the workflow (cli/commands +
 * workflows/) does the impure CLI/fs work and feeds these already-fetched values in.
 */

/** The §4 typed-halt kinds. `stalled`/`exited` carry the `roadmap watch` verdict JSON as
 *  evidence verbatim; every kind ends the workflow and hands the session the conversation. */
export const HALT_KINDS = ['blocked', 'escalated', 'failed', 'self-descope', 'stalled', 'exited']

/** The FIXED resume line every halt carries (locked decision 3: files are the only truth —
 *  resume after ANY halt/kill is always the same act; `arc next` re-derives from disk). */
export const RESUME_LINE =
  'resume: relaunch the plane workflow — `roadmap arc next <arcId>` fast-forwards from disk (files are the only truth)'

/**
 * buildHaltPayload(kind, detail) → the §4 typed halt payload. Carries the phase, the
 * evidence verbatim (the `roadmap arc next` / `result check` / `watch` JSON the caller
 * already holds — never re-serialized/narrated), and the fixed resume line. An unknown kind
 * throws (fail-loud — a halt is never invented).
 */
export function buildHaltPayload(kind, detail = {}) {
  if (!HALT_KINDS.includes(kind)) {
    throw new Error(`buildHaltPayload: unknown halt kind '${kind}' (expected one of ${HALT_KINDS.join(', ')})`)
  }
  return {
    halt: kind,
    phase: detail.phase ?? null,
    evidence: detail.evidence ?? null,
    resume: RESUME_LINE,
  }
}

/**
 * classifyBandRoute(band, force?) → the band-routing consequence (design §4 band echo).
 * `mid` → spawn an executor; `trivial`/`heavy` → a handoff-inline payload (the session runs
 * that phase INLINE under the thin do-phase arc-mode / inline-supervised rules). force
 * ∈ {inline, recursion} overrides the band verdict (the --inline/--recursion launch args):
 * `recursion` forces the executor spawn, `inline` forces the inline handoff. Unknown
 * band/force throws (fail-loud).
 */
export function classifyBandRoute(band, force) {
  if (force === 'recursion') return { route: 'spawn', band: band ?? null, forced: 'recursion' }
  if (force === 'inline') return { route: 'handoff-inline', band: band ?? null, forced: 'inline' }
  if (force != null) throw new Error(`classifyBandRoute: unknown force '${force}' (expected 'inline' | 'recursion')`)
  if (band === 'mid') return { route: 'spawn', band }
  if (band === 'trivial' || band === 'heavy') return { route: 'handoff-inline', band }
  throw new Error(`classifyBandRoute: unknown band '${band}' (expected 'trivial' | 'mid' | 'heavy')`)
}

/**
 * classifyNextAction(next, plane) → one of {run, complete, halt, plane-done, handoff} per §4.
 *
 * Order matters and DEVIATES from §4's pseudocode order deliberately (recorded in the phase
 * transparencyReport): the judgment-heavy terminals (sweep/validate/land) are checked BEFORE
 * plane membership, because 1657's terminal actions carry no `phase` field — a
 * plane-membership-first order would misclassify them plane-done and leave `handoff`
 * unreachable. §4's stated semantics make handoff the correct precedence.
 *
 * Plane membership: a `plane.phases` array is checked with `.includes(next.phase)`; when the
 * caller passes only `{ name }` (the workflow's cheap path), `next.plane === plane.name` is
 * used instead — `next.plane` is derive.mjs's per-`arc next`-call re-resolution from the arc
 * file, so it satisfies files-are-truth (locked decision 3) without a redundant arc read.
 */
export function classifyNextAction(next, plane) {
  const action = next?.action
  if (action === 'complete') return 'complete'
  if (action === 'blocked') return 'halt'
  if (action === 'sweep' || action === 'validate' || action === 'land') return 'handoff'
  if (action !== 'run-phase' && action !== 'resume-phase') {
    throw new Error(`classifyNextAction: unhandled arc-next action '${action}'`)
  }
  const inPlane =
    plane && Array.isArray(plane.phases)
      ? plane.phases.includes(next.phase)
      : next?.plane != null && plane?.name != null && next.plane === plane.name
  return inPlane ? 'run' : 'plane-done'
}

// ── detectSelfDescope ──────────────────────────────────────────────────────────────────
// A short stopword set so the significant-word overlap is not fooled by connective tissue.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'over', 'under', 'when', 'then',
  'than', 'only', 'never', 'always', 'must', 'some', 'none', 'used', 'using', 'instead', 'live',
  'call', 'have', 'were', 'was', 'are', 'via', 'per', 'not', 'but', 'its', 'all', 'one', 'two',
])

function significantWords(text) {
  const out = new Set()
  for (const w of String(text ?? '').toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []) {
    if (!STOPWORDS.has(w)) out.add(w)
  }
  return out
}

/** Normalize a compromises/skipped field (string "None", string[], or object[]) → entries
 *  of { text, decisionRef }. The literal "None" and empty inputs yield []. */
function asEntries(field) {
  if (field == null) return []
  if (typeof field === 'string') return field.trim() === '' || field.trim() === 'None' ? [] : [{ text: field, decisionRef: null }]
  if (!Array.isArray(field)) return []
  const out = []
  for (const e of field) {
    if (e == null) continue
    if (typeof e === 'string') {
      if (e.trim() === '' || e.trim() === 'None') continue
      out.push({ text: e, decisionRef: null })
    } else {
      const text = e.text ?? e.description ?? e.item ?? e.note ?? ''
      out.push({ text, decisionRef: e.decisionRef ?? null })
    }
  }
  return out
}

/** Gather the criteria to test a compromise against, each tagged kind 'task' | 'arc'. */
function collectCriteria(phaseData = {}) {
  const out = []
  const push = (arr, kind) => {
    for (const c of arr ?? []) {
      const text = typeof c === 'string' ? c : c?.text ?? c?.criterion ?? c?.job ?? ''
      if (text) out.push({ text, kind })
    }
  }
  push(phaseData.acceptanceCriteria, 'task')
  push(phaseData.taskCriteria, 'task')
  for (const t of phaseData.tasks ?? []) push(t?.acceptanceCriteria, 'task')
  push(phaseData.arcCriteria, 'arc')
  push(phaseData.arcAcceptanceCriteria, 'arc')
  return out
}

/**
 * detectSelfDescope(result, phaseData) → the criterion-narrowing check as CODE (§4). Scans
 * result.compromises/skipped for entries that NARROW a task or arc acceptance criterion —
 * significant-word overlap ≥ 2 against a criterion, EXCLUDING entries that carry a
 * `decisionRef` (an architect-blessed, boundary-respecting trade-off is routine, per the 1367
 * validator). Returns the matched narrowings (empty array = routine). The bounce-vs-ratify
 * CALL stays HUMAN (pre-made decision 3) — this function only DETECTS.
 */
export function detectSelfDescope(result, phaseData = {}) {
  const criteria = collectCriteria(phaseData)
  if (criteria.length === 0) return []
  const entries = [...asEntries(result?.compromises), ...asEntries(result?.skipped)]
  const matches = []
  for (const e of entries) {
    if (e.decisionRef) continue // architect-blessed → routine, never a self-descope
    const ew = significantWords(e.text)
    if (ew.size === 0) continue
    for (const c of criteria) {
      const cw = significantWords(c.text)
      let overlap = 0
      for (const w of ew) if (cw.has(w)) overlap++
      if (overlap >= 2) {
        matches.push({ entry: e.text, criterion: c.text, kind: c.kind, overlap })
        break
      }
    }
  }
  return matches
}

// ── buildExecutorPrompt ────────────────────────────────────────────────────────────────
function renderGatePlan(plan) {
  if (!plan || typeof plan !== 'object') return '_no gate plan_'
  const lines = []
  const slots = (plan.slots ?? []).map((s) => s.slot).join(', ')
  lines.push(`slots: ${slots || '_none_'}`)
  lines.push(`testScope: ${plan.testScope?.effective ?? '?'} · reviewScope: ${plan.reviewScope?.effective ?? '?'}`)
  const floors = []
  if (plan.testScope?.floorReason) floors.push(`test:${plan.testScope.floorReason}`)
  if (plan.reviewScope?.refused) floors.push(`review-refused:${plan.reviewScope.refused}`)
  lines.push(`floors: ${floors.length ? floors.join(' · ') : 'none'}`)
  const reviewers = (plan.agents?.reviewers ?? []).join(', ')
  lines.push(`agents: round0=${plan.agents?.round0 ?? '?'} reviewers=[${reviewers}]`)
  return lines.join('\n')
}

function renderBeacons(beaconEvents) {
  const events = beaconEvents ?? []
  if (events.length === 0) return '_no prior beacon events (fresh spawn)_'
  const lines = []
  for (const ev of events) {
    if (ev?.event === 'background-run') {
      // A live detached run — surface pid/log/DONE-marker VERBATIM so a resuming executor
      // REDISCOVERS it and never re-launches a run already in flight.
      lines.push(
        `- background-run: pid=${ev.pid ?? '?'} sid=${ev.sid ?? '?'} host=${ev.host ?? 'local'} `
        + `log=${ev.log ?? '?'} done-marker=${ev.doneMarker ?? ev.done ?? '?'}`,
      )
    } else {
      lines.push(`- ${ev?.event ?? '?'}${ev?.task ? ` (task ${ev.task})` : ''}${ev?.ts ? ` @ ${ev.ts}` : ''}`)
    }
  }
  return lines.join('\n')
}

/**
 * buildExecutorPrompt({ phaseFilePath, phaseSource, gatePlan, designRefs, beaconEvents }) →
 * the executor prompt assembly (§4: phase file + gate plan + design refs + resume evidence).
 * Deterministic string out; NO CLI/fs calls inside (the workflow passes the already-fetched
 * plan JSON and already-read beacon lines in) — so it is byte-stable for equal input.
 */
export function buildExecutorPrompt({ phaseFilePath, phaseSource, gatePlan, designRefs, beaconEvents } = {}) {
  const lines = []
  lines.push('# Phase execution — run do-phase for this ONE phase, end to end')
  lines.push('')
  lines.push(`Phase file: ${phaseFilePath ?? '?'}`)
  lines.push('')
  lines.push('## Resolved gate plan (from `roadmap gate plan --json` — do NOT re-derive slots/scopes)')
  lines.push(renderGatePlan(gatePlan))
  lines.push('')
  lines.push('## Design refs — build AGAINST these')
  if (!designRefs || designRefs.length === 0) lines.push('- _none recorded_')
  else for (const d of designRefs) lines.push(`- ${d.kind ?? '?'}/${d.status ?? '?'} \`${d.ref ?? '?'}\` — ${d.summary ?? ''}`.trimEnd())
  lines.push('')
  lines.push('## Resume evidence — latest beacon events for this phase')
  lines.push('(a background-run below means a detached run is ALIVE — rediscover it, never re-launch)')
  lines.push(renderBeacons(beaconEvents))
  lines.push('')
  lines.push('## Phase file source')
  lines.push('```ts')
  lines.push(phaseSource ?? '')
  lines.push('```')
  return lines.join('\n')
}

/**
 * groomBacklogSource(source, phaseNumber) → pure text transform removing the phase's
 * one-line backlog entry (`{ phase: N, name: … }`) plus comment lines that are single-phase
 * narrative naming ONLY N. Returns { source } on a CLEAN single match, or { error } when the
 * entry is absent or ambiguous — the workflow turns { error } into a typed halt, never a
 * silent skip (pre-made decision 2).
 */
export function groomBacklogSource(source, phaseNumber) {
  if (typeof source !== 'string') return { error: 'groomBacklogSource: source must be a string' }
  const n = Number(phaseNumber)
  if (!Number.isInteger(n)) return { error: `groomBacklogSource: invalid phase number '${phaseNumber}'` }
  const lines = source.split('\n')
  const entryRe = new RegExp(`\\{\\s*phase:\\s*${n}\\b`)
  const entryIdxs = []
  lines.forEach((l, i) => {
    if (entryRe.test(l)) entryIdxs.push(i)
  })
  if (entryIdxs.length === 0) return { error: `groomBacklogSource: no backlog entry for phase ${n}` }
  if (entryIdxs.length > 1) return { error: `groomBacklogSource: ambiguous — ${entryIdxs.length} entries reference phase ${n}` }

  const remove = new Set(entryIdxs)
  const selfRe = new RegExp(`\\b${n}\\b`)
  const numRe = /\b\d{2,}\b/g
  lines.forEach((l, i) => {
    const t = l.trim()
    if (!t.startsWith('//') && !t.startsWith('*')) return
    if (!selfRe.test(t)) return
    const nums = t.match(numRe)
    // remove ONLY when every multi-digit token in the comment IS this phase (single-phase
    // narrative). A comment naming any other number/date/phase is left untouched.
    if (nums && nums.every((x) => Number(x) === n)) remove.add(i)
  })
  return { source: lines.filter((_, i) => !remove.has(i)).join('\n') }
}
