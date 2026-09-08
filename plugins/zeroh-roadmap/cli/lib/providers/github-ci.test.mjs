import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createGitHubCiProvider} from './github-ci.mjs'
const SHA='a'.repeat(40),BASE='b'.repeat(40),AT='2026-09-08T00:05:00.000Z'
const request=(over={})=>({providerId:'github',repositoryId:'blade/roadmap',providerPullRequestId:'PR_7',sourceHeadSha:SHA,baseSha:BASE,requiredChecks:['check-run:7:unit','lint'],headMode:'source',mergeQueue:null,...over})
const rawRun=(over={})=>({id:11,name:'unit',head_sha:SHA,app:{id:7},check_suite:{id:70},status:'completed',conclusion:'success',started_at:'2026-09-08T00:01:00Z',completed_at:'2026-09-08T00:02:00Z',details_url:'https://checks/11',...over})
const rawStatus=(over={})=>({id:21,context:'lint',state:'success',target_url:'https://status/21',created_at:'2026-09-08T00:01:00Z',updated_at:'2026-09-08T00:02:00Z',...over})
const pr=(over={})=>({id:'PR_7',state:'OPEN',isDraft:false,headRefOid:SHA,baseRefOid:BASE,repository:{nameWithOwner:'blade/roadmap'},...over})
const ok=value=>({status:0,stdout:JSON.stringify(value),stderr:''})
function harness({checkPages=[{total_count:1,check_runs:[rawRun()]}],statusPages=[[rawStatus()]],statusFirstPage=null,heads=[pr(),pr()],failure,clock=()=>AT,sleep=async()=>{}}={}){
 const calls=[];let observation=0
 const ci=createGitHubCiProvider({clock,sleep,execFile:(file,args,opts)=>{
  calls.push([file,[...args],opts]);assert.equal(file,'gh');assert.equal(args[0],'api');assert.ok(Number.isFinite(opts.timeout)&&opts.timeout>0)
  if(args[1]==='graphql')return ok({data:{node:heads[Math.min(observation++,heads.length-1)]}})
  if(failure)return failure
  if(args[1]===`repos/blade/roadmap/commits/${SHA}/check-runs?filter=all&per_page=100`){assert.ok(args.includes('--paginate'));assert.ok(args.includes('--slurp'));return ok(typeof checkPages==='function'?checkPages():checkPages)}
  if(args[1]===`repos/blade/roadmap/commits/${SHA}/statuses?per_page=100`){const paginated=args.includes('--paginate');assert.equal(args.includes('--slurp'),paginated);return ok(paginated?statusPages:(statusFirstPage??statusPages[0]))}
  throw Error('Unexpected GitHub route: '+args[1])
 }})
 return {ci,calls}
}
test('real GitHub envelopes preserve rerun history and literal exact-head argv',()=>{
 const old=rawRun({id:10,conclusion:'failure',started_at:'2026-09-08T00:00:00Z',completed_at:'2026-09-08T00:01:00Z'}),latest=rawRun()
 const {ci,calls}=harness({checkPages:[{total_count:2,check_runs:[old,latest]},{total_count:2,check_runs:[structuredClone(latest)]}]})
 const result=ci.lookup(request());assert.equal(result.rollup,'green')
 const row=result.checks.find(c=>c.name==='unit');assert.deepEqual(row.attempts.map(a=>[a.attemptId,a.runNumber,a.runAttempt]),[['10',null,null],['11',null,null]]);assert.equal(row.latestAttemptId,'11')
 assert.equal(calls.filter(([,args])=>args[1]==='graphql').length,2)
 assert.equal(calls.filter(([,args])=>args[1].includes('/commits/'+SHA+'/')).length,3)
})
test('conflicting identities, ambiguous latest attempts and truncated pagination hold',()=>{
 const cases=[
  [{total_count:2,check_runs:[rawRun(),rawRun({conclusion:'failure'})]}],
  [{total_count:2,check_runs:[rawRun({status:'in_progress',conclusion:null,completed_at:null}),rawRun({id:12,status:'queued',conclusion:null,completed_at:null})]}],
  [{total_count:2,check_runs:[rawRun()]}],
 ]
 for(const checkPages of cases){const result=harness({checkPages}).ci.lookup(request());assert.equal(result.rollup,'held');assert.ok(result.hold.remedy)}
})
test('plain names cannot silently choose between status and app identities',()=>{
 const result=harness({statusPages:[[rawStatus({context:'unit'})]]}).ci.lookup(request({requiredChecks:['unit']}));assert.equal(result.rollup,'held');assert.equal(result.hold.kind,'ambiguous-check')
})
test('latest red, pending and missing checks cannot borrow an older green',()=>{
 for(const [row,want] of [[rawRun({conclusion:'failure'}),'red'],[rawRun({status:'in_progress',conclusion:null,completed_at:null}),'pending'],[rawRun({name:'other'}),'pending']]){
  const result=harness({checkPages:[{total_count:1,check_runs:[row]}]}).ci.lookup(request());assert.equal(result.rollup,want)
 }
})
test('PR source/base drift before or during observation and wrong check head hold',()=>{
 for(const over of [{headRefOid:'c'.repeat(40)},{baseRefOid:'d'.repeat(40)},{isDraft:true},{repository:{nameWithOwner:'other/repo'}}]){
  assert.equal(harness({heads:[pr(),pr(over)]}).ci.lookup(request()).rollup,'held')
 }
 assert.equal(harness({checkPages:[{total_count:1,check_runs:[rawRun({head_sha:'e'.repeat(40)})]}]}).ci.lookup(request()).rollup,'held')
})
test('provider quota/auth and malformed responses return actionable holds',()=>{
 for(const [stderr,kind] of [['HTTP 429 rate limit','quota'],['HTTP 401 Bad credentials','auth']]){
  const result=harness({failure:{status:1,stdout:'',stderr}}).ci.lookup(request());assert.equal(result.rollup,'held');assert.equal(result.hold.kind,kind)
 }
 assert.equal(harness({checkPages:{check_runs:[]}}).ci.lookup(request()).rollup,'held')
})
test('watch refuses expired work, observes pending to green and stops at its original deadline',async()=>{
 let now=0,poll=0
 const observations=[]
 const {ci,calls}=harness({clock:()=>new Date(now).toISOString(),sleep:async ms=>{now+=ms},checkPages:()=>[{total_count:1,check_runs:[rawRun(poll++?{}:{status:'in_progress',conclusion:null,completed_at:null})]}]})
 const result=await ci.watch(request(),{pollIntervalMs:1000,deadlineMs:3000,onObservation:x=>observations.push(x.rollup)});assert.equal(result.rollup,'green');assert.deepEqual(observations,['pending','green'])
 now=4000;const before=calls.length;const expired=await ci.watch(request(),{pollIntervalMs:1000,deadlineMs:3000});assert.equal(expired.rollup,'held');assert.equal(calls.length,before)
 const pending=harness({clock:()=>new Date(now).toISOString(),sleep:async ms=>{now+=ms},checkPages:[{total_count:1,check_runs:[rawRun({status:'queued',conclusion:null,completed_at:null})]}]})
 const timeout=await pending.ci.watch(request(),{pollIntervalMs:1000,deadlineMs:4500});assert.equal(timeout.rollup,'held');assert.equal(now,4500)
 for(const options of [{pollIntervalMs:0,deadlineMs:1000},{pollIntervalMs:1,deadlineMs:Infinity}])await assert.rejects(()=>ci.watch(request(),options))
})

test('malformed supplied check-suite identities hold instead of becoming absent',()=>{
 for(const id of [0,-1,'70',1.5]){
  const result=harness({checkPages:[{total_count:1,check_runs:[rawRun({check_suite:{id}})]}]}).ci.lookup(request())
  assert.equal(result.rollup,'held',String(id));assert.equal(result.hold.kind,'unknown-state')
 }
 for(const check_suite of [null,undefined])assert.equal(harness({checkPages:[{total_count:1,check_runs:[rawRun({check_suite})]}]}).ci.lookup(request()).rollup,'green')
})

test('unproven merge queue binding stays held without borrowing PR preview checks',()=>{
 const mergeHeadSha='f'.repeat(40),{ci,calls}=harness({heads:[pr({potentialMergeCommit:{oid:mergeHeadSha}})]})
 const result=ci.lookup(request({headMode:'merge-queue',mergeQueue:{entryId:'MQ_1',sourceHeadSha:SHA,mergeHeadSha}}))
 assert.equal(result.rollup,'held');assert.equal(result.hold.kind,'unsupported');assert.equal(result.sourceHeadSha,SHA);assert.match(result.hold.remedy,/authoritative queue binding/);assert.equal(calls.length,0)
})


test('duplicate commit-status identity across slurped pages never certifies an old green snapshot',()=>{
 const duplicated=rawStatus({id:21,state:'success'})
 const result=harness({statusPages:[[duplicated],[structuredClone(duplicated)]],heads:[pr(),pr()]}).ci.lookup(request())
 assert.notEqual(result.rollup,'green')
 assert.equal(result.rollup,'held')
 assert.ok(['incomplete-pagination','ambiguous-check','unknown-state'].includes(result.hold.kind),result.hold.kind)
})

test('unchanged complete commit-status pages retain exact-head green',()=>{
 const result=harness({statusPages:[
  [rawStatus({id:22,context:'advisory',state:'success',created_at:'2026-09-08T00:03:00Z',updated_at:'2026-09-08T00:04:00Z'})],
  [rawStatus({id:21,context:'lint',state:'success'})],
 ],heads:[pr(),pr()]}).ci.lookup(request())
 assert.equal(result.rollup,'green',result.hold?.remedy)
 assert.equal(result.sourceHeadSha,SHA)
 assert.equal(result.testedHeadSha,SHA)
 assert.equal(result.checks.find(row=>row.key==='commit-status:lint').latestAttemptId,'21')
})


test('a newly inserted red status between pagination and first-page verification holds the snapshot',()=>{
 const oldGreen=rawStatus({id:21,state:'success'})
 const insertedRed=rawStatus({id:22,state:'failure',created_at:'2026-09-08T00:03:00Z',updated_at:'2026-09-08T00:04:00Z'})
 const {ci,calls}=harness({statusPages:[[oldGreen]],statusFirstPage:[insertedRed,oldGreen],heads:[pr(),pr()]})
 const result=ci.lookup(request())
 assert.equal(result.rollup,'held')
 assert.ok(['incomplete-pagination','ambiguous-check','unknown-state'].includes(result.hold.kind),result.hold.kind)
 assert.equal(calls.filter(([,args])=>args[1].includes('/statuses?')).length,2)
})

test('an unchanged first status page verifies a complete multipage snapshot',()=>{
 const first=[rawStatus({id:22,context:'advisory',state:'success',created_at:'2026-09-08T00:03:00Z',updated_at:'2026-09-08T00:04:00Z'})]
 const second=[rawStatus({id:21,context:'lint',state:'success'})]
 const {ci,calls}=harness({statusPages:[first,second],statusFirstPage:structuredClone(first),heads:[pr(),pr()]})
 const result=ci.lookup(request())
 assert.equal(result.rollup,'green',result.hold?.remedy)
 assert.equal(calls.filter(([,args])=>args[1].includes('/statuses?')).length,2)
})
