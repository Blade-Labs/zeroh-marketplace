#!/usr/bin/env bash
# Only copy typed templates. No dependency install, config mutation or generated app scripts.
set -euo pipefail
PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_DIR="${1:?consumer directory required}"
shift
ROOT="roadmap"
if [ "$#" -gt 0 ]; then
  [ "$#" -eq 2 ] && [ "$1" = --root ] || { echo 'Expected --root path' >&2; exit 2; }
  ROOT="$2"
fi
node --input-type=module - "$PLUGIN_DIR" "$PROJECT_DIR" "$ROOT" <<'JS'
import { copyFileSync, constants, existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs'
import { resolve, relative, sep, join } from 'node:path'
const [plugin, projectArg, rootArg] = process.argv.slice(2)
const project = realpathSync(projectArg), root = resolve(project, rootArg), rel = relative(project, root)
if (!rel || rel === '..' || rel.startsWith('..' + sep)) throw new Error('Root must be inside the consumer')
for (const candidate of ['roadmap', 'docs/roadmap']) {
 const other = join(project, candidate)
 if (other !== root && (existsSync(join(other, 'phases')) || existsSync(join(other, 'roadmap.config.json')))) throw new Error('Another roadmap root exists: ' + other)
}
// Refuse symlinked destination components even when their target is outside the project.
function safe(path) {
 let part = project
 for (const segment of relative(project, path).split(sep)) {
  part = join(part, segment)
  if (existsSync(part) && lstatSync(part).isSymbolicLink()) throw new Error('Symlink destination refused: ' + part)
 }
}
const copies = [['schema.ts','lib/schema.ts'],['registry.ts','lib/registry.ts'],['emit.ts','lib/emit.ts'],['backlog.ts','backlog.ts'],['example.arc.ts','examples/example.arc.ts']]
for (const [, path] of copies) safe(join(root,path))
for (const dir of ['lib','phases','arcs','examples']) { safe(join(root,dir)); mkdirSync(join(root,dir),{recursive:true}) }
for (const [source, dest] of copies) {
 const target = join(root,dest)
 try { copyFileSync(join(plugin,'templates',source),target,constants.COPYFILE_EXCL); console.log('Created ' + target) }
 catch (error) { if (error.code !== 'EEXIST') throw error; console.log('Preserved ' + target) }
}
if (!['roadmap', 'docs/roadmap'].includes(rel.split(sep).join('/'))) console.log('Custom root: set ROADMAP_ROOT=' + JSON.stringify(root) + ' for subsequent roadmap and emit commands; default discovery only finds roadmap/ or docs/roadmap/.')
console.log('Add this roadmap to the consumer TypeScript project and wire roadmap phase validate --all into its existing check/CI command alongside typechecking. Use the actual installed roadmap executable; no project scripts are overwritten.')
console.log('Install tsx and zod with the consumer package manager if absent. Run tsx ' + join(root,'lib/emit.ts') + ' for progress. Existing project configuration is unchanged.')
JS
