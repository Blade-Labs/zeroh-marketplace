import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import * as native from './greenfield-native-evidence.mjs'
const helper=()=>import('./greenfield-behavior-evidence.mjs')
const arms=()=>['empty','brownfield'].flatMap(kind=>native.receipt(kind).arms)
const stage=(arm,name)=>native.readStage(arm.stages[name],name,arm.host)

test('behavior: four real proposal stages refuse writes before approval and reject planted transient writes',()=>{
  for(const arm of arms()) {
    const observed=stage(arm,'proposal')
    assert.deepEqual(native.sessionEvents(arm.host,observed.sessionRaw).filter(e=>e.type==='approval'),[])
    native.validateObservation(observed,'proposal')
    const changed=structuredClone(observed)
    changed.events.events.push({elapsed:0.5,path:'README.md',mask:0x2,cookie:0});changed.result.eventCount++
    assert.throws(()=>native.validateObservation(changed,'proposal'),/mutation/)
  }
})
test('behavior: real arms preserve homes and reject changed preservation, unapproved paths and invented gates',async()=>{
  const {validateBehaviorArm}=await helper()
  for(const arm of arms()) {
    validateBehaviorArm(arm)
    for(const mutate of [a=>{a.diffPaths.push('unapproved.txt')},a=>{a.approvedGapAllowlist.push('unapproved.txt')},a=>{a.commandExits[0].exitCode=17}]) {
      const changed=structuredClone(arm);mutate(changed)
      assert.throws(()=>validateBehaviorArm(changed),{name:'AssertionError'})
    }
  }
})
test('behavior: repeated native audit has no writes, gaps or proposals and rejects planted rerun mutations',()=>{
  for(const arm of arms()) {
    const observed=stage(arm,'rerun')
    assert.deepEqual(native.nativeObjects(arm.host,observed.raw,'audit-result'),[{type:'audit-result',proposals:[],writes:[],gaps:[]}])
    const changed=structuredClone(observed);changed.after['unexpected.txt']={sha256:native.sha256('write'),mode:33188}
    assert.throws(()=>native.validateObservation(changed,'rerun'),/snapshot/)
  }
})
test('behavior: canonical required artifact and typed gate outcomes agree across native hosts',async()=>{
  const {semanticProjection}=await helper()
  for(const kind of ['empty','brownfield']) {
    const pair=native.receipt(kind).arms.map(arm=>semanticProjection(arm,stage(arm,'proposal'),stage(arm,'execution')))
    assert.deepEqual(pair[0],pair[1])
    const changed=structuredClone(pair[1]);changed.artifacts.pop()
    assert.throws(()=>assert.deepEqual(pair[0],changed),{name:'AssertionError'})
  }
})
test('behavior: real README drift fails, native approved repairs pass twice, and generated Nx marker bytes survive',()=>{
  const fixture=resolve(native.ROOT,'plugins/zeroh-greenfield/fixtures/zeroh-shaped')
  const refs=JSON.parse(readFileSync(resolve(native.ROOT,'plugins/zeroh-greenfield/dry-runs/evidence/native-34-5/retained/references.json')))
  const checker=resolve(native.ROOT,'plugins/zeroh-greenfield/templates/scripts/check-readme-catalog.mjs')
  const marker=text=>text.match(/<!-- nx configuration[\s\S]*?<!-- nx configuration end -->/i)?.[0]
  for(const host of ['claude','codex']) {
    const root=mkdtempSync(join(tmpdir(),'greenfield-behavior-'))
    try {
      cpSync(fixture,root,{recursive:true})
      const run=()=>spawnSync(process.execPath,[checker,'--catalog','emitted/repo-catalog.json'],{cwd:root,encoding:'utf8'})
      assert.equal(run().status,1,'planted fixture drift must be RED')
      const repaired=native.readBoundFile(refs[host]['README.md']);writeFileSync(join(root,'README.md'),repaired)
      assert.equal(run().status,0,'native approved repair must be GREEN')
      assert.equal(run().status,0,'repeated checker stays GREEN')
      assert.equal(readFileSync(join(root,'README.md'),'utf8'),repaired,'checker never writes repair')
      const original=readFileSync(join(fixture,'CLAUDE.md'),'utf8'),updated=native.readBoundFile(refs[host]['CLAUDE.md'])
      assert.ok(marker(original),'fixture includes generated marker block')
      assert.equal(marker(updated),marker(original))
    } finally {rmSync(root,{recursive:true,force:true})}
  }
})
test('behavior: real native missing-sibling and single-router scenarios satisfy bounded contracts',async()=>{
  const {validateBehaviorReceipts}=await helper()
  validateBehaviorReceipts()
})
// Parser fixtures only: never native receipts or substitutes for the live scenario test.
test('behavior: STOP parser rejects changed remedy, extra proposal, wrong sibling and narrated success',async()=>{
  const {validateStopResult}=await helper()
  const valid={type:'behavior-result',status:'stopped',reasonCode:'MISSING_REQUIRED_SIBLING',missing:['zeroh-roadmap'],remedy:{'zeroh-roadmap':'/plugin install zeroh-roadmap@zeroh-marketplace'},proposals:[],writes:[]}
  assert.doesNotThrow(()=>validateStopResult(valid,['zeroh-roadmap']))
  for(const mutate of [v=>{v.remedy['zeroh-roadmap']='install something'},v=>{v.proposals.push('write')},v=>{v.missing=['zeroh-design']},v=>{v.status='passed'},v=>{v.writes.push('README.md')}]) {
    const changed=structuredClone(valid);mutate(changed)
    assert.throws(()=>validateStopResult(changed,['zeroh-roadmap']),{name:'AssertionError'})
  }
})
test('behavior: router result rejects second dispatch, changed route and unsupported marker',async()=>{
  const {validateRouterResult}=await helper()
  const result={type:'behavior-result',status:'routed',reasonCode:'SINGLE_DISPATCH',route:'brownfield-audit',dispatches:['brownfield-audit'],proposals:[],writes:[]}
  const dispatch={route:'brownfield-audit',evidence:['AGENTS.md']}
  assert.doesNotThrow(()=>validateRouterResult(result,dispatch))
  const duplicate=structuredClone(result);duplicate.dispatches.push('greenfield-init')
  assert.throws(()=>validateRouterResult(duplicate,dispatch),{name:'AssertionError'})
  assert.throws(()=>validateRouterResult(result,{route:'greenfield-init',evidence:['AGENTS.md']}),{name:'AssertionError'})
  assert.throws(()=>validateRouterResult(result,{route:'brownfield-audit',evidence:['imaginary-marker']}),{name:'AssertionError'})
})
test('behavior: changed present-home bytes and reordered approval cannot pass native preservation proof',async()=>{
  const {validatePresentHomes}=await helper()
  for(const arm of native.receipt('brownfield').arms) {
    const before=stage(arm,'proposal'),after=stage(arm,'execution')
    validatePresentHomes(arm,before.before,after.after)
    for(const home of arm.existingHomePaths) {
      const changed=structuredClone(after.after);changed[home].sha256=native.sha256('planted rewrite')
      assert.throws(()=>validatePresentHomes(arm,before.before,changed),{name:'AssertionError'})
    }
    native.validateApprovalSlice(arm.host,before.sessionRaw,after.sessionRaw)
    const suffix=native.sessionSuffix(before.sessionRaw,after.sessionRaw)
    const lines=suffix.trim().split('\n')
    const approvalIndex=lines.findIndex(line=>native.sessionEvents(arm.host,line).some(e=>e.type==='approval'))
    assert.ok(approvalIndex>=0)
    const [approval]=lines.splice(approvalIndex,1);lines.push(approval)
    assert.throws(()=>native.validateApprovalSlice(arm.host,before.sessionRaw,before.sessionRaw+lines.join('\n')+'\n'),/approval must precede/)
  }
})
