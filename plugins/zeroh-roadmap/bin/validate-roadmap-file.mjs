#!/usr/bin/env node
/**
 * PostToolUse validator for roadmap files (zeroh-roadmap plugin) — v3.
 *
 * A THIN adapter over cli/lib/validate.mjs (arc ROADCODE 1656.7): the whole rule engine
 * now lives in that shared module (also invocable as `roadmap phase validate`). This bin
 * keeps ONLY the stdin hook-payload head + the verbatim stderr/exit-code mapping, so the
 * write-hook behavior is byte-preserved (the fixture suite passes UNMODIFIED). tsx
 * absence still fails OPEN (exit 0 — never block editing in a repo without tsx).
 *
 * Exit codes: 0 = pass / not-a-roadmap-file / toolchain unavailable; 2 = validation failed.
 */
import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { validateRoadmapFile, renderZodIssues, firstMeaningfulLine } from '../cli/lib/validate.mjs'

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

const result = validateRoadmapFile(filePath, { strict: false })
const file = basename(resolve(filePath))

// WARN-level lints (e.g. the `step → verify:` grammar on new phase files) print to stderr
// and NEVER change the exit code — a reminder, not a gate.
for (const w of result.warnings ?? []) console.error(w)

switch (result.kind) {
  case 'ok':
  case 'skip':
    process.exit(0)
    break
  case 'toolchain-missing':
    console.error('[zeroh-roadmap] tsx unavailable — roadmap file NOT validated (install tsx to arm this hook)')
    process.exit(0)
    break
  case 'load-error':
    console.error(`[zeroh-roadmap] roadmap file failed to load: ${file}`)
    console.error(process.env.ZEROH_ROADMAP_DEBUG === '1' ? result.loadError : firstMeaningfulLine(result.loadError))
    process.exit(2)
    break
  case 'zod':
    for (const l of renderZodIssues(result.zod.file, result.zod.issues, { debug: process.env.ZEROH_ROADMAP_DEBUG === '1' }))
      console.error(l)
    process.exit(2)
    break
  case 'errors':
    for (const e of result.errors) {
      if (e.rawLines) for (const l of e.rawLines) console.error(l)
      else console.error(`[zeroh-roadmap] ${e.rule}: ${e.msg} — fix: ${e.fix}`)
    }
    process.exit(2)
    break
  default:
    process.exit(0)
}
