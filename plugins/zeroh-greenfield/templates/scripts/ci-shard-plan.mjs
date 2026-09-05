#!/usr/bin/env node
/** Consumer-owned delivery engine. No shell interpolation; raw reports remain evidence. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync, existsSync, readlinkSync } from 'node:fs'
import { resolve, relative, dirname, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
export const SCHEMA_VERSION=1
export const MAX_INFRA_RETRIES=2
export const MAX_EVIDENCE_DAYS=7
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)
export const digest=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:canonical(value)).digest('hex')
const equal=(a,b,message)=>assert.equal(canonical(a),canonical(b),message)
const sha=value=>assert.match(value??'',/^[a-f0-9]{40}$/,'exact source SHA/tree required')
const integer=(n,min=0)=>assert.ok(Number.isSafeInteger(n)&&n>=min,'nonnegative integer required')
const date=value=>{const n=Date.parse(value);assert.ok(Number.isFinite(n),'valid timestamp required');return n}
const words=value=>{assert.ok(Array.isArray(value)&&value.length&&value.every(x=>typeof x==='string'&&x.length&&!x.includes('\0')),'exact nonempty argv required');return value}
const nonempty=value=>assert.ok(typeof value==='string'&&value.trim(),'nonempty text required')
export const ADAPTERS=Object.freeze({
 web:{runners:['vitest','playwright'],inventoryArgv:['npm','exec','--','vitest','list','--filesOnly'],shardArgv:['npm','exec','--','vitest','run','{unit}'],reports:['junit','lcov'],merge:'canonical-lines',buildArgv:['npm','run','build'],remedy:'Install and pin vitest, @vitest/coverage-v8, @playwright/test and browser dependencies.'},
 expo:{runners:['jest','playwright'],inventoryArgv:['npm','exec','--','jest','--listTests','--json'],shardArgv:['npm','exec','--','jest','--runTestsByPath','{unit}'],reports:['junit','lcov'],merge:'canonical-lines',buildArgv:['npm','exec','--','expo','export'],remedy:'Install and pin jest-expo, jest-junit, @playwright/test and browser dependencies.'},
 flutter:{runners:['flutter'],inventoryArgv:['git','ls-files','-z','--','test'],shardArgv:['flutter','test','--machine','--coverage','{unit}'],reports:['flutter-machine','lcov'],merge:'canonical-lines',buildArgv:['flutter','build','web'],remedy:'Install the approved pinned Flutter SDK and select an explicit build platform.'},
 android:{runners:['gradle'],inventoryArgv:['./gradlew','tasks','--all','--console=plain'],shardArgv:['./gradlew','{unit}','--no-daemon','--console=plain'],reports:['junit','jacoco'],merge:'canonical-lines',buildArgv:['./gradlew',':app:assembleRelease','--no-daemon'],remedy:'Install the approved JDK/Android SDK and configure leaf Test tasks plus JaCoCo XML.'},
 'nx-monorepo':{runners:['nx'],inventoryArgv:['npm','exec','--','nx','show','projects','--withTarget=test','--json'],shardArgv:['npm','exec','--','nx','run','{unit}','--excludeTaskDependencies','--skipNxCache'],reports:['junit','lcov'],merge:'canonical-lines',buildArgv:['npm','exec','--','nx','run-many','-t','build'],remedy:'Install pinned Nx and configure each leaf target runner with uncached JUnit and coverage outputs.'},
 'library-cli':{runners:['node:test'],inventoryArgv:['git','ls-files','-z','--','test','tests'],shardArgv:['node','--test','--experimental-test-coverage','{unit}'],reports:['junit','lcov'],merge:'canonical-lines',buildArgv:['npm','run','build'],remedy:'Install the approved Node 22+ runtime and the locked build dependencies.'},
})
export function canonicalPath(path,roots=[]) {
 nonempty(path);let p=path.replaceAll('\\','/')
 for(const root of [...roots].sort((a,b)=>b.length-a.length)){const prefix=root.replaceAll('\\','/').replace(/\/$/,'')+'/';if(p.startsWith(prefix))p=p.slice(prefix.length)}
 p=p.replace(/^\.\//,'')
 assert.ok(!p.startsWith('/')&&!/^[A-Za-z]:\//.test(p)&&!p.split('/').some(x=>!x||x==='.'||x==='..')&&!/[\0\r\n]/.test(p),'unsafe canonical path')
 return p
}
const identityKey=u=>canonical([u.runner,u.canonicalPathOrLeafTask])
function normalizeUnit(unit,archetype){
 assert.ok(unit&&typeof unit==='object');equal(Object.keys(unit).sort(),['canonicalPathOrLeafTask','runner'])
 assert.ok(ADAPTERS[archetype]?.runners.includes(unit.runner),'runner does not belong to selected adapter')
 return {runner:unit.runner,canonicalPathOrLeafTask:canonicalPath(unit.canonicalPathOrLeafTask)}
}
export function planShards({archetype,inventory,shardCount,commitSha,tree,adapterConfig={}}){
 assert.ok(Object.hasOwn(ADAPTERS,archetype),'unsupported adapter: install/configure a supported runner');sha(commitSha);sha(tree);integer(shardCount,1)
 assert.ok(Array.isArray(inventory)&&inventory.length,'empty inventory is unavailable, never green')
 const units=inventory.map(u=>normalizeUnit(u,archetype)).sort((a,b)=>identityKey(a).localeCompare(identityKey(b),'en'))
 assert.equal(new Set(units.map(identityKey)).size,units.length,'duplicate atomic identity')
 if(['android','nx-monorepo'].includes(archetype))for(const unit of units){
  const leaf=adapterConfig.leafTasks?.[unit.canonicalPathOrLeafTask]
  assert.ok(leaf&&leaf.aggregate===false&&Array.isArray(leaf.dependencies),'explicit leaf/dependency inventory required')
  assert.ok(!leaf.dependencies.some(dep=>units.some(u=>u.canonicalPathOrLeafTask===dep)),'dependency-overlapping leaf tasks')
  assert.ok(archetype==='android'?/^:(?:[\w.-]+:)+test[\w]+$/.test(unit.canonicalPathOrLeafTask):/^[\w@./-]+:[\w-]+$/.test(unit.canonicalPathOrLeafTask),'aggregate or malformed leaf task')
 }
 const retry=adapterConfig.maxInfraRetries??0;integer(retry);assert.ok(retry<=MAX_INFRA_RETRIES,'bounded infra retries required')
 const count=Math.min(shardCount,units.length),shards=Array.from({length:count},(_,index)=>({index,units:[]}))
 units.forEach((unit,index)=>shards[index%count].units.push(unit))
 const manifest={schemaVersion:SCHEMA_VERSION,archetype,sha:commitSha,tree,inventory:units,adapterConfigDigest:digest(adapterConfig)}
 return {...manifest,adapterConfig,suiteManifestDigest:digest(manifest),defaultWeight:1,shards}
}
function validatePlan(plan){
 const rebuilt=planShards({archetype:plan.archetype,inventory:plan.inventory,shardCount:plan.shards?.length,commitSha:plan.sha,tree:plan.tree,adapterConfig:plan.adapterConfig})
 equal(plan,rebuilt,'plan/inventory digest or shard assignment drift');return plan
}
// Strict small XML reader: rejects DTD/entities, malformed nesting and attributes;
// native JUnit/JaCoCo XML are parsed, never treated as interchangeable JSON.
function xml(text){
 assert.ok(typeof text==='string'&&text.trim(),'missing XML');assert.doesNotMatch(text,/<!DOCTYPE|<!ENTITY/i)
 const decode=s=>s.replace(/&(?:amp|lt|gt|quot|apos);/g,e=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[e]))
 const root={name:'root',children:[]},stack=[root]
 const tokens=text.match(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>|[^<]+/g)??[]
 assert.equal(tokens.join(''),text,'malformed XML token')
 for(const token of tokens){
  if(token.startsWith('<?')||token.startsWith('<!--')||token.startsWith('<![CDATA['))continue
  if(!token.startsWith('<')){assert.ok(stack.length>1||!token.trim(),'text outside XML root');continue}
  if(token.startsWith('</')){assert.equal(stack.pop()?.name,token.slice(2,-1).trim(),'malformed XML closing tag');assert.ok(stack.length);continue}
  const match=token.match(/^<([\w:.-]+)([\s\S]*?)(\/?)>$/);assert.ok(match,'malformed XML opening tag')
  const attrs={},rest=match[2].replace(/\s+([\w:.-]+)\s*=\s*("[^"]*"|'[^']*')/g,(_,key,value)=>{assert.ok(!Object.hasOwn(attrs,key),'duplicate XML attribute');attrs[key]=decode(value.slice(1,-1));return ''})
  assert.equal(rest.trim(),'','malformed XML attribute');const node={name:match[1],attrs,children:[]};stack.at(-1).children.push(node);if(!match[3])stack.push(node)
 }
 assert.equal(stack.length,1,'truncated XML');assert.equal(root.children.length,1,'one XML root required');return root.children[0]
}
const descend=(node,name)=>[...(node.name===name?[node]:[]),...node.children.flatMap(c=>descend(c,name))]
export function parseReport(format,content,{coverageRoots=[]}={}){
 if(format==='junit'){
  const root=xml(content);assert.ok(['testsuites','testsuite'].includes(root.name),'JUnit root required')
  const cases=descend(root,'testcase').map(c=>({id:`${c.attrs.classname??''}:${c.attrs.name??''}`,status:c.children.some(n=>['failure','error'].includes(n.name))?'failed':c.children.some(n=>n.name==='skipped')?'skipped':'passed'}))
  assert.ok(cases.length,'empty JUnit report');for(const c of cases)nonempty(c.id.replace(':',''))
  assert.equal(new Set(cases.map(c=>c.id)).size,cases.length,'duplicate test cases')
  for(const suite of [...descend(root,'testsuite'),...(root.name==='testsuites'?[root]:[])]){
   const children=descend(suite,'testcase')
   for(const [field,count]of [['tests',children.length],['failures',children.filter(c=>c.children.some(n=>n.name==='failure')).length],['errors',children.filter(c=>c.children.some(n=>n.name==='error')).length],['skipped',children.filter(c=>c.children.some(n=>n.name==='skipped')).length]])if(suite.attrs[field]!==undefined)assert.equal(Number(suite.attrs[field]),count,'partial/contradictory JUnit summary')
  }
  return {cases,coverage:[]}
 }
 if(format==='flutter-machine'){
  const events=content.trim().split(/\r?\n/).map(l=>JSON.parse(l));assert.ok(events.at(-1)?.type==='done','truncated Flutter machine report')
  const starts=events.filter(e=>e.type==='testStart');assert.equal(new Set(starts.map(e=>e.test?.id)).size,starts.length,'duplicate Flutter testStart');
  const names=new Map(events.filter(e=>e.type==='testStart'&&!e.test?.hidden).map(e=>[e.test.id,e.test.name]))
  const cases=events.filter(e=>e.type==='testDone'&&names.has(e.testID)).map(e=>({id:String(e.testID)+':'+names.get(e.testID),status:e.skipped?'skipped':e.result==='success'?'passed':'failed'}))
  assert.ok(cases.length);assert.equal(cases.length,names.size,'partial Flutter report');assert.equal(new Set(cases.map(c=>c.id)).size,cases.length)
  if(events.at(-1).success!==true)assert.ok(cases.some(c=>c.status==='failed'),'Flutter terminal failure without case evidence')
  return {cases,coverage:[]}
 }
 if(format==='lcov'){
  const coverage=[];let row=null
  for(const line of content.trim().split(/\r?\n/)){
   if(line.startsWith('SF:')){assert.equal(row,null,'truncated LCOV record');row={path:canonicalPath(line.slice(3),coverageRoots),lines:{}}}
   else if(line.startsWith('DA:')){assert.ok(row,'LCOV DA outside file');const [n,hits]=line.slice(3).split(',').map(Number);integer(n,1);integer(hits);assert.ok(!Object.hasOwn(row.lines,n),'duplicate LCOV line');row.lines[n]=hits}
   else if(line==='end_of_record'){assert.ok(row&&Object.keys(row.lines).length,'empty LCOV record');if(row.summaryLF!==undefined)assert.equal(row.summaryLF,Object.keys(row.lines).length,'LCOV LF mismatch');if(row.summaryLH!==undefined)assert.equal(row.summaryLH,Object.values(row.lines).filter(n=>n>0).length,'LCOV LH mismatch');delete row.summaryLF;delete row.summaryLH;coverage.push(row);row=null}
   else if(line.startsWith('LF:')||line.startsWith('LH:')){assert.ok(row);const n=Number(line.slice(3));integer(n);const k=line.startsWith('LF:')?'summaryLF':'summaryLH';assert.ok(!Object.hasOwn(row,k),'duplicate LCOV summary');row[k]=n}
   else assert.ok(!line||/^(TN|FN|FNDA|FNF|FNH|BRDA|BRF|BRH|LF|LH):/.test(line),'malformed LCOV field')
  }
  assert.equal(row,null,'truncated LCOV');assert.ok(coverage.length,'missing coverage');assert.equal(new Set(coverage.map(c=>c.path)).size,coverage.length,'duplicate coverage file');return {cases:[],coverage}
 }
 if(format==='jacoco'){
  const safe=content.replace(/<!DOCTYPE report PUBLIC "-\/\/JACOCO\/\/DTD Report 1\.1\/\/EN" "report\.dtd">/, '');const root=xml(safe);assert.equal(root.name,'report','JaCoCo report required');const coverage=[]
  for(const pack of descend(root,'package'))for(const source of pack.children.filter(n=>n.name==='sourcefile')){
   const lines={};for(const line of source.children.filter(n=>n.name==='line')){const n=Number(line.attrs.nr),ci=Number(line.attrs.ci);integer(n,1);integer(ci);assert.ok(!Object.hasOwn(lines,n));lines[n]=ci}
   assert.ok(Object.keys(lines).length);coverage.push({path:canonicalPath(`${pack.attrs.name?pack.attrs.name+'/':''}${source.attrs.name}`,coverageRoots),lines})
  }
  assert.ok(coverage.length);assert.equal(new Set(coverage.map(c=>c.path)).size,coverage.length,'duplicate JaCoCo source');return {cases:[],coverage}
 }
 throw Error('unavailable report parser: configure junit, flutter-machine, lcov or jacoco')
}
function parsedAttempt(attempt,config){
 assert.ok(Array.isArray(attempt.rawReports)&&attempt.rawReports.length,'raw reports required')
 const cases=[],coverage=[];const paths=new Set()
 for(const report of attempt.rawReports){canonicalPath(report.path);assert.ok(!paths.has(report.path),'duplicate raw report');paths.add(report.path);assert.equal(report.sha256,digest(report.content),'raw report digest drift')
  const parsed=parseReport(report.format,report.content,config);cases.push(...parsed.cases.map(c=>({...c,id:report.path+':'+c.id})));coverage.push(...parsed.coverage)
 }
 assert.ok(cases.length,'test report missing');assert.ok(coverage.length,'coverage report missing')
 if(attempt.cases!==undefined)equal(attempt.cases,cases,'normalized cases drift');if(attempt.coverage!==undefined)equal(attempt.coverage,coverage,'normalized coverage drift')
 return {cases,coverage}
}
function baselineCheck(baseline,config,approval){
 assert.ok(baseline);integer(baseline.minTests,1);integer(baseline.minUnits,1);assert.ok(Number.isFinite(baseline.coverageFloor)&&baseline.coverageFloor>=0&&baseline.coverageFloor<=100)
 const previous=config.baseline??approval?.previous
 if(previous&&canonical(previous)!==canonical(baseline)){
  assert.ok(approval,'baseline changes require explicit approval');nonempty(approval.owner);nonempty(approval.reason)
  assert.equal(approval.previousDigest,digest(previous));assert.equal(approval.approvedDigest,digest(baseline),'unapproved baseline change')
 }
}
function buildDigest(build,commitSha,tree){
 assert.equal(build?.sha,commitSha,'stale build SHA');assert.equal(build.tree,tree,'build tree mismatch');words(build.command);assert.equal(build.exitCode,0,'failed build')
 assert.ok(Array.isArray(build.files)&&build.files.length,'missing build artifact');const names=new Set()
 for(const file of build.files){canonicalPath(file.path);assert.ok(!names.has(file.path),'duplicate build path');names.add(file.path);assert.equal(Buffer.from(file.contentBase64??'', 'base64').toString('base64'),file.contentBase64,'malformed artifact bytes')}
 return digest([...build.files].sort((a,b)=>a.path.localeCompare(b.path,'en')))
}
function evaluateEvidence({plan,reports,coverage,baseline,baselineApproval=null,build,commitSha,now,producerRunId,expiresAt,authoritative=true}){
 validatePlan(plan);sha(commitSha);assert.equal(commitSha,plan.sha,'stale source SHA');assert.equal(authoritative,true,'only full authoritative evidence may attest');nonempty(String(producerRunId??''))
 const time=date(now),expiry=date(expiresAt);assert.ok(expiry>time&&expiry-time<=MAX_EVIDENCE_DAYS*86400000,'expired or excessive evidence lifetime')
 baselineCheck(baseline,plan.adapterConfig,baselineApproval)
 assert.ok(Array.isArray(reports));assert.equal(reports.length,plan.shards.length,'missing or duplicate shard report')
 const seen=new Set(),all=[],merged=new Map(),links=[];let testCount=0
 for(const report of reports){
  assert.equal(report.schemaVersion,SCHEMA_VERSION);integer(report.shardIndex);assert.ok(!seen.has(report.shardIndex),'duplicate shard');seen.add(report.shardIndex)
  const shard=plan.shards[report.shardIndex];assert.ok(shard,'unknown shard');equal(report.units,shard.units,'executed union differs from inventory');all.push(...report.units)
  assert.equal(report.suiteManifestDigest,plan.suiteManifestDigest,'inventory digest drift')
  assert.ok(Array.isArray(report.attempts)&&report.attempts.length,'missing first attempt');assert.ok(report.attempts.length<=1+(plan.adapterConfig.maxInfraRetries??0),'excessive retry')
  let final
  for(const [i,attempt]of report.attempts.entries()){
   assert.equal(attempt.number,i+1,'attempt history incomplete');assert.ok(['passed','required-test-failed','infra-failed','quarantined'].includes(attempt.outcome),'unknown attempt outcome')
   if(attempt.outcome==='quarantined'){nonempty(attempt.quarantine?.owner);nonempty(attempt.quarantine?.reason);assert.ok(date(attempt.quarantine?.expiresAt)>time,'expired quarantine');throw Error('quarantined required tests block authoritative evidence')}
   if(attempt.outcome==='required-test-failed')throw Error('required-test-failed/flaky remains blocking after retry')
   if(attempt.outcome==='infra-failed'){assert.notEqual(attempt.exitCode,0);assert.ok(attempt.infrastructure?.reason&&attempt.infrastructure?.code,'infrastructure classification evidence required');assert.ok(i<report.attempts.length-1,'unrecovered infrastructure failure');continue}
   assert.equal(i,report.attempts.length-1,'cannot retry successful tests');assert.equal(attempt.exitCode,0,'red shard');final=parsedAttempt(attempt,plan.adapterConfig)
   assert.ok(final.cases.every(c=>c.status==='passed'),'failed/skipped required case')
  }
  assert.ok(final,'no completed test attempt');testCount+=final.cases.length
  for(const row of final.coverage){const lines=merged.get(row.path)??{};for(const [n,hits]of Object.entries(row.lines))lines[n]=Math.max(lines[n]??0,hits);merged.set(row.path,lines)}
  links.push({shardIndex:report.shardIndex,sha256:digest(report)})
 }
 equal(all.map(identityKey).sort(),plan.inventory.map(identityKey).sort(),'exact-once union failed');assert.ok(testCount>=baseline.minTests,'test-count regression');assert.ok(all.length>=baseline.minUnits,'inventory-count regression')
 const mergedCoverage=[...merged].sort(([a],[b])=>a.localeCompare(b,'en')).map(([path,lines])=>({path,lines}));const hits=mergedCoverage.flatMap(c=>Object.values(c.lines));assert.ok(hits.length,'coverage unavailable');const percent=100*hits.filter(n=>n>0).length/hits.length;assert.ok(percent>=baseline.coverageFloor,'coverage-floor regression')
 if(coverage!==undefined)equal(coverage,mergedCoverage,'coverage digest/content drift')
 return {schemaVersion:SCHEMA_VERSION,authoritative:true,sha:commitSha,tree:plan.tree,suiteManifestDigest:plan.suiteManifestDigest,shardReports:links.sort((a,b)=>a.shardIndex-b.shardIndex),coverageDigest:digest(mergedCoverage),...(build?{buildDigest:buildDigest(build,commitSha,plan.tree)}:{}),producerRunId:String(producerRunId),expiresAt,baselineDigest:digest(baseline),testCount,coveragePercent:percent}
}
export function validateEvidence(request){assert.ok(request.build,'attestation requires an actual build');return evaluateEvidence(request)}
export function verifyRelease({manifests,tagSha,tree,plan,reports,coverage,baseline,baselineApproval=null,build,now}){
 sha(tagSha);sha(tree);assert.equal(plan.sha,tagSha,'tag SHA drift');assert.equal(plan.tree,tree,'tag tree drift');assert.ok(Array.isArray(manifests))
 const matching=manifests.filter(m=>m.authoritative===true&&m.sha===tagSha&&date(m.expiresAt)>date(now));assert.equal(matching.length,1,'exactly one unexpired authoritative producer required')
 const manifest=matching[0];const calculated=validateEvidence({plan,reports,coverage,baseline,baselineApproval,build,commitSha:tagSha,now,producerRunId:manifest.producerRunId,expiresAt:manifest.expiresAt})
 equal(manifest,calculated,'manifest/report/coverage/build/producer digest drift')
 return {artifactDigest:manifest.buildDigest,promoteOnly:true,producerRunId:manifest.producerRunId,sha:manifest.sha,tree:manifest.tree,suiteManifestDigest:manifest.suiteManifestDigest,buildRecordDigest:digest(build)}
}

const json=path=>JSON.parse(readFileSync(path,'utf8'))
function save(path,value){mkdirSync(dirname(resolve(path)),{recursive:true});writeFileSync(path,JSON.stringify(value,null,2)+'\n')}
function execute(argv,{cwd=process.cwd(),env={}}={}){
 words(argv);const result=spawnSync(argv[0],argv.slice(1),{cwd,env:{...process.env,...env},encoding:'utf8',maxBuffer:32*1024*1024})
 if(result.error)throw Error(`unavailable: ${argv[0]}: ${result.error.message}; install the selected adapter tooling`)
 return {argv,exitCode:result.status??1,stdout:result.stdout??'',stderr:result.stderr??''}
}
function checked(argv,options){const result=execute(argv,options);assert.equal(result.exitCode,0,`${argv[0]} unavailable/failed: ${result.stderr}`);return result.stdout}
function regular(path){assert.ok(lstatSync(path).isFile()&&!lstatSync(path).isSymbolicLink(),'regular artifact file required')}
const replaceArgs=(argv,vars)=>words(argv).map(arg=>arg.replace(/\{(unit|reportDir|junit|coverage|artifact)\}/g,(_,key)=>{assert.ok(Object.hasOwn(vars,key));return vars[key]}))
function tooling(config){assert.equal(config?.schemaVersion,SCHEMA_VERSION,'delivery config unavailable: approve and install schemaVersion 1 config');assert.ok(ADAPTERS[config.archetype],'unsupported adapter');assert.ok(config.runners&&typeof config.runners==='object','runner configuration unavailable');return config}
function inventoryPaths(output,binding){
 let paths
  if(binding.inventoryFormat==='lines')paths=output.trim().split(/\r?\n/).filter(Boolean)
  else if(binding.inventoryFormat==='git-nul')paths=output.split('\0').filter(Boolean).filter(p=>new RegExp(binding.filePattern??'\\.(test|spec)\\.[cm]?[jt]sx?$').test(p))
  else if(binding.inventoryFormat==='json-paths'){paths=JSON.parse(output);assert.ok(Array.isArray(paths)&&paths.every(p=>typeof p==='string'))}
  else if(binding.inventoryFormat==='playwright-json'){
   const value=JSON.parse(output);const visit=suites=>suites.flatMap(s=>[...(s.specs?.length?[s.file]:[]),...visit(s.suites??[])]);paths=[...new Set(visit(value.suites??[]))]
  }else throw Error('unavailable inventory parser: configure lines, git-nul, json-paths or playwright-json')
  if(binding.pathPrefix)paths=paths.map(p=>p.startsWith(binding.pathPrefix)?p.slice(binding.pathPrefix.length):p)
  if(binding.targetSuffix)paths=paths.map(p=>p+binding.targetSuffix)
 return paths.map(path=>canonicalPath(path))
}
export function inventoryFromConfig(config){
 tooling(config);const inventory=[]
 for(const runner of ADAPTERS[config.archetype].runners){
  const binding=config.runners[runner];assert.ok(binding,`${runner} unavailable: ${ADAPTERS[config.archetype].remedy}`)
  const output=checked(binding.inventoryArgv)
  const paths=inventoryPaths(output,binding)
  inventory.push(...paths.map(path=>({runner,canonicalPathOrLeafTask:canonicalPath(path)})))
 }
 return inventory
}
export function runShard({plan,index,config}){
 validatePlan(plan);tooling(config);assert.ok(plan.adapterConfig.executionContract,'planned execution contract required');equal({runners:config.runners,build:config.build},plan.adapterConfig.executionContract,'runner/build contract drift');assert.equal(config.archetype,plan.archetype)
 integer(index);const shard=plan.shards[index];assert.ok(shard,'unknown shard');const rawReports=[],executions=[];let failure=false
 for(const [i,unit]of shard.units.entries()){
  const binding=config.runners[unit.runner];assert.ok(binding,`${unit.runner} unavailable`)
  const reportDir=`.ci/raw/${index}/${i}`;assert.ok(!existsSync(reportDir),'old raw report directory must not mask missing output');mkdirSync(reportDir,{recursive:true})
  const vars={unit:unit.canonicalPathOrLeafTask,reportDir,junit:`${reportDir}/junit.xml`,coverage:`${reportDir}/coverage.lcov`}
  if(['vitest','playwright'].includes(unit.runner)){
   assert.ok(binding.selectionArgv?.some(arg=>arg.includes('{unit}')),'exact selected-inventory probe required')
   const selected=inventoryPaths(checked(replaceArgs(binding.selectionArgv,vars)),{...binding,inventoryFormat:binding.selectionFormat})
   equal(selected,[unit.canonicalPathOrLeafTask],'runner selection overmatches or omits requested file')
  }
  const argv=replaceArgs(binding.shardArgv,vars);assert.ok(binding.shardArgv.some(arg=>arg.includes('{unit}')),'exact unit argument required')
  const result=execute(argv,{env:Object.fromEntries(Object.entries(binding.env??{}).map(([key,value])=>[key,replaceArgs([value],vars)[0]]))})
  writeFileSync(`${reportDir}/stdout.log`,result.stdout);writeFileSync(`${reportDir}/stderr.log`,result.stderr)
  executions.push({unit,...result});if(result.exitCode!==0)failure=true
  assert.ok(Array.isArray(binding.rawReports)&&binding.rawReports.length,'raw report contract unavailable')
  for(const ref of binding.rawReports){
   const path=replaceArgs([ref.path],vars)[0];canonicalPath(path)
   if(ref.from==='stdout')writeFileSync(path,result.stdout)
   assert.ok(existsSync(path),`required raw report missing: ${path}`);regular(path)
   const content=readFileSync(path,'utf8');rawReports.push({path,format:ref.format,content,sha256:digest(content)})
  }
 }
 const attempt={number:1,outcome:failure?'required-test-failed':'passed',exitCode:failure?1:0,executions,rawReports}
 // Test retries are deliberately disabled. An orchestrator infrastructure retry
 // must preserve this first record and meet the bounded fan-in policy.
 return {schemaVersion:SCHEMA_VERSION,shardIndex:index,suiteManifestDigest:plan.suiteManifestDigest,units:shard.units,attempts:[attempt]}
}
export function buildArtifact({config,plan,sha:commitSha,tree}){
 validatePlan(plan);assert.equal(plan.sha,commitSha);assert.equal(plan.tree,tree);equal({runners:config.runners,build:config.build},plan.adapterConfig.executionContract,'build execution contract drift');
 tooling(config);sha(commitSha);sha(tree);assert.ok(config.build,'build configuration unavailable');words(config.build.argv)
 assert.ok(Array.isArray(config.build.outputs)&&config.build.outputs.length,'explicit build outputs required')
 const files=[],paths=[]
 function visit(path){canonicalPath(path);assert.ok(!lstatSync(path).isSymbolicLink(),'build symlinks are forbidden');if(lstatSync(path).isDirectory())for(const name of readdirSync(path).sort())visit(`${path}/${name}`);else{regular(path);assert.ok(!paths.includes(path),'overlapping output roots');paths.push(path)}}
 const before={};for(const path of config.build.outputs){canonicalPath(path);if(existsSync(path)){visit(path);for(const p of paths)before[p]=digest(readFileSync(p));paths.length=0}}
 const result=execute(config.build.argv);assert.equal(result.exitCode,0,'build failed')
 for(const path of config.build.outputs){assert.ok(existsSync(path),`missing build output ${path}`);visit(path)}
 for(const path of paths.sort())files.push({path,contentBase64:readFileSync(path).toString('base64')})
 const build={sha:commitSha,tree,command:result.argv,exitCode:result.exitCode,before,files};buildDigest(build,commitSha,tree);return build
}
export async function promoteArtifact({verification,build,config,credentialsAvailable}){
 assert.equal(verification?.promoteOnly,true,'verified artifact required');assert.equal(build.sha,verification.sha,'promotion source SHA drift');assert.equal(build.tree,verification.tree,'promotion source tree drift');assert.equal(digest(build),verification.buildRecordDigest,'selected build record drift');assert.match(verification.suiteManifestDigest??'',/^[a-f0-9]{64}$/);assert.equal(verification.artifactDigest,buildDigest(build,build.sha,build.tree),'promotion bytes drift')
 const release=config.release;assert.equal(release?.provider,'aws-s3-v1','unavailable provider: approve aws-s3-v1 configuration');assert.ok(!release.promoteArgv,'arbitrary promotion argv forbidden');nonempty(release.environment)
 assert.match(release.bucket??'',/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/);assert.match(release.region??'',/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/);canonicalPath(release.keyPrefix)
 assert.match(release.roleArn??'',/^arn:aws(?:-us-gov)?:iam::[0-9]{12}:role\/[\w+=,.@/-]+$/,'approved OIDC role required')
 assert.equal(credentialsAvailable,true,'deployment credentials unavailable')
 const tokenUrl=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL??'');assert.equal(tokenUrl.protocol,'https:','OIDC endpoint must use HTTPS');tokenUrl.searchParams.set('audience','sts.amazonaws.com')
 nonempty(process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)
 const response=await fetch(tokenUrl,{headers:{Authorization:`Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`}});assert.ok(response.ok,'OIDC token request failed');const oidc=await response.json();nonempty(oidc.value)
 const assumed=JSON.parse(checked(['aws','sts','assume-role-with-web-identity','--role-arn',release.roleArn,'--role-session-name','greenfield-release','--web-identity-token',oidc.value,'--region',release.region,'--output','json']))
 const c=assumed.Credentials;nonempty(c?.AccessKeyId);nonempty(c?.SecretAccessKey);nonempty(c?.SessionToken)
 const env={AWS_ACCESS_KEY_ID:c.AccessKeyId,AWS_SECRET_ACCESS_KEY:c.SecretAccessKey,AWS_SESSION_TOKEN:c.SessionToken}
 const artifact=`.ci/promote/${verification.artifactDigest}.json`;assert.ok(!existsSync(artifact),'promotion artifact already exists');mkdirSync(dirname(artifact),{recursive:true});writeFileSync(artifact,canonical([...build.files].sort((a,b)=>a.path.localeCompare(b.path,'en'))))
 const bytes=readFileSync(artifact);assert.equal(digest(bytes),verification.artifactDigest)
 const key=`${release.keyPrefix}/${verification.artifactDigest}.json`,checksum=Buffer.from(verification.artifactDigest,'hex').toString('base64')
 const result=JSON.parse(checked(['aws','s3api','put-object','--bucket',release.bucket,'--key',key,'--body',artifact,'--checksum-algorithm','SHA256','--checksum-sha256',checksum,'--region',release.region,'--output','json'],{env}))
 nonempty(result.VersionId);assert.notEqual(result.VersionId,'null','versioned bucket required');assert.equal(result.ChecksumSHA256,checksum,'provider upload checksum mismatch')
 const head=JSON.parse(checked(['aws','s3api','head-object','--bucket',release.bucket,'--key',key,'--version-id',result.VersionId,'--checksum-mode','ENABLED','--region',release.region,'--output','json'],{env}))
 assert.equal(head.VersionId,result.VersionId);assert.equal(head.ContentLength,bytes.length);assert.equal(head.ChecksumSHA256,checksum,'provider readback checksum mismatch')
 assert.equal(digest(readFileSync(artifact)),verification.artifactDigest,'promotion changed artifact bytes')
 return {promoted:true,artifactDigest:verification.artifactDigest,provider:'aws-s3-v1',bucket:release.bucket,key,versionId:result.VersionId}
}
function context(){return {sha:checked(['git','rev-parse','HEAD']).trim(),tree:checked(['git','rev-parse','HEAD^{tree}']).trim()}}
const DEFAULT_OPERATIONAL_ROOTS=['.ci','node_modules']
const under=(path,roots)=>roots.some(root=>path===root||path.startsWith(root+'/'))
function allowedRoots(config,allowBuildOutputs){
 const roots=[...(config.operationalRoots??DEFAULT_OPERATIONAL_ROOTS),...(allowBuildOutputs?config.build?.outputs??[]:[])]
 for(const root of roots)canonicalPath(root)
 return roots
}
function cleanTracked(roots){
 const changed=checked(['git','diff','--name-only','-z','HEAD','--']).split('\0').filter(Boolean)
 assert.ok(changed.every(path=>under(path,roots)),'tracked source changed outside approved operational/build roots')
}
function sourceSnapshot(roots){
 const state={}
 function visit(path){
  if(path==='.git'||under(path,roots))return
  const st=lstatSync(path)
  if(st.isSymbolicLink()){state[path]={symlink:readlinkSync(path)};return}
  if(st.isDirectory()){state[path]={directory:true,mode:st.mode};for(const name of readdirSync(path).sort())visit(`${path}/${name}`)}
  else{assert.ok(st.isFile(),'unsupported source entry');state[path]={sha256:digest(readFileSync(path)),mode:st.mode}}
 }
 for(const name of readdirSync('.').sort())visit(name)
 return state
}
export function guardSource(config,operation,{allowBuildOutputs=false}={}){
 const roots=allowedRoots(config,allowBuildOutputs);cleanTracked(roots);const before=sourceSnapshot(roots),commit=context()
 try{return operation()}finally{equal(context(),commit,'source commit/tree changed');cleanTracked(roots);equal(sourceSnapshot(roots),before,'unapproved source or untracked file changed')}
}
function guardedRequest(request,operation,{allowBuildOutputs=false}={}){
 if(!request.verifySource)return operation()
 equal(request.config.operationalRoots??DEFAULT_OPERATIONAL_ROOTS,request.plan.adapterConfig.operationalRoots??DEFAULT_OPERATIONAL_ROOTS,'operational allowlist drift')
 equal(context(),{sha:request.plan.sha,tree:request.plan.tree},'source SHA/tree mismatch')
 return guardSource(request.config,operation,{allowBuildOutputs})
}
function setup(config){for(const argv of config.setupArgv??[])checked(argv)}
function prepare(mode){
 const config=tooling(json('.github/greenfield-delivery.json')),ctx=context();mkdirSync('.ci',{recursive:true})
 if(mode==='plan'){
  const inventory=guardSource(config,()=>{setup(config);return inventoryFromConfig(config)})
  save('.ci/plan-request.json',{archetype:config.archetype,inventory,shardCount:config.shardCount,commitSha:ctx.sha,tree:ctx.tree,adapterConfig:{...config.adapterConfig,baseline:config.baseline,operationalRoots:config.operationalRoots??DEFAULT_OPERATIONAL_ROOTS,executionContract:{runners:config.runners,build:config.build}}})
 }else if(mode==='run'){
  guardSource(config,()=>setup(config));const plan=json('.ci/plan.json');assert.equal(plan.sha,ctx.sha,'downloaded plan SHA mismatch');const index=Number(process.env.SHARD_INDEX);config.adapterConfig={...config.adapterConfig,baseline:config.baseline};equal(context(),ctx,'source changed during setup');save('.ci/run-request.json',{plan,index,config,verifySource:true})
 }else if(mode==='fanin'||mode==='attest'){
  const plan=json('.ci/plan.json'),reports=readdirSync('.ci/reports').filter(p=>p.endsWith('.json')).map(p=>json(`.ci/reports/${p}`));assert.equal(plan.sha,ctx.sha)
  const request={plan,reports,baseline:config.baseline,baselineApproval:config.baselineApproval??null,commitSha:ctx.sha,now:new Date().toISOString(),producerRunId:process.env.GITHUB_RUN_ID,expiresAt:new Date(Date.now()+86400000*(config.evidenceDays??1)).toISOString(),authoritative:true}
  if(mode==='attest'){request.build=json('.ci/build.json');request.expiresAt=json('.ci/fanin.json').expiresAt}
  save(`.ci/${mode}-request.json`,request)
  if(mode==='fanin')save('.ci/build-request.json',{config,plan,...ctx,verifySource:true})
 }else throw Error('unknown preparation stage')
}
function gatherEvidence(){
 const repository=process.env.GITHUB_REPOSITORY;assert.match(repository??'',/^[\w.-]+\/[\w.-]+$/)
 const requested=process.env.RELEASE_REF;nonempty(requested)
 const commitSha=checked(['git','rev-parse',`${requested}^{commit}`]).trim(),tree=checked(['git','rev-parse',`${commitSha}^{tree}`]).trim();sha(commitSha);sha(tree)
 const runs=JSON.parse(checked(['gh','api','--paginate','--slurp',`repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${commitSha}&per_page=100`])).flatMap(p=>p.workflow_runs??[])
 const candidates=[]
 for(const run of runs.filter(r=>r.head_sha===commitSha&&r.conclusion==='success'&&['push','workflow_dispatch'].includes(r.event))){
  const dest=`.ci/candidates/${run.id}`;mkdirSync(dest,{recursive:true})
  const output=execute(['gh','run','download',String(run.id),'--repo',repository,'--name',`authoritative-${commitSha}-${run.id}`,'--dir',dest]);if(output.exitCode!==0)continue
  const manifest=json(`${dest}/manifest.json`);assert.equal(manifest.producerRunId,String(run.id),'producer provenance drift');if(date(manifest.expiresAt)>Date.now())candidates.push({runId:run.id,dest,manifest})
 }
 assert.equal(candidates.length,1,'missing or ambiguous authoritative same-SHA evidence')
 const selected=candidates[0],bundle=json(`${selected.dest}/attest-request.json`)
 // GitHub CLI independently verifies signed subject bytes and source identity.
 checked(['gh','attestation','verify',`${selected.dest}/manifest.json`,'--repo',repository,'--signer-workflow',`${repository}/.github/workflows/ci.yml`,'--source-digest',commitSha])
 save('.ci/release-request.json',{manifests:[selected.manifest],tagSha:commitSha,tree,plan:bundle.plan,reports:bundle.reports,baseline:bundle.baseline,baselineApproval:bundle.baselineApproval,build:bundle.build,now:new Date().toISOString()})
 save('.ci/selected-build.json',bundle.build)
}
export function cli(command,request){
 if(command==='inventory')return inventoryFromConfig(request)
 if(command==='plan')return planShards(request)
 if(command==='run')return guardedRequest(request,()=>runShard(request))
 if(command==='fanin')return {...evaluateEvidence({...request,build:undefined}),authoritative:false,type:'test-verification'}
 if(command==='build')return guardedRequest(request,()=>buildArtifact(request),{allowBuildOutputs:true})
 if(command==='attest')return validateEvidence(request)
 if(command==='verify-release')return verifyRelease(request)
 if(command==='promote')return promoteArtifact(request)
 throw Error(`unknown delivery command ${command}`)
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [command,input,output]=process.argv.slice(2)
 try{
  if(command==='prepare')prepare(input)
  else if(command==='gather-evidence')gatherEvidence()
  else if(command==='setup'){const config=tooling(json('.github/greenfield-delivery.json'));guardSource(config,()=>setup(config))}
  else if(command==='affected'){const config=tooling(json('.github/greenfield-delivery.json'));guardSource(config,()=>{setup(config);sha(process.env.BASE_SHA);checked(words(config.affectedArgv).map(arg=>arg==='{base}'?process.env.BASE_SHA:arg))})}
  else if(command==='matrix'){const plan=validatePlan(json(input));console.log(JSON.stringify(plan.shards.map(s=>s.index)))}
  else if(command==='prepare-promotion'){const config=json('.github/greenfield-delivery.json'),request=json('.ci/release-request.json'),ctx=context();assert.equal(ctx.sha,request.tagSha,'release tag moved before promotion');assert.equal(ctx.tree,request.tree);save('.ci/release-verified.json',verifyRelease({...request,now:new Date().toISOString()}));save('.ci/promote-request.json',{verification:json('.ci/release-verified.json'),build:json('.ci/selected-build.json'),config,credentialsAvailable:Boolean(process.env.ACTIONS_ID_TOKEN_REQUEST_URL&&process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)})}
  else{const value=await cli(command,json(input));if(output)save(output,value);else console.log(JSON.stringify(value));if(command==='run'&&value.attempts.some(a=>a.exitCode!==0))process.exitCode=1}
 }catch(error){console.error(`delivery unavailable/failed: ${error.message}`);process.exitCode=1}
}
