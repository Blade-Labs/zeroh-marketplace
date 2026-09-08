import {test} from 'node:test'
import assert from 'node:assert/strict'
import {monitorDelivery} from './ci-monitor.mjs'
import {deliveryKeyOf,reduceDelivery} from './delivery.mjs'
import {finalizeCiObservation} from './providers/ci.mjs'
const HEAD='a'.repeat(40),BASE='b'.repeat(40),AT='2026-09-08T01:00:00.000Z'
function receipt(){
 const target={targetKey:'target',providerId:'github',repositoryId:'blade/roadmap',baseRef:'refs/heads/main',headRef:'refs/heads/arc',currentBaseSha:BASE,currentHeadSha:HEAD}
 return {schemaVersion:1,revision:0,arcId:'ARC',deliveryKey:deliveryKeyOf(target),target,strategy:{kind:'independent',arcId:'ARC'},requested:{terminal:'open',allowedPushRefs:['refs/heads/arc'],requiredCapabilities:[],requiredChecks:['unit'],authority:{queue:null,merge:null}},actions:[],pullRequest:{providerId:'github',repositoryId:'blade/roadmap',targetKey:'target',providerPullRequestId:'PR_1',number:1,url:'https://example.test/pr/1',state:'open',draft:false,baseRef:target.baseRef,headRef:target.headRef,baseSha:BASE,headSha:HEAD,observedAt:AT},checks:null,terminal:{status:'awaiting-ci',headSha:HEAD,reason:null},createdAt:AT,updatedAt:AT}
}
const ciRequest=state=>({providerId:state.target.providerId,repositoryId:state.target.repositoryId,providerPullRequestId:state.pullRequest.providerPullRequestId,sourceHeadSha:state.target.currentHeadSha,baseSha:state.target.currentBaseSha,requiredChecks:state.requested.requiredChecks,headMode:'source',mergeQueue:null})
function observation(state,status='green',at=AT){
 const attempt={attemptId:'run-1',suiteId:'1',runNumber:null,runAttempt:null,status:status==='pending'?'in_progress':'completed',conclusion:status==='pending'?null:status==='red'?'failure':'success',startedAt:at,completedAt:status==='pending'?null:at,detailsUrl:null,logRefs:[],artifactRefs:[]}
 return finalizeCiObservation(ciRequest(state),{checks:[{key:'check-run:1:unit',name:'unit',source:'check-run',appId:1,verdict:status,latestAttemptId:'run-1',attempts:[attempt]}],observedAt:at})
}
function harness(initial=receipt(),status='green'){
 let state=structuredClone(initial),locked=false,lookups=0,now=Date.parse(AT),providerHook
 const deps={load:()=>structuredClone(state),transition:(_root,_arc,event)=>{state=reduceDelivery(state,event);return structuredClone(state)},withLock:(_path,fn)=>{assert.equal(locked,false);locked=true;try{return fn()}finally{locked=false}},clock:()=>new Date(now).toISOString(),checkpoint:()=>{}}
 const provider={lookup:request=>{assert.equal(locked,true);lookups++;assert.deepEqual(request,ciRequest(state));return providerHook?providerHook(request):observation(state,status,new Date(now).toISOString())}}
 const call=(extra={})=>monitorDelivery({root:'/fixture',arcId:'ARC',provider,pollIntervalMs:1000,deadlineMs:now+10000,...extra},deps)
 return {deps,provider,call,get state(){return structuredClone(state)},set state(v){state=structuredClone(v)},get lookups(){return lookups},set hook(fn){providerHook=fn},advance(ms){now+=ms}}
}
test('monitor persists exact green then reports retained evidence without a duplicate poll',()=>{
 const h=harness(),first=h.call();assert.equal(first.status,'green');assert.equal(first.source,'fresh');assert.equal(first.delivery.terminal.status,'open-green');assert.equal(h.lookups,1)
 const revision=h.state.revision,second=h.call();assert.equal(second.status,'green');assert.equal(second.source,'cache');assert.equal(second.observation,null);assert.equal(h.state.revision,revision);assert.equal(h.lookups,1)
 h.advance(1000);const third=h.call();assert.equal(third.source,'fresh');assert.equal(h.lookups,2)
})
test('crash before observation persistence and after persistence resumes existing state',()=>{
 for(const boundary of ['after-lookup','after-persist']){
  const h=harness(receipt(),'pending');h.deps.checkpoint=label=>{if(label===boundary)throw Error('crash')}
  assert.throws(()=>h.call(),/crash/);const revision=h.state.revision
  assert.equal(revision,boundary==='after-lookup'?0:1)
  h.deps.checkpoint=()=>{};const resumed=h.call();assert.equal(resumed.status,'pending');assert.equal(h.state.revision,1);assert.equal(h.lookups,boundary==='after-lookup'?2:1)
 }
})
test('crash after green evidence persists resumes terminal reconciliation without repoll',()=>{
 const h=harness();h.deps.checkpoint=label=>{if(label==='after-persist')throw Error('crash')};assert.throws(()=>h.call(),/crash/);assert.equal(h.state.terminal.status,'awaiting-ci')
 h.deps.checkpoint=()=>{};assert.equal(h.call().status,'green');assert.equal(h.lookups,1)
})
test('receipt churn during lookup discards the old observation without writing onto the new head',()=>{
 const h=harness();h.hook=()=>{const old=observation(h.state);const next=h.state;next.revision++;next.target.currentHeadSha='c'.repeat(40);next.checks=null;next.terminal={status:'awaiting-ci',headSha:next.target.currentHeadSha,reason:null};h.state=next;return old}
 const result=h.call();assert.equal(result.status,'superseded');assert.equal(h.state.revision,1);assert.equal(h.state.checks,null)
})
test('current provider holds erase old green before returning a durable hold',()=>{
 const h=harness();h.call();h.advance(1000)
 h.hook=()=>finalizeCiObservation(ciRequest(h.state),{hold:{kind:'quota',remedy:'quota: wait then resume'},observedAt:new Date(Date.parse(AT)+1000).toISOString()})
 const result=h.call();assert.equal(result.status,'held');assert.equal(h.state.terminal.status,'held');assert.deepEqual(h.state.checks.observedChecks.map(c=>c.status),['missing']);assert.match(result.reason,/quota/)
 const cached=h.call();assert.equal(cached.status,'held');assert.equal(cached.source,'cache');assert.equal(h.lookups,2)
})
test('stale caller revision, expired budget and malformed identity never authorize writes',()=>{
 const h=harness();assert.equal(h.call({expectedRevision:99}).status,'refused');assert.equal(h.lookups,0)
 assert.equal(h.call({deadlineMs:Date.parse(AT)-1}).status,'held');assert.equal(h.lookups,0)
 h.hook=()=>({...observation(h.state),repositoryId:'other/repo'})
 assert.equal(h.call().status,'held');assert.equal(h.state.terminal.status,'held');assert.deepEqual(h.state.checks.observedChecks.map(c=>c.status),['missing'])
 for(const options of [{pollIntervalMs:0},{deadlineMs:Infinity}])assert.throws(()=>h.call(options))
})

test('new green evidence clears a previous provider hold even if terminal reconciliation crashes',()=>{
 const h=harness();h.hook=()=>finalizeCiObservation(ciRequest(h.state),{hold:{kind:'auth',remedy:'restore auth'},observedAt:AT});assert.equal(h.call().status,'held')
 h.advance(1000);h.hook=()=>observation(h.state,'green',new Date(Date.parse(AT)+1000).toISOString());h.deps.checkpoint=label=>{if(label==='after-persist')throw Error('crash')}
 assert.throws(()=>h.call(),/crash/);h.deps.checkpoint=()=>{}
 assert.equal(h.call().status,'green');assert.equal(h.lookups,2)
})

import {cpSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname,join} from 'node:path'
import {spawn} from 'node:child_process'
import {persistArcDelivery,transitionArcDelivery,loadArcDelivery} from './delivery.mjs'

test('two real processes share one monitor lease and retain one durable observation',{timeout:60000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'zr-ci-monitor-')),children=[]
 try{
  const schema=join(root,'docs/roadmap/lib/schema.ts');mkdirSync(dirname(schema),{recursive:true});cpSync(new URL('../../../../docs/roadmap/lib/schema.ts',import.meta.url),schema)
  writeFileSync(join(root,'docs/roadmap/roadmap.config.json'),JSON.stringify({configVersion:1}));symlinkSync(new URL('../../node_modules',import.meta.url),join(root,'node_modules'),'dir')
  const initial=receipt(),pullRequest=initial.pullRequest;initial.pullRequest=null;initial.terminal={status:'preparing',headSha:HEAD,reason:null};persistArcDelivery(root,null,initial)
  const ready=transitionArcDelivery(root,'ARC',{type:'observe-pr',deliveryKey:initial.deliveryKey,targetKey:'target',expectedRevision:0,at:AT,pullRequest})
  const observed=observation(ready,'pending'),lookupLog=join(root,'lookups')
  const program=`import {monitorDelivery} from ${JSON.stringify(new URL('./ci-monitor.mjs',import.meta.url).href)};import {appendFileSync} from 'node:fs';process.send('ready');process.once('message',()=>{try{const result=monitorDelivery({root:${JSON.stringify(root)},arcId:'ARC',pollIntervalMs:30000,deadlineMs:${Date.parse(AT)+60000},provider:{lookup(){appendFileSync(${JSON.stringify(lookupLog)},'lookup\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,300);return ${JSON.stringify(observed)}}}},{clock:()=>${JSON.stringify(AT)}});process.stdout.write(JSON.stringify({status:result.status,source:result.source}));process.disconnect()}catch(e){process.stderr.write(e.stack);process.exitCode=1;process.disconnect()}})`
  for(let i=0;i<2;i++){
   const child=spawn(process.execPath,['--input-type=module','-e',program],{stdio:['ignore','pipe','pipe','ipc']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b)
   const done=new Promise(resolve=>{child.once('error',error=>resolve({error}));child.once('exit',code=>resolve({code,stdout,stderr}))})
   children.push({child,done,ready:Promise.race([new Promise(resolve=>child.once('message',resolve)),done])})
  }
  assert.deepEqual(await Promise.all(children.map(c=>c.ready)),['ready','ready']);for(const c of children)c.child.send('go')
  const outcomes=await Promise.all(children.map(c=>c.done));assert.ok(outcomes.every(o=>o.code===0),JSON.stringify(outcomes))
  assert.deepEqual(outcomes.map(o=>JSON.parse(o.stdout).source).sort(),['cache','fresh'])
  assert.equal(readFileSync(lookupLog,'utf8'),'lookup\n');assert.equal(loadArcDelivery(root,'ARC').revision,2)
 }finally{for(const c of children)if(c.child.exitCode===null&&c.child.signalCode===null)c.child.kill('SIGKILL');await Promise.all(children.map(c=>c.done));rmSync(root,{recursive:true,force:true})}
})

test('same-millisecond deadline hold invalidates prior green with ordered ledger time',()=>{
 const h=harness();h.call();const before=h.state.checks.observedAt
 const result=h.call({deadlineMs:Date.parse(AT)})
 assert.equal(result.status,'held');assert.equal(h.state.terminal.status,'held');assert.equal(h.state.checks.observedChecks[0].status,'missing')
 assert.ok(Date.parse(h.state.checks.observedAt)>Date.parse(before));assert.equal(h.state.updatedAt,h.state.checks.observedAt)
 assert.equal(h.call().source,'cache');assert.equal(h.lookups,1)
})
test('CAS churn between evidence and hold writes returns superseded instead of throwing',()=>{
 const h=harness();h.hook=()=>finalizeCiObservation(ciRequest(h.state),{hold:{kind:'auth',remedy:'restore auth'},observedAt:AT})
 h.deps.checkpoint=label=>{if(label==='after-persist'){const next=h.state;next.revision++;next.terminal={status:'held',headSha:HEAD,reason:'another writer'};h.state=next}}
 const result=h.call();assert.equal(result.status,'superseded');assert.equal(h.state.terminal.reason,'another writer');assert.equal(h.lookups,1)
})
