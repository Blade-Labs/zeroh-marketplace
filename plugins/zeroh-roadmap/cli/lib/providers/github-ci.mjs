import {defaultExec} from '../exec.mjs'
import {assertCiRequest,ciAttemptVerdict,latestCiAttempt,finalizeCiObservation} from './ci.mjs'

function failureKind(out={}){
 const text=`${out.stderr??''} ${out.stdout??''}`
 if(/ENOENT|not found|not installed/i.test(text))return 'missing-tool'
 if(/429|rate.?limit|quota|secondary rate/i.test(text))return 'quota'
 if(/401|bad credentials|not logged|authentication/i.test(text))return 'auth'
 if(/403|permission|not accessible|forbidden/i.test(text))return 'permission'
 if(/unknown field|unsupported|not supported|could not resolve/i.test(text))return 'unsupported'
 return 'unknown'
}
/** Read-only GitHub adapter. REST check-runs/statuses use exact commit endpoints and full slurped pages. */
export function createGitHubCiProvider({execFile=defaultExec,clock=()=>new Date().toISOString(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 const now=()=>{const value=clock();if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))throw Error('CI clock must return a timestamp');return value}
 const finish=(request,checks=[],hold=null)=>finalizeCiObservation(request,{checks,hold,observedAt:now()})
 const held=(request,kind,remedy,checks=[])=>finish(request,checks,{kind,remedy})
 const expired=request=>held(request,'deadline','The CI observation deadline was reached; resume with the same commit and remaining authority.')
 const json=(request,args,deadline)=>{
  const remaining=deadline-Date.parse(now());if(remaining<=0)return {error:expired(request)}
  let out
  try{out=execFile('gh',args,{timeout:Math.max(1,Math.min(120000,remaining)),maxBuffer:32*1024*1024})}
  catch(error){out={status:1,stdout:'',stderr:String(error.code??error.message??'GitHub invocation unavailable')}}
  if(Date.parse(now())>=deadline)return {error:expired(request)}
  if(out?.status!==0)return {error:held(request,failureKind(out),'Restore GitHub CLI access, credentials or quota, then resume CI observation.')}
  try{const value=JSON.parse(out.stdout);if(value?.errors?.length)return {error:held(request,failureKind({stdout:JSON.stringify(value.errors)}),'GitHub could not provide an exact observation; inspect access and resume.')};return {value}}
  catch{return {error:held(request,'unknown','GitHub returned malformed JSON; resume after a readable response.')}}
 }
 const sourcePr=(request,deadline)=>{
  const query='query($id:ID!){node(id:$id){... on PullRequest{id state isDraft headRefOid baseRefOid repository{nameWithOwner}}}}'
  const out=json(request,['api','graphql','-f',`query=${query}`,'-f',`id=${request.providerPullRequestId}`],deadline);if(out.error)return out
  const node=out.value?.data?.node
  if(!node||node.id!==request.providerPullRequestId||node.repository?.nameWithOwner?.toLowerCase()!==request.repositoryId.toLowerCase())return {error:held(request,'pull-request','The persisted GitHub PR is unavailable or belongs to another repository.')}
  if(node.state!=='OPEN'||node.isDraft!==false||node.headRefOid!==request.sourceHeadSha||node.baseRefOid!==request.baseSha)return {error:held(request,'head-changed','The PR changed source/base, closed or became draft; reconcile its current receipt before resuming.')}
  return {value:node}
 }
 const grouped=(request,runs,statuses)=>{
  const groups=new Map(),identities=new Map()
  for(const [source,rows] of [['check-run',runs],['commit-status',statuses]])for(const raw of rows){
   if(!Number.isSafeInteger(raw?.id)||raw.id<=0)return {error:held(request,'unknown-state','GitHub returned an invalid attempt identity.')}
   const identity=source+':'+raw.id,bytes=JSON.stringify(raw)
   if(identities.has(identity)){if(identities.get(identity)!==bytes)return {error:held(request,'ambiguous-check','GitHub returned conflicting observations for one attempt.')};continue}
   identities.set(identity,bytes)
   const name=source==='check-run'?raw.name:raw.context,appId=source==='check-run'?raw.app?.id:null
   if(typeof name!=='string'||!name||(source==='check-run'&&(!Number.isSafeInteger(appId)||appId<=0||raw.head_sha!==request.sourceHeadSha)))return {error:held(request,'head-changed','GitHub returned a malformed check identity or a check for another commit.')}
   if(source==='check-run'&&raw.check_suite?.id!=null&&(!Number.isSafeInteger(raw.check_suite.id)||raw.check_suite.id<=0))return {error:held(request,'unknown-state','GitHub returned a malformed supplied check-suite identity.')}
   const key=source==='check-run'?`check-run:${appId}:${name}`:`commit-status:${name}`
   const attempt={attemptId:String(raw.id),suiteId:source==='check-run'&&Number.isSafeInteger(raw.check_suite?.id)?String(raw.check_suite.id):null,runNumber:null,runAttempt:null,status:source==='check-run'?raw.status:raw.state,conclusion:source==='check-run'?(raw.conclusion??null):raw.state,startedAt:(source==='check-run'?raw.started_at:raw.created_at)??null,completedAt:(source==='check-run'?raw.completed_at:raw.updated_at)??null,detailsUrl:(source==='check-run'?raw.details_url:raw.target_url)??null,logRefs:[],artifactRefs:[]}
   if(!groups.has(key))groups.set(key,{key,name,source,appId,attempts:[]})
   groups.get(key).attempts.push(attempt)
  }
  const checks=[]
  for(const group of groups.values()){
   let latest
   try{latest=latestCiAttempt(group.attempts)}catch(error){return {error:held(request,'ambiguous-check',`${group.name}: ${error.message}; wait for an unambiguous observation.`)}}
   group.attempts.sort((a,b)=>Date.parse(a.startedAt??a.completedAt)-Date.parse(b.startedAt??b.completedAt)||a.attemptId.localeCompare(b.attemptId))
   checks.push({...group,verdict:ciAttemptVerdict(latest,group.source),latestAttemptId:latest.attemptId})
  }
  return {value:checks}
 }
 const checkRuns=(request,deadline)=>{
  const out=json(request,['api',`repos/${request.repositoryId}/commits/${request.sourceHeadSha}/check-runs?filter=all&per_page=100`,'--paginate','--slurp'],deadline);if(out.error)return out
  if(!Array.isArray(out.value)||!out.value.length||out.value.some(page=>!Number.isSafeInteger(page?.total_count)||page.total_count<0||!Array.isArray(page.check_runs)))return {error:held(request,'incomplete-pagination','GitHub returned malformed check-run pages.')}
  const totals=new Set(out.value.map(page=>page.total_count)),rows=out.value.flatMap(page=>page.check_runs)
  if(totals.size!==1||new Set(rows.map(row=>row?.id)).size!==out.value[0].total_count)return {error:held(request,'incomplete-pagination','GitHub check-run pagination is incomplete or changed during collection; resume.')}
  return {value:rows}
 }
 const lookupAt=(request,deadline=Infinity)=>{
  assertCiRequest(request);if(request.providerId!=='github')throw Error('GitHub CI request requires provider github')
  if(request.headMode==='merge-queue')return held(request,'unsupported','This adapter cannot prove the queued merge-group SHA from PR preview fields; provide an authoritative queue binding adapter before observing queue checks.')
  const before=sourcePr(request,deadline);if(before.error)return before.error
  const runs=checkRuns(request,deadline);if(runs.error)return runs.error
  const statusPath=`repos/${request.repositoryId}/commits/${request.sourceHeadSha}/statuses?per_page=100`
  const statuses=json(request,['api',statusPath,'--paginate','--slurp'],deadline);if(statuses.error)return statuses.error
  if(!Array.isArray(statuses.value)||!statuses.value.length||statuses.value.some(page=>!Array.isArray(page)))return held(request,'incomplete-pagination','GitHub returned malformed commit-status pages.')
  const statusRows=statuses.value.flat()
  if(new Set(statusRows.map(row=>row?.id)).size!==statusRows.length)return held(request,'incomplete-pagination','GitHub commit-status pages overlap; resume after the status history settles.')
  // New statuses prepend to this endpoint: a stable PR head alone cannot bind its page snapshot.
  const firstPage=json(request,['api',statusPath],deadline);if(firstPage.error)return firstPage.error
  if(!Array.isArray(firstPage.value)||JSON.stringify(firstPage.value)!==JSON.stringify(statuses.value[0]))return held(request,'incomplete-pagination','GitHub commit statuses changed during pagination; resume on a stable snapshot.')
  const after=sourcePr(request,deadline);if(after.error)return after.error
  if(JSON.stringify(before.value)!==JSON.stringify(after.value))return held(request,'head-changed','The PR changed during CI collection; resume on a stable receipt.')
  const checks=grouped(request,runs.value,statusRows);if(checks.error)return checks.error
  try{return finish(request,checks.value)}catch(error){return held(request,'unknown-state',`GitHub check evidence was invalid: ${error.message}`)}
 }
 const watch=async(request,{pollIntervalMs,deadlineMs,signal,onObservation}={})=>{
  assertCiRequest(request)
  if(!Number.isSafeInteger(pollIntervalMs)||pollIntervalMs<=0||!Number.isSafeInteger(deadlineMs)||deadlineMs<=0)throw Error('CI watch requires positive finite integer interval and absolute deadline')
  while(true){
   if(signal?.aborted)return held(request,'aborted','CI observation was cancelled; resume when ready.')
   if(Date.parse(now())>=deadlineMs)return expired(request)
   const observation=lookupAt(request,deadlineMs)
   if(onObservation)await onObservation(observation)
   if(observation.rollup!=='pending')return observation
   const remaining=deadlineMs-Date.parse(now());if(remaining<=0)return expired(request)
   await sleep(Math.min(pollIntervalMs,remaining),signal)
  }
 }
 return {lookup:(request,{deadlineMs=Infinity}={})=>lookupAt(request,deadlineMs),watch}
}
