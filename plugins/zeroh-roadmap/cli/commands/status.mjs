import { resolve, join } from 'node:path'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { defaultRoadmapRoot } from '../lib/roadmap-root.mjs'
import { gitCommonDir } from '../lib/gitroot.mjs'
import { scanProgress } from '../lib/phasescan.mjs'
export default async function run(argv) {
  if (argv.some(arg => arg.startsWith('--') && arg !== '--json')) throw new Error('Unknown status option')
  const args = argv.filter(arg => arg !== '--json')
  if (args.length > 1) throw new Error('status accepts one roadmap root')
  const root = args[0] ? resolve(args[0]) : defaultRoadmapRoot(process.cwd())
  const state = { root, ...scanProgress(root), ownership: [] }
  try {
    const dir = join(gitCommonDir(root), 'zeroh-roadmap-work-claims')
    if (existsSync(dir)) for (const name of readdirSync(dir).filter(name => name.endsWith('.json'))) state.ownership.push(JSON.parse(readFileSync(join(dir, name), 'utf8')))
  } catch (error) { if (!error.message.includes('not a git repository')) state.errors.push(`Ownership unavailable: ${error.message}`) }
  if (argv.includes('--json')) console.log(JSON.stringify(state, null, 2))
  else {
    console.log(`Roadmap: ${root}`)
    for (const phase of state.phases) console.log(`${phase.phase}  ${phase.status}  ${phase.name ?? phase.title}`)
    for (const arc of state.arcs) console.log(`${arc.id}  ${arc.status}  deferred: ${(arc.planning?.deferredCriteria ?? []).join(', ') || 'none'}`)
    for (const claim of state.ownership) console.log(`Owner: ${claim.id} → ${claim.owner}`)
    for (const error of state.errors) console.error(error)
  }
  return state.errors.length ? 1 : 0
}
