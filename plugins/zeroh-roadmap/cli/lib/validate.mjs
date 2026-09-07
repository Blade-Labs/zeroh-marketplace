/**
 * validate — the roadmap-file validation ENGINE, extracted from
 * bin/validate-roadmap-file.mjs (arc ROADCODE 1656.7). The write-hook bin and the new
 * `roadmap phase validate` CLI both call validateRoadmapFile(absPath, { strict }) — ONE
 * engine, two faces. Behavior is preserved verbatim (the bin's own fixture suite passes
 * UNMODIFIED — the parity proof), including every fail-open branch; the ONLY addition is
 * the NEW gate-report done-flip rule (below), which arms only when a report already
 * exists, so historical phases keep today's behavior.
 *
 * NO process.exit here — exit mapping belongs to the callers (the bin maps to 0/2 with
 * its verbatim strings; the CLI to 0/1/2, tsx-absent being 1 in its strict context).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { bridgeImport } from './tsx-bridge.mjs'
import { gitToplevel } from './gitroot.mjs'
import { DRIVERS } from './drivers.mjs'
import { latestReport, checkPhaseConsistency, GateReportUnreadableError } from './gate-report.mjs'

/** Phases planned after arc ROADOPUS — below this floor the provenance rules (c)/(d) are exempt. */
const ENFORCEMENT_FLOOR = 1365

/**
 * Validate a roadmap file. Returns a discriminated result; NO process.exit.
 *   { kind: 'ok' | 'skip' }                                  — pass / not-a-roadmap-file
 *   { kind: 'toolchain-missing', ok }                        — tsx absent (ok:true non-strict, false strict)
 *   { kind: 'load-error', ok:false, loadError }              — import failed (non-Zod)
 *   { kind: 'zod', ok:false, zod: { file, issues } }         — import-time Zod failure
 *   { kind: 'errors', ok:false, errors: [{rule,msg,fix} | {rawLines}] } — structural failures
 */
export function validateRoadmapFile(absPath, { strict = false } = {}) {
  const normalized = resolve(absPath).replace(/\\/g, '/')
  const isPhase = /\/roadmap\/.*\.phase\.ts$/.test(normalized)
  const isArc = /\/roadmap\/.*\.arc\.ts$/.test(normalized)
  const isBacklog = /\/roadmap\/backlog\.ts$/.test(normalized)
  if (!isPhase && !isArc && !isBacklog) return { kind: 'skip', ok: true }
  if (!existsSync(normalized)) return { kind: 'skip', ok: true } // deleted/renamed since the edit

  // ── Pass 1: import-parse (Zod) via the tsx bridge ─────────────────────────────────
  let consumerRoot
  try {
    consumerRoot = gitToplevel(dirname(normalized))
  } catch {
    consumerRoot = dirname(normalized)
  }
  // cache:false — validation IS the product (the write-guard), never a read; it must
  // genuinely parse every time and never serve a cached verdict.
  const imp = bridgeImport(normalized, { consumerRoot, cache: false })
  if (!imp.ok) {
    if (imp.kind === 'tsx-absent') return { kind: 'toolchain-missing', ok: !strict }
    if (imp.kind === 'zod') return { kind: 'zod', ok: false, zod: { file: basename(normalized), issues: imp.issues } }
    return { kind: 'load-error', ok: false, loadError: imp.stderr }
  }
  const parsed = imp.parsed
  const content = readFileSync(normalized, 'utf8')
  const errors = []

  // ── Pass 2: v2 structural checks (verbatim rules) ─────────────────────────────────
  if (isPhase || isArc) errors.push(...duplicateTopLevelKeyErrors(content))
  if (isPhase && parsed) errors.push(...phaseChecks(parsed))
  if (isArc && parsed) errors.push(...arcImmutabilityChecks(parsed, content, normalized))

  // ── NEW rule: done-without-green-gate-report (arms only when a report exists) ──────
  if (isPhase && parsed) errors.push(...gateReportConsistencyErrors(parsed, normalized))

  // ── Pass 3: duplicate phase-number + claim-before-start (phase files) ─────────────
  if (isPhase) {
    const phaseMatch = normalized.match(/\/roadmap\/phases\/phase-(\d+)\.phase\.ts$/)
    if (phaseMatch) errors.push(...runPhaseNumberAndClaimChecks(normalized, phaseMatch))
  }

  // ── WARN-level authoring lints (NEW-to-git roadmap files) ─────────────────────────
  // Never a non-zero exit — reminders of plan-phase's and plan-arc's authoring rules, not
  // enforcement (review-phase Mode A is the enforcement). The ~1,100 already-committed phase
  // files and every committed arc are grandfathered: the file must be new to git (no HEAD blob)
  // for any of them to fire, so the gate is resolved ONCE here (it shells out to git) rather
  // than per lint.
  //
  // The driver-lane and attribution lints below are DATA, not authoring, so they sit OUTSIDE
  // that gate: the case they exist for is a done-flip, which edits a file git already has.
  const warnings = isPhase && parsed
    ? [
        ...(isNewToGit(normalized)
          ? [
              ...stepVerifyGrammarWarnings(parsed),
              ...verifyPolarityWarnings(parsed),
              ...stepDescriptionLengthWarnings(parsed),
              ...citationIntegrityWarnings(parsed, normalized),
            ]
          : []),
        ...driverLaneWarnings(parsed),
        ...attributionWarnings(parsed),
      ]
    : isArc && parsed && isNewToGit(normalized)
      ? rejectedProseWarnings(parsed, content, normalized)
      : []

  if (errors.length > 0) return { kind: 'errors', ok: false, errors, warnings }
  return { kind: 'ok', ok: true, warnings }
}

/**
 * WARN when a phase carries no attribution for the stage it is at: a backlog phase with no
 * plannedBy, a done phase with no executionResult.driver. Each warning carries the one line
 * that fixes it, because the fix is a single field and a warning that only names a gap costs
 * a lookup.
 *
 * Never an error: ~700 committed phase files predate these fields, and REDing them would make
 * the rule unlandable. `historical` and `cancelled` never warn at all — nobody is going to
 * re-derive who planned work that was abandoned or imported.
 */
function attributionWarnings(phase) {
  const num = phase?.phase ?? '?'
  if (phase?.status === 'backlog' && !phase?.plannedBy?.model) {
    return [
      `WARN phase ${num}: plannedBy missing — add plannedBy: { model: <your model id> }. `
        + 'The scorecard\'s planner cells fill from this field; absent, this phase scores as unrecorded.',
    ]
  }
  if (phase?.status === 'done' && !phase?.executionResult?.driver?.model) {
    return [
      `WARN phase ${num}: executionResult.driver missing — add driver: { model: <your model id>, lane: 'session' } `
        + "to executionResult (lane is 'session' for an in-harness run, else the driver id). "
        + 'The scorecard\'s driver cells fill from this field; absent, this phase scores as unrecorded.',
    ]
  }
  return []
}

/** Every lane the registry recognises: 'session' (an in-harness session) plus each driver id. */
function knownLanes() {
  return ['session', ...Object.keys(DRIVERS)]
}

/**
 * WARN when executionResult.driver.lane names no known lane. A WARNING and never an error:
 * the schema keeps `lane` open so any driver's phase file loads, and the registry is the only
 * place that can say which lanes are real.
 */
function driverLaneWarnings(phase) {
  const lane = phase?.executionResult?.driver?.lane
  if (typeof lane !== 'string' || lane.length === 0) return []
  const known = knownLanes()
  if (known.includes(lane)) return []
  return [
    `WARN phase ${phase?.phase ?? '?'}: executionResult.driver.lane '${lane}' is not a known lane — known: ${known.join(', ')}. ` +
      `If that driver is real, land its entry in cli/lib/drivers.mjs (prove it first: roadmap driver verify <id>). The file loads and validates either way.`,
  ]
}

/**
 * A step description states the DECISION (names, signatures, the non-obvious constraint)
 * and its anchor; rationale lives in the designRef/execution prompt, cited not restated.
 * Over this many chars is narration creep — the gauntlet 2026-08 "diff-re-narrating"
 * failure theme, made a floor by phase 2420. Inclusive: sitting exactly on it is within.
 */
const STEP_DESCRIPTION_WARN_CHARS = 700

/** Every step description with the `task N.M step K` label all three lints name it by. */
function* stepDescriptions(phase) {
  for (const t of Array.isArray(phase?.tasks) ? phase.tasks : []) {
    const steps = Array.isArray(t?.steps) ? t.steps : []
    for (const [i, s] of steps.entries()) {
      yield {
        where: `task ${t?.id ?? '?'} step ${i + 1}`,
        description: typeof s?.description === 'string' ? s.description : '',
      }
    }
  }
}

/** One WARN per steps[].description longer than STEP_DESCRIPTION_WARN_CHARS. */
function stepDescriptionLengthWarnings(phase) {
  const num = phase?.phase ?? '?'
  const out = []
  for (const { where, description } of stepDescriptions(phase)) {
    if (description.length > STEP_DESCRIPTION_WARN_CHARS) {
      out.push(
        `[zeroh-roadmap] WARN phase ${num} ${where}: description ` +
          `exceeds ${STEP_DESCRIPTION_WARN_CHARS} chars (${description.length}) — state decisions, not ` +
          `narration; rationale lives in the designRef/execution prompt (plan-phase step contract)`,
      )
    }
  }
  return out
}

/** WARN when new phase prose cites a repo path that neither exists at HEAD nor is planned. */
function citationIntegrityWarnings(phase, normalizedPath) {
  let repo
  try {
    repo = gitToplevel(dirname(normalizedPath))
  } catch {
    return []
  }
  const planned = new Set(
    (Array.isArray(phase?.tasks) ? phase.tasks : [])
      .flatMap((task) => Array.isArray(task?.files) ? task.files : [])
      .filter((file) => typeof file === 'string'),
  )
  const prose = [
    typeof phase?.notes === 'string' ? phase.notes : '',
    ...(Array.isArray(phase?.tasks) ? phase.tasks.flatMap((task) => [
      typeof task?.problem === 'string' ? task.problem : '',
      ...(Array.isArray(task?.steps) ? task.steps.map((step) =>
        typeof step?.description === 'string' ? step.description : '') : []),
    ]) : []),
  ]
  const citations = new Set(
    prose.flatMap((text) => text.match(/(?<![\w./-])(?:src|cli|lib|scripts|plugins|roadmap|docs|web)\/[\w./-]+\.\w+/g) ?? []),
  )
  // The repo's dominant verify idiom is `cd plugins/x && <runner> cli/lib/y.test.mjs`: the cited
  // path is relative to that `cd`, not to the repo root. Every `cd <dir> &&` in the prose is a
  // second root to resolve under — an invented path under that dir still WARNs.
  const cdRoots = new Set(
    prose.flatMap((text) => [...text.matchAll(/\bcd\s+([\w./-]+)\s*&&/g)].map((m) => m[1].replace(/\/+$/, ''))),
  )
  // A planned file cited by its tail (`cli/lib/new.test.mjs` for a files[] entry
  // `plugins/x/cli/lib/new.test.mjs`) is the same planned file.
  const isPlanned = (cited) => planned.has(cited) || [...planned].some((file) => file.endsWith(`/${cited}`))
  const existsAtHead = (path) => {
    execFileSync('git', ['-C', repo, 'cat-file', '-e', `HEAD:${path}`], { stdio: 'ignore', timeout: 10_000 })
    return true
  }
  const out = []
  for (const citedPath of citations) {
    if (isPlanned(citedPath)) continue
    try {
      if (existsAtHead(citedPath)) continue
    } catch (err) {
      if (err?.code === 'ENOENT') return []
    }
    let underCd = false
    for (const dir of cdRoots) {
      try {
        underCd = existsAtHead(`${dir}/${citedPath}`)
        break
      } catch (err) {
        if (err?.code === 'ENOENT') return []
      }
    }
    if (underCd) continue
    out.push(
      `[zeroh-roadmap] WARN phase ${phase?.phase ?? '?'}: citation '${citedPath}' does not exist at HEAD `
        + 'and is not declared in this phase\'s files[] — verify the anchor (atlas-41 invented-prose incident class)',
    )
  }
  return out
}

/** One WARN string per steps[].description missing " → verify:". */
function stepVerifyGrammarWarnings(phase) {
  const num = phase?.phase ?? '?'
  const out = []
  for (const { where, description } of stepDescriptions(phase)) {
    if (!/→\s*verify:/.test(description)) {
      out.push(
        `[zeroh-roadmap] WARN phase ${num} ${where}: description missing ` +
          `" → verify: <command|observable>" (plan-phase authoring grammar; new phase files only)`,
      )
    }
  }
  return out
}

/**
 * A verify clause is only worth writing if it fails EXACTLY when its claim is false. These three
 * shapes fail the other way round, and each cost a real turn before this lint existed (arc
 * SEODESKFIX produced four instances across three phases, written by four different authors):
 *
 *  1. INVERTED — a bare `grep -c` asserting ABSENCE. `grep -c x file` exits 1 when the count is 0,
 *     so the tripwire reds precisely when the thing it wanted gone is gone. Compare explicitly
 *     instead: `test "$(grep -c x file)" = "0"`.
 *  2. PIPED JUDGEMENT — a build/typecheck/test run ending in `| head`, `| tail` or `| grep`. The
 *     pipeline's exit code belongs to the FILTER, so a red compile reads green. Redirect to a file
 *     and read $?. This one masked a real typecheck failure in a shipped consumer.
 *  3. WRONG TEST INVOCATION — `node --test` on a .ts/.tsx path with no loader flag. It cannot run
 *     TypeScript, so it fails identically whether the work succeeded or not. Use the consumer's own
 *     test script form (commonly `node --import tsx --test`).
 *
 * WARN only, and only for a phase file NEW to git, exactly like the grammar lint above: this is a
 * reminder at authoring time, never enforcement. review-phase Mode A is the enforcement, and it can
 * see the things a regex cannot (a grep that matches the very line the task tells the executor to
 * write, or one that passes vacuously because the file does not exist yet).
 */
function verifyPolarityWarnings(phase) {
  const num = phase?.phase ?? '?'
  const out = []
  const flag = (where, cmd) => {
    // A `grep -c` whose result is never compared. `test "$(grep -c …)" = "N"` and `[ "$(…)" -eq N ]`
    // are the correct forms and must not warn, so only fire when no comparison operator is present.
    if (/\bgrep\s+(-[a-zA-Z]*c|--count)\b/.test(cmd) && !/(\btest\b|\[|=|-eq|-ne|-gt|-lt)/.test(cmd)) {
      out.push(
        `[zeroh-roadmap] WARN phase ${num} ${where}: a bare \`grep -c\` exits non-zero on a count of 0, ` +
          `so this reds when the claim is TRUE. Compare the count explicitly, e.g. test "$(grep -c x f)" = "0".`,
      )
    }
    // PER-SEGMENT, never whole-command: a command list judges only its LAST segment's exit,
    // so a later honest `grep -q ...` would otherwise vouch for an earlier runner pipeline
    // whose red is already swallowed. Ask the question of each ; && || segment on its own.
    const segments = cmd.split(/(?:;|&&|\|\|)/)
    const maskedSegment = segments.some((seg) => {
      if (!/(npm run|pnpm |yarn |tsc\b|capbuild|nx run|vitest|node --test|node |npx |tsx )/.test(seg)) return false
      if (!/\|\s*(head|tail|grep)\b/.test(seg)) return false
      const lastPipe = `|${seg.split(/(?<!\|)\|(?!\|)/).at(-1)}`
      const grepIsTheAssertion = /^\|\s*grep\s+(?:-[a-zA-Z]*q\b|--quiet\b)/.test(lastPipe) ||
        (/^\|\s*grep\s+(?:-[a-zA-Z]*c\b|--count\b)/.test(lastPipe) && /(\btest\b|\[|=|-eq|-ne|-gt|-lt)/.test(seg))
      return !grepIsTheAssertion
    })
    if (maskedSegment) {
      out.push(
        `[zeroh-roadmap] WARN phase ${num} ${where}: this judges a build or test run through a pipe, so the ` +
          `exit code is the filter's and a red run reads green (azure 2421 incident class). Redirect to a file and read $?.`,
      )
    }
    // A quoted grep/rg PATTERN that merely CONTAINS `|| true` is search text, not a swallow:
    // strip the whole quoted run before the swallow test.
    const withoutSearchLiterals = cmd.replace(/\b(?:grep|rg)\b[^;&]*?(["'])[^"']*\|\|\s*true[^"']*\1/g, (segment) => segment.replace(/\|\|\s*true/g, ''))
    if (/\|\|\s*true\b/.test(withoutSearchLiterals)) {
      out.push(
        `[zeroh-roadmap] WARN phase ${num} ${where}: \`|| true\` swallows every failing exit ` +
          `(exit-0-always plan-adversary incident class). Remove the swallow and judge the command directly.`,
      )
    }
    if (/;\s*(?:echo(?:\s+[^;&|]*?)?|true)\s*["']?\s*$/.test(cmd)) {
      out.push(
        `[zeroh-roadmap] WARN phase ${num} ${where}: the final bare echo/true replaces the command's verdict ` +
          `(exit-0-always plan-adversary incident class). Preserve and test the original exit code.`,
      )
    }
    if (/node\s+--test\b/.test(cmd) && /\.tsx?\b/.test(cmd) && !/(--import|--loader|--experimental-strip-types)/.test(cmd)) {
      out.push(
        `[zeroh-roadmap] WARN phase ${num} ${where}: \`node --test\` cannot run a .ts file without a loader, ` +
          `so it fails the same way whether the work succeeded or not. Use the consumer's own test script form.`,
      )
    }
  }

  for (const a of Array.isArray(phase?.assumptions) ? phase.assumptions : []) {
    if (typeof a?.verify === 'string') flag(`assumption "${String(a.claim ?? '').slice(0, 40)}"`, a.verify)
  }
  for (const { where, description } of stepDescriptions(phase)) {
    const m = description.split(/→\s*verify:/)[1]
    if (m) flag(where, m)
  }
  return out
}

/** A phase file with no HEAD blob is new to git. git-absent → NOT new (fail open — no warn). */
function isNewToGit(normalizedPath) {
  let roadmapRoot
  try {
    roadmapRoot = gitToplevel(dirname(normalizedPath))
  } catch {
    return false
  }
  try {
    execFileSync('git', ['-C', roadmapRoot, 'cat-file', '-e', `HEAD:${relToRepo(roadmapRoot, normalizedPath)}`], {
      stdio: 'ignore',
      timeout: 10_000,
    })
    return false // HEAD blob exists → committed → grandfathered
  } catch (err) {
    return err?.code !== 'ENOENT' // git ran and the blob is absent → new; git missing (ENOENT) → fail open
  }
}

// ── NEW: the gate-report done-flip consistency rule ─────────────────────────────────

function gateReportConsistencyErrors(phase, normalizedPath) {
  if (phase?.status !== 'done') return []
  const num = typeof phase.phase === 'number' ? phase.phase : Number(phase.phase)
  if (!Number.isFinite(num)) return []
  let toplevel
  try {
    toplevel = gitToplevel(dirname(normalizedPath))
  } catch {
    return [] // git absent → fail open (today's behavior)
  }
  let latest
  try {
    latest = latestReport(toplevel, num)
  } catch (e) {
    if (!(e instanceof GateReportUnreadableError)) throw e
    // Unreadable evidence is a FINDING, not a pass: returning [] here would let a done phase
    // validate clean precisely when its gate record stopped being readable.
    return [
      {
        rule: 'done-without-green-gate-report',
        msg: `${e.name}: ${e.message}`,
        fix: `inspect ${e.path}; delete it if that run is gone, then re-run \`roadmap gate run ${num}\` green and record the correctness rounds with \`roadmap gate run ${num} --record-round …\` before the phase can stay done`,
      },
    ]
  }
  // No run file at all → fail open: the rule judges the evidence a phase HAS, and a consumer
  // that has not adopted the gate is not making a false claim.
  if (!latest) return []
  const result = checkPhaseConsistency(phase, latest.report)
  if (result.ok) return []
  return result.problems.map((p) => ({
    rule: 'done-without-green-gate-report',
    msg: `${p} (report: ${latest.path})`,
    fix: `re-run \`roadmap gate run ${num}\` green and record the correctness rounds with \`roadmap gate run ${num} --record-round …\` before flipping to done`,
  }))
}

// ── ported helpers (verbatim behavior from bin/validate-roadmap-file.mjs) ────────────

function phaseChecks(phase) {
  const errs = []
  const num = typeof phase.phase === 'number' ? phase.phase : Number(phase.phase)
  const tasks = Array.isArray(phase.tasks) ? phase.tasks : []
  if (phase.status === 'done') {
    const open = tasks.filter((t) => t && t.done === false)
    if (open.length > 0) {
      const ids = open.map((t) => t.id ?? '?').join(', ')
      errs.push({
        rule: 'done-with-open-task',
        msg: `status:'done' but ${open.length} task(s) have done:false (${ids})`,
        fix: 'finish or escalate the task, or set status back to in-progress — a done phase cannot carry open work (the 1281.7/1282.6 defect)',
      })
    }
  }
  if (Number.isFinite(num) && num >= ENFORCEMENT_FLOOR) {
    for (const t of tasks) {
      const tr = t?.transparencyReport
      if (!tr) continue
      // The schema floors these strings at 10 chars, so a bare 'None' cannot be written —
      // authors say "None — nothing was traded away". Treat any None-leading phrase as none,
      // else the two rules contradict and every clean task is forced to invent a decisionRef.
      const isNone = (v) => !v || /^none\b/i.test(String(v).trim())
      const hasComp = !isNone(tr.compromises)
      const hasSkip = !isNone(tr.skipped)
      if ((hasComp || hasSkip) && !tr.decisionRef) {
        errs.push({
          rule: 'compromise-without-decisionRef',
          msg: `task ${t.id ?? '?'} records a non-"None" ${hasComp ? 'compromise' : 'skipped'} but transparencyReport has no decisionRef`,
          fix: 'add transparencyReport.decisionRef — the architect verdict or user ratification that authorized it (a compromise in a commit message alone is the 1343.6 defect)',
        })
      }
    }
    if (phase.userFacing === true && phase.flag == null) {
      errs.push({
        rule: 'userFacing-without-flag',
        msg: 'userFacing:true but no flag',
        fix: 'add flag:{id:"FLAG_ID"} (a runtime kill-switch) or flag:{bootWired:true, justification:"…"} + a feature-manifest entry (the 1345 unflagged-feature defect)',
      })
    }
  }
  return errs
}

function duplicateTopLevelKeyErrors(content) {
  const open = content.match(/define(?:Phase|Arc)\(\{/)
  if (!open) return []
  const lines = content.slice(open.index + open[0].length).split('\n')
  const seen = new Set()
  const dups = new Set()
  let inTemplate = false
  for (const line of lines) {
    if (!inTemplate && /^\}\)/.test(line)) break
    if (!inTemplate) {
      const km = line.match(/^ {2}([A-Za-z_$][\w$]*):/)
      if (km) {
        if (seen.has(km[1])) dups.add(km[1])
        else seen.add(km[1])
      }
    }
    let sq = false
    let dq = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '\\') {
        i++
        continue
      }
      if (inTemplate) {
        if (c === '`') inTemplate = false
      } else if (sq) {
        if (c === "'") sq = false
      } else if (dq) {
        if (c === '"') dq = false
      } else if (c === "'") sq = true
      else if (c === '"') dq = true
      else if (c === '`') inTemplate = true
    }
  }
  return [...dups].map((k) => ({
    rule: 'duplicate-key',
    msg: `top-level key '${k}' appears more than once (JS keeps only the last — the 1287 latent trap)`,
    fix: `remove the duplicate '${k}' (keep the intended value)`,
  }))
}

function arcImmutabilityChecks(arc, content, arcFile) {
  const id = arc?.id
  if (id == null) return []
  const arcDir = dirname(arcFile)
  const sidecar = join(arcDir, '.building', `${id}.json`)
  if (!existsSync(sidecar)) return []
  const roadmapRoot = arcDir.replace(/\/arcs$/, '')
  let headContent
  try {
    headContent = execFileSync('git', ['-C', roadmapRoot, 'show', `HEAD:${relToRepo(roadmapRoot, arcFile)}`], {
      timeout: 10_000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return []
  }
  // Collected, never early-returned: the append-only check below must fire even when the
  // acceptanceCriteria branch would have short-circuited (unchanged AC, or a fresh ratification).
  const out = []
  // Append-only means every HEAD entry SURVIVES verbatim (whitespace-normalized) — a content
  // compare, not a count compare: a delete hidden behind an unrelated append (2→2) and an
  // in-place rewrite both erase a recorded rejection without shrinking the count.
  const normEl = (s) => s.replace(/\s+/g, ' ').trim()
  const curRejEls = topLevelElements(extractKeyBlock(content, 'rejectedAlternatives')).map(normEl)
  const headRejEls = topLevelElements(extractKeyBlock(headContent, 'rejectedAlternatives')).map(normEl)
  const pool = [...curRejEls]
  const erased = headRejEls.filter((e) => {
    const at = pool.indexOf(e)
    if (at === -1) return true
    pool.splice(at, 1)
    return false
  })
  if (erased.length > 0) {
    out.push({
      rule: 'rejectedAlternatives-append-only',
      msg: `arc ${id} is building but ${erased.length} recorded rejection(s) were deleted or rewritten (HEAD had ${headRejEls.length}, ${curRejEls.length} now)`,
      fix: 'a rejection is history — append a superseding dated entry, never delete or rewrite one',
    })
  }
  const norm = (s) => (s ? s.replace(/\s+/g, ' ').trim() : '')
  const curAC = norm(extractKeyBlock(content, 'acceptanceCriteria'))
  const headAC = norm(extractKeyBlock(headContent, 'acceptanceCriteria'))
  if (curAC !== headAC) {
    const curRat = countTopLevelElements(extractKeyBlock(content, 'criteriaRatifications'))
    const headRat = countTopLevelElements(extractKeyBlock(headContent, 'criteriaRatifications'))
    if (!(curRat > headRat)) {
      out.push({
        rule: 'acceptanceCriteria-immutable',
        msg: `arc ${id} is building but its acceptanceCriteria changed without a new criteriaRatifications entry (was ${headRat}, now ${curRat})`,
        fix: 'append a dated entry to criteriaRatifications explaining the change, or record a typed descope — never silently narrow a criterion (the 1343.6 defect)',
      })
    }
  }
  return out
}

/** WARN-level adoption nudge (NEW-to-git arc files only, mirroring the phase-lint grandfather
 *  gate): an arc whose prose says REJECTED but which carries no typed `rejectedAlternatives:`
 *  key is burying a rejection where no planner's grep will find it. Never an error —
 *  review-phase H2 is the enforcement. */
function rejectedProseWarnings(arc, content, normalizedPath) {
  const id = arc?.id ?? normalizedPath
  if (!/\bREJECTED\b/.test(content)) return []
  if (/\brejectedAlternatives\s*:/.test(content)) return []
  return [
    `[zeroh-roadmap] WARN arc ${id}: prose says REJECTED but there is no typed ` +
      `rejectedAlternatives: entry — record the ruled-out option in the field so a future ` +
      `planner's grep finds it (new arc files only)`,
  ]
}

function extractKeyBlock(content, key) {
  if (!content) return null
  const at = content.search(new RegExp(`(^|\\n)\\s*${key}:`))
  if (at < 0) return null
  let i = content.indexOf(':', at) + 1
  while (i < content.length && /\s/.test(content[i])) i++
  if (content[i] !== '[' && content[i] !== '{') return null
  return extractBalanced(content, i)
}

function extractBalanced(text, openIdx) {
  const open = text[openIdx]
  const close = open === '[' ? ']' : '}'
  let depth = 0
  let quote = null
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (c === '\\') {
        i++
        continue
      }
      if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c
      continue
    }
    if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) return text.slice(openIdx, i + 1)
    }
  }
  return null
}

function countTopLevelElements(arrayBlock) {
  return topLevelElements(arrayBlock).length
}

/** Split an extractKeyBlock array block into its top-level element source strings (the same
 *  quote/depth tokenizer countTopLevelElements always used, kept segment-wise so immutability
 *  guards can compare CONTENT, not just counts). */
function topLevelElements(arrayBlock) {
  if (!arrayBlock) return []
  const inner = arrayBlock.slice(1, -1)
  let depth = 0
  let quote = null
  const elements = []
  let seg = ''
  let segHasContent = false
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]
    if (quote) {
      if (c === '\\') {
        seg += c + (inner[i + 1] ?? '')
        i++
        continue
      }
      if (c === quote) quote = null
      seg += c
      segHasContent = true
      continue
    }
    // A `// …` line comment outside quotes is annotation, never content: the trailing `// R17`
    // marker after an array's last entry must not become a phantom element that every honest
    // append "erases" (VF 2026-09-07). Skip to end of line; the newline itself is whitespace.
    if (c === '/' && inner[i + 1] === '/') {
      const eol = inner.indexOf('\n', i)
      i = eol === -1 ? inner.length : eol
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c
      segHasContent = true
    } else if (c === '[' || c === '{' || c === '(') {
      depth++
      segHasContent = true
    } else if (c === ']' || c === '}' || c === ')') {
      depth--
      segHasContent = true
    } else if (c === ',' && depth === 0) {
      if (segHasContent) elements.push(seg)
      seg = ''
      segHasContent = false
      continue
    } else if (!/\s/.test(c)) {
      segHasContent = true
    }
    seg += c
  }
  if (segHasContent) elements.push(seg)
  return elements
}

function runPhaseNumberAndClaimChecks(normalizedPath, phaseMatch) {
  const errs = []
  const declared = readFileSync(normalizedPath, 'utf8').match(/(?:^|[{,])\s*phase:\s*(\d+)\s*,/m)
  const phaseNum = declared?.[1] ?? phaseMatch[1]
  if (declared && declared[1] !== phaseMatch[1]) {
    return [{ rawLines: [`[zeroh-roadmap] filename/content mismatch: ${basename(normalizedPath)} declares phase: ${declared[1]}`] }]
  }
  const roadmapRoot = normalizedPath.replace(/\/phases\/phase-\d+\.phase\.ts$/, '')
  const holders = []
  const scanDir = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) scanDir(full)
      else if (entry.name.endsWith('.phase.ts')) {
        try {
          if (new RegExp(`(?:^|[{,])\\s*phase:\\s*${phaseNum}\\s*,`, 'm').test(readFileSync(full, 'utf8'))) holders.push(full)
        } catch {
          /* unreadable sibling */
        }
      }
    }
  }
  scanDir(join(roadmapRoot, 'phases'))
  scanDir(join(roadmapRoot, 'archive'))
  const others = holders.filter((f) => resolve(f).replace(/\\/g, '/') !== normalizedPath)
  if (others.length > 0) {
    return [
      {
        rawLines: [
          `[zeroh-roadmap] duplicate phase number ${phaseNum}: ${basename(normalizedPath)} collides with ${others.join(', ')}`,
          'Pick the next free number (scripts/claim-phase-number.sh reserves one atomically).',
        ],
      },
    ]
  }

  const legacyClaim = join(roadmapRoot, 'phases', '.claims', `${phaseNum}.claim`)
  const common = gitCommonDir(roadmapRoot)
  const sharedClaim = common ? join(common, 'zeroh-roadmap-claims', `${phaseNum}.claim`) : null
  if ((sharedClaim && existsSync(sharedClaim)) || existsSync(legacyClaim)) return errs
  let isNewFile = false
  try {
    execFileSync('git', ['-C', roadmapRoot, 'cat-file', '-e', `HEAD:${relToRepo(roadmapRoot, normalizedPath)}`], {
      stdio: 'ignore',
      timeout: 10_000,
    })
  } catch (err) {
    isNewFile = err?.code !== 'ENOENT'
  }
  if (isNewFile && process.env.ZEROH_ROADMAP_STRICT_CLAIMS === '1') {
    return [
      {
        rawLines: [
          `[zeroh-roadmap] phase ${phaseNum} is NEW but holds no claim (${sharedClaim ?? legacyClaim} missing). ` +
            'Concurrent sessions collide without one — reserve numbers BEFORE authoring: ' +
            'bash <plugin>/scripts/claim-phase-number.sh (creation is the lock; delete the .claim in the landing commit).',
        ],
      },
    ]
  }
  return errs
}

function gitCommonDir(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'rev-parse', '--git-common-dir'], { timeout: 10_000, encoding: 'utf8' }).trim()
    return resolve(root, out)
  } catch {
    return null
  }
}

function relToRepo(roadmapRoot, absPath) {
  try {
    const top = execFileSync('git', ['-C', roadmapRoot, 'rev-parse', '--show-toplevel'], { timeout: 10_000 })
      .toString()
      .trim()
      .replace(/\\/g, '/')
    return absPath.startsWith(top + '/') ? absPath.slice(top.length + 1) : absPath
  } catch {
    return absPath
  }
}

/** Render a Zod-issue result to the bin's verbatim stderr lines (schema validation failed …). */
export function renderZodIssues(file, issuesJson, { debug } = {}) {
  const lines = [`[zeroh-roadmap] schema validation failed: ${file}`]
  let issues
  if (Array.isArray(issuesJson)) issues = issuesJson
  else {
    try {
      issues = JSON.parse(issuesJson)
    } catch {
      issues = []
    }
  }
  if (!Array.isArray(issues) || issues.length === 0) {
    lines.push('  (unparseable Zod error — set ZEROH_ROADMAP_DEBUG=1 for the raw error)')
    return lines
  }
  for (const iss of issues) {
    const path = Array.isArray(iss.path) && iss.path.length > 0 ? iss.path.join('.') : '(root)'
    let extra = ''
    if (iss.code === 'too_big' && iss.maximum != null) extra = ` (max ${iss.maximum})`
    else if (iss.code === 'too_small' && iss.minimum != null) extra = ` (min ${iss.minimum})`
    lines.push(`  ${path}: ${iss.message}${extra}`)
  }
  if (!debug) lines.push('  (set ZEROH_ROADMAP_DEBUG=1 for the full stack)')
  return lines
}

export function firstMeaningfulLine(stderr) {
  return (stderr || '')
    .split('\n')
    .map((s) => s.trim())
    .find(Boolean) || ''
}
