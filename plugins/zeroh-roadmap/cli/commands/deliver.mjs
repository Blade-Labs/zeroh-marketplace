/** Publish one arc target; provider observations and durable reducer state own resume. */
import {readdirSync} from 'node:fs'
import {join} from 'node:path'
import {isDeepStrictEqual as same} from 'node:util'
import {gitToplevel} from '../lib/gitroot.mjs'
import {defaultExec} from '../lib/exec.mjs'
import {loadConfig,deliveryPolicyOf} from '../lib/config.mjs'
import {roadmapRoot,consumerSchemaPath} from '../lib/roadmap-root.mjs'
import {bridgeImport,bridgeParseShape} from '../lib/tsx-bridge.mjs'
import {resolveBranchStrategy} from '../lib/branch-strategy.mjs'
import {loadArcDelivery,transitionArcDelivery,publishDelivery,deliveryKeyOf,isDeliverySha,finalizeDelivery,assertReachedDeliveryTerminal} from '../lib/delivery.mjs'
import {createGitHubPullRequestProvider} from '../lib/providers/github.mjs'
const safeId=id=>typeof id==='string'&&/^[^\s/\\\0]+$/.test(id)&&!['.','..'].includes(id)&&!id.startsWith('-')
function loadArc(root,id){
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
   if(!['--resume','--json','--provider'].includes(arg)||seen.has(arg))throw Error('Unknown or duplicate delivery option.')
   seen.add(arg)
   if(arg==='--provider'){if(argv[++i]!=='github')throw Error('Delivery provider must be github.')}
   else result[arg.slice(2)]=true
  }else{if(result.arcId!==null||!safeId(arg))throw Error('Delivery needs exactly one safe arc identifier.');result.arcId=arg}
 }
 if(!result.arcId)throw Error('Delivery needs one arc identifier.')
 return result
}
export default async function run(argv,deps={}){
 const stdout=deps.stdout??(text=>process.stdout.write(text)),stderr=deps.stderr??(text=>process.stderr.write(text))
 let options
 try{options=parse(argv)}catch(error){stderr(`roadmap deliver: ${error.message} Usage: roadmap deliver <arc> [--resume] [--json] [--provider github]\n`);return 1}
 const {arcId}=options
 let ownerArcId=null,state=null,stage='configuration'
 const finish=(status,reason=null,code=status==='awaiting-ci'?0:status==='refused'?2:3)=>{
  const resume=`roadmap deliver ${arcId} --resume`
  const pr=state?.pullRequest
  const pullRequest=pr?Object.fromEntries(['providerId','repositoryId','providerPullRequestId','number','url','headSha'].map(key=>[key,pr[key]])):null
  const output={status,arcId,ownerArcId,deliveryKey:state?.deliveryKey??null,revision:state?.revision??null,pullRequest,reason,resume:Boolean(state)}
  if(options.json)stdout(JSON.stringify(output)+'\n');else stderr(`roadmap deliver ${arcId}: ${status}${reason?` — ${reason}`:''}. ${resume}\n`)
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
  const pr=state?.pullRequest,t=state?.target
  if(!pr||pr.state!=='open'||pr.draft||pr.headSha!==t.currentHeadSha||pr.baseSha!==t.currentBaseSha||['providerId','repositoryId','targetKey','baseRef','headRef'].some(key=>pr[key]!==t[key]))return finish('held','Persisted PR does not match the current open non-draft target.')
  try{assertReachedDeliveryTerminal(state);return finish(state.terminal.status,null,0)}catch{}
  const final=finalizeDelivery(state,{capabilities:provider.capabilities?.({root,ownerArcId,remote:policy.remote}),at:clock()})
  if(final.status==='transition'){state=transition(root,ownerArcId,final.event);return finish(state.terminal.status,null,0)}
  if(final.status==='held')return finish('held',final.reason)
  if(final.status==='action-required')return finish('held','Recorded terminal action awaits the CI/provider coordinator; resume that flow without creating another delivery.')
  const terminal={status:'awaiting-ci',headSha:t.currentHeadSha,reason:null}
  if(!same(state.terminal,terminal))state=transition(root,ownerArcId,{type:'set-terminal',deliveryKey:state.deliveryKey,targetKey:t.targetKey,expectedRevision:state.revision,at:clock(),terminal})
  return finish('awaiting-ci')
 }catch(error){return stage==='configuration'?finish('refused','Configuration or typed arc loading failed; run roadmap config check and validate the requested arc.',1):finish('held','Delivery could not be observed safely; inspect local receipt and provider access, then resume.')}
}
