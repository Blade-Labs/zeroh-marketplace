import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPullRequestProvider } from './pull-request.mjs'
const SHA0='0'.repeat(40),SHA1='1'.repeat(40),SHA2='2'.repeat(40),AT='2026-09-07T00:00:00.000Z'
const context={root:'/repo',ownerArcId:'A',cwd:'/repo',remote:'origin'}
const target={targetKey:JSON.stringify(['arc','A']),providerId:'github',repositoryId:'blade/roadmap',baseRef:'refs/heads/main',headRef:'refs/heads/roadmap/arc-a',currentBaseSha:SHA0,currentHeadSha:SHA1}
const deliveryKey=JSON.stringify(['github','blade/roadmap',target.targetKey])
const action=(overrides={})=>({actionKey:'create-1',kind:'create-pr',targetKey:target.targetKey,requested:{baseSha:SHA0,headSha:SHA1,ref:target.headRef,authorityId:null},status:'requested',attempts:[],...overrides})
const delivery=(overrides={})=>({schemaVersion:1,revision:4,arcId:'A',deliveryKey,target,strategy:{kind:'independent',arcId:'A'},requested:{terminal:'open',allowedPushRefs:[target.headRef],requiredCapabilities:['pull-request'],requiredChecks:['unit'],authority:{queue:null,merge:null}},actions:[action()],pullRequest:null,checks:null,terminal:{status:'preparing',headSha:SHA1,reason:null},createdAt:AT,updatedAt:AT,...overrides})
const expected=(overrides={})=>({revision:4,deliveryKey,targetKey:target.targetKey,providerId:'github',repositoryId:'blade/roadmap',baseRef:target.baseRef,headRef:target.headRef,currentBaseSha:SHA0,currentHeadSha:SHA1,...overrides})
const capabilities={providerId:'github',supported:['lookup','push','create','update','queue','merge','pull-request'],unsupported:[]}
const ready={status:'ready',providerId:'github',repositoryId:'blade/roadmap',operation:'create',capabilities,observedAt:AT}
function fixture({stored=delivery(),preflight=null,mutation={status:'succeeded',actionKey:'create-1',providerActionId:'pr-7',errorKind:null,observedAt:AT,pullRequest:null}}={}){
 const calls=[],impl={capabilities(input){calls.push(['capabilities',input]);return capabilities},preflight(input){calls.push(['preflight',input]);return preflight??{...ready,operation:input.operation}},lookup(input){calls.push(['lookup',input]);return null}}
 for(const name of ['push','create','update','queue','merge'])impl[name]=input=>{calls.push([name,input]);return mutation}
 const provider=createPullRequestProvider({providerId:'github',impl,loadDelivery:(root,arcId)=>{calls.push(['loadDelivery',{root,arcId}]);return stored},withLock:(_key,fn)=>fn()})
 return {provider,calls}
}
const nonLoads=f=>f.calls.map(([name])=>name).filter(name=>name!=='loadDelivery')
test('mutation reloads durable intent before ready preflight and provider mutation',()=>{
 const f=fixture(),request={action:action(),expected:expected(),context:{...context,presentation:{title:'Arc A',body:'Body'}}},result=f.provider.create(request)
 assert.equal(result.status,'succeeded');assert.equal(result.providerActionId,'pr-7');assert.equal(result.actionKey,'create-1')
 assert.equal(f.calls[0][0],'loadDelivery');assert.deepEqual(f.calls[0][1],{root:'/repo',arcId:'A'});assert.deepEqual(nonLoads(f),['preflight','create']);assert.equal(f.calls.find(([name])=>name==='preflight')[1].operation,'create')
})
test('missing action and stale identity bindings refuse before preflight or mutation',()=>{
 const cases=[['missing',delivery({actions:[]}),expected()],...Object.entries({revision:3,deliveryKey:'wrong',targetKey:'wrong',providerId:'gitlab',repositoryId:'other/repo',baseRef:'refs/heads/release',headRef:'refs/heads/other',currentBaseSha:SHA2,currentHeadSha:SHA2}).map(([key,value])=>[key,delivery(),expected({[key]:value})])]
 for(const [label,stored,want] of cases){const f=fixture({stored}),result=f.provider.create({action:action(),expected:want,context});assert.equal(result.status,'refused',label);assert.equal(result.actionKey,'create-1');assert.equal(result.resumable,false);assert.deepEqual(nonLoads(f),[],label)}
})
test('caller claims cannot replace persisted action intent or authority',()=>{
 const supplied=[{...action(),persisted:true},{...action(),requested:{...action().requested,headSha:SHA2}},...['queue','merge'].map(kind=>action({actionKey:`${kind}-1`,kind,requested:{baseSha:SHA0,headSha:SHA1,ref:target.headRef,authorityId:'grant-1'}}))]
 for(const candidate of supplied){const f=fixture(),method=candidate.kind==='create-pr'?'create':candidate.kind,result=f.provider[method]({action:candidate,expected:expected(),context,receipt:{authorityId:'grant-1'}});assert.equal(result.status,'refused');assert.deepEqual(nonLoads(f),[])}
})
test('blocked preflight holds without invoking mutation',()=>{
 const blocked={status:'held',actionKey:'create-1',kind:'missing-tool',remedy:'install gh',resumable:true,observedAt:AT},f=fixture({preflight:blocked}),result=f.provider.create({action:action(),expected:expected(),context})
 assert.deepEqual(result,blocked);assert.deepEqual(nonLoads(f),['preflight'])
})
test('push may authorize a future head while base and ref stay bound',()=>{
 const push=action({actionKey:'push-1',kind:'push',requested:{baseSha:SHA0,headSha:SHA2,ref:target.headRef,authorityId:null}}),stored=delivery({actions:[push]}),f=fixture({stored,mutation:{status:'succeeded',actionKey:'push-1',providerActionId:'push-7',errorKind:null,observedAt:AT,pullRequest:null}})
 assert.equal(f.provider.push({action:push,expected:expected(),context}).status,'succeeded');assert.deepEqual(nonLoads(f),['preflight','push'])
 for(const bad of [{...push,requested:{...push.requested,baseSha:SHA2}},{...push,requested:{...push.requested,ref:'refs/heads/other'}}])assert.equal(fixture({stored}).provider.push({action:bad,expected:expected(),context}).status,'refused')
})
function terminalDelivery(kind){
 const authorityId=`${kind}-grant`,terminalAction=action({actionKey:`${kind}-1`,kind,requested:{baseSha:SHA0,headSha:SHA1,ref:target.headRef,authorityId}})
 return delivery({requested:{terminal:kind,allowedPushRefs:[target.headRef],requiredCapabilities:['pull-request',kind],requiredChecks:['unit'],authority:{queue:kind==='queue'?{authorityId,recordedAt:AT}:null,merge:kind==='merge'?{authorityId,recordedAt:AT}:null}},actions:[terminalAction],pullRequest:{providerId:'github',repositoryId:'blade/roadmap',targetKey:target.targetKey,providerPullRequestId:'PR_7',number:7,url:null,state:'open',draft:false,baseRef:target.baseRef,headRef:target.headRef,baseSha:SHA0,headSha:SHA1,observedAt:AT},checks:{providerId:'github',repositoryId:'blade/roadmap',providerPullRequestId:'PR_7',headSha:SHA1,requiredChecks:['unit'],observedChecks:[{name:'unit',status:'green',attemptId:'u1',observedAt:AT}],observedAt:AT}})
}
test('queue and merge require durable mode, authority and current green evidence',()=>{
 for(const kind of ['queue','merge']){
  const good=terminalDelivery(kind),terminalAction=good.actions[0],success={status:'succeeded',actionKey:terminalAction.actionKey,providerActionId:`${kind}-provider`,errorKind:null,observedAt:AT,pullRequest:good.pullRequest},accepted=fixture({stored:good,mutation:success})
  assert.equal(accepted.provider[kind]({action:terminalAction,expected:expected({providerPullRequestId:'PR_7'}),context}).status,'succeeded');assert.deepEqual(nonLoads(accepted),['preflight',kind])
  for(const stored of [{...good,requested:{...good.requested,terminal:'open'}},{...good,requested:{...good.requested,authority:{queue:null,merge:null}}},{...good,checks:{...good.checks,headSha:SHA2}},{...good,checks:{...good.checks,observedChecks:[{...good.checks.observedChecks[0],status:'red'}]}}]){const f=fixture({stored});assert.equal(f.provider[kind]({action:terminalAction,expected:expected({providerPullRequestId:'PR_7'}),context}).status,'refused');assert.deepEqual(nonLoads(f),[])}
 }
})
test('provider cannot accept another provider capabilities or malformed successful observation',()=>{
 const other=fixture({preflight:{...ready,capabilities:{...capabilities,providerId:'gitlab'}}})
 assert.equal(other.provider.create({action:action(),expected:expected(),context}).status,'held');assert.deepEqual(nonLoads(other),['preflight'])
 const malformed=fixture({mutation:{status:'succeeded',actionKey:'create-1'}})
 assert.equal(malformed.provider.create({action:action(),expected:expected(),context}).status,'held')
})
test('well-shaped PR observations for another delivery cannot be reported as success',()=>{
 const good=terminalDelivery('merge'),wrong={...good.pullRequest,repositoryId:'other/repo'},f=fixture({mutation:{status:'succeeded',actionKey:'create-1',providerActionId:'PR_7',errorKind:null,observedAt:AT,pullRequest:wrong}})
 assert.equal(f.provider.create({action:action(),expected:expected(),context}).status,'held')
})
