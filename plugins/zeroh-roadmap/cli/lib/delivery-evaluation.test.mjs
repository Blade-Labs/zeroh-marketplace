import {test} from 'node:test'
import assert from 'node:assert/strict'
import {buildDeliverySummary,assertDeliverySummary,evidenceCoversHead} from './delivery-evaluation.mjs'
import {deliveryKeyOf} from './delivery.mjs'
const HEAD='1'.repeat(40),BASE='0'.repeat(40),AT='2026-09-08T02:00:00.000Z'
function fixture(){
 const target={targetKey:'target',providerId:'github',repositoryId:'blade/repo',baseRef:'main',headRef:'feat/arc',currentBaseSha:BASE,currentHeadSha:HEAD}
 const pr={providerId:'github',repositoryId:'blade/repo',targetKey:'target',providerPullRequestId:'PR_1',number:1,url:'https://github.test/blade/repo/pull/1',state:'open',draft:false,baseRef:'main',headRef:'feat/arc',baseSha:BASE,headSha:HEAD,observedAt:AT}
 const delivery={schemaVersion:1,revision:4,arcId:'ARC',deliveryKey:deliveryKeyOf(target),target,strategy:{kind:'independent',arcId:'ARC'},requested:{terminal:'open',allowedPushRefs:['feat/arc'],requiredCapabilities:['pull-request'],requiredChecks:['unit'],authority:{queue:null,merge:null}},actions:[],pullRequest:pr,checks:{providerId:'github',repositoryId:'blade/repo',providerPullRequestId:'PR_1',headSha:HEAD,requiredChecks:['unit'],observedChecks:[{name:'unit',status:'green',attemptId:'1',observedAt:AT}],observedAt:AT},terminal:{status:'open-green',headSha:HEAD,checksObservedAt:AT},createdAt:AT,updatedAt:AT}
 const arc={id:'ARC',acceptanceCriteria:[{id:'working-prototype',tier:'wired'}]}
 const sweep={arcId:'ARC',overall:'green',blockers:[],debtDispositions:[],observation:{headSha:HEAD,recordedAt:AT}}
 const validation={arcId:'ARC',verdict:'PASS',at:AT,headSha:HEAD}
 const panel={arcId:'ARC',judgeModel:'independent judge',verdicts:[{criterionId:'working-prototype',status:'met',tierUsed:'wired',evidence:'Observed a runnable prototype'}],observation:{headSha:HEAD,recordedAt:AT}}
 return {delivery,arc,sweep,validation,panel}
}
test('exact PR green and current sweep/intent produce an evaluation summary without local landing facts',()=>{
 const f=fixture(),summary=buildDeliverySummary(f)
 assert.equal(summary.outcome,'shipped');assert.equal(summary.delivery.providerPullRequestId,'PR_1');assert.equal(summary.delivery.sourceHeadSha,HEAD);assert.equal(summary.delivery.testedHeadSha,HEAD);assert.equal(summary.delivery.revision,4)
 assert.equal(summary.gateSignals.fullSuiteGreen,true);assert.ok(summary.receiptRef.includes('ARC'));assert.equal(summary.landedAt,undefined);assert.equal(summary.landSha,undefined)
 assert.doesNotThrow(()=>assertDeliverySummary(summary,f.delivery))
})
test('missing, stale, split or incomplete acceptance never creates a shipped summary',()=>{
 const changes=[f=>f.delivery.checks.observedChecks[0].status='red',f=>f.delivery.checks.headSha=BASE,f=>f.delivery.pullRequest.draft=true,f=>f.sweep.overall='blocked',f=>f.sweep.observation.headSha=BASE,f=>f.validation.verdict='GAPS',f=>f.validation.headSha=BASE,f=>f.panel=null,f=>f.panel.observation.headSha=BASE,f=>f.panel.verdicts=[],f=>f.panel.verdicts.push({...f.panel.verdicts[0],status:'gap'}),f=>f.panel.verdicts[0].tierUsed='live-ui',f=>f.panel.verdicts[0].evidence=[],f=>f.panel.verdicts[0].evidence=['noncanonical'],f=>f.panel.verdicts[0].evidence='',f=>f.panel.verdicts[0].evidence='   ']
 for(const change of changes){const f=fixture();change(f);assert.throws(()=>buildDeliverySummary(f))}
})
test('head, PR, revision and check-time churn invalidate an existing delivery summary',()=>{
 const f=fixture(),summary=buildDeliverySummary(f)
 for(const change of [s=>s.delivery.sourceHeadSha=BASE,s=>s.delivery.providerPullRequestId='PR_2',s=>s.delivery.revision++,s=>s.delivery.checksObservedAt='2026-09-08T02:01:00.000Z',s=>delete s.delivery]){const bad=structuredClone(summary);change(bad);assert.throws(()=>assertDeliverySummary(bad,f.delivery))}
 assert.throws(()=>assertDeliverySummary({...summary,landedAt:AT},f.delivery))
})

test('reverted product edits in an evidence tail still invalidate an earlier judgment',async()=>{
 const {mkdtempSync,writeFileSync,rmSync,mkdirSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{execFileSync}=await import('node:child_process')
 const root=mkdtempSync(join(tmpdir(),'zr-evidence-tail-')),git=args=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
 try{
  git(['init','-q']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.test']);writeFileSync(join(root,'app.mjs'),'one');git(['add','.']);git(['commit','-qm','observed']);const observed=git(['rev-parse','HEAD'])
  writeFileSync(join(root,'app.mjs'),'two');git(['add','.']);git(['commit','-qm','unreviewed product change'])
  writeFileSync(join(root,'app.mjs'),'one');git(['add','.']);git(['commit','-qm','revert product change'])
  assert.equal(evidenceCoversHead(root,observed,git(['rev-parse','HEAD']),{arcId:'ARC'}),false)
 }finally{rmSync(root,{recursive:true,force:true})}
})
