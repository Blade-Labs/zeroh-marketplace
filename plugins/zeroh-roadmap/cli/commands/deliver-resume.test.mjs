import {test} from 'node:test'
import assert from 'node:assert/strict'
import {resumePublishedDelivery,deliveryNormalizationDeps} from './deliver.mjs'
const HEAD='1'.repeat(40),BASE='0'.repeat(40),AT='2026-09-08T02:00:00.000Z'
function fixture(){
 const state={arcId:'ARC',revision:3,target:{currentHeadSha:HEAD,currentBaseSha:BASE},createdAt:AT,pullRequest:{providerPullRequestId:'PR_1'},requested:{requiredChecks:['unit']}}
 const calls=[]
 const deps={clock:()=>AT,git:()=>HEAD,load:()=>state,loadCheckpoint:()=>null,monitor:()=>({status:'pending',delivery:state,observation:null}),summary:()=>{calls.push('summary');return {arcId:'ARC'}},collect:()=>{calls.push('collect');throw Error('unexpected collection')},publishCorrection:()=>{calls.push('push');throw Error('unexpected push')}}
 return {state,calls,deps,request:{root:'/repo',requestedArcId:'ARC',ownerArcId:'ARC',state,arc:{id:'ARC'},config:{},policy:{remote:'origin'},provider:{},ciProvider:{}}}
}
test('one pending poll returns awaiting-ci without collecting, publishing or declaring completion',()=>{
 const f=fixture(),out=resumePublishedDelivery(f.request,f.deps)
 assert.equal(out.status,'awaiting-ci');assert.deepEqual(f.calls,[])
})
test('exact green invokes the existing summary owner and hands off evaluation',()=>{
 const f=fixture();f.deps.monitor=()=>({status:'green',delivery:f.state})
 const out=resumePublishedDelivery(f.request,f.deps);assert.equal(out.status,'open-green');assert.equal(out.handoff.action,'evaluate');assert.deepEqual(f.calls,['summary'])
})
test('cached red is not recollected as a fresh attempt and provider holds stay actionable',()=>{
 const f=fixture();f.deps.monitor=()=>({status:'red',delivery:f.state,source:'cache',observation:null})
 assert.equal(resumePublishedDelivery(f.request,f.deps).status,'awaiting-ci');assert.deepEqual(f.calls,[])
 f.deps.monitor=()=>({status:'held',delivery:f.state,reason:'rate limited'})
 assert.match(resumePublishedDelivery(f.request,f.deps).reason,/rate limited/)
})
test('an existing unchanged repair returns the same handoff without spending another round',()=>{
 const f=fixture();f.state.correctionBinding={validationHead:HEAD,round:1,route:{sourceHeadSha:HEAD,scopePaths:['src/a'],trace:{phaseId:42,criterionIds:['working']},residual:[]}}
 f.deps.loadCheckpoint=()=>({arcId:'ARC',verdict:'GAPS',correction:{state:'awaiting-repair',validationHead:HEAD,round:1,route:f.state.correctionBinding.route}})
 f.deps.monitor=()=>{throw Error('repair must resume before polling')}
 const out=resumePublishedDelivery(f.request,f.deps);assert.equal(out.handoff.action,'run-correction');assert.equal(out.handoff.round,1);assert.deepEqual(f.calls,[])
})
test('a changed repair cannot publish before affected review and fresh sweep/intent',()=>{
 const f=fixture();f.state.correctionBinding={validationHead:HEAD,round:1,route:{sourceHeadSha:HEAD,scopePaths:['src/a'],trace:{phaseId:42,criterionIds:['working']},residual:[]}}
 f.deps.git=()=> '2'.repeat(40)
 f.deps.loadCheckpoint=()=>({arcId:'ARC',verdict:'GAPS',correction:{state:'awaiting-repair',validationHead:HEAD,round:1,route:f.state.correctionBinding.route}})
 const out=resumePublishedDelivery(f.request,f.deps);assert.equal(out.handoff.action,'review-correction');assert.deepEqual(f.calls,[])
})
test('checkpoint-ahead crash resumes its saved route before a changed CI attempt is polled',()=>{
 const f=fixture(),route={sourceHeadSha:HEAD,scopePaths:['src/a'],trace:{phaseId:42,criterionIds:['working']},residual:[]},bounds={maxRounds:2}
 const checkpoint={arcId:'ARC',verdict:'GAPS',correction:{state:'awaiting-repair',validationHead:HEAD,round:1,route,bounds}}
 f.deps.loadCheckpoint=()=>checkpoint
 f.deps.bindingOf=()=>({validationHead:HEAD,round:1,route,bounds})
 f.deps.transition=(_root,_id,event)=>{f.calls.push('bind');f.state.correctionBinding=event.binding;return f.state}
 f.deps.monitor=()=>{throw Error('must not replace persisted evidence with a newer CI attempt')}
 const out=resumePublishedDelivery(f.request,f.deps);assert.equal(out.handoff?.action,'run-correction');assert.deepEqual(f.calls,['bind']);assert.equal(out.handoff.round,1)
})
test('normalization observes the exact remote branch without requiring a local branch ref',async()=>{
 const {deliveryNormalizationDeps}=await import('./deliver.mjs'),f=fixture(),ref='refs/heads/arc'
 f.state.target.headRef=ref;f.state.target.providerId='github';f.state.target.repositoryId='blade/repo';f.state.correctionBinding={validationHead:HEAD,route:{selected:[{kind:'causal',checkKey:'check-run:5:unit',attemptId:'12'}]}}
 const {finalizeCiObservation}=await import('../lib/providers/ci.mjs')
 const ci=finalizeCiObservation({providerId:'github',repositoryId:'blade/repo',providerPullRequestId:'PR_1',sourceHeadSha:HEAD,baseSha:BASE,requiredChecks:['unit'],headMode:'source',mergeQueue:null},{observedAt:AT,checks:[{key:'check-run:5:unit',name:'unit',source:'check-run',appId:5,latestAttemptId:'12',verdict:'red',attempts:[{attemptId:'12',suiteId:'1',runNumber:null,runAttempt:null,status:'completed',conclusion:'failure',startedAt:AT,completedAt:AT,detailsUrl:null,logRefs:[],artifactRefs:[]}]}]})
 const calls=[],adapter=deliveryNormalizationDeps({...f.request,deadlineMs:Date.parse(AT)+60000,ciProvider:{lookup:()=>ci}},{clock:()=>AT,git:(_root,args)=>{calls.push(args);assert.equal(args[0],'ls-remote');return `${HEAD}\t${ref}`}})
 assert.equal(adapter.observePublishedRef(ref),HEAD)
 assert.equal(adapter.inspectDelivery({head:'2'.repeat(40)}).pullRequest.ref,ref)
 assert.throws(()=>adapter.observePublishedRef('refs/heads/other'))
 assert.equal(calls.length,2)
})


import {reduceDelivery,deliveryKeyOf} from '../lib/delivery.mjs'
import {classifyFailureScope} from '../lib/failure-scope.mjs'
import {finalizeCiObservation} from '../lib/providers/ci.mjs'
const INPUT='a'.repeat(64),LATER='2026-09-08T03:00:00.000Z'
function durableState({owner='ARC',strategy={kind:'independent',arcId:owner}}={}){
 const target={providerId:'github',repositoryId:'blade/repo',targetKey:'target',baseRef:'refs/heads/main',headRef:'refs/heads/arc',currentBaseSha:BASE,currentHeadSha:HEAD}
 return {schemaVersion:1,revision:3,arcId:owner,deliveryKey:deliveryKeyOf(target),target,strategy,requested:{terminal:'open',allowedPushRefs:[target.headRef],requiredCapabilities:['pull-request'],requiredChecks:['unit'],authority:{queue:null,merge:null}},actions:[],pullRequest:{providerId:'github',repositoryId:'blade/repo',targetKey:target.targetKey,providerPullRequestId:'PR_1',number:1,url:null,state:'open',draft:false,baseRef:target.baseRef,headRef:target.headRef,baseSha:BASE,headSha:HEAD,observedAt:AT},checks:{providerId:'github',repositoryId:'blade/repo',providerPullRequestId:'PR_1',headSha:HEAD,requiredChecks:['unit'],observedChecks:[{name:'unit',status:'red',attemptId:'1',observedAt:AT}],observedAt:AT},terminal:{status:'awaiting-ci',headSha:HEAD,reason:null},createdAt:AT,updatedAt:AT}
}
const runCheck=(attemptId='1')=>({key:'check-run:7:unit',name:'unit',source:'check-run',appId:7,verdict:'red',latestAttemptId:attemptId,attempts:[{attemptId,suiteId:'7',runNumber:null,runAttempt:null,status:'completed',conclusion:'failure',startedAt:AT,completedAt:AT,detailsUrl:null,logRefs:['ci://unit'],artifactRefs:[]}]})
function redObservation(attemptId='1'){
 return finalizeCiObservation({providerId:'github',repositoryId:'blade/repo',providerPullRequestId:'PR_1',sourceHeadSha:HEAD,baseSha:BASE,requiredChecks:['unit'],headMode:'source',mergeQueue:null},{checks:[runCheck(attemptId)],observedAt:AT})
}
function packet(output='not ok 1 - broken\nsrc/a.mjs:1:1 AssertionError: wrong'){
 return {schemaVersion:1,root:'/repo',baseSha:BASE,sourceHeadSha:HEAD,gateInputKey:INPUT,failures:[{checkKey:'check-run:7:unit',attemptId:'1',command:'node --test',execution:{exitCode:1,signal:null,output},paths:output.includes('src/a.mjs')?['src/a.mjs']:[],logRefs:['ci://unit'],reruns:[]}],baseReproductions:[],retryReports:[]}
}
function classifier(ci,evidence){return classifyFailureScope(ci,evidence,{git:(_root,args)=>args[0]==='rev-parse'?HEAD:args[0]==='merge-base'&&args.length===3?BASE:args[0]==='diff'?'src/a.mjs\0':'',gateInputKeyOf:()=>INPUT,loadConfig:()=>({ciPolicy:{ownership:[]}})})}
function correctionCheckpoint(owner='ARC'){
 return {arcId:owner,verdict:'GAPS',at:AT,headSha:HEAD,note:'CI repair',correction:{state:'awaiting-repair',validationHead:HEAD,gateInputKey:INPUT,round:0,bounds:{maxRounds:2,deadlineAt:LATER,allowedPathPrefixes:['src'],authority:{source:'config',reference:'mergePolicy.gapsCorrection=autonomous'}},route:null}}
}
function realResume({state=durableState(),requestedArcId=state.arcId,arc={id:requestedArcId,acceptanceCriteria:[{id:'member-ac'}]},policy={remote:'origin',strategy:{}},observation=redObservation(),latest=observation,evidence=packet(),phases=[{phase:42,arcId:state.arcId,keyFiles:['src'],tasks:[]}],loadArc}={}){
 const order=[],box={state},checkpoint=correctionCheckpoint(state.arcId)
 const deps={clock:()=>AT,git:()=>HEAD,load:()=>box.state,loadCheckpoint:()=>null,monitor:()=>({status:'red',delivery:box.state,source:'provider',observation}),collect:()=>({status:'collected',evidence}),lookupCi:()=>latest,classify:classifier,loadPhases:()=>phases,loadArc,initialize:()=>{order.push('checkpoint-initialized');return checkpoint},persistCheckpoint:(_root,_id,_expected,next)=>{order.push('checkpoint-persisted');return next},transition:(_root,_id,event)=>{order.push('delivery-bound');box.state=reduceDelivery(box.state,event);return box.state}}
 const request={root:'/repo',requestedArcId,ownerArcId:state.arcId,state:box.state,arc,config:{mergePolicy:{gapsCorrection:'autonomous'},ciPolicy:{}},policy,provider:{},ciProvider:{}}
 return {order,box,deps,request}
}

test('red CI uses real classification and routing, persists checkpoint before binding, then hands off the same correction',()=>{
 const f=realResume(),out=resumePublishedDelivery(f.request,f.deps)
 assert.equal(out.status,'held');assert.equal(out.handoff.action,'run-correction')
 assert.deepEqual(out.handoff.paths,['src/a.mjs']);assert.equal(out.handoff.round,1)
 assert.deepEqual(f.order,['checkpoint-initialized','checkpoint-persisted','delivery-bound'])
 assert.equal(f.box.state.correctionBinding.route.selected[0].attemptId,'1')
 assert.equal(f.box.state.correctionBinding.route.trace.phaseId,42)
})

test('a newer CI attempt after log collection holds before checkpoint or delivery mutation',()=>{
 const f=realResume({latest:redObservation('2')}),before=structuredClone(f.box.state)
 const out=resumePublishedDelivery(f.request,f.deps)
 assert.equal(out.status,'held');assert.match(out.reason,/attempts changed/i)
 assert.deepEqual(f.order,[]);assert.deepEqual(f.box.state,before)
})

test('unknown or infrastructure evidence has no eligible edit and performs zero durable mutation',()=>{
 for(const output of ['', 'HTTP 429 rate limit']){
  const evidence=packet(output);if(!output)evidence.failures[0].logRefs=[]
  const f=realResume({evidence}),before=structuredClone(f.box.state)
  const out=resumePublishedDelivery(f.request,f.deps)
  assert.equal(out.handoff.action,'inspect-ci-failures')
  assert.deepEqual(f.order,[]);assert.deepEqual(f.box.state,before)
 }
})

test('a grouped member routes against the delivery owner phase and owner acceptance criteria',()=>{
 const state=durableState({owner:'OWNER',strategy:{kind:'grouped',groupId:'group',order:0}})
 const policy={remote:'origin',strategy:{OWNER:{kind:'grouped',groupId:'group',order:0},MEMBER:{kind:'grouped',groupId:'group',order:1}}}
 const phases=[{phase:77,arcId:'OWNER',keyFiles:['src'],tasks:[]}],loads=[]
 const f=realResume({state,requestedArcId:'MEMBER',arc:{id:'MEMBER',acceptanceCriteria:[{id:'member-ac'}]},policy,phases,loadArc:(_root,id)=>{loads.push(id);return {id:'OWNER',acceptanceCriteria:[{id:'owner-ac'}]}}})
 const out=resumePublishedDelivery(f.request,f.deps)
 assert.equal(out.handoff.action,'run-correction');assert.deepEqual(loads,['OWNER'])
 assert.deepEqual(f.box.state.correctionBinding.route.trace,{phaseId:77,criterionIds:['owner-ac']})
})


test('an explicit eligible correction phase resolves ambiguous ownership as a planned route',()=>{
 const phases=[
  {phase:42,status:'done',arcId:'ARC',keyFiles:['src'],tasks:[{id:'42.1',done:true,files:['src/a.mjs']}]},
  {phase:43,status:'backlog',arcId:'ARC',reviewRecord:{verdict:'READY'},keyFiles:['src'],tasks:[{id:'43.1',done:false,files:['src/a.mjs']}]},
 ]
 const f=realResume({phases});f.request.correctionPhase=43
 const out=resumePublishedDelivery(f.request,f.deps)
 assert.equal(out.handoff.action,'run-correction');assert.equal(out.handoff.phase,43)
 assert.equal(f.box.state.correctionBinding.route.kind,'planned-correction')
 assert.deepEqual(f.box.state.correctionBinding.route.plannedCorrection,{correctionId:'phase-43',phaseId:43,criterionIds:['member-ac']})
 assert.equal(f.box.state.correctionBinding.route.trace,null)
 assert.deepEqual(f.order,['checkpoint-initialized','checkpoint-persisted','delivery-bound'])
})

test('absent, unready or foreign correction selectors cannot mutate an ambiguous route',()=>{
 const base=[
  {phase:42,status:'done',arcId:'ARC',keyFiles:['src'],tasks:[{id:'42.1',done:true,files:['src/a.mjs']}]},
  {phase:43,status:'in-progress',arcId:'ARC',keyFiles:['src'],tasks:[{id:'43.1',done:false,files:['src/a.mjs']}]},
 ]
 for(const [selector,phases] of [[null,base],[44,[...base,{phase:44,status:'backlog',arcId:'ARC',keyFiles:['src'],tasks:[{id:'44.1',done:false,files:['src/a.mjs']}]}]],[45,[...base,{phase:45,status:'in-progress',arcId:'FOREIGN',keyFiles:['src'],tasks:[{id:'45.1',done:false,files:['src/a.mjs']}]}]],[46,[...base,{phase:46,status:'in-progress',arcId:'ARC',keyFiles:['other'],tasks:[{id:'46.1',done:false,files:['other/x']}]}]]]){
  const f=realResume({phases});if(selector!==null)f.request.correctionPhase=selector
  const out=resumePublishedDelivery(f.request,f.deps)
  assert.notEqual(out.handoff?.action,'run-correction',String(selector))
  assert.deepEqual(f.order,[],String(selector));assert.equal(f.box.state.correctionBinding,undefined)
 }
})
test('correction ownership reads only member arc phases, ignoring malformed unrelated phase files',async()=>{
 const {makeFixtureRepo,writeArcFile,writePhaseRaw}=await import('../../test/fixture-consumer/harness.mjs')
 const {loadCorrectionPhases}=await import('./deliver.mjs')
 const root=makeFixtureRepo({layout:'docs'})
 const phase={phase:43,name:'Correction ownership fixture',plannedBy:{model:'fixture'},status:'backlog',category:'test',kind:'hardening',arcId:'NATIVEGREEN',source:'Fixture ownership validation',priority:'HIGH',dependsOn:[],conflictsWith:[],keyFiles:['src/a.mjs'],stakeholderDemo:'Only member phases can own a correction.',tasks:[]}
 writeArcFile(root,{id:'NATIVEGREEN',name:'Bounded ownership fixture',baseRef:'main',planes:[{name:'build',phases:[43]}]})
 writePhaseRaw(root,43,'export default '+JSON.stringify(phase)+'\n')
 writePhaseRaw(root,999,'this unrelated phase is deliberately not valid TypeScript')
 assert.deepEqual(loadCorrectionPhases(root,['NATIVEGREEN']).map(phase=>phase.phase),[43])
})


test('42.7 resume uses the delivery owner arc polling and timeout policy',()=>{
 const f=fixture(),calls=[]
 f.request.config={ciPolicy:{provider:'github',requiredChecks:['unit'],pollIntervalMs:5000,timeoutMs:120000,correctionTimeoutMs:600000,maxRounds:2,headMode:'source-only',ownership:[],reproductionCommands:{},arcs:{ARC:{pollIntervalMs:10000,timeoutMs:60000,correctionTimeoutMs:300000,maxRounds:1}}}}
 f.deps.monitor=request=>{calls.push(request);return {status:'pending',delivery:f.state,observation:null}}
 const out=resumePublishedDelivery(f.request,f.deps)
 assert.equal(out.status,'awaiting-ci')
 assert.equal(calls.length,1)
 assert.equal(calls[0].pollIntervalMs,10000)
 assert.equal(calls[0].deadlineMs,Date.parse(AT)+60000)
})

test('42.7 a fresh correction checkpoint inherits the owner arc round and deadline ceiling',()=>{
 const f=realResume(),seen=[]
 f.request.config={mergePolicy:{gapsCorrection:'autonomous'},ciPolicy:{provider:'github',requiredChecks:['unit'],pollIntervalMs:5000,timeoutMs:120000,correctionTimeoutMs:600000,maxRounds:2,headMode:'source-only',ownership:[],reproductionCommands:{},arcs:{ARC:{pollIntervalMs:10000,timeoutMs:60000,correctionTimeoutMs:300000,maxRounds:1}}}}
 f.deps.initialize=(_root,_arc,input)=>{
  seen.push(structuredClone(input))
  const value=correctionCheckpoint()
  value.correction.bounds.maxRounds=input.bounds.maxRounds
  value.correction.bounds.deadlineAt=input.bounds.deadlineAt
  return value
 }
 const out=resumePublishedDelivery(f.request,f.deps)
 assert.equal(out.handoff?.action,'run-correction',out.reason)
 assert.equal(seen.length,1)
 assert.equal(seen[0].bounds.maxRounds,1)
 assert.equal(seen[0].bounds.deadlineAt,new Date(Date.parse(AT)+300000).toISOString())
})


test('42.7 fresh correction authority is the sorted unique union of every typed member phase file',()=>{
 const phases=[
  {phase:42,status:'done',arcId:'ARC',keyFiles:['src','shared'],tasks:[{id:'42.1',done:true,files:['src/a.mjs','shared']}]},
  {phase:43,status:'done',arcId:'ARC',keyFiles:['tools/z'],tasks:[{id:'43.1',done:true,files:['src/b.mjs','tools/z']}]},
 ]
 const f=realResume({phases}),seen=[]
 f.deps.initialize=(_root,_arc,input)=>{seen.push(structuredClone(input));const value=correctionCheckpoint();value.correction.bounds=input.bounds;return value}
 const out=resumePublishedDelivery(f.request,f.deps)
 assert.equal(out.handoff?.action,'run-correction',out.reason)
 assert.equal(seen.length,1)
 assert.deepEqual(seen[0].bounds.allowedPathPrefixes,['shared','src','src/a.mjs','src/b.mjs','tools/z'])
})


test('42.7 normalization before-CAS guard accepts live authority and rejects its exact deadline',()=>{
 const make=clock=>{
  const f=fixture()
  f.state.target.headRef='refs/heads/roadmap/arc'
  f.state.correctionBinding={bounds:{deadlineAt:LATER}}
  return deliveryNormalizationDeps({...f.request,state:f.state,deadlineMs:Date.parse(LATER)+1000,ciProvider:{}},{clock,git:()=>{throw Error('beforeCas must not perform Git I/O')}})
 }
 assert.doesNotThrow(()=>make(()=>AT).beforeCas())
 assert.throws(()=>make(()=>LATER).beforeCas(),/deadline|exhausted/i)
})
