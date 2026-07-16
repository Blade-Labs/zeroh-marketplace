#!/usr/bin/env node
/**
 * Fixtures for `roadmap gate plan` — seeded tmp git repos (a mini roadmap + a
 * ROADMAP_CONFIG fixture config) driven through the REAL bin/roadmap.mjs. Phase files
 * are plain `export default {…}` objects so the fixtures own every field
 * (kind/testScope/reviewScope/designRefs/keyFiles) without the real schema's strictness;
 * bridgeImport returns the default export verbatim. Cases: the 136-vs-1369 em-dash
 * baseSha boundary + parent-of-oldest, --base override, exit-2 floor refusal, ladder-off
 * → full, docs-only → static/none, designParity, and the FOREIGN-COMMIT case. Run:
 * node --test cli/commands/gate.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const BIN = join(HERE, '..', '..', 'bin', 'roadmap.mjs')

const bases = []
process.on('exit', () => bases.forEach((b) => rmSync(b, { recursive: true, force: true })))

const CONFIG = {
  configVersion: 1,
  gateCommands: {
    lint: 'npm run lint',
    types: 'npm run type-check',
    unit: 'bash run-tier.sh unit',
    integration: 'bash run-tier.sh integration',
    build: 'npm run build',
    e2e: 'npm run e2e',
    emit: 'npm run emit',
    'integration-scoped': 'bash run-tier.sh integration-scoped {files}',
    'unit-scoped': 'bash run-tier.sh unit-scoped {files}',
  },
  testCadence: { enabled: true, backstop: 'ci-pr-gate + nightly', floors: 'blocking' },
  gateSpecialists: [{ paths: ['src/relay/**', 'src/masking*'], agent: '.claude/agents/governed-spine-reviewer.md' }],
}

/** A git repo with a mini roadmap. Returns { root, git, writePhase, commit }. */
function makeRepo(configOverride) {
  const root = mkdtempSync(join(tmpdir(), 'zr-gate-'))
  bases.push(root)
  mkdirSync(join(root, 'roadmap', 'phases'), { recursive: true })
  writeFileSync(join(root, 'roadmap', 'roadmap.config.json'), JSON.stringify(configOverride ?? CONFIG))
  const git = (...a) =>
    execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    })
  git('init', '-q')
  git('add', '-A')
  git('commit', '-q', '-m', 'seed roadmap')
  // Commit the phase file in its OWN non-phase-tagged seed commit so it never lands in
  // the phase-own diff (git add -A on a later work commit would otherwise pull it in).
  const writePhase = (num, obj) => {
    writeFileSync(join(root, 'roadmap', 'phases', `phase-${num}.phase.ts`), `export default ${JSON.stringify(obj, null, 2)}\n`)
    git('add', join('roadmap', 'phases', `phase-${num}.phase.ts`))
    git('commit', '-q', '-m', `seed phase-${num} file`) // NO em-dash → not phase-own
  }
  const commit = (msg, files) => {
    for (const [rel, body] of Object.entries(files)) {
      const abs = join(root, rel)
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, body)
    }
    git('add', '-A')
    git('commit', '-q', '-m', msg)
  }
  return { root, git, writePhase, commit }
}

function planOf(root, args) {
  try {
    const stdout = execFileSync('node', [BIN, 'gate', 'plan', ...args], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ROADMAP_CONFIG: join(root, 'roadmap', 'roadmap.config.json') },
    })
    return { code: 0, plan: JSON.parse(stdout), stderr: '' }
  } catch (err) {
    const stdout = (err.stdout ?? '').toString()
    let plan = null
    try {
      plan = JSON.parse(stdout)
    } catch {
      /* not JSON */
    }
    return { code: err.status ?? 1, plan, stderr: (err.stderr ?? '').toString() }
  }
}

const phaseObj = (over) => ({ phase: over.phase, kind: 'logic', tasks: [], keyFiles: [], designRefs: [], ...over })

test('gate plan — baseSha is the parent of the OLDEST phase-own commit; the em-dash boundary keeps 136 ≠ 1369', () => {
  const repo = makeRepo()
  repo.writePhase(136, phaseObj({ phase: 136 }))
  repo.writePhase(1369, phaseObj({ phase: 1369 }))
  // A 1369 commit FIRST, then two 136 commits. 136's baseSha must be the parent of the
  // FIRST 136 commit — NOT confused by the earlier 1369 commit (the em-dash boundary).
  repo.commit('feat: phase 1369 — unrelated', { 'src/other.ts': 'export const a = 1\n' })
  const parentSha = repo.git('rev-parse', 'HEAD').trim()
  repo.commit('feat: phase 136 — first', { 'lib/a.ts': 'export const a = 1\n' })
  const first136 = repo.git('rev-parse', 'HEAD').trim()
  repo.commit('feat: phase 136 — second', { 'lib/b.ts': 'export const b = 2\n' })

  const r = planOf(repo.root, ['136'])
  assert.equal(r.code, 0, r.stderr)
  assert.equal(r.plan.baseSha, parentSha, 'baseSha = parent of the oldest 136 commit, not the 1369 one')
  // 136's own files are lib/a.ts + lib/b.ts — NOT src/other.ts (the 1369 commit)
  assert.ok(r.plan.diff.files === 2, `phase-own file count: ${r.plan.diff.files}`)
})

test('gate plan — --base overrides the derivation', () => {
  const repo = makeRepo()
  repo.writePhase(200, phaseObj({ phase: 200 }))
  repo.commit('feat: phase 200 — x', { 'lib/x.ts': 'export const x = 1\n' })
  const seed = repo.git('rev-parse', 'HEAD~1').trim()
  const r = planOf(repo.root, ['200', '--base', seed])
  assert.equal(r.code, 0, r.stderr)
  assert.equal(r.plan.baseSha, seed)
})

test('gate plan — a declared static over a SPECIALIST-path diff REFUSES with exit 2', () => {
  const repo = makeRepo()
  repo.writePhase(300, phaseObj({ phase: 300, testScope: 'static' }))
  repo.commit('feat: phase 300 — spine', { 'src/relay/governed-turn.ts': 'export const x = 1\n' })
  const r = planOf(repo.root, ['300'])
  assert.equal(r.code, 2, 'floor violation must exit 2')
  assert.ok(r.plan, 'the JSON plan is still printed (refusal is the exit code, not a paragraph)')
  assert.match(r.plan.testScope.refused, /Gate specialists floor: relevant/)
})

test('gate plan — a ladder-OFF consumer (no testCadence) yields effective full', () => {
  const cfg = { ...CONFIG, testCadence: undefined }
  delete cfg.testCadence
  const repo = makeRepo(cfg)
  repo.writePhase(400, phaseObj({ phase: 400 }))
  repo.commit('feat: phase 400 — code', { 'lib/y.ts': 'export const y = 1\n' })
  const r = planOf(repo.root, ['400'])
  assert.equal(r.code, 0, r.stderr)
  assert.equal(r.plan.testScope.effective, 'full')
})

test('gate plan — a docs-only diff yields static test scope + none review scope', () => {
  const repo = makeRepo()
  repo.writePhase(500, phaseObj({ phase: 500 }))
  repo.commit('docs: phase 500 — notes', { 'docs/readme.md': '# hi\n' })
  const r = planOf(repo.root, ['500'])
  assert.equal(r.code, 0, r.stderr)
  assert.equal(r.plan.testScope.effective, 'static')
  assert.equal(r.plan.reviewScope.effective, 'none')
})

test('gate plan — designParity.required when the phase cites a ux designRef', () => {
  const repo = makeRepo()
  repo.writePhase(600, phaseObj({ phase: 600, designRefs: [{ kind: 'ux', ref: 'docs/ux-previews/x.html' }] }))
  repo.commit('feat: phase 600 — ui', { 'web/x.ts': 'export const x = 1\n' })
  const r = planOf(repo.root, ['600'])
  assert.equal(r.code, 0, r.stderr)
  assert.equal(r.plan.designParity.required, true)
  assert.equal(r.plan.designParity.designRef, 'docs/ux-previews/x.html')
})

test('gate plan — the plan JSON carries every field of the design sketch', () => {
  const repo = makeRepo()
  repo.writePhase(700, phaseObj({ phase: 700 }))
  repo.commit('feat: phase 700 — code', { 'lib/z.ts': 'export const z = 1\n' })
  const r = planOf(repo.root, ['700'])
  assert.equal(r.code, 0, r.stderr)
  for (const k of ['phase', 'kind', 'mode', 'baseSha', 'diff', 'testScope', 'reviewScope', 'slots', 'agents', 'designParity', 'notes']) {
    assert.ok(k in r.plan, `plan.${k} present`)
  }
  for (const k of ['files', 'classes', 'specialistPaths']) assert.ok(k in r.plan.diff, `diff.${k}`)
})

test('gate plan — FOREIGN commit in range: scope binds to phase-own files, foreignCommitsInRange lists the rest', () => {
  const repo = makeRepo()
  repo.writePhase(800, phaseObj({ phase: 800 }))
  // Phase-own commits: docs-only. A SIBLING src/relay commit lands in the same range.
  repo.commit('docs: phase 800 — first', { 'docs/a.md': '# a\n' })
  const base = repo.git('rev-parse', 'HEAD~1').trim()
  repo.commit('feat: SIBLING relay work (no phase tag)', { 'src/relay/governed-turn.ts': 'export const x = 1\n' })
  repo.commit('docs: phase 800 — second', { 'docs/b.md': '# b\n' })

  const r = planOf(repo.root, ['800', '--base', base])
  assert.equal(r.code, 0, `no specialist floor should fire on the phase-own (docs-only) set; stderr: ${r.stderr}`)
  // scope binds to phase-own docs-only files → no specialist floor, effective static
  assert.equal(r.plan.testScope.effective, 'static')
  assert.deepEqual(r.plan.diff.specialistPaths, [])
  // the foreign relay file is surfaced, not scoped in
  assert.ok(r.plan.foreignCommitsInRange.includes('src/relay/governed-turn.ts'))
})
