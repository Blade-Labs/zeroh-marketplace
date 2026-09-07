import {test} from 'node:test'
import assert from 'node:assert/strict'
import run from './deliver.mjs'
import {publishDelivery,reduceDelivery} from '../lib/delivery.mjs'
import {resolveBranchStrategy} from '../lib/branch-strategy.mjs'
const BASE='0'.repeat(40),HEAD='1'.repeat(40),AT='2026-09-07T00:00:00.000Z'
const target=id=>({targetKey:JSON.stringify(['arc',id]),providerId:'github',repositoryId:'blade/roadmap',baseRef:'refs/heads/main',headRef:`refs/heads/roadmap/arc-${id.toLowerCase()}`,currentBaseSha:BASE,currentHeadSha:HEAD})
function harness({arcId='A',strategy={A:{kind:'independent'}},existing={},bootstrap=null,planned=null}={}){
 const calls=[],out=[],err=[],receipts=structuredClone(existing)
 const chosen=planned??{status:'ready',ownerArcId:arcId,memberArcId:arcId,memberOrder:null,target:target(arcId),strategy:{kind:'independent',arcId},existing:receipts[arcId]??null}
 const policy={providerId:'github',remote:'origin',defaultBaseRef:null,terminal:'open',allowedPushRefs:null,requiredCapabilities:['create','lookup','pull-request','push','update'],requiredChecks:null,strategy}
 const provider={bootstrap(input){calls.push(['bootstrap',input]);return bootstrap??{status:'ready',providerId:'github',repositoryId:'blade/roadmap',baseRef:'refs/heads/main',baseSha:BASE,requiredChecks:['unit'],refs:{heads:{'refs/heads/main':BASE,...(chosen.target?{[chosen.target.headRef]:HEAD}:{})}}}}}
 const deps={cwd:'/repo',loadConfig:()=>({}),deliveryPolicyOf:()=>policy,loadArc:(_root,id)=>({id,name:`Arc ${id}`,baseRef:'local-only'}),listDeliveries:()=>Object.entries(receipts).map(([ownerArcId,delivery])=>({ownerArcId,delivery})),loadArcDelivery:(_root,id)=>receipts[id]??null,
 resolveBranchStrategy(input){calls.push(['resolve',input]);return chosen},createProvider:()=>provider,gitHead:()=>HEAD,clock:()=>AT,
 transitionArcDelivery(_root,id,event){calls.push(['transition',event]);receipts[id]=reduceDelivery(receipts[id]??null,event);return receipts[id]},
 publishDelivery(request){calls.push(['publish',request]);const state=receipts[request.arcId],t=state.target,pullRequest={providerId:t.providerId,repositoryId:t.repositoryId,targetKey:t.targetKey,providerPullRequestId:'PR_7',number:7,url:null,state:'open',draft:false,baseRef:t.baseRef,headRef:t.headRef,baseSha:t.currentBaseSha,headSha:t.currentHeadSha,observedAt:AT};state.pullRequest=pullRequest;return {status:'published',delivery:state,pullRequest,reason:null}},stdout:value=>out.push(value),stderr:value=>err.push(value)}
 return {deps,calls,out,err,receipts,policy}
}
test('fresh delivery initializes least authority and returns one awaiting-ci JSON result',async()=>{
 const h=harness();assert.equal(await run(['A','--json'],h.deps),0,h.err.join(''))
 const state=h.receipts.A;assert.equal(state.terminal.status,'awaiting-ci');assert.equal(state.pullRequest.draft,false)
 assert.deepEqual(state.requested.allowedPushRefs,[state.target.headRef]);assert.deepEqual(state.requested.requiredChecks,['unit']);assert.deepEqual(state.requested.authority,{queue:null,merge:null})
 assert.equal(h.calls.filter(([name])=>name==='publish').length,1)
 assert.deepEqual(JSON.parse(h.out.join('')),{status:'awaiting-ci',arcId:'A',ownerArcId:'A',deliveryKey:state.deliveryKey,revision:state.revision,pullRequest:Object.fromEntries(['providerId','repositoryId','providerPullRequestId','number','url','headSha'].map(key=>[key,state.pullRequest[key]])),reason:null,resume:true})
})
test('resume requires a receipt and existing delivery requires explicit resume',async()=>{
 const absent=harness();assert.equal(await run(['A','--resume','--json'],absent.deps),2);assert.equal(absent.calls.some(([n])=>n==='publish'),false)
 const fresh=harness();await run(['A','--json'],fresh.deps)
 const incumbent=harness({existing:fresh.receipts});assert.equal(await run(['A','--json'],incumbent.deps),2)
 const resumed=harness({existing:fresh.receipts});assert.equal(await run(['A','--resume','--json'],resumed.deps),0,resumed.err.join(''));assert.deepEqual(resumed.receipts.A.requested,fresh.receipts.A.requested)
})
test('group nonowner resumes sole order-zero owner without publishing its own HEAD',async()=>{
 const first=harness();await run(['A','--json'],first.deps)
 const strategy={A:{kind:'grouped',groupId:'release',order:0},B:{kind:'grouped',groupId:'release',order:1}},owner={...first.receipts.A,strategy:{kind:'grouped',groupId:'release',order:0}}
 owner.target={...owner.target,targetKey:JSON.stringify(['group','release']),headRef:'refs/heads/roadmap/group-release'};owner.deliveryKey=JSON.stringify(['github','blade/roadmap',owner.target.targetKey]);owner.requested={...owner.requested,allowedPushRefs:[owner.target.headRef]};owner.pullRequest={...owner.pullRequest,targetKey:owner.target.targetKey,headRef:owner.target.headRef}
 const planned={status:'ready',ownerArcId:'A',memberArcId:'B',memberOrder:1,target:owner.target,strategy:owner.strategy,existing:owner}
 const h=harness({arcId:'B',strategy,existing:{A:owner},planned});h.deps.gitHead=()=>{throw Error('nonowner HEAD must not be read')}
 assert.equal(await run(['B','--resume','--json'],h.deps),0,h.err.join(''));assert.equal(h.calls.find(([n])=>n==='publish')[1].arcId,'A');assert.equal(h.receipts.B,undefined)
})
test('bootstrap and planner holds make zero publication or initialization calls',async()=>{
 for(const blocked of [{bootstrap:{status:'held',kind:'auth',remedy:'authenticate GitHub',resumable:true,observedAt:AT}},{planned:{status:'held',ownerArcId:'A',memberArcId:'A',reason:'base-churn',expected:{},observed:{}}}]){
 const h=harness(blocked);assert.equal(await run(['A'],h.deps),3);assert.equal(h.calls.some(([n])=>n==='publish'||n==='transition'),false);assert.match(h.err.join(''),/resume/)
 }
})
test('explicit deny-all push policy and unresolved checks hold before receipt creation',async()=>{
 for(const setting of ['deny','checks']){const h=harness();if(setting==='deny')h.policy.allowedPushRefs=[];else h.deps.createProvider=()=>({bootstrap:()=>({status:'ready',providerId:'github',repositoryId:'blade/roadmap',baseRef:'refs/heads/main',baseSha:BASE,requiredChecks:[],refs:{heads:{'refs/heads/main':BASE}}})});assert.equal(await run(['A'],h.deps),3);assert.equal(h.calls.some(([n])=>n==='publish'||n==='transition'),false)}
})
test('unknown and duplicate flags are usage errors before loading or mutation',async()=>{
 for(const args of [[],['A','--merge'],['A','--provider'],['A','--json','--json'],['A','B'],['../A']]){const h=harness();assert.equal(await run(args,h.deps),1);assert.equal(h.calls.length,0)}
})

test('real consumer typed loading reaches read-only bootstrap and malformed arc exits as configuration error',async()=>{
 const {makeFixtureRepo,writeArcFile}=await import('../../test/fixture-consumer/harness.mjs')
 const root=makeFixtureRepo({layout:'docs'}),output=[];let bootstraps=0
 writeArcFile(root,{id:'A',name:'Fixture delivery arc',baseRef:'main',planes:[{name:'build',phases:[1]}]})
 const deps={cwd:root,stdout:text=>output.push(text),stderr:text=>output.push(text),createProvider:()=>({bootstrap(){bootstraps++;return {status:'held',remedy:'fixture auth hold'}}})}
 assert.equal(await run(['A','--json'],deps),3,output.join(''));assert.equal(bootstraps,1)
 writeArcFile(root,{id:'A',name:'bad',baseRef:'main',planes:[]});output.length=0
 assert.equal(await run(['A','--json'],deps),1,output.join(''));assert.equal(bootstraps,1)
})

function integrated(strategy){
 const h=harness({strategy}),remoteHeads={},prs=new Map(),mutations={push:0,create:0,update:0}
 const capabilities={providerId:'github',supported:['lookup','push','create','update','pull-request'],unsupported:[]}
 const provider={bootstrap:({defaultBaseRef})=>({status:'ready',providerId:'github',repositoryId:'blade/roadmap',baseRef:defaultBaseRef??'refs/heads/main',baseSha:remoteHeads[defaultBaseRef]??BASE,requiredChecks:['unit'],refs:{heads:{'refs/heads/main':BASE,...remoteHeads}}}),capabilities:()=>capabilities,preflight:({operation})=>({status:'ready',providerId:'github',repositoryId:'blade/roadmap',operation,capabilities,observedAt:AT}),lookup:request=>prs.get(request.deliveryKey)??null,
 push({action}){if(remoteHeads[action.requested.ref]!==action.requested.headSha){remoteHeads[action.requested.ref]=action.requested.headSha;mutations.push++}return {status:'succeeded',actionKey:action.actionKey,providerActionId:action.requested.headSha,errorKind:null,observedAt:AT,pullRequest:null}},
 create({action,expected}){let pr=prs.get(expected.deliveryKey);if(!pr){mutations.create++;pr={providerId:'github',repositoryId:'blade/roadmap',targetKey:expected.targetKey,providerPullRequestId:`PR_${prs.size+1}`,number:prs.size+1,url:null,state:'open',draft:false,baseRef:expected.baseRef,headRef:expected.headRef,baseSha:action.requested.baseSha,headSha:action.requested.headSha,observedAt:AT};prs.set(expected.deliveryKey,pr)}return {status:'succeeded',actionKey:action.actionKey,providerActionId:pr.providerPullRequestId,errorKind:null,observedAt:AT,pullRequest:pr}},
 update(){mutations.update++;throw Error('unexpected update')},queue(){throw Error('unauthorized queue')},merge(){throw Error('unauthorized merge')}}
 h.deps.resolveBranchStrategy=resolveBranchStrategy;h.deps.createProvider=()=>provider
 h.deps.publishDelivery=request=>publishDelivery(request,{load:h.deps.loadArcDelivery,transition:h.deps.transitionArcDelivery,withLock:(_key,fn)=>fn(),clock:()=>AT})
 return {...h,remoteHeads,prs,mutations}
}
test('real planner, publisher and reducer compose independent, stacked, grouped and duplicate-free resume',async()=>{
 const stack=integrated({A:{kind:'independent'},B:{kind:'stacked',predecessorArcId:'A'}})
 assert.equal(await run(['A','--json'],stack.deps),0,stack.out.join(''));assert.equal(await run(['B','--json'],stack.deps),0,stack.out.join(''))
 assert.equal(stack.prs.size,2);assert.notEqual(stack.receipts.A.target.targetKey,stack.receipts.B.target.targetKey);assert.equal(stack.receipts.B.target.baseRef,stack.receipts.A.target.headRef);assert.equal(stack.receipts.B.target.currentBaseSha,HEAD)
 const before=structuredClone(stack.mutations),revision=stack.receipts.A.revision
 assert.equal(await run(['A','--resume','--json'],stack.deps),0,stack.out.join(''));assert.deepEqual(stack.mutations,before);assert.equal(stack.receipts.A.revision,revision)
 const group=integrated({A:{kind:'grouped',groupId:'release',order:0},B:{kind:'grouped',groupId:'release',order:1}})
 assert.equal(await run(['B','--json'],group.deps),3);assert.equal(group.prs.size,0)
 assert.equal(await run(['A','--json'],group.deps),0,group.out.join(''));const groupBefore=structuredClone(group.mutations)
 assert.equal(await run(['B','--resume','--json'],group.deps),0,group.out.join(''));assert.deepEqual(Object.keys(group.receipts),['A']);assert.equal(group.prs.size,1);assert.deepEqual(group.mutations,groupBefore)
})
test('resume rejects explicit base/check policy drift and passes provider factory its storage seam',async()=>{
 const h=integrated({A:{kind:'independent'}});assert.equal(await run(['A'],h.deps),0)
 const before=structuredClone(h.mutations);h.policy.defaultBaseRef='refs/heads/release';h.remoteHeads['refs/heads/release']=BASE
 assert.equal(await run(['A','--resume'],h.deps),2);assert.deepEqual(h.mutations,before)
 h.policy.defaultBaseRef=null;h.policy.requiredChecks=['other'];assert.equal(await run(['A','--resume'],h.deps),2);assert.deepEqual(h.mutations,before)
 const fresh=harness();fresh.deps.createProvider=settings=>{assert.equal(settings.loadDelivery,fresh.deps.loadArcDelivery);return {bootstrap:()=>({status:'held',remedy:'fixture hold'})}};assert.equal(await run(['A'],fresh.deps),3)
})
