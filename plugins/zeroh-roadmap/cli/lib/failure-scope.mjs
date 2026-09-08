// Eligibility is per failing check; correction authority belongs to the bounded router.
import {execFileSync} from 'node:child_process'
import {z} from 'zod'
import {ExactHeadCiResultShape} from './providers/ci.mjs'
import {loadConfig,ciPolicyOf} from './config.mjs'
import {diagnoseFailure,gateInputKey,retryDecision} from './gate-diagnostics.mjs'

const text=z.string().min(1),sha=z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
const path=z.string().refine(value=>value.length>0&&!/[\\\x00-\x1f]/.test(value)&&!value.startsWith('/')&&value.split('/').every(part=>part!==''&&part!=='.'&&part!=='..'),'canonical repository-relative path required')
const execution=z.object({exitCode:z.number().int().nullable(),signal:text.nullable(),output:z.string()}).strict()
const graphShape=z.object({baseSha:sha,sourceHeadSha:sha,complete:z.boolean(),edges:z.array(z.object({from:path,to:path}).strict())}).strict()
const packetShape=z.object({schemaVersion:z.literal(1),root:text,baseSha:sha,sourceHeadSha:sha,gateInputKey:sha,
 failures:z.array(z.object({checkKey:text,attemptId:text,command:text,execution,paths:z.array(path),logRefs:z.array(text),reruns:z.array(z.object({headSha:sha,command:text,execution}).strict())}).strict()),
 baseReproductions:z.array(z.object({checkKey:text,command:text,headSha:sha,execution}).strict()),
 retryReports:z.array(z.object({attempt:z.object({inputKey:text.nullable()}).passthrough(),slots:z.array(z.object({slot:text,command:text,exitCode:z.number().int().nullable(),failure:z.object({signature:text}).passthrough().nullable().optional()}).passthrough())}).passthrough()),
 dependencyGraph:graphShape.optional(),
}).strict()
const gitAt=(root,args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',timeout:10000,maxBuffer:8*1024*1024,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}}).trim()
const empty=(reason,headSha=null,inputKey=null)=>({status:'held',scope:'held',headSha,gateInputKey:inputKey,failures:[],editPaths:[],retryDecision:{blocked:false,failures:[]},reasons:[reason]})
const canonicalGraph=graph=>JSON.stringify({...graph,edges:[...graph.edges].sort((a,b)=>a.from.localeCompare(b.from)||a.to.localeCompare(b.to))})
function ancestors(changed,target,graph){
 return changed.filter(start=>{
  const seen=new Set(),pending=[start]
  while(pending.length){const current=pending.pop();if(current===target)return true;if(seen.has(current))continue;seen.add(current);for(const edge of graph?.edges??[])if(edge.from===current)pending.push(edge.to)}
  return false
 })
}
function mentions(output,file){
 const escaped=file.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
 return new RegExp(`(?:^|[\\s('"\\x60])(?:\\./)?${escaped}(?=$|[\\s:)'"\\x60])`,'m').test(output)
}
export function classifyFailureScope(ciValue,evidence,deps={}){
 let ci,packet,changed,graph=null,ownership=[]
 try{
  ci=ExactHeadCiResultShape.parse(ciValue);packet=packetShape.parse(evidence)
  if(ci.headMode!=='source'||ci.hold||packet.baseSha!==ci.baseSha||packet.sourceHeadSha!==ci.sourceHeadSha)throw Error('CI and repository evidence must bind the same observable source/base')
  const git=args=>(deps.git??gitAt)(packet.root,args)
  if(git(['rev-parse','HEAD'])!==ci.sourceHeadSha||git(['merge-base',ci.baseSha,ci.sourceHeadSha])!==ci.baseSha)throw Error('Current Git HEAD/base differ from CI')
  const inputKey=(deps.gateInputKeyOf??gateInputKey)(packet.root)
  if(!inputKey||inputKey!==packet.gateInputKey)throw Error('Effective repository inputs changed or are unobservable')
  changed=git(['diff','--name-only','-z',ci.baseSha,ci.sourceHeadSha,'--']).split('\0').filter(Boolean)
  if(!changed.every(file=>path.safeParse(file).success))throw Error('Changed paths are not canonical')
  if(new Set(packet.failures.map(f=>f.checkKey)).size!==packet.failures.length)throw Error('Duplicate failure evidence')
  for(const f of packet.failures){const check=ci.checks.find(c=>c.key===f.checkKey);if(check?.verdict!=='red'||check.latestAttemptId!==f.attemptId)throw Error('Failure is not the exact latest failing check attempt')}
  const cfg=(deps.loadConfig??loadConfig)(packet.root)
  ownership=z.array(z.object({pathPrefix:path,owner:text}).strict()).parse(ciPolicyOf(cfg,deps.arcId).ownership)
  if(packet.dependencyGraph&&deps.collectDependencyGraph){
   const trusted=graphShape.parse(deps.collectDependencyGraph(packet.root,ci.sourceHeadSha))
   if(trusted.baseSha!==ci.baseSha||trusted.sourceHeadSha!==ci.sourceHeadSha||canonicalGraph(trusted)!==canonicalGraph(packet.dependencyGraph))throw Error('Dependency graph contradicts current collected evidence')
   graph=trusted
  }
 }catch(error){return empty(error.message,ci?.sourceHeadSha,packet?.gateInputKey)}
 const failures=[],editPaths=new Set()
 for(const check of ci.checks.filter(c=>c.verdict==='red')){
  const f=packet.failures.find(item=>item.checkKey===check.key)
  const diagnostic=f?diagnoseFailure(f.execution):null
  const row={checkKey:check.key,attemptId:check.latestAttemptId,kind:'indeterminate',editEligible:false,paths:f?.paths??[],signature:diagnostic?.signature??null,diagnostic,reasons:[]}
  failures.push(row)
  if(!f||!diagnostic||!f.execution.output.trim()||!f.logRefs.length){row.reasons.push('Missing failing execution or observable log reference');continue}
  const bases=packet.baseReproductions.filter(base=>base.checkKey===f.checkKey)
  if(bases.length>1||bases.some(base=>base.command!==f.command||base.headSha!==ci.baseSha)){row.reasons.push('Contradictory base reproduction binding');continue}
  if(f.reruns.some(run=>run.headSha!==ci.sourceHeadSha||run.command!==f.command)){row.reasons.push('Contradictory rerun binding');continue}
  const rerunDiagnostics=f.reruns.map(run=>diagnoseFailure(run.execution))
  if(rerunDiagnostics.some(result=>result&&result.signature!==diagnostic.signature)||(rerunDiagnostics.some(result=>result===null)&&rerunDiagnostics.some(result=>result!==null))){row.reasons.push('Contradictory same-head rerun diagnostics');continue}
  if(f.execution.signal||['resource','authority-quota','tooling'].includes(diagnostic.category)){row.kind='infra';row.reasons.push('Repair the observed execution prerequisite without product edits');continue}
  if(f.reruns.some(run=>run.execution.exitCode===0&&!run.execution.signal)){row.kind='flaky';row.reasons.push('Same-head same-command successful rerun observed');continue}
  if(diagnostic.category!=='product'||!f.paths.length||new Set(f.paths).size!==f.paths.length||!f.paths.every(file=>mentions(f.execution.output,file))){row.reasons.push('Product paths are missing, contradictory, or absent from failing output');continue}
  const links=f.paths.map(file=>ancestors(changed,file,graph))
  const base=bases[0],baseDiagnostic=base?diagnoseFailure(base.execution):null
  if(base&&baseDiagnostic&&baseDiagnostic.signature!==diagnostic.signature){row.reasons.push('Base reproduction has a contradictory failure signature');continue}
  const reproduced=baseDiagnostic?.signature===diagnostic.signature
  const owned=f.paths.every(file=>ownership.some(rule=>file===rule.pathPrefix||file.startsWith(`${rule.pathPrefix}/`)))
  if(links.every(link=>link.length)&&!reproduced){row.kind='causal';row.editEligible=true;for(const file of [...f.paths,...links.flat()])editPaths.add(file);row.reasons.push('Every implicated path has a changed-file or collected dependency link')}
  else if(owned&&reproduced){row.kind='owned-preexisting';row.editEligible=true;for(const file of f.paths)editPaths.add(file);row.reasons.push('Loaded ownership and same-signature base reproduction agree')}
  else if(graph?.complete&&links.every(link=>!link.length)&&!f.paths.some(file=>ownership.some(rule=>file===rule.pathPrefix||file.startsWith(`${rule.pathPrefix}/`)))&&base?.execution.exitCode===0&&!base.execution.signal){row.kind='unrelated';row.reasons.push('Complete collected graph excludes change links; unowned path and clean base are observed')}
  else row.reasons.push('No complete causal or owned-base explanation; collect missing evidence')
 }
 const kinds=new Set(failures.map(f=>f.kind)),eligible=failures.some(f=>f.editEligible)
 const scope=kinds.size>1?'mixed':eligible?'editable':kinds.has('infra')||kinds.has('flaky')?'retryable':kinds.has('unrelated')?'unrelated':'held'
 return {status:scope==='held'?'held':'classified',scope,headSha:ci.sourceHeadSha,gateInputKey:packet.gateInputKey,failures,editPaths:[...editPaths].sort(),retryDecision:retryDecision(packet.retryReports,packet.gateInputKey,packet.failures.map(f=>({slot:f.checkKey,command:f.command}))),reasons:[]}
}
