import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {execFileSync} from 'node:child_process'
import {makeFixtureRepo,git,writeArcFile,writePhaseFile} from './harness.mjs'
import {resumePublishedDelivery} from '../../cli/commands/deliver.mjs'
import {reduceDelivery,deliveryKeyOf,publishCorrection,persistArcDelivery,loadArcDelivery,transitionArcDelivery,persistCorrectionCheckpoint} from '../../cli/lib/delivery.mjs'
import {monitorDelivery} from '../../cli/lib/ci-monitor.mjs'
import {writeValidationCheckpoint} from '../../cli/commands/arc.mjs'
import {writeReport,recordCorrectionReview} from '../../cli/lib/gate-report.mjs'
import {finalizeCiObservation} from '../../cli/lib/providers/ci.mjs'
import {gateInputKey} from '../../cli/lib/gate-diagnostics.mjs'
import {persistDeliverySummary} from '../../cli/lib/delivery-evaluation.mjs'

const AT='2026-09-08T02:00:00.000Z',LATER='2026-09-08T03:00:00.000Z'

function mixedFixture(){
 const ciPolicy={provider:'github',requiredChecks:['unit','other'],pollIntervalMs:1000,timeoutMs:120000,correctionTimeoutMs:600000,maxRounds:2,headMode:'source-only',ownership:[],reproductionCommands:{}}
 const root=makeFixtureRepo({config:{ciPolicy,mergePolicy:{arcIntegration:'autonomous',maxOpenFollowups:0,autonomousPushRefs:[],primaryCheckout:'fixture',gapsCorrection:'autonomous'}}})
 writeArcFile(root,{id:'ARC',name:'CI repair fixture',baseRef:'main',planes:[{name:'delivery',phases:[42]}],acceptanceCriteria:[{id:'42-ac',job:'repair the observed CI failure',surfaces:['plugin'],signal:'the exact PR head turns green',tier:'wired',bar:'same PR and exact checks'}]})
 writePhaseFile(root,{phase:42,name:'CI repair fixture',status:'backlog',category:'test',kind:'logic',arcId:'ARC',source:'physical fixture',priority:'HIGH',dependsOn:[],conflictsWith:[],keyFiles:['src/plain.ts'],stakeholderDemo:'The affected command passes.',tasks:[{minimal:true,id:'42.8',title:'Repair affected check',done:false}]})
 const foreign=join(root,'other/z.test.mjs');mkdirSync(dirname(foreign),{recursive:true});writeFileSync(foreign,'unchanged foreign test\n')
 git(root,'add','.');git(root,'commit','-qm','fixture base')
 const baseSha=git(root,'rev-parse','HEAD')
 const product=join(root,'src/plain.ts'),foreignBefore=readFileSync(foreign,'utf8')
 writeFileSync(product,'export const plain = 2\n');git(root,'add','src/plain.ts');git(root,'commit','-qm','product change')
 const sourceHeadSha=git(root,'rev-parse','HEAD')
 const attempt=(key,name,id)=>({key,name,source:'check-run',appId:7,verdict:'red',latestAttemptId:id,attempts:[{attemptId:id,suiteId:'7',runNumber:null,runAttempt:null,status:'completed',conclusion:'failure',startedAt:AT,completedAt:AT,detailsUrl:null,logRefs:[`ci://${name}`],artifactRefs:[]}]})
 const checks=[attempt('check-run:7:unit','unit','1'),attempt('check-run:7:other','other','2')]
 const observation=finalizeCiObservation({providerId:'github',repositoryId:'blade/roadmap',providerPullRequestId:'PR_1',sourceHeadSha,baseSha,requiredChecks:['other','unit'],headMode:'source',mergeQueue:null},{checks,observedAt:AT})
 const target={targetKey:'arc:ARC',providerId:'github',repositoryId:'blade/roadmap',baseRef:'refs/heads/main',headRef:'refs/heads/roadmap/arc',currentBaseSha:baseSha,currentHeadSha:sourceHeadSha}
 let state={schemaVersion:1,revision:3,arcId:'ARC',deliveryKey:deliveryKeyOf(target),target,strategy:{kind:'independent',arcId:'ARC'},requested:{terminal:'open',allowedPushRefs:[target.headRef],requiredCapabilities:['pull-request'],requiredChecks:['other','unit'],authority:{queue:null,merge:null}},actions:[],pullRequest:{providerId:'github',repositoryId:'blade/roadmap',targetKey:target.targetKey,providerPullRequestId:'PR_1',number:1,url:null,state:'open',draft:false,baseRef:target.baseRef,headRef:target.headRef,baseSha,headSha:sourceHeadSha,observedAt:AT},checks:{providerId:'github',repositoryId:'blade/roadmap',providerPullRequestId:'PR_1',headSha:sourceHeadSha,requiredChecks:['other','unit'],observedChecks:[{name:'unit',status:'red',attemptId:'1',observedAt:AT},{name:'other',status:'red',attemptId:'2',observedAt:AT}],observedAt:AT},terminal:{status:'awaiting-ci',headSha:sourceHeadSha,reason:null},createdAt:AT,updatedAt:AT}
 const execution=(output,exitCode=1)=>({exitCode,signal:null,output})
 const unit={checkKey:'check-run:7:unit',attemptId:'1',command:'node --test unit',execution:execution('not ok 1 - regression\nsrc/plain.ts:1:1 AssertionError'),paths:['src/plain.ts'],logRefs:['ci://unit'],reruns:[]}
 const other={checkKey:'check-run:7:other',attemptId:'2',command:'node --test other',execution:execution('not ok 1 - unrelated\nother/z.test.mjs:1:1 AssertionError'),paths:['other/z.test.mjs'],logRefs:['ci://other'],reruns:[]}
 const graph={baseSha,sourceHeadSha,complete:true,edges:[]}
 const evidence={schemaVersion:1,root,baseSha,sourceHeadSha,gateInputKey:gateInputKey(root),failures:[unit,other],baseReproductions:[{checkKey:other.checkKey,command:other.command,headSha:baseSha,execution:execution('',0)}],retryReports:[],dependencyGraph:graph}
 const checkpoint={arcId:'ARC',verdict:'GAPS',at:AT,headSha:sourceHeadSha,note:'CI repair',correction:{state:'awaiting-repair',validationHead:sourceHeadSha,gateInputKey:evidence.gateInputKey,round:0,bounds:{maxRounds:2,deadlineAt:LATER,allowedPathPrefixes:['src'],authority:{source:'config',reference:'mergePolicy.gapsCorrection=autonomous'}},route:null}}
 const collectDependencyGraph=()=>{
  const files=['src/plain.ts','other/z.test.mjs'],edges=[]
  for(const file of files){const body=readFileSync(join(root,file),'utf8');for(const match of body.matchAll(/from ['"']([^'"']+)['"']/g))edges.push({from:file,to:match[1]})}
  return {baseSha,sourceHeadSha,complete:true,edges}
 }
 const deps={classifierDeps:{collectDependencyGraph},clock:()=>AT,git:(_root,args)=>git(root,...args),load:()=>state,loadCheckpoint:()=>null,monitor:()=>({status:'red',delivery:state,source:'provider',observation}),collect:()=>({status:'collected',evidence}),lookupCi:()=>observation,loadPhases:()=>[{phase:42,status:'done',arcId:'ARC',keyFiles:['src'],tasks:[]}],initialize:()=>structuredClone(checkpoint),persistCheckpoint:(_r,_id,_expected,next)=>next,transition:(_r,_id,event)=>{state=reduceDelivery(state,event);return state}}
 const request={root,requestedArcId:'ARC',ownerArcId:'ARC',state,arc:{id:'ARC',acceptanceCriteria:[{id:'42-ac'}]},config:{ciPolicy,mergePolicy:{gapsCorrection:'autonomous'}},policy:{remote:'origin',strategy:{}},provider:{},ciProvider:{}}
 return {root,request,deps,observation,evidence,get state(){return state},set state(value){state=value},foreignBefore,foreign}
}

test('mixed exact-head failures route the causal path and retain proven unrelated evidence without touching it',()=>{
 const f=mixedFixture(),out=resumePublishedDelivery(f.request,f.deps)
 assert.equal(out.handoff?.action,'run-correction',out.reason)
 assert.deepEqual(out.handoff.paths,['src/plain.ts'])
 assert.equal(f.state.correctionBinding.route.selected[0].kind,'causal')
 assert.equal(f.state.correctionBinding.route.residual.length,1)
 assert.equal(f.state.correctionBinding.route.residual[0].kind,'unrelated')
 assert.deepEqual(f.state.correctionBinding.route.residual[0].paths,['other/z.test.mjs'])
 assert.equal(readFileSync(f.foreign,'utf8'),f.foreignBefore)
})


test('a newer provider attempt during evidence collection invalidates the batch before correction state',()=>{
 const f=mixedFixture(),newer=structuredClone(f.observation),before=structuredClone(f.state)
 const check=newer.checks.find(row=>row.key==='check-run:7:unit')
 check.latestAttemptId='99'
 check.attempts.push({...check.attempts[0],attemptId:'99',startedAt:'2026-09-08T02:01:00.000Z',completedAt:'2026-09-08T02:01:01.000Z'})
 f.deps.lookupCi=()=>newer
 const out=resumePublishedDelivery(f.request,f.deps)
 assert.equal(out.status,'held')
 assert.match(out.reason,/attempts changed|current attempt/i)
 assert.deepEqual(f.state,before)
 assert.equal(readFileSync(f.foreign,'utf8'),f.foreignBefore)
})


test('packet graph claims without the physical collector remain indeterminate and authorize no foreign edit',()=>{
 const f=mixedFixture();delete f.deps.classifierDeps
 const out=resumePublishedDelivery(f.request,f.deps)
 assert.equal(out.handoff?.action,'run-correction',out.reason)
 const residual=f.state.correctionBinding.route.residual.find(row=>row.paths.includes('other/z.test.mjs'))
 assert.equal(residual.kind,'indeterminate')
 assert.equal(readFileSync(f.foreign,'utf8'),f.foreignBefore)
})


test('repairable exact-head failure reaches the same PR green through typed review, sweep and intent evidence',()=>{
 const f=mixedFixture(),source=f.state.target.currentHeadSha
 f.observation.requiredChecks=['unit'];f.observation.checks=f.observation.checks.filter(row=>row.name==='unit')
 f.evidence.failures=f.evidence.failures.filter(row=>row.checkKey==='check-run:7:unit');f.evidence.baseReproductions=[]
 f.state.requested.requiredChecks=['unit'];f.state.checks.requiredChecks=['unit'];f.state.checks.observedChecks=f.state.checks.observedChecks.filter(row=>row.name==='unit')
 f.request.config.ciPolicy.requiredChecks=['unit']
 // This golden uses the production receipt/checkpoint stores and reducer transitions.
 const observedPr=structuredClone(f.state.pullRequest),observedChecks=structuredClone(f.state.checks)
 const initial={...structuredClone(f.state),revision:0,pullRequest:null,checks:null,terminal:{status:'preparing',headSha:source,reason:null},createdAt:AT,updatedAt:AT}
 persistArcDelivery(f.root,null,initial)
 f.state=transitionArcDelivery(f.root,'ARC',{type:'observe-pr',deliveryKey:initial.deliveryKey,targetKey:initial.target.targetKey,expectedRevision:0,at:AT,pullRequest:observedPr})
 f.state=transitionArcDelivery(f.root,'ARC',{type:'observe-checks',deliveryKey:initial.deliveryKey,targetKey:initial.target.targetKey,expectedRevision:f.state.revision,at:AT,checks:observedChecks})
 f.state=transitionArcDelivery(f.root,'ARC',{type:'set-terminal',deliveryKey:initial.deliveryKey,targetKey:initial.target.targetKey,expectedRevision:f.state.revision,at:AT,terminal:{status:'awaiting-ci',headSha:source,reason:null}})
 f.request.state=f.state
 const checkpointDir=join(f.root,'roadmap/.gate/arc-ARC');mkdirSync(checkpointDir,{recursive:true});writeFileSync(join(f.root,'roadmap/.gate/.gitignore'),'*\n')
 writeFileSync(join(checkpointDir,'validate.json'),JSON.stringify(f.deps.initialize()))
 f.evidence.gateInputKey=gateInputKey(f.root)
 const initialCheckpoint=f.deps.initialize();initialCheckpoint.correction.gateInputKey=f.evidence.gateInputKey;writeFileSync(join(checkpointDir,'validate.json'),JSON.stringify(initialCheckpoint))
 f.deps.load=()=>loadArcDelivery(f.root,'ARC')
 f.deps.transition=(_root,_arc,event)=>(f.state=transitionArcDelivery(f.root,'ARC',event))
 f.deps.loadCheckpoint=()=>JSON.parse(readFileSync(join(checkpointDir,'validate.json'),'utf8'))
 f.deps.persistCheckpoint=(root,arc,expected,next)=>persistCorrectionCheckpoint(root,arc,expected,next,{clock:()=>AT})
 const routed=resumePublishedDelivery(f.request,f.deps)
 assert.equal(routed.handoff?.action,'run-correction',JSON.stringify(routed))
 assert.deepEqual(f.state.correctionBinding.route.residual,[])

 writeFileSync(join(f.root,'src/plain.ts'),'export const plain = 3\n')
 git(f.root,'add','src/plain.ts');git(f.root,'commit','-qm','fix: exact CI failure')
 const repairHead=git(f.root,'rev-parse','HEAD'),binding=structuredClone(f.state.correctionBinding)
 const affected=execFileSync(process.execPath,['-e',"const assert=require('assert');const fs=require('fs');assert.match(fs.readFileSync('src/plain.ts','utf8'),/plain = 3/)"],{cwd:f.root,encoding:'utf8'});assert.equal(affected,'')
 const reportKey=gateInputKey(f.root,{exclude:['roadmap/.gate','roadmap/arc-evals/phase-42.peval.json']})
 writeReport(f.root,{phase:42,startedAt:AT,baseSha:source,mode:'arc',kind:'hardening',testScope:{derived:'relevant',declared:null,effective:'relevant'},reviewScope:{derived:'none',declared:null,effective:'none'},slots:[{slot:'unit-affected',command:'node -e physical assertion',exitCode:0}],agents:[],green:true,notes:[],slotFilter:'unit',attempt:{inputKey:reportKey,headSha:repairHead}})
 recordCorrectionReview(f.root,42,{arcId:'ARC',agent:'independent-reviewer',model:'fixture-independent',verdict:'clean',summary:'Physical affected check passed.',findings:[]},{clock:()=>AT})
 const checkpoint={arcId:'ARC',verdict:'PASS',at:AT,headSha:repairHead,note:'reviewed CI repair',correction:{state:'validated',...binding,repairHead,readyAt:AT}}
 writeValidationCheckpoint(f.root,'ARC',f.deps.loadCheckpoint(),checkpoint,{clock:()=>AT})
 const arc={id:'ARC',acceptanceCriteria:[{id:'42-ac',tier:'wired'}]}
 let remote=source,pushes=0,creates=0,summary=null
 const capabilities={providerId:'github',supported:['lookup','push','create','update','pull-request'],unsupported:[]}
 const provider={
  capabilities:()=>capabilities,
  preflight:({operation})=>({status:'ready',providerId:'github',repositoryId:'blade/roadmap',operation,capabilities,observedAt:AT}),
  lookup:()=>({...f.state.pullRequest,headSha:remote,observedAt:AT}),
  push(request){if(remote!==request.action.requested.headSha){remote=request.action.requested.headSha;pushes++}return {status:'succeeded',actionKey:request.action.actionKey,providerActionId:remote,errorKind:null,observedAt:AT,pullRequest:null}},
  create(){creates++;throw Error('replacement PR forbidden')},
  update(request){return {status:'succeeded',actionKey:request.action.actionKey,providerActionId:'PR_1',errorKind:null,observedAt:AT,pullRequest:{...f.state.pullRequest,headSha:remote,observedAt:AT}}},
 }
 f.request.arc=arc;f.request.provider=provider
 f.deps.normalize=()=>({status:'retained-corrections',correctionCount:1,newHead:repairHead})
 f.deps.publishCorrection=request=>publishCorrection(request,{load:f.deps.load,transition:f.deps.transition,clock:()=>AT,git:(_root,args)=>git(f.root,...args),normalize:f.deps.normalize})
 const greenAt='2026-09-08T02:01:00.000Z'
 const green=finalizeCiObservation({providerId:'github',repositoryId:'blade/roadmap',providerPullRequestId:'PR_1',sourceHeadSha:repairHead,baseSha:f.state.target.currentBaseSha,requiredChecks:['unit'],headMode:'source',mergeQueue:null},{checks:[{key:'check-run:7:unit',name:'unit',source:'check-run',appId:7,verdict:'green',latestAttemptId:'green-1',attempts:[{attemptId:'green-1',suiteId:'7',runNumber:null,runAttempt:null,status:'completed',conclusion:'success',startedAt:greenAt,completedAt:greenAt,detailsUrl:null,logRefs:[],artifactRefs:[]}]}],observedAt:greenAt})
 f.deps.monitor=request=>monitorDelivery({...request,provider:{lookup:()=>green}},{clock:()=>greenAt})
 const evalDir=join(f.root,'roadmap/arc-evals');mkdirSync(evalDir,{recursive:true})
 writeFileSync(join(evalDir,'ARC-2026-09-08-sweep.json'),JSON.stringify({arcId:'ARC',date:'2026-09-08',estateRatchets:'green',phaseGates:[{phase:42,done:true,gateGreen:true}],debtDispositions:[],architectVerdict:'clean',deferredToReleaseSweep:[],overall:'green',blockers:[],observation:{headSha:repairHead,recordedAt:AT}}))
 writeFileSync(join(evalDir,'ARC-2026-09-08-verdicts.json'),JSON.stringify({arcId:'ARC',date:'2026-09-08',judgeModel:'fixture-independent',verdicts:[{criterionId:'42-ac',status:'met',tierUsed:'wired',evidence:'affected check and review',confidence:'high'}],observation:{headSha:repairHead,recordedAt:AT}}))
 f.deps.summary=(root,currentArc,delivery)=>{summary=persistDeliverySummary(root,currentArc,delivery);return summary}
 const out=resumePublishedDelivery(f.request,f.deps)
 assert.equal(out.status,'open-green',out.reason);assert.equal(out.handoff.action,'evaluate')
 assert.equal(pushes,1);assert.equal(creates,0);assert.equal(remote,repairHead)
 const persisted=loadArcDelivery(f.root,'ARC')
 assert.equal(persisted.pullRequest.providerPullRequestId,'PR_1');assert.equal(persisted.target.currentHeadSha,repairHead)
 assert.equal(persisted.checks.headSha,repairHead);assert.equal(persisted.terminal.status,'open-green')
 assert.equal(summary.delivery.providerPullRequestId,'PR_1');assert.equal(summary.delivery.sourceHeadSha,repairHead)
})


test('shared correction round and deadline exhaustion hold before another durable binding',()=>{
 for(const expired of ['round','deadline']){
  const f=mixedFixture(),checkpoint={arcId:'ARC',verdict:'GAPS',at:AT,headSha:f.state.target.currentHeadSha,note:'exhausted',correction:{state:'awaiting-repair',validationHead:f.state.target.currentHeadSha,gateInputKey:f.evidence.gateInputKey,round:expired==='round'?1:0,bounds:{maxRounds:1,deadlineAt:expired==='deadline'?AT:LATER,allowedPathPrefixes:['src'],authority:{source:'config',reference:'mergePolicy.gapsCorrection=autonomous'}},route:null}}
  f.request.config.ciPolicy.maxRounds=1;f.deps.loadCheckpoint=()=>checkpoint
  const before=structuredClone(f.state),out=outPublishedDelivery(f)
  assert.equal(out.status,'held',expired);assert.match(out.reason,/round|deadline|exhaust/i)
  assert.deepEqual(f.state,before);assert.equal(readFileSync(f.foreign,'utf8'),f.foreignBefore)
 }
})
function outPublishedDelivery(f){return resumePublishedDelivery(f.request,f.deps)}

test('an independently READY member phase selects the planned route without widening its files',()=>{
 const f=mixedFixture()
 f.request.correctionPhase=43
 f.deps.loadPhases=()=>[
  {phase:42,status:'done',arcId:'ARC',keyFiles:['src'],tasks:[]},
  {phase:43,status:'backlog',arcId:'ARC',reviewRecord:{verdict:'READY'},keyFiles:['src/plain.ts'],tasks:[{id:'43.1',files:['src/plain.ts']}]},
 ]
 const out=outPublishedDelivery(f)
 assert.equal(out.handoff?.action,'run-correction',out.reason);assert.equal(out.handoff.phase,43)
 assert.equal(f.state.correctionBinding.route.kind,'planned-correction')
 assert.deepEqual(f.state.correctionBinding.route.plannedCorrection,{correctionId:'phase-43',phaseId:43,criterionIds:['42-ac']})
 assert.deepEqual(f.state.correctionBinding.route.scopePaths,['src/plain.ts'])
})
