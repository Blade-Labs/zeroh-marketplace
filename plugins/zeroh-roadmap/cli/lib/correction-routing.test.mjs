import {test} from 'node:test'
import assert from 'node:assert/strict'
import {decideCorrectionRoute,reduceDelivery,deliveryKeyOf} from './delivery.mjs'
const HEAD='1'.repeat(40),BASE='0'.repeat(40),OTHER='2'.repeat(40),INPUT='a'.repeat(64),SIG='b'.repeat(64),AT='2026-09-08T02:00:00.000Z',LATER='2026-09-08T03:00:00.000Z'
const failure=(over={})=>({checkKey:'check-run:7:unit',attemptId:'1',kind:'causal',editEligible:true,paths:['src/a.mjs'],signature:SIG,diagnostic:{category:'product',summary:'unit failed',nextStep:'repair',signature:SIG},...over})
const decision=()=>({status:'classified',headSha:HEAD,gateInputKey:INPUT,failures:[failure()],editPaths:['src/a.mjs'],retryDecision:{blocked:false,failures:[]}})
const checkpoint=()=>({arcId:'ARC',verdict:'GAPS',at:AT,note:'CI repair',correction:{state:'awaiting-repair',validationHead:HEAD,gateInputKey:INPUT,round:0,bounds:{maxRounds:2,deadlineAt:LATER,allowedPathPrefixes:['src'],authority:{source:'session',reference:'owner-approved-arc'}},route:null}})
const policy=()=>({at:AT,sourceHeadSha:HEAD,predecessorHeadSha:BASE,authority:{source:'session',reference:'owner-approved-arc'},stop:false,needsPlanning:false,smallRepair:{phaseId:42,criterionIds:['42.4-ac1']},plannedCorrection:null})
function receipt(){const target={targetKey:'target',providerId:'github',repositoryId:'blade/repo',baseRef:'main',headRef:'feat/arc',currentBaseSha:BASE,currentHeadSha:HEAD};return {schemaVersion:1,revision:0,arcId:'ARC',deliveryKey:deliveryKeyOf(target),target,strategy:{kind:'independent',arcId:'ARC'},requested:{terminal:'open',allowedPushRefs:['feat/arc'],requiredCapabilities:['pull-request'],requiredChecks:['unit'],authority:{queue:null,merge:null}},actions:[],pullRequest:null,checks:null,terminal:{status:'awaiting-ci',headSha:HEAD,reason:null},createdAt:AT,updatedAt:AT}}
const input=()=>({failureDecisions:decision(),validationCheckpoint:checkpoint(),policy:policy(),delivery:receipt()})
function bindingEvent(out,state=receipt()){return {type:'record-correction-binding',deliveryKey:state.deliveryKey,targetKey:state.target.targetKey,expectedRevision:state.revision,at:AT,checkpoint:out.routedCheckpoint,binding:out.deliveryBinding}}
test('small repair preserves phase and criterion identity and consumes one shared round',()=>{
 const arg=input(),out=decideCorrectionRoute(arg)
 assert.equal(out.status,'routed');assert.equal(out.routedCheckpoint.correction.round,1)
 assert.deepEqual(out.routedCheckpoint.correction.bounds,arg.validationCheckpoint.correction.bounds)
 assert.equal(out.routedCheckpoint.correction.route.kind,'small-repair')
 assert.deepEqual(out.routedCheckpoint.correction.route.trace,arg.policy.smallRepair)
 assert.equal(out.routedCheckpoint.correction.route.plannedCorrection,null)
 assert.deepEqual(out.editPaths,['src/a.mjs']);assert.deepEqual(out.deliveryBinding.route.selected.map(f=>f.signature),[SIG]);assert.deepEqual(arg.validationCheckpoint,checkpoint())
})
test('mixed failures route only eligible members and retain residual evidence',()=>{
 const arg=input(),unrelated=failure({checkKey:'check-run:7:other',attemptId:'2',kind:'unrelated',editEligible:false,paths:['other/x'],signature:'c'.repeat(64)})
 arg.failureDecisions.failures.push(unrelated)
 const out=decideCorrectionRoute(arg),next=reduceDelivery(arg.delivery,bindingEvent(out))
 assert.equal(out.status,'routed');assert.deepEqual(out.editPaths,['src/a.mjs']);assert.deepEqual(out.residualFailures,[unrelated]);assert.deepEqual(out.editableFailures,[failure()]);assert.deepEqual(next.correctionBinding.route.residual.map(f=>f.signature),['c'.repeat(64)]);assert.equal(next.terminal.status,'held')
})
test('planned correction uses the same checkpoint, scope and round limit',()=>{
 const arg=input();arg.policy.needsPlanning=true;arg.policy.smallRepair=null;arg.policy.plannedCorrection={correctionId:'CORR-1',phaseId:43,criterionIds:['43.1-ac2']}
 const out=decideCorrectionRoute(arg)
 assert.equal(out.status,'routed');assert.equal(out.routedCheckpoint.correction.round,1);assert.deepEqual(out.routedCheckpoint.correction.bounds,arg.validationCheckpoint.correction.bounds);assert.equal(out.deliveryBinding.route.kind,'planned-correction');assert.equal(out.deliveryBinding.route.plannedCorrection.correctionId,'CORR-1')
 arg.validationCheckpoint=structuredClone(out.routedCheckpoint);arg.validationCheckpoint.correction.route=null;arg.validationCheckpoint.correction.round=2
 assert.equal(decideCorrectionRoute(arg).status,'held')
})
test('unknown usage, exhausted bounds, repeats, unauthorized scope and stale identity hold without resetting',()=>{
 const cases=[a=>a.validationCheckpoint.correction.round=2,a=>a.validationCheckpoint.correction.bounds.deadlineAt=AT,a=>a.failureDecisions.retryDecision.blocked=true,a=>a.failureDecisions.editPaths.push('other/x'),a=>a.policy.smallRepair=null,a=>a.policy.authority=null,a=>a.policy.stop=true,a=>a.policy.sourceHeadSha=OTHER,a=>a.failureDecisions.gateInputKey='d'.repeat(64),a=>delete a.validationCheckpoint.correction.bounds,a=>a.validationCheckpoint.correction.state='needs-sweep',a=>a.failureDecisions.failures[0].kind='indeterminate']
 for(const change of cases){const arg=input();change(arg);const before=structuredClone(arg.validationCheckpoint),out=decideCorrectionRoute(arg);assert.equal(out.status,'held',JSON.stringify(arg));assert.deepEqual(out.editPaths,[]);assert.deepEqual(out.routedCheckpoint,before)}
})
test('binding is exact, revision protected, and byte-equivalent replay is idempotent',()=>{
 const arg=input(),out=decideCorrectionRoute(arg),event=bindingEvent(out),next=reduceDelivery(arg.delivery,event)
 assert.equal(next.revision,1);assert.deepEqual(next.correctionBinding,out.deliveryBinding);assert.deepEqual(reduceDelivery(next,event),next)
 for(const mutate of [e=>e.binding.route.scopePaths.push('other/x'),e=>e.binding.route.sourceHeadSha=OTHER,e=>e.binding.route.selected[0].signature='c'.repeat(64),e=>e.checkpoint.correction.route.sourceHeadSha=OTHER,e=>e.expectedRevision=7]){const bad=structuredClone(event);mutate(bad);assert.throws(()=>reduceDelivery(arg.delivery,bad))}
})
test('checkpoint-ahead recovery binds the existing route without consuming another round',()=>{
 const arg=input(),first=decideCorrectionRoute(arg);arg.validationCheckpoint=first.routedCheckpoint
 const resumed=decideCorrectionRoute(arg)
 assert.equal(resumed.status,'routed');assert.deepEqual(resumed.routedCheckpoint,first.routedCheckpoint);assert.deepEqual(resumed.deliveryBinding,first.deliveryBinding)
 const next=reduceDelivery(arg.delivery,bindingEvent(resumed));assert.equal(next.revision,1)
 const changed={...arg.delivery,target:{...arg.delivery.target,currentHeadSha:OTHER}}
 assert.throws(()=>reduceDelivery(changed,bindingEvent(resumed)),/head|binding|stale/)
})
test('a delivery binding prevents checkpoint reset or growth on resume',()=>{
 const arg=input(),out=decideCorrectionRoute(arg);arg.delivery=reduceDelivery(arg.delivery,bindingEvent(out))
 for(const mutate of [a=>a.validationCheckpoint=checkpoint(),a=>{a.validationCheckpoint=structuredClone(out.routedCheckpoint);a.validationCheckpoint.correction.bounds.deadlineAt='2026-09-09T03:00:00.000Z'},a=>{a.validationCheckpoint=structuredClone(out.routedCheckpoint);a.validationCheckpoint.correction.route.selected[0].attemptId='forged'}]){const bad=structuredClone(arg);mutate(bad);assert.equal(decideCorrectionRoute(bad).status,'held')}
})

test('a matching but out-of-authority checkpoint cannot authorize reducer edits',()=>{
 const arg=input(),out=decideCorrectionRoute(arg),event=bindingEvent(out)
 event.checkpoint.correction.route.scopePaths.push('other/x');event.binding.route.scopePaths.push('other/x')
 assert.throws(()=>reduceDelivery(arg.delivery,event),/scope|authority|bound/)
})

import {mkdtempSync,mkdirSync,cpSync,writeFileSync,readFileSync,symlinkSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,dirname} from 'node:path'
import {persistArcDelivery,loadArcDelivery,persistCorrectionCheckpoint,transitionArcDelivery} from './delivery.mjs'
test('real checkpoint publication precedes delivery binding and a crash resumes without resetting',()=>{
 const root=mkdtempSync(join(tmpdir(),'zr-correction-'))
 try{
  const schema=join(root,'docs/roadmap/lib/schema.ts');mkdirSync(dirname(schema),{recursive:true});cpSync(new URL('../../../../docs/roadmap/lib/schema.ts',import.meta.url),schema)
  writeFileSync(join(root,'docs/roadmap/roadmap.config.json'),JSON.stringify({configVersion:1}));symlinkSync(new URL('../../node_modules',import.meta.url),join(root,'node_modules'),'dir')
  const initial=receipt();initial.terminal.status='preparing';persistArcDelivery(root,null,initial)
  const arg=input();arg.delivery=initial;const out=decideCorrectionRoute(arg),event=bindingEvent(out,initial)
  const path=join(root,'docs/roadmap/.gate/arc-ARC/validate.json');mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(arg.validationCheckpoint))
  assert.throws(()=>transitionArcDelivery(root,'ARC',event),/persisted/)
  const originalBytes=readFileSync(path,'utf8')
  assert.throws(()=>persistCorrectionCheckpoint(root,'ARC',arg.validationCheckpoint,out.routedCheckpoint,{clock:()=>LATER}),/deadline|expired/i)
  assert.equal(readFileSync(path,'utf8'),originalBytes)
  persistCorrectionCheckpoint(root,'ARC',arg.validationCheckpoint,out.routedCheckpoint,{clock:()=>AT})
  assert.deepEqual(persistCorrectionCheckpoint(root,'ARC',out.routedCheckpoint,out.routedCheckpoint,{clock:()=>LATER}),out.routedCheckpoint)
  assert.equal(loadArcDelivery(root,'ARC').correctionBinding,undefined)
  const resumed=decideCorrectionRoute({...arg,validationCheckpoint:JSON.parse(readFileSync(path,'utf8'))});assert.deepEqual(resumed.routedCheckpoint,out.routedCheckpoint)
  const saved=transitionArcDelivery(root,'ARC',bindingEvent(resumed,initial));assert.deepEqual(saved.correctionBinding,out.deliveryBinding)
  assert.deepEqual(transitionArcDelivery(root,'ARC',event),saved)
  assert.throws(()=>persistCorrectionCheckpoint(root,'ARC',out.routedCheckpoint,arg.validationCheckpoint),/reset|grow|usage/)
 }finally{rmSync(root,{recursive:true,force:true})}
})

import {publishCorrection} from './delivery.mjs'
function correctionPublisher(){
 const arg=input(),routed=decideCorrectionRoute(arg);let state=reduceDelivery(arg.delivery,bindingEvent(routed))
 const pr={providerId:'github',repositoryId:'blade/repo',targetKey:'target',providerPullRequestId:'PR_7',number:7,url:'https://github.test/blade/repo/pull/7',state:'open',draft:false,baseRef:'main',headRef:'feat/arc',baseSha:BASE,headSha:HEAD,observedAt:AT}
 state.pullRequest=structuredClone(pr);state.checks={providerId:'github',repositoryId:'blade/repo',providerPullRequestId:'PR_7',headSha:HEAD,requiredChecks:['unit'],observedChecks:[{name:'unit',status:'red',attemptId:'1',observedAt:AT}],observedAt:AT}
 let remote=HEAD,pushes=0,creates=0
 const provider={preflight:({operation})=>({status:'ready',providerId:'github',repositoryId:'blade/repo',operation}),push(request){remote=request.action.requested.headSha;pushes++;return {status:'succeeded',actionKey:request.action.actionKey,providerActionId:remote}},lookup(){return {...pr,headSha:remote}},create(){creates++;throw Error('replacement PR forbidden')}}
 const request={root:'/repo',arcId:'ARC',provider,repair:{sourceHeadSha:HEAD,headSha:OTHER,correctionBinding:structuredClone(state.correctionBinding)}}
 const deps={loadCheckpoint:()=>({arcId:'ARC',verdict:'PASS',correction:{state:'validated',...state.correctionBinding,repairHead:request.repair.repairHeadSha??request.repair.headSha,readyAt:AT}}),readReview:()=>({arcId:'ARC',phase:42,round:state.correctionBinding.round,sourceHeadSha:state.correctionBinding.validationHead,repairHead:request.repair.repairHeadSha??request.repair.headSha}),load:()=>state,transition:(_r,_a,e)=>{state=reduceDelivery(state,e);return state},withLock:(_key,fn)=>fn(),clock:()=>AT,git:(_root,args)=>{
  if(args[0]==='rev-parse')return OTHER
  if(args[0]==='diff')return 'src/a.mjs\0'
  if(args[0]==='status')return ''
  if(args[0]==='merge-base')return HEAD
  throw Error('unhandled Git '+args.join(' '))
 },normalize:()=>({status:'retained-corrections',correctionCount:1,newHead:OTHER})}
 return {request,deps,get state(){return state},get pushes(){return pushes},get creates(){return creates}}
}
test('retained one/two fixes use the existing PR and invalidate previous check evidence',()=>{
 for(const count of [1,2]){
  const f=correctionPublisher();f.deps.normalize=()=>({status:'retained-corrections',correctionCount:count,newHead:OTHER})
  const out=publishCorrection(f.request,f.deps)
  assert.equal(out.status,'published',out.reason);assert.equal(out.pullRequest.providerPullRequestId,'PR_7');assert.equal(out.delivery.target.currentHeadSha,OTHER);assert.equal(out.delivery.checks,null);assert.equal(out.delivery.terminal.status,'awaiting-ci');assert.equal(f.pushes,1);assert.equal(f.creates,0)
  assert.equal(publishCorrection(f.request,f.deps).status,'published');assert.equal(f.pushes,1)
 }
})
test('unbound repair, stale revision, unowned edits and unnormalized third fixes never push',()=>{
 const mutations=[f=>f.request.repair.correctionBinding.round=2,f=>f.request.expected={revision:99,currentBaseSha:BASE,currentHeadSha:HEAD},f=>f.deps.git=(_r,args)=>args[0]==='rev-parse'?OTHER:args[0]==='diff'?'other/x\0':args[0]==='merge-base'?HEAD:'',f=>f.deps.normalize=()=>({status:'retained-corrections',correctionCount:3,newHead:OTHER}),f=>f.deps.normalize=()=>({status:'planned',newHead:OTHER})]
 for(const mutate of mutations){const f=correctionPublisher();mutate(f);const out=publishCorrection(f.request,f.deps);assert.equal(out.status,'held');assert.equal(f.pushes,0);assert.equal(f.creates,0)}
})
test('rewritten correction head uses only the shared verified receipt and refuses green history',()=>{
 const f=correctionPublisher(),digest='e'.repeat(64)
 f.request.normalizationReceipt={planDigest:digest};f.deps.loadNormalizationReceipt=()=>({kind:'published-corrections',arcId:'ARC',publishedRef:'feat/arc',expectedOld:HEAD,oldHead:OTHER,newHead:OTHER,planDigest:digest})
 f.deps.git=(_r,args)=>args[0]==='rev-parse'?OTHER:args[0]==='diff'?'src/a.mjs\0':args[0]==='merge-base'?BASE:''
 let supplied;const push=f.request.provider.push;f.request.provider.push=r=>{supplied=r.expected.normalizationReceipt;return push(r)}
 const out=publishCorrection(f.request,f.deps);assert.equal(out.status,'published',out.reason);assert.deepEqual(supplied,{planDigest:digest});assert.equal(f.creates,0)
 for(const mutate of [g=>g.state.checks.observedChecks[0].status='green',g=>g.deps.loadNormalizationReceipt=()=>{throw Error('unverified')},g=>g.deps.loadNormalizationReceipt=()=>({kind:'published-corrections',arcId:'ARC',publishedRef:'other',expectedOld:HEAD,newHead:OTHER})]){
  const g=correctionPublisher();g.request.normalizationReceipt={planDigest:digest};mutate(g);assert.equal(publishCorrection(g.request,g.deps).status,'held');assert.equal(g.pushes,0)
 }
})
import {execFileSync} from 'node:child_process'
test('real Git diff prevents a claimed repair from publishing an unowned edit',()=>{
 const root=mkdtempSync(join(tmpdir(),'zr-correction-git-'))
 try{
  const git=args=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
  git(['init','-q']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.test']);mkdirSync(join(root,'src'));writeFileSync(join(root,'src/a.mjs'),'one\n');writeFileSync(join(root,'other.txt'),'unowned\n');git(['add','.']);git(['commit','-qm','base']);const source=git(['rev-parse','HEAD'])
  writeFileSync(join(root,'src/a.mjs'),'two\n');writeFileSync(join(root,'other.txt'),'changed outside scope\n');git(['add','.']);git(['commit','-qm','repair']);const head=git(['rev-parse','HEAD'])
  const f=correctionPublisher();f.request.root=root;f.state.target.currentHeadSha=source;f.state.pullRequest.headSha=source;f.state.checks.headSha=source
  f.state.correctionBinding.validationHead=source;f.state.correctionBinding.route.sourceHeadSha=source
  f.request.repair={sourceHeadSha:source,headSha:head,correctionBinding:structuredClone(f.state.correctionBinding)};delete f.deps.git
  const out=publishCorrection(f.request,f.deps);assert.equal(out.status,'held');assert.match(out.reason,/scope/);assert.equal(f.pushes,0)
 }finally{rmSync(root,{recursive:true,force:true})}
})


import {evidenceCoversHead} from './delivery-evaluation.mjs'
import {validSweep,validVerdicts} from '../testdata/eval.test-support.mjs'
test('canonical sweep and verdict evidence after the authorized repair do not widen its publish scope',()=>{
 const root=mkdtempSync(join(tmpdir(),'zr-correction-evidence-tail-'))
 try{
  const git=args=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
  const schema=join(root,'docs/roadmap/lib/schema.ts');mkdirSync(dirname(schema),{recursive:true});cpSync(new URL('../../../../docs/roadmap/lib/schema.ts',import.meta.url),schema)
  writeFileSync(join(root,'docs/roadmap/roadmap.config.json'),JSON.stringify({configVersion:1}))
  symlinkSync(new URL('../../node_modules',import.meta.url),join(root,'node_modules'),'dir')
  mkdirSync(join(root,'src'));writeFileSync(join(root,'src/a.mjs'),'one\n')
  git(['init','-q']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.test']);git(['add','.']);git(['commit','-qm','base']);const source=git(['rev-parse','HEAD'])
  writeFileSync(join(root,'src/a.mjs'),'two\n');git(['add','.']);git(['commit','-qm','fix: authorized repair']);const repair=git(['rev-parse','HEAD'])
  const evidenceDir=join(root,'docs/roadmap/arc-evals');mkdirSync(evidenceDir,{recursive:true})
  writeFileSync(join(evidenceDir,'ARC-2026-09-08-sweep.json'),JSON.stringify({...validSweep,arcId:'ARC',date:'2026-09-08',observation:{headSha:repair,recordedAt:AT}}));git(['add','.']);git(['commit','-qm','docs: record correction sweep'])
  writeFileSync(join(evidenceDir,'ARC-2026-09-08-verdicts.json'),JSON.stringify({...validVerdicts,arcId:'ARC',date:'2026-09-08',observation:{headSha:repair,recordedAt:AT}}));git(['add','.']);git(['commit','-qm','docs: record correction verdicts']);const finalHead=git(['rev-parse','HEAD'])
  assert.equal(evidenceCoversHead(root,repair,finalHead,{arcId:'ARC'}),true)
  const f=correctionPublisher();f.request.root=root;f.state.target.currentHeadSha=source;f.state.pullRequest.headSha=source;f.state.checks.headSha=source
  f.state.correctionBinding.validationHead=source;f.state.correctionBinding.route.sourceHeadSha=source
  f.request.repair={sourceHeadSha:source,headSha:finalHead,repairHeadSha:repair,correctionBinding:structuredClone(f.state.correctionBinding)}
  f.deps.normalize=()=>({status:'retained-corrections',correctionCount:1,newHead:finalHead});delete f.deps.git
  f.deps.loadCheckpoint=()=>({arcId:'ARC',verdict:'PASS',correction:{state:'validated',...f.state.correctionBinding,repairHead:repair,readyAt:AT}})
  f.deps.readReview=()=>({arcId:'ARC',phase:42,round:1,sourceHeadSha:source,repairHead:repair})
  const out=publishCorrection(f.request,f.deps)
  assert.equal(out.status,'published',out.reason);assert.equal(out.delivery.target.currentHeadSha,finalHead);assert.equal(f.pushes,1)
  writeFileSync(join(root,'unknown.txt'),'not recorder evidence\n');git(['add','.']);git(['commit','-qm','unknown post-repair file'])
  const unknownHead=git(['rev-parse','HEAD']),g=correctionPublisher();g.request.root=root;g.state.target.currentHeadSha=source;g.state.pullRequest.headSha=source;g.state.checks.headSha=source;g.state.correctionBinding.validationHead=source;g.state.correctionBinding.route.sourceHeadSha=source
  g.request.repair={sourceHeadSha:source,headSha:unknownHead,repairHeadSha:repair,correctionBinding:structuredClone(g.state.correctionBinding)};g.deps.normalize=()=>({status:'retained-corrections',correctionCount:1,newHead:unknownHead});delete g.deps.git
  assert.equal(publishCorrection(g.request,g.deps).status,'held');assert.equal(g.pushes,0)
 }finally{rmSync(root,{recursive:true,force:true})}
})
test('an all-in-scope correction still cannot publish without current reviewed PASS authority',()=>{
 const f=correctionPublisher();f.deps.loadCheckpoint=()=>null
 const out=publishCorrection(f.request,f.deps)
 assert.equal(out.status,'held');assert.equal(f.pushes,0)
})


test('42.7 an expired correction reconciles a durably succeeded push after a crash before head advance',()=>{
 const f=correctionPublisher()
 f.deps.checkpoint=label=>{if(label==='before-head-advance')throw Error('interrupt before head advance')}
 const interrupted=publishCorrection(f.request,f.deps)
 assert.equal(interrupted.status,'held')
 assert.equal(f.pushes,1)
 assert.equal(f.state.target.currentHeadSha,HEAD)
 assert.ok(f.state.actions.some(action=>action.kind==='push'&&action.status==='succeeded'&&action.requested.headSha===OTHER))
 f.deps.checkpoint=()=>{}
 f.deps.clock=()=>LATER
 const resumed=publishCorrection(f.request,f.deps)
 assert.equal(resumed.status,'published',resumed.reason)
 assert.equal(resumed.pullRequest.providerPullRequestId,'PR_7')
 assert.equal(resumed.delivery.target.currentHeadSha,OTHER)
 assert.equal(f.pushes,1)
})
