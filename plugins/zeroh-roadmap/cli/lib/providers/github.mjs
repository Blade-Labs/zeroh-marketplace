import { defaultExec } from '../exec.mjs'
import { createPullRequestProvider } from './pull-request.mjs'
import { loadPublishedCorrectionReceipt } from '../history-normalize.mjs'

const OPERATIONS=['lookup','push','create','update','queue','merge','pull-request']
import { isDeliverySha } from '../delivery.mjs'
const REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
export const deliveryMarker=key=>`<!-- zeroh-roadmap-delivery:v1:${Buffer.from(key,'utf8').toString('base64url')} -->`
function failureKind(output) {
  const text=`${output.stderr??''} ${output.stdout??''}`
  if (/ENOENT|not found|not installed/i.test(text)) return 'missing-tool'
  if (/429|rate.limit|quota|secondary rate/i.test(text)) return 'quota'
  if (/401|bad credentials|not logged|authentication/i.test(text)) return 'auth'
  if (/403|permission|not accessible|forbidden/i.test(text)) return 'permission'
  if (/unknown command|unknown field|unsupported|not supported|could not resolve.*field/i.test(text)) return 'unsupported'
  return 'unknown'
}
function repositoryFromUrl(url) {
  const match=/^(?:git@github\.com:|https:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([^\s?#]+?)(?:\.git)?\/?$/.exec(url.trim())
  return match?.[1]??null
}
export function createGitHubPullRequestProvider({execFile=defaultExec,git='git',clock=()=>new Date().toISOString(),loadDelivery,withLock,loadNormalizationReceipt=loadPublishedCorrectionReceipt}={}) {
  const hold=(kind,operation,remedy)=>({status:'held',kind,operation,remedy,resumable:true,observedAt:clock()})
  const run=(file,args,context)=>{
    try { return execFile(file,args,{cwd:context.cwd??context.root,timeout:120000,maxBuffer:16*1024*1024}) }
    catch (error) { return {status:1,stdout:'',stderr:String(error.code??error.message??'provider invocation unavailable')} }
  }
  const checked=(file,args,context,operation)=>{
    const out=run(file,args,context)
    if (out?.status!==0) return {error:hold(failureKind(out??{}),operation,'Check tool installation, credentials, repository access or quota, then resume.')}
    return {value:out.stdout}
  }
  const json=(args,context,operation)=>{
    const result=checked('gh',args,context,operation)
    if (result.error) return result
    try {const value=JSON.parse(result.value);if(value?.errors?.length)return {error:hold(failureKind({stdout:JSON.stringify(value.errors)}),operation,'GitHub rejected the request; inspect access and resume.')};return {value}}
    catch {return {error:hold('unknown',operation,'GitHub returned incomplete JSON; reconcile the operation before retry.')}}
  }
  const remote=(context,repositoryId,operation)=>{
    if (!REPO.test(repositoryId) || typeof context?.remote!=='string' || !context.remote || context.remote.includes('\0')) return {error:hold('repository',operation,'Configure one GitHub owner/repository and a Git remote.')}
    const result=checked(git,['remote','get-url','--',context.remote],context,operation)
    if(result.error)return result
    if(repositoryFromUrl(result.value)?.toLowerCase()!==repositoryId.toLowerCase())return {error:hold('repository',operation,'Configured Git remote differs from the requested repository; reconcile it before resume.')}
    const pushUrl=checked(git,['remote','get-url','--push','--',context.remote],context,operation)
    if(pushUrl.error)return pushUrl
    if(repositoryFromUrl(pushUrl.value)?.toLowerCase()!==repositoryId.toLowerCase())return {error:hold('repository',operation,'Git push destination differs from delivery repository; reconcile remote configuration before resume.')}
    return result
  }
  const label=(ref,context,repositoryId,sha)=>{
    let full=ref
    if(typeof ref!=='string'||!ref||/[\s\0~^:?*\[\\]/.test(ref)||ref.includes('..')||ref.includes('@{'))return {error:hold('target-drift','lookup','Delivery ref is not an unambiguous branch.')}
    if(!full.startsWith('refs/')){
      const resolved=checked(git,['rev-parse','--symbolic-full-name','--verify',ref],context,'lookup');if(resolved.error)return resolved
      full=resolved.value.trim()
    }
    let name
    if(full.startsWith('refs/heads/')) name=full.slice('refs/heads/'.length)
    else if(full.startsWith(`refs/remotes/${context.remote}/`)){
      const mapped=remote(context,repositoryId,'lookup');if(mapped.error)return mapped
      const bound=checked(git,['rev-parse','--verify',`${full}^{commit}`],context,'lookup');if(bound.error)return bound
      if(sha && bound.value.trim()!==sha)return {error:hold('base-churn','lookup','Remote-tracking ref changed; reconcile the current base before resume.')}
      name=full.slice(`refs/remotes/${context.remote}/`.length)
    }else return {error:hold('target-drift','lookup','Only local branches or the verified publication remote can identify a PR target.')}
    if(!name||name.startsWith('-')||name.endsWith('/')||name.endsWith('.')||name.split('/').some(part=>!part||part.startsWith('.')||part.endsWith('.lock')))return {error:hold('target-drift','lookup','Delivery branch name is malformed.')}
    return {value:name}
  }
  const labels=request=>{
    const b=label(request.baseRef,request.context,request.repositoryId,request.currentBaseSha);if(b.error)return b
    const h=label(request.headRef,request.context,request.repositoryId,request.currentHeadSha);if(h.error)return h
    return {value:{base:b.value,head:h.value}}
  }
  const canonical=(pr,request,names)=>{
    if(!pr || pr.base?.repo?.full_name?.toLowerCase()!==request.repositoryId.toLowerCase() || pr.head?.repo?.full_name?.toLowerCase()!==request.repositoryId.toLowerCase() || pr.base.ref!==names.base || pr.head.ref!==names.head || typeof pr.node_id!=='string' || !Number.isInteger(pr.number) || !isDeliverySha(pr.base.sha) || !isDeliverySha(pr.head.sha) || typeof pr.draft!=='boolean' || !['open','closed'].includes(pr.state))throw new Error('GitHub PR identity or commit observation differs')
    return {providerId:'github',repositoryId:request.repositoryId,targetKey:request.targetKey,providerPullRequestId:pr.node_id,number:pr.number,url:pr.html_url??null,state:pr.merged_at?'merged':pr.state,draft:pr.draft,baseRef:request.baseRef,headRef:request.headRef,baseSha:pr.base.sha,headSha:pr.head.sha,observedAt:clock()}
  }
  const lookup=(request,observedRaw=()=>{})=>{
    if(!REPO.test(request.repositoryId)||typeof request.deliveryKey!=='string')return hold('repository','lookup','A stable GitHub repository and delivery key are required.')
    const named=labels(request);if(named.error)return named.error
    const names=named.value,endpoint=`repos/${request.repositoryId}/pulls?state=all&head=${encodeURIComponent(request.repositoryId.split('/')[0]+':'+names.head)}&base=${encodeURIComponent(names.base)}&per_page=100`
    const result=json(['api',endpoint,'--paginate','--slurp'],request.context,'lookup');if(result.error)return result.error
    if(!Array.isArray(result.value))return hold('unknown','lookup','PR list is incomplete; resume after a valid provider response.')
    const rows=result.value.flat(),marked=rows.filter(pr=>typeof pr.body==='string'&&pr.body.includes(deliveryMarker(request.deliveryKey)))
    if(marked.length>1)return {status:'refused',kind:'ambiguous',remedy:'Multiple PRs claim this delivery; reconcile their identity before resume.',resumable:false,observedAt:clock()}
    if(!marked.length)return null
    try{const receipt=canonical(marked[0],request,names);observedRaw(marked[0]);return receipt}catch{return hold('target-drift','lookup','Marked PR differs from the expected repository, branch or commit observation.')}
  }
  const capabilities=()=>({providerId:'github',supported:[...OPERATIONS],unsupported:[]})
  const preflight=({operation,context,repositoryId,target,pullRequest})=>{
    if(!OPERATIONS.includes(operation))return hold('unsupported',operation,'Select a supported PR operation.')
    const mapped=remote(context,repositoryId,operation);if(mapped.error)return mapped.error
    for(const [file,args] of [[git,['--version']],['gh',['--version']],['gh',['auth','status']]]){const result=checked(file,args,context,operation);if(result.error)return result.error}
    const repo=json(['api',`repos/${repositoryId}`],context,operation);if(repo.error)return repo.error
    if(repo.value?.full_name?.toLowerCase()!==repositoryId.toLowerCase())return hold('repository',operation,'GitHub repository observation differs from configured identity.')
    if(operation!=='lookup' && repo.value.permissions?.push!==true)return hold('permission',operation,'GitHub write permission is missing; restore authorized credentials and resume.')
    if(operation==='merge' && repo.value.allow_merge_commit!==true)return hold('unsupported',operation,'This adapter requires the repository merge-commit capability for merge mode.')
    if(operation==='queue'){
      if(!pullRequest?.providerPullRequestId||!target)return hold('unsupported',operation,'Queue capability requires an observed delivery PR.')
      const query='query($id:ID!){node(id:$id){... on PullRequest{id headRefOid mergeQueue{id}}}}'
      const probe=json(['api','graphql','-f',`query=${query}`,'-f',`id=${pullRequest.providerPullRequestId}`],context,operation)
      if(probe.error)return probe.error
      const node=probe.value?.data?.node
      if(node?.id!==pullRequest.providerPullRequestId||node.headRefOid!==target.currentHeadSha)return hold('target-drift',operation,'Queue capability observation has a different PR head.')
      if(!node.mergeQueue?.id)return hold('unsupported',operation,'The PR base branch has no available merge queue; configure a supported mode.')
    }
    return {status:'ready',providerId:'github',repositoryId,operation,capabilities:capabilities(),observedAt:clock()}
  }
  const requestOf=({expected,context})=>({...expected,context})
  const result=(request,status,providerActionId=null,pullRequest=null,errorKind=null)=>({status,actionKey:request.action.actionKey,providerActionId,errorKind,observedAt:clock(),pullRequest})
  const actionHold=(request,held)=>({...held,actionKey:request.action.actionKey})
  const observe=request=>lookup(requestOf(request))
  const presentation=(request)=>({title:request.context.presentation?.title??`Roadmap ${request.context.ownerArcId}`,body:`${request.context.presentation?.body??''}\n\n${deliveryMarker(request.expected.deliveryKey)}`})
  const mutatePr=(request,method)=>{
    let raw
    const existing=lookup(requestOf(request),value=>{raw=value})
    if(existing?.status)return actionHold(request,existing)
    if(existing && (existing.headSha!==request.action.requested.headSha||existing.baseSha!==request.action.requested.baseSha))return actionHold(request,hold('target-drift',method,'PR commits changed; reconcile before publication.'))
    if(existing && (existing.state!=='open'||existing.draft))return actionHold(request,hold('closed-or-draft',method,'Existing delivery PR is closed or draft; resolve its status before resume.'))
    if(method==='create'&&existing)return result(request,'succeeded',existing.providerPullRequestId,existing)
    if(method==='update'&&(!existing||existing.providerPullRequestId!==request.expected.providerPullRequestId))return actionHold(request,hold('target-drift',method,'Update requires the exact persisted PR.'))
    const named=labels(requestOf(request));if(named.error)return actionHold(request,named.error)
    const text=presentation(request)
    if(method==='update'&&raw?.title===text.title&&raw?.body===text.body)return result(request,'succeeded',existing.providerPullRequestId,existing)
    const args=['api','--method',method==='create'?'POST':'PATCH',`repos/${request.expected.repositoryId}/pulls${method==='update'?'/'+existing.number:''}`,'-f',`title=${text.title}`,'-f',`body=${text.body}`]
    if(method==='create')args.push('-f',`head=${named.value.head}`,'-f',`base=${named.value.base}`,'-F','draft=false')
    const out=json(args,request.context,method)
    if(out.error)return ['auth','permission','quota','unsupported','missing-tool'].includes(out.error.kind)?actionHold(request,out.error):result(request,'unknown',null,null,out.error.kind)
    try {if(!out.value.body?.includes(deliveryMarker(request.expected.deliveryKey)))return result(request,'unknown',null,null,'marker-unobserved');const pr=canonical(out.value,requestOf(request),named.value);if(pr.headSha!==request.action.requested.headSha||pr.baseSha!==request.action.requested.baseSha||pr.state!=='open'||pr.draft) return result(request,'unknown',null,null,'target-drift');return result(request,'succeeded',pr.providerPullRequestId,pr)}
    catch{return result(request,'unknown',null,null,'malformed-response')}
  }
  const push=request=>{
    const {action,context,expected}=request
    if(!isDeliverySha(action.requested.headSha))return actionHold(request,hold('target-drift','push','Push requires an exact commit.'))
    const out=run(git,['ls-remote','--exit-code','--refs',context.remote,expected.headRef],context)
    if(out.status!==0&&out.status!==2)return actionHold(request,hold(failureKind(out),'push','Could not observe the remote head; resume after connectivity is restored.'))
    const rows=(out.stdout??'').trim().split('\n').filter(Boolean),parts=rows[0]?.split(/\s+/),old=parts?.[0]??null
    if(rows.length>1||(old&&(!isDeliverySha(old)||parts[1]!==expected.headRef)))return actionHold(request,hold('target-drift','push','Remote head observation is ambiguous.'))
    if(old===action.requested.headSha)return result(request,'succeeded',old)
    const args=['push','--porcelain']
    if(old){
      const ancestor=run(git,['merge-base','--is-ancestor',old,action.requested.headSha],context)
      if(ancestor.status!==0&&ancestor.status!==1)return actionHold(request,hold('ancestry-unobserved','push','Git could not establish ancestry; fetch the observed head and resume.'))
      if(ancestor.status===1){
        const supplied=expected.normalizationReceipt
        if(!supplied)return actionHold(request,hold('rewrite-unproven','push','Non-fast-forward publication requires the existing verified normalization receipt.'))
        let receipt
        try{receipt=loadNormalizationReceipt(context.root,context.ownerArcId,supplied.planDigest)}catch{return actionHold(request,hold('rewrite-unproven','push','Normalization receipt could not be verified.'))}
        if(receipt.kind!=='published-corrections'||receipt.arcId!==context.ownerArcId||receipt.publishedRef!==expected.headRef||receipt.expectedOld!==old||receipt.newHead!==action.requested.headSha)return actionHold(request,hold('rewrite-unproven','push','Normalization receipt does not bind this exact replacement.'))
        args.push(`--force-with-lease=${expected.headRef}:${old}`)
      }
    }
    args.push('--',context.remote,`${action.requested.headSha}:${expected.headRef}`)
    const pushed=run(git,args,context)
    if(pushed.status!==0)return result(request,'unknown',null,null,failureKind(pushed))
    const observed=run(git,['ls-remote','--exit-code','--refs',context.remote,expected.headRef],context)
    if(observed.status!==0||observed.stdout.trim()!==`${action.requested.headSha}\t${expected.headRef}`)return result(request,'unknown',null,null,'head-unobserved')
    return result(request,'succeeded',action.requested.headSha)
  }
  const terminal=(request,kind)=>{
    const pr=observe(request)
    if(pr?.status)return actionHold(request,pr)
    if(!pr||pr.providerPullRequestId!==request.state.pullRequest?.providerPullRequestId||pr.headSha!==request.action.requested.headSha||pr.baseSha!==request.action.requested.baseSha||pr.draft)return actionHold(request,hold('target-drift',kind,'Terminal action requires the exact current delivery PR.'))
    const query='query($id:ID!){node(id:$id){... on PullRequest{id headRefOid merged mergeCommit{oid} mergeQueueEntry{id headCommit{oid}}}}}'
    const prior=json(['api','graphql','-f',`query=${query}`,'-f',`id=${pr.providerPullRequestId}`],request.context,kind)
    if(prior.error)return actionHold(request,prior.error)
    const node=prior.value?.data?.node
    if(node?.id!==pr.providerPullRequestId||node.headRefOid!==request.action.requested.headSha)return actionHold(request,hold('target-drift',kind,'PR head changed before terminal mutation.'))
    if(kind==='queue'&&node.mergeQueueEntry?.id){if(node.mergeQueueEntry.headCommit?.oid!==request.action.requested.headSha)return actionHold(request,hold('target-drift',kind,'Queue entry belongs to a different head.'));return result(request,'succeeded',node.mergeQueueEntry.id,pr)}
    if(kind==='merge'&&node.merged&&isDeliverySha(node.mergeCommit?.oid)){const out=result(request,'succeeded',node.mergeCommit.oid,{...pr,state:'merged'});return {...out,mergeSha:node.mergeCommit.oid}}
    if(pr.state!=='open'||node.merged)return actionHold(request,hold('closed',kind,'Delivery PR is no longer open.'))
    const mutation=kind==='queue'?'enqueuePullRequest':'mergePullRequest',fields=kind==='queue'?'mergeQueueEntry{id headCommit{oid}}':'pullRequest{id merged mergeCommit{oid}}'
    const gql=`mutation($id:ID!,$head:GitObjectID!,$key:String!){${mutation}(input:{pullRequestId:$id,expectedHeadOid:$head,clientMutationId:$key}){${fields}}}`
    const response=json(['api','graphql','-f',`query=${gql}`,'-f',`id=${pr.providerPullRequestId}`,'-f',`head=${request.action.requested.headSha}`,'-f',`key=${request.action.actionKey}`],request.context,kind)
    if(response.error)return ['auth','permission','quota','unsupported'].includes(response.error.kind)?actionHold(request,response.error):result(request,'unknown',null,null,response.error.kind)
    const payload=response.value?.data?.[mutation],id=kind==='queue'?payload?.mergeQueueEntry?.id:payload?.pullRequest?.mergeCommit?.oid
    if(typeof id!=='string'||(kind==='queue'&&payload.mergeQueueEntry.headCommit?.oid!==request.action.requested.headSha)||(kind==='merge'&&(!isDeliverySha(id)||payload.pullRequest.merged!==true)))return result(request,'unknown',null,null,'malformed-response')
    return {...result(request,'succeeded',id,kind==='merge'?{...pr,state:'merged'}:pr),...(kind==='merge'?{mergeSha:id}:{})}
  }
  // Read-only discovery precedes receipt initialization. Unknown protection is never empty policy.
  const bootstrap=({context,defaultBaseRef=null,requiredChecks=null})=>{
    const configured=checked(git,['remote','get-url','--',context.remote],context,'bootstrap');if(configured.error)return configured.error
    const repositoryId=repositoryFromUrl(configured.value)
    if(!repositoryId||!REPO.test(repositoryId))return hold('repository','bootstrap','Configure one GitHub publication remote and resume.')
    const mapped=remote(context,repositoryId,'bootstrap');if(mapped.error)return mapped.error
    const ready=preflight({operation:'lookup',context,repositoryId});if(ready.status!=='ready')return ready
    let baseRef=defaultBaseRef
    if(baseRef===null){
      const remoteHead=checked(git,['ls-remote','--symref',context.remote,'HEAD'],context,'bootstrap');if(remoteHead.error)return remoteHead.error
      const refs=remoteHead.value.split('\n').filter(line=>line.startsWith('ref: ')).map(line=>/^ref: (refs\/heads\/[^\s]+)\s+HEAD$/.exec(line)?.[1])
      if(refs.length!==1||!refs[0])return hold('base','bootstrap','Publication remote HEAD is ambiguous; configure deliveryPolicy.defaultBase and resume.')
      baseRef=refs[0]
    }else{
      const named=label(baseRef,context,repositoryId);if(named.error)return named.error
      baseRef=`refs/heads/${named.value}`
    }
    const snapshot=checked(git,['ls-remote','--heads',context.remote],context,'bootstrap');if(snapshot.error)return snapshot.error
    const heads={}
    for(const line of snapshot.value.trim().split('\n').filter(Boolean)){
      const match=/^([a-f0-9]{40}|[a-f0-9]{64})\s+(refs\/heads\/[^\s]+)$/.exec(line)
      if(!match||Object.hasOwn(heads,match[2]))return hold('base','bootstrap','Remote branch snapshot is malformed; inspect remote refs and resume.')
      heads[match[2]]=match[1]
    }
    if(!heads[baseRef])return hold('base','bootstrap','Configured base is absent from the verified publication remote; reconcile it and resume.')
    let names=requiredChecks
    if(names===null){
      const branch=encodeURIComponent(baseRef.slice('refs/heads/'.length))
      // GitHub rules endpoint includes active organization/repository rules; paginate all pages.
      const rules=json(['api',`repos/${repositoryId}/rules/branches/${branch}?per_page=100`,'--paginate','--slurp'],context,'bootstrap')
      const classic=json(['api',`repos/${repositoryId}/branches/${branch}/protection/required_status_checks`],context,'bootstrap')
      if(rules.error||classic.error)return {...(rules.error??classic.error),remedy:'Required check discovery is incomplete; configure deliveryPolicy.requiredChecks or restore readable branch rules and protection, then resume.'}
      if(!Array.isArray(rules.value)||rules.value.some(page=>!Array.isArray(page))||!Array.isArray(classic.value?.contexts)||!Array.isArray(classic.value?.checks))return hold('checks','bootstrap','Malformed branch rules; configure deliveryPolicy.requiredChecks or restore readable rules and resume.')
      names=[...classic.value.contexts,...classic.value.checks.map(check=>check?.context)]
      for(const rule of rules.value.flat()){
        if(!rule||typeof rule.type!=='string')return hold('checks','bootstrap','Incomplete branch rules; configure deliveryPolicy.requiredChecks and resume.')
        if(rule.type==='required_status_checks'){
          if(!Array.isArray(rule.parameters?.required_status_checks))return hold('checks','bootstrap','Incomplete required-check rule; configure deliveryPolicy.requiredChecks and resume.')
          names.push(...rule.parameters.required_status_checks.map(check=>check?.context))
        }
      }
    }
    if(!Array.isArray(names)||!names.length||names.some(name=>typeof name!=='string'||!name.trim()||name!==name.trim()))return hold('checks','bootstrap','Configure nonempty deliveryPolicy.requiredChecks; no complete required-check set was observed.')
    return {status:'ready',providerId:'github',repositoryId,baseRef,baseSha:heads[baseRef],requiredChecks:[...new Set(names)].sort(),refs:{heads}}
  }
  return {...createPullRequestProvider({providerId:'github',loadDelivery,withLock,impl:{capabilities,preflight,lookup,push,create:request=>mutatePr(request,'create'),update:request=>mutatePr(request,'update'),queue:request=>terminal(request,'queue'),merge:request=>terminal(request,'merge')}}),bootstrap}
}
