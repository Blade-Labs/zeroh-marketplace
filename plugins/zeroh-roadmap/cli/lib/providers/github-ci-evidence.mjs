import {mkdtempSync,rmSync,realpathSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,relative,isAbsolute,sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFileSync} from 'node:child_process'
import {defaultExec} from '../exec.mjs'
import {ciPolicyOf} from '../config.mjs'
import {gateInputKey as inputKeyOf,diagnoseFailure} from '../gate-diagnostics.mjs'
import {ExactHeadCiResultShape,ciAttemptVerdict} from './ci.mjs'
const pathOkay=path=>typeof path==='string'&&path.length>0&&!/[\\\x00-\x1f]/.test(path)&&!path.startsWith('/')&&path.split('/').every(part=>part&&part!=='.'&&part!=='..')
const positive=value=>Number.isSafeInteger(value)&&value>0
export function collectGitHubFailureEvidence({root,ci:raw,deadlineMs,ciPolicy},{runIsolated:reproduce=runIsolated,execFile=defaultExec,clock=()=>new Date().toISOString(),git=(root,args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',timeout:10000,maxBuffer:8*1024*1024}),gateInputKey=inputKeyOf}={}){
 const held=reason=>({status:'held',reason,evidence:null})
 try{
  const ci=ExactHeadCiResultShape.parse(raw)
  if(ci.providerId!=='github'||ci.headMode!=='source'||ci.hold||!Number.isSafeInteger(deadlineMs))throw Error('Exact source GitHub CI and a finite deadline are required')
  const call=(endpoint,{pages=false,text=false}={})=>{
   const remaining=deadlineMs-Date.parse(clock());if(!Number.isFinite(remaining)||remaining<=0)throw Error('CI evidence deadline exhausted')
   const result=execFile('gh',['api',endpoint,...(pages?['--paginate','--slurp']:[])],{timeout:Math.min(120000,remaining),maxBuffer:8*1024*1024})
   if(Date.parse(clock())>=deadlineMs)throw Error('CI evidence deadline exhausted')
   if(result.status!==0)throw Error(`GitHub evidence unavailable: ${(result.stderr??'').slice(0,400)}`)
   if(typeof result.stdout!=='string'||Buffer.byteLength(result.stdout)>8*1024*1024)throw Error('CI evidence exceeds the bounded output size')
   return text?result.stdout:JSON.parse(result.stdout)
  }
  const files=git(root,['ls-files','-z']).split('\0').filter(pathOkay),tracked=new Set(files),special=files.filter(path=>/[\s:()"'`]/.test(path)),failures=[]
  const mentions=(output,path)=>new RegExp(`(?:^|[\\s('"\\x60])(?:\\./)?${path.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?=$|[\\s:)'"\\x60])`,'m').test(output)
  for(const check of ci.checks.filter(c=>c.verdict==='red')){
   const attempt=check.attempts.find(a=>a.attemptId===check.latestAttemptId)
   if(check.source!=='check-run'){failures.push({checkKey:check.key,attemptId:check.latestAttemptId,command:`github:${check.key}`,execution:{exitCode:1,signal:null,output:''},paths:[],logRefs:attempt?.detailsUrl?[attempt.detailsUrl]:[],reruns:[]});continue}
   if(!positive(Number(attempt.attemptId)))throw Error('Check-run attempt id is not a positive provider id')
   const endpoint=`repos/${ci.repositoryId}/check-runs/${attempt.attemptId}`,detail=call(endpoint)
   const matches=value=>value&&String(value.id)===attempt.attemptId&&value.head_sha===ci.sourceHeadSha&&value.name===check.name&&value.app?.id===check.appId&&(attempt.suiteId===null||String(value.check_suite?.id)===attempt.suiteId)&&value.status===attempt.status&&value.conclusion===attempt.conclusion
   if(!matches(detail))throw Error('Check-run identity/head or result changed during evidence collection')
   const output=detail.output??{},chunks=[output.title,output.summary,output.text].filter(value=>typeof value==='string'),refs=[`https://api.github.com/${endpoint}`]
   if(!Number.isSafeInteger(output.annotations_count)||output.annotations_count<0)throw Error('Check-run annotation count is unobservable')
   if(output.annotations_count){
    const pages=call(`${endpoint}/annotations?per_page=100`,{pages:true})
    if(!Array.isArray(pages)||pages.some(page=>!Array.isArray(page))||pages.flat().length!==output.annotations_count)throw Error('Check-run annotation pagination is incomplete')
    for(const annotation of pages.flat()){
     if(!pathOkay(annotation.path)||!positive(annotation.start_line)||typeof annotation.message!=='string')throw Error('Check-run annotation has malformed path/location evidence')
     chunks.push(`${annotation.path}:${annotation.start_line} ${annotation.title??''}\n${annotation.message}\n${annotation.raw_details??''}`)
    }
    refs.push(`https://api.github.com/${endpoint}/annotations`)
   }
   let locator=null
   try{const url=new URL(detail.details_url);if(url.protocol==='https:'&&url.hostname==='github.com'&&!url.username&&!url.password&&!url.port){const match=url.pathname.match(/^\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)(?:\/job\/(\d+))?\/?$/);if(match&&match[1].toLowerCase()===ci.repositoryId.toLowerCase())locator={runId:Number(match[2]),jobId:match[3]?Number(match[3]):null}}}catch{}
   if(locator){
    if(!positive(locator.runId)||locator.jobId!==null&&!positive(locator.jobId))throw Error('Actions locator id is malformed')
    const run=call(`repos/${ci.repositoryId}/actions/runs/${locator.runId}`)
    if(run.id!==locator.runId||run.head_sha!==ci.sourceHeadSha||String(run.check_suite_id)!==String(detail.check_suite?.id)||!positive(run.run_attempt)||ciAttemptVerdict(run,'check-run')!=='red')throw Error('Actions run does not bind the failing check-run head/suite')
    const pages=call(`repos/${ci.repositoryId}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`,{pages:true})
    if(!Array.isArray(pages)||!pages.length||pages.some(p=>!Number.isSafeInteger(p.total_count)||p.total_count<0||!Array.isArray(p.jobs)))throw Error('Actions jobs pagination is malformed')
    const jobs=pages.flatMap(page=>page.jobs)
    if(new Set(pages.map(p=>p.total_count)).size!==1||new Set(jobs.map(j=>j.id)).size!==pages[0].total_count)throw Error('Actions jobs pagination is incomplete or ambiguous')
    const matches=jobs.filter(j=>j.run_id===run.id&&j.head_sha===ci.sourceHeadSha&&j.check_run_url===`https://api.github.com/${endpoint}`)
    if(matches.length!==1)throw Error('Actions job does not uniquely map to this exact check run')
    const job=matches[0]
    if(!positive(job.id)||locator.jobId!==null&&job.id!==locator.jobId||ciAttemptVerdict(job,'check-run')!=='red')throw Error('Actions job identity or failure status differs')
    const logs=`repos/${ci.repositoryId}/actions/jobs/${job.id}/logs`
    chunks.push(call(logs,{text:true}));refs.push(`https://api.github.com/${logs}`)
   }
   const after=call(endpoint)
   if(!matches(after)||after.details_url!==detail.details_url||after.output?.annotations_count!==output.annotations_count)throw Error('Check-run evidence changed during collection')
   const combined=chunks.join('\n').replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z[ \t]+/gm,'')
   failures.push({checkKey:check.key,attemptId:attempt.attemptId,command:`github:${check.key}`,execution:{exitCode:1,signal:null,output:combined},paths:[...new Set([...Array.from(combined.matchAll(/(?:^|[\s('"`])(?:\.\/)?([^\s:()'"`]+)(?=$|[\s:)'"`])/gm),match=>match[1]).filter(path=>tracked.has(path)),...special.filter(path=>mentions(combined,path))])].sort(),logRefs:refs,reruns:[]})
  }
  const recipes=ciPolicyOf({ciPolicy:{reproductionCommands:ciPolicy?.reproductionCommands??{}}}).reproductionCommands
  const baseReproductions=[],unresolved=[]
  const completed=(run,head)=>run?.status==='completed'&&run.headSha===head&&Number.isInteger(run.execution?.exitCode)&&run.execution.exitCode>=0&&run.execution.exitCode<=255&&run.execution.signal===null&&typeof run.execution.output==='string'&&Buffer.byteLength(run.execution.output)<=8*1024*1024
  for(const failure of failures){
   const command=recipes[failure.checkKey]
   if(!command)continue
   const remoteDiagnostic=diagnoseFailure(failure.execution)
   const source=reproduce({root,headSha:ci.sourceHeadSha,command,deadlineMs})
   const sourceDiagnostic=completed(source,ci.sourceHeadSha)?diagnoseFailure(source.execution):null
   if(!sourceDiagnostic||sourceDiagnostic.category!=='product'||sourceDiagnostic.signature!==remoteDiagnostic?.signature||!failure.paths.length||!failure.paths.every(path=>mentions(source.execution.output,path))){
    failure.paths=[]
    unresolved.push(`${failure.checkKey}: isolated source reproduction is unavailable or differs from CI; base ownership remains unknown`)
    continue
   }
   failure.command=JSON.stringify([command.file,...command.args])
   failure.execution=source.execution
   const base=reproduce({root,headSha:ci.baseSha,command,deadlineMs})
   if(completed(base,ci.baseSha))baseReproductions.push({checkKey:failure.checkKey,command:failure.command,headSha:ci.baseSha,execution:base.execution})
   else unresolved.push(`${failure.checkKey}: isolated base reproduction is unavailable; pre-existing ownership remains unknown`)
  }
  const gateKey=gateInputKey(root);if(!gateKey)throw Error('Repository input bytes are unobservable')
  return {status:'collected',reason:unresolved.length?unresolved.join('; '):null,evidence:{schemaVersion:1,root,baseSha:ci.baseSha,sourceHeadSha:ci.sourceHeadSha,gateInputKey:gateKey,failures,baseReproductions,retryReports:[]}}
 }catch(error){return held(error.message)}
}

const isolatedOid=value=>typeof value==='string'&&/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value)
/** Run one configured CI command in an owned, detached clone of an exact commit. */
export function runIsolated({root,headSha,command,deadlineMs},{execFile=defaultExec,clock=()=>new Date().toISOString()}={}){
 const held=reason=>({status:'held',headSha,execution:null,reason})
 let owned=null,outcome
 try{
  if(!isolatedOid(headSha)||!Number.isSafeInteger(deadlineMs))throw Error('Isolated run requires an exact head, configured argv command and finite deadline')
  command=ciPolicyOf({ciPolicy:{reproductionCommands:{isolated:command}}}).reproductionCommands.isolated
  const source=realpathSync(root)
  const now=()=>{const value=Date.parse(clock());if(!Number.isFinite(value))throw Error('Isolated run clock is invalid');return value}
  const remaining=()=>deadlineMs-now()
  if(remaining()<2000)throw Error('Isolated run deadline has insufficient remaining time')
  const scratch=realpathSync(tmpdir()),within=relative(source,scratch)
  if(!within||within!=='..'&&!within.startsWith('..'+sep)&&!isAbsolute(within))throw Error('Temporary directory must be outside the live consumer')
  owned=mkdtempSync(join(scratch,'zeroh-ci-isolated-'))
  const checkout=join(owned,'checkout')
  const invoke=(file,args,cwd=source,processDeadline=deadlineMs,input)=>{
   const left=Math.min(remaining(),processDeadline-now());if(left<=0)throw Error('Isolated run deadline exhausted')
   const result=execFile(file,args,{cwd,input,timeout:Math.max(1,left),maxBuffer:8*1024*1024})
   if(!result||!Number.isInteger(result.status)||typeof result.stdout!=='string'||typeof result.stderr!=='string')throw Error('Isolated command did not report a complete process result')
   if(/ENOBUFS|maxBuffer/i.test(result.stderr)||Buffer.byteLength(result.stdout)+Buffer.byteLength(result.stderr)>8*1024*1024)throw Error('Isolated command output exceeded 8 MiB')
   return result
  }
  let result=invoke('git',['clone','--shared','--no-hardlinks','--no-checkout','--',source,checkout])
  if(result.status!==0)throw Error('Isolated clone setup failed: '+result.stderr.slice(0,400))
  result=invoke('git',['remote','remove','origin'],checkout);if(result.status!==0)throw Error('Isolated clone origin removal failed: '+result.stderr.slice(0,400))
  result=invoke('git',['-c','core.hooksPath=/dev/null','checkout','--detach',headSha,'--'],checkout);if(result.status!==0)throw Error('Isolated exact-head checkout failed: '+result.stderr.slice(0,400))
  result=invoke('git',['rev-parse','--verify','HEAD^{commit}'],checkout);if(result.status!==0||result.stdout.trim()!==headSha)throw Error('Isolated checkout did not resolve the requested exact head')
  const left=remaining(),configured=command.timeoutMs===undefined?left:Math.min(left,command.timeoutMs)
  if(configured<=1000)throw Error('Isolated run deadline has insufficient command time')
  const commandDeadline=now()+configured,seconds=Math.max(1,Math.ceil(configured/1000)),softSeconds=(configured-1000)/1000
  result=invoke('capbuild',['--timeout',String(seconds),'timeout','--signal=TERM','--kill-after=1s',`${softSeconds}s`,process.execPath,fileURLToPath(new URL('../exec.mjs',import.meta.url)),'--argv-stdin'],checkout,commandDeadline,JSON.stringify([command.file,...command.args]))
  if(result.status===124||result.status===137)throw Error('Isolated command timed out')
  if([125,126,127].includes(result.status)||/spawn(?:Sync)? capbuild.*ENOENT|capbuild.*command not found/i.test(result.stderr))throw Error('Isolated command could not be invoked')
  if(/roadmap argv launcher: child signal|capbuild:.*command completion missing|unit result: (?:oom-kill|timeout|signal)|capbuild:.*interrupted/i.test(result.stderr))throw Error('Isolated command completion was not observed')
  if(now()>=commandDeadline||now()>=deadlineMs)throw Error('Isolated command exceeded its deadline')
  outcome={status:'completed',headSha,execution:{exitCode:result.status,signal:null,output:result.stdout+result.stderr},reason:null}
 }catch(error){outcome=held(String(error?.message??error))}
 finally{if(owned!==null)try{rmSync(owned,{recursive:true,force:true})}catch(error){outcome=held('Isolated checkout cleanup failed: '+String(error.message))}}
 return outcome
}
