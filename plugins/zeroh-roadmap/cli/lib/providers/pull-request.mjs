import { join } from 'node:path'
import { loadArcDelivery, authorizeProviderAction } from '../delivery.mjs'
import { withFileLock } from '../file-lock.mjs'
import { roadmapRoot } from '../roadmap-root.mjs'
const METHOD_KIND = { push: 'push', create: 'create-pr', update: 'update-pr', queue: 'queue', merge: 'merge' }
const nonempty = value => typeof value === 'string' && value.trim().length > 0
const refuse = (actionKey,remedy,observedAt=null) => ({status:'refused',actionKey,kind:'unauthorized',remedy,resumable:false,observedAt:observedAt??new Date().toISOString()})
const hold = (actionKey,kind,remedy,observedAt=null) => ({status:'held',actionKey,kind,remedy,resumable:true,observedAt:observedAt??new Date().toISOString()})
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))
const oid = value => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)
function validResult(result, actionKey, state, action) {
  if (!result || result.actionKey !== actionKey || !timestamp(result.observedAt)) return false
  if (['held','refused'].includes(result.status)) return nonempty(result.kind) && nonempty(result.remedy) && result.resumable === (result.status === 'held')
  if (!['succeeded','unknown','failed'].includes(result.status) || !(result.providerActionId === null || nonempty(result.providerActionId)) || !(result.errorKind === null || nonempty(result.errorKind))) return false
  if (result.status === 'succeeded' && (!nonempty(result.providerActionId) || result.errorKind !== null)) return false
  if (result.pullRequest === null) return true
  const p = result.pullRequest
  const target=state.target
  if (!p || ['providerId','repositoryId','targetKey','baseRef','headRef'].some(key=>p[key]!==target[key]) || p.baseSha!==action.requested.baseSha || p.headSha!==action.requested.headSha) return false
  return p && ['providerId','repositoryId','targetKey','providerPullRequestId','baseRef','headRef'].every(key=>nonempty(p[key])) && (p.number===null || Number.isInteger(p.number)&&p.number>0) && (p.url===null || nonempty(p.url)) && ['open','closed','merged'].includes(p.state) && typeof p.draft==='boolean' && oid(p.baseSha) && oid(p.headSha) && timestamp(p.observedAt)
}
export function createPullRequestProvider({providerId,impl,loadDelivery=loadArcDelivery,withLock:lock=withFileLock}) {
  if (!nonempty(providerId) || !impl || typeof loadDelivery !== 'function' || typeof lock !== 'function') throw new Error('invalid provider factory')
  for (const method of ['capabilities','preflight','lookup',...Object.keys(METHOD_KIND)]) if (typeof impl[method] !== 'function') throw new Error(`provider lacks ${method}`)
  const provider={capabilities:context=>impl.capabilities(context),preflight:request=>impl.preflight(request),lookup:request=>impl.lookup(request)}
  for (const [method,kind] of Object.entries(METHOD_KIND)) provider[method]=request=>{
    const actionKey=request?.action?.actionKey??null,context=request?.context
    if (!context || !nonempty(context.root) || !nonempty(context.ownerArcId) || /[\/\\\0\s]/.test(context.ownerArcId) || ['.','..'].includes(context.ownerArcId)) return refuse(actionKey,'provider requires a safe delivery owner')
    try {
      const lockPath=join(lock===withFileLock?roadmapRoot(context.root):context.root,'.deliveries',`${context.ownerArcId}.json.provider.lock`)
      return lock(lockPath,()=>{
        const state=loadDelivery(context.root,context.ownerArcId),at=state?.updatedAt??null
        if (state?.arcId !== context.ownerArcId) return refuse(actionKey,'delivery owner differs from loaded receipt',at)
        const authorization=authorizeProviderAction(state,request.action,request.expected,{providerId,method,kind})
        if (!authorization.ok) return refuse(actionKey,authorization.reason,at)
        const preflight=impl.preflight({operation:method,context,repositoryId:request.expected.repositoryId,target:state.target,pullRequest:state.pullRequest})
        if (!preflight || !['ready','held','refused'].includes(preflight.status)) return hold(actionKey,'unknown','Provider preflight was not observed; resume after checking connectivity.',at)
        if (preflight.status !== 'ready') return {...preflight,actionKey}
        if (preflight.providerId!==providerId || preflight.repositoryId!==state.target.repositoryId || preflight.operation!==method) return refuse(actionKey,'preflight identity differs from requested operation',at)
        const supported=preflight.capabilities?.supported
        if (preflight.capabilities?.providerId!==providerId || !Array.isArray(preflight.capabilities?.unsupported) || !Array.isArray(supported) || new Set(supported).size!==supported.length || preflight.capabilities.unsupported.some(row=>supported.includes(row.operation)) || !supported.includes(method) || state.requested.requiredCapabilities.some(cap=>!supported.includes(cap))) return hold(actionKey,'unsupported','Provider lacks a required capability; configure a supported delivery mode and resume.',at)
        const current=loadDelivery(context.root,context.ownerArcId)
        const finalAuthorization=authorizeProviderAction(current,request.action,request.expected,{providerId,method,kind,capabilities:preflight.capabilities})
        if (!finalAuthorization.ok) return refuse(actionKey,finalAuthorization.reason,at)
        const result=impl[method]({action:finalAuthorization.action,expected:request.expected,context,state:current,capabilities:preflight.capabilities})
        if (!validResult(result,actionKey,current,finalAuthorization.action)) return hold(actionKey,'unknown','Provider action outcome is unobserved; reconcile before retry.',at)
        return result
      },{label:'delivery provider action'})
    } catch {
      return hold(actionKey,'unavailable','Delivery state or provider is unavailable; inspect the receipt and resume without replaying an unobserved action.')
    }
  }
  return provider
}
