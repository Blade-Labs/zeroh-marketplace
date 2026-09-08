import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deliveryKeyOf, reduceDelivery, finalizeDelivery } from './delivery.mjs'

const SHA0 = '0'.repeat(40), SHA1 = '1'.repeat(40), SHA2 = '2'.repeat(40)
const AT0 = '2026-09-07T00:00:00.000Z', AT1 = '2026-09-07T00:01:00.000Z', AT2 = '2026-09-07T00:02:00.000Z'
const target = () => ({targetKey:'target-main',providerId:'github',repositoryId:'blade/roadmap',baseRef:'main',headRef:'feat/nativegreen',currentBaseSha:SHA0,currentHeadSha:SHA1})
const requested = () => ({terminal:'open',allowedPushRefs:['feat/nativegreen'],requiredCapabilities:['pull-request'],requiredChecks:['lint','unit'],authority:{queue:null,merge:null}})
const initial = () => {
  const t=target()
  return {schemaVersion:1,revision:0,arcId:'NATIVEGREEN',deliveryKey:deliveryKeyOf(t),target:t,strategy:{kind:'independent',arcId:'NATIVEGREEN'},requested:requested(),actions:[],pullRequest:null,checks:null,terminal:{status:'preparing',headSha:SHA1,reason:null},createdAt:AT0,updatedAt:AT0}
}
const event=(type,extra={})=>({type,deliveryKey:initial().deliveryKey,targetKey:'target-main',expectedRevision:0,at:AT1,...extra})
const pr=(overrides={})=>({providerId:'github',repositoryId:'blade/roadmap',targetKey:'target-main',providerPullRequestId:'pr-7',number:7,url:'https://example.test/pr/7',state:'open',draft:false,baseRef:'main',headRef:'feat/nativegreen',baseSha:SHA0,headSha:SHA1,observedAt:AT1,...overrides})
const checks=(overrides={})=>({providerId:'github',repositoryId:'blade/roadmap',providerPullRequestId:'pr-7',headSha:SHA1,requiredChecks:['lint','unit'],observedChecks:[{name:'lint',status:'green',attemptId:'lint-1',observedAt:AT1},{name:'unit',status:'green',attemptId:'unit-1',observedAt:AT1}],observedAt:AT1,...overrides})
function observeReady(){let state=initial();state=reduceDelivery(state,event('observe-pr',{pullRequest:pr()}));return reduceDelivery(state,event('observe-checks',{expectedRevision:1,at:AT2,checks:checks()}))}

test('delivery identity is deterministic and excludes moving commit bindings',()=>{
 const a=target();assert.equal(deliveryKeyOf(a),deliveryKeyOf({...a,currentBaseSha:SHA2,currentHeadSha:SHA2}))
 assert.notEqual(deliveryKeyOf(a),deliveryKeyOf({...a,repositoryId:'blade/other'}));assert.notEqual(deliveryKeyOf(a),deliveryKeyOf({...a,targetKey:'other-target'}))
 assert.notEqual(deliveryKeyOf({...a,providerId:'a:b',repositoryId:'c'}),deliveryKeyOf({...a,providerId:'a',repositoryId:'b:c'}))
})
test('requested action replay is idempotent while a stable-key collision is refused',()=>{
 const action={actionKey:'push-1',kind:'push',targetKey:'target-main',requested:{baseSha:SHA0,headSha:SHA2,ref:'feat/nativegreen',authorityId:null},status:'requested',attempts:[]}
 const request=event('request-action',{action}),once=reduceDelivery(initial(),request),replay=reduceDelivery(once,request)
 assert.deepEqual(replay,once);assert.equal(replay.revision,1)
 assert.throws(()=>reduceDelivery(once,{...request,action:{...action,kind:'merge'}}),/collision|actionKey|replay/i)
})
test('observations cannot grow requested policy or silently retarget delivery',()=>{
 const state=initial(),drifted=reduceDelivery(state,event('observe-pr',{pullRequest:pr({baseRef:'release'})}))
 assert.deepEqual(drifted.target,state.target);assert.deepEqual(drifted.requested,state.requested);assert.equal(drifted.terminal.status,'held')
 assert.throws(()=>reduceDelivery(state,event('observe-pr',{pullRequest:pr(),requested:{authority:{merge:{authorityId:'grown',recordedAt:AT1}}}})),/unknown|unrecognized|requested|field/i)
})
test('green requires exact current PR head and nonempty all-green configured checks',()=>{
 const base=observeReady(),green=event('set-terminal',{expectedRevision:2,terminal:{status:'open-green',headSha:SHA1,checksObservedAt:AT1}})
 assert.equal(reduceDelivery(base,green).terminal.status,'open-green')
 const invalid=[checks({headSha:SHA0}),checks({requiredChecks:[],observedChecks:[]}),checks({requiredChecks:['lint'],observedChecks:[{name:'lint',status:'green',attemptId:null,observedAt:AT1}]}),checks({observedChecks:[...checks().observedChecks,{name:'extra',status:'green',attemptId:null,observedAt:AT1}]}),checks({observedChecks:checks().observedChecks.map(c=>c.name==='unit'?{...c,status:'red'}:c)})]
 for(const evidence of invalid){let state=reduceDelivery(initial(),event('observe-pr',{pullRequest:pr()}));state=reduceDelivery(state,event('observe-checks',{expectedRevision:1,at:AT2,checks:evidence}));assert.throws(()=>reduceDelivery(state,{...green,expectedRevision:2}),/check|head|green|required/i)}
})
test('authorized head advance invalidates checks and stale evidence cannot certify green',()=>{
 let state=observeReady()
 const action={actionKey:'push-2',kind:'push',targetKey:'target-main',requested:{baseSha:SHA0,headSha:SHA2,ref:'feat/nativegreen',authorityId:null},status:'succeeded',attempts:[{attempt:1,startedAt:AT1,finishedAt:AT2,observed:{providerActionId:'push-provider-2',outcome:'succeeded',errorKind:null}}]}
 state={...state,revision:3,actions:[action]}
 const advanced=reduceDelivery(state,{...event('advance-head'),expectedRevision:3,at:AT2,actionKey:'push-2',fromHeadSha:SHA1,toHeadSha:SHA2,observedBaseSha:SHA0})
 assert.equal(advanced.target.currentHeadSha,SHA2);assert.equal(advanced.checks,null);assert.equal(advanced.terminal.status,'awaiting-ci')
 assert.throws(()=>reduceDelivery(advanced,{...event('set-terminal'),expectedRevision:4,terminal:{status:'open-green',headSha:SHA2,checksObservedAt:AT1}}),/check|evidence|green/i)
})

import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { loadArcDelivery, persistArcDelivery, transitionArcDelivery } from './delivery.mjs'

const cleanups=[]
process.on('exit',()=>cleanups.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true})))
function repoFixture(){
 const root=mkdtempSync(join(tmpdir(),'zr-delivery-'));cleanups.push(root)
 const schema=join(root,'docs/roadmap/lib/schema.ts');mkdirSync(dirname(schema),{recursive:true})
 cpSync(new URL('../../../../docs/roadmap/lib/schema.ts',import.meta.url),schema)
 writeFileSync(join(root,'docs/roadmap/roadmap.config.json'),JSON.stringify({configVersion:1}))
 symlinkSync(new URL('../../node_modules',import.meta.url),join(root,'node_modules'),'dir')
 return root
}
const receiptPath=root=>join(root,'docs/roadmap/.deliveries/NATIVEGREEN.json')

test('persistence creates revision zero, replays exactly, and rejects stale revisions',()=>{
 const root=repoFixture(),created=persistArcDelivery(root,null,initial())
 assert.deepEqual(loadArcDelivery(root,'NATIVEGREEN'),created)
 assert.deepEqual(persistArcDelivery(root,null,initial()),created)
 const left={...created,revision:1,updatedAt:AT1,terminal:{status:'held',headSha:SHA1,reason:'left writer'}}
 const right={...created,revision:1,updatedAt:AT2,terminal:{status:'held',headSha:SHA1,reason:'right writer'}}
 persistArcDelivery(root,0,left)
 assert.throws(()=>persistArcDelivery(root,0,right),/revision|stale|compare|CAS/i)
 assert.equal(loadArcDelivery(root,'NATIVEGREEN').terminal.reason,'left writer')
})
test('persistence rejects policy growth and every immutable address drift without replacing bytes',()=>{
 const root=repoFixture(),current=persistArcDelivery(root,null,initial()),before=readFileSync(receiptPath(root))
 const candidates=[{...current,revision:1,updatedAt:AT1,requested:{...current.requested,authority:{...current.requested.authority,merge:{authorityId:'late-grant',recordedAt:AT1}}}},...['targetKey','providerId','repositoryId','baseRef','headRef'].map(field=>({...current,revision:1,updatedAt:AT1,target:{...current.target,[field]:`${current.target[field]}-drift`}}))]
 for(const candidate of candidates){assert.throws(()=>persistArcDelivery(root,0,candidate),/immutable|requested|target|address|drift|identity|binding/i);assert.deepEqual(readFileSync(receiptPath(root)),before)}
})
test('persistence rejects corrupt, unknown nested, traversal and symlink receipts',()=>{
 const corruptRoot=repoFixture(),corrupt=receiptPath(corruptRoot);mkdirSync(dirname(corrupt));writeFileSync(corrupt,'{not json}\n')
 assert.throws(()=>loadArcDelivery(corruptRoot,'NATIVEGREEN'),/corrupt|json|parse/i);assert.equal(readFileSync(corrupt,'utf8'),'{not json}\n')
 const nestedRoot=repoFixture(),bad=initial();bad.requested.authority.merge={authorityId:'grant',recordedAt:AT0,surprise:true}
 assert.throws(()=>persistArcDelivery(nestedRoot,null,bad),/unknown|unrecognized|surprise/i);assert.equal(existsSync(receiptPath(nestedRoot)),false)
 assert.throws(()=>transitionArcDelivery(nestedRoot,'NATIVEGREEN',{...event('initialize'),expectedRevision:null,at:AT0,state:{...initial(),requested:{...requested(),surprise:true}}}),/unknown|unrecognized|surprise/i)
 assert.equal(existsSync(receiptPath(nestedRoot)),false);assert.throws(()=>loadArcDelivery(nestedRoot,'../escape'),/arc|safe|traversal|path/i)
 const symlinkRoot=repoFixture(),linked=receiptPath(symlinkRoot),outside=join(symlinkRoot,'outside.json');mkdirSync(dirname(linked));writeFileSync(outside,JSON.stringify(initial())+'\n');symlinkSync(outside,linked)
 assert.throws(()=>loadArcDelivery(symlinkRoot,'NATIVEGREEN'),/symlink|regular|unsafe/i);assert.equal(lstatSync(linked).isSymbolicLink(),true);assert.deepEqual(JSON.parse(readFileSync(outside,'utf8')),initial())
})
test('two processes competing for one delivery revision publish exactly one winner',{timeout:30_000},async()=>{
 const root=repoFixture(),current=persistArcDelivery(root,null,initial()),moduleUrl=new URL('./delivery.mjs',import.meta.url).href
 const children=['left','right'].map(marker=>{
  const candidate={...current,revision:1,updatedAt:AT1,terminal:{status:'held',headSha:SHA1,reason:marker}}
  const child=spawn(process.execPath,['--input-type=module','-e',`import {persistArcDelivery} from ${JSON.stringify(moduleUrl)};process.send('ready');process.once('message',()=>{try{persistArcDelivery(${JSON.stringify(root)},0,${JSON.stringify(candidate)});process.disconnect()}catch(error){process.stderr.write(error.message);process.disconnect();process.exitCode=1}})`],{stdio:['ignore','ignore','pipe','ipc']})
  let stderr='';child.stderr.on('data',bytes=>{stderr+=bytes})
  const done=new Promise(resolve=>{child.once('error',error=>resolve({marker,error}));child.once('exit',code=>resolve({marker,code,stderr}))})
  const ready=Promise.race([new Promise(resolve=>child.once('message',resolve)),done])
  return {child,done,ready}
 })
 try{
  assert.deepEqual(await Promise.all(children.map(c=>c.ready)),['ready','ready'])
  for(const {child} of children)child.send('go')
  const outcomes=await Promise.all(children.map(c=>c.done));assert.deepEqual(outcomes.map(x=>x.code).sort(),[0,1],JSON.stringify(outcomes))
  assert.match(outcomes.find(x=>x.code===1).stderr,/revision|stale|compare|CAS/i)
  assert.equal(loadArcDelivery(root,'NATIVEGREEN').terminal.reason,outcomes.find(x=>x.code===0).marker)
 }finally{for(const {child} of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await Promise.all(children.map(c=>c.done))}
})

function pushRequest(actionKey='push-1') {
 return {actionKey,kind:'push',targetKey:'target-main',requested:{baseSha:SHA0,headSha:SHA2,ref:'feat/nativegreen',authorityId:null},status:'requested',attempts:[]}
}
function requestedState(){return reduceDelivery(initial(),event('request-action',{action:pushRequest()}))}
test('original request replays after observation while conflicting immutable intent is refused',()=>{
 let state=requestedState()
 const started={attempt:1,startedAt:AT1,finishedAt:null,observed:null}
 state=reduceDelivery(state,event('record-action-attempt',{expectedRevision:1,actionKey:'push-1',attempt:started}))
 const finished={...started,finishedAt:AT2,observed:{providerActionId:'provider-push-1',outcome:'succeeded',errorKind:null}}
 state=reduceDelivery(state,event('record-action-attempt',{expectedRevision:2,at:AT2,actionKey:'push-1',attempt:finished}))
 assert.deepEqual(reduceDelivery(state,event('request-action',{action:pushRequest()})),state)
 assert.throws(()=>reduceDelivery(state,event('request-action',{action:{...pushRequest(),requested:{...pushRequest().requested,headSha:SHA0}}})),/collision|intent|actionKey|replay/i)
})
test('an in-flight attempt may finish once and its observation cannot be rewritten',()=>{
 let state=requestedState()
 const started={attempt:1,startedAt:AT1,finishedAt:null,observed:null}
 state=reduceDelivery(state,event('record-action-attempt',{expectedRevision:1,actionKey:'push-1',attempt:started}))
 assert.equal(state.actions[0].status,'unknown')
 const finished={...started,finishedAt:AT2,observed:{providerActionId:'provider-push-1',outcome:'succeeded',errorKind:null}}
 const done=reduceDelivery(state,event('record-action-attempt',{expectedRevision:2,at:AT2,actionKey:'push-1',attempt:finished}))
 assert.equal(done.actions[0].status,'succeeded')
 assert.throws(()=>reduceDelivery(done,event('record-action-attempt',{expectedRevision:3,at:AT2,actionKey:'push-1',attempt:{...finished,observed:{...finished.observed,outcome:'failed'}}})),/collision|rewrite|attempt/i)
})
test('raw persistence cannot manufacture action outcomes or terminal authority',()=>{
 const root=repoFixture(),created=persistArcDelivery(root,null,initial())
 const withRequest=persistArcDelivery(root,0,reduceDelivery(created,event('request-action',{action:pushRequest()})))
 const forgedAction={...withRequest,revision:2,updatedAt:AT2,actions:[{...withRequest.actions[0],status:'succeeded'}]}
 assert.throws(()=>persistArcDelivery(root,1,forgedAction),/status|attempt|observ|evolution|authority/i)
 assert.deepEqual(loadArcDelivery(root,'NATIVEGREEN'),withRequest)
 const forgedGreen={...withRequest,revision:2,updatedAt:AT2,terminal:{status:'open-green',headSha:SHA1,checksObservedAt:AT1}}
 assert.throws(()=>persistArcDelivery(root,1,forgedGreen),/green|check|terminal|evidence|authority/i)
 assert.deepEqual(loadArcDelivery(root,'NATIVEGREEN'),withRequest)
})

test('requested actions cannot import observed outcomes and terminal modes cannot be substituted',()=>{
 const observed={...pushRequest(),status:'succeeded',attempts:[{attempt:1,startedAt:AT1,finishedAt:AT2,observed:{providerActionId:'done',outcome:'succeeded',errorKind:null}}]}
 assert.throws(()=>reduceDelivery(initial(),event('request-action',{action:observed})),/requested|observed|attempt/i)
 const ready=observeReady(),queueIntent={...ready,requested:{...ready.requested,terminal:'queue',authority:{queue:{authorityId:'queue-grant',recordedAt:AT0},merge:null}}}
 assert.throws(()=>reduceDelivery(queueIntent,event('set-terminal',{expectedRevision:2,at:AT2,terminal:{status:'open-green',headSha:SHA1,checksObservedAt:AT1}})),/policy|terminal/i)
})
test('the public transition seam persists initialization, observed push and explicit head advance',{timeout:40_000},()=>{
 const root=repoFixture()
 let state=transitionArcDelivery(root,'NATIVEGREEN',{...event('initialize'),expectedRevision:null,at:AT0,state:initial()})
 assert.equal(state.revision,0)
 const request=event('request-action',{action:pushRequest()})
 state=transitionArcDelivery(root,'NATIVEGREEN',request)
 state=transitionArcDelivery(root,'NATIVEGREEN',event('record-action-attempt',{expectedRevision:1,at:AT2,actionKey:'push-1',attempt:{attempt:1,startedAt:AT1,finishedAt:AT2,observed:{providerActionId:'push-observed',outcome:'succeeded',errorKind:null}}}))
 assert.equal(state.actions[0].status,'succeeded')
 assert.deepEqual(transitionArcDelivery(root,'NATIVEGREEN',request),state)
 state=transitionArcDelivery(root,'NATIVEGREEN',{...event('advance-head'),expectedRevision:2,at:AT2,actionKey:'push-1',fromHeadSha:SHA1,toHeadSha:SHA2,observedBaseSha:SHA0})
 assert.equal(state.target.currentHeadSha,SHA2);assert.equal(state.checks,null);assert.equal(state.terminal.status,'awaiting-ci')
 assert.deepEqual(loadArcDelivery(root,'NATIVEGREEN'),state)
})

import { execFileSync } from 'node:child_process'
const fixtureGit=(root,...args)=>execFileSync('git',['-C',root,'-c','user.email=t@t','-c','user.name=t',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
function trackedRepoFixture(){
 const root=repoFixture();fixtureGit(root,'init','-q','-b','main');writeFileSync(join(root,'.gitignore'),'node_modules\n')
 fixtureGit(root,'add','.gitignore','docs/roadmap/roadmap.config.json','docs/roadmap/lib/schema.ts');fixtureGit(root,'commit','-qm','fixture baseline');return root
}
test('local delivery receipts self-ignore without hiding unrelated consumer work',()=>{
 const root=trackedRepoFixture();persistArcDelivery(root,null,initial())
 assert.equal(readFileSync(join(root,'docs/roadmap/.deliveries/.gitignore'),'utf8'),'*\n');assert.equal(fixtureGit(root,'status','--porcelain'),'')
 writeFileSync(join(root,'foreign.txt'),'consumer work\n');assert.equal(fixtureGit(root,'status','--porcelain'),'?? foreign.txt');assert.deepEqual(loadArcDelivery(root,'NATIVEGREEN'),initial())
})
test('symlinked delivery ignore guard refuses without touching its target',()=>{
 const root=trackedRepoFixture(),directory=join(root,'docs/roadmap/.deliveries');mkdirSync(directory)
 const outside=join(root,'outside-ignore');writeFileSync(outside,'outside bytes\n');symlinkSync(outside,join(directory,'.gitignore'));const before=readFileSync(outside)
 assert.throws(()=>persistArcDelivery(root,null,initial()),/gitignore|symlink|regular|unsafe/i);assert.deepEqual(readFileSync(outside),before);assert.equal(existsSync(receiptPath(root)),false);assert.equal(lstatSync(join(directory,'.gitignore')).isSymbolicLink(),true)
})

const terminalCapabilities=kind=>({providerId:'github',supported:['pull-request',kind],unsupported:[]})
function terminalReady(kind){const state=observeReady();state.requested={...state.requested,terminal:kind,requiredCapabilities:['pull-request',kind],authority:{queue:kind==='queue'?{authorityId:'queue-grant',recordedAt:AT0}:null,merge:kind==='merge'?{authorityId:'merge-grant',recordedAt:AT0}:null}};return state}
test('finalize open emits one exact-current green transition without changing the input',()=>{
 const state=observeReady(),before=structuredClone(state),result=finalizeDelivery(state,{capabilities:terminalCapabilities('open'),at:AT2})
 assert.equal(result.status,'transition');assert.equal(result.event.expectedRevision,state.revision);assert.deepEqual(result.event.terminal,{status:'open-green',headSha:SHA1,checksObservedAt:AT1});assert.deepEqual(state,before)
 assert.equal(reduceDelivery(state,result.event).terminal.status,'open-green')
})
test('finalize stale head/base, draft/closed PR and incomplete check set remain pending',()=>{
 const ready=observeReady(),cases=[{...ready,target:{...ready.target,currentHeadSha:SHA2},terminal:{...ready.terminal,headSha:SHA2}},{...ready,target:{...ready.target,currentBaseSha:SHA2}},...['draft','closed'].map(kind=>({...ready,pullRequest:{...ready.pullRequest,...(kind==='draft'?{draft:true}:{state:'closed'})}})),{...ready,checks:null},{...ready,requested:{...ready.requested,requiredChecks:['lint']}},{...ready,checks:{...ready.checks,observedChecks:[...ready.checks.observedChecks,{name:'extra',status:'green',attemptId:null,observedAt:AT1}]}},{...ready,checks:{...ready.checks,observedChecks:ready.checks.observedChecks.map(row=>({...row,status:'pending'}))}}]
 for(const state of cases){const result=finalizeDelivery(state,{capabilities:terminalCapabilities('open'),at:AT2});assert.equal(result.status,'pending');assert.equal(result.action,undefined)}
})
test('finalize queue/merge requests exact durable authority then accepts only its successful observation',()=>{
 for(const kind of ['queue','merge']){
  const state=terminalReady(kind),options={capabilities:terminalCapabilities(kind),at:AT2},request=finalizeDelivery(state,options)
  assert.equal(request.status,'action-required');assert.deepEqual(request.action.requested,{baseSha:SHA0,headSha:SHA1,ref:'feat/nativegreen',authorityId:`${kind}-grant`});assert.equal(request.action.actionKey,JSON.stringify([1,state.deliveryKey,kind,SHA0,SHA1]));assert.equal(request.action.status,'requested')
  const providerActionId=kind==='merge'?SHA2:'MQ_7';state.actions=[{...request.action,status:'succeeded',attempts:[{attempt:1,startedAt:AT1,finishedAt:AT2,observed:{providerActionId,outcome:'succeeded',errorKind:null}}]}]
  const complete=finalizeDelivery(state,options);assert.equal(complete.status,'transition');assert.equal(complete.event.terminal.status,kind==='queue'?'queued':'merged');assert.equal(complete.event.terminal.providerActionId,providerActionId)
  const terminal=reduceDelivery(state,complete.event);assert.deepEqual(reduceDelivery(terminal,finalizeDelivery(terminal,{at:AT2}).event),terminal);if(kind==='merge'){assert.equal(terminal.terminal.mergeSha,SHA2);assert.deepEqual(reduceDelivery(terminal,finalizeDelivery(terminal,options).event),terminal);assert.equal(finalizeDelivery({...terminal,target:{...terminal.target,currentHeadSha:SHA2}},options).status,'pending')}
 }
})
test('finalize holds missing capability/ref/authority and conflicting terminal actions',()=>{
 for(const kind of ['queue','merge']){
  const base=terminalReady(kind)
  for(const [state,capabilities] of [[base,terminalCapabilities('other')],[{...base,requested:{...base.requested,allowedPushRefs:[]}},terminalCapabilities(kind)],[{...base,requested:{...base.requested,authority:{queue:null,merge:null}}},terminalCapabilities(kind)]])assert.equal(finalizeDelivery(state,{capabilities,at:AT2}).status,'held')
  const options={capabilities:terminalCapabilities(kind),at:AT2},action=finalizeDelivery(base,options).action
  base.actions=[{...action,requested:{...action.requested,authorityId:'other'}}];assert.equal(finalizeDelivery(base,options).status,'held')
 }
})
