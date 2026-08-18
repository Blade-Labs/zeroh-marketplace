#!/usr/bin/env node
/**
 * executor-result-guard — the Stop / SubagentStop guard (ROADCODE-DESIGN §3). Makes the
 * 2026-07-09 failure class (an executor ending its turn mid-phase with bare prose)
 * structurally impossible for executor-band phases: a turn may end only on a typed
 * PhaseExecutionResult, an already-persisted done, or a licensed background-run yield.
 *
 * ARM narrowly, FAIL OPEN outside the arm condition and on ANY internal error — the hook
 * must never brick an unrelated subagent. Arm channels (pre-made decision 6, S18 repair):
 *   (a) ROADMAP_EXECUTOR_PHASE=<N> in the environment — absolute precedence, because the
 *       workflow lane sets it explicitly and is one phase by construction, OR
 *   (b) an arm FILE <worktree>/.building/<N>-executor.armed (written PRE-SPAWN — the
 *       env-propagation-INDEPENDENT second channel; the reliable primary), OR
 *   (c) a <worktree>/.building/<N>-executor.jsonl beacon whose session id matches the
 *       payload session_id (DORMANT until a session-id-carrying beacon writer exists —
 *       today's beacon-stamp.sh writes no session id; driven here by synthetic beacons).
 *
 * Channels (b) and (c) are EXECUTOR-MATCHED (2384.4): they arm only for the phase the stopping
 * agent was itself spawned for, read from the FIRST phase-<N>.phase.ts named in its own transcript
 * head. Session-matching alone returned whichever arm readdir yielded first, so a session running
 * two executors woke one with the other's arm and demanded work on a phase that was not its own
 * (2026-08-18: pe-2335 handed the 2164 arm, two ~500k-token turns burned on the refusal). An agent
 * that names no phase is SILENT always — reviewers, architects and test-engineers name none, which
 * retires the standing misfires-on-unrelated-subagents class and the armor-prompt workaround with
 * it. Residual, accepted and named: a NON-executor agent whose prompt happens to quote an armed
 * phase's file path and which ends on bare prose gets one guard demand — far narrower than the
 * previous any-subagent exposure, and fail-open on the second stop (stop_hook_active).
 *
 * Enforcement is hard under SubagentStop (phase executors) and advisory under Stop
 * (a human may interrupt their own inline arc-mode session). The block decision rides
 * the JSON `{"decision":"block","reason":…}` channel; exit code stays 0.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appendExecutorEvent } from '../cli/lib/beacon.mjs'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'roadmap.mjs')

/** The VERBATIM block reason (the two-exit turn contract, phase 1753) with <N> and the next
 *  open task interpolated. There is NO licensed park: unbounded external work hands off via a
 *  typed checkpoint result, which license path 1 (result check) admits like any other return. */
function blockReason(phase, taskId) {
  return (
    `phase ${phase} is open (next task ${taskId}); a turn may end only on a running tool call `
    + 'or the typed PhaseExecutionResult — done, escalated, failed, or checkpoint '
    + '(committed + watch + resume)'
  )
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

function gitToplevelSafe(cwd) {
  try {
    return execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { timeout: 10_000, encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

/** The freshest JSONL event object in a beacon file, or null. */
function lastBeaconEvent(path) {
  if (!existsSync(path)) return null
  try {
    const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean)
    if (lines.length === 0) return null
    return JSON.parse(lines[lines.length - 1])
  } catch {
    return null
  }
}

/**
 * The phase THIS agent was spawned for: the first `phase-<N>.phase.ts` named in the head of its own
 * transcript. Both spawn lanes put that path in the prompt, and the prompt is the transcript's first
 * record, so a bounded 64KB head-read answers it exactly. Null when unreadable or when the agent
 * names no phase — and null is SILENCE, never a fallback to somebody else's arm.
 */
function ownPhaseFromTranscript(path) {
  if (!path || !existsSync(path)) return null
  try {
    const size = statSync(path).size
    const span = Math.min(size, 64 * 1024)
    if (span <= 0) return null
    const buf = Buffer.alloc(span)
    const fd = openSync(path, 'r')
    try {
      readSync(fd, buf, 0, span, 0)
    } finally {
      closeSync(fd)
    }
    const m = buf.toString('utf8').match(/phase-(\d+)\.phase\.ts/)
    return m ? Number(m[1]) : null
  } catch {
    return null // unreadable is no-phase, which is silence — the fail-open direction
  }
}

/** Resolve the armed phase + channel, or null (unarmed). */
function detectArm(worktree, payload, cfgOk) {
  if (!cfgOk) return null
  const buildingDir = join(worktree, '.building')
  // (a) env
  const envN = process.env.ROADMAP_EXECUTOR_PHASE
  if (envN && /^\d+$/.test(envN)) return { phase: Number(envN), channel: 'env' }
  // Channels (b)/(c) are executor-MATCHED: without the agent's own phase there is nothing to match
  // against, and guessing from readdir order is the wrong-wake defect itself.
  const ownPhase = ownPhaseFromTranscript(payload.agent_transcript_path ?? payload.transcript_path)
  if (ownPhase == null) return null
  let entries = []
  try {
    entries = readdirSync(buildingDir)
  } catch {
    return null
  }
  // (b) arm file — SESSION-BOUND: the file carries the arming session's id and arms only
  // for that session's agents. A bare/legacy arm file must NOT arm: with several sessions
  // sharing a worktree, a session-blind arm intercepted an UNRELATED session's subagent,
  // which then FABRICATED executor JSON + forged a beacon entry to satisfy the demand
  // (2026-07-17, skills-import session vs the MEASURE lane). Foreign or unbound = untouched.
  for (const f of entries) {
    const m = f.match(/^(\d+)-executor\.armed$/)
    if (!m) continue
    if (Number(m[1]) !== ownPhase) continue // another lane's arm — never this agent's business
    let armedSession = null
    try {
      const raw = readFileSync(join(buildingDir, f), 'utf8').trim()
      if (raw.startsWith('{')) armedSession = JSON.parse(raw).sessionId ?? null
      else if (raw.length > 0) armedSession = raw
    } catch {
      /* unreadable arm file = unbound */
    }
    if (armedSession && payload.session_id && armedSession === payload.session_id) {
      return { phase: Number(m[1]), channel: 'arm-file' }
    }
  }
  // (c) beacon session-id match
  for (const f of entries) {
    const m = f.match(/^(\d+)-executor\.jsonl$/)
    if (!m) continue
    if (Number(m[1]) !== ownPhase) continue
    const last = lastBeaconEvent(join(buildingDir, f))
    if (last && payload.session_id && last.session_id === payload.session_id) {
      return { phase: Number(m[1]), channel: 'beacon' }
    }
  }
  return null
}

/** The last assistant message text from a transcript jsonl (concatenated text parts). */
function lastAssistantText(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return null
  let lines
  try {
    lines = readFileSync(transcriptPath, 'utf8').trim().split('\n').filter(Boolean)
  } catch {
    return null
  }
  let text = null
  for (const line of lines) {
    let obj
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    const role = obj?.message?.role ?? obj?.role
    if (role !== 'assistant') continue
    const content = obj?.message?.content ?? obj?.content
    // Keep the last assistant entry that ACTUALLY carries text. Claude Code writes each content
    // block as its own transcript entry, so an executor's final turn commonly ends on a tool_use
    // entry whose text parts filter to [] — joining that yielded '' and CLOBBERED the real result.
    // '' is not null, so it slipped past the `text == null` fail-open below, lastJsonBlock('')
    // returned null, and every typed return that is not `done` (escalated / failed / checkpoint)
    // became undeliverable — a one-way valve pressuring executors to fabricate a `done`. Do NOT
    // "fix" this instead by treating '' as unreadable and failing open: that would also fail open
    // on a genuine bare-prose ending, which is the exact class this guard exists to catch.
    if (typeof content === 'string') {
      if (content) text = content
    } else if (Array.isArray(content)) {
      const parts = content.filter((c) => c?.type === 'text' || typeof c?.text === 'string').map((c) => c.text)
      if (parts.length) text = parts.join('\n')
    }
  }
  return text
}

/** Extract the last JSON object block from a message (a fenced ```json block, else the
 *  last balanced {...}). Returns the raw JSON string or null. */
function lastJsonBlock(text) {
  if (!text) return null
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)]
  for (let i = fences.length - 1; i >= 0; i--) {
    const body = fences[i][1].trim()
    if (body.startsWith('{')) return body
  }
  // bare: last balanced {...}
  const start = text.lastIndexOf('{')
  if (start < 0) return null
  let depth = 0
  let quote = null
  for (let i = text.indexOf('{'); i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        // return the LAST top-level object — restart search from here if more follow
        const candidate = text.slice(text.indexOf('{'), i + 1)
        const rest = text.slice(i + 1)
        const more = lastJsonBlock(rest)
        return more ?? candidate
      }
    }
  }
  return null
}

/**
 * The completing subagent's own agent type, read from the transcript's attributionAgent field
 * (the SubagentStop payload carries none — only session_id + transcript_path). null when the
 * transcript is unreadable or predates the field.
 */
function transcriptAgentType(path) {
  if (!path || !existsSync(path)) return null
  let found = null
  try {
    // The LAST attribution wins: the stopping agent's own turns are the newest, so an interleaved
    // transcript can never exempt the executor by an earlier sibling's attribution.
    for (const line of readFileSync(path, 'utf8').trim().split('\n')) {
      if (!line) continue
      let obj
      try {
        obj = JSON.parse(line)
      } catch {
        continue
      }
      if (typeof obj?.attributionAgent === 'string') found = obj.attributionAgent
    }
  } catch {
    /* unreadable → unknown */
  }
  return found
}

/** The agent type the executor guard is FOR. A different named agent in the same armed session
 *  (an architect, a reviewer, a test-engineer) owes no PhaseExecutionResult — blocking it was the
 *  misfire every arc paid an armor line to work around. */
const EXECUTOR_AGENT = 'zeroh-roadmap:phase-executor'

/** First task without done:true (document order), or '?'. */
function nextOpenTask(src) {
  if (!src) return '?'
  const ids = [...src.matchAll(/id:\s*'([\d.]+)'/g)].map((m) => ({ id: m[1], idx: m.index }))
  const dones = [...src.matchAll(/done:\s*(true|false)/g)].map((m) => ({ done: m[1] === 'true', idx: m.index }))
  for (let i = 0; i < ids.length; i++) {
    const start = ids[i].idx
    const end = ids[i + 1]?.idx ?? Infinity
    const d = dones.find((x) => x.idx > start && x.idx < end)
    if (!d || !d.done) return ids[i].id
  }
  return '?'
}

function resultCheckPasses(json, phase, cwd) {
  try {
    execFileSync('node', [BIN, 'result', 'check', '--phase', String(phase)], {
      input: json,
      cwd,
      stdio: ['pipe', 'ignore', 'ignore'],
      timeout: 60_000,
    })
    return true
  } catch {
    return false
  }
}

function appendResultReturned(worktree, phase) {
  try {
    appendExecutorEvent(worktree, phase, 'result-returned')
  } catch {
    /* best-effort */
  }
}

function main() {
  const raw = readStdin()
  if (!raw.trim()) return 0
  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    return 0
  }
  // STOP-HOOK RE-ENTRY — checked FIRST, before any other work. Claude Code re-invokes this hook on
  // the SAME turn it just blocked, with stop_hook_active:true, and force-ends the agent after
  // CLAUDE_CODE_STOP_HOOK_BLOCK_CAP (default 8) consecutive blocks. Without this clause the hook
  // block-LOOPS: the agent burns its remaining turns arguing with a hook instead of working, its
  // output degrades to a one-liner, and the harness force-ends it. That is the true origin of
  // "the reviewer returned an empty body with zero tool uses" — the review EXISTED and the loop
  // destroyed it. Observed: 13 consecutive block-injections against one code-reviewer before the
  // cap fired. The harness's own message says it outright: "check stop_hook_active in the input
  // and return success while it's true."
  if (payload.stop_hook_active) return 0

  const cwd = process.cwd()

  // loadConfig must succeed for the guard to arm (fail-open otherwise).
  let cfgOk = false
  try {
    // dynamic import kept sync-ish via require-like: use a child check to avoid ESM await here
    cfgOk = configLoads(cwd)
  } catch {
    cfgOk = false
  }

  const worktree = gitToplevelSafe(cwd) ?? cwd
  const arm = detectArm(worktree, payload, cfgOk)
  if (!arm) return 0 // unarmed → untouched
  const { phase } = arm

  // ── allow states (in order) ──
  // (1) final assistant message carries a parseable result → allow + stamp beacon.
  // SCOPE TO THE STOPPING SUBAGENT, not to the session. Under SubagentStop, `transcript_path` is
  // the MAIN SESSION transcript — `agent_transcript_path` is the stopping subagent's, which is
  // exactly why the payload carries both. Reading the session file meant path 1 evaluated the
  // ORCHESTRATOR's last message, so it could only ever pass by accident, and `done` survived only
  // via license path 2 below. `last_assistant_message` is the subagent's final text delivered
  // directly, so prefer it and fall back to its own transcript; the session path is the last
  // resort and never the first choice.
  const text = payload.last_assistant_message ?? lastAssistantText(payload.agent_transcript_path ?? payload.transcript_path)
  const json = lastJsonBlock(text)
  if (json && resultCheckPasses(json, phase, worktree)) {
    appendResultReturned(worktree, phase)
    return 0
  }

  // (2) phase file already status done WITH executionResult persisted.
  const phaseFile = join(worktree, 'roadmap', 'phases', `phase-${phase}.phase.ts`)
  let phaseSrc = null
  if (existsSync(phaseFile)) {
    try {
      phaseSrc = readFileSync(phaseFile, 'utf8')
    } catch {
      /* unreadable → treat as not-done */
    }
  }
  if (phaseSrc && /status:\s*'done'/.test(phaseSrc) && /executionResult\s*:/.test(phaseSrc)) return 0

  // There is deliberately NO background-run license (phase 1753): a fresh background-run
  // beacon used to buy a 10-min legal park with no wake owner — the exact nap class this
  // guard exists to kill. A legal unbounded-work stop now carries a typed checkpoint result,
  // admitted by license path 1 (result check) like any other return.

  // An unreadable/absent transcript is an INTERNAL ERROR → fail OPEN (never block on a
  // payload we could not inspect). A readable prose-ending transcript falls through to block.
  if (text == null) return 0

  // (3) SCOPING (1792.6): a DIFFERENT named agent in the armed session is not the executor —
  // pass it through untouched. An unattributed transcript keeps today's behavior (conservative:
  // narrow the guard where identity is known, never widen the exemption on a guess).
  // Same correction: SubagentStop carries `agent_type` for the stopping agent. Deriving it from the
  // session transcript returned whichever attributionAgent happened to be LAST in the PARENT's log
  // — arbitrary, not absent — so the agent-scoping exemption fired against the wrong agent.
  const agentType = payload.agent_type ?? transcriptAgentType(payload.agent_transcript_path ?? payload.transcript_path)
  if (agentType && agentType !== EXECUTOR_AGENT) return 0

  // ── block / warn ──
  const taskId = nextOpenTask(phaseSrc)
  const reason = blockReason(phase, taskId)

  // Stop softening: a MAIN-session Stop NEVER hard-blocks — the human may legitimately
  // interrupt their own session (design §3.4), and an orchestrator waiting on an
  // executor-band subagent ends turns routinely with the lane's arm-file present. Hard
  // enforcement is SubagentStop's (the executor's own turn end).
  if (payload.hook_event_name === 'Stop') {
    const arcId = firstArcModeArc(worktree)
    process.stderr.write(
      `[executor-result-guard] phase ${phase} looks open — re-enter with \`roadmap arc next${arcId ? ' ' + arcId : ''}\` (advisory: not blocking a Stop)\n`,
    )
    return 0
  }

  process.stdout.write(JSON.stringify({ decision: 'block', reason }) + '\n')
  return 0
}

/** Best-effort arcId of the armed lane (for the Stop warning). */
function firstArcModeArc(worktree) {
  try {
    for (const f of readdirSync(join(worktree, '.building'))) {
      const m = f.match(/^([A-Za-z][\w-]*)-executor\.jsonl$/)
      if (m) return m[1]
    }
  } catch {
    /* none */
  }
  return null
}

/** loadConfig succeeds? A tiny synchronous child check (keeps main() sync + fail-open). */
function configLoads(cwd) {
  try {
    execFileSync(
      'node',
      ['-e', "import(process.argv[1]).then(m=>{m.loadConfig(process.cwd());process.exit(0)}).catch(()=>process.exit(1))", join(dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'lib', 'config.mjs')],
      { cwd, stdio: 'ignore', timeout: 15_000 },
    )
    return true
  } catch {
    return false
  }
}

// ANY uncaught error → exit 0 (fail-open; never brick an unrelated subagent).
try {
  process.exit(main())
} catch {
  process.exit(0)
}
