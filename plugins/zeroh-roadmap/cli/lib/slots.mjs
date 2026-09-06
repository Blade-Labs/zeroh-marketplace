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
import { matchGlob, matchGlobPath } from './ladder.mjs'
import { runCaptured } from './exec.mjs'
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { roadmapRootRel, ROOT_CANDIDATES } from './roadmap-root.mjs'

/** The scoped-slot fallback note — gate-protocol.md:72-81, VERBATIM. Defined ONCE;
 *  callers machine-emit it into the GateRunReport. Never restated. */
export const SCOPED_FALLBACK_NOTE = 'scoped slot missing — ran full suite'

/** The impacted-slot fallback note — the SCOPED_FALLBACK_NOTE sibling for the {range}
 *  arc-end path (decision 2). Defined ONCE; callers machine-emit it. Never restated. */
export const IMPACTED_FALLBACK_NOTE = 'impacted slot missing — ran full suite'
export const AFFECTED_FALLBACK_NOTE = 'affected slot missing — ran full suite'
export const SCOPE_MANIFEST_PROTOCOL = 'scope-manifest-json-v1'

/** Create the only scope artifact accepted by generated commands. */
export function createScopeManifest(cwd, paths) {
  const root = resolve(cwd)
  if (!Array.isArray(paths) || paths.length === 0) return null
  const living = []
  for (const path of paths) {
    if (typeof path !== 'string' || path.length === 0 || path.includes('\0') || path.includes('\n') || isAbsolute(path)) return null
    const absolute = resolve(root, path)
    if (relative(root, absolute).startsWith('..')) return null
    if (!existsSync(absolute)) continue
    living.push(path)
  }
  if (living.length === 0) return null
  const dir = mkdtempSync(join(tmpdir(), 'roadmap-scope-'))
  const file = join(dir, 'scope.json')
  writeFileSync(file, JSON.stringify({ protocol: SCOPE_MANIFEST_PROTOCOL, paths: [...new Set(living)].sort() }) + '\n')
  let cleaned = false
  const onExit = () => rmSync(dir, { recursive: true, force: true })
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    process.off('exit', onExit)
    rmSync(dir, { recursive: true, force: true })
  }
  process.once('exit', onExit)
  return { protocol: SCOPE_MANIFEST_PROTOCOL, path: file, token: `@${file}`, paths: living, cleanup }
}

const refusal = (slot) =>
  `gate cannot run: gateCommands.${slot} missing in roadmap/roadmap.config.json — add it`

/**
 * Substitute {files}/{range} into a slot template VERBATIM — the space-joined list /
 * the range string, with NO added quoting (gate-protocol.md:64-70: the template author
 * owns quoting). A placeholder present in the template but given no value is an ERROR
 * (never run a command with the literal braces still in it). Returns { cmd } | { error }.
 */
// {fileArgs} opts into per-path shell quoting; legacy {files} remains author-quoted.
function substitute(template, { files, range, base, manifest }) {
  let cmd = template
  if (cmd.includes('{fileArgs}')) {
    if (cmd.replace(/(^|\s)\{fileArgs\}(?=\s|$)/g, '$1').includes('{fileArgs}'))
      return { error: 'slot {fileArgs} must be an unquoted standalone placeholder' }
    if (!Array.isArray(files) || !files.length || files.some(file => typeof file !== 'string' || /[\0\r\n]/.test(file)))
      return { error: 'slot {fileArgs} requires a nonempty array of file paths without control characters' }
    const quoted = files.map(file => "'" + file.replaceAll("'", "'\\''") + "'").join(' ')
    cmd = cmd.split('{fileArgs}').join(quoted)
  }
  if (cmd.includes('{files}')) {
    if (files == null) return { error: `slot template has a {files} placeholder but no files were provided` }
    cmd = cmd.split('{files}').join(Array.isArray(files) ? files.join(' ') : String(files))
  }
  if (cmd.includes('{range}')) {
    if (range == null) return { error: `slot template has a {range} placeholder but no range was provided` }
    cmd = cmd.split('{range}').join(String(range))
  }
  if (cmd.includes('{base}')) {
    if (base == null) return { error: `slot template has a {base} placeholder but no base was provided` }
    cmd = cmd.split('{base}').join(String(base))
  }
  if (cmd.includes('{manifest}')) {
    if (manifest == null) return { error: 'slot template has a {manifest} placeholder but no @manifest was provided' }
    if (!/^@[A-Za-z0-9_./-]+$/.test(String(manifest)) ||
        !(template.includes("'{manifest}'") || template.includes('"{manifest}"'))) {
      return { error: 'slot {manifest} requires one validated @manifest token in a quoted placeholder' }
    }
    cmd = cmd.split('{manifest}').join(String(manifest))
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

/** A target that CANNOT exist, inside the consumer's own gate dir so a runner that globs the
 *  repo still resolves it the way it resolves a real scoped target. */
const vacuityProbeTarget = (cwd) => `${roadmapRootRel(cwd)}/.gate/__vacuity_probe_does_not_exist__.test.ts`
const VACUITY_PROBE_TIMEOUT_MS = 120_000
const VACUOUS_SCOPED_RUNNER_MESSAGE =
  'scoped runner cannot fail on a missing target — a green scoped slot proves nothing (vacuous-green class)'

/**
 * Ask a file-scoped slot the minimum useful question: does its real command fail when
 * handed a target that cannot exist? The command is built by the same substitute()
 * seam as ordinary slot resolution; an unscoped or unanswerable probe is indeterminate.
 */
export async function probeScopedSlot(template, { cwd, timeoutMs = VACUITY_PROBE_TIMEOUT_MS } = {}) {
  // No runner to probe: absent, declared-absent ('none', this module's absence literal), or
  // not file-scoped — none of which is a verdict about a runner.
  if (typeof template !== 'string' || template === 'none' || !(template.includes('{files}') || template.includes('{fileArgs}'))) {
    return { vacuous: null, message: 'not a scoped template' }
  }
  const probeTarget = vacuityProbeTarget(cwd)
  const substituted = substitute(template, { files: [probeTarget] })
  if (substituted.error) {
    return { vacuous: null, message: `gate cannot run: ${substituted.error}` }
  }

  const command = substituted.cmd
  const probed = { command, target: probeTarget }
  const r = await runCaptured(command, { cwd, timeoutMs })
  if (r.spawnError) return { ...probed, ...r, vacuous: null, message: `probe spawn error: ${r.spawnError}` }
  if (r.timedOut) return { ...probed, ...r, vacuous: null, message: `scoped runner probe timed out after ${timeoutMs}ms` }
  return r.exitCode === 0
    ? { ...probed, ...r, vacuous: true, message: VACUOUS_SCOPED_RUNNER_MESSAGE }
    : { ...probed, ...r, vacuous: false }
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

/** Source-aware sibling of scoped/impacted resolution. The caller owns the manifest. */
export function resolveAffectedOrFallback(cfg, tier, manifest) {
  const slot = `${tier}-affected`
  const template = cfg?.gateCommands?.[slot]
  if (template != null && template !== 'none') {
    return { ...resolveSlot(cfg, slot, { manifest }), scoped: true }
  }
  const full = cfg?.gateCommands?.[tier]
  if (full == null) return { slot: tier, refused: refusal(tier) }
  if (full === 'none') return { slot: tier, declaredAbsent: true, scoped: false }
  return { slot: tier, command: full, note: AFFECTED_FALLBACK_NOTE, scoped: false }
}

/** The named hygiene skip — a consumer without the lint-diff binding gets this OBJECT in the
 *  plan (recorded, visible), never a silent omission (the release-only-catch failure class). */
export const HYGIENE_SKIP_NOTE = 'not bound in gateCommands — hygiene lint skipped (named, never silent)'

/** The empty-scope hygiene skip — no lintable file in the phase-own set (a docs/roadmap-only
 *  phase). A linter given nothing to lint exits non-zero; a skip is the honest reading. */
export const HYGIENE_EMPTY_NOTE = 'no lintable file in the phase-own set — hygiene lint skipped'

/** The estate-mismatch hygiene skip — every lintable phase-own file sits OUTSIDE the linter's
 *  configured estate (config.lintDiffMatches). biome on a roadmap-only diff exits 1 over
 *  nothing — the 1817 gate quirk; a named skip is the honest reading. */
export const HYGIENE_ESTATE_NOTE = 'no phase-own file inside lintDiffMatches — hygiene lint skipped (estate mismatch, named)'

/** Extensions a source linter/formatter owns. Markdown/HTML/JSON are deliberately absent. */
const LINTABLE_EXT = /\.(m|c)?[jt]sx?$/

/**
 * The per-phase hygiene slots (1792.1): today exactly the diff-scoped lint. Bound →
 * resolveSlot with {base}→baseSha; bound to 'none' → declaredAbsent like every sibling;
 * unbound → the NAMED skip object. Always returns an array so the plan renders every
 * hygiene decision, including the skips.
 */
export function resolveHygieneSlots(cfg, baseSha, ownFiles = null) {
  const template = cfg?.gateCommands?.['lint-diff']
  if (template == null) return [{ slot: 'lint-diff', skipped: HYGIENE_SKIP_NOTE }]
  // The phase-OWN files (never the raw range): a sibling's committed violation in base..HEAD must
  // not red THIS phase, and an EMPTY lintable set is a SKIP — a linter handed nothing to check
  // exits non-zero on "no files processed", which would paint a docs-only gate red over nothing
  // (the empty-scope-skip precedent the test slots already follow).
  if (template.includes('{files}')) {
    let files = (ownFiles ?? []).filter((f) => LINTABLE_EXT.test(f))
    if (files.length === 0) return [{ slot: 'lint-diff', skipped: HYGIENE_EMPTY_NOTE }]
    // Estate filter (config.lintDiffMatches): drop files the linter's estate doesn't cover
    // BEFORE substitution — biome handed roadmap/*.phase.ts exits 1 with nothing checked.
    // ANCHORED match only: diff paths are repo-relative, and matchGlobPath's tail-walk (for
    // absolute keyFiles paths) would let site/src/* collide with a src/** estate glob.
    if (cfg?.lintDiffMatches) {
      files = files.filter((f) => cfg.lintDiffMatches.some((g) => matchGlob(g, f)))
      if (files.length === 0) return [{ slot: 'lint-diff', skipped: HYGIENE_ESTATE_NOTE }]
    }
    return [{ ...resolveSlot(cfg, 'lint-diff', { base: baseSha, files }), files }]
  }
  return [resolveSlot(cfg, 'lint-diff', { base: baseSha })]
}

/**
 * Conditional gate slots (1792.2): resolve every gateConditionalSlots entry whose globs match ANY
 * diff path — glob semantics ARE ladder.mjs matchGlobPath (imported; one matcher, never a fork).
 * A matching entry resolves through resolveSlot (so an unbound slot surfaces the standard refusal)
 * and carries `reason` naming the matching glob; non-matching entries contribute nothing.
 */
export function resolveConditionalSlots(cfg, diffPaths) {
  const entries = cfg?.gateConditionalSlots ?? []
  const out = []
  for (const entry of entries) {
    const glob = entry.whenDiffMatches.find((g) => (diffPaths ?? []).some((p) => matchGlobPath(g, p)))
    if (glob == null) continue
    out.push({ ...resolveSlot(cfg, entry.slot), reason: `${glob} matched → ${entry.slot}` })
  }
  return out
}

// Shared by Git diff selection and the comment scanner; do not exempt directories.
export const HISTORY_COMMENT_SUFFIXES = Object.freeze(['js', 'jsx', 'ts', 'tsx', 'mjs', 'mjsx', 'mts', 'mtsx', 'cjs', 'cjsx', 'cts', 'ctsx', 'sh', 'py', 'go', 'rs', 'rb', 'yml', 'yaml'])

/** Comment-line discriminator for an ADDED diff line (the text after the leading '+'). */
const COMMENT_LINE = /^\s*(\/\/|\*|#|<!--|\/\*)/

/** The history vocabulary measure.mjs's historyComment ratchet counts — mirrored EXACTLY
 *  (phase number / ISO date / version literal); evolving measure.mjs may under-catch here,
 *  never over-block (front-runner, not a second source of truth). */
const HISTORY_COMMENT_RE = /\bphase[- ]?\d{3,4}\b|\b20\d{2}-\d{2}-\d{2}\b|\bv\d+\.\d+\.\d+\b/i

/**
 * Plugin-native history-comment check (1792.1, decision 2): scan a unified diff's ADDED
 * comment lines for phase-number/date/version narration and return [{ file, line, match }].
 * roadmap/** paths are exempt (the phase system's own vocabulary lives there); added CODE
 * lines never match (a version literal in code is data, not narration); removed/context
 * lines are invisible. Pure over the diff text — no filesystem, no git.
 */
export function historyCommentFindings(diffText, roadmapRel = ROOT_CANDIDATES[0]) {
  const findings = []
  let file = null
  let exempt = false
  let line = 0
  for (const raw of String(diffText).split('\n')) {
    if (raw.startsWith('+++ ')) {
      file = raw.replace(/^\+\+\+ (b\/)?/, '').trim()
      exempt = file.startsWith(`${roadmapRel}/`) || file === '/dev/null'
      continue
    }
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)/)
    if (hunk) {
      line = Number(hunk[1]) - 1
      continue
    }
    if (raw.startsWith('-') && !raw.startsWith('---')) continue
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      line++
      if (exempt || file == null) continue
      // Prose files have no code comments: a Markdown heading (#) or bullet (*) carrying a date or
      // a version is CONTENT, not history narration (RELEASE_NOTES.md is made of them).
      if (!HISTORY_COMMENT_SUFFIXES.some(suffix => file.endsWith(`.${suffix}`))) continue
      const text = raw.slice(1)
      if (!COMMENT_LINE.test(text)) continue
      const m = text.match(HISTORY_COMMENT_RE)
      if (m) findings.push({ file, line, match: m[0] })
      continue
    }
    line++
  }
  return findings
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
