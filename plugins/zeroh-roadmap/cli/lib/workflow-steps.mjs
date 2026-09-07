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

/** The §4 typed-halt kinds. `stalled`/`exited`/`unobserved` carry the `roadmap watch` verdict JSON
 *  as evidence verbatim; every kind ends the workflow and hands the session the conversation.
 *  `unobserved` (2384.3) is behaviourally a halt like `stalled` but honestly labelled: no life
 *  signal could be probed, which is not evidence of death — the session judges with the evidence in
 *  hand rather than being told a stall it can act on by respawning. */
export const HALT_KINDS = [
  'blocked', 'escalated', 'failed', 'self-descope', 'stalled', 'exited', 'unobserved',
  'permission', 'auth', 'review-exhausted', 'gaps', 'pause-after', 'land-unproven',
]

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


// -- Canonical arc lifecycle reducer ----------------------------------------
const LIFECYCLE_STAGES = new Set(['phase', 'sweep', 'validate', 'land', 'delivery', 'evaluate', 'complete'])
const LIFECYCLE_EVENTS = new Set([
  'run-phase', 'resume-phase', 'done', 'sweep', 'validate', 'land', 'land-proven',
  'land-unproven', 'evaluate', 'complete', 'resume', 'correction', 'blocked',
  'escalated', 'failed', 'self-descope', 'stalled', 'exited', 'unobserved',
  'permission', 'auth', 'review-exhausted', 'gaps', 'pause-after',
])
const HALT_RESUME = {
  blocked: 'inspect-blocker',
  escalated: 'wait-user',
  'self-descope': 'wait-user',
  permission: 'wait-user',
  auth: 'wait-user',
  'review-exhausted': 'wait-user',
  failed: 'inspect-failure',
  stalled: 'reconcile',
  exited: 'reconcile',
  unobserved: 'reconcile',
  gaps: 'run-correction',
  'pause-after': 'relaunch-plane',
  'land-unproven': 'reconcile',
}
const ACTIVE_TRANSITIONS = {
  phase: {
    'run-phase': ['phase', 'relaunch-plane'],
    'resume-phase': ['phase', 'relaunch-plane'],
    done: ['phase', 'relaunch-plane'],
    sweep: ['sweep', 'run-sweep'],
  },
  sweep: { validate: ['validate', 'run-validate'] },
  validate: { land: ['land', 'run-land'] },
  land: { 'land-proven': ['delivery', 'run-evaluate'] },
  delivery: { evaluate: ['evaluate', 'run-evaluate'] },
  evaluate: { complete: ['complete', 'done'] },
  complete: {},
}
const RESUME_FOR_STAGE = {
  phase: 'relaunch-plane',
  sweep: 'run-sweep',
  validate: 'run-validate',
  land: 'run-land',
  delivery: 'run-evaluate',
  evaluate: 'run-evaluate',
}

function cloneLifecycle(value) {
  return value == null ? value : structuredClone(value)
}

function exactKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function nonBlank(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function authorityRefValid(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (value.status === 'known') {
    return exactKeys(value, ['status', 'envelopeDigest', 'source'])
      && nonBlank(value.envelopeDigest)
      && value.source && typeof value.source === 'object' && !Array.isArray(value.source)
      && exactKeys(value.source, ['kind', 'ref'])
      && ['codex-journal', 'managed-host-receipt'].includes(value.source.kind)
      && nonBlank(value.source.ref)
  }
  return value.status === 'unknown'
    && exactKeys(value, ['status', 'reason', 'sourceRef'])
    && ['read-only-projection', 'legacy-unrecorded', 'source-unreadable'].includes(value.reason)
    && (value.sourceRef === null || nonBlank(value.sourceRef))
}

function lifecycleStateValid(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return false
  if (!exactKeys(state, ['arcId', 'stage', 'status', 'processedEventIds', 'lastHalt', 'authorityRef'])) return false
  if (!nonBlank(state.arcId)) return false
  if (!LIFECYCLE_STAGES.has(state.stage) || !['active', 'halted', 'complete'].includes(state.status)) return false
  if (!Array.isArray(state.processedEventIds) || state.processedEventIds.some((id) => !nonBlank(id))) return false
  if (new Set(state.processedEventIds).size !== state.processedEventIds.length) return false
  if (!authorityRefValid(state.authorityRef)) return false
  if ((state.stage === 'complete') !== (state.status === 'complete')) return false
  if ((state.status === 'halted') !== (state.lastHalt != null)) return false
  if (state.lastHalt != null) {
    const halt = state.lastHalt
    if (!halt || typeof halt !== 'object' || Array.isArray(halt)) return false
    if (!exactKeys(halt, ['kind', 'phase', 'evidence', 'resume'])) return false
    if (!Object.hasOwn(HALT_RESUME, halt.kind) || halt.resume !== HALT_RESUME[halt.kind]) return false
    if (halt.phase !== null && (!Number.isInteger(halt.phase) || halt.phase < 1)) return false
    if (halt.kind === 'gaps' && state.stage !== 'validate') return false
    if (halt.kind === 'land-unproven' && state.stage !== 'land') return false
  }
  return true
}

function lifecycleEventValid(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return false
  const allowed = new Set(['eventId', 'arcId', 'source', 'type', 'phase', 'evidence', 'authorityRef'])
  if (Object.keys(event).some((key) => !allowed.has(key))) return false
  if (!nonBlank(event.eventId) || !nonBlank(event.arcId)) return false
  if (!nonBlank(event.source) || !LIFECYCLE_EVENTS.has(event.type)) return false
  if (event.phase !== undefined && (!Number.isInteger(event.phase) || event.phase < 1)) return false
  return event.authorityRef === undefined || authorityRefValid(event.authorityRef)
}

function rejectedTransition(prior, event, authorityRef, kind, reason) {
  const safeResume = kind === 'invalid-state'
    ? 'inspect-failure'
    : prior?.lastHalt?.resume ?? (prior?.status === 'complete' ? 'done' : (RESUME_FOR_STAGE[prior?.stage] ?? 'inspect-failure'))
  return {
    prior,
    next: cloneLifecycle(prior),
    event: cloneLifecycle(event),
    authorityRef: cloneLifecycle(authorityRef),
    resume: safeResume,
    rejection: { kind, eventId: typeof event?.eventId === 'string' ? event.eventId : null, reason },
  }
}

function requiredRecoveryEvidence(kind, evidence) {
  if (['blocked', 'stalled', 'exited', 'unobserved'].includes(kind)) return evidence?.reconciled === true
  if (kind === 'land-unproven') return evidence?.reconciled === true && evidence?.landed === true
  if (kind === 'failed') return evidence?.inspected === true
  if (['escalated', 'self-descope', 'permission', 'auth', 'review-exhausted'].includes(kind)) return evidence?.authorized === true
  return kind === 'pause-after'
}

/**
 * Apply one harness-neutral lifecycle event. Rejections are typed no-ops; the
 * reducer performs no I/O and carries only persisted authority references.
 */
export function reduceArcTransition(state, event) {
  const prior = cloneLifecycle(state)
  const suppliedAuthority = authorityRefValid(state?.authorityRef)
    ? state.authorityRef
    : { status: 'unknown', reason: 'source-unreadable', sourceRef: null }

  if (!lifecycleStateValid(state)) {
    return rejectedTransition(prior, event, suppliedAuthority, 'invalid-state', 'lifecycle state is malformed or incoherent')
  }
  if (!lifecycleEventValid(event)) {
    return rejectedTransition(prior, event, state.authorityRef, 'malformed-event', 'lifecycle event is malformed')
  }
  if (event.arcId !== state.arcId) {
    return rejectedTransition(prior, event, state.authorityRef, 'arc-mismatch', 'event arcId does not match state arcId')
  }
  if (state.processedEventIds.includes(event.eventId)) {
    return rejectedTransition(prior, event, state.authorityRef, 'duplicate-event', 'eventId was already processed')
  }

  let authorityRef = state.authorityRef
  if (event.authorityRef?.status === 'unknown' && event.authorityRef.reason === 'source-unreadable') {
    return rejectedTransition(prior, event, state.authorityRef, 'authority-conflict', 'unreadable authority source cannot authorize a transition')
  }
  if (event.authorityRef?.status === 'known' && state.authorityRef.status === 'known'
    && (event.authorityRef.envelopeDigest !== state.authorityRef.envelopeDigest
      || event.authorityRef.source.kind !== state.authorityRef.source.kind
      || event.authorityRef.source.ref !== state.authorityRef.source.ref)) {
    return rejectedTransition(prior, event, state.authorityRef, 'authority-conflict', 'known authority references conflict')
  }
  if (state.authorityRef.status === 'unknown' && event.authorityRef?.status === 'known') authorityRef = event.authorityRef

  let stage = state.stage
  let status = state.status
  let lastHalt = state.lastHalt
  let resume

  if (state.status === 'halted') {
    if (event.type === 'correction' && state.lastHalt.kind === 'gaps' && event.evidence?.corrected === true) {
      stage = 'sweep'
      status = 'active'
      lastHalt = null
      resume = 'run-sweep'
    } else if (event.type === 'resume' && requiredRecoveryEvidence(state.lastHalt.kind, event.evidence)) {
      stage = state.lastHalt.kind === 'land-unproven' ? 'delivery' : state.stage
      status = 'active'
      lastHalt = null
      resume = RESUME_FOR_STAGE[stage]
    }
  } else if (state.status === 'active') {
    const haltResume = HALT_RESUME[event.type]
    const haltAllowed = haltResume != null
      && (event.type !== 'gaps' || state.stage === 'validate')
      && (event.type !== 'land-unproven' || state.stage === 'land')
    if (haltAllowed) {
      status = 'halted'
      resume = haltResume
      lastHalt = {
        kind: event.type,
        phase: event.phase ?? null,
        evidence: cloneLifecycle(event.evidence ?? null),
        resume,
      }
    } else {
      const transition = ACTIVE_TRANSITIONS[state.stage]?.[event.type]
      if (transition) {
        ;[stage, resume] = transition
        if (stage === 'complete') status = 'complete'
      }
    }
  }

  if (!resume) {
    return rejectedTransition(prior, event, state.authorityRef, 'invalid-transition', `event '${event.type}' is invalid from ${state.status}/${state.stage}`)
  }

  const acceptedEvent = cloneLifecycle(event)
  const next = {
    ...cloneLifecycle(state),
    stage,
    status,
    processedEventIds: [...state.processedEventIds, event.eventId],
    lastHalt,
    authorityRef: cloneLifecycle(authorityRef),
  }
  return {
    prior,
    next,
    event: acceptedEvent,
    authorityRef: cloneLifecycle(authorityRef),
    resume,
    rejection: null,
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
  if (action === 'blocked' || action === 'gaps' || action === 'land-unproven') return 'halt'
  if (action === 'sweep' || action === 'validate' || action === 'land' || action === 'evaluate') return 'handoff'
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
  for (const t of phaseData.tasks ?? []) push(t?.acceptanceCriteria, 'task')
  push(phaseData.arcCriteria, 'arc')
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
function groomSerializedBacklog(source, phaseNumber, { allowAbsent }) {
  const call = source.indexOf('defineBacklog(')
  const close = source.lastIndexOf(')')
  if (call < 0 || close < call) return null
  const bodyStart = call + 'defineBacklog('.length
  const raw = source.slice(bodyStart, close).trim()
  if (!/^\{\s*"/.test(raw) && !/^\[\s*(?:\{|\])/.test(raw)) return null

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    return { error: `groomBacklogSource: malformed serialized backlog: ${e.message}` }
  }
  const lists = Array.isArray(parsed)
    ? [parsed]
    : Array.isArray(parsed?.tiers) && parsed.tiers.every((tier) => Array.isArray(tier?.items))
      ? parsed.tiers.map((tier) => tier.items)
      : null
  if (!lists) return { error: 'groomBacklogSource: serialized backlog has no flat entries or tier items' }
  const matches = lists.flat().filter((entry) => entry?.phase === phaseNumber)
  if (matches.length === 0) {
    return allowAbsent
      ? { source, alreadyAbsent: true }
      : { error: `groomBacklogSource: no backlog entry for phase ${phaseNumber}` }
  }
  if (matches.length > 1) return { error: `groomBacklogSource: ambiguous — ${matches.length} entries reference phase ${phaseNumber}` }
  for (const list of lists) {
    const index = list.findIndex((entry) => entry?.phase === phaseNumber)
    if (index >= 0) list.splice(index, 1)
  }
  return {
    source: source.slice(0, bodyStart) + JSON.stringify(parsed, null, 2) + source.slice(close),
  }
}

export function groomBacklogSource(source, phaseNumber, { allowAbsent = false } = {}) {
  if (typeof source !== 'string') return { error: 'groomBacklogSource: source must be a string' }
  const n = Number(phaseNumber)
  if (!Number.isInteger(n)) return { error: `groomBacklogSource: invalid phase number '${phaseNumber}'` }

  const serialized = groomSerializedBacklog(source, n, { allowAbsent })
  if (serialized) return serialized

  const lines = source.split('\n')
  const entryRe = new RegExp(`\\{\\s*phase:\\s*${n}\\b`)
  const entryIdxs = []
  lines.forEach((line, index) => {
    if (entryRe.test(line)) entryIdxs.push(index)
  })
  if (entryIdxs.length === 0) {
    const mentionsPhaseField = new RegExp(`["']?phase["']?\\s*:\\s*${n}\\b`).test(source)
    if (mentionsPhaseField) return { error: `groomBacklogSource: phase ${n} uses an unsupported backlog format` }
    return allowAbsent ? { source, alreadyAbsent: true } : { error: `groomBacklogSource: no backlog entry for phase ${n}` }
  }
  if (entryIdxs.length > 1) return { error: `groomBacklogSource: ambiguous — ${entryIdxs.length} entries reference phase ${n}` }

  const remove = new Set(entryIdxs)
  const selfRe = new RegExp(`\\b${n}\\b`)
  const numRe = /\b\d{2,}\b/g
  lines.forEach((line, index) => {
    const text = line.trim()
    if (!text.startsWith('//') && !text.startsWith('*')) return
    if (!selfRe.test(text)) return
    const nums = text.match(numRe)
    if (nums && nums.every((value) => Number(value) === n)) remove.add(index)
  })
  return { source: lines.filter((_, index) => !remove.has(index)).join('\n') }
}
