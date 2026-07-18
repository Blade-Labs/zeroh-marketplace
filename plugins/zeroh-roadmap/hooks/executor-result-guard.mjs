#!/usr/bin/env node
/**
 * executor-result-guard — the Stop / SubagentStop guard (ROADCODE-DESIGN §3). Makes the
 * 2026-07-09 failure class (an executor ending its turn mid-phase with bare prose)
 * structurally impossible for executor-band phases: a turn may end only on a typed
 * PhaseExecutionResult, an already-persisted done, or a licensed background-run yield.
 *
 * ARM narrowly, FAIL OPEN outside the arm condition and on ANY internal error — the hook
 * must never brick an unrelated subagent. Arm channels (pre-made decision 6, S18 repair):
 *   (a) ROADMAP_EXECUTOR_PHASE=<N> in the environment, OR
 *   (b) an arm FILE <worktree>/.building/<N>-executor.armed (written PRE-SPAWN — the
 *       env-propagation-INDEPENDENT second channel; the reliable primary), OR
 *   (c) a <worktree>/.building/<N>-executor.jsonl beacon whose session id matches the
 *       payload session_id (DORMANT until a session-id-carrying beacon writer exists —
 *       today's beacon-stamp.sh writes no session id; driven here by synthetic beacons).
 *
 * Enforcement is hard under SubagentStop (phase executors) and advisory under Stop
 * (a human may interrupt their own inline arc-mode session). The block decision rides
 * the JSON `{"decision":"block","reason":…}` channel; exit code stays 0.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appendExecutorEvent } from '../cli/lib/beacon.mjs'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'roadmap.mjs')
const BACKGROUND_RUN_MAX_MIN = 10

/** The VERBATIM block reason (pre-made decision 6) with <N> and the next open task interpolated. */
function blockReason(phase, taskId) {
  return (
    `phase ${phase} is open (next task ${taskId}); a turn may end only on a running tool, `
    + "a beacon'd background-run, or the typed PhaseExecutionResult — continue the task loop "
    + 'or return the typed result (status escalated/failed is a valid honest return)'
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

/** Resolve the armed phase + channel, or null (unarmed). */
function detectArm(worktree, payload, cfgOk) {
  if (!cfgOk) return null
  const buildingDir = join(worktree, '.building')
  // (a) env
  const envN = process.env.ROADMAP_EXECUTOR_PHASE
  if (envN && /^\d+$/.test(envN)) return { phase: Number(envN), channel: 'env' }
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
    if (typeof content === 'string') text = content
    else if (Array.isArray(content)) text = content.filter((c) => c?.type === 'text' || typeof c?.text === 'string').map((c) => c.text).join('\n')
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
  const text = lastAssistantText(payload.transcript_path)
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

  // (3) latest beacon event is a fresh background-run with a log field.
  const beacon = lastBeaconEvent(join(worktree, '.building', `${phase}-executor.jsonl`))
  if (beacon && beacon.event === 'background-run' && beacon.log) {
    // ts may be an ISO string OR epoch ms — the lib's backgroundRunAlive accepts both, so
    // the hook must too (a NaN here would refuse to license a legitimate yield).
    const ts = typeof beacon.ts === 'number' ? beacon.ts : Date.parse(beacon.ts)
    const ageMin = (Date.now() - ts) / 60000
    if (Number.isFinite(ageMin) && ageMin < BACKGROUND_RUN_MAX_MIN) return 0
  }

  // An unreadable/absent transcript is an INTERNAL ERROR → fail OPEN (never block on a
  // payload we could not inspect). A readable prose-ending transcript falls through to block.
  if (text == null) return 0

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
