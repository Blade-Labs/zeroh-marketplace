import {isDeepStrictEqual as same} from 'node:util'
/**
 * roadmap arc <sub> — the arc-level transitions (arc ROADCODE §2).
 *   next <arcId> [--json] [--ignore-capacity]  the ONE position derivation (seam 2) + admission gate
 *   record-validate <arcId> --verdict <v>    stamp the validate verdict artifact (decision 5)
 *   land <arcId> [--push|--no-push|--hold]   the ONE landing engine (seam 4, 1657.5)
 *
 * Exit-code contract (universal): 0 clean / any derived action incl. complete · 1
 * usage/config/toolchain · 2 blocked or a landing blocker (the caller cannot narrate
 * around it) · 3 held-for-user (land). STRICT context — a tsx-absent typed read is a
 * loud exit 1, never a guess.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync,renameSync,unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join,relative } from 'node:path'
import {randomUUID} from 'node:crypto'
import {withFileLock} from '../lib/file-lock.mjs'
import {gateInputKey} from '../lib/gate-diagnostics.mjs'
import {readCorrectionReview,latestReport} from '../lib/gate-report.mjs'
import {bridgeImport,bridgeParseShape} from '../lib/tsx-bridge.mjs'
import {consumerSchemaPath} from '../lib/roadmap-root.mjs'
import {assertDeliveryJudgments,readDeliveryArtifact,evidenceCoversHead} from '../lib/delivery-evaluation.mjs'
import { gitToplevel } from '../lib/gitroot.mjs'
import { loadConfig, ConfigError } from '../lib/config.mjs'
import { deriveArcPosition, readValidateVerdict, DeriveError } from '../lib/derive.mjs'
import { roadmapRoot } from '../lib/roadmap-root.mjs'
import { normalizeArc, HistoryNormalizationError } from '../lib/history-normalize.mjs'
import { shellArgument } from '../lib/workflow-steps.mjs'
export { normalizeArc }


const firstPositional = (rest) => rest.find((a) => !a.startsWith('--'))
const flagVal = (rest, name) => {
  const i = rest.indexOf(name)
  return i >= 0 ? rest[i + 1] : undefined
}
const printLines = (lines) => lines.forEach((l) => process.stderr.write(l + '\n'))

async function arcNext(rest) {
  const json = rest.includes('--json')
  const arcId = firstPositional(rest)
  if (!arcId) {
    process.stderr.write('usage: roadmap arc next <arcId> [--json] [--ignore-capacity]\n')
    return 1
  }
  let toplevel, cfg
  try {
    toplevel = gitToplevel(process.cwd())
    cfg = loadConfig(process.cwd())
  } catch (e) {
    printLines(e instanceof ConfigError ? e.messageLines : [`roadmap arc next: ${e.message}`])
    return 1
  }
  let pos
  try {
    pos = deriveArcPosition({ repoRoot: toplevel, arcId, config: cfg })
  } catch (e) {
    if (e instanceof DeriveError) {
      printLines(e.messageLines)
      return e.exitCode
    }
    throw e
  }
  // Capacity admission gate (phase 11): a run-phase on a starved box is refused as the blocked
  // action do-arc already handles. Scoped to run-phase ONLY — a resume continues committed work
  // and refusing it would strand a wedged arc. Seam errors are the OPERATOR's knob → loud exit 1;
  // a live-probe computation failure fails OPEN (advisory math must never wedge the pipeline).
  if (pos.action === 'run-phase') {
    // --ignore-capacity still PROBES: the override's audit note has to name what it overrode.
    const override = rest.includes('--ignore-capacity')
    let SeamErrorClass
    try {
      const { probeCapacity, defaultProbes, seamProbes, SeamError, SEAM_ENV } = await import('../lib/capacity.mjs')
      SeamErrorClass = SeamError
      let verdict
      try {
        verdict = probeCapacity(cfg.capacity, seamProbes() ?? defaultProbes)
      } catch (e) {
        if (!override && (e instanceof SeamError || process.env[SEAM_ENV])) {
          process.stderr.write(`arc next: ${e.message}\n`)
          return 1
        }
        throw e
      }
      if (!verdict.canSpawn) {
        if (override) {
          process.stderr.write(`arc next: --ignore-capacity override — spawning despite: ${verdict.reasons.join('; ')}\n`)
        } else {
          pos = {
            ...pos,
            action: 'blocked',
            reason: `box at capacity — ${verdict.reasons.join('; ')} — re-run when load drops, or override with --ignore-capacity`,
            // the refused member goes back on the board — refused, not consumed
            remaining: [pos.phase, ...(pos.remaining ?? [])],
          }
        }
      }
    } catch (e) {
      // The override asked to skip the gate, so a failing check changes nothing — but a broken
      // seam is still the OPERATOR's knob and gets NAMED (never silently advisory-blind).
      if (!override)
        process.stderr.write(`arc next: capacity check unreadable (${e?.message ?? e}) — fail-open, run-phase stands\n`)
      else if (SeamErrorClass && e instanceof SeamErrorClass)
        process.stderr.write(`arc next: ${e.message} (override active — run-phase stands)\n`)
    }
  }
  process.stdout.write(JSON.stringify(pos, null, json ? 0 : 2) + '\n')

  // Stale-base EARLY warning + detached-land status (1792.4/1792.5) — advisory, on stderr so the
  // machine-read JSON on stdout stays clean. Both answer "what does the driver need to know
  // BEFORE the next plane" that today only surfaces at land.
  try {
    const { gatherLandingState, staleBaseWarning, readLandJournal, classifyLandJournal, pidAlive, landJournalPath, DEFAULT_STALE_BASE_CEILING } =
      await import('../lib/landing.mjs')
    const journalHome = process.env.ZEROH_LAND_JOURNAL_HOME ?? toplevel
    const verdict = classifyLandJournal(readLandJournal(journalHome, arcId), { isAlive: pidAlive })
    if (verdict.state === 'live')
      process.stderr.write(`arc next: a detached land for ${arcId} is RUNNING (pid ${verdict.pid}, step: ${verdict.step ?? 'starting'}) — journal ${landJournalPath(journalHome, arcId)}\n`)
    else if (verdict.state === 'finished')
      process.stderr.write(`arc next: a detached land for ${arcId} finished with exit ${verdict.exitCode} — read ${landJournalPath(journalHome, arcId)}\n`)
    else if (verdict.state === 'stale')
      process.stderr.write(`arc next: a previous detached land for ${arcId} died without an exit code (pid ${verdict.pid}) — re-run \`roadmap arc land ${arcId}\`\n`)

    const state = gatherLandingState({ repoRoot: toplevel, arcId, config: cfg })
    const ceiling = cfg.mergePolicy?.staleBaseCeiling ?? DEFAULT_STALE_BASE_CEILING
    const warn = staleBaseWarning(state.baseBehindCount, ceiling, state.baseRef ?? 'develop')
    if (warn) process.stderr.write(`arc next: ${warn.message}\n`)
  } catch {
    /* advisory only — an unreadable landing state never fails arc next */
  }
  return pos.action === 'blocked' ? 2 : 0
}

async function recordValidate(rest) {
  const arcId = firstPositional(rest)
  const verdict = flagVal(rest, '--verdict')
  const note = flagVal(rest, '--note')
  const correctionReady = rest.includes('--correction-ready')
  if (!arcId || (correctionReady ? verdict !== undefined || note !== undefined : !['PASS', 'GAPS', 'no-op'].includes(verdict))) {
    process.stderr.write('usage: roadmap arc record-validate <arcId> (--verdict <PASS|GAPS|no-op> [--note <s>] | --correction-ready)\n')
    return 1
  }
  let toplevel
  try {
    toplevel = gitToplevel(process.cwd())
  } catch (e) {
    process.stderr.write(`roadmap arc record-validate: ${e.message}\n`)
    return 1
  }
  const dir = join(roadmapRoot(toplevel), '.gate', `arc-${arcId}`)
  const path = join(dir, 'validate.json')
  let head
  try {
    head = execFileSync('git', ['-C', toplevel, 'rev-parse', 'HEAD^{commit}'], { encoding: 'utf8' }).trim()
  } catch (e) {
    process.stderr.write(`roadmap arc record-validate: cannot resolve the current commit: ${e.message}\n`)
    return 1
  }
  let priorRecord
  try{priorRecord=readValidateVerdict(toplevel,arcId)}catch(error){process.stderr.write('roadmap arc record-validate: '+error.message+'\n');return 2}
  const mutationAt = new Date().toISOString()
  let artifact
  if (correctionReady) {
    let existing
    try {
      existing = readValidateVerdict(toplevel, arcId)
    } catch (e) {
      process.stderr.write(`roadmap arc record-validate: malformed existing validate artifact: ${e.message}\n`)
      return 1
    }
    const correction = existing?.correction
    if (String(existing?.arcId) !== String(arcId) || existing?.verdict !== 'GAPS'
      || !['awaiting-repair', 'needs-sweep'].includes(correction?.state)
      || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(correction?.validationHead ?? '')
      || typeof existing.at !== 'string' || Number.isNaN(Date.parse(existing.at))) {
      process.stderr.write('roadmap arc record-validate: --correction-ready requires a well-formed GAPS artifact awaiting repair\n')
      return 1
    }
    if (correction.state === 'needs-sweep' && correction.repairHead === head) {
      process.stdout.write(JSON.stringify(existing, null, 2) + '\n')
      return 0
    }
    if(correction.bounds && Date.parse(mutationAt) >= Date.parse(correction.bounds.deadlineAt)){process.stderr.write('roadmap arc record-validate: correction deadline has expired\n');return 2}
    if (correction.state !== 'awaiting-repair') {
      process.stderr.write('roadmap arc record-validate: correction is not awaiting repair\n')
      return 1
    }
    if (head === correction.validationHead) {
      process.stderr.write('roadmap arc record-validate: correction repair HEAD must differ from validation HEAD\n')
      return 1
    }
    try {
      execFileSync('git', ['-C', toplevel, 'merge-base', '--is-ancestor', correction.validationHead, head], { stdio: 'pipe' })
    } catch {
      process.stderr.write('roadmap arc record-validate: repair commit does not descend from its validation checkpoint\n')
      return 1
    }
    let reviewRef
    if(correction.bounds){
      const phase=correction.route?.trace?.phaseId??correction.route?.plannedCorrection?.phaseId,review=readCorrectionReview(toplevel,phase)
      if(!review||review.arcId!==arcId||review.round!==correction.round||review.sourceHeadSha!==correction.validationHead||review.repairHead!==head){process.stderr.write('roadmap arc record-validate: record the current green affected gate and independent correction review before --correction-ready\n');return 2}
      reviewRef=relative(toplevel,latestReport(toplevel,phase).path)
    }
    artifact = {
      ...existing,
      correction: {
        ...correction,
        state: 'needs-sweep',
        repairHead: head,
        ...(reviewRef?{reviewRef}:{}),
        readyAt: mutationAt,
      },
    }
  } else {
    let prior = null
    if (verdict === 'GAPS' && existsSync(path)) {
      try { prior = JSON.parse(readFileSync(path, 'utf8')) } catch { /* a new explicit verdict replaces corrupt evidence */ }
    }
    if(priorRecord?.correction?.bounds)prior=priorRecord
    const continuing = prior?.verdict === 'GAPS' && String(prior.arcId) === String(arcId)
    const { state, validationHead, repairHead, readyAt, ...bounds } = continuing ? (prior.correction ?? {}) : {}
    artifact = {
      ...(continuing ? prior : {}),
      arcId,
      verdict,
      headSha:head,
      at: mutationAt,
      ...(note ? { note } : {}),
      ...(verdict === 'GAPS' ? { correction: { ...bounds, state: 'awaiting-repair', validationHead: head } } : {}),
    }
  }
  if(!correctionReady&&priorRecord?.correction?.bounds){
    const c=priorRecord.correction
    if(Date.parse(mutationAt)>=Date.parse(c.bounds.deadlineAt)){
      if(verdict==='GAPS'&&c.state==='awaiting-repair'&&c.validationHead===head&&!note)artifact=priorRecord
      else if(verdict==='PASS'&&c.state==='validated'&&priorRecord.verdict==='PASS'&&priorRecord.headSha===head&&!note){process.stdout.write(JSON.stringify(priorRecord,null,2)+'\n');return 0}
      else{process.stderr.write('roadmap arc record-validate: correction deadline has expired\n');return 2}
    }
    if(verdict==='GAPS'){
      if(c.state==='awaiting-repair'&&c.validationHead===head)artifact={...priorRecord,...(note?{note}:{})}
      else artifact={...artifact,correction:{state:'awaiting-repair',validationHead:head,gateInputKey:gateInputKey(toplevel),round:c.round,bounds:c.bounds,route:null}}
    }else{
      if(c.state!=='needs-sweep'&&c.state!=='validated'){process.stderr.write('roadmap arc record-validate: correction must pass review and sweep before PASS\n');return 2}
      try{
        const imported=bridgeImport(join(roadmapRoot(toplevel),'arcs',`${arcId}.arc.ts`),{consumerRoot:toplevel});if(!imported.ok)throw Error('cannot read arc')
        const parsed=bridgeParseShape(toplevel,consumerSchemaPath(toplevel),'ArcShape',imported.parsed);if(!parsed.ok)throw Error('invalid arc')
        const sweep=readDeliveryArtifact(toplevel,arcId,'sweep','SweepReportShape'),panel=readDeliveryArtifact(toplevel,arcId,'verdicts','ArcVerdictsFileShape')
        if(sweep?.correction?.repairHead!==c.repairHead||sweep.correction.validationHead!==c.validationHead||Date.parse(sweep.observation?.recordedAt)<Date.parse(c.readyAt)||Date.parse(panel?.observation?.recordedAt)<Date.parse(sweep.observation?.recordedAt))throw Error('correction sweep or independent panel is stale')
        assertDeliveryJudgments({arc:parsed.parsed,sweep,panel,validation:artifact,head,isCurrentHead:(observed,current)=>evidenceCoversHead(toplevel,observed,current,{arcId})})
        artifact.correction={...c,state:'validated'}
      }catch(error){process.stderr.write('roadmap arc record-validate: '+error.message+'\n');return 2}
    }
  }
  writeValidationCheckpoint(toplevel,arcId,priorRecord,artifact)
  process.stdout.write(JSON.stringify(artifact, null, 2) + '\n')
  return 0
}

export async function arcNormalize(rest, deps = {}) {
  const ids = rest.filter(arg => !arg.startsWith('-'))
  if (ids.length !== 1 || rest.some(arg => arg.startsWith('-') && !['--apply', '--json'].includes(arg)) || new Set(rest).size !== rest.length) {
    process.stderr.write('usage: roadmap arc normalize <arcId> [--apply] [--json]\n')
    return 1
  }
  try {
    const result = normalizeArc(process.cwd(), ids[0], { apply: rest.includes('--apply') }, deps)
    process.stdout.write(JSON.stringify(result, null, rest.includes('--json') ? 0 : 2) + '\n')
    return 0
  } catch (error) {
    if (!(error instanceof HistoryNormalizationError)) throw error
    process.stdout.write(JSON.stringify({ status: 'refused', kind: error.kind, reason: error.message }) + '\n')
    process.stderr.write('roadmap arc normalize: ' + error.message + '\n')
    return error.kind === 'input' ? 1 : 2
  }
}

async function arcPlane(argv,deps){
  const stdout=deps.stdout??(text=>process.stdout.write(text)),stderr=deps.stderr??(text=>process.stderr.write(text))
  const [arcId,planeName,...flags]=argv
  const safe=value=>typeof value==='string'&&/^[^\s/\\\0]+$/.test(value)&&!['.','..'].includes(value)&&!value.startsWith('-')
  if(!safe(arcId)||!(typeof planeName==='string'&&planeName.length>0&&!planeName.includes('\0'))||flags.some(flag=>!['--inline','--json'].includes(flag))||new Set(flags).size!==flags.length){stderr('Usage: roadmap arc plane <arcId> <planeName> [--inline] [--json]\n');return 1}
  const workflow=deps.workflow??(await import('../../workflows/arc-plane.workflow.mjs')).default
  const input={arcId,planeName,...(flags.includes('--inline')?{force:'inline'}:{})}
  const result=await workflow(input)
  const status=result.halt?'halted':result.handoffInline?'phase-required':result.done?'done':result.planeDone?'plane-done':result.handoff?'handoff':'halted'
  const resume=status==='done'?null:`roadmap arc plane ${shellArgument(arcId)} ${shellArgument(planeName)}${flags.includes('--inline')?' --inline':''} --json`
  const output={status,arcId,plane:planeName,phase:result.phase??null,handoff:result.handoff??null,resume}
  if(flags.includes('--json'))stdout(JSON.stringify(output)+'\n');else stderr(`roadmap arc plane ${arcId} ${planeName}: ${status}${output.handoff?` (${output.handoff})`:''}${resume?`; ${resume}`:''}\n`)
  return status==='halted'?2:status==='phase-required'||result.handoff==='awaiting-ci'?3:0
}

export default async function run(argv, deps = {}) {
  const sub = argv[0]
  if (!sub || sub === '--help' || sub === '-h') {
    process.stdout.write('roadmap arc plane <arcId> <planeName> [--inline] [--json]\n')
    process.stdout.write('roadmap arc normalize <arcId> [--apply] [--json]\n')
    process.stdout.write('roadmap arc next <arcId> [--json] [--ignore-capacity]\n')
    process.stdout.write('roadmap arc record-validate <arcId> (--verdict <PASS|GAPS|no-op> [--note <s>] | --correction-ready)\n')
    process.stdout.write('roadmap arc land <arcId> [--push|--no-push|--hold] [--json]\n')
    return sub ? 0 : 1
  }
  const rest = argv.slice(1)
  if (sub === 'plane') return arcPlane(rest, deps)
  if (sub === 'normalize') return arcNormalize(rest, deps)
  if (sub === 'next') return arcNext(rest)
  if (sub === 'record-validate') return recordValidate(rest)
  if (sub === 'land') {
    const { landCommand } = await import('../lib/landing.mjs')
    return landCommand(rest)
  }
  process.stderr.write(`roadmap arc: unknown subcommand '${sub}' (next | plane | normalize | record-validate | land)\n`)
  return 1
}

export function writeValidationCheckpoint(root,arcId,expected,next,{clock=()=>new Date().toISOString()}={}){
 if(typeof arcId!=='string'||!arcId||/[\\/\0]/.test(arcId)||['.','..'].includes(arcId))throw Error('Unsafe validation arc identity')
 const dir=join(roadmapRoot(root),'.gate',`arc-${arcId}`),path=join(dir,'validate.json')
 mkdirSync(dir,{recursive:true})
 return withFileLock(`${path}.lock`,()=>{
  const actual=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):null
  if(!same(actual,expected))throw Error('Validation checkpoint changed; reload before recording')
  if(same(actual,next))return actual
  if(next.correction?.bounds){const writeAt=clock();if(!Number.isFinite(Date.parse(writeAt))||Date.parse(writeAt)>=Date.parse(next.correction.bounds.deadlineAt))throw Error('Correction checkpoint deadline has expired')}
  if(actual?.correction?.bounds&&(!next.correction?.bounds||!same(actual.correction.bounds,next.correction.bounds)||next.correction.round!==actual.correction.round))throw Error('Correction bounds and consumed rounds cannot reset or grow through validation recording')
  if(next.correction?.bounds){const checked=bridgeParseShape(root,consumerSchemaPath(root),'CorrectionCheckpointShape',next);if(!checked.ok)throw Error('Malformed typed correction checkpoint')}
  const temp=`${path}.${randomUUID()}.tmp`
  try{writeFileSync(temp,JSON.stringify(next,null,2)+'\n',{flag:'wx'});renameSync(temp,path)}finally{try{unlinkSync(temp)}catch(error){if(error.code!=='ENOENT')throw error}}
  return next
 },{label:'validation checkpoint'})
}
export function initializeCiCorrection(root,arcId,{headSha,inputKey,bounds}){
 const prior=readValidateVerdict(root,arcId)
 if(prior?.correction?.bounds)return prior
 if(prior?.correction||prior?.verdict==='GAPS')throw Error('Legacy correction usage is unknown; reconcile it before creating a budget')
 if(!prior||!['PASS','no-op'].includes(prior.verdict)||!evidenceCoversHead(root,prior.headSha,headSha,{arcId}))throw Error('A current accepted arc is required before CI correction')
 const next={arcId,verdict:'GAPS',at:new Date().toISOString(),headSha,note:'Bounded repair of exact-head CI failures within existing authority.',correction:{state:'awaiting-repair',validationHead:headSha,gateInputKey:inputKey,round:0,bounds,route:null}}
 return writeValidationCheckpoint(root,arcId,prior,next)
}
