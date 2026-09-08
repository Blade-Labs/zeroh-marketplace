import { resolve, join } from 'node:path'
import { readdirSync } from 'node:fs'
import { defaultRoadmapRoot } from '../lib/roadmap-root.mjs'
import { validateRoadmapFile } from '../lib/validate.mjs'
export default async function run(argv) {
  if (argv[0] !== 'validate' || !argv[1] || argv.slice(2).some(arg => arg !== '--json' && arg !== '--strict')) throw new Error('Use phase validate <phase-or-arc-path> [--json]; other phase operations now belong to native skills')
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
