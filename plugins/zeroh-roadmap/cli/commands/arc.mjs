/**
 * roadmap arc <sub> — the arc-level transitions (arc ROADCODE §2).
 *   next <arcId> [--json]                    the ONE position derivation (seam 2)
 *   record-validate <arcId> --verdict <v>    stamp the validate verdict artifact (decision 5)
 *   land <arcId> [--push|--no-push|--hold]   the ONE landing engine (seam 4, 1657.5)
 *
 * Exit-code contract (universal): 0 clean / any derived action incl. complete · 1
 * usage/config/toolchain · 2 blocked or a landing blocker (the caller cannot narrate
 * around it) · 3 held-for-user (land). STRICT context — a tsx-absent typed read is a
 * loud exit 1, never a guess.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gitToplevel } from '../lib/gitroot.mjs'
import { loadConfig, ConfigError } from '../lib/config.mjs'
import { deriveArcPosition, DeriveError } from '../lib/derive.mjs'

const firstPositional = (rest) => rest.find((a) => !a.startsWith('--'))
const flagVal = (rest, name) => {
  const i = rest.indexOf(name)
  return i >= 0 ? rest[i + 1] : undefined
}
const printLines = (lines) => lines.forEach((l) => process.stderr.write(l + '\n'))

async function arcNext(rest) {
  const json = rest.includes('--json')
  const arcId = firstPositional(rest)
  if (!arcId) {
    process.stderr.write('usage: roadmap arc next <arcId> [--json]\n')
    return 1
  }
  let toplevel, cfg
  try {
    toplevel = gitToplevel(process.cwd())
    cfg = loadConfig(process.cwd())
  } catch (e) {
    printLines(e instanceof ConfigError ? e.messageLines : [`roadmap arc next: ${e.message}`])
    return 1
  }
  let pos
  try {
    pos = deriveArcPosition({ repoRoot: toplevel, arcId, config: cfg })
  } catch (e) {
    if (e instanceof DeriveError) {
      printLines(e.messageLines)
      return e.exitCode
    }
    throw e
  }
  process.stdout.write(JSON.stringify(pos, null, json ? 0 : 2) + '\n')

  // Stale-base EARLY warning + detached-land status (1792.4/1792.5) — advisory, on stderr so the
  // machine-read JSON on stdout stays clean. Both answer "what does the driver need to know
  // BEFORE the next plane" that today only surfaces at land.
  try {
    const { gatherLandingState, staleBaseWarning, readLandJournal, classifyLandJournal, pidAlive, landJournalPath, DEFAULT_STALE_BASE_CEILING } =
      await import('../lib/landing.mjs')
    const journalHome = process.env.ZEROH_LAND_JOURNAL_HOME ?? toplevel
    const verdict = classifyLandJournal(readLandJournal(journalHome, arcId), { isAlive: pidAlive })
    if (verdict.state === 'live')
      process.stderr.write(`arc next: a detached land for ${arcId} is RUNNING (pid ${verdict.pid}, step: ${verdict.step ?? 'starting'}) — journal ${landJournalPath(journalHome, arcId)}\n`)
    else if (verdict.state === 'finished')
      process.stderr.write(`arc next: a detached land for ${arcId} finished with exit ${verdict.exitCode} — read ${landJournalPath(journalHome, arcId)}\n`)
    else if (verdict.state === 'stale')
      process.stderr.write(`arc next: a previous detached land for ${arcId} died without an exit code (pid ${verdict.pid}) — re-run \`roadmap arc land ${arcId}\`\n`)

    const state = gatherLandingState({ repoRoot: toplevel, arcId, config: cfg })
    const ceiling = cfg.mergePolicy?.staleBaseCeiling ?? DEFAULT_STALE_BASE_CEILING
    const warn = staleBaseWarning(state.baseBehindCount, ceiling, state.baseRef ?? 'develop')
    if (warn) process.stderr.write(`arc next: ${warn.message}\n`)
  } catch {
    /* advisory only — an unreadable landing state never fails arc next */
  }
  return pos.action === 'blocked' ? 2 : 0
}

async function recordValidate(rest) {
  const arcId = firstPositional(rest)
  const verdict = flagVal(rest, '--verdict')
  const note = flagVal(rest, '--note')
  if (!arcId || !['PASS', 'GAPS', 'no-op'].includes(verdict)) {
    process.stderr.write('usage: roadmap arc record-validate <arcId> --verdict <PASS|GAPS|no-op> [--note <s>]\n')
    return 1
  }
  let toplevel
  try {
    toplevel = gitToplevel(process.cwd())
  } catch (e) {
    process.stderr.write(`roadmap arc record-validate: ${e.message}\n`)
    return 1
  }
  const dir = join(toplevel, 'roadmap', '.gate', `arc-${arcId}`)
  mkdirSync(dir, { recursive: true })
  const artifact = { arcId, verdict, at: new Date().toISOString(), ...(note ? { note } : {}) }
  writeFileSync(join(dir, 'validate.json'), JSON.stringify(artifact, null, 2) + '\n')
  process.stdout.write(JSON.stringify(artifact, null, 2) + '\n')
  return 0
}

export default async function run(argv) {
  const sub = argv[0]
  if (!sub || sub === '--help' || sub === '-h') {
    process.stdout.write('roadmap arc next <arcId> [--json]\n')
    process.stdout.write('roadmap arc record-validate <arcId> --verdict <PASS|GAPS|no-op> [--note <s>]\n')
    process.stdout.write('roadmap arc land <arcId> [--push|--no-push|--hold] [--json]\n')
    return sub ? 0 : 1
  }
  const rest = argv.slice(1)
  if (sub === 'next') return arcNext(rest)
  if (sub === 'record-validate') return recordValidate(rest)
  if (sub === 'land') {
    const { landCommand } = await import('../lib/landing.mjs')
    return landCommand(rest)
  }
  process.stderr.write(`roadmap arc: unknown subcommand '${sub}' (next | record-validate | land)\n`)
  return 1
}
