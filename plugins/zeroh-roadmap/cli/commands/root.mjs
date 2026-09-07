import { ROOT_CANDIDATES } from '../lib/roadmap-root.mjs'
import { RootMigrationError, planRootMigration, applyRootMigration } from '../lib/root-migration.mjs'

/** The CLI projects paths/outcomes; canonical before/after bytes stay in the reducer's plan. */
function projection(result, plan) {
  return {
    status: result.status,
    planDigest: plan.planDigest,
    sourceRoot: plan.sourceRoot,
    destinationRoot: plan.destinationRoot,
    trackedFiles: plan.trackedManifest.length,
    renames: plan.renames.map(({ from, to }) => ({ from, to })),
    rewrites: plan.rewrites.map(({ pathBefore, pathAfter }) => ({ pathBefore, pathAfter })),
    ...(result.receiptPath ? { receiptPath: result.receiptPath } : {}),
    ...(result.intentPath ? { intentPath: result.intentPath } : {}),
    ...(result.reason ? { reason: result.reason } : {}),
  }
}
export default function run(argv) {
  let to = ROOT_CANDIDATES[1]
  let apply = false
  const asJson = argv.includes('--json')
  const seen = new Set()
  const usage = () => { process.stderr.write('usage: roadmap root migrate [--to ' + ROOT_CANDIDATES[1] + '] [--apply] [--json]\n'); return 1 }
  if (argv[0] !== 'migrate') return usage()
  for (let i = 1; i < argv.length; i++) {
    const flag = argv[i]
    if (seen.has(flag)) return usage()
    seen.add(flag)
    if (flag === '--to') {
      to = argv[++i]
      if (to !== ROOT_CANDIDATES[1]) return usage()
    } else if (flag === '--apply') apply = true
    else if (flag !== '--json') return usage()
  }
  try {
    const planned = planRootMigration(process.cwd(), { to })
    const result = apply ? applyRootMigration(planned.plan, { cwd: process.cwd() }) : planned
    const output = projection(result, planned.plan)
    if (asJson) process.stdout.write(JSON.stringify(output) + '\n')
    else {
      process.stdout.write(`${apply ? 'Migration' : 'Dry run'} ${output.status}: ${output.sourceRoot} → ${output.destinationRoot}; ${output.trackedFiles} tracked files, ${output.rewrites.length} explicit rewrites.\n`)
      if (output.receiptPath) process.stdout.write('Receipt: ' + output.receiptPath + '\n')
      if (output.reason) process.stdout.write(output.reason + '\n')
    }
    return result.status === 'recovery-required' ? 2 : 0
  } catch (error) {
    const output = { status: 'refused', kind: error instanceof RootMigrationError ? error.kind : 'migration-error', reason: error.message }
    if (asJson) process.stdout.write(JSON.stringify(output) + '\n')
    else process.stderr.write('roadmap root: ' + output.kind + ': ' + output.reason + '\n')
    return 2
  }
}
