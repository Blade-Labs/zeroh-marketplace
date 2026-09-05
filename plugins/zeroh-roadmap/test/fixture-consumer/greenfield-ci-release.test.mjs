import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, chmodSync, copyFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
const ROOT=fileURLToPath(new URL('../../../../',import.meta.url))
const require=createRequire(resolve(ROOT,'package.json'))
const yaml=require('js-yaml')
const workflow=name=>yaml.safeLoad(readFileSync(resolve(ROOT,`plugins/zeroh-greenfield/templates/github/workflows/${name}.yml`),'utf8'))

test('delivery workflows parse with the repository-pinned YAML parser and use immutable least-privilege boundaries',()=>{
  const lock=JSON.parse(readFileSync(resolve(ROOT,'package-lock.json'),'utf8'))
  assert.equal(require('js-yaml/package.json').version,lock.packages['node_modules/js-yaml'].version)
  for(const name of ['ci','release']) {
    const document=workflow(name)
    assert.ok(document.jobs && Object.keys(document.jobs).length>0,'real workflow jobs required')
    assert.notEqual(document.permissions,'write-all')
    for(const [jobName,job] of Object.entries(document.jobs)) {
      assert.notEqual(job.permissions,'write-all',jobName)
      assert.ok(Array.isArray(job.steps) && job.steps.length>0,jobName)
      for(const step of job.steps) {
        if(step.uses) assert.match(step.uses,/@[0-9a-f]{40}$/,'third-party workflow actions must have immutable source pins')
      }
    }
  }
})

const product=()=>import('../../../zeroh-greenfield/templates/scripts/ci-shard-plan.mjs')
const sha='a'.repeat(40),tree='b'.repeat(40),now='2026-09-05T12:00:00.000Z',expiresAt='2026-09-06T12:00:00.000Z'
const digest=content=>createHash('sha256').update(content).digest('hex')
const raw=(path,format,content)=>({path,format,content,sha256:digest(content)})
const inventories={
  web:[{runner:'vitest',canonicalPathOrLeafTask:'test/a.test.ts'},{runner:'playwright',canonicalPathOrLeafTask:'e2e/a.spec.ts'}],
  expo:[{runner:'jest',canonicalPathOrLeafTask:'test/a.test.ts'},{runner:'jest',canonicalPathOrLeafTask:'test/b.test.ts'}],
  flutter:[{runner:'flutter',canonicalPathOrLeafTask:'test/a_test.dart'},{runner:'flutter',canonicalPathOrLeafTask:'test/b_test.dart'}],
  android:[{runner:'gradle',canonicalPathOrLeafTask:':app:testDebugUnitTest'},{runner:'gradle',canonicalPathOrLeafTask:':core:testDebugUnitTest'}],
  'library-cli':[{runner:'node:test',canonicalPathOrLeafTask:'test/a.test.mjs'},{runner:'node:test',canonicalPathOrLeafTask:'test/b.test.mjs'}],
  'nx-monorepo':[{runner:'nx',canonicalPathOrLeafTask:'app:test'},{runner:'nx',canonicalPathOrLeafTask:'core:test'}],
}
async function evidenceFixture() {
  const api=await product(),plan=api.planShards({archetype:'library-cli',inventory:inventories['library-cli'],shardCount:2,commitSha:sha,tree})
  const reports=plan.shards.map(shard=>({schemaVersion:1,shardIndex:shard.index,suiteManifestDigest:plan.suiteManifestDigest,units:shard.units,attempts:[{number:1,outcome:'passed',exitCode:0,rawReports:[
    raw(`report-${shard.index}.xml`,'junit',`<testsuite tests="1" failures="0" errors="0" skipped="0"><testcase classname="suite${shard.index}" name="works"/></testsuite>`),
    raw(`coverage-${shard.index}.info`,'lcov',`TN:\nSF:src/module${shard.index}.mjs\nDA:1,1\nLF:1\nLH:1\nend_of_record\n`),
  ]}]}))
  const build={sha,tree,command:['npm','run','build'],exitCode:0,files:[{path:'dist/app.mjs',contentBase64:Buffer.from('export const value=1\n').toString('base64')}]}
  return {plan,reports,baseline:{minTests:2,minUnits:2,coverageFloor:100},baselineApproval:null,build,commitSha:sha,now,producerRunId:'ci-100',expiresAt,authoritative:true}
}
function releaseInput(f,manifest) {return {manifests:[manifest],tagSha:sha,tree,plan:f.plan,reports:f.reports,baseline:f.baseline,build:f.build,now}}
test('six adapters partition disjoint identities exactly once for one shard and more shards than units',async()=>{
  const api=await product()
  assert.deepEqual(Object.keys(api.ADAPTERS).sort(),Object.keys(inventories).sort())
  for(const [archetype,inventory] of Object.entries(inventories)) for(const shardCount of [1,5]) {
    const adapterConfig=['android','nx-monorepo'].includes(archetype)?{leafTasks:Object.fromEntries(inventory.map(unit=>[unit.canonicalPathOrLeafTask,{aggregate:false,dependencies:[]}]))}:{}
    const plan=api.planShards({archetype,inventory,shardCount,commitSha:sha,tree,adapterConfig})
    assert.ok(plan.shards.length>0 && plan.shards.length<=shardCount,'requested shard count remains valid even above unit count')
    assert.deepEqual(plan.shards.flatMap(s=>s.units).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),[...inventory].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))))
    assert.match(plan.suiteManifestDigest,/^[a-f0-9]{64}$/)
  }
  const input={archetype:'web',inventory:inventories.web,shardCount:1,commitSha:sha,tree}
  for(const inventory of [[inventories.web[0],inventories.web[0]],[{runner:'vitest',canonicalPathOrLeafTask:'../outside'}],[{runner:'unknown',canonicalPathOrLeafTask:'a'}]]) assert.throws(()=>api.planShards({...input,inventory}))
  assert.throws(()=>api.planShards({...input,shardCount:0}))
})
test('authoritative full-suite evidence promotes its one content-addressed build without rebuilding',async()=>{
  const api=await product(),f=await evidenceFixture(),manifest=api.validateEvidence(f)
  assert.equal(manifest.sha,sha)
  assert.equal(manifest.tree,tree)
  assert.equal(manifest.suiteManifestDigest,f.plan.suiteManifestDigest)
  assert.match(manifest.buildDigest,/^[a-f0-9]{64}$/)
  assert.deepEqual(api.verifyRelease(releaseInput(f,manifest)),{artifactDigest:manifest.buildDigest,promoteOnly:true,producerRunId:f.producerRunId,sha,tree,suiteManifestDigest:f.plan.suiteManifestDigest,buildRecordDigest:api.digest(f.build)})
})
test('evidence rejects missing, duplicate, unexpected, malformed, failing or report-count-regressed shard observations',async()=>{
  const api=await product()
  const mutations=[f=>f.reports.pop(),f=>f.reports.push(structuredClone(f.reports[0])),f=>{f.reports[0].units.push({runner:'node:test',canonicalPathOrLeafTask:'unplanned.mjs'})},f=>{f.reports[0].attempts[0].exitCode=1;f.reports[0].attempts[0].outcome='required-test-failed'},f=>{f.reports[0].attempts[0].rawReports[0]=raw('broken.xml','junit','<testsuite>')},f=>{f.reports[0].attempts[0].rawReports[0]=raw('partial.xml','junit','<testsuite tests="2" failures="0"><testcase name="only-one"/></testsuite>')},f=>{f.reports[0].suiteManifestDigest='0'.repeat(64)},f=>{f.reports[0].attempts[0].rawReports[0].sha256='0'.repeat(64)}]
  for(const mutate of mutations) {const f=await evidenceFixture();mutate(f);assert.throws(()=>api.validateEvidence(f))}
})
test('coverage and test count floors are enforced from raw observations, never supplied summaries',async()=>{
  const api=await product()
  for(const mutate of [f=>{f.baseline.minTests=3},f=>{f.baseline.minUnits=3},f=>{f.reports[0].attempts[0].rawReports[1]=raw('coverage.info','lcov','TN:\nSF:src/module0.mjs\nDA:1,0\nLF:1\nLH:0\nend_of_record\n')},f=>{f.reports[0].attempts[0].coverage=[{path:'fake',lines:{1:999}}]},f=>{f.reports[0].attempts[0].rawReports.pop()}]) {
    const f=await evidenceFixture();mutate(f);assert.throws(()=>api.validateEvidence(f))
  }
})
test('required-test failure remains red when a later retry passes',async()=>{
  const api=await product(),f=await evidenceFixture()
  const failure=structuredClone(f.reports[0].attempts[0]);failure.outcome='required-test-failed';failure.exitCode=1
  f.reports[0].attempts=[failure,{...structuredClone(f.reports[0].attempts[0]),number:2}]
  assert.throws(()=>api.validateEvidence(f))
})
test('release rejects stale SHA, expiry, ambiguous producers and changed inventory/report/build links',async()=>{
  const api=await product()
  const mutations=[r=>{r.tagSha='c'.repeat(40)},r=>{r.tree='d'.repeat(40)},r=>{r.now='2026-09-07T12:00:00.000Z'},r=>{r.manifests.push({...structuredClone(r.manifests[0]),producerRunId:'ci-other'})},r=>{r.plan.inventory.pop()},r=>{r.reports.pop()},r=>{r.build.files[0].contentBase64=Buffer.from('different').toString('base64')},r=>{r.manifests[0].buildDigest='0'.repeat(64)},r=>{r.manifests[0].coverageDigest='0'.repeat(64)},r=>{r.manifests[0].authoritative=false}]
  for(const mutate of mutations) {const f=await evidenceFixture(),r=releaseInput(f,api.validateEvidence(f));mutate(r);assert.throws(()=>api.verifyRelease(r))}
})

test('Nx and Gradle shard only nonoverlapping leaf tasks and reject aggregate/dependency double counting',async()=>{
  const api=await product()
  for(const archetype of ['nx-monorepo','android']) {
    const inventory=inventories[archetype],base={archetype,inventory,shardCount:2,commitSha:sha,tree}
    assert.throws(()=>api.planShards(base),'leaf declarations are required')
    for(const mutate of [tasks=>{tasks[inventory[0].canonicalPathOrLeafTask].aggregate=true},tasks=>{tasks[inventory[0].canonicalPathOrLeafTask].dependencies=[inventory[1].canonicalPathOrLeafTask]}]) {
      const leafTasks=Object.fromEntries(inventory.map(unit=>[unit.canonicalPathOrLeafTask,{aggregate:false,dependencies:[]}]))
      mutate(leafTasks);assert.throws(()=>api.planShards({...base,adapterConfig:{leafTasks}}))
    }
  }
})
test('only bounded infrastructure failures can retry; quarantine remains blocking and needs accountable metadata',async()=>{
  const api=await product()
  const retryFixture=async()=>{
    const f=await evidenceFixture()
    f.plan=api.planShards({archetype:'library-cli',inventory:inventories['library-cli'],shardCount:2,commitSha:sha,tree,adapterConfig:{maxInfraRetries:1}})
    for(const report of f.reports) report.suiteManifestDigest=f.plan.suiteManifestDigest
    const pass=f.reports[0].attempts[0]
    f.reports[0].attempts=[{number:1,outcome:'infra-failed',exitCode:75,infrastructure:{code:'RUNNER_UNAVAILABLE',reason:'fixture runner did not start'},rawReports:[]},{...pass,number:2}]
    return f
  }
  const allowed=await retryFixture();assert.doesNotThrow(()=>api.validateEvidence(allowed))
  const excess=await retryFixture();excess.reports[0].attempts.splice(1,0,{number:2,outcome:'infra-failed',exitCode:75,infrastructure:{code:'RUNNER_UNAVAILABLE',reason:'fixture runner did not start'},rawReports:[]});excess.reports[0].attempts[2].number=3
  assert.throws(()=>api.validateEvidence(excess))
  for(const maxInfraRetries of [-1,3,1.5]) assert.throws(()=>api.planShards({archetype:'library-cli',inventory:inventories['library-cli'],shardCount:1,commitSha:sha,tree,adapterConfig:{maxInfraRetries}}))
  for(const quarantine of [undefined,{}, {owner:'team',reason:'ticket-42',expiresAt:'2026-09-01T00:00:00.000Z'}, {owner:'team',reason:'ticket-42',expiresAt}]) {
    const f=await evidenceFixture();f.reports[0].attempts[0].outcome='quarantined';f.reports[0].attempts[0].quarantine=quarantine
    assert.throws(()=>api.validateEvidence(f),'quarantine cannot silently restore authoritative green')
  }
})
test('baseline changes require an approval bound to both old and proposed baseline digests',async()=>{
  const api=await product(),previous={minTests:3,minUnits:2,coverageFloor:100}
  const fixture=async()=>{
    const f=await evidenceFixture()
    f.plan=api.planShards({archetype:'library-cli',inventory:inventories['library-cli'],shardCount:2,commitSha:sha,tree,adapterConfig:{baseline:previous}})
    for(const report of f.reports) report.suiteManifestDigest=f.plan.suiteManifestDigest
    return f
  }
  const unapproved=await fixture();assert.throws(()=>api.validateEvidence(unapproved))
  const approved=await fixture()
  approved.baselineApproval={previous,approvedDigest:api.digest(approved.baseline),previousDigest:api.digest(previous),owner:'release-owner',reason:'approved fixture test retirement'}
  assert.doesNotThrow(()=>api.validateEvidence(approved))
  for(const field of ['approvedDigest','previousDigest','owner','reason']) {
    const invalid=structuredClone(approved);invalid.baselineApproval[field]=''
    assert.throws(()=>api.validateEvidence(invalid))
  }
})
test('build authority cannot be claimed for a different tree, failed build, duplicate path or unsafe artifact name',async()=>{
  const api=await product()
  for(const mutate of [f=>{f.build.sha='c'.repeat(40)},f=>{f.build.tree='c'.repeat(40)},f=>{f.build.exitCode=1},f=>{f.build.files=[]},f=>{f.build.files.push({...f.build.files[0]})},f=>{f.build.files[0].path='../escape'},f=>{f.build.files[0].contentBase64='not base64!'},f=>{f.authoritative=false},f=>{f.expiresAt='2026-09-01T00:00:00.000Z'}]) {
    const f=await evidenceFixture();mutate(f);assert.throws(()=>api.validateEvidence(f))
  }
})
test('raw parser failures cannot be hidden by a passed envelope or fabricated normalized cases',async()=>{
  const api=await product()
  const reports=[
    '<testsuite tests="1" failures="1" errors="0" skipped="0"><testcase classname="suite" name="fails"><failure message="assertion">failed</failure></testcase></testsuite>',
    '<testsuite tests="2" failures="0" errors="0" skipped="0"><testcase classname="suite" name="same"/><testcase classname="suite" name="same"/></testsuite>',
    '<!DOCTYPE testsuite [<!ENTITY x SYSTEM "file:///etc/passwd">]><testsuite tests="1"><testcase name="&x;"/></testsuite>',
    '<testsuite tests="1" failures="0" errors="0" skipped="1"><testcase classname="suite" name="skipped"><skipped/></testcase></testsuite>',
  ]
  for(const content of reports) {
    const f=await evidenceFixture();f.reports[0].attempts[0].rawReports[0]=raw('report.xml','junit',content)
    f.reports[0].attempts[0].cases=[{id:'fabricated',status:'passed'}]
    assert.throws(()=>api.validateEvidence(f))
  }
})

test('explicit raw adapters parse Flutter machine completion, JUnit cases, LCOV and JaCoCo line evidence',async()=>{
  const api=await product()
  const flutter=[{type:'testStart',test:{id:1,name:'widget behaves',hidden:false}},{type:'testDone',testID:1,result:'success',skipped:false},{type:'done',success:true}].map(r=>JSON.stringify(r)).join('\n')
  assert.deepEqual(api.parseReport('flutter-machine',flutter),{cases:[{id:'1:widget behaves',status:'passed'}],coverage:[]})
  assert.deepEqual(api.parseReport('junit','<testsuite tests="1"><testcase classname="suite" name="works"/></testsuite>'),{cases:[{id:'suite:works',status:'passed'}],coverage:[]})
  const lcov='TN:\nSF:src/a.ts\nDA:1,2\nDA:2,0\nLF:2\nLH:1\nend_of_record\n'
  assert.deepEqual(api.parseReport('lcov',lcov),{cases:[],coverage:[{path:'src/a.ts',lines:{1:2,2:0}}]})
  const jacoco='<report name="coverage"><package name="app"><sourcefile name="App.kt"><line nr="1" mi="0" ci="3" mb="0" cb="0"/><line nr="2" mi="2" ci="0" mb="1" cb="0"/></sourcefile></package></report>'
  assert.deepEqual(api.parseReport('jacoco',jacoco),{cases:[],coverage:[{path:'app/App.kt',lines:{1:3,2:0}}]})
  for(const [format,content] of [['flutter-machine',flutter.split('\n').slice(0,-1).join('\n')],['flutter-machine',flutter.replace('"testID":1','"testID":2')],['lcov',lcov.replace('end_of_record','')],['lcov',lcov.replace('DA:2,0','DA:1,0')],['jacoco',jacoco.replace('nr="2"','nr="1"')],['jacoco',jacoco.replace('ci="3"','ci="-1"')],['unknown',jacoco]]) assert.throws(()=>api.parseReport(format,content))
})
test('raw report completeness rejects contradictory summaries and duplicate machine/source identities',async()=>{
  const api=await product()
  const malformed=[
    ['junit','<testsuite tests="1" failures="1" errors="0" skipped="0"><testcase classname="suite" name="claimed-pass"/></testsuite>'],
    ['lcov','TN:\nSF:src/a.ts\nDA:1,1\nLF:20\nLH:20\nend_of_record\n'],
    ['flutter-machine',[{type:'testStart',test:{id:1,name:'first'}},{type:'testStart',test:{id:1,name:'overwritten'}},{type:'testDone',testID:1,result:'success'},{type:'done',success:true}].map(r=>JSON.stringify(r)).join('\n')],
    ['jacoco','<report><package name="app"><sourcefile name="App.kt"><line nr="1" ci="1"/></sourcefile><sourcefile name="App.kt"><line nr="1" ci="1"/></sourcefile></package></report>'],
  ]
  for(const [format,content] of malformed) assert.throws(()=>api.parseReport(format,content),`partial or duplicated ${format} evidence must not pass`)
})

function workflowSandbox() {
  const root=mkdtempSync(join(tmpdir(),'greenfield-workflow-'))
  mkdirSync(join(root,'scripts'))
  copyFileSync(resolve(ROOT,'plugins/zeroh-greenfield/templates/scripts/ci-shard-plan.mjs'),join(root,'scripts/ci-shard-plan.mjs'))
  let counter=0
  return {root,close:()=>rmSync(root,{recursive:true,force:true}),step(name,id,request) {
    const found=Object.values(workflow(name).jobs).flatMap(job=>job.steps).filter(step=>step.id===id)
    assert.equal(found.length,1,`workflow must expose exactly one actual ${id} run boundary`)
    assert.equal(typeof found[0].run,'string')
    const input=join(root,`request-${counter}.json`),output=join(root,`output-${counter++}.json`)
    writeFileSync(input,JSON.stringify(request))
    const result=spawnSync('/bin/bash',['--noprofile','--norc','-euo','pipefail','-c',found[0].run],{cwd:root,env:{...process.env,BASH_ENV:'',REQUEST:input,OUTPUT:output},encoding:'utf8'})
    return {...result,value:existsSync(output)?JSON.parse(readFileSync(output,'utf8')):undefined}
  }}
}
test('actual workflow plan, attest and release-verification snippets validate evidence and fail on link tampering',async()=>{
  const f=await evidenceFixture(),box=workflowSandbox()
  try {
    const planned=box.step('ci','plan',{archetype:'library-cli',inventory:inventories['library-cli'],shardCount:2,commitSha:sha,tree})
    assert.equal(planned.status,0,planned.stderr);assert.deepEqual(planned.value,f.plan)
    const fanin=box.step('ci','fanin',{...f,build:undefined});assert.equal(fanin.status,0,fanin.stderr)
    assert.equal(Object.hasOwn(fanin.value,'buildDigest'),false,'fan-in without build cannot claim built artifact bytes')
    assert.notEqual(fanin.value.authoritative,true,'fan-in is not an authoritative manifest before build and attestation')
    const failed=structuredClone(f);failed.reports.pop()
    assert.notEqual(box.step('ci','fanin',failed).status,0,'missing shard blocks build-stage predecessor')
    const attested=box.step('ci','attest',f);assert.equal(attested.status,0,attested.stderr)
    const valid=releaseInput(f,attested.value)
    const verified=box.step('release','verify-release',valid);assert.equal(verified.status,0,verified.stderr)
    assert.equal(verified.value.artifactDigest,attested.value.buildDigest)
    for(const mutate of [r=>{r.tagSha='c'.repeat(40)},r=>{r.reports.pop()},r=>{r.build.files[0].contentBase64=Buffer.from('different bytes').toString('base64')}]) {
      const changed=structuredClone(valid);mutate(changed)
      const red=box.step('release','verify-release',changed);assert.notEqual(red.status,0);assert.equal(red.value,undefined)
    }
  } finally {box.close()}
})
test('actual workflow run snippet executes each selected identity as literal argv and cannot reuse old reports',async()=>{
  const api=await product(),box=workflowSandbox()
  try {
    writeFileSync(join(box.root,'runner.mjs'),`import {appendFileSync,writeFileSync} from 'node:fs';const [unit,junit,coverage]=process.argv.slice(2);appendFileSync('executions.jsonl',JSON.stringify(process.argv.slice(2))+'\\n');writeFileSync(junit,'<testsuite tests="1"><testcase classname="fixture" name="works"/></testsuite>');writeFileSync(coverage,'TN:\\nSF:src/a.mjs\\nDA:1,1\\nLF:1\\nLH:1\\nend_of_record\\n');`)
    const config={schemaVersion:1,archetype:'library-cli',runners:{'node:test':{shardArgv:[process.execPath,'runner.mjs','{unit}','{junit}','{coverage}'],rawReports:[{path:'{junit}',format:'junit'},{path:'{coverage}',format:'lcov'}]}},build:{argv:[process.execPath,'build.mjs'],outputs:['dist']}}
    const plan=api.planShards({archetype:'library-cli',inventory:inventories['library-cli'],shardCount:2,commitSha:sha,tree,adapterConfig:{executionContract:{runners:config.runners,build:config.build}}})
    for(const mutate of [c=>{c.runners['node:test'].shardArgv.push('--extra')},c=>{c.runners['node:test'].rawReports.pop()},c=>{c.build.argv=['npm','run','other-build']}]) {
      const changed=structuredClone(config);mutate(changed)
      assert.notEqual(box.step('ci','run',{plan,index:0,config:changed}).status,0,'runtime contract drift must stop before execution')
      assert.equal(existsSync(join(box.root,'executions.jsonl')),false)
    }
    const results=plan.shards.map(shard=>box.step('ci','run',{plan,index:shard.index,config}))
    for(const result of results)assert.equal(result.status,0,result.stderr)
    const executed=readFileSync(join(box.root,'executions.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line)[0])
    assert.deepEqual(executed.sort(),inventories['library-cli'].map(u=>u.canonicalPathOrLeafTask).sort())
    assert.equal(box.step('ci','run',{plan,index:0,config}).status,1,'previous raw files cannot mask missing fresh output')
    const f=await evidenceFixture();f.plan=plan;f.reports=results.map(r=>r.value)
    assert.doesNotThrow(()=>api.validateEvidence(f))
  } finally {box.close()}
})
test('actual workflow builds once; allowlisted AWS promotion verifies immutable provider readback without rebuild',async(t)=>{
  const api=await product(),f=await evidenceFixture(),box=workflowSandbox(),originalCwd=process.cwd()
  const names=['PATH','ACTIONS_ID_TOKEN_REQUEST_URL','ACTIONS_ID_TOKEN_REQUEST_TOKEN','AWS_FIXTURE_MODE'],before=Object.fromEntries(names.map(name=>[name,process.env[name]]))
  try {
    writeFileSync(join(box.root,'build.mjs'),`import {appendFileSync,mkdirSync,writeFileSync} from 'node:fs';appendFileSync('build.log','build\\n');mkdirSync('dist',{recursive:true});writeFileSync('dist/app.mjs','approved bytes');`)
    const config={schemaVersion:1,archetype:'library-cli',runners:{},build:{argv:[process.execPath,'build.mjs'],outputs:['dist']},release:{provider:'aws-s3-v1',environment:'fixture-release',bucket:'fixture-approved-bucket',region:'eu-west-1',keyPrefix:'releases',roleArn:'arn:aws:iam::123456789012:role/Fixture'}}
    const plan=api.planShards({archetype:'library-cli',inventory:inventories['library-cli'],shardCount:2,commitSha:sha,tree,adapterConfig:{executionContract:{runners:config.runners,build:config.build}}})
    const drift=structuredClone(config);drift.build.argv=[process.execPath,'unapproved.mjs']
    assert.notEqual(box.step('ci','build',{config:drift,plan,sha,tree}).status,0)
    assert.equal(existsSync(join(box.root,'build.log')),false)
    const built=box.step('ci','build',{config,plan,sha,tree});assert.equal(built.status,0,built.stderr)
    f.plan=plan;for(const report of f.reports)report.suiteManifestDigest=plan.suiteManifestDigest
    f.build=built.value
    const manifest=api.validateEvidence(f),verification=api.verifyRelease(releaseInput(f,manifest))
    assert.notEqual(box.step('release','promote',{verification,build:built.value,config,credentialsAvailable:false}).status,0)
    mkdirSync(join(box.root,'bin'))
    const awsScript=`#!/usr/bin/env node
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const args=process.argv.slice(2),value=flag=>args[args.indexOf(flag)+1],mode=process.env.AWS_FIXTURE_MODE;
appendFileSync('aws-calls.jsonl',JSON.stringify(args)+'\\n');
if(args[0]==='sts')console.log(JSON.stringify({Credentials:{AccessKeyId:'fixture-key',SecretAccessKey:'fixture-secret',SessionToken:'fixture-session'}}));
else if(args[1]==='put-object'){const record={VersionId:'version1',ChecksumSHA256:value('--checksum-sha256'),ContentLength:readFileSync(value('--body')).length};writeFileSync('provider-object.json',JSON.stringify(record));if(mode==='empty-upload')console.log('{}');else console.log(JSON.stringify({...record,VersionId:mode==='unversioned'?'null':record.VersionId}));}
else if(args[1]==='head-object'){const record=JSON.parse(readFileSync('provider-object.json'));if(mode==='checksum')record.ChecksumSHA256='wrong';if(mode==='size')record.ContentLength++;if(mode==='version')record.VersionId='different';console.log(JSON.stringify(record));}
else process.exit(9);
`
    writeFileSync(join(box.root,'bin/aws'),awsScript);chmodSync(join(box.root,'bin/aws'),0o755)
    process.chdir(box.root);process.env.PATH=join(box.root,'bin')+':'+before.PATH
    process.env.ACTIONS_ID_TOKEN_REQUEST_URL='https://fixture.invalid/oidc';process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN='fixture-only-token'
    t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(new URL(url).searchParams.get('audience'),'sts.amazonaws.com');assert.equal(options.headers.Authorization,'Bearer fixture-only-token');return {ok:true,json:async()=>({value:'fixture-oidc'})}})
    const promoted=await api.promoteArtifact({verification,build:built.value,config,credentialsAvailable:true})
    assert.equal(promoted.artifactDigest,manifest.buildDigest);assert.equal(promoted.versionId,'version1')
    assert.equal(readFileSync('build.log','utf8'),'build\n','provider promotion cannot invoke build')
    const calls=readFileSync('aws-calls.jsonl','utf8').trim().split('\n').map(line=>JSON.parse(line))
    assert.deepEqual(calls.map(args=>args.slice(0,2)),[['sts','assume-role-with-web-identity'],['s3api','put-object'],['s3api','head-object']])
    for(const mode of ['checksum','size','version','unversioned','empty-upload']) {
      rmSync('.ci/promote',{recursive:true,force:true});process.env.AWS_FIXTURE_MODE=mode
      await assert.rejects(()=>api.promoteArtifact({verification,build:built.value,config,credentialsAvailable:true}))
    }
    for(const release of [{...config.release,promoteArgv:['node','build.mjs','{artifact}']},{...config.release,provider:'shell'},{}]) {
      await assert.rejects(()=>api.promoteArtifact({verification,build:built.value,config:{...config,release},credentialsAvailable:true}))
    }
    assert.equal(readFileSync('build.log','utf8'),'build\n')
  } finally {
    process.chdir(originalCwd)
    for(const name of names)if(before[name]===undefined)delete process.env[name];else process.env[name]=before[name]
    box.close()
  }
})
test('all six selected adapter contracts execute their exact inventory argv and retain runner-specific raw reports',async()=>{
  const api=await product()
  for(const [archetype,inventory] of Object.entries(inventories)) {
    const box=workflowSandbox()
    try {
      const junit='<testsuite tests="1"><testcase classname="fixture" name="works"/></testsuite>'
      const flutter=[{type:'testStart',test:{id:1,name:'works'}},{type:'testDone',testID:1,result:'success'},{type:'done',success:true}].map(r=>JSON.stringify(r)).join('\n')
      const jacoco='<report><package name="app"><sourcefile name="App.kt"><line nr="1" ci="1"/></sourcefile></package></report>'
      const lcov='TN:\nSF:src/a.ts\nDA:1,1\nLF:1\nLH:1\nend_of_record\n'
      const payload={report:archetype==='flutter'?flutter:junit,coverage:archetype==='android'?jacoco:lcov}
      writeFileSync(join(box.root,'payload.json'),JSON.stringify(payload))
      writeFileSync(join(box.root,'fixture-runner.mjs'),`import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';const [runner,unit,report,coverage]=process.argv.slice(2),data=JSON.parse(readFileSync('payload.json'));appendFileSync('argv.jsonl',JSON.stringify({runner,canonicalPathOrLeafTask:unit})+'\n');writeFileSync(report,data.report);writeFileSync(coverage,data.coverage);`.replace("+'\n'","+'\\n'"))
      const runners=Object.fromEntries([...new Set(inventory.map(unit=>unit.runner))].map(runner=>[runner,{shardArgv:[process.execPath,'fixture-runner.mjs',runner,'{unit}','{junit}','{coverage}'],rawReports:[{path:'{junit}',format:archetype==='flutter'?'flutter-machine':'junit'},{path:'{coverage}',format:archetype==='android'?'jacoco':'lcov'}]}]))
      writeFileSync(join(box.root,'fixture-select.mjs'),`process.stdout.write(process.argv[2]+'\\n');`)
      for(const runner of ['vitest','playwright']) if(runners[runner])Object.assign(runners[runner],{selectionArgv:[process.execPath,'fixture-select.mjs','{unit}'],selectionFormat:'lines'})
      const adapterConfig=['android','nx-monorepo'].includes(archetype)?{leafTasks:Object.fromEntries(inventory.map(unit=>[unit.canonicalPathOrLeafTask,{aggregate:false,dependencies:[]}]))}:{}
      const config={schemaVersion:1,archetype,runners,adapterConfig,build:{argv:[process.execPath,'fixture-build.mjs'],outputs:['dist']}}
      const plan=api.planShards({archetype,inventory,shardCount:5,commitSha:sha,tree,adapterConfig:{...adapterConfig,executionContract:{runners,build:config.build}}})
      const reports=[]
      for(const shard of plan.shards) {
        const result=box.step('ci','run',{plan,index:shard.index,config});assert.equal(result.status,0,`${archetype}: ${result.stderr}`);reports.push(result.value)
      }
      const observed=readFileSync(join(box.root,'argv.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line))
      assert.deepEqual(observed.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),[...inventory].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))))
      const f=await evidenceFixture();Object.assign(f,{plan,reports})
      assert.doesNotThrow(()=>api.validateEvidence(f),archetype)
    } finally {box.close()}
  }
})

test('workflow privilege separation prevents test/build jobs from publishing and orders fan-in before build',()=>{
  const ci=workflow('ci'),release=workflow('release')
  assert.deepEqual(ci.permissions,{})
  assert.deepEqual(release.permissions,{})
  for(const name of ['affected','plan','shard','fanin']) assert.deepEqual(ci.jobs[name].permissions,{contents:'read'})
  assert.deepEqual(ci.jobs.attest.permissions,{contents:'read',actions:'read','id-token':'write',attestations:'write'})
  assert.deepEqual(release.jobs.verify.permissions,{contents:'read',actions:'read',attestations:'read'})
  assert.deepEqual(release.jobs.deploy.permissions,{contents:'read','id-token':'write'})
  assert.equal(release.jobs.deploy.needs,'verify')
  assert.ok(release.jobs.deploy.environment)
  const steps=ci.jobs.fanin.steps,fanin=steps.findIndex(s=>s.id==='fanin'),build=steps.findIndex(s=>s.id==='build')
  assert.ok(fanin>=0 && build>fanin)
  assert.notEqual(steps[fanin]['continue-on-error'],true)
  assert.notEqual(steps[build].if,'always()')
})
test('actual inventory adapter executes configured argv and fails closed with remedy when tooling is absent',async()=>{
  const api=await product(),box=workflowSandbox(),previous=process.cwd()
  try {
    writeFileSync(join(box.root,'inventory.mjs'),`process.stdout.write(process.argv[2]);`)
    process.chdir(box.root)
    for(const [archetype,inventory] of Object.entries(inventories)) {
      const runners=Object.fromEntries(api.ADAPTERS[archetype].runners.map(runner=>[runner,{inventoryArgv:[process.execPath,'inventory.mjs',JSON.stringify(inventory.filter(u=>u.runner===runner).map(u=>u.canonicalPathOrLeafTask))],inventoryFormat:'json-paths'}]))
      assert.deepEqual(api.inventoryFromConfig({schemaVersion:1,archetype,runners}),inventory)
    }
    assert.throws(()=>api.inventoryFromConfig({schemaVersion:1,archetype:'library-cli',runners:{'node:test':{inventoryArgv:['/nonexistent/fixture-runner'],inventoryFormat:'lines'}}}),/unavailable.*install/i)
  } finally {process.chdir(previous);box.close()}
})

test('file-filter adapters prove selected inventory before execution and reject overmatching runner selection',async()=>{
  const api=await product()
  for(const runner of ['vitest','playwright']) {
    const box=workflowSandbox()
    try {
      writeFileSync(join(box.root,'selection.json'),JSON.stringify(['test/other.test.ts']))
      writeFileSync(join(box.root,'select.mjs'),`import {readFileSync} from 'node:fs';process.stdout.write([process.argv[2],...JSON.parse(readFileSync('selection.json'))].join('\\n'));`)
      writeFileSync(join(box.root,'test.mjs'),`import {writeFileSync} from 'node:fs';writeFileSync('unapproved-test-ran','yes');`)
      const inventory=[{runner,canonicalPathOrLeafTask:'test/a.test.ts'}]
      const runners={[runner]:{selectionArgv:[process.execPath,'select.mjs','{unit}'],selectionFormat:'lines',shardArgv:[process.execPath,'test.mjs','{unit}'],rawReports:[{path:'{junit}',format:'junit'},{path:'{coverage}',format:'lcov'}]}}
      const config={schemaVersion:1,archetype:'web',runners,build:{argv:['npm','run','build'],outputs:['dist']}}
      const plan=api.planShards({archetype:'web',inventory,shardCount:1,commitSha:sha,tree,adapterConfig:{executionContract:{runners,build:config.build}}})
      const result=box.step('ci','run',{plan,index:0,config})
      assert.notEqual(result.status,0)
      assert.equal(existsSync(join(box.root,'unapproved-test-ran')),false,'a broad selector must stop before tests execute')
    } finally {box.close()}
  }
})
test('failed runner with absent reports stays red while actual stdout and stderr diagnostics survive',async()=>{
  const api=await product(),box=workflowSandbox()
  try {
    writeFileSync(join(box.root,'fail.mjs'),`console.log('fixture first failure');console.error('fixture diagnostic');process.exit(7);`)
    const runners={'node:test':{shardArgv:[process.execPath,'fail.mjs','{unit}'],rawReports:[{path:'{junit}',format:'junit'},{path:'{coverage}',format:'lcov'}]}}
    const config={schemaVersion:1,archetype:'library-cli',runners,build:{argv:['npm','run','build'],outputs:['dist']}}
    const plan=api.planShards({archetype:'library-cli',inventory:[inventories['library-cli'][0]],shardCount:1,commitSha:sha,tree,adapterConfig:{executionContract:{runners,build:config.build}}})
    const result=box.step('ci','run',{plan,index:0,config})
    assert.notEqual(result.status,0)
    assert.equal(result.value,undefined,'failed runner cannot mint a successful report')
    assert.match(readFileSync(join(box.root,'.ci/raw/0/0/stdout.log'),'utf8'),/fixture first failure/)
    assert.match(readFileSync(join(box.root,'.ci/raw/0/0/stderr.log'),'utf8'),/fixture diagnostic/)
  } finally {box.close()}
})
async function gitSourceFixture(operation,mutation) {
  const api=await product(),box=workflowSandbox()
  mkdirSync(join(box.root,'src'));mkdirSync(join(box.root,'.github'))
  writeFileSync(join(box.root,'src/tracked.mjs'),'export const original=true\n')
  writeFileSync(join(box.root,'.gitignore'),'.ci/\nnode_modules/\n.npm-cache/\ndist/\n')
  const mutations={tracked:"writeFileSync('src/tracked.mjs','changed source')",untracked:"writeFileSync('src/unapproved.mjs','new source')",allowed:"mkdirSync('.npm-cache',{recursive:true});writeFileSync('.npm-cache/state','cache')",output:"mkdirSync('dist',{recursive:true});writeFileSync('dist/app.mjs','new build')"}
  const action=mutations[mutation]
  writeFileSync(join(box.root,'source-operation.mjs'),`import {writeFileSync,mkdirSync} from 'node:fs';${action};const [kind,unit,junit,coverage]=process.argv.slice(2);if(kind==='run'){writeFileSync(junit,'<testsuite tests="1"><testcase name="passes"/></testsuite>');writeFileSync(coverage,'TN:\nSF:src/tracked.mjs\nDA:1,1\nLF:1\nLH:1\nend_of_record\n');}if(kind==='build'){mkdirSync('dist',{recursive:true});writeFileSync('dist/app.mjs','built once');}`.replace(/'TN:[\s\S]*?end_of_record\n'/,JSON.stringify('TN:\nSF:src/tracked.mjs\nDA:1,1\nLF:1\nLH:1\nend_of_record\n')))
  const config={schemaVersion:1,archetype:'library-cli',operationalRoots:['.ci','node_modules','.npm-cache'],setupArgv:[[process.execPath,'source-operation.mjs','setup']],runners:{'node:test':{shardArgv:[process.execPath,'source-operation.mjs','run','{unit}','{junit}','{coverage}'],rawReports:[{path:'{junit}',format:'junit'},{path:'{coverage}',format:'lcov'}]}},build:{argv:[process.execPath,'source-operation.mjs','build'],outputs:['dist']}}
  writeFileSync(join(box.root,'.github/greenfield-delivery.json'),JSON.stringify(config))
  const git=(...argv)=>{const result=spawnSync('git',argv,{cwd:box.root,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.trim()}
  git('init','--quiet');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','source fixture')
  const commitSha=git('rev-parse','HEAD'),sourceTree=git('rev-parse','HEAD^{tree}')
  const plan=api.planShards({archetype:'library-cli',inventory:[inventories['library-cli'][0]],shardCount:1,commitSha,tree:sourceTree,adapterConfig:{operationalRoots:config.operationalRoots,executionContract:{runners:config.runners,build:config.build}}})
  return {...box,config,plan,invoke(changed=config){
    if(operation==='setup')return spawnSync(process.execPath,['scripts/ci-shard-plan.mjs','setup'],{cwd:box.root,encoding:'utf8'})
    return box.step('ci',operation,{plan,config:changed,index:0,sha:commitSha,tree:sourceTree,verifySource:true})
  }}
}
test('actual Git source guard rejects tracked and new source writes during setup, run and build',async()=>{
  for(const operation of ['setup','run','build'])for(const mutation of ['tracked','untracked']) {
    const fixture=await gitSourceFixture(operation,mutation)
    try {
      const result=fixture.invoke()
      assert.notEqual(result.status,0,`${operation} accepted ${mutation} source mutation`)
      assert.match(result.stderr,/source|tracked|untracked|worktree/i)
    } finally {fixture.close()}
  }
})
test('source guard allows approved cache writes and build outputs only in the build stage',async()=>{
  for(const operation of ['setup','run','build']) {
    const fixture=await gitSourceFixture(operation,'allowed')
    try {const result=fixture.invoke();assert.equal(result.status,0,result.stderr)} finally {fixture.close()}
  }
  const build=await gitSourceFixture('build','output')
  try {const result=build.invoke();assert.equal(result.status,0,result.stderr);assert.equal(readFileSync(join(build.root,'dist/app.mjs'),'utf8'),'built once')} finally {build.close()}
  const run=await gitSourceFixture('run','output')
  try {assert.notEqual(run.invoke().status,0,'test stage cannot smuggle build outputs into cache exceptions')} finally {run.close()}
})
test('runtime may not broaden prebound operational roots to authorize source writes',async()=>{
  const fixture=await gitSourceFixture('run','tracked')
  try {
    const config=structuredClone(fixture.config);config.operationalRoots.push('src')
    assert.notEqual(fixture.invoke(config).status,0)
    assert.equal(readFileSync(join(fixture.root,'src/tracked.mjs'),'utf8'),'export const original=true\n','root drift must stop before runner invocation')
  } finally {fixture.close()}
})
test('release verification binds the complete build record and source identity even for unchanged artifact bytes',async()=>{
  const api=await product(),f=await evidenceFixture(),manifest=api.validateEvidence(f)
  const verified=api.verifyRelease(releaseInput(f,manifest))
  assert.equal(verified.sha,sha)
  assert.equal(verified.tree,tree)
  assert.equal(verified.suiteManifestDigest,f.plan.suiteManifestDigest)
  assert.equal(verified.buildRecordDigest,api.digest(f.build))
  const config={release:{provider:'aws-s3-v1',environment:'fixture',bucket:'fixture-bucket',region:'eu-west-1',keyPrefix:'releases',roleArn:'arn:aws:iam::123456789012:role/Fixture'}}
  for(const mutate of [b=>{b.sha='c'.repeat(40)},b=>{b.tree='c'.repeat(40)},b=>{b.command=['npm','run','other-build']}]) {
    const changed=structuredClone(f.build);mutate(changed)
    await assert.rejects(()=>api.promoteArtifact({verification:verified,build:changed,config,credentialsAvailable:false}),error=>!error.message.includes('credentials unavailable'),'swapped build must fail before credential boundary')
  }
})
test('standard JaCoCo declaration parses locally while unknown or entity-bearing doctypes remain rejected',async(t)=>{
  const api=await product()
  const network=t.mock.method(globalThis,'fetch',()=>{throw Error('report parser must never fetch DTDs')})
  const report='<report><package name="app"><sourcefile name="App.kt"><line nr="1" ci="1"/></sourcefile></package></report>'
  const standard='<!DOCTYPE report PUBLIC "-//JACOCO//DTD Report 1.1//EN" "report.dtd">'
  assert.deepEqual(api.parseReport('jacoco',standard+report),{cases:[],coverage:[{path:'app/App.kt',lines:{1:1}}]})
  for(const declaration of ['<!DOCTYPE report SYSTEM "https://example.invalid/report.dtd">','<!DOCTYPE report [<!ENTITY external SYSTEM "file:///etc/passwd">]>','<!DOCTYPE report PUBLIC "-//UNKNOWN//DTD Report//EN" "report.dtd">']) assert.throws(()=>api.parseReport('jacoco',declaration+report))
  assert.equal(network.mock.callCount(),0)
})
