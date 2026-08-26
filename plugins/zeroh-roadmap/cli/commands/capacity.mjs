/**
 * roadmap capacity [--json] — live box-resource admission: can another executor spawn RIGHT
 * NOW, and how many at most? The scriptable gate any parallel fan-out must consult (phase 11).
 *
 * Human: verdict line + per-signal table + reasons. Exit 0 when canSpawn, exit 3 when not —
 * a gate verdict, not an error (the bin header's exit-code contract names it).
 * --json: the CapacityVerdictShape object verbatim on stdout, ALWAYS exit 0 — the JSON carries
 * the verdict; nothing else is written to stdout in this mode.
 *
 * Determinism seam: env ZEROH_ROADMAP_CAPACITY_PROBES = JSON
 * {memAvailableMb, load1, cores, capbuildUnits, liveArms} replaces ALL live probes with the
 * fixed values (wired tests + dry-run simulation). Malformed JSON in the seam is a NAMED
 * refusal, exit 2 — never a silent fallback to live probes.
 *
 * Returns its exit code to the dispatcher — never hard-exits (testability seam).
 */
import { loadConfig } from '../lib/config.mjs'
import { probeCapacity, defaultProbes, seamProbes, SeamError } from '../lib/capacity.mjs'

export default async function run(argv) {
  const json = argv.includes('--json')
  const unknown = argv.filter((a) => a !== '--json')
  if (unknown.length > 0) {
    process.stderr.write(`roadmap capacity: unknown argument(s) ${unknown.join(' ')}. Usage: roadmap capacity [--json]\n`)
    return 1
  }

  let probes
  try {
    probes = seamProbes() ?? defaultProbes
  } catch (e) {
    if (e instanceof SeamError) {
      process.stderr.write(`roadmap capacity: ${e.message}\n`)
      return 2
    }
    throw e
  }

  const cfg = loadConfig(process.cwd())
  const verdict = probeCapacity(cfg.capacity, probes)

  if (json) {
    process.stdout.write(JSON.stringify(verdict, null, 2) + '\n')
    return 0
  }

  const lines = []
  lines.push(
    verdict.canSpawn
      ? `capacity: OK — up to ${verdict.maxParallel} more executor(s) can spawn right now`
      : 'capacity: AT CAPACITY — do not spawn another executor right now',
  )
  for (const s of verdict.signals) {
    lines.push(`  ${s.ok ? 'ok ' : 'RED'}  ${s.name}  ${s.value} / limit ${s.limit}`)
  }
  for (const r of verdict.reasons) lines.push(`  reason: ${r}`)
  for (const d of verdict.degraded) lines.push(`  degraded: ${d}`)
  process.stdout.write(lines.join('\n') + '\n')
  return verdict.canSpawn ? 0 : 3
}
