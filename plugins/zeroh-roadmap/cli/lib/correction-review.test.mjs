import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {writeReport,latestReport,recordCorrectionReview,readCorrectionReview,checkPhaseConsistency} from './gate-report.mjs'
import {gateInputKey} from './gate-diagnostics.mjs'
const roots=[];process.on('exit',()=>roots.forEach(root=>rmSync(root,{recursive:true,force:true})))
const AT='2026-09-08T03:00:00.000Z'
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'zr-correction-review-'));roots.push(root)
 const git=args=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
 git(['init','-q']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.test']);mkdirSync(join(root,'src'));writeFileSync(join(root,'src/a.mjs'),'one\n');git(['add','.']);git(['commit','-qm','source']);const source=git(['rev-parse','HEAD'])
 writeFileSync(join(root,'src/a.mjs'),'two\n');git(['add','.']);git(['commit','-qm','repair']);const head=git(['rev-parse','HEAD'])
 const c={arcId:'ARC',verdict:'GAPS',at:AT,correction:{state:'awaiting-repair',validationHead:source,gateInputKey:'a'.repeat(64),round:1,bounds:{maxRounds:2,deadlineAt:'2026-09-08T04:00:00.000Z',allowedPathPrefixes:['src'],authority:{source:'session',reference:'owner'}},route:{kind:'small-repair',sourceHeadSha:source,scopePaths:['src/a.mjs'],trace:{phaseId:42,criterionIds:['working']}}}}
 const inputKey=()=>gateInputKey(root,{exclude:['roadmap/.gate','roadmap/arc-evals/phase-42.peval.json']})
 const report={phase:42,startedAt:AT,baseSha:source,mode:'arc',kind:'logic',testScope:{derived:'relevant',declared:null,effective:'relevant'},reviewScope:{derived:'none',declared:null,effective:'none'},slots:[{slot:'unit-scoped',command:'node --test',exitCode:0}],agents:[],green:true,notes:[],slotFilter:'unit',attempt:{inputKey:inputKey(),headSha:head,taskId:'42.6'}}
 writeReport(root,report)
 const phase={phase:42,arcId:'ARC',keyFiles:['src/a.mjs'],tasks:[{id:'42.6',files:['src/a.mjs']}]}
 const deps={clock:()=>AT,loadCheckpoint:()=>c,loadPhase:()=>phase},input={arcId:'ARC',agent:'code-reviewer',model:'independent requested model',verdict:'clean',summary:'Affected repair was independently reviewed.',findings:[]}
 return {root,git,head,source,c,report,phase,deps,input}
}
test('affected review enriches only the existing report and replay is byte-idempotent',()=>{
 const f=fixture(),before=latestReport(f.root,42),review=recordCorrectionReview(f.root,42,f.input,f.deps)
 assert.equal(review.repairHead,f.head);assert.deepEqual(review.changedPaths,['src/a.mjs']);assert.deepEqual(readCorrectionReview(f.root,42),review)
 const after=latestReport(f.root,42);assert.equal(after.path,before.path);const stripped={...after.report};delete stripped.correctionReview;assert.deepEqual(stripped,before.report)
 const bytes=readFileSync(after.path,'utf8');assert.deepEqual(recordCorrectionReview(f.root,42,f.input,f.deps),review);assert.equal(readFileSync(after.path,'utf8'),bytes);assert.equal(after.report.agents.length,0)
 assert.equal(checkPhaseConsistency({phase:42,status:'done',gate:'passed',gateRounds:[]},after.report).ok,false)
})
test('stale or red gate, unknown checkpoint, uncovered path and builder review refuse without mutation',()=>{
 const cases=[f=>f.report.green=false,f=>f.report.attempt.headSha=f.source,f=>f.report.attempt.inputKey='stale',f=>f.c.correction.round=0,f=>f.c.correction.state='needs-sweep',f=>f.c.arcId='OTHER',f=>f.phase.tasks[0].files=['other'],f=>f.input.agent='phase-executor',f=>f.input.verdict='findings',f=>f.input.extra=true]
 for(const mutate of cases){const f=fixture();mutate(f);writeReport(f.root,f.report);const before=latestReport(f.root,42),bytes=readFileSync(before.path,'utf8');assert.throws(()=>recordCorrectionReview(f.root,42,f.input,f.deps));assert.equal(readFileSync(before.path,'utf8'),bytes);assert.equal(readCorrectionReview(f.root,42),null)}
})
test('an old clean review cannot survive a failed or differently bound latest gate',()=>{
 for(const mutate of [report=>report.green=false,report=>report.slots[0].exitCode=1,report=>report.attempt.headSha='3'.repeat(40),report=>report.attempt.inputKey='stale']){
  const f=fixture();recordCorrectionReview(f.root,42,f.input,f.deps)
  const latest=latestReport(f.root,42);mutate(latest.report);writeFileSync(latest.path,JSON.stringify(latest.report))
  assert.equal(readCorrectionReview(f.root,42),null)
 }
})
test('a one-round correction budget permits round one, rejects round two, and still expires at its fixed deadline',()=>{
 const allowed=fixture();allowed.c.correction.bounds.maxRounds=1
 const persisted=recordCorrectionReview(allowed.root,42,allowed.input,allowed.deps);assert.equal(persisted.round,1)
 allowed.deps.clock=()=>allowed.c.correction.bounds.deadlineAt
 assert.deepEqual(recordCorrectionReview(allowed.root,42,allowed.input,allowed.deps),persisted)
 const exhausted=fixture();exhausted.c.correction.bounds.maxRounds=1;exhausted.c.correction.round=2
 assert.throws(()=>recordCorrectionReview(exhausted.root,42,exhausted.input,exhausted.deps),/checkpoint|exhausted/)
 const expired=fixture();expired.c.correction.bounds.maxRounds=1;expired.deps.clock=()=>expired.c.correction.bounds.deadlineAt
 assert.throws(()=>recordCorrectionReview(expired.root,42,expired.input,expired.deps),/checkpoint|exhausted/)
 const crossing=fixture();crossing.c.correction.bounds.maxRounds=1;let ticks=0;crossing.deps.clock=()=>++ticks===1?AT:crossing.c.correction.bounds.deadlineAt
 assert.throws(()=>recordCorrectionReview(crossing.root,42,crossing.input,crossing.deps),/checkpoint|exhausted/)
})
