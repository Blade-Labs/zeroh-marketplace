#!/usr/bin/env node
/**
 * arc.test.mjs — `roadmap arc next` / `arc record-validate` at the CLI entry (arc
 * ROADCODE 1657.2). Drives the REAL bin/roadmap.mjs over scratch git repos; asserts
 * the universal exit contract (0 any derived action incl complete · 2 blocked · 1
 * config/tsx) and the record-validate → arc next round-trip (gates.validated false →
 * write PASS → true). Run: node --test cli/commands/arc.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { consumerSchemaPath } from '../lib/roadmap-root.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const BIN = join(HERE, '..', '..', 'bin', 'roadmap.mjs')
const bases = []
process.on('exit', () => bases.forEach((b) => rmSync(b, { recursive: true, force: true })))

const tsSrc = (obj) =>
  'export default ' + JSON.stringify(obj, null, 2).replace(/"([\w$]+)":/g, '$1:').replace(/"/g, "'") + '\n'
const CONFIG = { configVersion: 1, gateCommands: { lint: 'l', types: 't', unit: 'u', integration: 'i', build: 'b', e2e: 'none', emit: 'e' } }

function makeRepo(arcId, arc, phases, { configJson = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'zr-arc-'))
  bases.push(root)
  mkdirSync(join(root, 'roadmap', 'phases'), { recursive: true })
  mkdirSync(join(root, 'roadmap', 'arcs'), { recursive: true })
  writeFileSync(join(root, 'roadmap', 'arcs', `${arcId}.arc.ts`), tsSrc({ id: arcId, baseRef: 'develop', ...arc }))
  for (const p of phases) writeFileSync(join(root, 'roadmap', 'phases', `phase-${p.phase}.phase.ts`), tsSrc(p))
  if (configJson) writeFileSync(join(root, 'roadmap', 'roadmap.config.json'), JSON.stringify(CONFIG))
  // Minimal consumer registry so the REAL debt-census.mts (imported by runDebtCensus via
  // `npx --no-install tsx`) runs over the scratch repo and reports an empty (swept) slice —
  // the census is exhaustively exercised with fakes in derive.test.mjs; here it is real e2e.
  mkdirSync(join(root, 'lib', 'roadmap'), { recursive: true })
  symlinkSync(consumerSchemaPath(resolve(HERE, '..', '..', '..', '..')), join(root, 'lib', 'roadmap', 'schema.ts'))
  writeFileSync(
    join(root, 'lib', 'roadmap', 'registry.ts'),
    'export async function discoverPhases() { return { phases: [], errors: [] } }\n'
      + 'export async function discoverArcs() { return { arcs: [] } }\n',
  )
  execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'init', '-q'])
  execFileSync('git', ['-C', root, 'add', '-A'])
  execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'seed'])
  return root
}

function bin(root, args) {
  try {
    const stdout = execFileSync('node', [BIN, ...args], { cwd: root, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, stdout }
  } catch (e) {
    return { code: e.status ?? 1, stdout: (e.stdout ?? '').toString(), stderr: (e.stderr ?? '').toString() }
  }
}

const backlog = (n) => ({ phase: n, status: 'backlog', arcId: 'A', tasks: [{ id: `${n}.1`, done: false }] })
const done = (n) => ({ phase: n, status: 'done', arcId: 'A', tasks: [{ id: `${n}.1`, done: true }] })

test('arc next — exit 0 with a derived run-phase action, JSON on stdout', () => {
  const root = makeRepo('A', { planes: [{ name: 'P', phases: [10] }] }, [backlog(10)])
  const r = bin(root, ['arc', 'next', 'A', '--json', '--ignore-capacity'])
  assert.equal(r.code, 0)
  const pos = JSON.parse(r.stdout)
  assert.equal(pos.action, 'run-phase')
  assert.equal(pos.phase, 10)
})

test('arc next — exit 2 on a blocked lane (foreign worktree sidecar)', () => {
  const root = makeRepo('A', { planes: [{ name: 'P', phases: [10] }] }, [backlog(10)])
  mkdirSync(join(root, 'roadmap', 'arcs', '.building'), { recursive: true })
  writeFileSync(join(root, 'roadmap', 'arcs', '.building', 'A.json'), JSON.stringify({ arcId: 'A', worktree: '/some/other/tree' }))
  const r = bin(root, ['arc', 'next', 'A'])
  assert.equal(r.code, 2)
  assert.match(r.stdout, /"action": "blocked"/)
})

test('arc next — exit 1 when config.json is absent (usage/config error)', () => {
  const root = makeRepo('A', { planes: [{ name: 'P', phases: [10] }] }, [backlog(10)], { configJson: false })
  const r = bin(root, ['arc', 'next', 'A'])
  assert.equal(r.code, 1)
})

test('arc next — exit 0 for the post-land evaluate action', () => {
  const root = makeRepo('A', { planes: [{ name: 'P', phases: [10] }] }, [done(10)])
  writeFileSync(join(root, 'roadmap', 'arc-summary.json'), JSON.stringify({
    arcId: 'A', outcome: 'shipped', compromiseDisposition: [],
    gateSignals: { arcSweepClean: true, validateArcPassed: true, fullSuiteGreen: true }, receiptRef: 'none',
  }))
  const r = bin(root, ['arc', 'next', 'A', '--json'])
  assert.equal(r.code, 0)
  assert.equal(JSON.parse(r.stdout).action, 'evaluate')
})

test('record-validate → arc next round-trip: gates.validated false → write PASS → true → land', () => {
  const root = makeRepo('A', { planes: [{ name: 'P', phases: [10] }], acceptanceCriteria: [{ id: 'c1', job: 'x' }] }, [done(10)])
  // Before stamping: swept but not validated → action validate.
  let r = bin(root, ['arc', 'next', 'A', '--json'])
  assert.equal(r.code, 0)
  assert.equal(JSON.parse(r.stdout).gates.validated, false)
  assert.equal(JSON.parse(r.stdout).action, 'validate')
  // Stamp PASS.
  r = bin(root, ['arc', 'record-validate', 'A', '--verdict', 'PASS'])
  assert.equal(r.code, 0)
  // After: validated true → PR delivery.
  r = bin(root, ['arc', 'next', 'A', '--json'])
  const pos = JSON.parse(r.stdout)
  assert.equal(pos.gates.validated, true)
  assert.equal(pos.action, 'deliver')
})

test('record-validate — a bad verdict is a usage error (exit 1)', () => {
  const root = makeRepo('A', { planes: [{ name: 'P', phases: [10] }] }, [done(10)])
  assert.equal(bin(root, ['arc', 'record-validate', 'A', '--verdict', 'MAYBE']).code, 1)
})

test('arc normalize without an arc id is a normalize-specific usage refusal', () => {
  const root = makeRepo('A', { planes: [{ name: 'P', phases: [10] }] }, [backlog(10)])
  const result = bin(root, ['arc', 'normalize'])
  assert.equal(result.code, 1)
  assert.match(result.stderr, /usage: roadmap arc normalize <arcId> \[--apply\] \[--json\]/)
})

import runArc from './arc.mjs'
test('arc plane is the supported Node entry and maps real workflow handoffs to exits',async()=>{
 const cases=[[{handoffInline:{route:'handoff-inline'},phase:41},'phase-required',3],[{handoff:'awaiting-ci'},'handoff',3],[{handoff:'deliver'},'handoff',0],[{planeDone:true},'plane-done',0],[{done:true},'done',0],[{halt:'failed'},'halted',2]]
 for(const [result,status,code] of cases){const calls=[],out=[];const actual=await runArc(['plane','FX','P','--inline','--json'],{workflow:async input=>{calls.push(input);return result},stdout:text=>out.push(text),stderr:()=>{}});assert.equal(actual,code,status);assert.deepEqual(calls,[{arcId:'FX',planeName:'P',force:'inline'}]);assert.equal(JSON.parse(out.join('')).status,status);assert.deepEqual(Object.keys(JSON.parse(out.join(''))).sort(),['status','arcId','plane','phase','handoff','resume'].sort())}
})
test('arc plane rejects missing identifiers, traversal and unsupported or duplicate flags',async()=>{
 for(const argv of [['plane'],['plane','FX'],['plane','FX','P','--recursion'],['plane','FX','P','--inline','--inline'],['plane','../FX','P','--inline']]){let calls=0;const code=await runArc(argv,{workflow:async()=>{calls++;return {done:true}},stdout:()=>{},stderr:()=>{}});assert.equal(code,1);assert.equal(calls,0)}
})


test('arc plane forwards human labels and resume preserves literal shell arguments',async()=>{
 const scratch=mkdtempSync(join(tmpdir(),'zr-arc-resume-'));bases.push(scratch)
 const sentinel=join(scratch,'must-not-exist')
 const arcId='ARC;echo-not-code',planeName=`Integrity & measurement's $(touch ${sentinel})`
 const calls=[],out=[]
 const code=await runArc(['plane',arcId,planeName,'--inline','--json'],{workflow:async input=>{calls.push(input);return {handoffInline:{route:'handoff-inline'},phase:41}},stdout:text=>out.push(text),stderr:()=>{}})
 assert.equal(code,3)
 assert.deepEqual(calls,[{arcId,planeName,force:'inline'}])
 const report=JSON.parse(out.join(''))
 const parsed=execFileSync('bash',['-c',`set -- ${report.resume}; printf '%s\\0' "$@"`],{encoding:'utf8'}).split('\0').filter(Boolean)
 assert.deepEqual(parsed,['roadmap','arc','plane',arcId,planeName,'--inline','--json'])
 assert.equal(existsSync(sentinel),false)
 for(const plane of ['', 'bad\0plane']){let called=false;assert.equal(await runArc(['plane','FX',plane],{workflow:async()=>{called=true;return {done:true}},stderr:()=>{}}),1);assert.equal(called,false)}
})
