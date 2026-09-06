/** Retain native sessions and derive receipts; never synthesize native evidence. */
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateOptionalGateBindings, optionalGateCommand, validateDeliveryEvidence, DELIVERY_PATHS, ACTIONLINT_PROBE, unwrapGateExecution, matchesGateCommand, ROOT, STAGE_FILES, REQUIRED_HOMES, rows, canonical, sha256, treeHash, nativeObjects, proposalPaths, readStage, validateObservedArm, validateSourceBinding } from './greenfield-native-evidence.mjs'
const read = (path) => JSON.parse(readFileSync(path, 'utf8'))
const save = (path, data) => { mkdirSync(dirname(path), {recursive:true}); writeFileSync(path, JSON.stringify(data, null, 2) + '\n') }
const ref = (path) => ({path:relative(ROOT,path),sha256:sha256(readFileSync(path))})
function files(root) { return readdirSync(root,{withFileTypes:true}).flatMap(e => e.isDirectory() ? files(resolve(root,e.name)) : [resolve(root,e.name)]) }
export function capture(host, directory) {
  directory=resolve(directory)
  const raw=readFileSync(resolve(directory,'stdout.jsonl'),'utf8')
  const id=host==='claude' ? rows(raw).find(r=>r.subtype==='init')?.session_id : rows(raw).find(r=>r.type==='thread.started')?.thread_id
  assert.ok(id,'native session id missing')
  const base=host==='claude' ? resolve(homedir(),'.claude-a/projects') : resolve(homedir(),'.codex/sessions')
  const matches=files(base).filter(p=>host==='claude' ? basename(p)===`${id}.jsonl` : basename(p).endsWith(`-${id}.jsonl`))
  assert.equal(matches.length,1,'exactly one native session file required')
  copyFileSync(matches[0],resolve(directory,'session.jsonl'))
  const reference={directory:relative(ROOT,directory),sha256:Object.fromEntries(STAGE_FILES.map(n=>[n,sha256(readFileSync(resolve(directory,n)))])),session:ref(resolve(directory,'session.jsonl'))}
  const stage=read(resolve(directory,'request.json')).stage
  const observed=readStage(reference,stage,host)
  if(stage==='proposal') proposalPaths(host,observed.raw)
  save(resolve(directory,'reference.json'),reference)
  return reference
}
export function buildArm(directory) {
  directory=resolve(directory)
  const metadata=read(resolve(directory,'arm.json'))
  const stages=Object.fromEntries(['proposal','execution','rerun'].map(s=>[s,read(resolve(directory,s,'reference.json'))]))
  const observed=Object.fromEntries(Object.entries(stages).map(([s,r])=>[s,readStage(r,s,metadata.host)]))
  const {proposal,execution,rerun}=observed
  const source=read(resolve(directory,'proposal/source-snapshot.json'))
  const after=execution.after,before=proposal.before
  const configPath=Object.keys(after).filter(p=>/(^|\/)roadmap.config.json$/.test(p))
  assert.equal(configPath.length,1)
  const proposed=nativeObjects(metadata.host,proposal.raw,'proposal')[0]
  const bindings=validateOptionalGateBindings(proposed)
  const artifacts={},optionalInputs={}
  const catalogSource=metadata.catalogCheck?.mode==='catalog' ? 'emitted/repo-catalog.json' : 'package.json'
  for(const path of [...REQUIRED_HOMES,...configPath,catalogSource,...(proposed.delivery ? DELIVERY_PATHS : [])]) {
    const dest=resolve(directory,'artifacts',path)
    mkdirSync(dirname(dest),{recursive:true}); copyFileSync(resolve(metadata.scratchRoot,path),dest)
    artifacts[path]=ref(dest)
  }
  for(const [slot,input] of Object.entries(proposed.optionalGateRuns??{})) {
    if(!input.substitutions?.manifest)continue
    const absolute=input.substitutions.manifest.slice(1)
    assert.ok(input.substitutions.manifest.startsWith('@'+metadata.scratchRoot+'/'),'manifest must be scratch-owned')
    const path=relative(metadata.scratchRoot,absolute),dest=resolve(directory,'artifacts',path)
    assert.ok(proposed.artifacts.some(row=>row.path===path),'optional input requires an explicit approved artifact')
    mkdirSync(dirname(dest),{recursive:true});copyFileSync(absolute,dest)
    artifacts[path]=ref(dest);optionalInputs[slot]=artifacts[path]
  }
  const config=read(resolve(metadata.scratchRoot,configPath[0]))
  const commandExits=[]
  for(const [slot,command] of Object.entries(config.gateCommands)) {
    if(command==='none') { assert.equal(bindings[slot],'none',`${slot} absence must be proposed`); continue }
    const input=Object.hasOwn(proposed.optionalGates??{},slot)&&/[{}]/.test(command) ? optionalGateCommand(proposed,slot,command) : null
    const resolved=input?.resolvedCommand??command
    const native=execution.commands.find(c=>c.exitCode===0 && unwrapGateExecution(c.command,resolved,metadata.scratchRoot,metadata.gateWrapper))
    assert.ok(native,`missing exact native execution for ${slot}: ${command}`)
    const envelope=unwrapGateExecution(native.command,resolved,metadata.scratchRoot,metadata.gateWrapper)
    const optional=input ? {configuredCommand:command,substitutions:input.run.substitutions,inputSha256:input.run.inputSha256} : {}
    commandExits.push({slot,command,...envelope,...optional,cwd:metadata.scratchRoot,toolCallId:native.id,nativeCommand:native.command,exitCode:native.exitCode})
  }
  // Preserve additional executed checks even for structural all-none fixtures.
  for(const native of execution.commands.filter(c=>c.exitCode===0 && /config check|check-readme-catalog/.test(c.command))) commandExits.push({slot:'validation',cwd:metadata.scratchRoot,toolCallId:native.id,nativeCommand:native.command,exitCode:native.exitCode})
  let deliveryValidation
  if (proposed.delivery) {
  const deliveryNative=execution.commands.find(c=>matchesGateCommand(c.command,proposed.delivery.validationCommands[0].command,metadata.scratchRoot))
  assert.ok(deliveryNative,'native installed delivery validation missing')
  const lintNative=execution.commands.find(c=>matchesGateCommand(c.command,ACTIONLINT_PROBE,metadata.scratchRoot))
  assert.ok(lintNative,'native optional actionlint probe missing')
  deliveryValidation={commandExits:[{nativeCommand:deliveryNative.command,toolCallId:deliveryNative.id,exitCode:deliveryNative.exitCode}],actionlint:{command:lintNative.command,toolCallId:lintNative.id,exitCode:lintNative.exitCode,output:lintNative.output}}
  }
  const arm={...metadata,...source,stages,artifacts,optionalInputs,commandExits,...(proposed.delivery ? {delivery:proposed.delivery,deliveryValidation} : {}),
    authorityEnvelope:{filesystem:'workspace-write',network:'inherited',approvals:'inherited'},
    pluginManifestSha256:sha256(readFileSync(resolve(ROOT,`plugins/zeroh-greenfield/.${metadata.host==='claude'?'claude':'codex'}-plugin/plugin.json`))),
    beforeTreeHash:treeHash(before),afterTreeHash:treeHash(after),
    diffPaths:[...new Set([...Object.keys(before),...Object.keys(after)])].filter(p=>canonical(before[p])!==canonical(after[p])).sort(),
    approvedGapAllowlist:proposalPaths(metadata.host,proposal.raw),approvedAbsentGates:Object.entries(bindings).filter(([,v])=>v==='none').map(([k])=>k),
    transcriptSha256:sha256(execution.raw),secondRun:{treeHash:treeHash(rerun.after),proposals:[],writes:[]},status:'passed'}
  if (proposed.delivery) arm.deliveryValidation.schemaDigests=validateDeliveryEvidence({arm,proposal:proposed,before,after,commands:execution.commands}).schemaDigests
  validateSourceBinding(arm);validateObservedArm(arm)
  save(resolve(directory,'validated-arm.json'),arm)
  return arm
}
export function project(directories) {
  const arms=directories.map(buildArm)
  assert.deepEqual(arms.map(a=>`${a.kind}:${a.host}`),['empty:claude','empty:codex','brownfield:claude','brownfield:codex'])
  assert.equal(new Set(arms.map(a=>a.sourceSnapshotSha256)).size,1,'all four arms must share final source')
  for(const field of ['scratchRoot','scratchIdentity','transcriptSha256']) assert.equal(new Set(arms.map(a=>a[field])).size,4,`four distinct native ${field} values required`)
  for(const kind of ['empty','brownfield']) save(resolve(ROOT,`plugins/zeroh-greenfield/dry-runs/${kind}/receipt.json`),{arms:arms.filter(a=>a.kind===kind)})
  const report=['# Native greenfield validation — 2026-09','', 'Generated by `greenfield-native-driver.mjs` from validated native sessions, independent filesystem observations, and source snapshots recorded at observation time. Source freshness is checked separately by test:native-evidence.','', '| Fixture | Host | Result | Adapter | Execution SHA-256 | Evidence |','| --- | --- | --- | --- | --- | --- |',...arms.map(a=>`| ${a.kind} | ${a.host} | ${a.status} | ${a.delivery?.adapter ?? 'local prototype'} | ${a.transcriptSha256} | [capture](${relative(resolve(ROOT,'plugins/zeroh-greenfield'),resolve(ROOT,a.stages.execution.directory))}/reference.json) |`),'']
  writeFileSync(resolve(ROOT,'plugins/zeroh-greenfield/DRYRUN-2026-09.md'),report.join('\n'))
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [command,...args]=process.argv.slice(2)
  if(command==='capture') process.stdout.write(JSON.stringify(capture(...args),null,2)+'\n')
  else if(command==='arm') process.stdout.write(JSON.stringify(buildArm(...args),null,2)+'\n')
  else if(command==='project') project(args)
  else throw new Error('Usage: greenfield-native-driver.mjs capture <host> <stage-dir> | arm <arm-dir> | project <four ordered arm-dirs>')
}
