import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { bridgeEval } from './tsx-bridge.mjs'
import { roadmapRoot } from './roadmap-root.mjs'
import { EXPORT_DECLARATION } from '../commands/config.mjs'

export const ADHERENCE_CHECK_IDS = [
  'tripwires-ran',
  'one-commit-per-task',
  'six-field-transparency-reports',
  'gate-rounds-carry-model',
  'rounds-carry-findings',
  'guard-mutation-proofs-quoted',
  'curation-evidence',
  'verify-complete-passed',
  'no-self-review-round',
  'plan-verify-clauses-unchanged',
  'lessons-flushed',
  'execution-result-roles-recorded',
]

const CONVENTIONS_AT = '2026-09-01'
const SIX_FIELDS = ['whatWasDone', 'how', 'compromises', 'skipped', 'hardcoded', 'limitations']

function phasePath(toplevel, phase) {
  return join(roadmapRoot(toplevel), 'phases', `phase-${phase}.phase.ts`)
}

function readPhase(toplevel, phase) {
  const path = phasePath(toplevel, phase)
  const source = readFileSync(path, 'utf8')
  const plain = source.match(new RegExp(`^${EXPORT_DECLARATION.source.replace('(?:const|function|type) (\\w+)', 'default')}\\s+([\\s\\S]*?)\\s*$`))
  if (plain) {
    try { return { value: JSON.parse(plain[1]), source, path } } catch { /* typed source below */ }
  }
  const script = `import('file://' + process.argv[1]).then(m => process.stdout.write(JSON.stringify(m.default?.default ?? m.default)))`
  const imported = bridgeEval(toplevel, script, { args: [path] })
  if (!imported.ok) throw new Error(`adherence: cannot read phase ${phase}: ${imported.stderr || imported.kind}`)
  return { value: JSON.parse(imported.stdout), source, path }
}

function latestGateReport(toplevel, phase) {
  const dir = join(roadmapRoot(toplevel), '.gate', String(phase))
  if (!existsSync(dir)) return null
  const file = readdirSync(dir).filter((name) => /^run-\d+-.*\.json$/.test(name)).sort().at(-1)
  return file ? JSON.parse(readFileSync(join(dir, file), 'utf8')) : null
}

function phaseEval(toplevel, phase) {
  const path = join(roadmapRoot(toplevel), 'arc-evals', `phase-${phase}.peval.json`)
  if (!existsSync(path)) return null
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}

function eventsFor(toplevel, phase) {
  const path = join(toplevel, '.building', `${phase}-executor.jsonl`)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

function git(toplevel, args) {
  try { return execFileSync('git', ['-C', toplevel, ...args], { encoding: 'utf8' }).trim() } catch { return '' }
}

function baselinePhaseSource(toplevel, path, phase) {
  const queueSubject = `docs(roadmap): queue phase ${phase}`
  const queued = git(toplevel, ['log', '--format=%H%x1f%s'])
    .split('\n').map((line) => line.split('\x1f')).find(([, subject]) => subject === queueSubject)?.[0]
  if (queued) return git(toplevel, ['show', `${queued}:${path.slice(toplevel.length + 1)}`])
  const commits = git(toplevel, ['log', '--diff-filter=A', '--format=%H', '--', path]).split('\n').filter(Boolean)
  const first = commits.at(-1)
  return first ? git(toplevel, ['show', `${first}:${path.slice(toplevel.length + 1)}`]) : ''
}

function verifyClauses(source) {
  return source.split('\n').filter((line) => line.includes('verify:')).map((line) => line.trim()).sort()
}

function verifyRewriteKey(clause) {
  return `verify-rewrite:${createHash('sha256').update(clause).digest('hex').slice(0, 12)}`
}

function quotesMutationProof(task) {
  const how = task.transparencyReport?.how ?? ''
  const redDrives = how.match(/[^.;]*(?:→|->)\s*RED\b/gi) ?? []
  const greenDrives = how.match(/[^.;]*(?:→|->)\s*GREEN\b/gi) ?? []
  return redDrives.some((drive) => /remove|plant|mutat|reintroduc/i.test(drive))
    && redDrives.some((drive) => /anchor|rename|move/i.test(drive))
    && greenDrives.some((drive) => /decoy/i.test(drive))
}

function declaresNoGuard(task) {
  return /\bno new (?:shape |conformance )?guard (?:was )?introduced\b/i.test(task.transparencyReport?.how ?? '')
}

function row(id, applicable, passed, evidence) {
  if (!ADHERENCE_CHECK_IDS.includes(id)) throw new Error(`adherence: unknown check id ${id}`)
  return { id, applicable, passed: applicable && passed, evidence }
}

export function scoreAdherence(toplevel, phase) {
  const { value: plan, path } = readPhase(toplevel, phase)
  const report = latestGateReport(toplevel, phase)
  const peval = phaseEval(toplevel, phase)
  const events = eventsFor(toplevel, phase)
  const modern = String(plan.completedDate ?? plan.created ?? '') >= CONVENTIONS_AT
  const taskStarts = events.filter((event) => event.event === 'task-start')
  const executorStart = events.findIndex((event) => event.event === 'executor-start')
  const firstTask = events.findIndex((event) => event.event === 'task-start')
  const log = git(toplevel, ['log', '--format=%s'])
  const tasks = plan.tasks ?? []
  const doneTasks = tasks.filter((task) => task.done)
  const transparencyOk = doneTasks.every((task) => SIX_FIELDS.every((field) => typeof task.transparencyReport?.[field] === 'string'))
  const rounds = plan.gateRounds ?? []
  const mutationProof = doneTasks.every((task) => quotesMutationProof(task) || declaresNoGuard(task))
  const verifyPassed = report
    ? (report.notes ?? []).some((note) => /verify-complete passed/i.test(note))
    : peval?.gate?.verifyComplete === 'passed'
  const selfReviewFree = rounds.some((round) => round.round >= 1 && !/self[- ]?review/i.test(round.agent ?? ''))
  const originalVerifies = verifyClauses(baselinePhaseSource(toplevel, path, phase))
  const currentVerifies = verifyClauses(readFileSync(path, 'utf8'))
  const changedVerifies = [...new Set([...originalVerifies, ...currentVerifies])]
    .filter((clause) => !originalVerifies.includes(clause) || !currentVerifies.includes(clause))
  const verifiesChanged = changedVerifies.length > 0
  const limitations = [plan.limitations, ...tasks.map((task) => task.transparencyReport?.limitations)].filter(Boolean).join('\n')
  const changedVerifyKeys = changedVerifies.map(verifyRewriteKey)
  const verifyRewriteJustified = changedVerifyKeys.every((key) => limitations.includes(key))
  const resumeOrEscalated = events.some((event) => ['resume', 'escalated'].includes(event.event))
  const lessonPaths = [join(roadmapRoot(toplevel), 'arc-evals', 'lessons.jsonl'), join(roadmapRoot(toplevel), 'lessons.jsonl')]
  const lessons = lessonPaths.filter(existsSync).map((lessonPath) => readFileSync(lessonPath, 'utf8')).join('\n')

  const checks = [
    row('tripwires-ran', modern && events.length > 0, executorStart >= 0 && firstTask > executorStart,
      events.length === 0 ? 'beacon absent (checkout-local; land carries it since phase 28)' : taskStarts.length ? `executor-start index ${executorStart}; first task-start index ${firstTask}` : 'no task-start beacon recorded'),
    row('one-commit-per-task', modern, doneTasks.length === tasks.length && doneTasks.every((task) => typeof task.commit === 'string' || log.split('\n').some((subject) => subject.includes(`phase ${phase} — ${task.id}`))),
      `${doneTasks.length}/${tasks.length} task(s) done; matching task subjects inspected in git log`),
    row('six-field-transparency-reports', modern, transparencyOk,
      transparencyOk ? 'all done tasks carry all six fields' : 'one or more done tasks lack a transparency field'),
    row('gate-rounds-carry-model', modern, rounds.length > 0 && rounds.every((round) => typeof round.model === 'string' && round.model.length > 0),
      `${rounds.length} phase gate round(s) inspected for model attribution`),
    row('rounds-carry-findings', modern, rounds.length > 0 && rounds.every((round) => Array.isArray(round.findings)),
      `${rounds.length} phase gate round(s) inspected for typed findings arrays`),
    row('guard-mutation-proofs-quoted', modern, mutationProof,
      mutationProof ? 'every task declares no new guard or quotes planted RED, anchor-drift RED, and decoy GREEN evidence' : 'one or more tasks lack both a no-new-guard declaration and a complete three-drive mutation proof'),
    row('curation-evidence', modern, report ? Boolean(report.curation) : peval?.gate?.curated === true,
      report?.curation ? 'latest gate report carries curation evidence' : peval?.gate?.curated === true && !report ? 'committed peval carries curation evidence' : 'latest gate report lacks curation evidence'),
    row('verify-complete-passed', modern, verifyPassed,
      verifyPassed ? 'latest gate notes record verify-complete passed' : 'latest gate notes do not record verify-complete'),
    row('no-self-review-round', modern, selfReviewFree,
      selfReviewFree ? 'at least one independent correctness round is recorded' : 'no independent correctness round is recorded'),
    row('plan-verify-clauses-unchanged', modern, !verifiesChanged || verifyRewriteJustified,
      verifiesChanged ? `${changedVerifies.length} changed committed verify clause(s) require limitation citations: ${changedVerifyKeys.join(', ')}` : 'committed phase verify clauses match their queue version'),
    row('lessons-flushed', modern, !resumeOrEscalated || new RegExp(`"phase"\\s*:\\s*${phase}\\b`).test(lessons),
      resumeOrEscalated ? 'resume/escalated beacon requires a phase-attributed lesson' : 'no resume/escalated beacon created a lesson obligation'),
    row('execution-result-roles-recorded', modern, Array.isArray(plan.executionResult?.roles),
      Array.isArray(plan.executionResult?.roles) ? `${plan.executionResult.roles.length} role firing(s) recorded` : 'executionResult.roles is absent'),
  ]
  const scored = checks.filter((check) => check.applicable)
  return {
    phase,
    driver: plan.executionResult?.driver ?? null,
    checks,
    score: scored.length ? scored.filter((check) => check.passed).length / scored.length : null,
  }
}
