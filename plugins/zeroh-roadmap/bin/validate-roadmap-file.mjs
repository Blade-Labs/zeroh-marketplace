#!/usr/bin/env node
/**
 * PostToolUse validator for roadmap files (zeroh-roadmap plugin) — v2.
 *
 * Reads the Claude Code hook payload from stdin; when the written/edited file is
 * a roadmap artifact (phase/arc/backlog), validates it in three passes:
 *   1. Import-time Zod parse via tsx (definePhase/defineArc/defineBacklog run
 *      .parse() at import) — a failure is pretty-printed ONE line per issue
 *      (`<path>: <message>`), never a raw stack (set ZEROH_ROADMAP_DEBUG=1 for it).
 *   2. v2 structural checks that catch the six 2026-07-04 audit defect classes the
 *      Zod shape alone can't: (a) status:'done' with an open task, (b) a duplicate
 *      top-level key, (c) a non-"None" compromise/skipped without a decisionRef,
 *      (d) a userFacing phase without a flag, (e) an arc's acceptanceCriteria
 *      mutated after building started without a ratification.
 *   3. duplicate phase-number + claim-before-start (the claim dir now follows
 *      git-common-dir so it is shared across worktrees, with a legacy fallback).
 *
 * Exit codes: 0 = pass / not-a-roadmap-file / toolchain unavailable (never block
 * editing in a repo without tsx); 2 = validation failed (stderr names the rule and
 * the fix). Checks (a)/(b) are ALWAYS on; (c)/(d) apply to phases planned after arc
 * ROADOPUS (ENFORCEMENT_FLOOR); (e) to building arcs only.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

/** Phases planned after arc ROADOPUS — the corpus below this floor is exempt from
 *  the provenance rules (c)/(d) so the 1,100+ historical files keep landing. */
const ENFORCEMENT_FLOOR = 1365

// The tsx one-liner that IS the import-parse: import the target and print its
// parsed default export as JSON on success, or the structured Zod issues (exit 3)
// / a raw load error (exit 4) on failure. argv[1] is the target path.
// tsx's CJS↔ESM interop can double-wrap the default export (m.default = { default:
// <obj> }) depending on the target repo's module type. A phase/arc/backlog object
// never has a `default` field, so unwrapping one level only when `.default` exists
// is correct whether or not the wrap happened.
const IMPORT_CHECK = `
import('file://' + process.argv[1])
  .then((m) => {
    let d = m && m.default
    if (d && typeof d === 'object' && d.default != null) d = d.default
    process.stdout.write('PARSED:' + JSON.stringify(d ?? null))
  })
  .catch((e) => {
    if (e && Array.isArray(e.issues)) { process.stderr.write('ZODISSUES:' + JSON.stringify(e.issues)); process.exit(3) }
    process.stderr.write(String((e && e.stack) || e)); process.exit(4)
  })
`

function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

const raw = readStdin()
if (!raw.trim()) process.exit(0)

let payload
try {
  payload = JSON.parse(raw)
} catch {
  process.exit(0)
}

const filePath = payload?.tool_input?.file_path ?? payload?.tool_input?.filePath
if (typeof filePath !== 'string') process.exit(0)

const normalized = resolve(filePath).replace(/\\/g, '/')
const isPhase = /\/roadmap\/.*\.phase\.ts$/.test(normalized)
const isArc = /\/roadmap\/.*\.arc\.ts$/.test(normalized)
const isBacklog = /\/roadmap\/backlog\.ts$/.test(normalized)
if (!isPhase && !isArc && !isBacklog) process.exit(0)
if (!existsSync(normalized)) process.exit(0) // deleted/renamed since the edit

// ── Pass 1: import-parse (Zod) + capture the parsed object ─────────────────────
// Toolchain absence fails OPEN (exit 0): blocking every edit in a repo without
// tsx would be worse than no hook.
let parsed = null
try {
  const out = execFileSync('npx', ['--no-install', 'tsx', '-e', IMPORT_CHECK, normalized], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
    encoding: 'utf8',
  })
  const idx = out.indexOf('PARSED:')
  if (idx >= 0) {
    try {
      parsed = JSON.parse(out.slice(idx + 'PARSED:'.length))
    } catch {
      parsed = null // structured checks fail-open; import validity already held
    }
  }
} catch (err) {
  const stderr = err?.stderr?.toString?.() ?? ''
  // Classify OUR wrapper's structured exits first (3 = ZodError, 4 = load error),
  // so a genuine schema failure is never misread as a missing toolchain even if a
  // Zod message happened to contain "not found".
  if (err?.status === 3 && stderr.startsWith('ZODISSUES:')) {
    printZodIssues(normalized, stderr.slice('ZODISSUES:'.length))
    process.exit(2)
  }
  const notFound =
    err?.code === 'ENOENT' || /not found|could not determine executable|npx: command/i.test(stderr)
  if (notFound) {
    console.error('[zeroh-roadmap] tsx unavailable — roadmap file NOT validated (install tsx to arm this hook)')
    process.exit(0)
  }
  console.error(`[zeroh-roadmap] roadmap file failed to load: ${basename(normalized)}`)
  console.error(
    process.env.ZEROH_ROADMAP_DEBUG === '1' ? stderr || String(err) : firstMeaningfulLine(stderr) || String(err),
  )
  process.exit(2)
}

const content = readFileSync(normalized, 'utf8')
const errors = []

// ── Pass 2: v2 structural checks ──────────────────────────────────────────────
if (isPhase || isArc) errors.push(...duplicateTopLevelKeyErrors(content))
if (isPhase && parsed) errors.push(...phaseChecks(parsed))
if (isArc && parsed) errors.push(...arcImmutabilityChecks(parsed, content, normalized))

if (errors.length > 0) {
  for (const e of errors) console.error(`[zeroh-roadmap] ${e.rule}: ${e.msg} — fix: ${e.fix}`)
  process.exit(2)
}

// ── Pass 3: duplicate phase-number + claim-before-start (phase files) ──────────
if (isPhase) {
  const phaseMatch = normalized.match(/\/roadmap\/phases\/phase-(\d+)\.phase\.ts$/)
  if (phaseMatch) runPhaseNumberAndClaimChecks(normalized, phaseMatch)
}

process.exit(0)

// ── helpers ────────────────────────────────────────────────────────────────────

function printZodIssues(file, issuesJson) {
  console.error(`[zeroh-roadmap] schema validation failed: ${basename(file)}`)
  let issues
  try {
    issues = JSON.parse(issuesJson)
  } catch {
    issues = []
  }
  if (!Array.isArray(issues) || issues.length === 0) {
    console.error('  (unparseable Zod error — set ZEROH_ROADMAP_DEBUG=1 for the raw error)')
    return
  }
  for (const iss of issues) {
    const path = Array.isArray(iss.path) && iss.path.length > 0 ? iss.path.join('.') : '(root)'
    let extra = ''
    if (iss.code === 'too_big' && iss.maximum != null) extra = ` (max ${iss.maximum})`
    else if (iss.code === 'too_small' && iss.minimum != null) extra = ` (min ${iss.minimum})`
    console.error(`  ${path}: ${iss.message}${extra}`)
  }
  if (process.env.ZEROH_ROADMAP_DEBUG !== '1') console.error('  (set ZEROH_ROADMAP_DEBUG=1 for the full stack)')
}

function firstMeaningfulLine(stderr) {
  return (stderr || '')
    .split('\n')
    .map((s) => s.trim())
    .find(Boolean) || ''
}

function phaseChecks(phase) {
  const errs = []
  const num = typeof phase.phase === 'number' ? phase.phase : Number(phase.phase)
  const tasks = Array.isArray(phase.tasks) ? phase.tasks : []
  // (a) status:'done' ⇒ every task done — ALWAYS on. Only EXPLICIT done:false is a
  //     defect (minimal historical tasks legitimately omit the field).
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
    // (c) non-"None" compromise/skipped ⇒ decisionRef present
    for (const t of tasks) {
      const tr = t?.transparencyReport
      if (!tr) continue
      const hasComp = tr.compromises && tr.compromises !== 'None'
      const hasSkip = tr.skipped && tr.skipped !== 'None'
      if ((hasComp || hasSkip) && !tr.decisionRef) {
        errs.push({
          rule: 'compromise-without-decisionRef',
          msg: `task ${t.id ?? '?'} records a non-"None" ${hasComp ? 'compromise' : 'skipped'} but transparencyReport has no decisionRef`,
          fix: 'add transparencyReport.decisionRef — the architect verdict or user ratification that authorized it (a compromise in a commit message alone is the 1343.6 defect)',
        })
      }
    }
    // (d) userFacing:true ⇒ flag present
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

// (b) duplicate top-level keys — a light, indentation-anchored TEXTUAL scan (NOT a
//     parser) that SKIPS lines inside backtick template literals, so 2-space
//     `key:` prose inside a notes template never false-positives.
function duplicateTopLevelKeyErrors(content) {
  const open = content.match(/define(?:Phase|Arc)\(\{/)
  if (!open) return []
  const lines = content.slice(open.index + open[0].length).split('\n')
  const seen = new Set()
  const dups = new Set()
  // `inTemplate` (a backtick template literal) is the only string state that spans
  // lines; ' and " strings are single-line here (concatenated with +). Track it
  // QUOTE-AWARE so a backtick INSIDE a '...'/"..." value never toggles it (else a
  // lone backtick in e.g. `source` desyncs the scan and false-flags notes prose).
  let inTemplate = false
  for (const line of lines) {
    if (!inTemplate && /^\}\)/.test(line)) break // top-level close (only when not mid-template)
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
        i++ // skip the escaped char in every state
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

// (e) arc acceptanceCriteria immutability once building. Git-plumbing only; a
//     brand-new arc file (no HEAD version) always passes.
function arcImmutabilityChecks(arc, content, arcFile) {
  const id = arc?.id
  if (id == null) return []
  const arcDir = dirname(arcFile)
  const sidecar = join(arcDir, '.building', `${id}.json`)
  if (!existsSync(sidecar)) return [] // not building — criteria free to change during planning
  const roadmapRoot = arcDir.replace(/\/arcs$/, '')
  let headContent
  try {
    headContent = execFileSync('git', ['-C', roadmapRoot, 'show', `HEAD:${relToRepo(roadmapRoot, arcFile)}`], {
      timeout: 10_000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return [] // not in HEAD (new arc) or git absent → pass
  }
  const norm = (s) => (s ? s.replace(/\s+/g, ' ').trim() : '')
  const curAC = norm(extractKeyBlock(content, 'acceptanceCriteria'))
  const headAC = norm(extractKeyBlock(headContent, 'acceptanceCriteria'))
  if (curAC === headAC) return [] // unchanged
  const curRat = countTopLevelElements(extractKeyBlock(content, 'criteriaRatifications'))
  const headRat = countTopLevelElements(extractKeyBlock(headContent, 'criteriaRatifications'))
  if (curRat > headRat) return [] // a ratification was recorded for the change
  return [
    {
      rule: 'acceptanceCriteria-immutable',
      msg: `arc ${id} is building but its acceptanceCriteria changed without a new criteriaRatifications entry (was ${headRat}, now ${curRat})`,
      fix: 'append a dated entry to criteriaRatifications explaining the change, or record a typed descope — never silently narrow a criterion (the 1343.6 defect)',
    },
  ]
}

/** The balanced `[...]`/`{...}` value of a top-level `key:` in the file text, or
 *  null. String-aware (skips brackets inside ' " ` literals). */
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

/** Count top-level elements of an `[...]` block (string-aware, depth-aware). A
 *  top-level comma counts only when the segment before it had content, and a
 *  final content-bearing segment adds one — so a trailing comma does NOT inflate. */
function countTopLevelElements(arrayBlock) {
  if (!arrayBlock) return 0
  const inner = arrayBlock.slice(1, -1)
  let depth = 0
  let quote = null
  let count = 0
  let segHasContent = false
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]
    if (quote) {
      if (c === '\\') {
        i++
        continue
      }
      if (c === quote) quote = null
      segHasContent = true
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
      if (segHasContent) count++
      segHasContent = false
    } else if (!/\s/.test(c)) {
      segHasContent = true
    }
  }
  return segHasContent ? count + 1 : count
}

function runPhaseNumberAndClaimChecks(normalizedPath, phaseMatch) {
  // The DECLARED number is what discovery keys on — a file can lie about its
  // filename, so parse the content and flag a filename/content mismatch too.
  const declared = readFileSync(normalizedPath, 'utf8').match(/(?:^|[{,])\s*phase:\s*(\d+)\s*,/m)
  const phaseNum = declared?.[1] ?? phaseMatch[1]
  if (declared && declared[1] !== phaseMatch[1]) {
    console.error(`[zeroh-roadmap] filename/content mismatch: ${basename(normalizedPath)} declares phase: ${declared[1]}`)
    process.exit(2)
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
          if (new RegExp(`(?:^|[{,])\\s*phase:\\s*${phaseNum}\\s*,`, 'm').test(readFileSync(full, 'utf8'))) {
            holders.push(full)
          }
        } catch {
          /* unreadable sibling — the import pass above owns its own file's errors */
        }
      }
    }
  }
  scanDir(join(roadmapRoot, 'phases'))
  scanDir(join(roadmapRoot, 'archive'))
  const others = holders.filter((f) => resolve(f).replace(/\\/g, '/') !== normalizedPath)
  if (others.length > 0) {
    console.error(
      `[zeroh-roadmap] duplicate phase number ${phaseNum}: ${basename(normalizedPath)} collides with ${others.join(', ')}`,
    )
    console.error('Pick the next free number (scripts/claim-phase-number.sh reserves one atomically).')
    process.exit(2)
  }

  // Claim-before-start: the claim dir follows git-common-dir (shared across ALL
  // worktrees of the repo), with the legacy per-worktree roadmap/phases/.claims
  // path kept as a transition-window fallback. Git absence fails OPEN.
  const legacyClaim = join(roadmapRoot, 'phases', '.claims', `${phaseNum}.claim`)
  const common = gitCommonDir(roadmapRoot)
  const sharedClaim = common ? join(common, 'zeroh-roadmap-claims', `${phaseNum}.claim`) : null
  if ((sharedClaim && existsSync(sharedClaim)) || existsSync(legacyClaim)) return
  let isNewFile = false
  try {
    execFileSync('git', ['-C', roadmapRoot, 'cat-file', '-e', `HEAD:${relToRepo(roadmapRoot, normalizedPath)}`], {
      stdio: 'ignore',
      timeout: 10_000,
    })
  } catch (err) {
    // ENOENT = git missing → fail open; a non-zero exit = path not in HEAD → new file.
    isNewFile = err?.code !== 'ENOENT'
  }
  if (isNewFile) {
    console.error(
      `[zeroh-roadmap] phase ${phaseNum} is NEW but holds no claim (${sharedClaim ?? legacyClaim} missing). ` +
        'Concurrent sessions collide without one — reserve numbers BEFORE authoring: ' +
        'bash <plugin>/scripts/claim-phase-number.sh (creation is the lock; delete the .claim in the landing commit).',
    )
    if (process.env.ZEROH_ROADMAP_STRICT_CLAIMS === '1') process.exit(2)
  }
}

/** Absolute git-common-dir for the repo containing `root` (shared across all
 *  worktrees), or null when not a git repo. Resolves a relative `.git`. */
function gitCommonDir(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'rev-parse', '--git-common-dir'], {
      timeout: 10_000,
      encoding: 'utf8',
    }).trim()
    return resolve(root, out)
  } catch {
    return null
  }
}

/** Repo-relative path for git cat-file/show, resolved against the roadmap root's repo. */
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
