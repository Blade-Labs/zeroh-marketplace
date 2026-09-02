/**
 * roadmap arc <sub> — the arc-level transitions (arc ROADCODE §2).
 *   next <arcId> [--json] [--ignore-capacity]  the ONE position derivation (seam 2) + admission gate
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
import { roadmapRoot } from '../lib/roadmap-root.mjs'

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
    process.stderr.write('usage: roadmap arc next <arcId> [--json] [--ignore-capacity]\n')
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
  // Capacity admission gate (phase 11): a run-phase on a starved box is refused as the blocked
  // action do-arc already handles. Scoped to run-phase ONLY — a resume continues committed work
  // and refusing it would strand a wedged arc. Seam errors are the OPERATOR's knob → loud exit 1;
  // a live-probe computation failure fails OPEN (advisory math must never wedge the pipeline).
  if (pos.action === 'run-phase') {
    // --ignore-capacity still PROBES: the override's audit note has to name what it overrode.
    const override = rest.includes('--ignore-capacity')
    let SeamErrorClass
    try {
      const { probeCapacity, defaultProbes, seamProbes, SeamError, SEAM_ENV } = await import('../lib/capacity.mjs')
      SeamErrorClass = SeamError
      let verdict
      try {
        verdict = probeCapacity(cfg.capacity, seamProbes() ?? defaultProbes)
      } catch (e) {
        if (!override && (e instanceof SeamError || process.env[SEAM_ENV])) {
          process.stderr.write(`arc next: ${e.message}\n`)
          return 1
        }
        throw e
      }
      if (!verdict.canSpawn) {
        if (override) {
          process.stderr.write(`arc next: --ignore-capacity override — spawning despite: ${verdict.reasons.join('; ')}\n`)
        } else {
          pos = {
            ...pos,
            action: 'blocked',
            reason: `box at capacity — ${verdict.reasons.join('; ')} — re-run when load drops, or override with --ignore-capacity`,
            // the refused member goes back on the board — refused, not consumed
            remaining: [pos.phase, ...(pos.remaining ?? [])],
          }
        }
      }
    } catch (e) {
      // The override asked to skip the gate, so a failing check changes nothing — but a broken
      // seam is still the OPERATOR's knob and gets NAMED (never silently advisory-blind).
      if (!override)
        process.stderr.write(`arc next: capacity check unreadable (${e?.message ?? e}) — fail-open, run-phase stands\n`)
      else if (SeamErrorClass && e instanceof SeamErrorClass)
        process.stderr.write(`arc next: ${e.message} (override active — run-phase stands)\n`)
    }
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
  const dir = join(roadmapRoot(toplevel), '.gate', `arc-${arcId}`)
  mkdirSync(dir, { recursive: true })
  const artifact = { arcId, verdict, at: new Date().toISOString(), ...(note ? { note } : {}) }
  writeFileSync(join(dir, 'validate.json'), JSON.stringify(artifact, null, 2) + '\n')
  process.stdout.write(JSON.stringify(artifact, null, 2) + '\n')
  return 0
}

export default async function run(argv) {
  const sub = argv[0]
  if (!sub || sub === '--help' || sub === '-h') {
    process.stdout.write('roadmap arc next <arcId> [--json] [--ignore-capacity]\n')
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
