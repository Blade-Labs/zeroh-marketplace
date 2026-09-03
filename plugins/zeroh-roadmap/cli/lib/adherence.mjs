import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
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

function eventsFor(toplevel, phase) {
  const path = join(toplevel, '.building', `${phase}-executor.jsonl`)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

function git(toplevel, args) {
  try { return execFileSync('git', ['-C', toplevel, ...args], { encoding: 'utf8' }).trim() } catch { return '' }
}

function row(id, applicable, passed, evidence) {
  if (!ADHERENCE_CHECK_IDS.includes(id)) throw new Error(`adherence: unknown check id ${id}`)
  return { id, applicable, passed: applicable && passed, evidence }
}

export function scoreAdherence(toplevel, phase) {
  const { value: plan, path } = readPhase(toplevel, phase)
  const report = latestGateReport(toplevel, phase)
  const events = eventsFor(toplevel, phase)
  const modern = String(plan.completedDate ?? plan.created ?? '') >= CONVENTIONS_AT
  const applicable = (id) => modern || id === '__always'
  const taskStarts = events.filter((event) => event.event === 'task-start')
  const executorStart = events.findIndex((event) => event.event === 'executor-start')
  const firstTask = events.findIndex((event) => event.event === 'task-start')
  const log = git(toplevel, ['log', '--format=%s'])
  const tasks = plan.tasks ?? []
  const doneTasks = tasks.filter((task) => task.done)
  const transparencyOk = doneTasks.every((task) => SIX_FIELDS.every((field) => typeof task.transparencyReport?.[field] === 'string'))
  const rounds = plan.gateRounds ?? []
  const mutationProof = (report?.notes ?? []).some((note) => /mutation proof/i.test(note) && /red/i.test(note) && /green/i.test(note))
  const verifyPassed = (report?.notes ?? []).some((note) => /verify-complete passed/i.test(note))
  const selfReviewFree = rounds.some((round) => round.round >= 1 && !/self[- ]?review/i.test(round.agent ?? ''))
  const phaseDiff = git(toplevel, ['diff', '--', path])
  const resumeOrEscalated = events.some((event) => ['resume', 'escalated'].includes(event.event))
  const lessonPaths = [join(roadmapRoot(toplevel), 'arc-evals', 'lessons.jsonl'), join(roadmapRoot(toplevel), 'lessons.jsonl')]
  const lessons = lessonPaths.filter(existsSync).map((lessonPath) => readFileSync(lessonPath, 'utf8')).join('\n')

  const checks = [
    row('tripwires-ran', applicable('tripwires-ran'), executorStart >= 0 && firstTask > executorStart,
      taskStarts.length ? `executor-start index ${executorStart}; first task-start index ${firstTask}` : 'no task-start beacon recorded'),
    row('one-commit-per-task', applicable('one-commit-per-task'), doneTasks.length === tasks.length && doneTasks.every((task) => log.split('\n').some((subject) => subject.includes(`phase ${phase} — ${task.id}`))),
      `${doneTasks.length}/${tasks.length} task(s) done; matching task subjects inspected in git log`),
    row('six-field-transparency-reports', applicable('six-field-transparency-reports'), transparencyOk,
      transparencyOk ? 'all done tasks carry all six fields' : 'one or more done tasks lack a transparency field'),
    row('gate-rounds-carry-model', applicable('gate-rounds-carry-model'), rounds.length > 0 && rounds.every((round) => typeof round.model === 'string' && round.model.length > 0),
      `${rounds.length} phase gate round(s) inspected for model attribution`),
    row('rounds-carry-findings', applicable('rounds-carry-findings'), rounds.length > 0 && rounds.every((round) => Array.isArray(round.findings)),
      `${rounds.length} phase gate round(s) inspected for typed findings arrays`),
    row('guard-mutation-proofs-quoted', applicable('guard-mutation-proofs-quoted'), mutationProof,
      mutationProof ? 'gate notes quote RED/mutated/GREEN mutation evidence' : 'gate notes contain no complete mutation proof'),
    row('curation-evidence', applicable('curation-evidence'), Boolean(report?.curation),
      report?.curation ? 'latest gate report carries curation evidence' : 'latest gate report lacks curation evidence'),
    row('verify-complete-passed', applicable('verify-complete-passed'), verifyPassed,
      verifyPassed ? 'latest gate notes record verify-complete passed' : 'latest gate notes do not record verify-complete'),
    row('no-self-review-round', applicable('no-self-review-round'), selfReviewFree,
      selfReviewFree ? 'at least one independent correctness round is recorded' : 'no independent correctness round is recorded'),
    row('plan-verify-clauses-unchanged', applicable('plan-verify-clauses-unchanged'), !/^\+.*verify:/m.test(phaseDiff) || /verify/i.test(String(plan.limitations ?? '')),
      phaseDiff ? 'working-tree phase diff inspected for unnamed verify-clause rewrites' : 'phase file has no uncommitted verify-clause rewrite'),
    row('lessons-flushed', applicable('lessons-flushed'), !resumeOrEscalated || new RegExp(`"phase"\\s*:\\s*${phase}\\b`).test(lessons),
      resumeOrEscalated ? 'resume/escalated beacon requires a phase-attributed lesson' : 'no resume/escalated beacon created a lesson obligation'),
    row('execution-result-roles-recorded', applicable('execution-result-roles-recorded'), Array.isArray(plan.executionResult?.roles),
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
