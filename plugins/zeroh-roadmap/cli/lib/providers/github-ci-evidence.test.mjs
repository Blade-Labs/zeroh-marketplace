import {test} from 'node:test'
import assert from 'node:assert/strict'
import {collectGitHubFailureEvidence} from './github-ci-evidence.mjs'
import {finalizeCiObservation} from './ci.mjs'
const HEAD='1'.repeat(40),BASE='0'.repeat(40),AT='2026-09-08T02:00:00.000Z'
function fixture(){
 const attempt={attemptId:'12',suiteId:'7',runNumber:null,runAttempt:null,status:'completed',conclusion:'failure',startedAt:AT,completedAt:AT,detailsUrl:'https://github.com/blade/repo/actions/runs/40/job/80',logRefs:[],artifactRefs:[]}
 const ci=finalizeCiObservation({providerId:'github',repositoryId:'blade/repo',providerPullRequestId:'PR_1',sourceHeadSha:HEAD,baseSha:BASE,requiredChecks:['unit'],headMode:'source',mergeQueue:null},{checks:[{key:'check-run:5:unit',name:'unit',source:'check-run',appId:5,verdict:'red',latestAttemptId:'12',attempts:[attempt]}],observedAt:AT})
 const check={id:12,head_sha:HEAD,name:'unit',app:{id:5},check_suite:{id:7},status:'completed',conclusion:'failure',details_url:attempt.detailsUrl,output:{title:'Failed',summary:'',text:'',annotations_count:0}}
 const calls=[],bodies={check,run:{id:40,head_sha:HEAD,check_suite_id:7,run_attempt:2,status:'completed',conclusion:'failure'},jobs:[{total_count:1,jobs:[{id:80,run_id:40,head_sha:HEAD,check_run_url:'https://api.github.com/repos/blade/repo/check-runs/12',status:'completed',conclusion:'failure'}]}],annotations:[[]],logs:'not ok 1 - useful\nsrc/a.mjs:1 AssertionError: expected two'}
 const deps={clock:()=>AT,git:()=> 'src/a.mjs\0other/z.mjs\0',gateInputKey:()=> 'a'.repeat(64),execFile(bin,args){calls.push([bin,args]);const path=args[1];let value;if(path.endsWith('/logs'))return {status:0,stdout:bodies.logs,stderr:''};if(path.includes('/annotations'))value=bodies.annotations;else if(path.includes('/jobs?'))value=bodies.jobs;else if(path.includes('/actions/runs/'))value=bodies.run;else value=bodies.check;return {status:0,stdout:JSON.stringify(value),stderr:''}}}
 return {ci,bodies,calls,deps,request:{root:'/repo',ci,deadlineMs:Date.parse(AT)+60000}}
}
test('Actions logs bind run, attempt and unique job back to the exact failing check run',()=>{
 const f=fixture(),out=collectGitHubFailureEvidence(f.request,f.deps)
 assert.equal(out.status,'collected',out.reason);assert.equal(out.evidence.failures[0].attemptId,'12');assert.deepEqual(out.evidence.failures[0].paths,['src/a.mjs']);assert.match(out.evidence.failures[0].execution.output,/AssertionError/)
 assert.ok(f.calls.some(([,args])=>args[1]==='repos/blade/repo/actions/runs/40/attempts/2/jobs?per_page=100'))
 assert.ok(f.calls.some(([,args])=>args[1]==='repos/blade/repo/actions/jobs/80/logs'));assert.ok(!f.calls.some(([,args])=>args[1]?.includes('/jobs/12/')))
})
test('changed heads, ambiguous jobs and incomplete pages hold without returning edit evidence',()=>{
 for(const mutate of [f=>f.bodies.check.head_sha=BASE,f=>f.bodies.run.head_sha=BASE,f=>f.bodies.jobs[0].jobs[0].check_run_url='https://api.github.com/repos/blade/repo/check-runs/13',f=>f.bodies.jobs[0].jobs.push({...f.bodies.jobs[0].jobs[0],id:81}),f=>f.bodies.jobs[0].total_count=4]){
  const f=fixture();mutate(f);const out=collectGitHubFailureEvidence(f.request,f.deps);assert.equal(out.status,'held');assert.equal(out.evidence,null)
 }
})
test('non-Actions check output and annotations remain useful without guessing a job id',()=>{
 const f=fixture();f.bodies.check.details_url='https://checks.example.test/12';f.bodies.check.output={title:'AssertionError',summary:'',text:'',annotations_count:1};f.bodies.annotations=[[{path:'src/a.mjs',start_line:1,message:'Expected two',annotation_level:'failure'}]]
 const out=collectGitHubFailureEvidence(f.request,f.deps);assert.equal(out.status,'collected',out.reason);assert.deepEqual(out.evidence.failures[0].paths,['src/a.mjs']);assert.ok(!f.calls.some(([,args])=>args[1].includes('/actions/')))
})
test('expired deadline and provider access failures return actionable holds',()=>{
 const f=fixture();f.request.deadlineMs=Date.parse(AT);assert.equal(collectGitHubFailureEvidence(f.request,f.deps).status,'held');assert.equal(f.calls.length,0)
 const g=fixture();g.deps.execFile=()=>({status:1,stderr:'HTTP 429 rate limit',stdout:''});assert.equal(collectGitHubFailureEvidence(g.request,g.deps).status,'held')
})


test('42.8 a configured reproduction without an isolated runner cannot authorize provider-reported paths',()=>{
 const f=fixture()
 f.request.ciPolicy={reproductionCommands:{'check-run:5:unit':{file:'node',args:['--test','unit']}}}
 const out=collectGitHubFailureEvidence(f.request,f.deps)
 assert.equal(out.status,'collected',out.reason)
 assert.deepEqual(out.evidence.failures[0].paths,[])
 assert.deepEqual(out.evidence.baseReproductions,[])
})

test('42.8 a verified source reproduction uses canonical argv identity while unavailable base stays unknown',()=>{
 const f=fixture(),command={file:'node',args:['--test','unit']},calls=[]
 f.request.ciPolicy={reproductionCommands:{'check-run:5:unit':command}}
 f.deps.runIsolated=request=>{
  calls.push(request)
  if(request.headSha===HEAD)return {status:'completed',headSha:HEAD,execution:{exitCode:1,signal:null,output:f.bodies.logs},reason:null}
  return {status:'held',headSha:BASE,execution:null,reason:'base checkout unavailable'}
 }
 const out=collectGitHubFailureEvidence(f.request,f.deps)
 assert.equal(out.status,'collected',out.reason)
 assert.deepEqual(calls.map(call=>call.headSha),[HEAD,BASE])
 assert.equal(out.evidence.failures[0].command,JSON.stringify(['node','--test','unit']))
 assert.deepEqual(out.evidence.failures[0].paths,['src/a.mjs'])
 assert.deepEqual(out.evidence.baseReproductions,[])
})

test('42.8 runIsolated executes exact argv in disposable clean clones at the requested commits',async()=>{
 const {runIsolated}=await import('./github-ci-evidence.mjs')
 assert.equal(typeof runIsolated,'function')
 const {mkdtempSync,writeFileSync,readFileSync,rmSync}=await import('node:fs')
 const {tmpdir}=await import('node:os'),{join}=await import('node:path'),{execFileSync}=await import('node:child_process')
 const root=mkdtempSync(join(tmpdir(),'zr-ci-isolated-'))
 const git=(...args)=>execFileSync('git',['-C',root,'-c','user.name=Fixture','-c','user.email=f@example.test',...args],{encoding:'utf8'}).trim()
 try{
  git('init','-q');writeFileSync(join(root,'value.txt'),'base\n');git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD')
  writeFileSync(join(root,'value.txt'),'source\n');git('add','.');git('commit','-qm','source');const source=git('rev-parse','HEAD')
  writeFileSync(join(root,'value.txt'),'dirty live checkout\n')
  const command={file:process.execPath,args:['-e',"const fs=require('fs');process.stdout.write(fs.readFileSync('value.txt','utf8'));process.exit(1)"]}
  const deadlineMs=Date.now()+60000,sourceRun=await runIsolated({root,headSha:source,command,deadlineMs}),baseRun=await runIsolated({root,headSha:base,command,deadlineMs})
  assert.equal(sourceRun.status,'completed',sourceRun.reason);assert.equal(sourceRun.headSha,source);assert.equal(sourceRun.execution.exitCode,1);assert.match(sourceRun.execution.output,/^source/);assert.doesNotMatch(sourceRun.execution.output,/dirty live|base/)
  assert.equal(baseRun.status,'completed',baseRun.reason);assert.equal(baseRun.headSha,base);assert.equal(baseRun.execution.exitCode,1);assert.match(baseRun.execution.output,/^base/);assert.doesNotMatch(baseRun.execution.output,/dirty live|source/)
  assert.equal(readFileSync(join(root,'value.txt'),'utf8'),'dirty live checkout\n')
 }finally{rmSync(root,{recursive:true,force:true})}
})


test('42.8 isolated source success or signature drift removes edit authority while matching base is retained',()=>{
 const command={file:'node',args:['--test','unit']}
 for(const execution of [{exitCode:0,signal:null,output:''},{exitCode:1,signal:null,output:'TypeError: different failure\nsrc/a.mjs:1'}]){
  const f=fixture();f.request.ciPolicy={reproductionCommands:{'check-run:5:unit':command}}
  f.deps.runIsolated=({headSha})=>({status:'completed',headSha,execution,reason:null})
  const out=collectGitHubFailureEvidence(f.request,f.deps)
  assert.equal(out.status,'collected',out.reason);assert.deepEqual(out.evidence.failures[0].paths,[]);assert.deepEqual(out.evidence.baseReproductions,[])
 }
 const matched=fixture();matched.request.ciPolicy={reproductionCommands:{'check-run:5:unit':command}}
 matched.deps.runIsolated=({headSha})=>({status:'completed',headSha,execution:{exitCode:1,signal:null,output:matched.bodies.logs},reason:null})
 const out=collectGitHubFailureEvidence(matched.request,matched.deps)
 assert.equal(out.status,'collected',out.reason)
 assert.equal(out.evidence.baseReproductions.length,1)
 assert.deepEqual(out.evidence.baseReproductions[0],{checkKey:'check-run:5:unit',command:JSON.stringify(['node','--test','unit']),headSha:BASE,execution:{exitCode:1,signal:null,output:matched.bodies.logs}})
})


test('42.8 isolated execution refuses GNU timeout setup codes and missing capbuild',async()=>{
 const {runIsolated}=await import('./github-ci-evidence.mjs'),{mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
 const root=mkdtempSync(join(tmpdir(),'zr-ci-wrapper-')),head='1'.repeat(40),clock=()=>AT,deadlineMs=Date.parse(AT)+60000
 try{
  for(const failure of [{status:125,stderr:''},{status:126,stderr:''},{status:127,stderr:''},{status:1,stderr:'spawn capbuild ENOENT'}]){
   const execFile=(file,args)=>{
    if(file==='git'&&args[0]==='rev-parse')return {status:0,stdout:head+'\n',stderr:''}
    if(file==='git')return {status:0,stdout:'',stderr:''}
    assert.equal(file,'capbuild')
    return {status:failure.status,stdout:'',stderr:failure.stderr}
   }
   const out=runIsolated({root,headSha:head,command:{file:'node',args:['--version']},deadlineMs},{execFile,clock})
   assert.equal(out.status,'held',JSON.stringify(failure));assert.equal(out.execution,null)
  }
 }finally{rmSync(root,{recursive:true,force:true})}
})
