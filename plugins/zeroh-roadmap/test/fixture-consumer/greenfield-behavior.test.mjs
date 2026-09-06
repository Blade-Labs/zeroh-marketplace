import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import * as native from './greenfield-native-evidence.mjs'
const helper=()=>import('./greenfield-behavior-evidence.mjs')





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
