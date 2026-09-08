import {join} from 'node:path'
import {isDeepStrictEqual as same} from 'node:util'
import {withFileLock} from './file-lock.mjs'
import {roadmapRoot} from './roadmap-root.mjs'
import {loadArcDelivery,transitionArcDelivery,assertExactCurrentPullRequest,assertCheckObservation,finalizeDelivery} from './delivery.mjs'
import {ExactHeadCiResultShape} from './providers/ci.mjs'

class Superseded extends Error { constructor(delivery){super('Receipt CAS lost to a newer delivery; observation discarded.');this.delivery=delivery} }
const identity=state=>({revision:state.revision,arcId:state.arcId,deliveryKey:state.deliveryKey,target:state.target,pr:state.pullRequest,requiredChecks:state.requested.requiredChecks,terminalMode:state.requested.terminal})
const ciRequest=state=>({providerId:state.target.providerId,repositoryId:state.target.repositoryId,providerPullRequestId:state.pullRequest.providerPullRequestId,sourceHeadSha:state.target.currentHeadSha,baseSha:state.target.currentBaseSha,requiredChecks:state.requested.requiredChecks,headMode:'source',mergeQueue:null})
const result=(status,delivery,{source='local',observation=null,reason=null,action=null}={})=>({status,delivery,source,observation,reason,action})
/** One serialized poll. The persistent flock is its lease; ArcDelivery is its only durable record. */
export function monitorDelivery({root,arcId,provider,pollIntervalMs,deadlineMs,expectedRevision},{load=loadArcDelivery,transition=transitionArcDelivery,withLock=withFileLock,clock=()=>new Date().toISOString(),checkpoint=()=>{}}={}){
 if(typeof arcId!=='string'||!arcId||/[\\/\s\0]/.test(arcId)||['.','..'].includes(arcId))throw Error('monitor requires a safe arc identity')
 if(!Number.isSafeInteger(pollIntervalMs)||pollIntervalMs<=0||!Number.isSafeInteger(deadlineMs)||deadlineMs<=0)throw Error('monitor requires a positive finite poll interval and absolute deadline')
 if(typeof provider?.lookup!=='function')throw Error('monitor requires a synchronous CI provider')
 let previous=-Infinity
 const now=()=>{const value=clock(),at=Date.parse(value);if(!Number.isFinite(at)||at<previous)throw Error('monitor clock is invalid or regressed');previous=at;return value}
 const first=load(root,arcId);if(!first)return result('refused',null,{reason:'Delivery receipt is absent; publish before monitoring.'})
 const lockPath=join(withLock===withFileLock?roadmapRoot(root):root,'.deliveries',`${arcId}.json.monitor.lock`)
 try{return withLock(lockPath,()=>{
  let state=load(root,arcId)
  if(!state||state.arcId!==arcId)return result('refused',state,{reason:'Delivery owner identity changed.'})
  if(expectedRevision!==undefined&&state.revision!==expectedRevision)return result('refused',state,{reason:'The requested delivery revision is stale.'})
  if(state.terminal.status==='merged')return result('held',state,{reason:'Merged delivery is final; do not restart source CI.'})
  try{assertExactCurrentPullRequest(state)}catch(error){return result('held',state,{reason:error.message})}
  const initialTime=now();if(Date.parse(initialTime)<Date.parse(state.createdAt))throw Error('monitor clock precedes delivery creation')
  const snapshot=structuredClone(identity(state)),request=ciRequest(state)
  const ledgerTime=()=>new Date(Math.max(Date.parse(now()),Date.parse(state.updatedAt))).toISOString()
  const guardedTransition=event=>{
   try{return transition(root,arcId,event)}catch(error){const current=load(root,arcId);if(!current||!same(identity(current),identity(state)))throw new Superseded(current);throw error}
  }
  const persist=(type,body,at)=>{
   state=guardedTransition({type,deliveryKey:state.deliveryKey,targetKey:state.target.targetKey,expectedRevision:state.revision,at,...body})
   return state
  }
  const reconcile=(source,observation)=>{
   const latest=load(root,arcId)
   if(!latest||!same(identity(latest),identity(state)))return result('superseded',latest,{source,reason:'Delivery changed before terminal reconciliation; resume from its current identity.'})
   state=latest
   if(state.terminal.status==='held')return result('held',state,{source,observation,reason:state.terminal.reason})
   const decision=finalizeDelivery(state,{at:ledgerTime()})
   if(decision.status==='transition'&&decision.event.terminal.status==='open-green'){
    state=guardedTransition(decision.event)
    return result('green',state,{source,observation})
   }
   if(decision.status==='action-required')return result('held',state,{source,observation,action:decision.action,reason:'The configured terminal needs a separately authorized provider action.'})
   if(decision.status==='held')return result('held',state,{source,observation,reason:decision.reason})
   return result(state.checks?.observedChecks.some(row=>row.status==='red')?'red':'pending',state,{source,observation,reason:decision.reason??null})
  }
  const age=state.checks?Math.max(0,Date.parse(initialTime)-Date.parse(state.checks.observedAt)):Infinity
  if(Date.parse(initialTime)<deadlineMs&&age>=0&&age<pollIntervalMs){
   try{assertCheckObservation(state,state.checks);return reconcile('cache',null)}catch(error){if(!/check observation/.test(error.message))throw error}
  }
  let observation=null,hold=null,at=initialTime
  if(Date.parse(initialTime)>=deadlineMs)hold='deadline: CI monitoring budget expired; resume with the same receipt and remaining authority.'
  else{
   try{
    const raw=provider.lookup(request,{deadlineMs});if(raw&&typeof raw.then==='function')throw Error('CI lookup must be synchronous under the receipt lease')
    observation=ExactHeadCiResultShape.parse(raw)
   }catch(error){hold=`provider: ${error.message}`}
   checkpoint('after-lookup',{delivery:state,observation})
   at=now()
   const current=load(root,arcId)
   if(!current||!same(snapshot,identity(current)))return result('superseded',current,{reason:'Delivery identity changed during CI lookup; discarded the old observation.'})
   state=current
   if(Date.parse(at)>=deadlineMs)hold='deadline: CI monitoring budget expired during observation.'
   if(observation){
    const actual={providerId:observation.providerId,repositoryId:observation.repositoryId,providerPullRequestId:observation.providerPullRequestId,sourceHeadSha:observation.sourceHeadSha,baseSha:observation.baseSha,requiredChecks:observation.requiredChecks,headMode:observation.headMode,mergeQueue:observation.mergeQueue}
    if(!same(actual,request))hold='identity: provider observation differs from the current delivery request.'
    else if(Date.parse(observation.observedAt)>Date.parse(at)||Date.parse(observation.observedAt)<Date.parse(initialTime))hold='observation time: provider returned stale or future evidence.'
    else if(observation.rollup==='held')hold=`${observation.hold.kind}: ${observation.hold.remedy}`
    else at=observation.observedAt
   }
  }
  // This projection uses ordered ledger time; the raw CI observation keeps provider time.
  at=new Date(Math.max(Date.parse(now()),Date.parse(state.updatedAt),state.checks?Date.parse(state.checks.observedAt)+1:-Infinity)).toISOString()
  const evidence={providerId:request.providerId,repositoryId:request.repositoryId,providerPullRequestId:request.providerPullRequestId,headSha:request.sourceHeadSha,requiredChecks:[...request.requiredChecks],observedChecks:request.requiredChecks.map(name=>{
   const row=!hold&&observation?.checks.find(check=>check.key===name||check.name===name)
   return {name,status:row?row.verdict==='held'?'missing':row.verdict:'missing',attemptId:row?.latestAttemptId??null,observedAt:at}
  }),observedAt:at}
  assertCheckObservation(state,evidence);persist('observe-checks',{checks:evidence},at)
  checkpoint('after-persist',{delivery:state,observation})
  if(hold){persist('hold',{reason:hold},ledgerTime());return result('held',state,{source:'fresh',observation:null,reason:hold})}
  return reconcile('fresh',observation)
 },{label:'delivery CI monitor',timeoutMs:Math.max(1,Math.min(pollIntervalMs,deadlineMs-Date.parse(now())))})}catch(error){if(error instanceof Superseded)return result('superseded',error.delivery,{reason:error.message});throw error}
}
