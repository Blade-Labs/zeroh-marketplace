// Recorded-environment audit, deliberately separate from product/validator regressions.
// Run npm run test:native-evidence. Stale source or host bindings still fail.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as native from './greenfield-native-evidence.mjs'
const evidence = native
const { receipt, validateSourceBinding, nativeObjects, readStage, validateObservedArm, ROOT, sha256 } = native
const helper=()=>import('./greenfield-behavior-evidence.mjs')
const arms=()=>['empty','brownfield'].flatMap(kind=>native.receipt(kind).arms)
const stage=(arm,name)=>native.readStage(arm.stages[name],name,arm.host)

test('four native-host arms are current, isolated, approval-ordered, bounded, and idempotent', () => {
  const arms = ['empty', 'brownfield'].flatMap((kind) => receipt(kind).arms.map((arm) => ({ kind, ...arm })))
  assert.deepEqual(arms.map((arm) => `${arm.kind}:${arm.host}`), ['empty:claude', 'empty:codex', 'brownfield:claude', 'brownfield:codex'])
  assert.equal(new Set(arms.map((arm) => arm.scratchIdentity)).size, 4, 'scratch identities are unique, never copied')
  assert.equal(new Set(arms.map((arm) => arm.transcriptSha256)).size, 4, 'transcripts are unique, never copied')
  for (const arm of arms) {
    validateObservedArm(arm)
    assert.match(arm.executable, /(?:^|\/)(?:claude|codex)$/)
    assert.ok(arm.version.trim())
    assert.equal(arm.pluginManifestSha256, sha256(readFileSync(resolve(ROOT, `plugins/zeroh-greenfield/.${arm.host === 'claude' ? 'claude' : 'codex'}-plugin/plugin.json`))))
    validateSourceBinding(arm)
    assert.deepEqual(arm.authorityEnvelope, { filesystem: 'workspace-write', network: 'inherited', approvals: 'inherited' })

  }
})

test('the report is a receipt projection and cannot narrate a failed arm green', () => {
  const report = readFileSync(resolve(ROOT, 'plugins/zeroh-greenfield/DRYRUN-2026-09.md'), 'utf8')
  for (const kind of ['empty', 'brownfield']) {
    for (const arm of receipt(kind).arms) {
      assert.match(report, new RegExp(`${kind}.*${arm.host}.*${arm.transcriptSha256}`, 'i'))
      assert.equal(arm.status, 'passed')
    }
  }
})

test('delivery installation: final native proposals and receipts include approved CI/release output and execution evidence',()=>{
  for(const kind of ['empty','brownfield'])for(const arm of receipt(kind).arms) {
    const proposal=readStage(arm.stages.proposal,'proposal',arm.host),execution=readStage(arm.stages.execution,'execution',arm.host)
    const proposed=nativeObjects(arm.host,proposal.raw,'proposal')[0]
    assert.ok(proposed.delivery,'historical pre-delivery proposals cannot certify task 34.7')
    const delivery=evidence.validateDeliveryEvidence({arm,proposal:proposed,before:proposal.before,after:execution.after,commands:execution.commands})
    assert.deepEqual(arm.deliveryValidation.schemaDigests,delivery.schemaDigests,'final receipts bind shard/evidence schemas')
  }
})

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
    for(const mutate of [a=>{a.diffPaths.push('unapproved.txt')},a=>{a.approvedGapAllowlist.push('unapproved.txt')},a=>{a.commandExits[0].exitCode=17},a=>{a.commandExits[0].command+=' ; true'},a=>{a.commandExits[0].nativeCommand+=' ; true'},a=>{a.commandExits[0].toolCallId='invented-tool-call'}]) {
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
    const arm=native.receipt(kind).arms[0],proposal=stage(arm,'proposal'),execution=stage(arm,'execution')
    // Parser fixture only: changing a common gate from executed to absent
    // changes the outcome, even though approved command spelling is host-local.
    const typed=native.nativeObjects(arm.host,proposal.raw,'proposal')[0]
    const slot=native.CORE_GATES.find(slot=>typed.gates[slot]!=='none')
    assert.ok(slot,'retained arm has an executed gate for the negative control')
    typed.gates[slot]='none'
    const gateChanged=structuredClone(proposal)
    gateChanged.raw=JSON.stringify(arm.host==='claude'
      ? {type:'assistant',message:{content:[{type:'text',text:JSON.stringify(typed)}]}}
      : {type:'item.completed',item:{type:'agent_message',text:JSON.stringify(typed)}})+'\n'
    assert.notDeepEqual(semanticProjection(arm,proposal,execution),semanticProjection(arm,gateChanged,execution),'executed versus declared absent remains a different outcome')
    const missing=structuredClone(execution);delete missing.after[pair[0].artifacts[0].path]
    assert.throws(()=>semanticProjection(arm,proposal,missing),/required contract artifact missing/)
    const changed=structuredClone(execution)
    changed.after[pair[0].artifacts[0].path].sha256=native.sha256('different required artifact')
    const prior=structuredClone(proposal)
    prior.before[pair[0].artifacts[0].path]=structuredClone(execution.after[pair[0].artifacts[0].path])
    assert.notDeepEqual(semanticProjection(arm,prior,execution),semanticProjection(arm,prior,changed),'preserved versus updated remains a different outcome')
  }
})

test('behavior: real native missing-sibling and single-router scenarios satisfy bounded contracts',async()=>{
  const {validateBehaviorReceipts}=await helper()
  validateBehaviorReceipts()
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
