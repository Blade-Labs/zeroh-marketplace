/**
 * roadmap role resolve <role> [--driver <id>] [--json] — the roles layer's reachable seam
 * (phase 13.2): resolve a role to the model + reach mode the tier chain yields under the
 * consumer's modelPolicy, with substitution provenance when the head tier was unavailable.
 *
 * Exit contract: 0 resolved · 1 unknown role/driver or usage (the LIBRARY's named error is
 * carried verbatim, never a stack trace) · 2 UNJUDGED (every tier unavailable — a refused
 * check; the error names MULTI-DRIVER.md §1). Driver defaults to 'claude' (the session lane),
 * documented rather than sniffed from the ambient host.
 *
 * Returns its exit code to the dispatcher — never hard-exits (testability seam).
 */
import { loadConfig } from '../lib/config.mjs'
import { resolveRole, RoleUnjudgedError } from '../lib/roles.mjs'

export default async function run(argv) {
  const sub = argv[0]
  if (sub !== 'resolve') {
    process.stderr.write("roadmap role: usage: roadmap role resolve <role> [--driver <id>] [--json]\n")
    return 1
  }
  const rest = argv.slice(1)
  const json = rest.includes('--json')
  const di = rest.indexOf('--driver')
  const driverValue = di >= 0 ? rest[di + 1] : undefined
  // `--driver` last, or followed by another flag, means the VALUE was omitted — usage, never an
  // 'unknown driver undefined' that tells the operator to register a driver by that name.
  if (di >= 0 && (driverValue === undefined || driverValue.startsWith('--'))) {
    process.stderr.write("roadmap role: --driver needs a value. Usage: roadmap role resolve <role> [--driver <id>] [--json]\n")
    return 1
  }
  const driverId = di >= 0 ? driverValue : 'claude'
  const roleId = rest.find((a, i) => !a.startsWith('--') && (di < 0 || i !== di + 1))
  if (!roleId) {
    process.stderr.write("roadmap role: usage: roadmap role resolve <role> [--driver <id>] [--json]\n")
    return 1
  }

  let judgeModel
  try {
    judgeModel = loadConfig(process.cwd()).modelPolicy?.judgeModel
  } catch {
    judgeModel = undefined // an unconfigured estate resolves on chain defaults; the verb still answers
  }

  let resolved
  try {
    resolved = resolveRole(roleId, driverId, { judgeModel })
  } catch (e) {
    if (e instanceof RoleUnjudgedError) {
      process.stderr.write(`roadmap role: ${e.message}\n`)
      return 2
    }
    // unknown role / unknown driver — the library's named message IS the diagnosis
    process.stderr.write(`roadmap role: ${e.message}\n`)
    return 1
  }

  if (json) {
    process.stdout.write(JSON.stringify(resolved, null, 2) + '\n')
    return 0
  }
  const lines = [`role ${resolved.role} → ${resolved.model} (${resolved.mode})`]
  if (resolved.substituted)
    lines.push(`  substituted: ${resolved.substituted.from} → ${resolved.substituted.to}`, `  reason: ${resolved.substituted.reason}`)
  process.stdout.write(lines.join('\n') + '\n')
  return 0
}
