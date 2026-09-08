import {loadPublishedCorrectionReceipt} from '../lib/history-normalize.mjs'
import {execFileSync} from 'node:child_process'
import {monitorDelivery} from '../lib/ci-monitor.mjs'
import {collectGitHubFailureEvidence} from '../lib/providers/github-ci-evidence.mjs'
import {createGitHubCiProvider} from '../lib/providers/github-ci.mjs'
import {ExactHeadCiResultShape} from '../lib/providers/ci.mjs'
import {classifyFailureScope} from '../lib/failure-scope.mjs'
import {decideCorrectionRoute,persistCorrectionCheckpoint,publishCorrection,correctionBindingOf} from '../lib/delivery.mjs'
import {readValidateVerdict} from '../lib/derive.mjs'
import {initializeCiCorrection,normalizeArc} from './arc.mjs'
import {readCorrectionReview} from '../lib/gate-report.mjs'
import {persistDeliverySummary,readDeliverySummaryInputs,assertDeliveryJudgments,evidenceCoversHead} from '../lib/delivery-evaluation.mjs'
/** Publish one arc target; provider observations and durable reducer state own resume. */
import {readdirSync} from 'node:fs'
import {join} from 'node:path'
import {isDeepStrictEqual as same} from 'node:util'
import {gitToplevel} from '../lib/gitroot.mjs'
import {defaultExec} from '../lib/exec.mjs'
import {loadConfig,deliveryPolicyOf,ciPolicyOf} from '../lib/config.mjs'
import {roadmapRoot,consumerSchemaPath} from '../lib/roadmap-root.mjs'
import {bridgeImport,bridgeParseShape} from '../lib/tsx-bridge.mjs'
import {resolveBranchStrategy} from '../lib/branch-strategy.mjs'
import {loadArcDelivery,transitionArcDelivery,publishDelivery,deliveryKeyOf,isDeliverySha,finalizeDelivery,assertReachedDeliveryTerminal} from '../lib/delivery.mjs'
import {createGitHubPullRequestProvider} from '../lib/providers/github.mjs'
const safeId=id=>typeof id==='string'&&/^[^\s/\\\0]+$/.test(id)&&!['.','..'].includes(id)&&!id.startsWith('-')
function loadArc(root,id){
 if(!safeId(id))throw Error('Unsafe arc identity')
 const imported=bridgeImport(join(roadmapRoot(root),'arcs',`${id}.arc.ts`),{consumerRoot:root})
 if(!imported.ok)throw Error('Cannot read the typed arc; restore its schema/toolchain and retry.')
 const parsed=bridgeParseShape(root,consumerSchemaPath(root),'ArcShape',imported.parsed)
 if(!parsed.ok||String(parsed.parsed?.id)!==id)throw Error('Arc schema or identity does not match the requested arc.')
 return parsed.parsed
}
function listDeliveries(root){
 let entries
 try{entries=readdirSync(join(roadmapRoot(root),'.deliveries'))}catch(error){if(error.code==='ENOENT')return [];throw error}
 return entries.filter(name=>name.endsWith('.json')).map(name=>{const ownerArcId=name.slice(0,-5);return {ownerArcId,delivery:loadArcDelivery(root,ownerArcId)}})
}
function gitHead(root){const result=defaultExec('git',['rev-parse','--verify','HEAD^{commit}'],{cwd:root});if(result.status!==0||!isDeliverySha(result.stdout.trim()))throw Error('Cannot observe the publication HEAD.');return result.stdout.trim()}
function parse(argv){
 const result={arcId:null,resume:false,json:false},seen=new Set()
 for(let i=0;i<argv.length;i++){
  const arg=argv[i]
  if(arg.startsWith('--')){
   if(!['--resume','--json','--provider','--correction-phase'].includes(arg)||seen.has(arg))throw Error('Unknown or duplicate delivery option.')
   seen.add(arg)
   if(arg==='--provider'){if(argv[++i]!=='github')throw Error('Delivery provider must be github.')}
   else if(arg==='--correction-phase'){const value=argv[++i];if(!/^[1-9][0-9]*$/.test(value??'')||!Number.isSafeInteger(Number(value)))throw Error('Correction phase must be a positive integer.');result.correctionPhase=Number(value)}
   else result[arg.slice(2)]=true
  }else{if(result.arcId!==null||!safeId(arg))throw Error('Delivery needs exactly one safe arc identifier.');result.arcId=arg}
 }
 if(!result.arcId)throw Error('Delivery needs one arc identifier.')
 if(result.correctionPhase!==undefined&&!result.resume)throw Error('Correction phase requires --resume.')
 return result
}
export default async function run(argv,deps={}){
 const stdout=deps.stdout??(text=>process.stdout.write(text)),stderr=deps.stderr??(text=>process.stderr.write(text))
 let options
 try{options=parse(argv)}catch(error){stderr(`roadmap deliver: ${error.message} Usage: roadmap deliver <arc> [--resume] [--json] [--provider github] [--correction-phase N]\n`);return 1}
 const {arcId}=options
 let ownerArcId=null,state=null,stage='configuration',handoff=null
 const finish=(status,reason=null,code=status==='awaiting-ci'?0:status==='refused'?2:3)=>{
  const resume=`roadmap deliver ${arcId} --resume`
  const pr=state?.pullRequest
  const pullRequest=pr?Object.fromEntries(['providerId','repositoryId','providerPullRequestId','number','url','headSha'].map(key=>[key,pr[key]])):null
  const output={status,arcId,ownerArcId,deliveryKey:state?.deliveryKey??null,revision:state?.revision??null,pullRequest,reason,resume:Boolean(state),...(handoff?{handoff}: {})}
  if(options.json)stdout(JSON.stringify(output)+'\n');else stderr(`roadmap deliver ${arcId}: ${status}${reason?` — ${reason}`:''}. ${handoff?.commands?.join('; ')??handoff?.command??resume}\n`)
  return code
 }
 const clock=deps.clock??(()=>new Date().toISOString())
 const load=deps.loadArcDelivery??loadArcDelivery,transition=deps.transitionArcDelivery??transitionArcDelivery
 try{
  const cwd=typeof deps.cwd==='function'?deps.cwd():deps.cwd??process.cwd(),root=deps.cwd===undefined?gitToplevel(cwd):cwd
  const config=(deps.loadConfig??loadConfig)(root),policy=(deps.deliveryPolicyOf??deliveryPolicyOf)(config)
  const arc=(deps.loadArc??loadArc)(root,arcId)
  if(String(arc?.id)!==arcId)return finish('refused','Loaded arc identity differs.',1)
  const strategy=structuredClone(policy.strategy);strategy[arcId]??={kind:'independent'}
  const member=strategy[arcId]
  ownerArcId=member.kind==='grouped'?Object.keys(strategy).find(id=>strategy[id].kind==='grouped'&&strategy[id].groupId===member.groupId&&strategy[id].order===0)??null:arcId
  if(!ownerArcId||!safeId(ownerArcId))return finish('refused','Branch strategy has no safe delivery owner.')
  const effectiveCi=ciPolicyOf(config,ownerArcId)
  policy.requiredChecks=effectiveCi.requiredChecks??policy.requiredChecks
  stage='receipt'
  const deliveries=(deps.listDeliveries??listDeliveries)(root)
  state=load(root,ownerArcId)
  if(options.resume&&!state)return finish('refused','No delivery receipt exists; start with roadmap deliver '+arcId+'.')
  if(!options.resume&&state)return finish('refused','Delivery already exists; use --resume.')
  if(ownerArcId!==arcId&&!state)return finish('held',`Deliver group owner ${ownerArcId} before resuming this member.`)
  if(state){
   if(policy.providerId!==state.target.providerId||policy.terminal!==state.requested.terminal||!same(policy.requiredCapabilities,state.requested.requiredCapabilities)||policy.requiredChecks!==null&&!same(policy.requiredChecks,state.requested.requiredChecks)||policy.allowedPushRefs!==null&&!same(policy.allowedPushRefs,state.requested.allowedPushRefs))return finish('refused','Configured delivery policy differs from the immutable receipt; restore the recorded policy.')
  }
  if(state?.terminal.status==='merged'){assertReachedDeliveryTerminal(state);return finish('merged',null,0)}
  const provider=(deps.createProvider??createGitHubPullRequestProvider)({loadDelivery:load})
  if(typeof provider.bootstrap!=='function')return finish('held','Provider lacks read-only delivery bootstrap; install a supported provider.')
  const predecessor=member.kind==='stacked'?deliveries.find(row=>row.ownerArcId===member.predecessorArcId)?.delivery:null
  const selectedBase=member.kind==='stacked'?(predecessor?.target.headRef??state?.target.baseRef??policy.defaultBaseRef):(policy.defaultBaseRef??state?.target.baseRef??null)
  const boot=provider.bootstrap({context:{root,cwd:root,ownerArcId,remote:policy.remote},defaultBaseRef:selectedBase,requiredChecks:state?.requested.requiredChecks??policy.requiredChecks})
  if(boot?.status!=='ready')return finish(boot?.status==='refused'?'refused':'held',boot?.remedy??'Provider bootstrap is unobserved; restore access and resume.')
  if(boot.providerId!==policy.providerId||!boot.repositoryId||!isDeliverySha(boot.baseSha)||!boot.refs?.heads)return finish('held','Provider bootstrap identity or base is incomplete.')
  if(!Array.isArray(boot.requiredChecks)||!boot.requiredChecks.length||boot.requiredChecks.some(name=>typeof name!=='string'||!name.trim()))return finish('held','Configure nonempty deliveryPolicy.requiredChecks or restore readable GitHub branch rules, then retry.')
  if(state&&member.kind!=='stacked'&&policy.defaultBaseRef!==null&&boot.baseRef!==state.target.baseRef)return finish('refused','Configured default base differs from the immutable receipt.')
  if(state&&(boot.repositoryId!==state.target.repositoryId||!same(boot.requiredChecks,state.requested.requiredChecks)))return finish('refused','Provider identity or required checks differ from the receipt.')
  const resumeCurrent=()=>{
   const outcome=(deps.resumePublishedDelivery??resumePublishedDelivery)({root,requestedArcId:arcId,ownerArcId,state,arc,config,policy,provider,correctionPhase:options.correctionPhase,ciProvider:(deps.createCiProvider??createGitHubCiProvider)()})
   state=outcome.state??state;handoff=outcome.handoff??null
   return finish(outcome.status,outcome.reason,['awaiting-ci','open-green','queued','merged'].includes(outcome.status)?0:outcome.status==='refused'?2:3)
  }
  if(state?.pullRequest){
   if(state.target.currentBaseSha!==boot.baseSha||state.pullRequest.baseSha!==boot.baseSha){
    const t=state.target,pr=provider.lookup({deliveryKey:state.deliveryKey,targetKey:t.targetKey,repositoryId:t.repositoryId,baseRef:t.baseRef,headRef:t.headRef,baseSha:boot.baseSha,headSha:t.currentHeadSha,context:{root,cwd:root,ownerArcId,remote:policy.remote}})
    if(!pr||pr.providerPullRequestId!==state.pullRequest.providerPullRequestId||pr.baseSha!==boot.baseSha||pr.headSha!==t.currentHeadSha||pr.state!=='open'||pr.draft||['providerId','repositoryId','targetKey','baseRef','headRef'].some(key=>pr[key]!==t[key]))return finish('held','Base changed without an exact observation of the same PR; resume after its refs reconcile.')
    const at=clock()
    if(t.currentBaseSha!==boot.baseSha)state=transition(root,ownerArcId,{type:'advance-base',deliveryKey:state.deliveryKey,targetKey:t.targetKey,expectedRevision:state.revision,at,fromBaseSha:t.currentBaseSha,toBaseSha:boot.baseSha})
    state=transition(root,ownerArcId,{type:'observe-pr',deliveryKey:state.deliveryKey,targetKey:t.targetKey,expectedRevision:state.revision,at,pullRequest:pr})
   }
   return resumeCurrent()
  }
  const candidate=ownerArcId===arcId?(deps.gitHead??gitHead)(root):state.target.currentHeadSha
  if(!isDeliverySha(candidate))return finish('held','Publication HEAD is not a commit SHA.')
  const refs=structuredClone(boot.refs)
  // Reconcile our own observed-but-unrecorded push through the existing publisher.
  if(state){const remoteHead=refs.heads[state.target.headRef];if(remoteHead===undefined||state.actions.some(action=>action.kind==='push'&&['unknown','succeeded'].includes(action.status)&&action.requested.headSha===remoteHead&&action.requested.ref===state.target.headRef))refs.heads[state.target.headRef]=state.target.currentHeadSha}
  const planInput={arc,policy:{providerId:boot.providerId,repositoryId:boot.repositoryId,defaultBaseRef:boot.baseRef,strategy},deliveries,refs}
  const planner=deps.resolveBranchStrategy??resolveBranchStrategy
  let planned=planner(planInput)
  if(planned.status==='held'&&planned.reason==='missing-ref'&&!state&&planned.ownerArcId===arcId&&planned.expected?.ref!==boot.baseRef&&!(member.kind==='stacked'&&deliveries.some(row=>row.delivery.target.headRef===planned.expected?.ref))){
   refs.heads[planned.expected.ref]=candidate;planned=planner(planInput)
  }
  if(planned.status!=='ready')return finish('held',`Branch plan held: ${planned.reason}. Reconcile its named refs and resume.`)
  ownerArcId=planned.ownerArcId
  if(state&&(!same(state.target,planned.target)||!same(state.strategy,planned.strategy)))return finish('refused','Resolved delivery target or strategy differs from the receipt.')
  if(!state){
   const allowedPushRefs=policy.allowedPushRefs??[planned.target.headRef]
   if(!allowedPushRefs.includes(planned.target.headRef))return finish('held','deliveryPolicy.allowedPushRefs does not authorize this exact delivery branch.')
   const at=clock(),target=planned.target
   const initial={schemaVersion:1,revision:0,arcId:ownerArcId,deliveryKey:deliveryKeyOf(target),target,strategy:planned.strategy,requested:{terminal:policy.terminal,allowedPushRefs,requiredCapabilities:policy.requiredCapabilities,requiredChecks:boot.requiredChecks,authority:{queue:null,merge:null}},actions:[],pullRequest:null,checks:null,terminal:{status:'preparing',headSha:target.currentHeadSha,reason:null},createdAt:at,updatedAt:at}
   state=transition(root,ownerArcId,{type:'initialize',deliveryKey:initial.deliveryKey,targetKey:target.targetKey,expectedRevision:null,at,state:initial})
  }
  const result=(deps.publishDelivery??publishDelivery)({root,arcId:ownerArcId,provider,remote:policy.remote,publishHeadSha:candidate,expected:{revision:state.revision,currentBaseSha:state.target.currentBaseSha,currentHeadSha:state.target.currentHeadSha},presentation:{title:`${arc.name} (${ownerArcId})`,body:`Roadmap arc ${ownerArcId}.`}})
  state=load(root,ownerArcId)
  if(result.status!=='published')return finish(result.status==='refused'?'refused':'held',result.reason??'Publication is unobserved; reconcile and resume.')
  return resumeCurrent()
 }catch(error){return stage==='configuration'?finish('refused','Configuration or typed arc loading failed; run roadmap config check and validate the requested arc.',1):finish('held','Delivery could not be observed safely; inspect local receipt and provider access, then resume.')}
}

/** One finite resume step. The session executes returned repair/review handoffs. */
export function resumePublishedDelivery(request,deps={}){
 const {root,requestedArcId,ownerArcId,arc,config,policy,provider,ciProvider}=request
 const clock=deps.clock??(()=>new Date().toISOString()),git=deps.git??((root,args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',timeout:10000,maxBuffer:8*1024*1024}).trim())
 const load=deps.load??loadArcDelivery,transition=deps.transition??transitionArcDelivery,readCheckpoint=deps.loadCheckpoint??readValidateVerdict
 let state=load(root,ownerArcId)??request.state
 const result=(status,reason=null,handoff=null)=>({status,reason,handoff,state})
 const handoff=(action,detail={})=>result('held',null,{action,arcId:ownerArcId,requestedArcId,ownerArcId,command:`roadmap deliver ${ownerArcId} --resume`,...detail})
 try{
  if(!state?.pullRequest)return result('held','Publish and observe the existing PR before resuming CI.')
  const now=Date.parse(clock());if(!Number.isFinite(now))throw Error('Invalid coordinator clock')
  const ciPolicy=ciPolicyOf(config,ownerArcId)
  if(ciPolicy.requiredChecks!==null&&!same(ciPolicy.requiredChecks,state.requested.requiredChecks))return result('held','Configured CI checks differ from the immutable delivery receipt.')
  const deadlineMs=now+ciPolicy.timeoutMs,pollIntervalMs=ciPolicy.pollIntervalMs
  const checkpoint=readCheckpoint(root,ownerArcId),c=checkpoint?.correction,head=requestedArcId===ownerArcId?git(root,['rev-parse','HEAD']):state.target.currentHeadSha
  if(c?.route&&c.validationHead===state.target.currentHeadSha&&checkpoint.verdict==='GAPS'&&(!state.correctionBinding||c.round>state.correctionBinding.round)){
   const binding=(deps.bindingOf??correctionBindingOf)(checkpoint)
   state=transition(root,ownerArcId,{type:'record-correction-binding',deliveryKey:state.deliveryKey,targetKey:state.target.targetKey,expectedRevision:state.revision,at:clock(),checkpoint,binding})
  }
  const binding=state.correctionBinding
  if(binding&&state.target.currentHeadSha===binding.validationHead){
   if(binding.route.predecessorHeadSha&&binding.route.predecessorHeadSha!==state.target.currentBaseSha)return handoff('reassess-correction-base',{reason:'The PR base changed after this repair was classified; preserve the shared budget and reassess scope before editing.'})
   if(!c||c.round!==binding.round||c.validationHead!==binding.validationHead||!same(c.route,binding.route)||!same(c.bounds,binding.bounds))return result('held','Correction checkpoint and delivery binding differ; reconcile their existing records.')
   const phase=binding.route.trace?.phaseId??binding.route.plannedCorrection?.phaseId
   const context={round:binding.round,phase,paths:binding.route.scopePaths,residualFailures:binding.route.residual}
   if(head===binding.validationHead)return handoff('run-correction',context)
   if(c.state==='awaiting-repair')return handoff('review-correction',{...context,commands:[`roadmap gate run ${phase} --slots unit`,`roadmap gate run ${phase} --record-correction-review <review.json>`,`roadmap arc record-validate ${ownerArcId} --correction-ready`]})
   if(c.state==='needs-sweep')return handoff('sweep-and-validate',context)
   if(c.state!=='validated'||checkpoint.verdict!=='PASS')return result('held','Repair has no current passing intent validation.')
   const normalizationDeps=request.normalizationDeps??deliveryNormalizationDeps({root,ownerArcId,state,policy,provider,ciProvider,deadlineMs})
   const normalize=deps.normalize??normalizeArc,preview=normalize(root,ownerArcId,{apply:false},normalizationDeps)
   let judgmentHead=head
   if(preview.recovery&&preview.planDigest){
    const receipt=(deps.loadNormalizationReceipt??loadPublishedCorrectionReceipt)(root,ownerArcId,preview.planDigest)
    if(receipt.newHead!==head||receipt.expectedOld!==binding.validationHead||receipt.publishedRef!==state.target.headRef)throw Error('Recovered normalization differs from this correction')
    judgmentHead=receipt.oldHead
   }else if(preview.status==='published-rewrite-planned'&&preview.newHead===head&&preview.oldHead)judgmentHead=preview.oldHead
   const inputs=(deps.summaryInputs??readDeliverySummaryInputs)(root,arc,state)
   assertDeliveryJudgments({...inputs,head:judgmentHead})
   const phaseReview=(deps.readReview??readCorrectionReview)(root,phase)
   if(!phaseReview||phaseReview.arcId!==ownerArcId||phaseReview.round!==c.round||phaseReview.sourceHeadSha!==c.validationHead||phaseReview.repairHead!==c.repairHead||!evidenceCoversHead(root,c.repairHead,judgmentHead,{arcId:ownerArcId}))return result('held','The affected correction review is missing or stale.')
   const recordedPush=state.actions?.some(action=>action.kind==='push'&&action.status==='succeeded'&&action.requested.headSha===head&&action.requested.ref===state.target.headRef)
   if(preview.recovery&&preview.planDigest&&recordedPush){
    const published=(deps.publishCorrection??publishCorrection)({root,arcId:ownerArcId,provider,remote:policy.remote,repair:{sourceHeadSha:binding.validationHead,headSha:head,correctionBinding:binding},normalizationReceipt:{planDigest:preview.planDigest}})
    if(published.status!=='published')return result('held',published.reason)
   }else if(preview.status==='retained-corrections'){
    const published=(deps.publishCorrection??publishCorrection)({root,arcId:ownerArcId,provider,remote:policy.remote,repair:{sourceHeadSha:binding.validationHead,headSha:head,correctionBinding:binding},normalizationDeps})
    if(published.status!=='published')return result('held',published.reason)
   }else{
    if(preview.plan?.kind!=='published-corrections'&&!preview.recovery)return result('held','Correction history has no verified published-corrections plan.')
    const mutationTime=Date.parse(clock())
    if(!Number.isFinite(mutationTime)||mutationTime>=Date.parse(c.bounds.deadlineAt))return result('held','Shared correction deadline is exhausted; retain the normalization plan for reconciliation.')
    const normalized=normalize(root,ownerArcId,{apply:true},normalizationDeps)
    const latest=load(root,ownerArcId)
    if(latest.target.currentHeadSha!==normalized.newHead){
     const resumed=(deps.publishCorrection??publishCorrection)({root,arcId:ownerArcId,provider,remote:policy.remote,repair:{sourceHeadSha:binding.validationHead,headSha:normalized.newHead,correctionBinding:binding},normalizationReceipt:{planDigest:normalized.planDigest}})
     if(resumed.status!=='published')return result('held',resumed.reason)
    }
   }
   state=load(root,ownerArcId)
  }else if(head!==state.target.currentHeadSha&&requestedArcId===ownerArcId)return result('held','Local HEAD differs from the published PR without a matching correction route.')
  const observed=(deps.monitor??monitorDelivery)({root,arcId:ownerArcId,provider:ciProvider,pollIntervalMs,deadlineMs},{clock,...(deps.monitorDeps??{})})
  state=observed.delivery??state
  if(observed.status==='green'){
   (deps.summary??persistDeliverySummary)(root,arc,state)
   return result('open-green',null,{action:'evaluate',arcId:requestedArcId,command:`roadmap eval ${requestedArcId}`})
  }
  if(observed.status==='pending'||observed.status==='red'&&!observed.observation)return result('awaiting-ci',observed.reason)
  if(observed.status!=='red')return result(observed.status==='refused'?'refused':'held',observed.reason)
  const collected=(deps.collect??collectGitHubFailureEvidence)({root,ci:observed.observation,deadlineMs,ciPolicy})
  if(collected.status!=='collected')return result('held',collected.reason)
  // A completed old check run can remain unchanged after a newer rerun appears.
  const latest=(deps.lookupCi??((request,options)=>ciProvider.lookup(request,options)))(ciRequestFrom(observed.observation),{deadlineMs})
  if(!same(ciFailureIdentity(latest),ciFailureIdentity(observed.observation)))return result('held','CI attempts changed during log collection; resume to observe the current attempt.')
  const decisions=(deps.classify??classifyFailureScope)(observed.observation,collected.evidence,{...(deps.classifierDeps??{}),arcId:ownerArcId})
  if(!decisions.editPaths?.length)return handoff('inspect-ci-failures',{failures:decisions.failures??[],reason:decisions.reasons,baseSha:state.target.currentBaseSha,sourceHeadSha:state.target.currentHeadSha})
  const memberIds=state.strategy?.kind==='grouped'?Object.keys(policy.strategy??{}).filter(id=>policy.strategy[id].kind==='grouped'&&policy.strategy[id].groupId===state.strategy.groupId):[ownerArcId]
  const phases=(deps.loadPhases??loadCorrectionPhases)(root,memberIds)

  const planned=request.correctionPhase!==undefined
  if(planned&&(!Number.isSafeInteger(request.correctionPhase)||request.correctionPhase<=0))return result('refused','Correction phase must be a positive integer.')
  const matches=phases.filter(p=>memberIds.includes(p.arcId)&&(!planned||p.phase===request.correctionPhase&&['backlog','in-progress','done'].includes(p.status)&&p.reviewRecord?.verdict==='READY')&&decisions.editPaths.every(path=>[...(p.keyFiles??[]),...p.tasks.flatMap(t=>t.files??[])].some(prefix=>path===prefix||path.startsWith(prefix.replace(/\/$/,'')+'/'))))
  if(matches.length!==1)return handoff('plan-correction',{paths:decisions.editPaths,failures:decisions.failures,reason:'Plan and independently review one correction phase that owns the affected paths, then resume with --correction-phase N.',command:`roadmap deliver ${ownerArcId} --resume --correction-phase <N>`})
  const correctionArc=matches[0].arcId===arc.id?arc:(deps.loadArc??loadArc)(root,matches[0].arcId)
  if(!correctionArc.acceptanceCriteria?.length)return handoff('plan-correction',{paths:decisions.editPaths,reason:'The owning arc has no acceptance trace.'})
  let current=readCheckpoint(root,ownerArcId)
  if(!current?.correction?.bounds){
   if(binding)return result('held','Prior correction usage cannot be reconstructed; retain the delivery binding.')
   if(config.mergePolicy?.gapsCorrection!=='autonomous')return handoff('correction-authority',{paths:decisions.editPaths,reason:'Use the existing session authority to initialize this exact scoped correction checkpoint; absent authority requires an owner ruling.'})
   const bounds={maxRounds:ciPolicy.maxRounds,deadlineAt:new Date(now+ciPolicy.correctionTimeoutMs).toISOString(),allowedPathPrefixes:[...new Set(phases.flatMap(p=>[...(p.keyFiles??[]),...p.tasks.flatMap(t=>t.files??[])]))].sort(),authority:{source:'config',reference:'mergePolicy.gapsCorrection=autonomous'}}
   current=(deps.initialize??initializeCiCorrection)(root,ownerArcId,{headSha:state.target.currentHeadSha,inputKey:decisions.gateInputKey,bounds})
  }
  if(current.correction.state==='validated')return handoff('record-ci-gaps',{command:`roadmap arc record-validate ${ownerArcId} --verdict GAPS`,reason:'Preserve the prior shared round and deadline before routing the next observed failure.'})
  const routed=(deps.route??decideCorrectionRoute)({failureDecisions:decisions,validationCheckpoint:current,delivery:state,policy:{at:clock(),sourceHeadSha:state.target.currentHeadSha,predecessorHeadSha:state.target.currentBaseSha,authority:current.correction.bounds.authority,stop:false,needsPlanning:planned,smallRepair:planned?null:{phaseId:matches[0].phase,criterionIds:correctionArc.acceptanceCriteria.map(c=>c.id)},plannedCorrection:planned?{correctionId:`phase-${matches[0].phase}`,phaseId:matches[0].phase,criterionIds:correctionArc.acceptanceCriteria.map(c=>c.id)}:null}})
  if(routed.status!=='routed')return result('held',routed.reason)
  if(!same(current,routed.routedCheckpoint))(deps.persistCheckpoint??persistCorrectionCheckpoint)(root,ownerArcId,current,routed.routedCheckpoint)
  if(!same(state.correctionBinding,routed.deliveryBinding))state=transition(root,ownerArcId,{type:'record-correction-binding',deliveryKey:state.deliveryKey,targetKey:state.target.targetKey,expectedRevision:state.revision,at:clock(),checkpoint:routed.routedCheckpoint,binding:routed.deliveryBinding})
  return handoff('run-correction',{phase:matches[0].phase,round:routed.deliveryBinding.round,paths:routed.editPaths,residualFailures:routed.residualFailures})
 }catch(error){return result('held',error.message)}
}
function ciRequestFrom(ci){return Object.fromEntries(['providerId','repositoryId','providerPullRequestId','sourceHeadSha','baseSha','requiredChecks','headMode','mergeQueue'].map(key=>[key,ci[key]]))}
function ciFailureIdentity(raw){const ci=ExactHeadCiResultShape.parse(raw);return {...ciRequestFrom(ci),rollup:ci.rollup,hold:ci.hold,checks:ci.checks.map(c=>({key:c.key,verdict:c.verdict,latestAttemptId:c.latestAttemptId})).sort((a,b)=>a.key.localeCompare(b.key))}}
export function loadCorrectionPhases(root,arcIds){
 const membership=new Map()
 if(!arcIds.length||new Set(arcIds).size!==arcIds.length)throw Error('Correction delivery membership is missing or duplicated')
 for(const id of arcIds){
  const arc=loadArc(root,id)
  for(const phase of arc.planes.flatMap(plane=>plane.phases)){
   if(membership.has(phase))throw Error('Correction phase has duplicate arc membership')
   membership.set(phase,id)
  }
 }
 return [...membership].map(([number,arcId])=>{
  const imported=bridgeImport(join(roadmapRoot(root),'phases',`phase-${number}.phase.ts`),{consumerRoot:root});if(!imported.ok)throw Error('Cannot read correction ownership phase')
  const parsed=bridgeParseShape(root,consumerSchemaPath(root),'PhaseShape',imported.parsed)
  if(!parsed.ok||parsed.parsed.phase!==number||parsed.parsed.arcId!==arcId)throw Error('Correction phase differs from its typed arc membership')
  return parsed.parsed
 })
}

/** Observe the published provider ref; local branch existence is irrelevant. */
export function deliveryNormalizationDeps({root,ownerArcId,state,policy,provider,ciProvider,deadlineMs},{clock=()=>new Date().toISOString(),git=(root,args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',timeout:Math.max(1,Math.min(120000,deadlineMs-Date.parse(clock()))),maxBuffer:1024*1024}).trim(),publish=publishCorrection,load=loadArcDelivery}={}){
 const ref=state.target.headRef,source=state.target.currentHeadSha
 const observePublishedRef=requestedRef=>{
  if(requestedRef!==ref||!ref.startsWith('refs/heads/')||typeof policy.remote!=='string'||!policy.remote||policy.remote.startsWith('-')||policy.remote.includes('\0')||!Number.isFinite(deadlineMs)||Date.parse(clock())>=deadlineMs)throw Error('Publication ref or observation deadline differs')
  const rows=git(root,['ls-remote','--refs','--',policy.remote,ref]).trim().split('\n').filter(Boolean).map(line=>line.split(/\s+/))
  if(rows.length!==1||rows[0].length!==2||rows[0][1]!==ref||!isDeliverySha(rows[0][0]))throw Error('Remote publication ref is missing or ambiguous')
  return rows[0][0]
 }
 const inspectDelivery=({head})=>{
  const observed=observePublishedRef(ref)
  if(observed!==source){
   if(observed!==head)throw Error('Remote lease changed before correction normalization')
   return {head,publication:'published',pullRequest:{head:observed,ref},publicationRefs:[ref],green:false,checks:{head:observed,state:'pending'},correction:{classification:state.correctionBinding.route.selected[0].kind,pushRequired:true}}
  }
  const request={providerId:state.target.providerId,repositoryId:state.target.repositoryId,providerPullRequestId:state.pullRequest.providerPullRequestId,sourceHeadSha:source,baseSha:state.target.currentBaseSha,requiredChecks:state.requested.requiredChecks,headMode:'source',mergeQueue:null}
  const ci=ExactHeadCiResultShape.parse(ciProvider.lookup(request,{deadlineMs}))
  if(!same(ciRequestFrom(ci),request)||ci.rollup!=='red'||ci.hold)throw Error('Correction normalization requires fresh exact-head red CI')
  const selected=state.correctionBinding?.route.selected
  if(!selected?.length||selected.some(f=>!['causal','owned-preexisting'].includes(f.kind)||!ci.checks.some(c=>c.key===f.checkKey&&c.verdict==='red'&&c.latestAttemptId===f.attemptId)))throw Error('Selected correction failures no longer match the current CI attempt')
  return {head,publication:'published',pullRequest:{head:source,ref},publicationRefs:[ref],green:false,checks:{head:source,state:'red'},correction:{classification:new Set(selected.map(f=>f.kind)).size===1?selected[0].kind:'mixed',pushRequired:true}}
 }
 const replacePublishedHead=({ref:requestedRef,expectedOld,newHead,arcId,planDigest})=>{
  if(requestedRef!==ref||expectedOld!==source||arcId!==ownerArcId)throw Error('Normalization replacement identity differs')
  const result=publish({root,arcId:ownerArcId,provider,remote:policy.remote,repair:{sourceHeadSha:source,headSha:newHead,correctionBinding:state.correctionBinding},normalizationReceipt:{planDigest}})
  const latest=load(root,ownerArcId)
  if(result.status!=='published'||latest?.target.currentHeadSha!==newHead||latest.pullRequest?.providerPullRequestId!==state.pullRequest.providerPullRequestId)throw Error(result.reason??'Correction push remains unobserved; resume the existing receipt')
  return {ref,head:newHead}
 }
 const beforeCas=()=>{
  const now=Date.parse(clock()),deadline=Date.parse(state.correctionBinding?.bounds?.deadlineAt)
  if(!Number.isFinite(now)||!Number.isFinite(deadline)||now>=deadline)throw Error('Shared correction deadline is exhausted before history mutation')
 }
 return {inspectDelivery,observePublishedRef,replacePublishedHead,beforeCas}
}
