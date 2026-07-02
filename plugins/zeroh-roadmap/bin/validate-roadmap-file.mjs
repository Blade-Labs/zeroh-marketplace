#!/usr/bin/env node
/**
 * PostToolUse validator for roadmap files (zeroh-roadmap plugin).
 *
 * Reads the Claude Code hook payload from stdin, and when the written/edited
 * file is a roadmap artifact (roadmap phases/arcs/backlog), validates it by
 * importing it through tsx — `definePhase()`/`defineArc()`/`defineBacklog()`
 * run their Zod `.parse()` at import time, so the import IS the validation.
 * A phase file additionally gets a duplicate-phase-number check across
 * roadmap/phases/ and roadmap/archive/.
 *
 * Exit codes: 0 = pass / not-a-roadmap-file / toolchain unavailable (never
 * block editing in a repo without tsx); 2 = validation failed — stderr
 * carries the Zod error so the driver must fix the file before proceeding.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

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
const isRoadmapArtifact =
  /\/roadmap\/.*\.(phase|arc)\.ts$/.test(normalized) || /\/roadmap\/backlog\.ts$/.test(normalized)
if (!isRoadmapArtifact) process.exit(0)
if (!existsSync(normalized)) process.exit(0) // deleted/renamed since the edit — nothing to validate

// 1) Import-time Zod parse via tsx. Toolchain absence fails OPEN (exit 0):
//    blocking every edit in a repo without tsx would be worse than no hook.
try {
  execFileSync('npx', ['--no-install', 'tsx', normalized], {
    stdio: ['ignore', 'ignore', 'pipe'],
    timeout: 60_000,
  })
} catch (err) {
  const stderr = err?.stderr?.toString?.() ?? ''
  const notFound =
    err?.code === 'ENOENT' || /not found|could not determine executable|npx: command/i.test(stderr)
  if (notFound) {
    console.error('[zeroh-roadmap] tsx unavailable — roadmap file NOT validated (install tsx to arm this hook)')
    process.exit(0)
  }
  console.error(`[zeroh-roadmap] roadmap file failed validation: ${normalized}`)
  console.error(stderr.slice(-4000) || String(err))
  process.exit(2)
}

// 2) Duplicate phase-number check (phase files only) — the one discovery error
//    that must stay fatal repo-wide, caught here before it can land.
const phaseMatch = normalized.match(/\/roadmap\/phases\/phase-(\d+)\.phase\.ts$/)
if (phaseMatch) {
  // The DECLARED number is what discovery keys on — a file can lie about its
  // filename, so parse the content and flag filename/content mismatch too.
  const declared = readFileSync(normalized, 'utf8').match(/(?:^|[{,])\s*phase:\s*(\d+)\s*,/m)
  const phaseNum = declared?.[1] ?? phaseMatch[1]
  if (declared && declared[1] !== phaseMatch[1]) {
    console.error(
      `[zeroh-roadmap] filename/content mismatch: ${basename(normalized)} declares phase: ${declared[1]}`,
    )
    process.exit(2)
  }
  const roadmapRoot = normalized.replace(/\/phases\/phase-\d+\.phase\.ts$/, '')
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
          /* unreadable sibling — the tsx pass above owns its own file's errors */
        }
      }
    }
  }
  scanDir(join(roadmapRoot, 'phases'))
  scanDir(join(roadmapRoot, 'archive'))
  const others = holders.filter((f) => resolve(f).replace(/\\/g, '/') !== normalized)
  if (others.length > 0) {
    console.error(
      `[zeroh-roadmap] duplicate phase number ${phaseNum}: ${basename(normalized)} collides with ${others.join(', ')}`,
    )
    console.error('Pick the next free number (scripts/claim-phase-number.sh reserves one atomically).')
    process.exit(2)
  }

  // 3) Claim-before-start: a NEW phase file (not yet in git HEAD) should hold a
  //    .claims/<N>.claim reservation — under real multi-session concurrency the
  //    claim IS the collision lock (creation-is-the-lock, claim-phase-number.sh).
  //    Warn loudly by default; ZEROH_ROADMAP_STRICT_CLAIMS=1 makes it blocking.
  //    Git absence / non-repo fails OPEN — never block a repo without git.
  const claimPath = join(roadmapRoot, 'phases', '.claims', `${phaseNum}.claim`)
  if (!existsSync(claimPath)) {
    let isNewFile = false
    try {
      execFileSync('git', ['-C', roadmapRoot, 'cat-file', '-e', `HEAD:${relToRepo(roadmapRoot, normalized)}`], {
        stdio: 'ignore',
        timeout: 10_000,
      })
    } catch (err) {
      // ENOENT = git missing → fail open; a non-zero exit = path not in HEAD → new file.
      isNewFile = err?.code !== 'ENOENT'
    }
    if (isNewFile) {
      const msg =
        `[zeroh-roadmap] phase ${phaseNum} is NEW but holds no claim (${claimPath} missing). ` +
        `Concurrent sessions collide without one — reserve numbers BEFORE authoring: ` +
        `bash <plugin>/scripts/claim-phase-number.sh (creation is the lock; delete the .claim in the landing commit).`
      console.error(msg)
      if (process.env.ZEROH_ROADMAP_STRICT_CLAIMS === '1') process.exit(2)
    }
  }
}

/** Repo-relative path for git cat-file, resolved against the roadmap root's repo. */
function relToRepo(roadmapRoot, absPath) {
  try {
    const top = execFileSync('git', ['-C', roadmapRoot, 'rev-parse', '--show-toplevel'], {
      timeout: 10_000,
    })
      .toString()
      .trim()
      .replace(/\\/g, '/')
    return absPath.startsWith(top + '/') ? absPath.slice(top.length + 1) : absPath
  } catch {
    return absPath
  }
}

process.exit(0)
