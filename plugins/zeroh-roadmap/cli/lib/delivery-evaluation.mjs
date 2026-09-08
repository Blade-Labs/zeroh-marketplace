import {readFileSync,readdirSync,writeFileSync,renameSync,unlinkSync} from 'node:fs'
import {join,relative} from 'node:path'
import {execFileSync} from 'node:child_process'
import {isDeepStrictEqual as same} from 'node:util'
import {randomUUID} from 'node:crypto'
import {assertReachedDeliveryTerminal,loadArcDelivery} from './delivery.mjs'
import {roadmapRoot,consumerSchemaPath} from './roadmap-root.mjs'
import {loadConfig} from './config.mjs'
import {bridgeImport,bridgeParseShape} from './tsx-bridge.mjs'

function deliverySummaryBinding(delivery){
 assertReachedDeliveryTerminal(delivery)
 return {deliveryKey:delivery.deliveryKey,revision:delivery.revision,providerId:delivery.target.providerId,repositoryId:delivery.target.repositoryId,providerPullRequestId:delivery.pullRequest.providerPullRequestId,sourceHeadSha:delivery.target.currentHeadSha,testedHeadSha:delivery.target.currentHeadSha,headMode:'source',checksObservedAt:delivery.checks.observedAt,terminal:delivery.terminal.status}
}
export function assertDeliverySummary(summary,delivery){
 if(!summary||summary.outcome!=='shipped'||!same(summary.delivery,deliverySummaryBinding(delivery))||!Object.values(summary.gateSignals??{}).every(value=>value===true)||!['arcSweepClean','validateArcPassed','fullSuiteGreen'].every(key=>summary.gateSignals[key]===true)||['landedAt','landSha','mergeCommit'].some(key=>Object.hasOwn(summary,key)))throw Error('Summary does not bind the current exact-head PR delivery')
 return summary
}
export function assertDeliveryJudgments({arc,sweep,validation,panel,head,isCurrentHead=(observed,current)=>observed===current}){
 const current=observation=>observation&&typeof observation.recordedAt==='string'&&Number.isFinite(Date.parse(observation.recordedAt))&&isCurrentHead(observation.headSha,head)
 if(String(sweep?.arcId)!==String(arc.id)||sweep.overall!=='green'||sweep.blockers?.length||!current(sweep.observation))throw Error('A current green arc sweep is required')
 if(String(validation?.arcId)!==String(arc.id)||!['PASS','no-op'].includes(validation.verdict)||!isCurrentHead(validation.headSha,head))throw Error('A current passing intent validation is required')
 const criteria=arc.acceptanceCriteria??[]
 if(criteria.length){
  if(String(panel?.arcId)!==String(arc.id)||!current(panel.observation)||typeof panel.judgeModel!=='string'||!panel.judgeModel.trim()||!Array.isArray(panel.verdicts))throw Error('A fresh independent complete intent panel is required')
  if(validation.verdict!=='PASS'||panel.verdicts.some(v=>!criteria.some(c=>c.id===v.criterionId)||v.status!=='met'||typeof v.evidence!=='string'||!v.evidence.trim())||criteria.some(c=>!panel.verdicts.some(v=>v.criterionId===c.id&&v.tierUsed===c.tier)))throw Error('The intent panel is split, incomplete or uses a different acceptance tier')
 }
 return true
}
export function buildDeliverySummary({delivery,arc,sweep,validation,panel,isCurrentHead=(head,current)=>head===current}){
 const binding=deliverySummaryBinding(delivery),head=binding.sourceHeadSha
 if(delivery.strategy.kind!=='grouped'&&String(arc.id)!==String(delivery.arcId))throw Error('Delivery and arc owner differ')
 assertDeliveryJudgments({arc,sweep,validation,panel,head,isCurrentHead})
 return {arcId:arc.id,outcome:'shipped',compromiseDisposition:(sweep.debtDispositions??[]).map(({item,disposition})=>({item,disposition})),gateSignals:{arcSweepClean:true,validateArcPassed:true,fullSuiteGreen:true},receiptRef:`.deliveries/${delivery.arcId}.json`,...(delivery.pullRequest.url?{prUrl:delivery.pullRequest.url}:{}),delivery:binding}
}
export function readDeliveryArtifact(root,arcId,suffix,shape){
 if(!/^[^/\\\0]+$/.test(String(arcId)))throw Error('Unsafe arc artifact identity')
 const dir=join(roadmapRoot(root),'arc-evals'),escaped=String(arcId).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),pattern=new RegExp(`^${escaped}-\\d{4}-\\d{2}-\\d{2}-${suffix}\\.json$`)
 let names;try{names=readdirSync(dir).filter(name=>pattern.test(name)).sort()}catch(error){if(error.code==='ENOENT')return null;throw error}
 const name=names.at(-1);if(!name)return null
 const path=join(dir,name),value=JSON.parse(readFileSync(path,'utf8')),parsed=bridgeParseShape(root,consumerSchemaPath(root),shape,value)
 if(!parsed.ok)throw Error(`Invalid ${suffix} artifact; use its existing recorder`)
 return {...parsed.parsed,artifactPath:path}
}
// Evidence-only commits may follow the observed product head; product/plan edits invalidate it.
export function evidenceCoversHead(root,observed,current,{arcId}={}){
 if(observed===current)return true
 if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(observed??'')||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(current??'')||typeof arcId!=='string'||!arcId||/[\\/\0]/.test(arcId))return false
 try{
  const git=args=>execFileSync('git',['-C',root,...args],{encoding:'utf8',timeout:10000,maxBuffer:4*1024*1024}).trim()
  git(['merge-base','--is-ancestor',observed,current])
  const home=relative(root,roadmapRoot(root)),heads=new Set([observed]),commits=git(['rev-list','--reverse',`${observed}..${current}`]).split('\n').filter(Boolean)
  for(const commit of commits){
   const parents=git(['rev-list','--parents','-n','1',commit]).split(' ')
   if(parents.length!==2||!heads.has(parents[1]))return false
   const paths=git(['diff-tree','--no-commit-id','--name-only','-r','-z',commit]).split('\0').filter(Boolean)
   if(!paths.length)return false
   for(const path of paths){
    const prefix=`${home}/arc-evals/${arcId}-`
    if(!path.startsWith(prefix))return false
    const match=path.slice(prefix.length).match(/^\d{4}-\d{2}-\d{2}-(sweep|verdicts)\.json$/)
    if(!match)return false
    const raw=JSON.parse(git(['show',`${commit}:${path}`])),parsed=bridgeParseShape(root,consumerSchemaPath(root),match[1]==='sweep'?'SweepReportShape':'ArcVerdictsFileShape',raw)
    if(!parsed.ok||String(parsed.parsed.arcId)!==arcId||!heads.has(parsed.parsed.observation?.headSha))return false
   }
   heads.add(commit)
  }
  return heads.has(current)
 }catch{return false}
}
export function readDeliverySummaryInputs(root,arc,delivery){
 const home=roadmapRoot(root),validation=JSON.parse(readFileSync(join(home,'.gate',`arc-${arc.id}`,'validate.json'),'utf8'))
 return {delivery,arc,validation,sweep:readDeliveryArtifact(root,arc.id,'sweep','SweepReportShape'),panel:readDeliveryArtifact(root,arc.id,'verdicts','ArcVerdictsFileShape'),isCurrentHead:(observed,current)=>evidenceCoversHead(root,observed,current,{arcId:String(arc.id)})}
}
export function persistDeliverySummary(root,arc,delivery){
 const summary=buildDeliverySummary(readDeliverySummaryInputs(root,arc,delivery)),parsed=bridgeParseShape(root,consumerSchemaPath(root),'RunnerSummaryShape',summary)
 if(!parsed.ok||!parsed.parsed.delivery)throw Error('Consumer schema cannot bind PR delivery evaluation; sync its schema')
 const latest=loadArcDelivery(root,delivery.arcId)
 assertDeliverySummary(summary,latest)
 const path=join(roadmapRoot(root),'arc-summary.json'),temp=`${path}.${randomUUID()}.tmp`
 try{writeFileSync(temp,JSON.stringify(parsed.parsed,null,2)+'\n',{flag:'wx'});renameSync(temp,path)}finally{try{unlinkSync(temp)}catch(error){if(error.code!=='ENOENT')throw error}}
 return parsed.parsed
}

export function assertCurrentDeliverySummary(root,summary){
 const config=loadConfig(root),strategies=config.deliveryPolicy?.branchStrategy??{},member=strategies[String(summary.arcId)]
 const owner=member?.kind==='grouped'?Object.keys(strategies).find(id=>strategies[id].kind==='grouped'&&strategies[id].groupId===member.groupId&&strategies[id].order===0):String(summary.arcId)
 if(!owner)throw Error('Delivery evaluation group has no owner')
 const delivery=loadArcDelivery(root,owner)
 assertDeliverySummary(summary,delivery)
 const imported=bridgeImport(join(roadmapRoot(root),'arcs',`${summary.arcId}.arc.ts`),{consumerRoot:root})
 if(!imported.ok)throw Error('Cannot read the current arc for delivery evaluation')
 const checked=bridgeParseShape(root,consumerSchemaPath(root),'ArcShape',imported.parsed)
 if(!checked.ok)throw Error('Cannot validate the current arc for delivery evaluation')
 const current=buildDeliverySummary(readDeliverySummaryInputs(root,checked.parsed,delivery))
 if(!same(summary,current))throw Error('Delivery summary no longer matches current sweep/intent evidence')
 return summary
}
