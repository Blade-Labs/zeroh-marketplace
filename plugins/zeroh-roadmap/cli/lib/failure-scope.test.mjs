import {test} from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,dirname} from 'node:path'
import {classifyFailureScope} from './failure-scope.mjs'
import {gateInputKey,diagnoseFailure,retryDecision} from './gate-diagnostics.mjs'
import {finalizeCiObservation} from './providers/ci.mjs'
const AT='2026-09-08T01:00:00.000Z',roots=[]
process.on('exit',()=>roots.forEach(root=>rmSync(root,{recursive:true,force:true})))
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'zr-failure-scope-'));roots.push(root)
 const git=args=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
 git(['init','-q']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.test'])
 for(const [file,body] of [['src/a.mjs','export const value=1\n'],['owned/old.test.mjs','old\n'],['other/z.test.mjs','other\n'],['tests/a.test.mjs','test\n'],['docs/roadmap/roadmap.config.json',JSON.stringify({configVersion:1,gateCommands:Object.fromEntries(['lint','types','unit','integration','build','e2e','emit'].map(key=>[key,'none']))})]]){const path=join(root,file);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,body)}
 git(['add','.']);git(['commit','-qm','base']);const baseSha=git(['rev-parse','HEAD'])
 writeFileSync(join(root,'src/a.mjs'),'export const value=2\n');git(['add','.']);git(['commit','-qm','change']);const sourceHeadSha=git(['rev-parse','HEAD'])
 const keys=['unit','other','infra'],checks=keys.map((name,i)=>({key:`check-run:7:${name}`,name,source:'check-run',appId:7,verdict:'red',latestAttemptId:String(i+1),attempts:[{attemptId:String(i+1),suiteId:'7',runNumber:null,runAttempt:null,status:'completed',conclusion:'failure',startedAt:AT,completedAt:AT,detailsUrl:null,logRefs:[],artifactRefs:[]}]}))
 const ci=finalizeCiObservation({providerId:'github',repositoryId:'blade/roadmap',providerPullRequestId:'PR_1',sourceHeadSha,baseSha,requiredChecks:keys.sort(),headMode:'source',mergeQueue:null},{checks,observedAt:AT})
 const execution=(output='not ok 1 - broken\nsrc/a.mjs:1:1 AssertionError: wrong')=>({exitCode:1,signal:null,output})
 const failure=(over={})=>({checkKey:'check-run:7:unit',attemptId:'1',command:'node --test',execution:execution(),paths:['src/a.mjs'],logRefs:['ci://unit/1'],reruns:[],...over})
 const evidence=(failures=[failure()])=>({schemaVersion:1,root,baseSha,sourceHeadSha,gateInputKey:gateInputKey(root),failures,baseReproductions:[],retryReports:[]})
 return {root,git,ci,execution,failure,evidence}
}
const byKey=(out,key='check-run:7:unit')=>out.failures.find(f=>f.checkKey===key)
test('causal classification binds real Git changes to exact failing output and attempt',()=>{
 const f=fixture(),e=f.evidence(),out=classifyFailureScope(f.ci,e)
 assert.ok(byKey(out),JSON.stringify(out));assert.equal(byKey(out).kind,'causal');assert.equal(byKey(out).editEligible,true);assert.deepEqual(out.editPaths,['src/a.mjs']);assert.deepEqual(byKey(out).diagnostic,diagnoseFailure(e.failures[0].execution))
 for(const change of [x=>x.failures[0].attemptId='old',x=>x.sourceHeadSha='a'.repeat(40),x=>x.gateInputKey='0'.repeat(64)]){const bad=structuredClone(e);change(bad);assert.deepEqual(classifyFailureScope(f.ci,bad).editPaths,[])}
})
test('caller paths and unverified positive graph edges are not causal authority',()=>{
 const f=fixture(),unlinked=f.evidence([f.failure({execution:f.execution('not ok 1 - broken\nother/z.test.mjs:1 AssertionError'),paths:['src/a.mjs']})])
 assert.equal(byKey(classifyFailureScope(f.ci,unlinked)).editEligible,false)
 const graph={baseSha:f.ci.baseSha,sourceHeadSha:f.ci.sourceHeadSha,complete:true,edges:[{from:'src/a.mjs',to:'tests/a.test.mjs'}]}
 const e=f.evidence([f.failure({paths:['tests/a.test.mjs'],execution:f.execution('not ok 1 - broken\ntests/a.test.mjs:1 AssertionError')})]);e.dependencyGraph=graph
 assert.equal(byKey(classifyFailureScope(f.ci,e)).editEligible,false)
 const trusted=classifyFailureScope(f.ci,e,{collectDependencyGraph:()=>graph});assert.equal(byKey(trusted).kind,'causal');assert.ok(trusted.editPaths.includes('src/a.mjs'))
})
test('owned pre-existing failures require loaded ownership and matching base reproduction',()=>{
 const f=fixture(),failure=f.failure({paths:['owned/old.test.mjs'],execution:f.execution('not ok 1 - old\nowned/old.test.mjs:1 AssertionError')})
 const e=f.evidence([failure]),deps={loadConfig:()=>({ciPolicy:{ownership:[{pathPrefix:'owned',owner:'ARC'}]}})}
 assert.equal(byKey(classifyFailureScope(f.ci,e,deps)).editEligible,false)
 e.baseReproductions=[{checkKey:failure.checkKey,command:failure.command,headSha:f.ci.baseSha,execution:failure.execution}]
 assert.equal(byKey(classifyFailureScope(f.ci,e,deps)).kind,'owned-preexisting');assert.equal(byKey(classifyFailureScope(f.ci,e,deps)).editEligible,true)
 assert.equal(byKey(classifyFailureScope(f.ci,e)).editEligible,false)
 const wrong=structuredClone(e);wrong.baseReproductions[0].headSha=f.ci.sourceHeadSha;assert.deepEqual(classifyFailureScope(f.ci,wrong,deps).editPaths,[])
 const narrow={loadConfig:()=>({ciPolicy:{ownership:[{pathPrefix:'owne',owner:'ARC'}]}})};assert.equal(byKey(classifyFailureScope(f.ci,e,narrow)).editEligible,false)
})
test('mixed batches retain per-failure decisions and leave unrelated/infrastructure untouched',()=>{
 const f=fixture(),other=f.failure({checkKey:'check-run:7:other',attemptId:'2',paths:['other/z.test.mjs'],execution:f.execution('not ok 1 - other\nother/z.test.mjs:1 AssertionError')})
 const infra=f.failure({checkKey:'check-run:7:infra',attemptId:'3',paths:[],execution:f.execution('HTTP 429 rate limit')})
 const e=f.evidence([f.failure(),other,infra]),graph={baseSha:f.ci.baseSha,sourceHeadSha:f.ci.sourceHeadSha,complete:true,edges:[]};e.dependencyGraph=graph;e.baseReproductions=[{checkKey:other.checkKey,command:other.command,headSha:f.ci.baseSha,execution:{exitCode:0,signal:null,output:''}}]
 const out=classifyFailureScope(f.ci,e,{collectDependencyGraph:()=>graph})
 assert.equal(out.scope,'mixed');assert.equal(byKey(out).kind,'causal');assert.equal(byKey(out,other.checkKey).kind,'unrelated');assert.equal(byKey(out,infra.checkKey).kind,'infra');assert.deepEqual(out.editPaths,['src/a.mjs'])
})
test('same-head successful rerun is noneditable; repeated failed input uses existing retry stop',()=>{
 const f=fixture(),failure=f.failure(),e=f.evidence([failure]);failure.reruns=[{headSha:f.ci.sourceHeadSha,command:failure.command,execution:{exitCode:0,signal:null,output:''}}]
 assert.equal(byKey(classifyFailureScope(f.ci,e)).kind,'flaky');assert.deepEqual(classifyFailureScope(f.ci,e).editPaths,[])
 failure.reruns=[];const diagnostic=diagnoseFailure(failure.execution),command={slot:failure.checkKey,command:failure.command}
 e.retryReports=[0,1].map(()=>({attempt:{inputKey:e.gateInputKey},slots:[{...command,exitCode:1,failure:diagnostic}]}))
 const out=classifyFailureScope(f.ci,e);assert.deepEqual(out.retryDecision,retryDecision(e.retryReports,e.gateInputKey,[command]));assert.equal(out.retryDecision.blocked,true);assert.equal(byKey(out).kind,'causal')
})
test('missing output, contradictory paths and noncanonical paths cannot authorize edits',()=>{
 const f=fixture()
 for(const failure of [f.failure({execution:f.execution(''),paths:[]}),f.failure({paths:['src/a.mjs','other/z.test.mjs']}),f.failure({paths:['../outside']}),f.failure({paths:['/src/a.mjs']})])assert.deepEqual(classifyFailureScope(f.ci,f.evidence([failure])).editPaths,[])
})

test('contradictory failed rerun cannot authorize edits to an otherwise causal path',()=>{
 const f=fixture(),failure=f.failure();failure.reruns=[{headSha:f.ci.sourceHeadSha,command:failure.command,execution:f.execution('TypeError: a different failure')}]
 const out=classifyFailureScope(f.ci,f.evidence([failure]),{loadConfig:()=>({})})
 assert.equal(byKey(out).kind,'indeterminate');assert.deepEqual(out.editPaths,[])
})
test('a different failing base reproduction is contradictory, not a clean base',()=>{
 const f=fixture(),e=f.evidence(),failure=e.failures[0]
 e.baseReproductions=[{checkKey:failure.checkKey,command:failure.command,headSha:f.ci.baseSha,execution:f.execution('TypeError: unrelated base failure')}]
 const out=classifyFailureScope(f.ci,e)
 assert.equal(byKey(out).kind,'indeterminate');assert.deepEqual(out.editPaths,[])
})


test('42.7 owned-preexisting classification uses the selected arc narrowed ownership',()=>{
 const f=fixture(),failure=f.failure({paths:['owned/old.test.mjs'],execution:f.execution('not ok 1 - old\nowned/old.test.mjs:1 AssertionError')})
 const evidence=f.evidence([failure])
 evidence.baseReproductions=[{checkKey:failure.checkKey,command:failure.command,headSha:f.ci.baseSha,execution:failure.execution}]
 const ciPolicy={ownership:[{pathPrefix:'owned',owner:'ARC'}],arcs:{ARC:{ownership:[{pathPrefix:'owned/selected',owner:'ARC'}]}}}
 const deps={loadConfig:()=>({ciPolicy})}
 const repository=classifyFailureScope(f.ci,evidence,{...deps,arcId:'OTHER'})
 assert.equal(byKey(repository).kind,'owned-preexisting')
 assert.equal(byKey(repository).editEligible,true)
 const narrowed=classifyFailureScope(f.ci,evidence,{...deps,arcId:'ARC'})
 assert.equal(byKey(narrowed).editEligible,false)
 assert.deepEqual(narrowed.editPaths,[])
})
