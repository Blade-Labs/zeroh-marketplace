// Consistency checks over typed records. This does not authenticate reviews or consent.
import { existsSync, realpathSync } from 'node:fs'
import { resolve, dirname, basename, relative, join } from 'node:path'
import { bridgeValidate, bridgeSource } from './tsx-bridge.mjs'
import { gitToplevel } from './gitroot.mjs'
import { consumerSchemaPath } from './roadmap-root.mjs'
import { defaultExec } from './exec.mjs'
import { scanProgress } from './phasescan.mjs'
const active = status => ['in-progress','executing','swept','done'].includes(status)
const terminal = status => ['done','historical','cancelled'].includes(status)
const members = arc => arc.phases ?? arc.planes?.flatMap(plane => plane.phases ?? []) ?? []
const stable = value => typeof value==='string' ? value.trim() : Array.isArray(value) ? value.map(stable) : value && typeof value==='object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])) : value
const same = (a,b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b))
const issue = (rule,msg) => ({ rule,msg,fix:'Repair the record or resolve the actual missing requirement; do not manufacture a passing result.' })
export const firstMeaningfulLine = text => String(text).split('\n').find(line => line.trim()) ?? 'Validation unavailable'
export const renderZodIssues = (file,issues) => issues.map(item => `${file}: ${item.path?.join('.') ?? ''}: ${item.message}`)

function committedRecord(repo, ref, path) {
  const result = defaultExec('git', ['show', `${ref}:${path}`], { cwd: repo })
  if (result.status !== 0) return { ok:false, absent:(()=>{
    const listing=defaultExec('git',['ls-tree',ref,'--',path],{cwd:repo})
    if (listing.status===0) return listing.stdout.trim()===''
    if (ref!=='HEAD') return false
    const branch=defaultExec('git',['symbolic-ref','-q','HEAD'],{cwd:repo})
    return branch.status===0 && defaultExec('git',['show-ref','--verify','--quiet',branch.stdout.trim()],{cwd:repo}).status===1
  })(), stderr:`Cannot read committed intent ${ref}:${path}: ${result.stderr}` }
  return bridgeSource(result.stdout, resolve(repo,path), repo)
}
function intentChecks(arc, path, repo) {
  const errors = []
  const rel = relative(repo,path).split('\\').join('/')
  const head = committedRecord(repo,'HEAD',rel)
  if (!head.ok && !head.absent) return [issue('intent-history','Committed arc is unreadable: '+head.stderr)]
  // A current status change cannot switch off an already established intent baseline.
  const required = active(arc.status) || (head.ok && (active(head.parsed.status) || head.parsed.intentRef))
  if (!required && !arc.intentRef) return errors
  const match = /^(?:([a-f0-9]{40}|[a-f0-9]{64})):(.+\.arc\.ts)$/.exec(arc.intentRef ?? '')
  if (!match || match[2].startsWith('/') || match[2].includes('\\') || match[2].split('/').some(part => !part || part === '.' || part === '..')) return [issue('intent-ref','Active arc requires its approved intentRef (full commit SHA:repository-relative.arc.ts). Legacy history is not migrated automatically.')]
  if (head.ok && head.parsed.intentRef && !same(head.parsed.intentRef,arc.intentRef)) errors.push(issue('intent-ref','The established approved-intent reference cannot be silently replaced.'))
  const original = committedRecord(repo,match[1],match[2])
  if (!original.ok) return [...errors,issue('intent-ref',original.stderr)]
  if (String(original.parsed.id).trim() !== String(arc.id).trim()) return [...errors,issue('intent-ref','Intent reference identifies a different arc.')]
  // Ratifications are explicit deltas from original criteria, not a permission system.
  const expected = new Map((original.parsed.acceptanceCriteria ?? []).map(c => [String(c.id).trim(),c]))
  const ratifications = arc.criteriaRatifications ?? []
  if (head.ok) {
    const prior = head.parsed.criteriaRatifications ?? []
    if (!same(prior,ratifications.slice(0,prior.length))) errors.push(issue('ratification-history','Committed criteria ratifications are append-only.'))
  }
  for (const ruling of ratifications) {
    if (!ruling.criterionId || !ruling.reason || !ruling.approvedBy || !ruling.approvedAt || !same(expected.get(ruling.criterionId)?.description,ruling.previousDescription)) {
      errors.push(issue('ratification','A criteria change lacks a matching previous description and explicit owner ruling.')); continue
    }
    if (ruling.description === null) expected.delete(ruling.criterionId)
    else if (typeof ruling.description === 'string' && ruling.description.trim()) expected.set(ruling.criterionId,{id:ruling.criterionId,description:ruling.description})
    else errors.push(issue('ratification','Ratified description must be nonempty or an explicit removal.'))
  }
  const actual = new Map((arc.acceptanceCriteria ?? []).map(c => [String(c.id).trim(),c]))
  if (expected.size !== actual.size || [...expected].some(([id,description]) => !same(actual.get(id),description))) errors.push(issue('original-intent','Acceptance criteria differ from the approved original plus recorded ratifications.'))
  for (const key of ['intent','scope','nonGoals']) if (!same(arc[key] ?? (key==='intent'?undefined:[]),original.parsed[key] ?? (key==='intent'?undefined:[]))) errors.push(issue('scope-boundary',`Original ${key} changed. Preserve this arc and plan a separately approved scope change instead of silently weakening it.`))
  return errors
}

export function validateRoadmapFile(filePath,{strict=true}={}) {
  const requested = resolve(filePath)
  const path = existsSync(requested) ? realpathSync(requested) : requested, name = basename(path)
  const phaseFile = name.endsWith('.phase.ts'), arcFile = name.endsWith('.arc.ts'), backlogFile = name === 'backlog.ts'
  if (!phaseFile && !arcFile && !backlogFile) return strict ? {ok:false,kind:'errors',errors:[issue('path','Expected a phase, arc or backlog record')]} : {ok:true,kind:'skip'}
  if (!existsSync(path)) return strict ? {ok:false,kind:'errors',errors:[issue('missing',`Missing record ${path}`)]} : {ok:true,kind:'skip'}
  let repo
  try { repo=gitToplevel(dirname(path)) } catch { repo=dirname(path) }
  const root = backlogFile ? dirname(path) : dirname(dirname(path))
  let schema
  try { schema=existsSync(join(root,'lib/schema.ts')) ? join(root,'lib/schema.ts') : consumerSchemaPath(repo) } catch(error) { return {ok:false,kind:'load-error',loadError:error.message} }
  const imported = bridgeValidate(path,schema,phaseFile?'PhaseShape':arcFile?'ArcShape':'BacklogShape',repo)
  if (!imported.ok) {
    if (imported.kind === 'tsx-absent') return {ok:!strict,kind:'toolchain-missing',loadError:imported.stderr}
    if (imported.kind === 'zod') return {ok:false,kind:'zod',zod:{file:name,issues:imported.issues},loadError:renderZodIssues(name,imported.issues).join('\n')}
    return {ok:false,kind:'load-error',loadError:imported.stderr}
  }
  const record = imported.parsed
  if (!record || typeof record !== 'object') return {ok:false,kind:'errors',errors:[issue('record','No typed record exported')]}
  const state = scanProgress(root), errors = state.errors.map(message => issue('load',message))
  const phases = new Map(), arcs = new Map()
  for (const phase of state.phases) {
    if (phases.has(phase.phase)) errors.push(issue('duplicate-phase',`Duplicate phase ${phase.phase}`))
    phases.set(phase.phase,phase)
  }
  for (const arc of state.arcs) {
    if (arcs.has(String(arc.id))) errors.push(issue('duplicate-arc',`Duplicate arc ${arc.id}`))
    arcs.set(String(arc.id),arc)
  }
  // Only records whose state this check relies on need schema validation. Archive
  // discovery remains read-only and does not force unrelated records to upgrade.
  const checked = new Map([[path,record]])
  function relevant(candidate, shape) {
    if (!candidate) return null
    const file=realpathSync(candidate.file)
    if (checked.has(file)) return checked.get(file)
    const loaded=bridgeValidate(file,schema,shape,repo)
    if (!loaded.ok) {
      errors.push(issue('related-record',`Invalid related record ${candidate.file}: ${loaded.stderr || loaded.kind}`))
      checked.set(file,null)
      return null
    }
    const value={...loaded.parsed,file}
    checked.set(file,value)
    return value
  }
  if (phaseFile) {
    for (const id of record.dependsOn ?? []) {
      const dependency=relevant(phases.get(typeof id === 'number' ? id : id.phase),'PhaseShape')
      if (!dependency) errors.push(issue('dependency',`Missing dependency ${id}`))
      else if (active(record.status) && dependency.status !== 'done' && dependency.status !== 'historical') errors.push(issue('dependency',`Dependency ${id} is not complete`))
    }
    if (record.arcId != null) {
      const arc=relevant(arcs.get(String(record.arcId)),'ArcShape')
      if (!arc || !members(arc).includes(record.phase)) errors.push(issue('membership','Phase is not listed in its parent arc'))
      else if (active(record.status)) errors.push(...intentChecks(arc,arc.file,repo))
    }
  }
  if (arcFile) {
    const listed=members(record), criteria=new Set((record.acceptanceCriteria ?? []).map(c=>c.id)), deferred=record.planning?.deferredCriteria ?? []
    if (new Set(listed).size!==listed.length) errors.push(issue('membership','Duplicate member phase'))
    if (new Set(deferred).size!==deferred.length || deferred.some(id=>!criteria.has(id))) errors.push(issue('deferred','Deferred criteria must be unique original criterion IDs'))
    const coverage=new Set(deferred)
    for (const id of listed) {
      const phase=relevant(phases.get(id),'PhaseShape')
      if (!phase) { errors.push(issue('membership',`Missing member phase ${id}`)); continue }
      if (String(phase.arcId)!==String(record.id)) errors.push(issue('membership',`Phase ${id} belongs to a different arc`))
      for (const criterion of phase.criteria ?? []) {
        if (!criteria.has(criterion)) errors.push(issue('coverage',`Phase ${id} names unknown criterion ${criterion}`))
        coverage.add(criterion)
      }
      if (['swept','done'].includes(record.status) && phase.status!=='done') errors.push(issue('completion',`Member phase ${id} is not done`))
    }
    if (record.planning) {
      for (const criterion of criteria) if (!coverage.has(criterion)) errors.push(issue('coverage',`Criterion ${criterion} has neither planned nor deferred work`))
      const pending=listed.filter(id=>phases.has(id)&&!terminal(phases.get(id).status))
      if (pending.length>record.planning.windowSize) errors.push(issue('window','Detailed unfinished phases exceed the agreed rolling window'))
      if (deferred.length && ['swept','done'].includes(record.status)) errors.push(issue('completion','Deferred outcomes cannot be swept or done'))
    }
    // Archive reads via status remain possible; explicit active validation never skips a missing baseline.
    errors.push(...intentChecks(record,path,repo))
  }
  if (backlogFile) {
    const entries=Array.isArray(record) ? record : record.tiers?.flatMap(tier=>tier.items) ?? []
    for (const entry of entries) if (!phases.has(entry.phase)) errors.push(issue('backlog',`Backlog references missing phase ${entry.phase}`))
  }
  return errors.length ? {ok:false,kind:'errors',errors} : {ok:true,kind:'ok',warnings:[]}
}
