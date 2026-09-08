import {z} from 'zod'

const text=z.string().min(1),sha=z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
const time=z.string().refine(v=>Number.isFinite(Date.parse(v)),'requires a timestamp')
const unique=values=>new Set(values).size===values.length
const queue=z.object({entryId:text,sourceHeadSha:sha,mergeHeadSha:sha}).strict()
const identity={providerId:text,repositoryId:z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),providerPullRequestId:text,sourceHeadSha:sha,baseSha:sha,requiredChecks:z.array(text).min(1).refine(unique,'duplicate required checks'),headMode:z.enum(['source','merge-queue']),mergeQueue:queue.nullable()}
function headIssues(value,ctx){
 if(value.headMode==='source'&&value.mergeQueue!==null)ctx.addIssue({code:'custom',message:'source mode cannot borrow a merge queue head'})
 if(value.headMode==='merge-queue'&&(!value.mergeQueue||value.mergeQueue.sourceHeadSha!==value.sourceHeadSha))ctx.addIssue({code:'custom',message:'merge queue must bind current source head'})
}
export const CiRequestShape=z.object(identity).strict().superRefine(headIssues)
export const assertCiRequest=value=>CiRequestShape.parse(value)
const AttemptShape=z.object({attemptId:text,suiteId:text.nullable(),runNumber:z.number().int().positive().nullable(),runAttempt:z.number().int().positive().nullable(),status:text,conclusion:text.nullable(),startedAt:time.nullable(),completedAt:time.nullable(),detailsUrl:text.nullable(),logRefs:z.array(text),artifactRefs:z.array(text)}).strict()
export function ciAttemptVerdict(attempt,source){
 if(source==='commit-status')return ({pending:'pending',success:'green',failure:'red',error:'red'})[attempt.status]??'held'
 if(['queued','in_progress','waiting','pending','requested'].includes(attempt.status))return 'pending'
 if(attempt.status!=='completed')return 'held'
 if(['success','neutral','skipped'].includes(attempt.conclusion))return 'green'
 if(['failure','timed_out','cancelled','action_required','startup_failure','stale'].includes(attempt.conclusion))return 'red'
 return 'held'
}
export function latestCiAttempt(attempts){
 const ranked=attempts.map(attempt=>({attempt,at:Date.parse(attempt.startedAt??attempt.completedAt)}))
 if(ranked.some(row=>!Number.isFinite(row.at)))throw Error('attempt ordering is unobserved')
 const latest=Math.max(...ranked.map(row=>row.at)),matches=ranked.filter(row=>row.at===latest)
 if(matches.length!==1)throw Error('ambiguous latest attempt')
 return matches[0].attempt
}
export const CiCheckShape=z.object({key:text,name:text,source:z.enum(['check-run','commit-status']),appId:z.number().int().positive().nullable(),verdict:z.enum(['pending','green','red','held']),latestAttemptId:text.nullable(),attempts:z.array(AttemptShape).min(1)}).strict().superRefine((value,ctx)=>{
 const expected=value.source==='check-run'?`check-run:${value.appId}:${value.name}`:`commit-status:${value.name}`
 if(value.key!==expected||(value.source==='check-run')!==(value.appId!==null))ctx.addIssue({code:'custom',message:'check identity differs from source/app/name'})
 if(!unique(value.attempts.map(a=>a.attemptId)))ctx.addIssue({code:'custom',message:'duplicate attempt identities'})
 let ordered;try{ordered=latestCiAttempt(value.attempts)}catch(error){ctx.addIssue({code:'custom',message:error.message})}
 if(ordered&&ordered.attemptId!==value.latestAttemptId)ctx.addIssue({code:'custom',message:'selected latest attempt is stale'})
 const latest=value.attempts.find(a=>a.attemptId===value.latestAttemptId)
 if(!latest||ciAttemptVerdict(latest,value.source)!==value.verdict)ctx.addIssue({code:'custom',message:'verdict must match its observed latest attempt'})
 for(const a of value.attempts)if(a.startedAt&&a.completedAt&&Date.parse(a.completedAt)<Date.parse(a.startedAt))ctx.addIssue({code:'custom',message:'attempt finishes before it starts'})
})
function selectChecks(required,checks){
 const selected=[]
 for(const name of required){
  const matches=checks.filter(c=>c.key===name||c.name===name)
  if(matches.length>1)return {selected:checks,hold:{kind:'ambiguous-check',remedy:`Configure an explicit app/source key for ${name}.`}}
  if(matches.length===0)return {selected:checks,hold:{kind:'missing-check',remedy:`Wait for required check ${name} on the current commit.`}}
  if(selected.some(c=>c.key===matches[0].key))return {selected:checks,hold:{kind:'ambiguous-check',remedy:'Required names resolve to the same check; configure one stable identity each.'}}
  selected.push(matches[0])
 }
 return {selected,hold:null}
}
function rollup(checks,hold){
 if(hold)return hold.kind==='missing-check'?'pending':'held'
 if(checks.some(c=>c.verdict==='held'))return 'held'
 if(checks.some(c=>c.verdict==='red'))return 'red'
 if(checks.some(c=>c.verdict==='pending'))return 'pending'
 return 'green'
}
export const ExactHeadCiResultShape=z.object({schemaVersion:z.literal(1),...identity,testedHeadSha:sha,checks:z.array(CiCheckShape),rollup:z.enum(['pending','green','red','held']),observedAt:time,hold:z.object({kind:text,remedy:text}).strict().nullable()}).strict().superRefine((v,ctx)=>{
 headIssues(v,ctx)
 if(v.testedHeadSha!==(v.headMode==='source'?v.sourceHeadSha:v.mergeQueue?.mergeHeadSha))ctx.addIssue({code:'custom',message:'tested head differs from exact source/queue binding'})
 if(!unique(v.checks.map(c=>c.key)))ctx.addIssue({code:'custom',message:'duplicate check identities'})
 const selection=selectChecks(v.requiredChecks,v.checks)
 if(v.rollup==='green'&&(selection.hold||selection.selected.length!==v.checks.length))ctx.addIssue({code:'custom',message:'green requires exactly all configured checks'})
 if(v.rollup!==rollup(v.checks,v.hold??selection.hold))ctx.addIssue({code:'custom',message:'rollup differs from current check evidence'})
 if(v.rollup==='held'&&!v.hold)ctx.addIssue({code:'custom',message:'held observation requires a remedy'})
})
export function finalizeCiObservation(request,{checks=[],hold=null,observedAt}){
 const input=assertCiRequest(request),parsed=checks.map(c=>CiCheckShape.parse(c))
 const selection=selectChecks(input.requiredChecks,parsed)
 const selected=selection.selected.sort((a,b)=>a.key.localeCompare(b.key))
 const reason=hold??selection.hold??(selected.some(c=>c.verdict==='held')?{kind:'unknown-state',remedy:'A provider check state is unknown; inspect it and resume.'}:null)
 return ExactHeadCiResultShape.parse({schemaVersion:1,...input,requiredChecks:[...input.requiredChecks].sort(),testedHeadSha:input.headMode==='source'?input.sourceHeadSha:input.mergeQueue.mergeHeadSha,checks:selected,rollup:rollup(selected,reason),observedAt,hold:reason})
}
