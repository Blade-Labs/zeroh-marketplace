import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { resolveBranchStrategy } from './branch-strategy.mjs'

const BASE='0'.repeat(40), A_HEAD='1'.repeat(40), B_HEAD='2'.repeat(40), GROUP_HEAD='3'.repeat(40), CHURNED='4'.repeat(40)
const AT='2026-09-07T00:00:00.000Z'
const token=value=>createHash('sha256').update(value,'utf8').digest('hex').slice(0,24)
const arcRef=id=>`refs/heads/roadmap/arc-${token(id)}`
const groupRef=id=>`refs/heads/roadmap/group-${token(id)}`
const basePolicy=strategy=>({providerId:'github',repositoryId:'blade/roadmap',defaultBaseRef:'refs/heads/main',strategy})
const refs=extra=>({heads:{'refs/heads/main':BASE,[arcRef('A')]:A_HEAD,[arcRef('B')]:B_HEAD,[groupRef('release-one')]:GROUP_HEAD,...extra}})
function receipt({ownerArcId='A',target,strategy}){
 return {ownerArcId,delivery:{schemaVersion:1,revision:0,arcId:ownerArcId,deliveryKey:JSON.stringify([target.providerId,target.repositoryId,target.targetKey]),target,strategy,requested:{terminal:'open',allowedPushRefs:[target.headRef],requiredCapabilities:['pull-request'],requiredChecks:['unit'],authority:{queue:null,merge:null}},actions:[],pullRequest:null,checks:null,terminal:{status:'preparing',headSha:target.currentHeadSha,reason:null},createdAt:AT,updatedAt:AT}}
}
const independentTarget=(id,headSha)=>({targetKey:JSON.stringify(['arc',id]),providerId:'github',repositoryId:'blade/roadmap',baseRef:'refs/heads/main',headRef:arcRef(id),currentBaseSha:BASE,currentHeadSha:headSha})
const resolve=({id='A',arc={},strategy,deliveries=[],refSet=refs()})=>resolveBranchStrategy({arc:{id,baseRef:'local-only',...arc},policy:basePolicy(strategy),deliveries,refs:refSet})

test('independent target uses publication policy, separate from local ancestry',()=>{
 assert.deepEqual(resolve({strategy:{A:{kind:'independent'}}}),{status:'ready',ownerArcId:'A',memberArcId:'A',memberOrder:null,target:independentTarget('A',A_HEAD),strategy:{kind:'independent',arcId:'A'},existing:null})
})
test('independent arcs never share a target or head ref',()=>{
 const strategy={A:{kind:'independent'},B:{kind:'independent'}},a=resolve({id:'A',strategy}),b=resolve({id:'B',strategy})
 assert.notEqual(a.target.targetKey,b.target.targetKey);assert.notEqual(a.target.headRef,b.target.headRef)
})
test('stack uses explicit predecessor head while retaining its own PR target',()=>{
 const target=independentTarget('A',A_HEAD),predecessor=receipt({target,strategy:{kind:'independent',arcId:'A'}})
 const result=resolve({id:'B',strategy:{A:{kind:'independent'},B:{kind:'stacked',predecessorArcId:'A'}},deliveries:[predecessor]})
 assert.equal(result.status,'ready');assert.equal(result.ownerArcId,'B');assert.equal(result.target.targetKey,JSON.stringify(['arc','B']));assert.equal(result.target.headRef,arcRef('B'));assert.equal(result.target.currentHeadSha,B_HEAD);assert.equal(result.target.baseRef,target.headRef);assert.equal(result.target.currentBaseSha,A_HEAD)
 assert.deepEqual(result.strategy,{kind:'stacked',arcId:'B',predecessorDeliveryKey:predecessor.delivery.deliveryKey,predecessorTargetKey:target.targetKey})
})
test('explicit multi-member group has one target and order-zero receipt owner',()=>{
 const strategy={A:{kind:'grouped',groupId:'release-one',order:0},B:{kind:'grouped',groupId:'release-one',order:1}},owner=resolve({strategy}),member=resolve({id:'B',strategy})
 assert.equal(owner.status,'ready');assert.equal(member.status,'ready');assert.equal(owner.ownerArcId,'A');assert.equal(member.ownerArcId,'A');assert.equal(owner.memberOrder,0);assert.equal(member.memberOrder,1);assert.deepEqual(member.target,owner.target);assert.equal(owner.target.targetKey,JSON.stringify(['group','release-one']));assert.equal(owner.target.headRef,groupRef('release-one'));assert.equal(owner.target.currentHeadSha,GROUP_HEAD);assert.deepEqual(owner.strategy,{kind:'grouped',groupId:'release-one',order:0});assert.deepEqual(member.strategy,owner.strategy)
 const existing=receipt({target:owner.target,strategy:owner.strategy});assert.deepEqual(resolve({id:'B',strategy,deliveries:[existing]}).existing,existing.delivery)
})
test('malformed graphs refuse and missing refs hold before publication',()=>{
 const cases=[['missing entry',{A:{kind:'independent'}},'B'],['self',{A:{kind:'stacked',predecessorArcId:'A'}},'A'],['cycle',{A:{kind:'stacked',predecessorArcId:'B'},B:{kind:'stacked',predecessorArcId:'A'}},'A'],['missing predecessor',{B:{kind:'stacked',predecessorArcId:'A'}},'B'],['single group',{A:{kind:'grouped',groupId:'release-one',order:0}},'A'],['duplicate order',{A:{kind:'grouped',groupId:'release-one',order:0},B:{kind:'grouped',groupId:'release-one',order:0}},'A'],['gap',{A:{kind:'grouped',groupId:'release-one',order:0},B:{kind:'grouped',groupId:'release-one',order:2}},'A']]
 for(const [label,strategy,id] of cases)assert.throws(()=>resolve({id,strategy}),/strategy|cycle|predecessor|group|order|policy/i,label)
 for(const key of [arcRef('A'),'refs/heads/main']){const refSet=refs();delete refSet.heads[key];const held=resolve({strategy:{A:{kind:'independent'}},refSet});assert.equal(held.status,'held');assert.equal(held.reason,'missing-ref')}
})
test('stack holds absent predecessor and refuses grouped predecessor receipt',()=>{
 const strategy={A:{kind:'independent'},B:{kind:'stacked',predecessorArcId:'A'}},missing=resolve({id:'B',strategy})
 assert.equal(missing.status,'held');assert.equal(missing.reason,'missing-predecessor')
 const target={...independentTarget('A',GROUP_HEAD),targetKey:JSON.stringify(['group','release-one']),headRef:groupRef('release-one')},grouped=receipt({target,strategy:{kind:'grouped',groupId:'release-one',order:0}})
 assert.throws(()=>resolve({id:'B',strategy,deliveries:[grouped]}),/group|predecessor|stack|strategy/i)
})
test('persisted target or commit churn holds without silent retargeting',()=>{
 const expected=independentTarget('A',A_HEAD)
 for(const [reason,observed] of [['head-churn',{...expected,currentHeadSha:CHURNED}],['base-churn',{...expected,currentBaseSha:CHURNED}],['target-drift',{...expected,headRef:'refs/heads/other'}],['target-drift',{...expected,repositoryId:'blade/other'}]]){
  const existing=receipt({target:observed,strategy:{kind:'independent',arcId:'A'}}),before=structuredClone(existing),result=resolve({strategy:{A:{kind:'independent'}},deliveries:[existing]})
  assert.equal(result.status,'held');assert.equal(result.ownerArcId,'A');assert.equal(result.memberArcId,'A');assert.deepEqual(result.expected,expected);assert.deepEqual(result.observed,observed);assert.equal(result.reason,reason);assert.deepEqual(existing,before)
 }
})
test('mixed or duplicate receipt owners refuse',()=>{
 const one=receipt({target:independentTarget('A',A_HEAD),strategy:{kind:'independent',arcId:'A'}}),strategy={A:{kind:'independent'}}
 assert.throws(()=>resolve({strategy,deliveries:[one,structuredClone(one)]}),/duplicate|multiple|receipt/i)
 assert.throws(()=>resolve({strategy,deliveries:[{...one,ownerArcId:'B'}]}),/owner|mixed|receipt|arc/i)
})
test('unusual arc and group identifiers produce safe deterministic refs',()=>{
 const id='Release / α / .. / spaces',groupId='Group / β / .. / spaces',refSet=refs({[arcRef(id)]:A_HEAD,[groupRef(groupId)]:GROUP_HEAD})
 const independent=resolve({id,strategy:{[id]:{kind:'independent'}},refSet});assert.equal(independent.status,'ready');assert.equal(independent.target.headRef,arcRef(id));assert.match(independent.target.headRef,/^refs\/heads\/roadmap\/arc-[a-f0-9]{24}$/)
 const member=resolve({id:'peer',strategy:{[id]:{kind:'grouped',groupId,order:0},peer:{kind:'grouped',groupId,order:1}},refSet});assert.equal(member.status,'ready');assert.equal(member.target.headRef,groupRef(groupId));assert.match(member.target.headRef,/^refs\/heads\/roadmap\/group-[a-f0-9]{24}$/)
})
test('stack resumes after explicit predecessor and current base bindings reconcile',()=>{
 const strategy={A:{kind:'independent'},B:{kind:'stacked',predecessorArcId:'A'}},pred=receipt({target:independentTarget('A',A_HEAD),strategy:{kind:'independent',arcId:'A'}})
 const first=resolve({id:'B',strategy,deliveries:[pred]}),own=receipt({ownerArcId:'B',target:first.target,strategy:first.strategy})
 const updated=structuredClone(pred);updated.delivery.target.currentHeadSha=CHURNED;updated.delivery.terminal.headSha=CHURNED
 const refSet=refs({[arcRef('A')]:CHURNED}),held=resolve({id:'B',strategy,deliveries:[updated,own],refSet});assert.equal(held.status,'held');assert.equal(held.reason,'base-churn')
 const reconciled=structuredClone(own);reconciled.delivery.target.currentBaseSha=CHURNED
 const resumed=resolve({id:'B',strategy,deliveries:[updated,reconciled],refSet});assert.equal(resumed.status,'ready');assert.equal(resumed.target.currentBaseSha,CHURNED)
})

test('stacked predecessor cannot redirect the base through an unrelated target or dependency',()=>{
 const strategy={A:{kind:'independent'},B:{kind:'stacked',predecessorArcId:'A'},C:{kind:'stacked',predecessorArcId:'B'}},refSet=refs({[arcRef('C')]:'5'.repeat(40)})
 const a=receipt({target:independentTarget('A',A_HEAD),strategy:{kind:'independent',arcId:'A'}})
 const bResult=resolve({id:'B',strategy,deliveries:[a],refSet}),b=receipt({ownerArcId:'B',target:bResult.target,strategy:bResult.strategy})
 assert.equal(resolve({id:'C',strategy,deliveries:[a,b],refSet}).status,'ready')
 for(const field of ['predecessorTargetKey','predecessorDeliveryKey']){
  const wrong=structuredClone(b);wrong.delivery.strategy[field]='unrelated'
  assert.throws(()=>resolve({id:'C',strategy,deliveries:[a,wrong],refSet}),/predecessor|strategy|identity/i)
 }
 const redirected=structuredClone(a);redirected.delivery.target.headRef=arcRef('B')
 assert.throws(()=>resolve({id:'B',strategy,deliveries:[redirected],refSet}),/predecessor|identity/i)
})
test('grouping refuses an existing separate receipt belonging to a nonowner member',()=>{
 const strategy={A:{kind:'grouped',groupId:'release-one',order:0},B:{kind:'grouped',groupId:'release-one',order:1}},foreign=receipt({ownerArcId:'B',target:independentTarget('B',B_HEAD),strategy:{kind:'independent',arcId:'B'}})
 assert.throws(()=>resolve({strategy,deliveries:[foreign]}),/group|nonowner|mixed/i)
})
