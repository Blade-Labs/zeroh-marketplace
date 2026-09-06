import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, lstatSync, mkdtempSync, mkdirSync, writeFileSync, renameSync, unlinkSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { sourceFiles, canonical as sourceCanonical, sha256 as sourceSha256 } from './greenfield-evidence-source.mjs'
import * as evidence from './greenfield-native-evidence.mjs'
import { validateSourceFiles, nativeObjects, proposalPaths, approvedPath, sessionEvents, validateApprovalSlice, nativeCommands, validateObservation, validateNativeAuthority, ROOT, sha256, APPROVAL, CORE_GATES, canonical } from './greenfield-native-evidence.mjs'





// Synthetic validator fixtures only. These objects are never native-run receipts.
const validatorTree = { 'seed.txt': { sha256: sha256('seed'), mode: 33188 }, '.git': { directory: true, mode: 16877 } }
function observerFixture(stage = 'proposal') {
  return { request: { stage, scratch: '/tmp/validator-fixture', argv: ['codex', 'exec', '--approve-for-me', '--json'] }, before: structuredClone(validatorTree), after: structuredClone(validatorTree), events: { overflow: false, events: [] }, result: { exit: 0, overflow: false, eventCount: 0 } }
}
test('observer validator accepts observed read-only preflight without classifying arbitrary shell as safe', () => {
  assert.doesNotThrow(() => validateObservation(observerFixture(), 'proposal'))
  assert.doesNotThrow(() => validateObservation(observerFixture('rerun'), 'rerun'))
})
test('observer validator rejects a reverted preapproval write and rerun write including .git', () => {
  for (const stage of ['proposal', 'rerun']) {
    const fixture = observerFixture(stage)
    fixture.events.events.push({ elapsed: 0.1, path: '.git/index.lock', mask: 0x100, cookie: 0 }, { elapsed: 0.2, path: '.git/index.lock', mask: 0x200, cookie: 0 })
    fixture.result.eventCount = 2
    assert.throws(() => validateObservation(fixture, stage), /mutation/)
  }
})
test('observer validator fails closed on overflow, missing events, failed process and changed snapshot', () => {
  const mutations = [
    (v) => { v.events.overflow = true },
    (v) => { delete v.events.events },
    (v) => { v.result.exit = 1 },
    (v) => { v.after['seed.txt'].sha256 = sha256('changed') },
    (v) => { v.result.eventCount = 1 },
  ]
  for (const mutate of mutations) {
    const fixture = observerFixture(); mutate(fixture)
    assert.throws(() => validateObservation(fixture, 'proposal'), { name: 'AssertionError' })
  }
})
test('native session parser recognizes real Claude user strings but rejects meta and assistant approval', () => {
  const raw = (type, content, extra = {}) => JSON.stringify({ type, message: { content }, ...extra })
  assert.equal(sessionEvents('claude', raw('user', 'APPROVE GREENFIELD PLAN'))[0].type, 'approval')
  assert.deepEqual(sessionEvents('claude', raw('assistant', 'APPROVE GREENFIELD PLAN')), [])
  assert.deepEqual(sessionEvents('claude', raw('user', 'APPROVE GREENFIELD PLAN', { isMeta: true })), [])
})
test('native execution slice requires approval before calls and preserves the prior session prefix', () => {
  const approval = JSON.stringify({ type: 'user', message: { content: 'APPROVE GREENFIELD PLAN' } })
  const call = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'fixture-call', name: 'Bash', input: { command: 'npm test' } }] } })
  assert.doesNotThrow(() => validateApprovalSlice('claude', '', approval + '\n' + call))
  assert.throws(() => validateApprovalSlice('claude', '', call + '\n' + approval), /approval/)
  assert.throws(() => validateApprovalSlice('claude', call + '\n', approval + '\n' + call), /prefix/)
})
test('Codex stdout parser binds numeric completion to its started command and rejects narration', () => {
  const item = { id: 'fixture-item', type: 'command_execution', command: "/bin/bash -lc 'npm test'" }
  const start = JSON.stringify({ type: 'item.started', item: { ...item, status: 'in_progress', exit_code: null } })
  const done = JSON.stringify({ type: 'item.completed', item: { ...item, status: 'completed', exit_code: 0, aggregated_output: 'ok' } })
  assert.equal(nativeCommands('codex', start + '\n' + done)[0].exitCode, 0)
  assert.throws(() => nativeCommands('codex', done), /start/)
  assert.throws(() => nativeCommands('codex', JSON.stringify({ events: [{ command: 'npm test', exitCode: 0 }] })), /native/)
})

test('Codex approval is read from native session messages before custom exec calls', () => {
  const encode = (payload) => JSON.stringify({ type: 'response_item', payload })
  const approval = encode({ type: 'message', role: 'user', content: [{ type: 'input_text', text: APPROVAL }] })
  const call = encode({ type: 'custom_tool_call', call_id: 'validator-custom', name: 'exec', input: 'text(await tools.exec_command({cmd:"npm test"}));' })
  assert.doesNotThrow(() => validateApprovalSlice('codex', '', approval + '\n' + call))
  assert.throws(() => validateApprovalSlice('codex', '', call + '\n' + approval), /approval/)
  assert.throws(() => validateApprovalSlice('codex', '', approval.replace('"user"', '"assistant"') + '\n' + call), /approval/)
})
test('Claude native Bash success uses structured tool result and refuses interrupted execution', () => {
  const call = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'validator-bash', name: 'Bash', input: { command: 'npm test' } }] } }
  const result = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'validator-bash', content: 'tests passed', is_error: false }] }, tool_use_result: { stdout: 'tests passed', stderr: '', interrupted: false } }
  const encode = () => [call, result].map((row) => JSON.stringify(row)).join('\n')
  assert.equal(nativeCommands('claude', encode())[0].exitCode, 0)
  result.tool_use_result.interrupted = true
  assert.throws(() => nativeCommands('claude', encode()), /interruption/)
  result.tool_use_result.interrupted = false
  result.message.content[0].is_error = true
  assert.notEqual(nativeCommands('claude', encode())[0].exitCode, 0)
})

function sourceValidatorFixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'greenfield-source-validator-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = resolve(root, 'plugins/zeroh-greenfield/skills/init/SKILL.md')
  mkdirSync(dirname(source), { recursive: true })
  writeFileSync(source, 'validator fixture source\n')
  return { root, source }
}
for (const mutation of ['changed', 'added', 'renamed', 'deleted', 'executable']) {
  test(`source snapshot rejects ${mutation} source, including dirty and untracked files`, (t) => {
    const { root, source } = sourceValidatorFixture(t)
    const sourceSnapshotFiles = sourceFiles(root)
    const bound = { sourceSnapshotFiles, sourceSnapshotSha256: sha256(canonical(sourceSnapshotFiles)) }
    assert.doesNotThrow(() => validateSourceFiles(bound, root))
    if (mutation === 'changed') writeFileSync(source, 'changed bytes\n')
    if (mutation === 'added') writeFileSync(resolve(dirname(source), 'new-untracked.mjs'), 'export const changed = true\n')
    if (mutation === 'renamed') renameSync(source, resolve(dirname(source), 'RENAMED.md'))
    if (mutation === 'deleted') unlinkSync(source)
    if (mutation === 'executable') chmodSync(source, lstatSync(source).mode ^ 0o100)
    assert.throws(() => validateSourceFiles(bound, root), { name: 'AssertionError' })
  })
}
test('source snapshot excludes only designated evidence and never an evidence-named source decoy', (t) => {
  const { root, source } = sourceValidatorFixture(t)
  const sourceSnapshotFiles = sourceFiles(root)
  const bound = { sourceSnapshotFiles, sourceSnapshotSha256: sha256(canonical(sourceSnapshotFiles)) }
  for (const relative of ['dry-runs/evidence/validator-only.jsonl', 'dry-runs/empty/receipt.json', 'dry-runs/brownfield/receipt.json', 'DRYRUN-2026-09.md']) {
    const path = resolve(root, 'plugins/zeroh-greenfield', relative)
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, 'synthetic evidence exclusion fixture\n')
  }
  assert.doesNotThrow(() => validateSourceFiles(bound, root))
  writeFileSync(resolve(dirname(source), 'receipt.json'), '{}')
  assert.throws(() => validateSourceFiles(bound, root), { name: 'AssertionError' })
})
function nativeProposalFixture(host, artifacts) {
  const text = '```json\n' + JSON.stringify({ type: 'proposal', artifacts: artifacts.map((path) => ({ path, reason: 'validator fixture only' })), commands: [{ command: 'npm install' }], gates: Object.fromEntries(CORE_GATES.map((slot) => [slot, 'none'])) }) + '\n```'
  return JSON.stringify(host === 'codex' ? { type: 'item.completed', item: { type: 'agent_message', text } } : { type: 'assistant', message: { content: [{ type: 'text', text }] } })
}
test('proposal paths authorize directory descendants and necessary parent directories, never siblings or traversal', () => {
  for (const host of ['claude', 'codex']) {
    const paths = proposalPaths(host, nativeProposalFixture(host, ['node_modules/', 'docs/PRD.md']))
    assert.equal(approvedPath('node_modules/package/index.js', { sha256: 'fixture' }, paths), true)
    assert.equal(approvedPath('node_modules', { directory: true }, paths), true)
    assert.equal(approvedPath('docs', { directory: true }, paths), true)
    for (const path of ['node_modules-evil/file', 'node_modules/../outside', 'docs/other.md', '/node_modules/a']) assert.equal(approvedPath(path, { sha256: 'fixture' }, paths), false)
    assert.equal(approvedPath('docs', { symlink: '/elsewhere' }, paths), false)
  }
})
test('proposal allowlist rejects self-reported events, duplicate paths and broad or unsafe artifact roots', () => {
  assert.throws(() => proposalPaths('codex', JSON.stringify({ approvedGapAllowlist: ['node_modules/'] })), /native proposal/)
  for (const paths of [['./'], ['/'], ['../'], ['docs/../'], ['docs/**'], ['docs/a', 'docs/a']]) {
    assert.throws(() => proposalPaths('claude', nativeProposalFixture('claude', paths)), { name: 'AssertionError' })
  }
})


test('native authority rejects expanded filesystem/network and disabled review', () => {
  const scratch = '/tmp/native-authority-fixture'
  const context = { cwd: scratch, approval_policy: 'on-request', approvals_reviewer: 'auto_review', sandbox_policy: { type: 'workspace-write', network_access: false }, permission_profile: { type: 'managed', network: 'restricted', file_system: { type: 'restricted', entries: [{ access: 'write', path: { type: 'path', path: scratch } }] } } }
  const encoded = (value) => JSON.stringify({type: 'turn_context', payload: value})
  assert.doesNotThrow(() => validateNativeAuthority('codex', '', encoded(context), scratch))
  for (const mutate of [
    c => { c.sandbox_policy.type = 'danger-full-access' },
    c => { c.sandbox_policy.network_access = true },
    c => { c.approvals_reviewer = 'none' },
    c => { c.permission_profile.file_system.entries.push({ access: 'write', path: { type: 'path', path: '/outside' } }) },
  ]) {
    const changed = structuredClone(context); mutate(changed)
    assert.throws(() => validateNativeAuthority('codex', '', encoded(changed), scratch))
  }
  const claude = JSON.stringify({type: 'system', subtype: 'init', cwd: scratch, permissionMode: 'auto'})
  assert.doesNotThrow(() => validateNativeAuthority('claude', claude, '', scratch))
  assert.throws(() => validateNativeAuthority('claude', claude.replace('auto', 'bypassPermissions'), '', scratch))
})

test('native audit parsing retains real gaps and ignores receipt-like narration', () => {
  const audit = { type: 'audit-result', proposals: [{path: 'roadmap/ROADMAP.md'}], writes: [], gaps: ['stale scaffold'] }
  const raw = JSON.stringify({type: 'item.completed', item: {type: 'agent_message', text: JSON.stringify(audit)}})
  assert.deepEqual(nativeObjects('codex', raw, 'audit-result'), [audit])
  assert.deepEqual(nativeObjects('codex', JSON.stringify(audit), 'audit-result'), [])
})

test('calibration: source and native evidence share the same canonical byte encoding', () => {
  const value = { Z: { before: 1, After: 2 }, a: 3 }
  assert.equal(canonical(value), sourceCanonical(value))
  assert.equal(canonical, sourceCanonical)
  assert.equal(sha256, sourceSha256)
})
test('calibration: Claude string error results retain the native nonzero exit, never fabricated success', () => {
  const call = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'calibration-bash', name: 'Bash', input: { command: 'ls missing' } }] } }
  const result = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'calibration-bash', content: 'Exit code 2\nmissing', is_error: true }] }, tool_use_result: 'Error: Exit code 2\nmissing' }
  const encode = () => [call, result].map((row) => JSON.stringify(row)).join('\n')
  assert.equal(nativeCommands('claude', encode())[0].exitCode, 2)
  result.message.content[0].is_error = false
  assert.throws(() => nativeCommands('claude', encode()), { name: 'AssertionError' })
  delete result.message.content[0].is_error
  assert.throws(() => nativeCommands('claude', encode()), { name: 'AssertionError' })
})
test('calibration: transparent Bash wrappers preserve literal argv and explicit cwd', () => {
  const quote = (text) => "'" + text.replaceAll("'", "'\"'\"'") + "'"
  const double = (text) => '"' + text.replace(/[\\"$`]/g, '\\$&') + '"'
  for (const scratch of ['/tmp/calibration', '/tmp/calibration space', "/tmp/calibration'quote", '/tmp/calibration$literal']) {
    const command = 'npm_config_cache="$PWD/.npm-cache" npm run type-check'
    for (const path of [quote(scratch), double(scratch)]) {
      const inner = `cd ${path} && ${command}`
      for (const native of [inner, `/bin/bash -lc ${quote(inner)}`, `/bin/bash -lc ${double(inner)}`]) assert.equal(evidence.matchesGateCommand(native, command, scratch), true)
    }
  }
  const scratch = '/tmp/calibration', command = 'npm test'
  for (const native of ["echo 'cd /tmp/calibration && npm test'", 'cd /tmp/calibration-evil && npm test', 'cd /tmp/calibration; npm test', 'cd /tmp/calibration && npm test; true', '/bin/bash -lc "cd $(pwd) && npm test"', '/bin/bash -lc "cd /tmp/calibration && npm test" extra', 'cd /tmp/calibration && echo npm test']) assert.equal(evidence.matchesGateCommand(native, command, scratch), false)
})
function calibrationNative(host, scratch = '/tmp/calibration') {
  const id = 'validator-session'
  const context = { cwd: scratch, approval_policy: 'on-request', approvals_reviewer: 'auto_review', sandbox_policy: { type: 'workspace-write', network_access: false }, permission_profile: { type: 'managed', network: 'restricted', file_system: { type: 'restricted', entries: [{ access: 'write', path: { type: 'path', path: scratch } }] } } }
  return host === 'claude'
    ? { raw: JSON.stringify({type:'system',subtype:'init',cwd:scratch,session_id:id,permissionMode:'auto',claude_code_version:'2.1.257'}), sessionRaw: JSON.stringify({type:'user',sessionId:id,message:{content:'fixture request'}}), context }
    : { raw: JSON.stringify({type:'thread.started',thread_id:id}), sessionRaw: [JSON.stringify({type:'session_meta',payload:{id,cwd:scratch,cli_version:'0.153.2'}}),JSON.stringify({type:'turn_context',payload:context})].join('\n'), context }
}
test('calibration: session identity and observed executable/version cannot be replaced by receipt claims', () => {
  for (const host of ['claude','codex']) {
    const fixture = calibrationNative(host)
    const version = host === 'claude' ? '2.1.257' : '0.153.2'
    assert.deepEqual(evidence.nativeSessionIdentity(host, fixture.raw, fixture.sessionRaw, '/tmp/calibration'), {sessionId:'validator-session',version})
    assert.throws(() => evidence.nativeSessionIdentity(host, fixture.raw, fixture.sessionRaw.replaceAll('validator-session','copied-session'), '/tmp/calibration'), {name:'AssertionError'})
    assert.doesNotThrow(() => evidence.validateInvocationMetadata({host,executable:host,version}, {request:{argv:[host]},version}))
    assert.doesNotThrow(() => evidence.validateInvocationMetadata({host,executable:host,version:host === 'claude' ? `${version} (Claude Code)` : `codex-cli ${version}`}, {request:{argv:[host]},version}))
    assert.throws(() => evidence.validateInvocationMetadata({host,executable:host,version:'made-up'}, {request:{argv:[host]},version}), {name:'AssertionError'})
    assert.throws(() => evidence.validateInvocationMetadata({host,executable:host,version}, {request:{argv:['echo']},version}), {name:'AssertionError'})
  }
})
test('calibration: malformed or unrestricted native filesystem profiles fail closed', () => {
  const {context} = calibrationNative('codex')
  const encode = (value) => JSON.stringify({type:'turn_context',payload:value})
  assert.doesNotThrow(() => validateNativeAuthority('codex','',encode(context),context.cwd))
  for(const mutate of [c=>{c.permission_profile.file_system.type='unrestricted'},c=>{c.permission_profile.file_system.entries=[]},c=>{c.permission_profile.file_system.entries[0].access='unknown'},c=>{delete c.permission_profile.type}]) {
    const bad=structuredClone(context);mutate(bad)
    assert.throws(()=>validateNativeAuthority('codex','',encode(bad),context.cwd),{name:'AssertionError'})
  }
})
test('calibration: all-none gates still need actual successful catalog and config checks', () => {
  const scratch='/tmp/calibration'
  const commands = [`node ${ROOT}/plugins/zeroh-roadmap/bin/roadmap.mjs config check`, 'node scripts/check-readme-catalog.mjs --project-root .'].map(command=>({command:`cd '${scratch}' && ${command}`,exitCode:0}))
  assert.doesNotThrow(()=>evidence.validateStructuralChecks(commands,scratch))
  for(const bad of [[],commands.slice(0,1),commands.map(c=>({...c,command:'echo '+JSON.stringify(c.command)})),commands.map(c=>({...c,exitCode:1}))]) assert.throws(()=>evidence.validateStructuralChecks(bad,scratch),{name:'AssertionError'})
})

const nativeText = (host, text) => JSON.stringify(host === 'claude' ? {type:'assistant',message:{content:[{type:'text',text}]}} : {type:'item.completed',item:{type:'agent_message',text}})
test('mixed fences: complete native proposal survives a preceding shell fence and heading', () => {
  const proposal = {type:'proposal',artifacts:[{path:'docs/PRD.md',reason:'validator fixture'}],commands:[{command:'node check.mjs'}],gates:Object.fromEntries(CORE_GATES.map(slot=>[slot,'none']))}
  const text = '# Proposal\n\n```sh\nnode check.mjs\n```\n\n## Machine proposal and approval\n\n```json\n'+JSON.stringify(proposal)+'\n```\n\nAwaiting approval.'
  for(const host of ['claude','codex']) {
    assert.deepEqual(nativeObjects(host,nativeText(host,text),'proposal'),[proposal])
    assert.deepEqual(proposalPaths(host,nativeText(host,text)),['docs/PRD.md'])
    assert.deepEqual(nativeObjects(host,nativeText(host,JSON.stringify(proposal)),'proposal'),[proposal])
  }
})
test('mixed fences: shell examples, untagged blocks and nested fake JSON are not native proposal objects', () => {
  const json=JSON.stringify({type:'proposal',artifacts:[]})
  for(const text of ['```sh\n'+json+'\n```','```\n'+json+'\n```','````sh\n```json\n'+json+'\n```\n````','```json\n'+json]) assert.deepEqual(nativeObjects('claude',nativeText('claude',text),'proposal'),[])
})
function catalogValidatorFixture(t,kind) {
  const scratch=mkdtempSync(resolve(tmpdir(),'greenfield-catalog-validator-'))
  t.after(()=>rmSync(scratch,{recursive:true,force:true}))
  mkdirSync(resolve(scratch,'.git'))
  if(kind==='brownfield') {
    mkdirSync(resolve(scratch,'emitted'));mkdirSync(resolve(scratch,'apps/web'),{recursive:true})
    writeFileSync(resolve(scratch,'nx.json'),'{}')
    writeFileSync(resolve(scratch,'package.json'),JSON.stringify({name:'workspace-wrapper'}))
    writeFileSync(resolve(scratch,'emitted/repo-catalog.json'),JSON.stringify({projects:[{name:'actual-web',root:'apps/web'}]}))
  }
  return scratch
}
function validatorInventory(scratch) {
  const map={}
  function walk(relative='') {
    for(const name of readdirSync(resolve(scratch,relative))) {
      const path=relative?relative+'/'+name:name,absolute=resolve(scratch,path),stat=lstatSync(absolute)
      if(stat.isDirectory()){map[path]={directory:true,mode:stat.mode};walk(path)}
      else map[path]={sha256:sha256(readFileSync(absolute)),mode:stat.mode}
    }
  }
  walk();return map
}
test('catalog selection: empty library-cli binds prospective identity without needing a package', t=>{
  const scratch=catalogValidatorFixture(t,'empty')
  assert.deepEqual(evidence.selectCatalogCheck(scratch,{kind:'empty',archetype:'library-cli',projectName:'greenfield-proof'}),{mode:'project-root',source:'.',projectName:'greenfield-proof',command:'node scripts/check-readme-catalog.mjs --project-root .'})
  assert.throws(()=>evidence.selectCatalogCheck(scratch,{kind:'empty',archetype:'nx-monorepo',projectName:'greenfield-proof'}),{name:'AssertionError'})
})
test('catalog selection: Nx uses the emitted catalog even when wrapper package identity differs',t=>{
  const scratch=catalogValidatorFixture(t,'brownfield')
  const selected=evidence.selectCatalogCheck(scratch,{kind:'brownfield'})
  assert.equal(selected.mode,'catalog');assert.equal(selected.source,'emitted/repo-catalog.json')
  assert.equal(selected.command,'node scripts/check-readme-catalog.mjs --catalog emitted/repo-catalog.json')
  assert.equal(selected.sourceSha256,sha256(readFileSync(resolve(scratch,selected.source))))
  writeFileSync(resolve(scratch,'README.md'),'<!-- repo-catalog:start -->\n| Project | Root | Purpose |\n| --- | --- | --- |\n| actual-web | apps/web | fixture |\n<!-- repo-catalog:end -->\n')
  const checker=resolve(ROOT,'plugins/zeroh-greenfield/templates/scripts/check-readme-catalog.mjs')
  const catalog=spawnSync(process.execPath,[checker,'--catalog',selected.source],{cwd:scratch,encoding:'utf8'})
  assert.equal(catalog.status,0,catalog.stderr)
  const wrapper=spawnSync(process.execPath,[checker,'--project-root','.'],{cwd:scratch,encoding:'utf8'})
  assert.equal(wrapper.status,1,'wrapper package mode is not equivalent to the emitted project catalog')
  assert.match(wrapper.stderr,/missing README project: workspace-wrapper|orphan README project: actual-web/)

  writeFileSync(resolve(scratch,selected.source),JSON.stringify({projects:[{name:'ghost',root:'missing-root'}]}))
  assert.throws(()=>evidence.selectCatalogCheck(scratch,{kind:'brownfield'}),{name:'AssertionError'})
})
function catalogProofFixture(t,kind) {
  const scratch=catalogValidatorFixture(t,kind), before=validatorInventory(scratch)
  const catalogCheck=evidence.selectCatalogCheck(scratch,{kind,archetype:'library-cli',projectName:'greenfield-proof'})
  if(kind==='empty')writeFileSync(resolve(scratch,'package.json'),JSON.stringify({name:'greenfield-proof'}))
  const after=validatorInventory(scratch), source=kind==='empty'?'package.json':catalogCheck.source
  const reference={path:resolve(scratch,source),sha256:sha256(readFileSync(resolve(scratch,source)))}
  const arm={kind,scratchRoot:scratch,catalogCheck,artifacts:{[source]:reference}}
  const proposal={type:'proposal',commands:[{cwd:scratch,command:catalogCheck.command}]}
  const commands=[{command:`cd '${scratch}' && ${catalogCheck.command}`,exitCode:0}]
  return {arm,before,after,proposal,commands}
}
test('catalog proof: selected command is proposed once and succeeds; alternate modes, duplicates and source drift fail',t=>{
  for(const kind of ['empty','brownfield']) {
    const f=catalogProofFixture(t,kind)
    const run=()=>evidence.validateCatalogCheck(f.arm,f.before,f.after,f.proposal,f.commands)
    assert.doesNotThrow(run)
    f.proposal.commands.push({...f.proposal.commands[0]});assert.throws(run,{name:'AssertionError'});f.proposal.commands.pop()
    f.commands.push({...f.commands[0]});assert.throws(run,{name:'AssertionError'});f.commands.pop()
    const alternative=kind==='empty'?'node scripts/check-readme-catalog.mjs --catalog emitted/repo-catalog.json':'node scripts/check-readme-catalog.mjs --project-root .'
    f.proposal.commands.push({cwd:f.arm.scratchRoot,command:alternative});assert.throws(run,{name:'AssertionError'});f.proposal.commands.pop()
    f.commands.push({command:`cd '${f.arm.scratchRoot}' && ${alternative}`,exitCode:0});assert.throws(run,{name:'AssertionError'});f.commands.pop()
    f.commands[0].exitCode=1;assert.throws(run,{name:'AssertionError'});f.commands[0].exitCode=0
    if(kind==='brownfield')f.after[f.arm.catalogCheck.source].sha256=sha256('drift')
    else {
      writeFileSync(f.arm.artifacts['package.json'].path,JSON.stringify({name:'wrong-project'}))
      f.arm.artifacts['package.json'].sha256=sha256(readFileSync(f.arm.artifacts['package.json'].path))
      f.after['package.json'].sha256=f.arm.artifacts['package.json'].sha256
    }
    assert.throws(run,{name:'AssertionError'})
  }
})

// Synthetic host boundary: no installed wrapper or machine UID is consulted.
const wrapperBytes = Buffer.from('synthetic vetted wrapper bytes')
const wrapperExecutable = '/home/patrik/.local/bin/capbuild'
const wrapperRealpath = '/home/patrik/illumination_VS_setup/scripts/capbuild'
const wrapperHost = {
  realpathSync(path) { assert.equal(path, wrapperExecutable); return wrapperRealpath },
  lstatSync(path) { assert.equal(path, wrapperRealpath); return { isFile: () => true, mode: 0o100755 } },
  readFileSync(path) { assert.equal(path, wrapperRealpath); return wrapperBytes },
  getuid: () => 12345,
}
function capbuildBinding() {
  return {kind:'capbuild',executable:wrapperExecutable,realpath:wrapperRealpath,sha256:sha256(wrapperBytes),defaults:{memoryMax:'8G',memorySwapMax:'2G',heapMB:4096,slice:'dev.slice'},hostMetadataEffects:['systemd-user-transient-units','/run/user/12345/capbuild-locks']}
}
test('capbuild envelope: changed host bytes, symlink target and executable mode fail closed', () => {
  const binding = capbuildBinding()
  assert.doesNotThrow(() => evidence.validateGateWrapper(binding, wrapperHost))
  for (const changed of [
    { readFileSync: () => Buffer.from('changed binary') },
    { realpathSync: () => '/tmp/replaced-wrapper' },
    { lstatSync: () => ({ isFile: () => true, mode: 0o100644 }) },
    { lstatSync: () => ({ isFile: () => false, mode: 0o120755 }) },
  ]) {
    const host = { ...wrapperHost, ...changed }
    assert.throws(() => evidence.validateGateWrapper(binding, host), { name: 'AssertionError' })
    assert.equal(evidence.unwrapGateExecution(`cd '/tmp/fixture' && ${binding.executable} npm test`, 'npm test', '/tmp/fixture', binding, host), null)
  }
})
test('capbuild envelope: portable build/types/unit and emit tail survive the bound wrapper unchanged',()=>{
  const scratch='/tmp/capbuild-validator',binding=capbuildBinding()
  const env=[`npm_config_cache=${scratch}/.npm-cache`,`npm_config_logs_dir=${scratch}/.npm-logs`]
  for(const configured of ['npm run build','npm run type-check','node --test','env TSX_DISABLE_CACHE=1 node --import tsx roadmap/lib/emit.ts']) {
    const executed=`${binding.executable} --env '${env[0]}' --env '${env[1]}' ${configured}`
    const raw=`cd '${scratch}' && ${executed}`
    const expected={configuredCommand:configured,executedCommand:executed,wrapper:{...binding,env}}
    assert.deepEqual(evidence.unwrapGateExecution(raw,configured,scratch,binding,wrapperHost),expected)
    const outer="/bin/bash -lc '"+raw.replaceAll("'","'\"'\"'")+"'"
    assert.deepEqual(evidence.unwrapGateExecution(outer,configured,scratch,binding,wrapperHost),expected)
    assert.deepEqual(evidence.unwrapGateExecution(`cd '${scratch}' && ${configured}`,configured,scratch,binding,wrapperHost),{configuredCommand:configured,executedCommand:configured,wrapper:null})
  }
  const canonical=`${binding.realpath} node --test`
  assert.deepEqual(evidence.unwrapGateExecution(`cd '${scratch}' && ${canonical}`,'node --test',scratch,binding,wrapperHost),{configuredCommand:'node --test',executedCommand:canonical,wrapper:{...binding,env:[]}})
})
test('capbuild envelope: wrong cwd, binary, digest, defaults and broadened host metadata fail closed',()=>{
  const scratch='/tmp/capbuild-validator',binding=capbuildBinding(),raw=`cd '${scratch}' && ${binding.executable} npm run build`
  assert.doesNotThrow(()=>evidence.validateGateWrapper(binding,wrapperHost))
  assert.equal(evidence.unwrapGateExecution(raw,'npm run build','/tmp/wrong',binding,wrapperHost),null)
  for(const mutate of [b=>{b.executable='/tmp/capbuild'},b=>{b.realpath='/tmp/capbuild'},b=>{b.sha256='0'.repeat(64)},b=>{b.defaults.memoryMax='64G'},b=>{b.hostMetadataEffects.push('/tmp/arbitrary')}]) {
    const invalid=structuredClone(binding);mutate(invalid)
    assert.throws(()=>evidence.validateGateWrapper(invalid,wrapperHost),{name:'AssertionError'})
    assert.equal(evidence.unwrapGateExecution(raw,'npm run build',scratch,invalid,wrapperHost),null)
  }
})
test('capbuild envelope: only literal approved env flags and exact ordered configured argv are accepted',()=>{
  const scratch='/tmp/capbuild-validator',binding=capbuildBinding(),command='npm run build'
  const invalid=[
    '--mem 64G npm run build','--swap 0 npm run build','--heap 8192 npm run build','--slice other.slice npm run build','--lock x npm run build','--no-lock npm run build','-- npm run build',
    '--env NODE_OPTIONS=--max-old-space-size=99999 npm run build','--env TSX_DISABLE_CACHE=1 npm run build','--env npm_config_cache npm run build','--env npm_config_cache=/outside npm run build',
    `--env npm_config_cache=${scratch}/.npm-cache --env npm_config_cache=${scratch}/.npm-cache npm run build`,
    'npm build run','npm run build extra','npm run build > result','npm run build; true','npm run build && true','npm run $(echo build)',
  ]
  for(const tail of invalid) assert.equal(evidence.unwrapGateExecution(`cd '${scratch}' && ${binding.executable} ${tail}`,command,scratch,binding,wrapperHost),null,tail)
  assert.equal(evidence.unwrapGateExecution(`cd '${scratch}' && capbuild ${command}`,command,scratch,binding,wrapperHost),null,'PATH lookups are not bound executable evidence')
  assert.equal(evidence.unwrapGateExecution(`cd '${scratch}' && ${binding.executable} ${command}`,`${binding.executable} ${command}`,scratch,binding,wrapperHost),null,'configuration cannot absorb the host wrapper')
  assert.equal(evidence.unwrapGateExecution(`cd '${scratch}' && ${binding.executable} bash -c 'false; true'`,"bash -c 'false; true'",scratch,binding,wrapperHost),null,'a configured shell program cannot hide operators inside the wrapper')
})
test('capbuild envelope: per-slot metadata matches real native numeric success, never narrated or failed inner status',()=>{
  const scratch='/tmp/capbuild-validator',binding=capbuildBinding(),configured='node --test',executed=`${binding.executable} ${configured}`,raw=`cd '${scratch}' && ${executed}`
  const native={id:'validator-call',command:raw,exitCode:0,output:'test output'}
  const record={toolCallId:native.id,nativeCommand:raw,exitCode:0,configuredCommand:configured,executedCommand:executed,wrapper:{...binding,env:[]}}
  assert.doesNotThrow(()=>evidence.validateGateExecutionEvidence(record,native,configured,scratch,binding,wrapperHost))
  for(const changed of [{...native,exitCode:1},{...native,exitCode:undefined,output:'all tests passed, exit 0'},{...native,id:'another-call'}]) assert.throws(()=>evidence.validateGateExecutionEvidence(record,changed,configured,scratch,binding,wrapperHost),{name:'AssertionError'})
  for(const changed of [{...record,executedCommand:configured},{...record,wrapper:null},{...record,configuredCommand:'npm test'}]) assert.throws(()=>evidence.validateGateExecutionEvidence(changed,native,configured,scratch,binding,wrapperHost),{name:'AssertionError'})
})

test('capbuild envelope: independent observer must attest all prebound override clearing',()=>{
  const fixture=observerFixture()
  fixture.request.gateWrapper=capbuildBinding()
  fixture.request.clearedHostOverrides=[...evidence.CAPBUILD_CLEARED_OVERRIDES]
  fixture.result.clearedHostOverrides=[...evidence.CAPBUILD_CLEARED_OVERRIDES]
  assert.doesNotThrow(()=>validateObservation(fixture,'proposal',wrapperHost))
  for(const mutate of [f=>{delete f.result.clearedHostOverrides},f=>{f.result.clearedHostOverrides.pop()},f=>{f.request.clearedHostOverrides.pop()},f=>{f.request.gateWrapper.sha256='0'.repeat(64)}]) {
    const invalid=structuredClone(fixture);mutate(invalid)
    assert.throws(()=>validateObservation(invalid,'proposal',wrapperHost),{name:'AssertionError'})
  }
  fixture.events.events=[{elapsed:0.1,path:'.npm-cache',mask:0x100,cookie:0}]
  fixture.result.eventCount=1
  assert.throws(()=>validateObservation(fixture,'proposal',wrapperHost),/mutation/,'host wrapper metadata never exempts scratch writes')
})

function approvedExecutionFixture() {
  const scratch='/tmp/approved-validator',gates=Object.fromEntries(CORE_GATES.map(slot=>[slot,'none']))
  gates.build='npm run build'
  const planned=["cat > package.json <<'JSON'\n{\"name\":\"approved\"}\nJSON",'npm install --ignore-scripts','npm run build']
  const commands=planned.map((command,i)=>({id:`call-${i}`,command:`cd '${scratch}' && ${command}`,exitCode:0}))
  return {scratch,host:'claude',proposal:{gates,commands:planned.map(command=>({cwd:scratch,command}))},config:{gateCommands:{...gates}},commands,raw:'',sessionRaw:commands.map(c=>JSON.stringify({type:'assistant',message:{content:[{type:'tool_use',id:c.id,name:'Bash',input:{command:c.command}}]}})).join('\n')}
}
test('approval binding: complete exact operational plan and gate bindings validate',()=>{
  const f=approvedExecutionFixture()
  assert.doesNotThrow(()=>evidence.validateApprovedExecution(f))
})
test('approval binding: generated gate changes, extra slots and absent approval fail closed',()=>{
  for(const mutate of [f=>{f.config.gateCommands.build='npm run release'},f=>{f.config.gateCommands.unit='node --test'},f=>{f.proposal.gates.build='none'},f=>{delete f.proposal.gates.emit},f=>{f.config.gateCommands.extra='none'}]) {
    const f=approvedExecutionFixture();mutate(f)
    assert.throws(()=>evidence.validateApprovedExecution(f),{name:'AssertionError'})
  }
})
test('approval binding: unapproved install, changed heredoc, wrong cwd, missing, repeated or failed operation rejected',()=>{
  for(const mutate of [f=>{f.commands[1].command+=' && npm install other'},f=>{f.commands[0].command=f.commands[0].command.replace('approved','changed')},f=>{f.commands[0].command=f.commands[0].command.replace(f.scratch,'/tmp/other')},f=>{f.commands.pop()},f=>{f.commands.push(f.commands[0])},f=>{f.commands[1].exitCode=1},f=>{f.proposal.commands[0].cwd='/tmp/other'}]) {
    const f=approvedExecutionFixture();mutate(f)
    assert.throws(()=>evidence.validateApprovedExecution(f),{name:'AssertionError'})
  }
})
test('approval binding: native direct file modifications and unobserved calls cannot hide behind approved shell',()=>{
  for(const name of ['Write','Edit','apply_patch','Task','Skill']) {
    const f=approvedExecutionFixture()
    f.sessionRaw+='\n'+JSON.stringify({type:'assistant',message:{content:[{type:'tool_use',id:'unapproved',name,input:{file_path:f.scratch+'/package.json'}}]}})
    assert.throws(()=>evidence.validateApprovedExecution(f),{name:'AssertionError'})
  }
  const f=approvedExecutionFixture()
  f.sessionRaw=f.sessionRaw.replace('npm run build','npm run release')
  assert.throws(()=>evidence.validateApprovedExecution(f),{name:'AssertionError'})
})
test('approval binding: Codex accepts transparent JSON exec envelopes, rejects hidden tools and arbitrary code',()=>{
  const fixture=()=>{
    const f=approvedExecutionFixture();f.host='codex'
    f.sessionRaw=f.commands.map(c=>JSON.stringify({type:'response_item',payload:{type:'custom_tool_call',name:'exec',input:`text(await tools.exec_command(${JSON.stringify({cmd:c.command,workdir:f.scratch})}));`}})).join('\n')
    return f
  }
  assert.doesNotThrow(()=>evidence.validateApprovedExecution(fixture()))
  for(const code of ['text(await tools.apply_patch("patch"));','const t=tools; text(await t.apply_patch("patch"));','text(await tools["exec_command"]({cmd:"bad"}));','text(await tools.write_stdin({"session_id":1,"chars":"rm -rf x\\n"}));']) {
    const f=fixture();f.sessionRaw+='\n'+JSON.stringify({type:'response_item',payload:{type:'custom_tool_call',name:'exec',input:code}})
    assert.throws(()=>evidence.validateApprovedExecution(f),{name:'AssertionError'})
  }
  const f=fixture();f.raw=JSON.stringify({type:'item.completed',item:{type:'file_change',changes:[{path:'unexpected'}]}})
  assert.throws(()=>evidence.validateApprovedExecution(f),{name:'AssertionError'})
})
test('approval binding: capbuild is an explicit approved operational envelope, not implicit permission',()=>{
  const f=approvedExecutionFixture(),wrapper='/home/patrik/.local/bin/capbuild '
  f.commands[2].command=f.commands[2].command.replace('npm run build',wrapper+'npm run build')
  f.sessionRaw=f.sessionRaw.replace('npm run build',wrapper+'npm run build')
  assert.throws(()=>evidence.validateApprovedExecution(f),/approved text/)
  f.proposal.commands[2].command=wrapper+'npm run build'
  assert.doesNotThrow(()=>evidence.validateApprovedExecution(f))
  f.commands[2].command=f.commands[2].command.replace('capbuild ','capbuild --mem 64G ')
  assert.throws(()=>evidence.validateApprovedExecution(f),/approved text/)
})
test('approval binding: native namespaced JSON envelopes and empty polling retain exact observed operations',()=>{
  const f=approvedExecutionFixture();f.host='codex'
  const custom={type:'response_item',payload:{type:'custom_tool_call',name:'functions.exec',input:` text(await tools.exec_command(${JSON.stringify({cmd:f.commands[0].command,workdir:f.scratch,sandbox_permissions:'require_escalated',justification:'Approved fixture operation'})})); `}}
  const direct=f.commands.slice(1).map(c=>({type:'response_item',payload:{type:'function_call',name:'functions.exec_command',arguments:JSON.stringify({cmd:c.command,workdir:f.scratch})}}))
  const poll={type:'response_item',payload:{type:'custom_tool_call',name:'exec',input:'text(await tools.write_stdin({"session_id":42,"chars":"","yield_time_ms":1000}));'}}
  f.sessionRaw=[custom,...direct,poll].map(r=>JSON.stringify(r)).join('\n')
  assert.doesNotThrow(()=>evidence.validateApprovedExecution(f))
  custom.payload.input=custom.payload.input.replace('"workdir":"'+f.scratch+'"','"workdir":"/tmp/wrong"')
  f.sessionRaw=[custom,...direct,poll].map(r=>JSON.stringify(r)).join('\n')
  assert.throws(()=>evidence.validateApprovedExecution(f),/workdir/)
})



// Local parser fixtures only; these artifacts are not native installation receipts.
function deliveryValidatorFixture() {
  const root=mkdtempSync(resolve(tmpdir(),'delivery-validator-')),scratch='/tmp/native-delivery-fixture'
  const validation=`/home/patrik/.local/bin/capbuild --env GREENFIELD_DELIVERY_ROOT=${scratch} node --test ${ROOT}/plugins/zeroh-roadmap/test/fixture-consumer/greenfield-ci-release.test.mjs`
  const probe="if command -v actionlint >/dev/null 2>&1; then command -v actionlint; actionlint -version; else printf '%s\\n' 'ACTIONLINT_UNAVAILABLE'; fi"
  const delivery={provider:'github-actions',adapter:'library-cli',configPath:'.github/greenfield-delivery.json',workflowPaths:['.github/workflows/ci.yml','.github/workflows/release.yml'],plannerPath:'scripts/ci-shard-plan.mjs',releaseEnvironment:'approved-release-environment',collision:{existingPaths:[],decision:'create',preserveUntilApproval:true},validationCommands:[{command:validation,cwd:scratch}]}
  const texts={
    '.github/greenfield-delivery.json':JSON.stringify({schemaVersion:1,archetype:'library-cli',setupArgv:[],affectedArgv:['npm','test'],affectedFallbackReason:'Full test fallback selected',shardCount:2,baseline:{minTests:1,minUnits:1,coverageFloor:80},runners:{'node:test':{inventoryArgv:['git','ls-files','-z','--','test'],inventoryFormat:'git-nul',shardArgv:['node','--test','{unit}'],rawReports:[{path:'{junit}',format:'junit'},{path:'{coverage}',format:'lcov'}]}},build:{argv:['npm','run','build'],outputs:['dist']},release:{provider:'none',environment:delivery.releaseEnvironment}}),
    '.github/workflows/ci.yml':readFileSync(resolve(ROOT,'plugins/zeroh-greenfield/templates/github/workflows/ci.yml'),'utf8'),
    '.github/workflows/release.yml':readFileSync(resolve(ROOT,'plugins/zeroh-greenfield/templates/github/workflows/release.yml'),'utf8'),
    'scripts/ci-shard-plan.mjs':readFileSync(resolve(ROOT,'plugins/zeroh-greenfield/templates/scripts/ci-shard-plan.mjs'),'utf8'),
  }
  const artifacts={},after={}
  for(const [path,content] of Object.entries(texts)) {
    const retained=resolve(root,path);mkdirSync(dirname(retained),{recursive:true});writeFileSync(retained,content)
    artifacts[path]={path:retained,sha256:sha256(content)};after[path]={sha256:sha256(content),mode:33188}
  }
  const commands=[{id:'delivery-tests',command:`cd '${scratch}' && ${validation}`,exitCode:0,output:'TAP version 13\n1..27\n# tests 27\n# suites 0\n# pass 27\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 1000\n'},{id:'actionlint-probe',command:`cd '${scratch}' && ${probe}`,exitCode:0,output:'ACTIONLINT_UNAVAILABLE\n'}]
  const arm={kind:'empty',host:'claude',scratchRoot:scratch,gateWrapper:capbuildBinding(),delivery:structuredClone(delivery),artifacts,deliveryValidation:{commandExits:[{nativeCommand:commands[0].command,toolCallId:commands[0].id,exitCode:0}],actionlint:{command:commands[1].command,toolCallId:commands[1].id,exitCode:0,output:commands[1].output}}}
  const proposal={type:'proposal',delivery,commands:[...delivery.validationCommands,{command:probe,cwd:scratch}],artifacts:Object.keys(artifacts).map(path=>({path,reason:'explicit approved output'}))}
  return {arm,proposal,before:{},after,commands,close:()=>rmSync(root,{recursive:true,force:true})}
}
test('delivery contract: exact output bytes, full installed workflow validation and native optional-linter evidence validate',()=>{
  const f=deliveryValidatorFixture()
  try {assert.doesNotThrow(()=>evidence.validateDeliveryEvidence(f))} finally {f.close()}
})
test('delivery contract: missing or mismatched proposal fields and output/hash drift fail closed',()=>{
  for(const mutate of [f=>{delete f.proposal.delivery},f=>{f.arm.delivery.provider='other-ci'},f=>{f.arm.delivery.adapter='web'},f=>{f.arm.delivery.releaseEnvironment='unapproved'},f=>{f.proposal.delivery.collision.preserveUntilApproval=false},f=>{delete f.arm.artifacts['.github/workflows/ci.yml']},f=>{delete f.after['scripts/ci-shard-plan.mjs']},f=>{f.after['.github/workflows/release.yml'].sha256='0'.repeat(64)}]) {
    const f=deliveryValidatorFixture();try {mutate(f);assert.throws(()=>evidence.validateDeliveryEvidence(f),{name:'AssertionError'})} finally {f.close()}
  }
})
test('delivery contract: actual full validation cannot be replaced by narration, filtered tests, failed runs or another consumer',()=>{
  for(const mutate of [f=>{f.commands[0].output='all checks passed'},f=>{f.commands[0].output=f.commands[0].output.replace('# pass 27','# pass 26')},f=>{f.commands[0].output=f.commands[0].output.replace('# skipped 0','# skipped 1')},f=>{f.commands[0].output=f.commands[0].output.replace('# cancelled 0','# cancelled 1')},f=>{f.commands[0].exitCode=1},f=>{f.commands[0].exitCode=undefined;f.commands[0].output='all tests passed'},f=>{f.arm.deliveryValidation.commandExits[0].toolCallId='unobserved'},f=>{f.commands[0].command=f.commands[0].command.replace('node --test','node --test --test-name-pattern=one-test')},f=>{f.commands[0].command=f.commands[0].command.replace('GREENFIELD_DELIVERY_ROOT=/tmp/native-delivery-fixture','GREENFIELD_DELIVERY_ROOT=/tmp/other')},f=>{f.arm.deliveryValidation.actionlint.output='ACTIONLINT_UNAVAILABLE invented'},f=>{f.commands[1].command="cd '/tmp/native-delivery-fixture' && echo ACTIONLINT_UNAVAILABLE"}]) {
    const f=deliveryValidatorFixture();try {mutate(f);assert.throws(()=>evidence.validateDeliveryEvidence(f),{name:'AssertionError'})} finally {f.close()}
  }
})
test('delivery contract: preexisting workflows require exact explicit merge decision and preserve-until-approval contract',()=>{
  const f=deliveryValidatorFixture(),existing='.github/workflows/ci.yml'
  try {
    f.arm.kind='brownfield'
    const original=readFileSync(f.arm.artifacts[existing].path,'utf8')
    const retainedBefore=resolve(dirname(f.arm.artifacts[existing].path),'before-ci.yml')
    writeFileSync(retainedBefore,original)
    f.arm.existingWorkflowArtifacts={[existing]:{path:retainedBefore,sha256:sha256(original)}}
    f.before[existing]={sha256:sha256(original),mode:33188}
    assert.throws(()=>evidence.validateDeliveryEvidence(f),{name:'AssertionError'})
    for(const delivery of [f.arm.delivery,f.proposal.delivery])delivery.collision={existingPaths:[existing],decision:'merge',preserveUntilApproval:true,mergeManifests:{[existing]:deliveryMergeManifest(original,original)}}
    assert.doesNotThrow(()=>evidence.validateDeliveryEvidence(f))
    f.proposal.delivery.collision.existingPaths.push('.github/workflows/unobserved.yml')
    f.arm.delivery=structuredClone(f.proposal.delivery)
    assert.throws(()=>evidence.validateDeliveryEvidence(f),{name:'AssertionError'})
  } finally {f.close()}
})
test('delivery contract: self-consistent retained hashes cannot authorize a different planner, adapter or release environment',()=>{
  for(const [path,replace] of [
    ['scripts/ci-shard-plan.mjs',text=>text+'\n// altered after template selection\n'],
    ['.github/greenfield-delivery.json',text=>JSON.stringify({...JSON.parse(text),archetype:'web'})],
    ['.github/workflows/release.yml',text=>text.replace('environment: approved-release-environment','environment: unapproved-environment')],
  ]) {
    const f=deliveryValidatorFixture()
    try {
      const reference=f.arm.artifacts[path],changed=replace(readFileSync(reference.path,'utf8'))
      writeFileSync(reference.path,changed);reference.sha256=sha256(changed);f.after[path].sha256=reference.sha256
      assert.throws(()=>evidence.validateDeliveryEvidence(f),{name:'AssertionError'})
    } finally {f.close()}
  }
})

const mergeYaml=createRequire(resolve(ROOT,'package.json'))('js-yaml')
function deliveryMergeManifest(beforeText,afterText,replaced=[]) {
  const prior=mergeYaml.safeLoad(beforeText),installed=mergeYaml.safeLoad(afterText)
  return {beforeSha256:sha256(beforeText),preservedJobs:Object.keys(prior.jobs??{}).sort(),preservedTopLevel:Object.keys(prior).filter(key=>key!=='jobs'&&!replaced.includes(key)).sort(),replacements:Object.fromEntries(replaced.map(key=>[key,{before:prior[key],after:installed[key]}])),preservedComments:beforeText.split('\n').filter(line=>/^\s*#/.test(line))}
}
// Synthetic merge parser fixture: real YAML structures, never native receipts.
function deliveryMergeFixture() {
  const f=deliveryValidatorFixture(),path='.github/workflows/ci.yml'
  f.arm.kind='brownfield'
  const canonicalText=readFileSync(f.arm.artifacts[path].path,'utf8')
  const comments='# Existing workflow policy owner\n  # Preserve this exact indentation\n'
  const policy='env:\n  RETENTION_POLICY: preserve\n'
  const installed=comments+policy+canonicalText
  const priorDocument=mergeYaml.safeLoad(canonicalText)
  priorDocument.on={workflow_dispatch:{inputs:{reason:{required:true,type:'string'}}}}
  const baseline=comments+policy+mergeYaml.safeDump(priorDocument,{lineWidth:-1,noRefs:true})
  const beforePath=resolve(dirname(f.arm.artifacts[path].path),'retained-merge-before.yml')
  writeFileSync(beforePath,baseline)
  f.arm.existingWorkflowArtifacts={[path]:{path:beforePath,sha256:sha256(baseline)}}
  f.before[path]={sha256:sha256(baseline),mode:33188}
  writeFileSync(f.arm.artifacts[path].path,installed)
  f.arm.artifacts[path].sha256=sha256(installed);f.after[path].sha256=sha256(installed)
  for(const delivery of [f.arm.delivery,f.proposal.delivery])delivery.collision={existingPaths:[path],decision:'merge',preserveUntilApproval:true,mergeManifests:{[path]:deliveryMergeManifest(baseline,installed,['on'])}}
  return {...f,path,baseline,installed,changeManifest(mutate){for(const delivery of [f.arm.delivery,f.proposal.delivery])mutate(delivery.collision)},changeInstalled(text){writeFileSync(f.arm.artifacts[path].path,text);f.arm.artifacts[path].sha256=sha256(text);f.after[path].sha256=sha256(text)}}
}
test('delivery merge manifest: complete retained policy, jobs, comments and exact trigger replacement validate',()=>{
  const f=deliveryMergeFixture()
  try {assert.doesNotThrow(()=>evidence.validateDeliveryEvidence(f))} finally {f.close()}
})
test('delivery merge manifest: missing or incomplete preservation proof and wrong baseline digest fail closed',()=>{
  for(const mutate of [c=>{delete c.mergeManifests},c=>{c.mergeManifests['.github/workflows/ci.yml'].beforeSha256='0'.repeat(64)},c=>{c.mergeManifests['.github/workflows/ci.yml'].preservedJobs.pop()},c=>{c.mergeManifests['.github/workflows/ci.yml'].preservedTopLevel=c.mergeManifests['.github/workflows/ci.yml'].preservedTopLevel.filter(key=>key!=='env')},c=>{c.mergeManifests['.github/workflows/ci.yml'].preservedComments.pop()}]) {
    const f=deliveryMergeFixture()
    try {f.changeManifest(mutate);assert.throws(()=>evidence.validateDeliveryEvidence(f),{name:'AssertionError'})} finally {f.close()}
  }
})
test('delivery merge manifest: deleting or changing baseline comments and top-level policy is not authorized by job preservation',()=>{
  for(const mutate of [text=>text.replace('# Existing workflow policy owner\n',''),text=>text.replace('  # Preserve this exact indentation','# Preserve this exact indentation'),text=>text.replace('env:\n  RETENTION_POLICY: preserve\n',''),text=>text.replace('RETENTION_POLICY: preserve','RETENTION_POLICY: discard')]) {
    const f=deliveryMergeFixture()
    try {f.changeInstalled(mutate(f.installed));assert.throws(()=>evidence.validateDeliveryEvidence(f),{name:'AssertionError'})} finally {f.close()}
  }
})
test('delivery merge manifest: replacing prior trigger requires exact declared before and after values',()=>{
  for(const mutate of [manifest=>{delete manifest.replacements.on;manifest.preservedTopLevel.push('on')},manifest=>{manifest.replacements.on.before={push:null}},manifest=>{manifest.replacements.on.after={workflow_dispatch:null}},manifest=>{delete manifest.replacements.on}]) {
    const f=deliveryMergeFixture()
    try {f.changeManifest(c=>mutate(c.mergeManifests[f.path]));assert.throws(()=>evidence.validateDeliveryEvidence(f),{name:'AssertionError'})} finally {f.close()}
  }
})
