import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, relative, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url))
function files(dir) { return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.name==='node_modules'?[]:e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]) }
const expected=[
  "bin/roadmap.mjs",
  "bin/validate-roadmap-file.mjs",
  "cli/commands/claim.mjs",
  "cli/commands/init.mjs",
  "cli/commands/phase.mjs",
  "cli/commands/status.mjs",
  "cli/lib/bridge-error.mjs",
  "cli/lib/exec.mjs",
  "cli/lib/gitroot.mjs",
  "cli/lib/phasescan.mjs",
  "cli/lib/roadmap-root.mjs",
  "cli/lib/tsx-bridge.mjs",
  "cli/lib/validate.mjs",
  "hooks/fail-soft.mjs",
  "scripts/emit-manifests.mjs",
  "scripts/run-tests.mjs",
  "scripts/scaffold-roadmap.sh",
  "templates/backlog.ts",
  "templates/emit.ts",
  "templates/example.arc.ts",
  "templates/registry.ts",
  "templates/schema.ts"
]
const excluded=path=>path.split('/').some(part=>['test','tests','fixtures','dry-runs','testdata'].includes(part)) || /\.test\.[^.]+$/.test(path)
test('the shipped native core contains exactly the reviewed 22 production sources',()=>{
 const production=files(root).map(path=>relative(root,path)).filter(path=>/\.(?:mjs|js|ts|mts|sh)$/.test(path)&&!excluded(path)).sort()
 assert.deepEqual(production,expected)
 for(const name of production.filter(name=>name.endsWith('.mjs'))) {
  const path=join(root,name),text=readFileSync(path,'utf8')
  for(const match of text.matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g)) assert.ok(existsSync(resolve(dirname(path),match[1])),name+' imports missing '+match[1])
 }
})
test('Greenfield ships one optional helper and no coupled delivery templates',()=>{
 const green=resolve(root,'../zeroh-greenfield')
 assert.deepEqual(files(green).map(path=>relative(green,path)).filter(path=>/\.(?:mjs|js|ts|mts|sh)$/.test(path)&&!excluded(path)).sort(),['scripts/prepared-program.mjs'])
 assert.equal(existsSync(join(green,'templates/github/workflows/ci.yml')),false)
})
test('native hook manifest keeps only the validation adapter, Codex makes no hook promise',()=>{
 const hooks=JSON.parse(readFileSync(join(root,'hooks/hooks.json'),'utf8')).hooks
 assert.deepEqual(Object.keys(hooks),['PostToolUse'])
 assert.equal(hooks.PostToolUse.length,1)
 assert.match(hooks.PostToolUse[0].hooks[0].command,/validate-roadmap-file/)
 assert.deepEqual(JSON.parse(readFileSync(join(root,'.codex-plugin/plugin.json'),'utf8')).hooks,{})
})
