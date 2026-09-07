import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGitHubPullRequestProvider } from './github.mjs'
const SHA0='0'.repeat(40),SHA1='1'.repeat(40),AT='2026-09-07T00:00:00.000Z'
const context={root:'/repo',ownerArcId:'A',cwd:'/repo',remote:'origin',presentation:{title:'Arc A',body:'Body'}}
const target={targetKey:JSON.stringify(['arc','A']),providerId:'github',repositoryId:'blade/roadmap',baseRef:'refs/heads/main',headRef:'refs/heads/roadmap/arc-safe',currentBaseSha:SHA0,currentHeadSha:SHA1}
const deliveryKey=JSON.stringify(['github','blade/roadmap',target.targetKey]),expected={revision:4,deliveryKey,...target,providerPullRequestId:null}
const action={actionKey:'create-1',kind:'create-pr',targetKey:target.targetKey,requested:{baseSha:SHA0,headSha:SHA1,ref:target.headRef,authorityId:null},status:'requested',attempts:[]}
const stored={schemaVersion:1,revision:4,arcId:'A',deliveryKey,target,strategy:{kind:'independent',arcId:'A'},requested:{terminal:'open',allowedPushRefs:[target.headRef],requiredCapabilities:['pull-request'],requiredChecks:['unit'],authority:{queue:null,merge:null}},actions:[action],pullRequest:null,checks:null,terminal:{status:'preparing',headSha:SHA1,reason:null},createdAt:AT,updatedAt:AT}
const marker=`<!-- zeroh-roadmap-delivery:v1:${Buffer.from(deliveryKey).toString('base64url')} -->`
const pr={id:17,node_id:'PR_17',number:17,html_url:'https://github.com/blade/roadmap/pull/17',state:'open',draft:false,body:marker,head:{sha:SHA1,ref:'roadmap/arc-safe',repo:{full_name:'blade/roadmap'}},base:{sha:SHA0,ref:'main',repo:{full_name:'blade/roadmap'}}}
const ok=value=>({status:0,stdout:typeof value==='string'?value:JSON.stringify(value),stderr:''})
function harness(routes={},delivery=stored){
 const calls=[],execFile=(file,args,opts)=>{
  calls.push([file,structuredClone(args),opts]);const key=`${file} ${args.join(' ')}`
  for(const [pattern,result] of Object.entries(routes).sort((a,b)=>b[0].length-a[0].length))if(key.includes(pattern))return result
  if(args.includes('--version')||args.join(' ')==='auth status')return ok('available')
  throw new Error(`Unexpected command ${key}`)
 }
 const provider=createGitHubPullRequestProvider({execFile,git:'git',clock:()=>AT,loadDelivery:()=>delivery,withLock:(_key,fn)=>fn()})
 return {provider,calls}
}
const readyRoutes={
 'git remote get-url -- origin':ok('git@github.com:blade/roadmap.git\n'),
 'git remote get-url --push -- origin':ok('git@github.com:blade/roadmap.git\n'),
 'git ls-remote --exit-code --refs origin refs/heads/main':ok(`${SHA0}\trefs/heads/main\n`),
 'git ls-remote --exit-code --refs origin refs/heads/roadmap/arc-safe':ok(`${SHA1}\trefs/heads/roadmap/arc-safe\n`),
 'gh api repos/blade/roadmap':ok({id:7,node_id:'R_7',full_name:'blade/roadmap',permissions:{push:true},allow_merge_commit:true}),
 'gh api repos/blade/roadmap/pulls':ok([]),
}
test('preflight resolves exact remote repository with argv commands',()=>{
 const {provider,calls}=harness(readyRoutes),result=provider.preflight({operation:'create',context,repositoryId:'blade/roadmap'})
 assert.equal(result.status,'ready');assert.ok(calls.some(([file,args])=>file==='git'&&args.join('\0')==='remote\0get-url\0--\0origin'));assert.ok(calls.some(([file,args])=>file==='gh'&&args.includes('repos/blade/roadmap')))
 for(const [file,args] of calls){assert.ok(['git','gh'].includes(file));assert.ok(Array.isArray(args))}
})
test('hostile remote name is inert data and wrong repository holds before mutation',()=>{
 const hostile={...context,remote:'origin; touch /tmp/owned',presentation:{title:'$(touch /tmp/title)',body:'`touch /tmp/body`'}},{provider,calls}=harness({'git remote get-url -- origin; touch /tmp/owned':ok('git@github.com:other/repository.git\n')})
 const result=provider.preflight({operation:'create',context:hostile,repositoryId:'blade/roadmap'})
 assert.equal(result.status,'held');assert.equal(result.resumable,true);assert.match(result.kind,/repository|remote|identity/)
 assert.ok(calls.some(([file,args])=>file==='git'&&JSON.stringify(args)===JSON.stringify(['remote','get-url','--','origin; touch /tmp/owned'])))
 assert.equal(calls.some(([,args])=>args.includes('POST')||args.includes('PATCH')),false)
})
test('tool, auth, permission, quota and unsupported errors produce resumable holds',()=>{
 for(const [kind,failure] of [['missing-tool',{status:null,stdout:'',stderr:'spawn gh ENOENT'}],['auth',{status:1,stdout:'',stderr:'HTTP 401 Bad credentials'}],['permission',{status:1,stdout:'',stderr:'HTTP 403 Resource not accessible'}],['quota',{status:1,stdout:'',stderr:'HTTP 429 rate limit exceeded'}],['unsupported',{status:1,stdout:'',stderr:'unknown command or field'}]]){
  const {provider}=harness({...readyRoutes,'gh api repos/blade/roadmap':failure}),result=provider.preflight({operation:'create',context,repositoryId:'blade/roadmap'})
  assert.equal(result.status,'held',kind);assert.equal(result.kind,kind);assert.equal(result.resumable,true);assert.equal(typeof result.remedy,'string')
 }
})
test('create posts one nondraft PR with stable marker after durable authorization',()=>{
 const {provider,calls}=harness({...readyRoutes,'gh api --method POST repos/blade/roadmap/pulls':ok(pr)}),result=provider.create({action,expected,context})
 assert.equal(result.status,'succeeded');assert.equal(result.actionKey,'create-1');assert.equal(result.pullRequest.providerPullRequestId,'PR_17')
 const posts=calls.filter(([file,args])=>file==='gh'&&args.includes('POST')&&args.includes('repos/blade/roadmap/pulls'));assert.equal(posts.length,1)
 const argv=posts[0][1];assert.ok(argv.includes('head=roadmap/arc-safe'));assert.ok(argv.includes('base=main'));assert.ok(argv.includes('draft=false'));assert.ok(argv.some(arg=>arg.includes('Arc A')));assert.ok(argv.find(arg=>arg.startsWith('body=')).includes(marker))
})
test('unknown create retry reuses exact marked PR and absent durable action never mutates',()=>{
 const unknown=structuredClone(stored);unknown.actions[0].status='unknown';unknown.actions[0].attempts=[{attempt:1,startedAt:AT,finishedAt:null,observed:null}]
 const matched=harness({...readyRoutes,'gh api repos/blade/roadmap/pulls':ok([pr])},unknown),result=matched.provider.create({action:unknown.actions[0],expected,context})
 assert.equal(result.status,'succeeded');assert.equal(matched.calls.some(([,args])=>args.includes('POST')),false)
 const absent=harness(readyRoutes,{...stored,actions:[]});assert.equal(absent.provider.create({action,expected,context}).status,'refused');assert.equal(absent.calls.length,0)
})

test('a separate push URL cannot send authorized commits to another repository',()=>{
 const {provider,calls}=harness({...readyRoutes,'git remote get-url --push -- origin':ok('git@github.com:other/repo.git\n')})
 const result=provider.preflight({operation:'push',context,repositoryId:'blade/roadmap'})
 assert.equal(result.status,'held');assert.equal(result.kind,'repository');assert.equal(calls.some(([,args])=>args[0]==='push'),false)
})
test('lookup ignores title-only matches and refuses duplicate stable markers',()=>{
 const none=harness({...readyRoutes,'gh api repos/blade/roadmap/pulls':ok([[{...pr,body:'without marker',title:'Arc A'}]])});assert.equal(none.provider.lookup({...expected,context}),null)
 const duplicates=harness({...readyRoutes,'gh api repos/blade/roadmap/pulls':ok([[pr,{...pr,node_id:'PR_18',number:18}]])}),ambiguous=duplicates.provider.lookup({...expected,context});assert.equal(ambiguous.status,'refused');assert.equal(ambiguous.kind,'ambiguous')
})
test('only proven non-fast-forward with verified normalization can use exact force lease',()=>{
 const OLD='4'.repeat(40),NEW='5'.repeat(40),pushAction={...action,actionKey:'push-1',kind:'push',requested:{baseSha:SHA0,headSha:NEW,ref:target.headRef,authorityId:null}},pushStored={...stored,actions:[pushAction]},calls=[]
 let observations=0,receiptLoads=0,ancestryStatus=1
 const execFile=(file,args)=>{calls.push([file,[...args]])
  if(args[0]==='remote')return ok('git@github.com:blade/roadmap.git\n')
  if(args.includes('--version')||args.join(' ')==='auth status')return ok('available')
  if(file==='gh'&&args.includes('repos/blade/roadmap'))return readyRoutes['gh api repos/blade/roadmap']
  if(args[0]==='ls-remote')return ok(`${observations++?NEW:OLD}\t${target.headRef}\n`)
  if(args[0]==='merge-base')return {status:ancestryStatus,stdout:'',stderr:''}
  if(args[0]==='push')return ok('pushed')
  throw new Error('unexpected command')
 }
 const provider=createGitHubPullRequestProvider({execFile,git:'git',clock:()=>AT,loadDelivery:()=>pushStored,withLock:(_key,fn)=>fn(),loadNormalizationReceipt:()=>{receiptLoads++;return {kind:'published-corrections',arcId:'A',publishedRef:target.headRef,expectedOld:OLD,newHead:NEW,planDigest:'a'.repeat(64)}}})
 const request={action:pushAction,expected,context},absent=provider.push(request);assert.equal(absent.kind,'rewrite-unproven');assert.equal(calls.some(([,args])=>args[0]==='push'),false)
 const withReceipt={...request,expected:{...expected,normalizationReceipt:{planDigest:'a'.repeat(64)}}}
 calls.length=0;observations=0;ancestryStatus=128
 assert.equal(provider.push(withReceipt).kind,'ancestry-unobserved');assert.equal(receiptLoads,0);assert.equal(calls.some(([,args])=>args[0]==='push'),false)
 calls.length=0;observations=0;ancestryStatus=1
 assert.equal(provider.push(withReceipt).status,'succeeded');assert.equal(receiptLoads,1)
 assert.deepEqual(calls.filter(([,args])=>args[0]==='push'),[['git',['push','--porcelain',`--force-with-lease=${target.headRef}:${OLD}`,'--','origin',`${NEW}:${target.headRef}`]]])
})
test('queue and merge use exact-head GraphQL and reconcile completed outcomes without another mutation',()=>{
 for(const kind of ['queue','merge']){
  const terminalAction={...action,actionKey:`${kind}-1`,kind,requested:{...action.requested,authorityId:'grant'}},prReceipt={providerId:'github',repositoryId:target.repositoryId,targetKey:target.targetKey,providerPullRequestId:'PR_17',number:17,url:pr.html_url,state:'open',draft:false,baseRef:target.baseRef,headRef:target.headRef,baseSha:SHA0,headSha:SHA1,observedAt:AT}
  const terminalState={...stored,actions:[terminalAction],pullRequest:prReceipt,requested:{...stored.requested,terminal:kind,authority:{queue:kind==='queue'?{authorityId:'grant',recordedAt:AT}:null,merge:kind==='merge'?{authorityId:'grant',recordedAt:AT}:null}},checks:{providerId:'github',repositoryId:target.repositoryId,providerPullRequestId:'PR_17',headSha:SHA1,requiredChecks:['unit'],observedChecks:[{name:'unit',status:'green',attemptId:null,observedAt:AT}],observedAt:AT}}
  const calls=[],MERGED='6'.repeat(40);let completed=false,queueAvailable=true
  const execFile=(file,args)=>{
   calls.push([file,[...args]])
   if(args[0]==='remote')return ok('git@github.com:blade/roadmap.git\n')
   if(args.includes('--version')||args.join(' ')==='auth status')return ok('available')
   if(args.includes('graphql')){
    const query=args.find(a=>a.startsWith('query='))
    if(query.startsWith('query=mutation')){
     completed=true
     const payload=kind==='queue'?{mergeQueueEntry:{id:'MQ_1',headCommit:{oid:SHA1}}}:{pullRequest:{id:'PR_17',merged:true,mergeCommit:{oid:MERGED}}}
     return ok({data:{[kind==='queue'?'enqueuePullRequest':'mergePullRequest']:payload}})
    }
    return ok({data:{node:{id:'PR_17',headRefOid:SHA1,mergeQueue:queueAvailable?{id:'MQ'}:null,merged:completed&&kind==='merge',mergeCommit:completed&&kind==='merge'?{oid:MERGED}:null,mergeQueueEntry:completed&&kind==='queue'?{id:'MQ_1',headCommit:{oid:SHA1}}:null}}})
   }
   if(args[1]?.startsWith('repos/blade/roadmap/pulls'))return ok([[{...pr,...(completed&&kind==='merge'?{state:'closed',merged_at:AT}:{})}]])
   if(args.includes('repos/blade/roadmap'))return readyRoutes['gh api repos/blade/roadmap']
   throw new Error('unexpected command')
  }
  const provider=createGitHubPullRequestProvider({execFile,clock:()=>AT,loadDelivery:()=>terminalState,withLock:(_key,fn)=>fn()}),request={action:terminalAction,expected:{...expected,providerPullRequestId:'PR_17'},context}
  if(kind==='queue'){queueAvailable=false;assert.equal(provider.queue(request).kind,'unsupported');assert.equal(calls.some(([,args])=>args.some(a=>a.startsWith('query=mutation'))),false);queueAvailable=true;calls.length=0}
  const first=provider[kind](request);assert.equal(first.status,'succeeded',JSON.stringify(first))
  const mutation=calls.find(([,args])=>args.some(a=>a.startsWith('query=mutation')))[1];assert.ok(mutation.includes(`head=${SHA1}`));assert.ok(mutation.includes(`key=${terminalAction.actionKey}`));assert.ok(mutation.some(a=>a.includes('expectedHeadOid:$head')))
  calls.length=0;const replay=provider[kind](request);assert.equal(replay.status,'succeeded');assert.equal(replay.providerActionId,first.providerActionId);assert.equal(calls.some(([,args])=>args.some(a=>a.startsWith('query=mutation'))),false)
 }
})
