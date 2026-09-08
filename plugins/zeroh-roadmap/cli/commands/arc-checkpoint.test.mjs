import {test} from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import arcRun,{writeValidationCheckpoint} from './arc.mjs'
import {recordCorrectionReview} from '../lib/gate-report.mjs'
import {gateInputKey} from '../lib/gate-diagnostics.mjs'

const HERE=dirname(fileURLToPath(import.meta.url)),roots=[]
const SCHEMA=fileURLToPath(new URL('../../templates/schema.ts',import.meta.url))
const A='a'.repeat(40),B='b'.repeat(40),KEY='c'.repeat(64),AT='2026-09-08T00:00:00.000Z',LATER='2026-09-09T00:00:00.000Z'
process.on('exit',()=>roots.forEach(root=>rmSync(root,{recursive:true,force:true})))
const bounds=()=>({maxRounds:2,deadlineAt:LATER,allowedPathPrefixes:['src'],authority:{source:'session',reference:'task 42.6'}})
const checkpoint=(patch={})=>({arcId:'ARC',verdict:'GAPS',at:AT,headSha:A,note:'repair',correction:{state:'awaiting-repair',validationHead:A,gateInputKey:KEY,round:0,bounds:bounds(),route:null},...patch})
function root(){
 const root=mkdtempSync(join(tmpdir(),'zr-checkpoint-'));roots.push(root)
 mkdirSync(join(root,'roadmap','phases'),{recursive:true});mkdirSync(join(root,'lib','roadmap'),{recursive:true})
 writeFileSync(join(root,'roadmap','roadmap.config.json'),'{}\n');symlinkSync(SCHEMA,join(root,'lib','roadmap','schema.ts'))
 return root
}

test('validation checkpoint CAS compares semantic JSON rather than object key order',()=>{
 const repo=root(),first=checkpoint()
 writeValidationCheckpoint(repo,'ARC',null,first)
 const reordered={note:first.note,headSha:first.headSha,correction:first.correction,at:first.at,verdict:first.verdict,arcId:first.arcId}
 const next={...first,note:'same checkpoint, clarified note'}
 assert.deepEqual(writeValidationCheckpoint(repo,'ARC',reordered,next),next)
})

test('an existing correction round and authority bounds cannot be reset or dropped',()=>{
 const repo=root(),route={kind:'small-repair',sourceHeadSha:A,predecessorHeadSha:B,selected:[{checkKey:'unit',attemptId:'1',signature:KEY,kind:'causal',paths:['src/a.mjs']}],residual:[],scopePaths:['src/a.mjs'],trace:{phaseId:42,criterionIds:['AC1']},plannedCorrection:null,reason:'repair unit',recordedAt:AT}
 const used=checkpoint({correction:{...checkpoint().correction,round:1,route}})
 writeValidationCheckpoint(repo,'ARC',null,used)
 for(const next of [checkpoint(),checkpoint({correction:{...used.correction,bounds:{...used.correction.bounds,allowedPathPrefixes:['src','other']}}})])
  assert.throws(()=>writeValidationCheckpoint(repo,'ARC',used,next),/round|bound|authority|reset|checkpoint/i)
})

test('validation checkpoint rejects backslash arc identities',()=>{
 const repo=root()
 assert.throws(()=>writeValidationCheckpoint(repo,'bad\\arc',null,checkpoint({arcId:'bad\\arc'})),/unsafe|identity/i)
})

test('default-loaded malformed correction checkpoint is refused before a review write',()=>{
 const repo=root(),git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim()
 writeFileSync(join(repo,'roadmap','phases','phase-42.phase.ts'),"export default {phase:42,status:'in-progress',arcId:'ARC',tasks:[{id:'42.6',done:false,files:['src']}]}\n")
 mkdirSync(join(repo,'src'),{recursive:true});writeFileSync(join(repo,'src','a.mjs'),'export const a=1\n')
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.test');git('add','.');git('commit','-qm','base')
 const source=git('rev-parse','HEAD');writeFileSync(join(repo,'src','a.mjs'),'export const a=2\n');git('add','.');git('commit','-qm','repair');const head=git('rev-parse','HEAD')
 const dir=join(repo,'roadmap','.gate','42');mkdirSync(dir,{recursive:true});mkdirSync(join(repo,'roadmap','.gate','arc-ARC'),{recursive:true})
 const route={kind:'small-repair',sourceHeadSha:source,predecessorHeadSha:B,selected:[{checkKey:'unit',attemptId:'1',signature:KEY,kind:'causal',paths:['src/a.mjs']}],residual:[],scopePaths:['src/a.mjs'],trace:{phaseId:42,criterionIds:['AC1']},plannedCorrection:null,reason:'repair unit',recordedAt:AT}
 const malformed={arcId:'ARC',verdict:'GAPS',at:AT,headSha:source,correction:{state:'awaiting-repair',validationHead:source,gateInputKey:KEY,round:1,bounds:{maxRounds:2,deadlineAt:LATER,allowedPathPrefixes:['src']},route}}
 writeFileSync(join(repo,'roadmap','.gate','arc-ARC','validate.json'),JSON.stringify(malformed))
 const reportPath=join(dir,'run-000001-fixture.json'),inputKey=gateInputKey(repo,{exclude:['roadmap/.gate','roadmap/arc-evals/phase-42.peval.json']})
 const report={phase:42,startedAt:AT,baseSha:source,mode:'task',kind:'test',testScope:{derived:'affected',declared:'affected',effective:'affected'},reviewScope:{derived:'partial',declared:'partial',effective:'partial'},slots:[{slot:'unit',exitCode:0}],agents:[],green:true,notes:[],attempt:{inputKey,headSha:head,taskId:'42.6'}}
 writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');const before=readFileSync(reportPath,'utf8')
 assert.throws(()=>recordCorrectionReview(repo,42,{arcId:'ARC',agent:'independent-reviewer',model:'test-model',verdict:'clean',summary:'clean repair',findings:[]},{clock:()=>AT,loadPhase:()=>({phase:42,arcId:'ARC',tasks:[{id:'42.6',files:['src']}]})}),/checkpoint|malformed|authority|bounds/i)
 assert.equal(readFileSync(reportPath,'utf8'),before)
})

test('typed validation checkpoints accept a fixed one-round correction budget and reject consumption beyond it',()=>{
 const repo=root(),one=checkpoint();one.correction.bounds.maxRounds=1
 assert.deepEqual(writeValidationCheckpoint(repo,'ARC',null,one),one)
 const beyond=structuredClone(one);beyond.correction.round=2
 assert.throws(()=>writeValidationCheckpoint(repo,'ARC',one,beyond),/round|checkpoint|malformed/i)
})


test('expired correction-ready refuses a new lifecycle mutation but replays an already persisted ready outcome',async()=>{
 const repo=root(),git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim(),priorCwd=process.cwd()
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.test');writeFileSync(join(repo,'source.txt'),'one\n');git('add','.');git('commit','-qm','source');const source=git('rev-parse','HEAD')
 writeFileSync(join(repo,'source.txt'),'two\n');git('add','.');git('commit','-qm','repair');const repair=git('rev-parse','HEAD')
 const expired={maxRounds:1,deadlineAt:'2020-01-02T00:00:00.000Z',allowedPathPrefixes:['src'],authority:{source:'session',reference:'task 42.6'}}
 const route={kind:'small-repair',sourceHeadSha:source,predecessorHeadSha:B,selected:[{checkKey:'unit',attemptId:'1',signature:KEY,kind:'causal',paths:['src/a.mjs']}],residual:[],scopePaths:['src/a.mjs'],trace:{phaseId:42,criterionIds:['AC1']},plannedCorrection:null,reason:'repair unit',recordedAt:'2020-01-01T00:00:00.000Z'}
 const awaiting={arcId:'ARC',verdict:'GAPS',at:'2020-01-01T00:00:00.000Z',headSha:source,correction:{state:'awaiting-repair',validationHead:source,gateInputKey:KEY,round:1,bounds:expired,route}}
 writeValidationCheckpoint(repo,'ARC',null,awaiting,{clock:()=> '2020-01-01T01:00:00.000Z'});const path=join(repo,'roadmap','.gate','arc-ARC','validate.json'),before=readFileSync(path,'utf8')
 try{process.chdir(repo);assert.equal(await arcRun(['record-validate','ARC','--correction-ready']),2);assert.equal(readFileSync(path,'utf8'),before)
  const ready={...awaiting,correction:{...awaiting.correction,state:'needs-sweep',repairHead:repair,readyAt:'2020-01-01T12:00:00.000Z'}};writeValidationCheckpoint(repo,'ARC',awaiting,ready,{clock:()=> '2020-01-01T01:00:00.000Z'});const readyBytes=readFileSync(path,'utf8')
  assert.equal(await arcRun(['record-validate','ARC','--correction-ready']),0);assert.equal(readFileSync(path,'utf8'),readyBytes)
  const validated={...ready,verdict:'PASS',headSha:source,correction:{...ready.correction,state:'validated'}};writeValidationCheckpoint(repo,'ARC',ready,validated,{clock:()=> '2020-01-01T01:00:00.000Z'});const validatedBytes=readFileSync(path,'utf8')
  assert.equal(await arcRun(['record-validate','ARC','--verdict','PASS']),2);assert.equal(readFileSync(path,'utf8'),validatedBytes)
 }finally{process.chdir(priorCwd)}
})


test('checkpoint persistence rejects a newly expired bounded write under lock but permits exact semantic replay',()=>{
 const repo=root(),value=checkpoint();value.correction.bounds.maxRounds=1;value.correction.bounds.deadlineAt='2020-01-02T00:00:00.000Z'
 assert.throws(()=>writeValidationCheckpoint(repo,'ARC',null,value,{clock:()=> '2020-01-02T00:00:00.000Z'}),/deadline|expired/i)
 assert.deepEqual(writeValidationCheckpoint(repo,'ARC',null,value,{clock:()=> '2020-01-01T00:00:00.000Z'}),value)
 assert.deepEqual(writeValidationCheckpoint(repo,'ARC',value,structuredClone(value),{clock:()=> '2020-01-03T00:00:00.000Z'}),value)
 assert.throws(()=>writeValidationCheckpoint(repo,'ARC',value,{...value,note:'new mutation'},{clock:()=> '2020-01-03T00:00:00.000Z'}),/deadline|expired/i)
})
