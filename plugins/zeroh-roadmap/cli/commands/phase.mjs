import { resolve, join } from 'node:path'
import { readdirSync, existsSync } from 'node:fs'
import { defaultRoadmapRoot } from '../lib/roadmap-root.mjs'
import { validateRoadmapFile } from '../lib/validate.mjs'
export default async function run(argv) {
  if (argv[0] !== 'validate' || !argv[1] || argv.slice(2).some(arg => arg !== '--json' && arg !== '--strict')) throw new Error('Use phase validate <phase-or-arc-path|--all> [--json]; other phase operations now belong to native skills')
  if (argv[1] === '--all') {
    const root = defaultRoadmapRoot(process.cwd())
    if (!existsSync(root)) throw new Error('Roadmap root is missing: ' + root)
    const paths = ['phases', 'arcs'].flatMap(dir => {
      const path = join(root, dir)
      return existsSync(path) ? readdirSync(path).filter(name => name.endsWith(dir === 'phases' ? '.phase.ts' : '.arc.ts')).map(name => join(path, name)) : []
    })
    if (existsSync(join(root, 'backlog.ts'))) paths.push(join(root, 'backlog.ts'))
    if (!paths.length) throw new Error('No roadmap records found in ' + root)
    const context = {} // Batch-local cache; a later command always reloads edited records.
    const results = paths.map(path => ({ path, ...validateRoadmapFile(path, { strict: true, context }) }))
    if (argv.includes('--json')) console.log(JSON.stringify(results, null, 2))
    else for (const result of results) {
      if (result.ok) console.log('Valid: ' + result.path)
      else console.error(result.path + ': ' + (result.errors?.map(error => error.msg).join('\n') || result.loadError || result.kind))
    }
    return results.every(result => result.ok) ? 0 : 1
  }
  let path = argv[1]
  if (/^\d+$/.test(path)) {
    const dir = join(defaultRoadmapRoot(process.cwd()), 'phases')
    const matches = readdirSync(dir).filter(name => new RegExp(`^phase-${path}(?:[.-])`).test(name) && name.endsWith('.phase.ts'))
    if (matches.length !== 1) throw new Error(`Expected one file for phase ${path}; found ${matches.length}`)
    path = join(dir, matches[0])
  }
  const result = validateRoadmapFile(resolve(path), { strict: true })
  if (argv.includes('--json')) console.log(JSON.stringify(result, null, 2))
  else if (result.ok) console.log(`Valid: ${path}`)
  else console.error(result.errors?.map(error => error.msg).join('\n') || result.loadError || result.kind)
  return result.ok ? 0 : 1
}
