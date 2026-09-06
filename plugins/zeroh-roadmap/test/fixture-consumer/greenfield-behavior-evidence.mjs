/** Validate retained host behavior; this module never executes a workflow or invents receipts. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ROOT, REQUIRED_HOMES, CORE_GATES, readStage, validateObservedArm, nativeObjects, sessionEvents, matchesGateCommand, readBoundFile } from './greenfield-native-evidence.mjs'
export function validateBehaviorArm(arm) {
  const stages=validateObservedArm(arm)
  for(const exit of arm.commandExits) {
    const observed=stages.execution.commands.find(command=>command.id===exit.toolCallId)
    assert.ok(observed,'each recorded result needs native provenance')
    assert.equal(exit.nativeCommand,observed.command)
    assert.equal(exit.exitCode,observed.exitCode,'recorded structural/gate exit must match actual native completion')
    assert.equal(observed.exitCode,0)
  }
  if(arm.kind==='brownfield') validatePresentHomes(arm,stages.proposal.before,stages.execution.after)
  return stages
}
export function validatePresentHomes(arm,before,after) {
  assert.ok(arm.existingHomePaths?.length>0,'present homes must be enumerated')
  for(const path of arm.existingHomePaths) {
    assert.ok(before[path]?.sha256,`present home lacks baseline bytes: ${path}`)
    assert.deepEqual(after[path],before[path],`present home bytes or mode changed: ${path}`)
  }
}
export function semanticProjection(arm,proposal,execution) {
  const result=nativeObjects(arm.host,proposal.raw,'proposal')
  assert.equal(result.length,1)
  // Canonical contract homes only: optional generated application/test files
  // remain in each arm's full approvedGapAllowlist and are not claimed identical.
  const paths=[...REQUIRED_HOMES,'roadmap/roadmap.config.json','AGENTS.md','CLAUDE.md','README.md'].sort()
  return {
    kind:arm.kind,
    artifacts:paths.map(path=>{
      assert.ok(execution.after[path]?.sha256,`required contract artifact missing: ${path}`)
      return {path,decision:!proposal.before[path]?'created':proposal.before[path].sha256===execution.after[path].sha256?'preserved':'updated'}
    }),
    gates:CORE_GATES.map(slot=>({slot,decision:result[0].gates[slot]==='none'?'declared-absent':'executed'})),
  }
}
export function validateStopResult(result,missing) {
  assert.deepEqual(result,{type:'behavior-result',status:'stopped',reasonCode:'MISSING_REQUIRED_SIBLING',missing,remedy:Object.fromEntries(missing.map(id=>[id,`/plugin install ${id}@zeroh-marketplace`])),proposals:[],writes:[]},'STOP must be exact, bounded and actionable')
}
export function validateRouterResult(result,dispatch) {
  assert.deepEqual(result,{type:'behavior-result',status:'routed',reasonCode:'SINGLE_DISPATCH',route:'brownfield-audit',dispatches:['brownfield-audit'],proposals:[],writes:[]})
  assert.deepEqual(dispatch,{route:'brownfield-audit',evidence:['AGENTS.md']},'router emits exactly one supported dispatch with observed marker evidence')
}
function observedRead(stage,host,path) {
  const shell=stage.commands.some(c=>c.exitCode===0 && [`cat ${path}`,`cat '${path}'`].some(command=>matchesGateCommand(c.command,command,stage.request.scratch)))
  const tool=sessionEvents(host,stage.sessionRaw).some(e=>e.type==='tool'&&e.name==='Read'&&e.input?.file_path===resolve(stage.request.scratch,path))
  return shell||tool
}
export function validateBehaviorScenario(arm) {
  const expected={ 'missing-roadmap':['zeroh-roadmap'], 'missing-design':['zeroh-design'], 'single-router':[] }
  assert.ok(Object.hasOwn(expected,arm.scenario),'known behavior scenario required')
  const stage=readStage(arm.stage,'proposal',arm.host)
  assert.equal(stage.request.behaviorScenario?.id,arm.scenario,'native launch must bind scenario')
  assert.deepEqual(stage.request.behaviorScenario.expectedMissing,expected[arm.scenario])
  assert.deepEqual(sessionEvents(arm.host,stage.sessionRaw).filter(e=>e.type==='approval'),[],'read-only behavior scenarios have no execution approval')
  assert.deepEqual(nativeObjects(arm.host,stage.raw,'proposal'),[],'STOP/router must not also propose writes')
  const results=nativeObjects(arm.host,stage.raw,'behavior-result')
  assert.equal(results.length,1,'one native typed behavior result required')
  if(arm.scenario==='single-router') {
    const dispatches=nativeObjects(arm.host,stage.raw,undefined).filter(value=>Object.hasOwn(value,'route'))
    assert.equal(dispatches.length,1,'exactly one native router dispatch object')
    validateRouterResult(results[0],dispatches[0])
    assert.equal(stage.request.behaviorScenario.markerPath,'AGENTS.md')
    assert.ok(stage.before['AGENTS.md']?.sha256,'routing marker must exist in observed baseline')
    const installedRoot=stage.request.behaviorScenario.installedRoot
    assert.ok(typeof installedRoot==='string' && installedRoot.startsWith('/'),'isolated installed root must be prebound')
    const contract=resolve(installedRoot,'zeroh-greenfield/skills/using-zeroh-greenfield/SKILL.md')
    assert.equal(stage.request.behaviorScenario.routerContract,contract)
    assert.ok(observedRead(stage,arm.host,contract),'native host must actually read router contract')
    assert.ok(observedRead(stage,arm.host,'AGENTS.md'),'native host must actually inspect routing marker')
  } else {
    const scenario=stage.request.behaviorScenario
    const inventory=JSON.parse(readBoundFile(scenario.installedInventory))
    assert.ok(Array.isArray(inventory.directories),'retained assembly directory inventory required')
    assert.equal(new Set(inventory.directories).size,inventory.directories.length,'assembly inventory cannot duplicate siblings')
    assert.ok(inventory.directories.includes('zeroh-greenfield'),'behavior owner must be installed')
    if(arm.scenario==='missing-design') assert.ok(inventory.directories.includes('zeroh-roadmap'),'design scenario must isolate only the required design sibling')
    for(const id of expected[arm.scenario]) assert.ok(!inventory.directories.includes(id),'claimed missing sibling must actually be absent')
    assert.ok(typeof scenario.installedRoot==='string' && scenario.installedRoot.startsWith('/'),'absolute observed assembly root required')
    const listing=stage.commands.filter(c=>c.exitCode===0 && [`ls -1 ${scenario.installedRoot}`,`ls -1 '${scenario.installedRoot}'`].some(command=>matchesGateCommand(c.command,command,stage.request.scratch)))
    assert.equal(listing.length,1,'exactly one actual native sibling inventory read required')
    assert.deepEqual(listing[0].output.trim().split(/\r?\n/).filter(Boolean).sort(),[...inventory.directories].sort(),'native discovered siblings must match retained assembly inventory')
    validateStopResult(results[0],expected[arm.scenario])
  }
  return {scenario:arm.scenario,result:results[0]}
}
export function validateBehaviorReceipts(path=resolve(ROOT,'plugins/zeroh-greenfield/dry-runs/evidence/native-34-5/receipt.json')) {
  const receipt=JSON.parse(readFileSync(path,'utf8'))
  assert.deepEqual(receipt.arms.map(a=>`${a.scenario}:${a.host}`).sort(),['missing-roadmap','missing-design','single-router'].flatMap(s=>['claude','codex'].map(h=>`${s}:${h}`)).sort())
  assert.equal(new Set(receipt.arms.map(a=>a.stage.directory)).size,6,'behavior captures must be independent')
  const projections=receipt.arms.map(arm=>validateBehaviorScenario(arm))
  for(const scenario of ['missing-roadmap','missing-design','single-router']) {
    const pair=projections.filter(p=>p.scenario===scenario)
    assert.deepEqual(pair[0],pair[1],'hosts must agree on typed scenario result')
  }
  return projections
}
