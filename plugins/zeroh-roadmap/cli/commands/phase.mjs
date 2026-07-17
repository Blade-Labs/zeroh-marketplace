/**
 * roadmap phase validate <N|file> [--json] — the CLI face of the roadmap-file validator
 * (same engine cli/lib/validate.mjs the write-hook calls). Unlike the hook, this is a
 * STRICT context (design §2): tsx absence is exit 1 here, not fail-open.
 * roadmap phase start <N> — lands in 1657 (thin status→in-progress convenience).
 *
 * Exit: 0 clean · 1 usage/config/toolchain · 2 validation failed.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { gitToplevel } from '../lib/gitroot.mjs'
import { validateRoadmapFile, renderZodIssues } from '../lib/validate.mjs'
import { TSX_ABSENT_HINT } from '../lib/tsx-bridge.mjs'

function parseArgs(argv) {
  const opts = {}
  const positional = []
  for (const a of argv) {
    if (a === '--json') opts.json = true
    else if (!a.startsWith('--')) positional.push(a)
  }
  return { opts, positional }
}

function resolveTarget(arg) {
  if (/^\d+$/.test(arg)) {
    const toplevel = gitToplevel(process.cwd())
    return join(toplevel, 'roadmap', 'phases', `phase-${arg}.phase.ts`)
  }
  return arg
}

export default async function run(argv) {
  const sub = argv[0]
  if (sub === 'start') {
    process.stderr.write('roadmap phase start: not yet implemented (lands in ROADCODE 1657)\n')
    return 1
  }
  if (sub !== 'validate') {
    process.stderr.write('roadmap phase: usage: roadmap phase validate <N|file> [--json]\n')
    return 1
  }
  const { opts, positional } = parseArgs(argv.slice(1))
  const arg = positional[0]
  if (!arg) {
    process.stderr.write('roadmap phase validate: a phase number or file path is required\n')
    return 1
  }

  let target
  try {
    target = resolveTarget(arg)
  } catch (e) {
    process.stderr.write(`roadmap phase validate: ${e.message}\n`)
    return 1
  }
  if (!existsSync(target)) {
    process.stderr.write(`roadmap phase validate: no such file: ${target}\n`)
    return 1
  }

  const result = validateRoadmapFile(target, { strict: true })

  if (opts.json) {
    process.stdout.write(JSON.stringify(result) + '\n')
  } else {
    if (result.kind === 'toolchain-missing') process.stderr.write(TSX_ABSENT_HINT + '\n')
    else if (result.kind === 'load-error') {
      process.stderr.write(`[zeroh-roadmap] roadmap file failed to load:\n${result.loadError}\n`)
    } else if (result.kind === 'zod') {
      for (const l of renderZodIssues(result.zod.file, result.zod.issues, { debug: process.env.ZEROH_ROADMAP_DEBUG === '1' }))
        process.stderr.write(l + '\n')
    } else if (result.kind === 'errors') {
      for (const e of result.errors) {
        if (e.rawLines) for (const l of e.rawLines) process.stderr.write(l + '\n')
        else process.stderr.write(`[zeroh-roadmap] ${e.rule}: ${e.msg} — fix: ${e.fix}\n`)
      }
    } else {
      process.stdout.write(`phase validate: ${target} — OK\n`)
    }
  }

  if (result.kind === 'ok' || result.kind === 'skip') return 0
  if (result.kind === 'toolchain-missing') return 1
  return 2 // zod / load-error / errors
}
