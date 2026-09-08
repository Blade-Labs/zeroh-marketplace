import {test} from 'node:test'
import assert from 'node:assert/strict'
import {assertCiRequest, finalizeCiObservation, ExactHeadCiResultShape} from './ci.mjs'
const SHA='a'.repeat(40),BASE='b'.repeat(40),AT='2026-09-08T00:00:00.000Z'
const request=(patch={})=>({providerId:'github',repositoryId:'blade/roadmap',providerPullRequestId:'PR_7',sourceHeadSha:SHA,baseSha:BASE,requiredChecks:['lint','unit'],headMode:'source',mergeQueue:null,...patch})
const check=(name,patch={})=>({key:`check-run:7:${name}`,name,source:'check-run',appId:7,verdict:'green',latestAttemptId:'1',attempts:[{attemptId:'1',suiteId:'7',runNumber:null,runAttempt:null,status:'completed',conclusion:'success',startedAt:AT,completedAt:AT,detailsUrl:null,logRefs:[],artifactRefs:[]}],...patch})
test('CI green binds exact source/base and every configured check identity',()=>{
 const result=finalizeCiObservation(request(),{checks:[check('unit'),check('lint'),check('optional')],observedAt:AT})
 assert.equal(result.rollup,'green');assert.equal(result.sourceHeadSha,SHA);assert.equal(result.testedHeadSha,SHA);assert.equal(result.baseSha,BASE)
 assert.deepEqual(result.checks.map(c=>c.name),['lint','unit']);assert.deepEqual(ExactHeadCiResultShape.parse(result),result)
 for(const patch of [{requiredChecks:[]},{requiredChecks:['unit','unit']},{sourceHeadSha:'main'},{unexpected:true},{headMode:'merge-queue',mergeQueue:null}])assert.throws(()=>assertCiRequest(request(patch)))
})
test('missing, pending, red and ambiguous checks never reuse other green',()=>{
 assert.equal(finalizeCiObservation(request(),{checks:[check('unit')],observedAt:AT}).rollup,'pending')
 for(const [status,conclusion,verdict] of [['in_progress',null,'pending'],['completed','failure','red'],['completed','unrecognized','held']]){
  const row=check('unit');Object.assign(row.attempts[0],{status,conclusion,completedAt:status==='completed'?AT:null});row.verdict=verdict
  assert.equal(finalizeCiObservation(request(),{checks:[row,check('lint')],observedAt:AT}).rollup,verdict)
 }
 const duplicate=check('unit',{key:'check-run:8:unit',appId:8})
 const out=finalizeCiObservation(request({requiredChecks:['unit']}),{checks:[check('unit'),duplicate],observedAt:AT})
 assert.equal(out.rollup,'held');assert.equal(out.hold.kind,'ambiguous-check')
})
test('result schema rejects forged green, unknown fields and inconsistent attempt evidence',()=>{
 const good=finalizeCiObservation(request(),{checks:[check('unit'),check('lint')],observedAt:AT})
 for(const mutate of [v=>v.testedHeadSha='c'.repeat(40),v=>v.checks.pop(),v=>v.checks[0].attempts[0].conclusion='failure',v=>v.checks[0].latestAttemptId='absent',v=>v.extra=true,v=>v.checks[0].attempts[0].extra=true]){
  const changed=structuredClone(good);mutate(changed);assert.throws(()=>ExactHeadCiResultShape.parse(changed))
 }
})
test('merge queue observation keeps source identity separate and named failures hold',()=>{
 const q={entryId:'MQ_1',sourceHeadSha:SHA,mergeHeadSha:'c'.repeat(40)}
 const r=request({headMode:'merge-queue',mergeQueue:q})
 const out=finalizeCiObservation(r,{checks:[check('unit'),check('lint')],observedAt:AT});assert.equal(out.testedHeadSha,q.mergeHeadSha);assert.equal(out.sourceHeadSha,SHA)
 assert.throws(()=>assertCiRequest({...r,mergeQueue:{...q,sourceHeadSha:BASE}}))
 const held=finalizeCiObservation(request(),{hold:{kind:'quota',remedy:'Wait for the provider quota, then resume.'},observedAt:AT});assert.equal(held.rollup,'held');assert.equal(held.hold.kind,'quota')
})

test('a caller cannot select an older green attempt over a newer failure',()=>{
 const row=check('unit');row.attempts.push({...row.attempts[0],attemptId:'2',conclusion:'failure',startedAt:'2026-09-08T00:01:00.000Z',completedAt:'2026-09-08T00:02:00.000Z'})
 assert.throws(()=>finalizeCiObservation(request({requiredChecks:['unit']}),{checks:[row],observedAt:AT}))
})
