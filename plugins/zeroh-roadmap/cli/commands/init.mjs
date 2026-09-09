import { resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { defaultRoadmapRoot } from '../lib/roadmap-root.mjs'
import { gitToplevel } from '../lib/gitroot.mjs'
export default async function run(argv) {
  if (argv.length && (argv.length !== 2 || argv[0] !== '--root')) throw new Error('init accepts only --root <path>. --config was retired; retain existing project guidance and policies directly.')
  let project
  try { project = gitToplevel(process.cwd()) } catch { project = process.cwd() }
  const root = argv.length ? resolve(project, argv[1]) : defaultRoadmapRoot(project)
  const rel = relative(project, root)
  if (!rel || rel.startsWith('..' + sep) || rel === '..') throw new Error('Roadmap root must be a directory inside the consumer')
  const result = spawnSync('bash', [fileURLToPath(new URL('../../scripts/scaffold-roadmap.sh', import.meta.url)), project, '--root', rel], { stdio: 'inherit' })
  if (result.error) throw result.error
  return result.status ?? 1
}
