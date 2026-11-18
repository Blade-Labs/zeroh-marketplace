// Explicit, arc-scoped format migration. Preview is read-only; no consumer code is executed.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { bridgeSource, bridgeEval } from '../lib/tsx-bridge.mjs'
import { roadmapRoot, consumerSchemaPath } from '../lib/roadmap-root.mjs'

function confined(repo, file) {
  let existing=file
  while(!fs.existsSync(existing)) existing=path.dirname(existing)
  const rel=path.relative(fs.realpathSync(repo),fs.realpathSync(existing))
  if(rel==='..' || rel.startsWith('..'+path.sep) || path.isAbsolute(rel) || fs.lstatSync(existing).isSymbolicLink()) throw new Error('Migration refuses an external or symlinked destination: '+file)
}
const template = fileURLToPath(new URL('../../templates/schema.ts', import.meta.url))
const nativeKeys = {
  arc: ['id','name','status','intent','scope','nonGoals','assumptions','acceptanceCriteria','intentRef','criteriaRatifications','phases','planning','acceptanceResults','checks','findings','independentReview','limitations','checksNotApplicable'],
  phase: ['phase','name','status','arcId','intent','dependsOn','criteria','tasks','checks','findings','independentReview','limitations','checksNotApplicable'],
}
function readRecord(file, kind, repo) {
  const source = fs.readFileSync(file, 'utf8')
  const result = bridgeSource(source, file, repo, kind === 'arc' ? 'defineArc' : 'definePhase')
  if (!result.ok) throw new Error(`${file}: ${result.stderr}`)
  return { source, record: result.parsed }
}
function project(record, kind) {
  const out = Object.fromEntries(nativeKeys[kind].filter(key => Object.hasOwn(record,key)).map(key => [key, record[key]]))
  out.schemaVersion = 1
  // Preserve the complete declarative source data, including overwritten field shapes.
  out.extensions = { ...record.extensions, roadmapMigration: { format: 1, original: record } }
  return out
}
const relativeImport = (from, to) => { const rel=path.relative(path.dirname(from),to).split(path.sep).join('/').replace(/\.ts$/,''); return rel.startsWith('.')?rel:'./'+rel }
function render(source, record, kind, file, schema) {
  // Only comments may survive as executable-file preamble; never copy legacy statements.
  // The exact source (including inline comments) remains in the historical snapshot.
  const preamble=(source.slice(0,source.indexOf('export default')).match(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g)??[]).join('\n')
  const define=kind==='arc'?'defineArc':'definePhase'
  return `${preamble.trim()}\n\nimport { ${define} } from ${JSON.stringify(relativeImport(file,schema))}\n\nexport default ${define}(${JSON.stringify(record,null,2)})\n`
}
export default async function migrate(args) {
  const allowed=new Set(['--arc','--apply','--decisions'])
  const options={}
  for(let i=0;i<args.length;i++) {
    const flag=args[i]
    if(!allowed.has(flag) || Object.hasOwn(options,flag)) throw new Error('Usage: roadmap migrate --arc <path> [--apply] [--decisions <json>]')
    options[flag]=flag==='--apply'?true:args[++i]
    if(!options[flag] || String(options[flag]).startsWith('--')) throw new Error(`Missing value for ${flag}`)
  }
  if(!options['--arc']) throw new Error('--arc is required')
  const repo=execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim()
  const root=roadmapRoot(repo), arcPath=fs.realpathSync(path.resolve(options['--arc']))
  if(path.dirname(arcPath)!==fs.realpathSync(path.join(root,'arcs'))) throw new Error('Select an arc directly inside the discovered roadmap root')
  let legacyStringRatifications=0
  const decisions=options['--decisions']?JSON.parse(fs.readFileSync(options['--decisions'],'utf8')):{}
  if(Object.keys(decisions).some(k=>!['intent','scope','status'].includes(k))) throw new Error('Decisions may supply only intent, scope and status; repair evidence in its actual record')
  const {source,record:old}=readRecord(arcPath,'arc',repo)
  if(old.extensions?.roadmapMigration?.format===1 || old.schemaVersion===1) { console.log(JSON.stringify({alreadyMigrated:true,arc:old.id,writes:[]},null,2)); return 0 }
  if(['done','historical','cancelled'].includes(old.status)) throw new Error('Historical arcs stay on their existing schema; select unfinished work')
  const schema=path.join(root,'lib/schema.ts'), native=path.join(root,'lib/native-schema.ts')
  for(const file of [arcPath,schema,native,path.join(root,'phases')]) confined(repo,file)
  const existing=consumerSchemaPath(repo), writes=[], preserved=[], gaps=[]
  const arc=project(old,'arc')
  arc.phases=old.phases ?? old.planes?.flatMap(p=>p.phases)
  arc.acceptanceCriteria=old.acceptanceCriteria?.map(c=>({id:c.id, description:c.description ?? ['job','signal','bar'].filter(k=>c[k]).map(k=>`${k}: ${c[k]}`).join('\n')}))
  // Consumer repair (viky-agent-2, 2026-09-09): legacy string-shaped criteriaRatifications cannot become native
  // object ratifications without fabricating owner fields; they stay verbatim under
  // extensions.roadmapMigration.original.criteriaRatifications and the migrated criteria text already embodies them.
  if(Array.isArray(arc.criteriaRatifications)&&arc.criteriaRatifications.some(r=>typeof r==='string')){
    legacyStringRatifications=arc.criteriaRatifications.filter(r=>typeof r==='string').length
    arc.criteriaRatifications=arc.criteriaRatifications.filter(r=>typeof r!=='string')
  }
  // Legacy arc status was often absent even after execution: never silently reset it.
  Object.assign(arc,decisions)
  if(['done','historical','cancelled'].includes(arc.status)) throw new Error('Migration cannot establish completion; preserve historical records unchanged')
  for(const key of ['intent','scope','status']) if(!arc[key]) gaps.push(`Supply ${key} from the existing approved plan using --decisions; migration does not invent it`)
  if(!Array.isArray(arc.phases) || !arc.phases.length) gaps.push('Arc has no explicit member phases')
  const files=fs.readdirSync(path.join(root,'phases')).filter(n=>n.endsWith('.phase.ts'))
  for(const number of arc.phases ?? []) {
    const matches=files.filter(n=>new RegExp(`^phase-${number}(?:[.-])`).test(n))
    if(matches.length!==1) { gaps.push(`Expected one member phase ${number}; found ${matches.length}`); continue }
    const file=path.join(root,'phases',matches[0])
    confined(repo,file)
    const before=readRecord(file,'phase',repo), record=before.record
    if(['in-progress','executing','swept'].includes(record.status) && arc.status==='backlog') gaps.push(`Phase ${number} is active; do not reset its arc to backlog during migration`)
    if(record.arcId!=null && String(record.arcId)!==String(old.id)) {gaps.push(`Phase ${number} belongs to ${record.arcId}`);continue}
    if(['done','historical','cancelled'].includes(record.status) || record.schemaVersion===1) {preserved.push(path.relative(repo,file));continue}
    const phase=project(record,'phase')
    phase.arcId=old.id
    phase.tasks=record.tasks?.map(t=>({id:t.id,description:t.description??t.title,status:t.status??(t.done===true?'done':t.done===false?'pending':undefined)}))
    if(record.tasks?.some(t=>t.status==null && typeof t.done!=='boolean')) gaps.push(`Phase ${number}: task completion is ambiguous`)
    if(record.dependsOn?.some(d=>typeof d!=='number')) gaps.push(`Phase ${number}: dependency objects need explicit review; not flattened automatically`)
    writes.push({file,record:phase,kind:'phase',source:before.source})
  }
  writes.push({file:arcPath,record:arc,kind:'arc',source})
  const head=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim()
  for(const w of writes) {
    const ref=`${head}:${path.relative(repo,w.file).split(path.sep).join('/')}`
    try {
      if(execFileSync('git',['show',ref],{cwd:repo,encoding:'utf8',maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']})!==w.source) throw new Error('changed')
      w.record.extensions.roadmapMigration.sourceRef=ref
    } catch {gaps.push(`Commit the exact source before migration so comments/history are preserved: ${path.relative(repo,w.file)}`)}
  }
  const validation=bridgeEval(repo,`const fs=require('node:fs'); const s=require(${JSON.stringify(template)}); const records=JSON.parse(fs.readFileSync(0,'utf8')); console.log(JSON.stringify(records.flatMap(r=>{const v=s[r.kind==='arc'?'ArcShape':'PhaseShape'].safeParse(r.record);return v.success?[]:[{file:r.file,issues:v.error.issues}]})))`,{input:JSON.stringify(writes.filter(w=>w.kind!=='arc'||['intent','scope','status'].every(k=>arc[k])))})
  if(!validation.ok) gaps.push(validation.stderr)
  else {const errors=JSON.parse(validation.stdout); for(const error of errors) gaps.push(`${path.relative(repo,error.file)}: ${JSON.stringify(error.issues)}`)}
  const marker='// Roadmap native migration facade v1'
  const facade=fs.existsSync(schema)&&fs.readFileSync(schema,'utf8').startsWith(marker)
  if(existing===schema && !facade) gaps.push('Root-local schema already exists: preserve it as legacy-schema.ts and review its relative imports before migration; no overwrite attempted')
  if(!facade && fs.existsSync(native)) gaps.push('native-schema.ts already exists; refusing to overwrite')
  if(facade && fs.readFileSync(native,'utf8')!==fs.readFileSync(template,'utf8')) gaps.push('Installed native schema differs from this version; review its upgrade first')
  const warnings=[...(legacyStringRatifications?[`${legacyStringRatifications} legacy string criteriaRatifications preserved verbatim under extensions.roadmapMigration.original; the native criteriaRatifications start empty and the migrated criteria text is the ratified state`]:[]),'Review preserved comments and extensions.roadmapMigration.original for task steps, design rulings and constraints; legacy engine settings are data, not executable policy.', 'Existing scripts/hooks/CI that call retired commands still require adaptation.', 'Before execution, establish a reviewed committed literal intent baseline; this command does not grant approval or certify completion.']
  const retiredCallers=[], legacySchemaCallers=[]
  for(const file of execFileSync('git',['ls-files','-z'],{cwd:repo,encoding:'utf8'}).split('\0').filter(Boolean)) {
    if(!/\.(?:json|mjs|cjs|ts|sh|md|ya?ml)$/.test(file) || /(?:^|\/)(?:node_modules|arc-evals|phases|arcs|archive)(?:\/|$)/.test(file)) continue
    const absolute=path.join(repo,file)
    if(!fs.existsSync(absolute) || fs.lstatSync(absolute).isSymbolicLink() || fs.statSync(absolute).size>1000000) continue
    if(path.dirname(absolute)===path.dirname(existing) && absolute!==existing && /from\s+['"]\.\/schema['"]/.test(fs.readFileSync(absolute,'utf8'))) legacySchemaCallers.push(file)
    fs.readFileSync(absolute,'utf8').split('\n').forEach((line,i)=> {const matches=[...line.matchAll(/\broadmap\s+(arc|gate|eval|capacity|watch|arm|config|workflow)\b/g)];for(const m of matches) retiredCallers.push({file,line:i+1,command:m[1]})})
  }
  const report={retiredCallers,legacySchemaCallers,arc:old.id,mode:options['--apply']?'apply':'preview',writes:writes.map(w=>path.relative(repo,w.file)),schemaWrites:facade?[]:[path.relative(repo,native),path.relative(repo,schema)],preserved,gaps,warnings}
  if(gaps.length) {console.log(JSON.stringify(report,null,2));return 2}
  if(options['--apply']) {
    const content=writes.map(w=>({...w,content:render(w.source,w.record,w.kind,w.file,native)}))
    for(const w of content) if(fs.readFileSync(w.file,'utf8')!==w.source) throw new Error('Source changed during preview: '+w.file)
    fs.mkdirSync(path.dirname(schema),{recursive:true})
    if(!facade) {
      const legacy=relativeImport(schema,existing)
      const text=`${marker}\nimport * as legacy from ${JSON.stringify(legacy)}\nimport * as native from './native-schema'\nexport { defineArc, definePhase, defineBacklog } from './native-schema'\n// Old files keep importing their original schema; validate them without rewriting history.\nconst route = (key: 'ArcShape' | 'PhaseShape') => ({ parse(value: unknown) {\n  return value && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion === 1\n    ? native[key].parse(value) : legacy[key].parse(value)\n} })\nexport const ArcShape = route('ArcShape')\nexport const PhaseShape = route('PhaseShape')\nexport const BacklogShape = { parse(value: unknown) { return Array.isArray(value) ? native.BacklogShape.parse(value) : legacy.BacklogShape.parse(value) } }\n`
      fs.writeFileSync(native,fs.readFileSync(template),{flag:'wx'})
      fs.writeFileSync(schema,text,{flag:'wx'})
    }
    for(const w of content) fs.writeFileSync(w.file,w.content)
  }
  console.log(JSON.stringify(report,null,2));return 0
}
