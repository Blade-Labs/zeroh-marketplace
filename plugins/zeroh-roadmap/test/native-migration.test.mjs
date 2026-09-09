import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync, execFileSync } from 'node:child_process'
import { bridgeSource } from '../cli/lib/tsx-bridge.mjs'
const plugin=fileURLToPath(new URL('../',import.meta.url)), cli=path.join(plugin,'bin/roadmap.mjs')
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'roadmap-migrate-'))
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  for(const folder of ['roadmap/arcs','roadmap/phases','lib/roadmap']) fs.mkdirSync(path.join(dir,folder),{recursive:true})
  fs.symlinkSync(path.join(plugin,'node_modules'),path.join(dir,'node_modules'),'dir')
  fs.writeFileSync(path.join(dir,'package.json'),'{"type":"module"}')
  fs.writeFileSync(path.join(dir,'lib/roadmap/schema.ts'),`import {z} from 'zod'; export const ArcShape=z.object({id:z.string(),name:z.string(),planes:z.array(z.object({phases:z.array(z.number())}))}).passthrough(); export const PhaseShape=z.object({phase:z.number(),name:z.string(),status:z.string()}).passthrough(); export const BacklogShape=z.array(z.object({phase:z.number(),name:z.string()})); export const definePhase=PhaseShape.parse; export const defineArc=ArcShape.parse;`)
  const arc={id:'A',name:'Original outcome',planes:[{phases:[1,2]}],acceptanceCriteria:[{id:'a',job:'Useful behavior',signal:'Observe it live',bar:'Every item'}],honestyRails:['Never hide errors']}
  const phase={phase:1,name:'Implement',status:'backlog',arcId:'A',dependsOn:[2],tasks:[{id:'1.1',title:'Do it',done:false,steps:['Check the caller'],acceptanceCriteria:['Preserve all items']}]}
  for(const [file,fn,record] of [['arcs/A.arc.ts','defineArc',arc],['phases/phase-1.phase.ts','definePhase',phase],['phases/phase-2.phase.ts','definePhase',{phase:2,name:'Earlier work',status:'done',arcId:'A'}]]) fs.writeFileSync(path.join(dir,'roadmap',file),`/** Owner ruling: preserve every item. */\nimport { ${fn} } from '../../lib/roadmap/schema'\nexport default ${fn}(${JSON.stringify(record)})\n`)
  fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({type:'module',scripts:{old:'roadmap gate run'}}))
  execFileSync('git',['init','-q'],{cwd:dir})
  execFileSync('git',['add','roadmap','lib','package.json'],{cwd:dir})
  execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','Original plan'],{cwd:dir})
  fs.writeFileSync(path.join(dir,'decisions.json'),JSON.stringify({intent:'Original outcome',scope:['Useful behavior, every item'],status:'backlog'}))
  return {dir,arc,phase,run:(...args)=>spawnSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8',timeout:30000}),read:file=>fs.readFileSync(path.join(dir,file),'utf8')}
}
test('preview/apply preserve legacy data and completed history; native validation and repeated apply work',t=>{
  const f=fixture(t), argv=['migrate','--arc','roadmap/arcs/A.arc.ts'], before=f.read('roadmap/arcs/A.arc.ts'), completed=f.read('roadmap/phases/phase-2.phase.ts')
  const missing=f.run(...argv); assert.equal(missing.status,2,missing.stderr);assert.equal(JSON.parse(missing.stdout).gaps.length,3)
  const preview=f.run(...argv,'--decisions','decisions.json');assert.equal(preview.status,0,preview.stderr);assert.equal(f.read('roadmap/arcs/A.arc.ts'),before);assert.equal(fs.existsSync(path.join(f.dir,'roadmap/lib')),false)
  assert.equal(JSON.parse(preview.stdout).retiredCallers[0].command,'gate')
  const applied=f.run(...argv,'--decisions','decisions.json','--apply');assert.equal(applied.status,0,applied.stderr)
  const migrated=bridgeSource(f.read('roadmap/arcs/A.arc.ts'),'A.arc.ts').parsed
  assert.deepEqual(JSON.parse(JSON.stringify(migrated.extensions.roadmapMigration.original)),f.arc)
  assert.equal(execFileSync('git',['show',migrated.extensions.roadmapMigration.sourceRef],{cwd:f.dir,encoding:'utf8'}),before)
  assert.match(migrated.acceptanceCriteria[0].description,/job: Useful behavior\nsignal: Observe it live\nbar: Every item/)
  assert.equal(f.read('roadmap/phases/phase-2.phase.ts'),completed)
  assert.match(f.read('roadmap/phases/phase-1.phase.ts'),/Owner ruling: preserve every item/)
  const validated=f.run('phase','validate','--all','--json');assert.equal(validated.status,0,validated.stdout+validated.stderr)
  const after=f.read('roadmap/arcs/A.arc.ts'), again=f.run(...argv,'--apply');assert.equal(again.status,0,again.stderr);assert.equal(JSON.parse(again.stdout).alreadyMigrated,true);assert.equal(f.read('roadmap/arcs/A.arc.ts'),after)
  const active=after.replace('"status": "backlog"','"status": "in-progress"');fs.writeFileSync(path.join(f.dir,'roadmap/arcs/A.arc.ts'),active)
  const blocked=f.run('phase','validate','roadmap/arcs/A.arc.ts','--json');assert.equal(blocked.status,1);assert.match(blocked.stdout,/intentRef/)
})
test('computed sources, ambiguous tasks and schema collisions fail before any writes',t=>{
 const f=fixture(t), args=['migrate','--arc','roadmap/arcs/A.arc.ts','--decisions','decisions.json','--apply'], before=f.read('roadmap/arcs/A.arc.ts')
 fs.mkdirSync(path.join(f.dir,'roadmap/lib'));fs.writeFileSync(path.join(f.dir,'roadmap/lib/schema.ts'),'// Owned schema')
 const result=f.run(...args);assert.equal(result.status,2,result.stderr);assert.equal(f.read('roadmap/arcs/A.arc.ts'),before);assert.match(result.stdout,/Root-local/)
 fs.rmSync(path.join(f.dir,'roadmap/lib'),{recursive:true})
 fs.writeFileSync(path.join(f.dir,'roadmap/arcs/A.arc.ts'),before.replace('"Original outcome"','process.env.INTENT'))
 const computed=f.run(...args);assert.equal(computed.status,1);assert.equal(fs.existsSync(path.join(f.dir,'roadmap/lib')),false)
 fs.writeFileSync(path.join(f.dir,'roadmap/arcs/A.arc.ts'),before)
 const phaseFile=path.join(f.dir,'roadmap/phases/phase-1.phase.ts');fs.writeFileSync(phaseFile,f.read('roadmap/phases/phase-1.phase.ts').replace(',"done":false',''))
 const ambiguous=f.run(...args);assert.equal(ambiguous.status,2);assert.match(ambiguous.stdout,/ambiguous/);assert.equal(fs.existsSync(path.join(f.dir,'roadmap/lib')),false)
})

test('legacy preamble statements are preserved as data but never copied into executable output',t=>{
 const f=fixture(t), file=path.join(f.dir,'roadmap/arcs/A.arc.ts')
 fs.writeFileSync(file,"throw new Error('Legacy side effect must not execute');\n"+f.read('roadmap/arcs/A.arc.ts'))
 execFileSync('git',['add','roadmap/arcs/A.arc.ts'],{cwd:f.dir});execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','Committed literal with unused preamble'],{cwd:f.dir})
 const result=f.run('migrate','--arc','roadmap/arcs/A.arc.ts','--decisions','decisions.json','--apply');assert.equal(result.status,0,result.stderr)
 assert.ok(!f.read('roadmap/arcs/A.arc.ts').startsWith('throw'))
 const validated=f.run('phase','validate','roadmap/arcs/A.arc.ts','--json');assert.equal(validated.status,0,validated.stdout+validated.stderr)
})
