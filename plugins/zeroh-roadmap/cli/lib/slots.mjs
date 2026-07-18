/**
 * slots — slot resolution + verbatim {files}/{range} substitution + REFUSE-on-missing
 * + the scoped-slot single-seam fallback + verbatim slot execution. Ports the
 * gate-protocol.md:51-81 prose (Gate-commands resolution + the scoped-slot resolution
 * rule) to ONE code path every gate consumer shares — the FM2 failure class (an
 * invented filter arg silently running the full tier while the gate believed it
 * scoped) is closed by construction here.
 *
 * Refusal / declared-absence are DATA on the return; the CALLER maps them to exit 2 /
 * a recorded absent-by-declaration. A red slot exit is DATA too — runSlot NEVER throws
 * on red and this module NEVER calls process.exit (honesty rail: exit codes never lie,
 * and they're the caller's to set).
 */
import { spawn } from 'node:child_process'
import { createWriteStream, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/** The scoped-slot fallback note — gate-protocol.md:72-81, VERBATIM. Defined ONCE;
 *  callers machine-emit it into the GateRunReport. Never restated. */
export const SCOPED_FALLBACK_NOTE = 'scoped slot missing — ran full suite'

/** The impacted-slot fallback note — the SCOPED_FALLBACK_NOTE sibling for the {range}
 *  arc-end path (decision 2). Defined ONCE; callers machine-emit it. Never restated. */
export const IMPACTED_FALLBACK_NOTE = 'impacted slot missing — ran full suite'

const refusal = (slot) =>
  `gate cannot run: gateCommands.${slot} missing in roadmap/roadmap.config.json — add it`

/**
 * Substitute {files}/{range} into a slot template VERBATIM — the space-joined list /
 * the range string, with NO added quoting (gate-protocol.md:64-70: the template author
 * owns quoting). A placeholder present in the template but given no value is an ERROR
 * (never run a command with the literal braces still in it). Returns { cmd } | { error }.
 */
function substitute(template, { files, range }) {
  let cmd = template
  if (cmd.includes('{files}')) {
    if (files == null) return { error: `slot template has a {files} placeholder but no files were provided` }
    cmd = cmd.split('{files}').join(Array.isArray(files) ? files.join(' ') : String(files))
  }
  if (cmd.includes('{range}')) {
    if (range == null) return { error: `slot template has a {range} placeholder but no range was provided` }
    cmd = cmd.split('{range}').join(String(range))
  }
  return { cmd }
}

/**
 * Resolve ONE slot to a runnable command. Returns:
 *   { slot, command }          — resolvable
 *   { slot, declaredAbsent }   — bound to the literal 'none' (absent-by-declaration; recorded, not a failure)
 *   { slot, refused }          — the slot is not in gateCommands, or a placeholder got no value
 */
export function resolveSlot(cfg, slot, sub = {}) {
  const template = cfg?.gateCommands?.[slot]
  if (template == null) return { slot, refused: refusal(slot) }
  if (template === 'none') return { slot, declaredAbsent: true }
  const r = substitute(template, sub)
  if (r.error) return { slot, refused: `gate cannot run: ${r.error}` }
  return { slot, command: r.cmd }
}

/**
 * The scoped-slot resolution rule (gate-protocol.md:72-81 — the SINGLE seam). `tier` ∈
 * 'unit' | 'integration'. When the consumer has bound `<tier>-scoped`, resolve it with
 * {files} substituted. When it has NOT, run the FULL `<tier>` slot command
 * BYTE-IDENTICAL plus the verbatim SCOPED_FALLBACK_NOTE — NEVER
 * an appended/invented filter on the full command (the returned command IS the full
 * binding, unchanged).
 */
export function resolveScopedOrFallback(cfg, tier, files) {
  const scopedSlot = `${tier}-scoped`
  const scopedTemplate = cfg?.gateCommands?.[scopedSlot]
  if (scopedTemplate != null && scopedTemplate !== 'none') {
    return { ...resolveSlot(cfg, scopedSlot, { files }), scoped: true }
  }
  const full = cfg?.gateCommands?.[tier]
  if (full == null) return { slot: tier, refused: refusal(tier) }
  if (full === 'none') return { slot: tier, declaredAbsent: true, scoped: false }
  // BYTE-IDENTICAL to the full binding — no substitution, no invented filter.
  return { slot: tier, command: full, note: SCOPED_FALLBACK_NOTE, scoped: false }
}

/**
 * The impacted-slot resolution rule — the {range} sibling of resolveScopedOrFallback
 * for the arc-end suite (decision 2). `tier` ∈ 'unit' | 'integration'. When the consumer
 * has bound `<tier>-impacted`, resolve it with {range} substituted. When it has NOT (or
 * it is the literal 'none'), run the FULL `<tier>` slot command BYTE-IDENTICAL plus the
 * verbatim IMPACTED_FALLBACK_NOTE — NEVER an appended/invented filter, and never a range
 * grafted onto the full command (the returned command IS the full binding, unchanged).
 */
export function resolveImpactedOrFallback(cfg, tier, range) {
  const impactedSlot = `${tier}-impacted`
  const impactedTemplate = cfg?.gateCommands?.[impactedSlot]
  if (impactedTemplate != null && impactedTemplate !== 'none') {
    return { ...resolveSlot(cfg, impactedSlot, { range }), scoped: true }
  }
  const full = cfg?.gateCommands?.[tier]
  if (full == null) return { slot: tier, refused: refusal(tier) }
  if (full === 'none') return { slot: tier, declaredAbsent: true, scoped: false }
  // BYTE-IDENTICAL to the full binding — no substitution, no invented filter.
  return { slot: tier, command: full, note: IMPACTED_FALLBACK_NOTE, scoped: false }
}

/**
 * Execute a resolved slot verbatim through `bash -c` (the binding is the consumer's own
 * wrapper — run-tier.sh/capbuild self-wrap). Streams stdout/stderr UNFILTERED to the
 * parent tty AND tees to logPath (gate-protocol.md:144-153 failure-identity rule — the
 * CLI never re-filters a slot's output). Returns { slot, command, exitCode, durationMs,
 * logPath, note? }; a red exit is DATA (never thrown), a spawn failure surfaces as
 * exitCode 127. The CALLER maps a non-zero exitCode to gate exit 2.
 */
export async function runSlot(resolved, { cwd, logPath } = {}) {
  const command = resolved.command
  const start = Date.now()
  if (logPath) mkdirSync(dirname(logPath), { recursive: true })
  const logStream = logPath ? createWriteStream(logPath) : null

  return await new Promise((resolvePromise) => {
    let finished = false
    const finish = (exitCode) => {
      if (finished) return
      finished = true
      const out = {
        slot: resolved.slot,
        command,
        exitCode,
        durationMs: Date.now() - start,
        logPath: logPath ?? null,
        ...(resolved.note ? { note: resolved.note } : {}),
      }
      if (logStream) logStream.end(() => resolvePromise(out))
      else resolvePromise(out)
    }

    const child = spawn('bash', ['-c', command], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const tee = (src, dst) =>
      src.on('data', (chunk) => {
        dst.write(chunk)
        if (logStream) logStream.write(chunk)
      })
    tee(child.stdout, process.stdout)
    tee(child.stderr, process.stderr)
    child.on('error', (err) => {
      const msg = `runSlot: failed to spawn '${command}': ${err.message}\n`
      process.stderr.write(msg)
      if (logStream) logStream.write(msg)
      finish(127)
    })
    child.on('close', (code, signal) => finish(code ?? (signal ? 128 : 0)))
  })
}
