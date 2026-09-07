import { test } from 'node:test'
import assert from 'node:assert/strict'
import { publishDelivery, reduceDelivery, deliveryKeyOf } from './delivery.mjs'
const BASE='0'.repeat(40),OLD='1'.repeat(40),HEAD='2'.repeat(40),AT='2026-09-07T00:00:00.000Z'
const target={targetKey:JSON.stringify(['arc','A']),providerId:'github',repositoryId:'blade/roadmap',baseRef:'refs/heads/main',headRef:'refs/heads/roadmap/arc-a',currentBaseSha:BASE,currentHeadSha:OLD}
const initial=()=>({schemaVersion:1,revision:0,arcId:'A',deliveryKey:deliveryKeyOf(target),target:structuredClone(target),strategy:{kind:'independent',arcId:'A'},requested:{terminal:'open',allowedPushRefs:[target.headRef],requiredCapabilities:['pull-request'],requiredChecks:['unit'],authority:{queue:null,merge:null}},actions:[],pullRequest:null,checks:null,terminal:{status:'preparing',headSha:OLD,reason:null},createdAt:AT,updatedAt:AT})
const prOf=()=>({providerId:'github',repositoryId:'blade/roadmap',targetKey:target.targetKey,providerPullRequestId:'PR_7',number:7,url:'https://github.test/blade/roadmap/pull/7',state:'open',draft:false,baseRef:target.baseRef,headRef:target.headRef,baseSha:BASE,headSha:HEAD,observedAt:AT})
function scenario({faultAt=null}={}){
 let state=initial(),remoteHead=null,pullRequest=null,checkpointCount=0,faulted=false
 const calls=[],mutations={push:0,create:0,update:0},checkpoints=[]
 const assertIntent=action=>{const durable=state.actions.find(row=>row.actionKey===action.actionKey);assert.ok(durable);assert.equal(durable.status,'unknown');assert.equal(durable.attempts.at(-1).finishedAt,null);assert.equal(durable.attempts.at(-1).observed,null)}
 const capabilities={providerId:'github',supported:['lookup','push','create','update','pull-request'],unsupported:[]}
 const result=(request,id,pr=null)=>({status:'succeeded',actionKey:request.action.actionKey,providerActionId:id,errorKind:null,observedAt:AT,pullRequest:pr})
 const provider={capabilities:()=>capabilities,preflight:({operation})=>({status:'ready',providerId:'github',repositoryId:'blade/roadmap',operation,capabilities,observedAt:AT}),lookup(request){calls.push(['lookup',request]);return pullRequest},push(request){calls.push(['push',request]);assertIntent(request.action);if(remoteHead!==request.action.requested.headSha){remoteHead=request.action.requested.headSha;mutations.push++}return result(request,remoteHead)},create(request){calls.push(['create',request]);assertIntent(request.action);if(!pullRequest){pullRequest=prOf();mutations.create++}return result(request,pullRequest.providerPullRequestId,pullRequest)},update(request){calls.push(['update',request]);assertIntent(request.action);mutations.update++;return result(request,pullRequest.providerPullRequestId,pullRequest)},queue(){throw Error('outside publication')},merge(){throw Error('outside publication')}}
 const deps={load:()=>state,transition:(_root,_arc,event)=>{state=reduceDelivery(state,event);return state},withLock:(_key,fn)=>fn(),clock:()=>AT,checkpoint(label,snapshot){checkpointCount++;checkpoints.push({label,snapshot:structuredClone(snapshot)});if(!faulted&&faultAt===checkpointCount){faulted=true;throw Error(`interrupt:${label}`)}}}
 const request={root:'/repo',arcId:'A',provider,expected:null,publishHeadSha:HEAD,presentation:{title:'Arc A',body:'Body'},remote:'origin'}
 return {request,deps,get state(){return state},get remoteHead(){return remoteHead},get pullRequest(){return pullRequest},calls,mutations,checkpoints}
}
function invoke(s,deps=s.deps){try{return publishDelivery(s.request,deps)}catch(error){return {status:'interrupted',reason:error.message}}}
function assertComplete(s,result){
 assert.equal(result.status,'published',JSON.stringify(result));assert.equal(result.delivery.target.currentHeadSha,HEAD);assert.equal(result.pullRequest.providerPullRequestId,'PR_7');assert.equal(s.remoteHead,HEAD)
 assert.deepEqual(s.mutations,{push:1,create:1,update:0});assert.equal(new Set(s.state.actions.map(row=>row.actionKey)).size,s.state.actions.length);assert.equal(s.state.actions.filter(row=>row.kind==='push').length,1);assert.equal(s.state.actions.filter(row=>row.kind==='create-pr').length,1);assert.ok(s.state.actions.every(row=>row.status==='succeeded'))
}
test('publication exposes at least twenty distinct durable interruption boundaries',()=>{
 const s=scenario();assertComplete(s,invoke(s));assert.ok(s.checkpoints.length>=20,`observed ${s.checkpoints.length}`);assert.equal(new Set(s.checkpoints.map(row=>row.label)).size,s.checkpoints.length)
})
test('every interruption boundary converges to one branch, one PR and stable durable actions',()=>{
 const trace=scenario();assertComplete(trace,invoke(trace));assert.ok(trace.checkpoints.length>=20)
 for(let faultAt=1;faultAt<=trace.checkpoints.length;faultAt++){
  const s=scenario({faultAt});assert.notEqual(invoke(s).status,'published',`boundary ${faultAt} must interrupt`)
  const result=invoke(s,{...s.deps,checkpoint:()=>{}});assertComplete(s,result);assert.equal(result.delivery.deliveryKey,deliveryKeyOf(target))
 }
})
test('PR created before observation persistence is reconciled without another create or update',()=>{
 const trace=scenario();assertComplete(trace,invoke(trace));const index=trace.checkpoints.findIndex(row=>/after-create-return/.test(row.label))+1;assert.ok(index>0)
 const interrupted=scenario({faultAt:index});assert.notEqual(invoke(interrupted).status,'published');assert.equal(interrupted.mutations.create,1);assert.ok(interrupted.pullRequest)
 assertComplete(interrupted,invoke(interrupted,{...interrupted.deps,checkpoint:()=>{}}))
})
test('provider preflight hold stops before remote mutation',()=>{
 const s=scenario();s.request.provider.preflight=({operation})=>({status:'held',kind:'auth',remedy:'authenticate provider',resumable:true,observedAt:AT,operation})
 const result=publishDelivery(s.request,s.deps);assert.equal(result.status,'held');assert.match(result.reason,/auth|authenticate|preflight/i);assert.deepEqual(s.mutations,{push:0,create:0,update:0});assert.equal(s.remoteHead,null);assert.equal(s.pullRequest,null)
})
test('closed or commit-drifted PR observation cannot create or update another PR',()=>{
 for(const [label,observation] of [['closed',{...prOf(),state:'closed'}],['head drift',{...prOf(),headSha:OLD}],['base drift',{...prOf(),baseSha:'3'.repeat(40)}]]){
  const s=scenario();s.request.provider.lookup=request=>{s.calls.push(['lookup',request]);return observation}
  const result=publishDelivery(s.request,s.deps);assert.equal(result.status,'held',label);assert.match(result.reason,/closed|drift|head|base|target|reconcile/i);assert.equal(s.mutations.create,0);assert.equal(s.mutations.update,0)
 }
})
test('unchanged PR observations do not create delivery revisions on resume',()=>{
 const s=scenario();assertComplete(s,invoke(s));const revision=s.state.revision
 s.request.provider.lookup=()=>({...s.pullRequest,observedAt:'2026-09-07T00:01:00.000Z'})
 assertComplete(s,invoke(s));assert.equal(s.state.revision,revision)
})
test('a changed PR returned by update holds instead of reporting publication complete',()=>{
 const s=scenario();s.request.provider.lookup=()=>prOf()
 s.request.provider.update=request=>({status:'succeeded',actionKey:request.action.actionKey,providerActionId:'PR_7',errorKind:null,observedAt:AT,pullRequest:{...prOf(),headSha:OLD}})
 const result=invoke(s);assert.equal(result.status,'held');assert.match(result.reason,/updated PR|target/);assert.equal(s.mutations.create,0)
})
test('an update applied before its result is persisted resumes without another external update',()=>{
 const setup=faultAt=>{
  const s=scenario({faultAt});let applied=false
  s.request.provider.lookup=()=>prOf()
  s.request.provider.update=request=>{
   const durable=s.state.actions.find(a=>a.actionKey===request.action.actionKey);assert.equal(durable.status,'unknown');assert.equal(durable.attempts.at(-1).finishedAt,null)
   if(!applied){applied=true;s.mutations.update++}
   return {status:'succeeded',actionKey:request.action.actionKey,providerActionId:'PR_7',errorKind:null,observedAt:AT,pullRequest:prOf()}
  }
  return s
 }
 const trace=setup(null);assert.equal(invoke(trace).status,'published')
 const index=trace.checkpoints.findIndex(row=>row.label==='after-update-return')+1;assert.ok(index>0)
 const s=setup(index);assert.equal(invoke(s).status,'held');assert.equal(s.mutations.update,1)
 assert.equal(invoke(s,{...s.deps,checkpoint:()=>{}}).status,'published');assert.equal(s.mutations.update,1);assert.equal(s.mutations.create,0);assert.ok(s.state.actions.every(a=>a.status==='succeeded'))
})
