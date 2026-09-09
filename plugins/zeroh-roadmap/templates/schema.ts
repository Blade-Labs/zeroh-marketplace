/** New-roadmap records. Existing consumers keep their vendored schema until an
 * explicit upgrade; this is not a parser or migration for historical formats.
 * These checks establish consistency, not that a review or owner consent occurred. */
import { z } from 'zod'

const text = z.string().trim().min(1)
const phaseNumber = z.number().int().positive()
const id = z.union([text, phaseNumber])
const taskStatus = z.enum(['pending', 'in-progress', 'blocked', 'done'])
const openStatus = z.enum(['backlog', 'in-progress', 'blocked', 'executing', 'swept'])
const review = z.object({ reviewer: text, summary: text }).strict()
const finding = z.object({ reviewer: text, summary: text, resolved: z.boolean() }).strict()
const check = z.object({
  command: text, exitCode: z.number().int().nonnegative().nullable(), summary: text,
  required: z.boolean().default(true),
}).strict()
const intentRef = text.refine(value => {
  const match = /^(?:[a-f0-9]{40}|[a-f0-9]{64}):(.+\.arc\.ts)$/.exec(value)
  return !!match && !match[1].startsWith('/') && !match[1].includes('\\') &&
    match[1].split('/').every(part => part !== '..' && part !== '.' && part.length > 0)
}, 'intentRef must be a full Git commit SHA:repository-relative.arc.ts path without traversal')

function unique(values: (string | number)[], label: string, ctx: z.RefinementCtx) {
  if (new Set(values.map(String)).size !== values.length)
    ctx.addIssue({ code: 'custom', message: `Duplicate ${label}` })
}

const progress = {
  checks: z.array(check).default([]),
  findings: z.array(finding).default([]),
  independentReview: review.optional(),
  limitations: z.array(text).default([]),
}
// Required fields are encoded in the input type, not hidden in runtime refinements.
const doneProgress = {
  independentReview: review,
  findings: z.array(finding.extend({ resolved: z.literal(true) })).default([]),
}
const passingCheck = z.union([
  check.extend({ exitCode: z.literal(0), required: z.literal(true).default(true) }),
  check.extend({ required: z.literal(false) }),
])
const checkedCompletion = { checks: z.tuple([passingCheck]).rest(passingCheck), checksNotApplicable: z.never().optional() }
const manualCompletion = { checks: z.tuple([]), checksNotApplicable: text }
function completed(record: { status: string; checks: z.infer<typeof check>[]; checksNotApplicable?: string }, ctx: z.RefinementCtx) {
  if (record.status === 'done' && !record.checksNotApplicable && !record.checks.some(c => c.required))
    ctx.addIssue({ code: 'custom', message: 'Done requires a successful required check or an explicit checksNotApplicable reason' })
}
const task = z.object({ id: text, description: text, status: taskStatus.default('pending') }).strict()

const PhaseBase = z.object({
  schemaVersion: z.literal(1).default(1),
  phase: phaseNumber, name: text, status: openStatus.default('backlog'),
  arcId: id.optional(), intent: text.optional(),
  dependsOn: z.array(phaseNumber).default([]),
  criteria: z.array(text).default([]),
  tasks: z.array(task).min(1),
  ...progress,
}).strict()
const DonePhase = PhaseBase.extend({ status: z.literal('done'), ...doneProgress, tasks: z.tuple([task.extend({ status: z.literal('done') })]).rest(task.extend({ status: z.literal('done') })) })
export const PhaseShape = z.union([
  PhaseBase, DonePhase.extend(checkedCompletion), DonePhase.extend(manualCompletion),
]).superRefine((record, ctx) => {
  unique(record.tasks.map(t => t.id), 'task IDs', ctx)
  unique(record.criteria, 'phase criteria', ctx)
  unique(record.dependsOn, 'dependencies', ctx)
  if (record.dependsOn.includes(record.phase)) ctx.addIssue({ code: 'custom', message: 'Phase depends on itself' })
  completed(record, ctx)
})
export type Phase = z.infer<typeof PhaseShape>
export function definePhase(input: z.input<typeof PhaseShape>): Phase { return PhaseShape.parse(input) }

const ArcBase = z.object({
  schemaVersion: z.literal(1).default(1), id, name: text,
  status: openStatus.default('backlog'), intent: text,
  scope: z.array(text).min(1), nonGoals: z.array(text).default([]),
  assumptions: z.array(z.object({ claim: text, check: text, onFalse: z.enum(['replan', 'ask']) }).strict()).default([]),
  acceptanceCriteria: z.array(z.object({ id: text, description: text }).strict()).min(1),
  intentRef: intentRef.optional(),
  criteriaRatifications: z.array(z.object({
    criterionId: text, previousDescription: text.optional(), description: text.nullable(),
    reason: text, approvedBy: text, approvedAt: z.iso.datetime(),
  }).strict()).default([]),
  phases: z.array(phaseNumber).default([]),
  planning: z.object({ mode: z.literal('rolling'), windowSize: z.number().int().min(1).max(3).default(2), deferredCriteria: z.array(text) }).strict().optional(),
  acceptanceResults: z.array(z.object({ criterionId: text, accepted: z.boolean(), summary: text }).strict()).default([]),
  ...progress,
}).strict()
const DoneArc = ArcBase.extend({
  status: z.literal('done'), ...doneProgress, intentRef,
  phases: z.tuple([phaseNumber]).rest(phaseNumber),
  acceptanceResults: z.tuple([z.object({ criterionId: text, accepted: z.literal(true), summary: text }).strict()]).rest(z.object({ criterionId: text, accepted: z.literal(true), summary: text }).strict()),
})
export const ArcShape = z.union([
  ArcBase, DoneArc.extend(checkedCompletion), DoneArc.extend(manualCompletion),
]).superRefine((record, ctx) => {
  const criteria = record.acceptanceCriteria.map(c => c.id)
  unique(criteria, 'acceptance criteria', ctx)
  unique(record.phases, 'member phases', ctx)
  unique(record.acceptanceResults.map(r => r.criterionId), 'acceptance results', ctx)
  const deferred = record.planning?.deferredCriteria ?? []
  unique(deferred, 'deferred criteria', ctx)
  for (const criterion of [...deferred, ...record.acceptanceResults.map(r => r.criterionId)])
    if (!criteria.includes(criterion)) ctx.addIssue({ code: 'custom', message: `Unknown criterion ${criterion}` })
  completed(record, ctx)
  if (record.status === 'done') {
    if (deferred.length) ctx.addIssue({ code: 'custom', message: 'Done cannot contain deferred criteria' })
    if (!record.phases.length) ctx.addIssue({ code: 'custom', message: 'Done requires member phases' })
    for (const criterion of criteria)
      if (!record.acceptanceResults.some(r => r.criterionId === criterion && r.accepted))
        ctx.addIssue({ code: 'custom', message: `Done requires acceptance result for ${criterion}` })
  }
})
export type Arc = z.infer<typeof ArcShape>
export function defineArc(input: z.input<typeof ArcShape>): Arc { return ArcShape.parse(input) }

const backlogItem = z.object({ phase: phaseNumber, name: text }).strict()
export const BacklogShape = z.array(backlogItem).superRefine((items, ctx) => unique(items.map(i => i.phase), 'backlog phases', ctx))
export function defineBacklog(input: z.input<typeof BacklogShape>) { return BacklogShape.parse(input) }
