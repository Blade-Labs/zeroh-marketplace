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
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, symlinkSync, realpathSync, rmSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { untestedGateFixFindings, deviantGrammarFindings } from './gate.mjs'
import { phaseOwnPatterns } from '../lib/gitscan.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = join(HERE, '..', '..')
const BIN = join(PLUGIN_ROOT, 'bin', 'roadmap.mjs')

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

/**
 * Seed the seam-3 toolchain a bridge-validated write needs: lib/roadmap/schema.ts re-exporting
 * the plugin's templates/schema.ts plus a node_modules/zod symlink so the consumer resolves its
 * own zod (the eval.test.mjs makeConsumer pattern). package.json fixes the fingerprint language
 * to a known value instead of 'unknown'.
 */
function seedConsumerSchema(root) {
  mkdirSync(join(root, 'lib', 'roadmap'), { recursive: true })
  writeFileSync(join(root, 'lib', 'roadmap', 'schema.ts'), `export * from '${join(PLUGIN_ROOT, 'templates', 'schema.ts')}'\n`)
  mkdirSync(join(root, 'node_modules'), { recursive: true })
  symlinkSync(realpathSync(join(PLUGIN_ROOT, 'node_modules', 'zod')), join(root, 'node_modules', 'zod'), 'dir')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: basename(root), private: true }))
  writeFileSync(join(root, '.gitignore'), 'node_modules\n')
}

/** A git repo with a mini roadmap. Returns { root, git, writePhase, commit }.
 *  opts.consumerSchema seeds the schema + zod seam (off by default: the plan fixtures never
 *  validate a document through the consumer). */
function makeRepo(configOverride, opts = {}) {
  const root = mkdtempSync(join(tmpdir(), 'zr-gate-'))
  bases.push(root)
  mkdirSync(join(root, 'roadmap', 'phases'), { recursive: true })
  writeFileSync(join(root, 'roadmap', 'roadmap.config.json'), JSON.stringify(configOverride ?? CONFIG))
  if (opts.consumerSchema) seedConsumerSchema(root)
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

test('gate plan — D1: an ancient `phase N —` mention + a newer move-to-in-progress → base is the move-commit parent, no false specialist floor', () => {
  const repo = makeRepo()
  repo.writePhase(7305, phaseObj({ phase: 7305 }))
  // Ancient `phase 7305 —` commit touching a SPINE path — this is the D1 trap: under the
  // oldest-match rule its parent becomes the base and src/relay pollutes the phase-own set.
  repo.commit('docs: phase 7305 — old mention', { 'src/relay/governed-turn.ts': 'export const x = 1\n' })
  // Newer move-to-in-progress commit (docs-only) + real docs-only work.
  repo.commit('plan(roadmap): phase 7305 — move to in-progress', { 'docs/plan.md': '# plan\n' })
  const moveParent = repo.git('rev-parse', 'HEAD~1').trim() // parent of the move commit = the ancient commit
  repo.commit('docs: phase 7305 — work', { 'docs/work.md': '# work\n' })
  const r = planOf(repo.root, ['7305'])
  assert.equal(r.code, 0, `no floor should fire once the ancient relay file is excluded; stderr: ${r.stderr}`)
  assert.equal(r.plan.baseSha, moveParent, 'baseSha = parent of the NEWEST move-to-in-progress commit')
  assert.deepEqual(r.plan.diff.specialistPaths, [], 'the ancient spine file is before the base, excluded from phase-own')
})

test('gate plan — D6: an ancient spine mention with NO move-commit → --base excludes it from diff/floor', () => {
  const repo = makeRepo()
  repo.writePhase(7306, phaseObj({ phase: 7306 }))
  repo.commit('docs: phase 7306 — old mention', { 'src/relay/governed-turn.ts': 'export const x = 1\n' })
  const recent = repo.git('rev-parse', 'HEAD').trim()
  repo.commit('docs: phase 7306 — work', { 'docs/w.md': '# w\n' })
  const r = planOf(repo.root, ['7306', '--base', recent])
  assert.equal(r.code, 0, `--base must exclude the ancient spine file; stderr: ${r.stderr}`)
  assert.equal(r.plan.baseSha, recent)
  assert.deepEqual(r.plan.diff.specialistPaths, [], 'the ancient spine file is at/before --base, excluded')
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

// ── untestedGateFixFindings — the MECHRATCHET rank-9 detection helper ────────────────────
test('untestedGateFixFindings — a gate-fix touching ONLY source → one finding naming its sha7 + subject', () => {
  const repo = makeRepo()
  repo.commit('feat: phase 500 — work', { 'lib/a.ts': 'export const a = 1\n' })
  const base = repo.git('rev-parse', 'HEAD').trim()
  repo.commit('fix(core): phase 500 gate R1', { 'lib/a.ts': 'export const a = 2\n' })
  const sha = repo.git('rev-parse', 'HEAD').trim()
  const findings = untestedGateFixFindings(repo.root, 500, base)
  assert.equal(findings.length, 1, JSON.stringify(findings))
  assert.match(findings[0], new RegExp(sha.slice(0, 7)), 'names the fix sha7')
  assert.match(findings[0], /fix\(core\): phase 500 gate R1/, 'quotes the subject')
  assert.match(findings[0], /untested gate-fix/, 'is the named warning class')
})

test('untestedGateFixFindings — a gate-fix touching src + a .test.mjs sibling → no finding', () => {
  const repo = makeRepo()
  repo.commit('feat: phase 501 — work', { 'lib/a.ts': 'export const a = 1\n' })
  const base = repo.git('rev-parse', 'HEAD').trim()
  repo.commit('fix(core): phase 501 gate R1', { 'lib/a.ts': 'export const a = 2\n', 'lib/a.test.mjs': 'export const t = 1\n' })
  assert.deepEqual(untestedGateFixFindings(repo.root, 501, base), [], 'a test in the diff clears the warning')
})

test('untestedGateFixFindings — a docs-only gate-fix → no finding (no executable source touched)', () => {
  const repo = makeRepo()
  repo.commit('feat: phase 502 — work', { 'lib/a.ts': 'export const a = 1\n' })
  const base = repo.git('rev-parse', 'HEAD').trim()
  repo.commit('fix(docs): phase 502 gate R1', { 'docs/note.md': '# note\n' })
  assert.deepEqual(untestedGateFixFindings(repo.root, 502, base), [], 'a non-executable-only diff is not a source-without-test fix')
})

test('untestedGateFixFindings — a non-gate-fix subject (feat) touching only src → no finding', () => {
  const repo = makeRepo()
  repo.commit('feat: phase 503 — work', { 'lib/a.ts': 'export const a = 1\n' })
  const base = repo.git('rev-parse', 'HEAD').trim()
  repo.commit('feat(core): phase 503 — more', { 'lib/a.ts': 'export const a = 2\n' })
  assert.deepEqual(untestedGateFixFindings(repo.root, 503, base), [], 'only fix(... gate R*) subjects are in scope')
})

// ── deviantGrammarFindings — the 1696/1699 task-id-before-em-dash attribution defeat ─────
test('deviantGrammarFindings — a `phase N N.X —` subject → one finding naming its sha7 + subject', () => {
  const repo = makeRepo()
  repo.commit('feat: phase 7301 — move to in-progress', { 'lib/a.ts': 'export const a = 1\n' })
  const base = repo.git('rev-parse', 'HEAD').trim()
  repo.commit('feat(x): phase 7301 7301.2 — work', { 'lib/a.ts': 'export const a = 2\n' })
  const sha = repo.git('rev-parse', 'HEAD').trim()
  const findings = deviantGrammarFindings(repo.root, 7301, base)
  assert.equal(findings.length, 1, JSON.stringify(findings))
  assert.match(findings[0], new RegExp(sha.slice(0, 7)), 'names the deviant sha7')
  assert.match(findings[0], /feat\(x\): phase 7301 7301\.2 — work/, 'quotes the subject')
  assert.match(findings[0], /attribution-breaking commit grammar/, 'is the named warning class')
})

test('deviantGrammarFindings — the correct `phase N — N.X` form → no finding', () => {
  const repo = makeRepo()
  repo.commit('feat: phase 7301 — move to in-progress', { 'lib/a.ts': 'export const a = 1\n' })
  const base = repo.git('rev-parse', 'HEAD').trim()
  repo.commit('feat(x): phase 7301 — 7301.2 work', { 'lib/a.ts': 'export const a = 2\n' })
  assert.deepEqual(deviantGrammarFindings(repo.root, 7301, base), [], 'the em-dash-first form is the correct grammar')
})

test('deviantGrammarFindings — a DIFFERENT phase\'s deviant commit → no finding for this phase', () => {
  const repo = makeRepo()
  repo.commit('feat: phase 7301 — move to in-progress', { 'lib/a.ts': 'export const a = 1\n' })
  const base = repo.git('rev-parse', 'HEAD').trim()
  repo.commit('feat(x): phase 7302 7302.1 — other', { 'lib/b.ts': 'export const b = 2\n' })
  assert.deepEqual(deviantGrammarFindings(repo.root, 7301, base), [], 'a different phase number is out of scope')
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

// ── the "1661 class" (ROADCODE D6): a docs-only phase on a heavily-interleaved shared
//    branch derives a docs floor; foreign + MERGE commits never enter phase-own attribution.
//    Regression locks over the EXISTING phaseOwnFiles em-dash grep + gitscan move-commit base.
test('gate plan — 1661 class: docs-only phase interleaved with foreign exec commits derives the docs floor; foreign + phase files never cross', () => {
  const repo = makeRepo()
  repo.writePhase(5001, phaseObj({ phase: 5001 }))
  // move-to-in-progress (docs-only) fixes the base at its parent (gitscan Tier 1).
  repo.commit('plan(roadmap): phase 5001 — move to in-progress', { 'roadmap/plan.md': '# plan\n' })
  const moveParent = repo.git('rev-parse', 'HEAD~1').trim()
  // Foreign exec work interleaved between the phase's own docs commits — no phase subject.
  repo.commit('feat: sibling relay work (no phase tag)', { 'src/relay/governed-turn.ts': 'export const a = 1\n' })
  repo.commit('docs: phase 5001 — notes one', { 'roadmap/a.md': '# a\n' })
  repo.commit('refactor: other module (no phase tag)', { 'src/model/select.ts': 'export const b = 2\n' })
  repo.commit('docs: phase 5001 — notes two', { 'roadmap/b.md': '# b\n' })

  const r = planOf(repo.root, ['5001'])
  assert.equal(r.code, 0, `docs-only phase-own set → no specialist floor; stderr: ${r.stderr}`)
  assert.equal(r.plan.baseSha, moveParent, 'base = parent of the newest move-to-in-progress commit')
  // phase-own = the three roadmap/*.md docs files (move + two notes) — NOT the foreign exec files
  assert.equal(r.plan.diff.files, 3, `phase-own file count: ${r.plan.diff.files}`)
  assert.deepEqual(r.plan.diff.classes, ['docs'], 'phase-own set is docs-only')
  assert.deepEqual(r.plan.diff.specialistPaths, [], 'no foreign spine file leaks into the floor')
  assert.equal(r.plan.testScope.effective, 'static', 'docs-tier floor')
  // both foreign exec files surfaced, never scoped in
  assert.ok(r.plan.foreignCommitsInRange.includes('src/relay/governed-turn.ts'), 'foreign relay file surfaced')
  assert.ok(r.plan.foreignCommitsInRange.includes('src/model/select.ts'), 'second foreign exec file surfaced')
})

test('gate plan — 1661 class: a plain (foreign, no phase subject) merge commit in range is excluded — no crash, no leak', () => {
  const repo = makeRepo()
  repo.writePhase(5002, phaseObj({ phase: 5002 }))
  repo.commit('plan(roadmap): phase 5002 — move to in-progress', { 'roadmap/plan.md': '# plan\n' })
  const moveParent = repo.git('rev-parse', 'HEAD~1').trim()
  const branch = repo.git('rev-parse', '--abbrev-ref', 'HEAD').trim()
  repo.git('checkout', '-q', '-b', 'sib2')
  repo.commit('feat: sibling relay work on a branch', { 'src/relay/governed-turn.ts': 'export const a = 1\n' })
  repo.git('checkout', '-q', branch)
  repo.git('merge', '--no-ff', '-q', '-m', 'Merge branch sib2', 'sib2')
  repo.commit('docs: phase 5002 — work', { 'roadmap/w.md': '# w\n' })

  const r = planOf(repo.root, ['5002'])
  assert.equal(r.code, 0, `a plain merge must not crash or trip a floor; stderr: ${r.stderr}`)
  assert.equal(r.plan.baseSha, moveParent)
  // phase-own = move + work docs; the merged-in exec file is foreign
  assert.equal(r.plan.diff.files, 2, `phase-own file count: ${r.plan.diff.files}`)
  assert.deepEqual(r.plan.diff.specialistPaths, [], 'merged-in spine file is not phase-own')
  assert.equal(r.plan.testScope.effective, 'static')
  assert.ok(r.plan.foreignCommitsInRange.includes('src/relay/governed-turn.ts'), 'merged-in exec file surfaced as foreign')
})

test('gate plan — 1661 class: an ADVERSARIAL merge whose subject names "phase 5003 —" still keeps its merged-in files OUT of the phase-own set', () => {
  const repo = makeRepo()
  repo.writePhase(5003, phaseObj({ phase: 5003 }))
  repo.commit('plan(roadmap): phase 5003 — move to in-progress', { 'roadmap/plan.md': '# plan\n' })
  const branch = repo.git('rev-parse', '--abbrev-ref', 'HEAD').trim()
  repo.git('checkout', '-q', '-b', 'sib3')
  // A SPECIALIST-path exec file: were the merge to leak it into phase-own, the floor would fire (exit 2).
  repo.commit('feat: sibling relay work on a branch', { 'src/relay/governed-turn.ts': 'export const a = 1\n' })
  repo.git('checkout', '-q', branch)
  // The merge subject ACCIDENTALLY names the phase — the em-dash attribution grep matches this merge.
  repo.git('merge', '--no-ff', '-q', '-m', 'Merge develop — phase 5003 — sync', 'sib3')
  repo.commit('docs: phase 5003 — work', { 'roadmap/w.md': '# w\n' })

  const r = planOf(repo.root, ['5003'])
  // CORRECT behavior: git log's default merge-diff suppression keeps the merge commit's files out of
  // `git log --grep --name-only`, so no spine file is attributed to the phase and no floor fires.
  assert.equal(r.code, 0, `the phase-named merge must NOT leak src/relay into the floor (a leak would exit 2); stderr: ${r.stderr}`)
  assert.deepEqual(r.plan.diff.specialistPaths, [], 'merge-named-phase files must NOT enter the phase-own specialist set')
  assert.equal(r.plan.testScope.effective, 'static', 'phase-own stays docs-only')
  assert.equal(r.plan.diff.files, 2, 'phase-own = move + work docs only, not the merged relay file')
  assert.ok(r.plan.foreignCommitsInRange.includes('src/relay/governed-turn.ts'), 'the relay file is surfaced as foreign, never phase-own')
})

test('gate plan — 1661 class: --base binds baseSha to the given sha verbatim (the b8a4250 contract)', () => {
  const repo = makeRepo()
  repo.writePhase(5004, phaseObj({ phase: 5004 }))
  repo.commit('plan(roadmap): phase 5004 — move to in-progress', { 'roadmap/plan.md': '# plan\n' })
  repo.commit('feat: foreign exec (no phase tag)', { 'src/relay/governed-turn.ts': 'export const a = 1\n' })
  repo.commit('docs: phase 5004 — work', { 'roadmap/w.md': '# w\n' })
  // Pin the base explicitly at the foreign commit → only the trailing docs commit is in range.
  const foreignSha = repo.git('rev-parse', 'HEAD~1').trim()
  const r = planOf(repo.root, ['5004', '--base', foreignSha])
  assert.equal(r.code, 0, r.stderr)
  assert.equal(r.plan.baseSha, foreignSha, '--base overrides the em-dash derivation')
  // only the post-base phase docs commit is attributed
  assert.equal(r.plan.diff.files, 1, `phase-own file count: ${r.plan.diff.files}`)
  assert.deepEqual(r.plan.diff.classes, ['docs'], 'the single attributed file is docs')
})

// ── gate run — mechanical execution + the GateRunReport ─────────────────────────────
// A config with runnable fake slot commands (no gate specialists → no floors interfere).
const RUN_CFG = (over = {}) => ({
  configVersion: 1,
  gateCommands: {
    lint: 'true',
    types: 'true',
    unit: 'true',
    integration: 'true',
    build: 'true',
    e2e: 'none',
    emit: 'true',
    'unit-scoped': 'true',
    'integration-scoped': 'true',
    ...(over.gateCommands ?? {}),
  },
  testCadence: { enabled: true, backstop: 'ci + nightly', floors: 'blocking' },
  gateSpecialists: [],
  ...over,
})

// spawnSync, not execFileSync: the exec form only surfaces stderr through the THROWN error,
// so a successful (exit 0) run returned an empty stderr and any warning printed beside a green
// verdict was invisible to every assertion here — the fail-soft eval-record emit is exactly
// that shape.
function runGateCmd(root, args) {
  const r = spawnSync('node', [BIN, 'gate', 'run', ...args], {
    cwd: root, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ROADMAP_CONFIG: join(root, 'roadmap', 'roadmap.config.json') },
  })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}
const latestReportOf = (root, phase) => {
  const dir = join(root, 'roadmap', '.gate', String(phase))
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  return JSON.parse(readFileSync(join(dir, files[files.length - 1]), 'utf8'))
}

test('gate run — a green run exits 0 and writes a green report under roadmap/.gate/<phase>/', () => {
  const repo = makeRepo(RUN_CFG())
  repo.writePhase(1000, phaseObj({ phase: 1000 }))
  repo.commit('feat: phase 1000 — code', { 'lib/a.ts': 'export const a = 1\n' })
  const r = runGateCmd(repo.root, ['1000'])
  assert.equal(r.code, 0, r.stderr)
  const rep = latestReportOf(repo.root, 1000)
  assert.equal(rep.green, true)
  assert.ok(rep.slots.length > 0)
  // roadmap/.gate self-gitignores; no consumer .gitignore was touched
  assert.equal(readFileSync(join(repo.root, 'roadmap', '.gate', '.gitignore'), 'utf8').trim(), '*')
})

test('gate run — a RED slot forces exit 2 and records that slot exitCode + the marker in the log', () => {
  const repo = makeRepo(RUN_CFG({ gateCommands: { ...RUN_CFG().gateCommands, types: 'echo TYPES_BOOM >&2; exit 1' } }))
  repo.writePhase(1100, phaseObj({ phase: 1100 }))
  repo.commit('feat: phase 1100 — code', { 'lib/b.ts': 'export const b = 1\n' })
  const r = runGateCmd(repo.root, ['1100'])
  assert.equal(r.code, 2, 'a red slot must exit 2')
  const rep = latestReportOf(repo.root, 1100)
  assert.equal(rep.green, false)
  const typesRow = rep.slots.find((s) => s.slot === 'types')
  assert.equal(typesRow.exitCode, 1)
  // failure-identity rule: the marker survives to the tee'd slot log
  assert.match(readFileSync(typesRow.logPath, 'utf8'), /TYPES_BOOM/)
})

test('gate run --slots — a BASE tier name matches its resolved -scoped/-impacted slot (never a silent zero-slot green)', () => {
  const repo = makeRepo(RUN_CFG())
  repo.writePhase(1250, phaseObj({ phase: 1250 }))
  repo.commit('feat: phase 1250 — code', { 'lib/c.ts': 'export const c = 1\n' })
  const r = runGateCmd(repo.root, ['1250', '--slots', 'types'])
  assert.equal(r.code, 0, r.stderr)
  const rep = latestReportOf(repo.root, 1250)
  assert.ok(rep.slots.some((s) => s.slot === 'types'), 'the wanted tier actually ran')
})

test('gate run --slots — a name matching NO plan slot exits 2, never a green report with zero slots run', () => {
  const repo = makeRepo(RUN_CFG())
  repo.writePhase(1260, phaseObj({ phase: 1260 }))
  repo.commit('feat: phase 1260 — code', { 'lib/d.ts': 'export const d = 1\n' })
  const r = runGateCmd(repo.root, ['1260', '--slots', 'no-such-slot'])
  assert.equal(r.code, 2, 'an unmatched --slots name must refuse')
  assert.match(r.stderr, /match no plan slot/)
})

test('gate run — exec.preReview runs as one recorded row; an absent key produces none', () => {
  const withPre = makeRepo(RUN_CFG({ exec: { preReview: 'true' } }))
  withPre.writePhase(1200, phaseObj({ phase: 1200 }))
  withPre.commit('feat: phase 1200 — code', { 'lib/c.ts': 'export const c = 1\n' })
  assert.equal(runGateCmd(withPre.root, ['1200']).code, 0)
  assert.ok(latestReportOf(withPre.root, 1200).slots.some((s) => s.slot === 'preReview'), 'preReview row present')

  const noPre = makeRepo(RUN_CFG())
  noPre.writePhase(1201, phaseObj({ phase: 1201 }))
  noPre.commit('feat: phase 1201 — code', { 'lib/d.ts': 'export const d = 1\n' })
  assert.equal(runGateCmd(noPre.root, ['1201']).code, 0)
  assert.equal(latestReportOf(noPre.root, 1201).slots.some((s) => s.slot === 'preReview'), false, 'no preReview row when absent')
})

test('gate run --record-round — appends to the SAME report file', () => {
  const repo = makeRepo(RUN_CFG())
  repo.writePhase(1300, phaseObj({ phase: 1300 }))
  repo.commit('feat: phase 1300 — code', { 'lib/e.ts': 'export const e = 1\n' })
  runGateCmd(repo.root, ['1300'])
  const before = readdirSync(join(repo.root, 'roadmap', '.gate', '1300')).filter((f) => f.endsWith('.json')).length
  const r = runGateCmd(repo.root, ['1300', '--record-round', JSON.stringify({ round: 1, agent: 'code-reviewer', verdict: 'clean', summary: '0 findings' })])
  assert.equal(r.code, 0, r.stderr)
  const after = readdirSync(join(repo.root, 'roadmap', '.gate', '1300')).filter((f) => f.endsWith('.json')).length
  assert.equal(after, before, 'no new run file — appended to the latest')
  assert.equal(latestReportOf(repo.root, 1300).agents.length, 1)
})

test('gate run --verify-complete — exit 2 on a gateRounds mismatch, exit 0 on the coherent twin', () => {
  const repo = makeRepo(RUN_CFG())
  // phase declares ONE correctness round but the report has none yet → mismatch
  repo.writePhase(1400, phaseObj({ phase: 1400, gateRounds: [{ round: 0 }, { round: 1 }] }))
  repo.commit('feat: phase 1400 — code', { 'lib/f.ts': 'export const f = 1\n' })
  runGateCmd(repo.root, ['1400'])
  const bad = runGateCmd(repo.root, ['1400', '--verify-complete'])
  assert.equal(bad.code, 2, bad.stdout)
  assert.match(bad.stderr, /gateRounds count mismatch/)
  // record the missing round → now coherent
  runGateCmd(repo.root, ['1400', '--record-round', JSON.stringify({ round: 1, agent: 'code-reviewer', verdict: 'clean', summary: '0 findings' })])
  const good = runGateCmd(repo.root, ['1400', '--verify-complete'])
  assert.equal(good.code, 0, good.stderr)
})

test('gate run --verify-complete — a new codex completion cannot reuse an old report without independent review', () => {
  const repo = makeRepo(RUN_CFG())
  repo.writePhase(1401, phaseObj({ phase: 1401, status: 'in-progress', reviewScope: 'full' }))
  repo.commit('feat: phase 1401 — code', { 'lib/review.ts': 'export const reviewed = false\n' })
  assert.equal(runGateCmd(repo.root, ['1401']).code, 0, 'precondition: the report is green')

  repo.writePhase(1401, phaseObj({
    phase: 1401,
    status: 'done',
    reviewScope: 'full',
    gateRounds: [],
    executionResult: { phase: 1401, status: 'done', driver: { model: 'codex-model', lane: 'codex' } },
  }))
  const refused = runGateCmd(repo.root, ['1401', '--verify-complete'])
  assert.equal(refused.code, 2, refused.stdout)
  assert.match(refused.stderr, /no-self-judge/)
  assert.match(refused.stderr, /--record-round/)
})

test('gate run --verify-complete — no report dir exits 1', () => {
  const repo = makeRepo(RUN_CFG())
  repo.writePhase(1500, phaseObj({ phase: 1500 }))
  repo.commit('feat: phase 1500 — code', { 'lib/g.ts': 'export const g = 1\n' })
  const r = runGateCmd(repo.root, ['1500', '--verify-complete'])
  assert.equal(r.code, 1)
  assert.match(r.stderr, /no roadmap\/\.gate\/1500/)
})

// ── --verify-complete: the WARN-only unrecorded-driver check ─────────────────────────
// A done phase with no executionResult.driver.model is the "unrecorded" scorecard cohort —
// today nothing on the completion path names it, so the gap only surfaces months later at
// scorecard time. The check joins the EXISTING warn-only lane (untested-gate-fix /
// deviant-grammar `warning: …` stdout lines): it may never move the exit code, which
// consistency alone decides. Both cases below are CONSISTENT fixtures (green report, no
// declared scopes, no gateRounds) so the shared expectation is a sharp exit 0.
const VERIFY_COMPLETE_CONSISTENT_EXIT = 0
const DRIVER_ABSENT_PHRASE = 'executionResult.driver absent'
const driverAbsentLines = (stdout) => stdout.split('\n').filter((l) => l.includes(DRIVER_ABSENT_PHRASE))

test('gate run --verify-complete — a DONE phase with no executionResult.driver warns on stdout, exit code unchanged', () => {
  const repo = makeRepo(RUN_CFG())
  repo.writePhase(1600, phaseObj({ phase: 1600, status: 'done' }))
  repo.commit('feat: phase 1600 — code', { 'lib/h.ts': 'export const h = 1\n' })
  // the report dir must exist before --verify-complete (else exit 1, a different lane)
  assert.equal(runGateCmd(repo.root, ['1600']).code, 0)
  const rep = latestReportOf(repo.root, 1600)
  assert.equal(rep.green, true, 'the fixture gate run is green')
  assert.equal(rep.agents.length, 0, 'no recorded rounds — coherent with a phase declaring no gateRounds')

  const r = runGateCmd(repo.root, ['1600', '--verify-complete'])
  assert.equal(r.code, VERIFY_COMPLETE_CONSISTENT_EXIT, `consistency decides the exit code; stderr: ${r.stderr}`)
  assert.match(r.stdout, /phase 1600 consistent with the latest green gate report/, 'the consistency verdict still prints')
  const hits = driverAbsentLines(r.stdout)
  assert.equal(hits.length, 1, `exactly one unrecorded-driver warning (never one per task); stdout: ${r.stdout}`)
  assert.match(hits[0], /^warning: /, 'it joins the existing warn-only stdout lane')
})

test('gate run --verify-complete — the SAME done phase WITH executionResult.driver emits no warning and the same exit code', () => {
  const repo = makeRepo(RUN_CFG())
  repo.writePhase(
    1601,
    phaseObj({
      phase: 1601,
      status: 'done',
      executionResult: { phase: 1601, status: 'done', driver: { model: 'test-model', lane: 'session' } },
    }),
  )
  repo.commit('feat: phase 1601 — code', { 'lib/h.ts': 'export const h = 1\n' })
  assert.equal(runGateCmd(repo.root, ['1601']).code, 0)
  assert.equal(latestReportOf(repo.root, 1601).green, true, 'the fixture gate run is green')

  const r = runGateCmd(repo.root, ['1601', '--verify-complete'])
  assert.equal(r.code, VERIFY_COMPLETE_CONSISTENT_EXIT, 'a recorded driver cannot change the exit code either')
  assert.match(r.stdout, /phase 1601 consistent with the latest green gate report/, 'same lane, same verdict')
  assert.deepEqual(driverAbsentLines(r.stdout), [], 'a recorded driver.model silences the warning')
})

test('gate run --verify-complete — a NOT-done phase without executionResult.driver is not warned about (the done guard)', () => {
  const repo = makeRepo(RUN_CFG())
  repo.writePhase(1602, phaseObj({ phase: 1602, status: 'in-progress' }))
  repo.commit('feat: phase 1602 — code', { 'lib/h.ts': 'export const h = 1\n' })
  assert.equal(runGateCmd(repo.root, ['1602']).code, 0)

  const r = runGateCmd(repo.root, ['1602', '--verify-complete'])
  assert.equal(r.code, VERIFY_COMPLETE_CONSISTENT_EXIT, r.stderr)
  assert.deepEqual(
    driverAbsentLines(r.stdout),
    [],
    'a phase still in flight has not missed its chance to record a driver — warning it is noise',
  )
})

test('gate plan — an EMPTY scoped selection SKIPS the scoped slots with a named note, never a refusal (1737 run-000001 class)', () => {
  const repo = makeRepo()
  // Declared 'relevant' RAISES the docs-derived floor (the real 1737 shape) while the
  // phase-own diff carries no test files → the scoped selection is empty.
  repo.writePhase(5005, phaseObj({ phase: 5005, testScope: 'relevant' }))
  repo.commit('docs: phase 5005 — move to in-progress', { 'roadmap/notes-a.md': '# a\n' })
  repo.commit('docs: phase 5005 — followup prose', { 'roadmap/notes-b.md': '# b\n' })
  const r = planOf(repo.root, ['5005'])
  assert.equal(r.code, 0, r.stderr)
  const slots = r.plan.slots.map((s) => s.slot)
  assert.ok(!slots.includes('unit-scoped') && !slots.includes('integration-scoped'), `no scoped slots on an empty selection; got ${slots}`)
  assert.ok(
    r.plan.notes.some((n) => /scoped test slots skipped — no test files/.test(n)),
    `the skip is NAMED in notes; got ${JSON.stringify(r.plan.notes)}`,
  )
})

test('gate plan — a -spec SOURCE module selects its colocated .test.ts, and never itself (the workflow-agent-spec class)', () => {
  const repo = makeRepo()
  // The sibling is seeded in a NON phase-tagged commit so it stays out of the phase-own
  // set: the point is that the derivation FINDS it on disk, not that the phase touched it.
  repo.commit('chore: seed the colocated sibling', {
    'src/contracts/thing-spec.test.ts': "import { test } from 'node:test'\ntest('x', () => {})\n",
  })
  repo.writePhase(5006, phaseObj({ phase: 5006, testScope: 'scoped' }))
  repo.commit('feat: phase 5006 — the contract module', { 'src/contracts/thing-spec.ts': 'export const t = 1\n' })
  const r = planOf(repo.root, ['5006'])
  assert.equal(r.code, 0, r.stderr)
  for (const slot of ['unit-scoped', 'integration-scoped']) {
    const s = r.plan.slots.find((x) => x.slot === slot)
    assert.ok(s, `${slot} must run; got ${r.plan.slots.map((x) => x.slot)}`)
    assert.ok(
      s.files.includes('src/contracts/thing-spec.test.ts'),
      `${slot} must select the colocated TEST; got ${JSON.stringify(s.files)}`,
    )
    // The source module reaching a tier is the defect: node --test accepts any path and
    // executes it as a test file registering zero tests, which under the integration
    // lane's --test-force-exit hangs the child until the heap ceiling aborts it.
    assert.ok(
      !s.files.includes('src/contracts/thing-spec.ts'),
      `${slot} must NOT hand the SOURCE module to the runner; got ${JSON.stringify(s.files)}`,
    )
  }
})

// ── the vacuous-scoped-runner probe at PLAN time (task 20.2) ─────────────────────────
//
// `gate plan` is where a SCOPED tier is chosen OVER the full suite, so it is the one place
// that can ask whether the scoped runner it just picked is able to fail at all. A runner
// that exits 0 on a target that cannot exist certifies every phase it scopes having run
// nothing. slots.probeScopedSlot (task 20.1) asks the question; these pin that the PLAN
// asks it: a vacuous runner NAMED (per slot, exit semantics untouched), an honest one
// silent, and — because the probe costs a real process — one probe per DISTINCT template,
// never one per slot.

/** The stub that CANNOT fail — green whatever target it is handed (the vacuous runner). */
const ALWAYS_GREEN = 'echo "0 tests found, nothing to do"; exit 0'
/** The stub that discriminates — red iff a target it was handed does not exist. */
const HONEST = 'for f in "$@"; do [ -e "$f" ] || { echo "no such test file: $f" >&2; exit 1; }; done; exit 0'
/** Every stub invocation APPENDS one `<name> <argv>` line here — the probe's spawn count is
 *  then a fact on disk. (slots.test.mjs's stubEstate OVERWRITES its argv file; the contract
 *  under test here is a COUNT, so this one accumulates.) */
const CALL_LOG = 'probe-calls.log'

/**
 * A fixture consumer whose scoped tiers are REAL stub runners. `bodies` maps a stub NAME to
 * its sh source; `binds` maps a scoped slot to a stub name — so two slots can share ONE
 * template byte-for-byte, or carry their own. Stub paths are ABSOLUTE: the invocation count
 * must never depend on the probe's cwd. Stubs + the rewritten config land in a NON
 * phase-tagged commit, so they stay out of every phase-own diff.
 */
function makeStubRepo(bodies, binds) {
  const repo = makeRepo()
  const logPath = join(repo.root, CALL_LOG)
  const templates = {}
  for (const [name, body] of Object.entries(bodies)) {
    const stub = join(repo.root, `${name}-stub.sh`)
    writeFileSync(
      stub,
      `#!/bin/sh\nprintf '%s %s\\n' ${JSON.stringify(name)} "$*" >> ${JSON.stringify(logPath)}\n${body}\n`,
      { mode: 0o755 },
    )
    templates[name] = `sh ${stub} {files}`
  }
  const gateCommands = { ...CONFIG.gateCommands }
  for (const [slot, name] of Object.entries(binds)) gateCommands[slot] = templates[name]
  writeFileSync(join(repo.root, 'roadmap', 'roadmap.config.json'), JSON.stringify({ ...CONFIG, gateCommands }))
  repo.commit('chore: seed the scoped-runner stubs', {}) // NO em-dash → never phase-own
  return {
    ...repo,
    templates,
    /** Invocation lines, all of them or just one stub's. */
    calls: (name) =>
      (existsSync(logPath) ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean) : []).filter(
        (l) => name == null || l.startsWith(`${name} `),
      ),
  }
}

/** A phase whose OWN diff carries a test file, so the scoped tiers really resolve. */
function seedScopedPhase(repo, num) {
  repo.writePhase(num, phaseObj({ phase: num, testScope: 'scoped' }))
  repo.commit(`feat: phase ${num} — code + its test`, {
    'lib/thing.ts': 'export const t = 1\n',
    'lib/thing.test.ts': "import { test } from 'node:test'\ntest('t', () => {})\n",
  })
}

const slotRow = (plan, slot) => plan.slots.find((s) => s.slot === slot)
/** The plan's vacuity naming — the notes channel every other named gate decision uses
 *  (the empty-scope skip above is the precedent). */
const vacuityNotes = (plan) => plan.notes.filter((n) => /vacuous/i.test(n))

test('gate plan — a VACUOUS scoped runner is NAMED per slot, and the plan\'s exit semantics are unchanged', () => {
  const repo = makeStubRepo({ vac: ALWAYS_GREEN }, { 'unit-scoped': 'vac', 'integration-scoped': 'vac' })
  seedScopedPhase(repo, 2001)
  const r = planOf(repo.root, ['2001'])
  // Unchanged exit semantics: a vacuous runner is a DIAGNOSIS, not a refusal — naming it must
  // not move the plan off 0 (a probe that can red the gate is a probe that gets deleted).
  assert.equal(r.code, 0, `naming a vacuous runner must not change the exit code; stderr: ${r.stderr}`)
  const row = slotRow(r.plan, 'unit-scoped')
  assert.ok(row, `fixture: the scoped tier must be planned; got ${JSON.stringify(r.plan.slots.map((s) => s.slot))}`)
  assert.equal(row.refused, undefined, 'the vacuous tier is still planned, never refused')
  assert.equal(
    row.command,
    repo.templates.vac.replace('{files}', row.files.join(' ')),
    'the slot command stays the consumer binding, verbatim — the probe never rewrites it',
  )
  const named = vacuityNotes(r.plan)
  assert.ok(
    named.some((n) => n.includes('unit-scoped')),
    `the vacuous unit tier must be named; notes: ${JSON.stringify(r.plan.notes)}`,
  )
  assert.ok(
    named.some((n) => n.includes('integration-scoped')),
    `and the vacuous integration tier too — naming is per SLOT, the operator fixes a binding: ${JSON.stringify(r.plan.notes)}`,
  )
})

test('gate plan — an HONEST scoped runner is really probed and stays SILENT', () => {
  const repo = makeStubRepo({ honest: HONEST }, { 'unit-scoped': 'honest', 'integration-scoped': 'honest' })
  seedScopedPhase(repo, 2002)
  const r = planOf(repo.root, ['2002'])
  assert.equal(r.code, 0, r.stderr)
  assert.ok(slotRow(r.plan, 'unit-scoped'), `fixture: the scoped tier must be planned; got ${JSON.stringify(r.plan.slots.map((s) => s.slot))}`)
  assert.deepEqual(vacuityNotes(r.plan), [], `an honest runner earns no note; notes: ${JSON.stringify(r.plan.notes)}`)
  // The silence is an ANSWERED question, not an unasked one: without this a plan that never
  // probes at all passes the assertion above.
  assert.equal(repo.calls('honest').length, 1, `the honest runner was actually probed; calls: ${JSON.stringify(repo.calls())}`)
})

test('gate plan — the probe runs ONCE per DISTINCT template, never once per slot', () => {
  const repo = makeStubRepo({ vac: ALWAYS_GREEN }, { 'unit-scoped': 'vac', 'integration-scoped': 'vac' })
  seedScopedPhase(repo, 2003)
  const r = planOf(repo.root, ['2003'])
  assert.equal(r.code, 0, r.stderr)
  assert.ok(slotRow(r.plan, 'integration-scoped'), 'fixture: BOTH scoped tiers are planned, sharing one template')
  assert.equal(
    repo.calls().length,
    1,
    `two slots bound to ONE template ⇒ exactly one probe process; calls: ${JSON.stringify(repo.calls())}`,
  )
  // …and that single probe still names both tiers: per-TEMPLATE probing, per-SLOT naming.
  assert.equal(vacuityNotes(r.plan).length, 2, `both vacuous tiers named; notes: ${JSON.stringify(r.plan.notes)}`)
})

test('gate plan — DISTINCT scoped templates are each probed once; only the vacuous one is named', () => {
  const repo = makeStubRepo({ vac: ALWAYS_GREEN, honest: HONEST }, { 'unit-scoped': 'vac', 'integration-scoped': 'honest' })
  seedScopedPhase(repo, 2004)
  const r = planOf(repo.root, ['2004'])
  assert.equal(r.code, 0, r.stderr)
  assert.notEqual(repo.templates.vac, repo.templates.honest, 'fixture: the two tiers carry DIFFERENT templates')
  assert.equal(repo.calls('vac').length, 1, `the vacuous template probed once; calls: ${JSON.stringify(repo.calls())}`)
  assert.equal(repo.calls('honest').length, 1, `the honest template probed once too; calls: ${JSON.stringify(repo.calls())}`)
  const named = vacuityNotes(r.plan)
  assert.ok(named.some((n) => n.includes('unit-scoped')), `the vacuous tier is named; notes: ${JSON.stringify(r.plan.notes)}`)
  assert.equal(
    named.some((n) => n.includes('integration-scoped')),
    false,
    `the honest tier is NEVER named — a note on an honest runner is the noise that gets the probe ignored; notes: ${JSON.stringify(r.plan.notes)}`,
  )
})

test('gate plan — the guard-mutation-proof obligation rides notes on EVERY plan, whatever the kind', () => {
  // The plan is what the do-arc session echoes verbatim, so an obligation put here reaches that
  // lane and stays only while a test pins it. (renderGatePlan does NOT render notes into the
  // workflow-lane prompt — the executor card carries the obligation there; see DESIGN-NOTES.)
  // The row cites a reference file, and the substring assertion below lives inside gate.mjs's own
  // string: it would stay green while that citation dangled, so pin the file's existence too.
  assert.ok(
    existsSync(join(HERE, '..', '..', 'skills', 'do-phase', 'references', 'guard-mutation-proof.md')),
    'the cited reference file exists',
  )
  const guardRows = (plan) => plan.notes.filter((n) => n.includes('guard-mutation-proof'))
  for (const [phaseNum, kind] of [
    [5007, 'logic'],
    [5008, 'hardening'],
  ]) {
    const repo = makeRepo()
    repo.writePhase(phaseNum, phaseObj({ phase: phaseNum, kind }))
    repo.commit(`feat: phase ${phaseNum} — code`, { 'lib/guard.ts': 'export const g = 1\n' })
    const r = planOf(repo.root, [String(phaseNum)])
    assert.equal(r.code, 0, r.stderr)
    assert.equal(r.plan.kind, kind, 'the fixture kind reaches the plan')
    assert.equal(
      guardRows(r.plan).length,
      1,
      `kind ${kind}: exactly one guard-mutation-proof note; got ${JSON.stringify(r.plan.notes)}`,
    )
  }
})

// ── the per-phase eval record — roadmap/arc-evals/phase-<N>.peval.json ────────────────
// The measurement inlet the gate run mints from what it already holds (slot results + the
// parsed phase). Two invariants dominate: the record's ATTRIBUTION must match the phase file
// it was read from (a wrong value mis-cohorts a scorecard cell that never saw the work), and
// the emit is fail-soft — it may never move an exit code the slots already decided.
const RECORD_DIR = (root) => join(root, 'roadmap', 'arc-evals')
const recordPath = (root, phase) => join(RECORD_DIR(root), `phase-${phase}.peval.json`)
const readRecord = (root, phase) => JSON.parse(readFileSync(recordPath(root, phase), 'utf8'))
const recordFilesIn = (root) => (existsSync(RECORD_DIR(root)) ? readdirSync(RECORD_DIR(root)) : [])
/** Lines naming the record artifact — the loud emit-failure lane. */
const emitFailureLines = (stderr) => stderr.split('\n').filter((l) => /peval|arc-evals/.test(l))

const PLANNER = { model: 'planner-model-x' }
const DRIVER = { model: 'driver-model-y', lane: 'codex' }
const INDEPENDENT_ROUND = { round: 1, agent: 'code-reviewer', verdict: 'clean', summary: 'independent review: clean' }
const recordIndependentRound = (repo, phase) =>
  runGateCmd(repo.root, [String(phase), '--record-round', JSON.stringify(INDEPENDENT_ROUND)])
const METRICS = {
  commits: 3,
  linesAdded: 128,
  linesRemoved: 12,
  filesChanged: 4,
  testsAtStart: 100,
  testsAtEnd: 107,
  testsAdded: 7,
}

test('gate run — a green run leaves a phase-<N>.peval.json whose attribution + cohort keys are the PHASE FILE\'s own values', { timeout: 240_000 }, () => {
  const repo = makeRepo(RUN_CFG(), { consumerSchema: true })
  repo.writePhase(
    1700,
    phaseObj({
      phase: 1700,
      plannedBy: PLANNER,
      tasks: [{ id: '1700.1' }, { id: '1700.2' }, { id: '1700.3' }],
      keyFiles: ['lib/a.ts', 'lib/b.ts'],
    }),
  )
  repo.commit('feat: phase 1700 — code', { 'lib/a.ts': 'export const a = 1\n' })

  const r = runGateCmd(repo.root, ['1700'])
  assert.equal(r.code, 0, r.stderr)
  assert.ok(existsSync(recordPath(repo.root, 1700)), `no record at ${recordPath(repo.root, 1700)}; stderr: ${r.stderr}`)
  const rec = readRecord(repo.root, 1700)

  assert.equal(rec.phase, 1700)
  assert.match(rec.date, /^\d{4}-\d{2}-\d{2}$/, `date is a YYYY-MM-DD day, got ${rec.date}`)
  // attribution is READ OFF the phase file — at execute time only the planner exists
  assert.equal(rec.attribution.plannedBy.model, PLANNER.model)
  assert.equal(rec.attribution.driver, undefined, 'no driver exists yet at execute time — absent, never guessed')
  // cohort keys: taskCount x keyFiles decide which scorecard cell this lands in
  assert.equal(rec.taskCount, 3, 'taskCount = the phase file task count, not 0')
  assert.deepEqual(rec.keyFiles, ['lib/a.ts', 'lib/b.ts'])
  assert.equal(rec.consumerFingerprint.repo, basename(repo.root))
  assert.equal(rec.consumerFingerprint.language, 'javascript', 'derived offline from the checkout (package.json, no tsconfig)')
  assert.equal(rec.consumerFingerprint.corpusSize, 1, 'the fixture corpus is the single seeded phase file')

  assert.equal(rec.gate.green, true)
  assert.ok(rec.gate.slots.length > 0, 'the fixture ran slots — an empty slot list would make every assertion below vacuous')
  const types = rec.gate.slots.find((s) => s.slot === 'types')
  assert.ok(types, `the types slot is recorded; got ${rec.gate.slots.map((s) => s.slot).join(', ')}`)
  assert.equal(types.exitCode, 0)
  assert.ok(types.durationMs >= 0, `durationMs is a measurement, got ${types.durationMs}`)
  // the projection DROPS the report row fields no measurement reads (command/files/logPath/note)
  assert.deepEqual(Object.keys(types).sort(), ['durationMs', 'exitCode', 'slot'])
})

test('gate run — a RED run is a sample too: the record is written with green:false and the failing slot exitCode', { timeout: 240_000 }, () => {
  const repo = makeRepo(RUN_CFG({ gateCommands: { ...RUN_CFG().gateCommands, types: 'exit 1' } }), { consumerSchema: true })
  repo.writePhase(1702, phaseObj({ phase: 1702, plannedBy: PLANNER, tasks: [{ id: '1702.1' }] }))
  repo.commit('feat: phase 1702 — code', { 'lib/b.ts': 'export const b = 1\n' })

  const r = runGateCmd(repo.root, ['1702'])
  assert.equal(r.code, 2, 'the red slot still decides the exit code')
  assert.ok(existsSync(recordPath(repo.root, 1702)), `a RED run must still emit a record; stderr: ${r.stderr}`)
  const rec = readRecord(repo.root, 1702)
  assert.equal(rec.gate.green, false)
  assert.equal(rec.taskCount, 1)
  assert.ok(rec.gate.slots.length > 0, 'the fixture ran slots')
  const types = rec.gate.slots.find((s) => s.slot === 'types')
  assert.ok(types, `the types slot is recorded; got ${rec.gate.slots.map((s) => s.slot).join(', ')}`)
  assert.equal(types.exitCode, 1, 'the failing exit code is the sample — never normalised to 0')
})

test('gate run --verify-complete — the refresh adds executionResult.driver + metrics to the SAME record file', { timeout: 240_000 }, () => {
  const repo = makeRepo(RUN_CFG(), { consumerSchema: true })
  // execute time: a phase in flight — a planner, no completion yet
  repo.writePhase(1701, phaseObj({ phase: 1701, status: 'in-progress', plannedBy: PLANNER, tasks: [{ id: '1701.1' }, { id: '1701.2' }] }))
  repo.commit('feat: phase 1701 — code', { 'lib/c.ts': 'export const c = 1\n' })
  assert.equal(runGateCmd(repo.root, ['1701']).code, 0)
  assert.equal(recordIndependentRound(repo, 1701).code, 0, 'precondition: the delegated lane recorded its independent review')
  const atExecute = readRecord(repo.root, 1701)
  assert.equal(atExecute.attribution.plannedBy.model, PLANNER.model)
  assert.equal(atExecute.attribution.driver, undefined, 'precondition: the driver is genuinely absent before the completion')
  assert.equal(atExecute.metrics, undefined, 'precondition: metrics are genuinely absent before the completion')

  // completion is written to the phase file, then the gate verifies it
  repo.writePhase(
    1701,
    phaseObj({
      phase: 1701,
      status: 'done',
      plannedBy: PLANNER,
      tasks: [{ id: '1701.1' }, { id: '1701.2' }],
      keyFiles: ['lib/c.ts'],
      gateRounds: [INDEPENDENT_ROUND],
      executionResult: { phase: 1701, status: 'done', driver: DRIVER },
      metrics: METRICS,
    }),
  )
  const r = runGateCmd(repo.root, ['1701', '--verify-complete'])
  assert.equal(r.code, VERIFY_COMPLETE_CONSISTENT_EXIT, `consistency alone decides the exit code; stderr: ${r.stderr}`)

  const rec = readRecord(repo.root, 1701)
  assert.deepEqual(rec.attribution.driver, DRIVER, 'the refresh captures WHO drove it, model + lane')
  assert.equal(rec.attribution.plannedBy.model, PLANNER.model, 'the planner survives the refresh')
  assert.deepEqual(rec.metrics, METRICS, 'the refresh captures the completion metrics verbatim')
  assert.equal(rec.taskCount, 2)
  assert.deepEqual(rec.keyFiles, ['lib/c.ts'])
  assert.equal(rec.gate.green, true, 'the refresh carries the latest report verdict')
  assert.ok(rec.gate.slots.length > 0, 'the refreshed record keeps the slot results')
  assert.deepEqual(recordFilesIn(repo.root), ['phase-1701.peval.json'], 'the refresh REWRITES the one record, it does not add a second')
})

test('gate run — an unwritable arc-evals path cannot change a GREEN verdict, and the failure is named on stderr', { timeout: 240_000 }, () => {
  const repo = makeRepo(RUN_CFG(), { consumerSchema: true })
  repo.writePhase(1703, phaseObj({ phase: 1703, plannedBy: PLANNER, tasks: [{ id: '1703.1' }] }))
  repo.commit('feat: phase 1703 — code', { 'lib/d.ts': 'export const d = 1\n' })
  // arc-evals as a FILE — mkdir/write throws and the emitter cannot route around it
  const sabotage = 'not a directory\n'
  writeFileSync(RECORD_DIR(repo.root), sabotage)

  const r = runGateCmd(repo.root, ['1703'])
  assert.equal(r.code, 0, `a green gate stays green when the emit fails; stderr: ${r.stderr}`)
  assert.match(r.stdout, /gate run phase 1703 — GREEN/, 'the gate verdict is still reported')
  const hits = emitFailureLines(r.stderr)
  assert.ok(hits.length > 0, `the emit failure is LOUD and names the record artifact; stderr: ${JSON.stringify(r.stderr)}`)
  assert.equal(readFileSync(RECORD_DIR(repo.root), 'utf8'), sabotage, 'the emitter clobbered nothing on its way out')
})

test('gate run — an unwritable arc-evals path cannot rescue a RED verdict either', { timeout: 240_000 }, () => {
  const repo = makeRepo(RUN_CFG({ gateCommands: { ...RUN_CFG().gateCommands, types: 'exit 1' } }), { consumerSchema: true })
  repo.writePhase(1704, phaseObj({ phase: 1704, plannedBy: PLANNER, tasks: [{ id: '1704.1' }] }))
  repo.commit('feat: phase 1704 — code', { 'lib/e.ts': 'export const e = 1\n' })
  writeFileSync(RECORD_DIR(repo.root), 'not a directory\n')

  const r = runGateCmd(repo.root, ['1704'])
  assert.equal(r.code, 2, 'the red slot still decides the exit code — the emit failure neither rescues nor worsens it')
  const hits = emitFailureLines(r.stderr)
  assert.ok(hits.length > 0, `the emit failure is named; stderr: ${JSON.stringify(r.stderr)}`)
})

test('gate run — a re-run OVERWRITES the record (latest-run-wins), never an accumulating archive', { timeout: 240_000 }, () => {
  const repo = makeRepo(RUN_CFG(), { consumerSchema: true })
  repo.writePhase(1705, phaseObj({ phase: 1705, plannedBy: PLANNER, tasks: [{ id: '1705.1' }] }))
  repo.commit('feat: phase 1705 — code', { 'lib/f.ts': 'export const f = 1\n' })
  assert.equal(runGateCmd(repo.root, ['1705']).code, 0)
  assert.equal(readRecord(repo.root, 1705).gate.green, true, 'precondition: the first run is the green sample')

  // flip the same phase RED and re-run — the record must carry the LATEST run, not the first
  writeFileSync(
    join(repo.root, 'roadmap', 'roadmap.config.json'),
    JSON.stringify(RUN_CFG({ gateCommands: { ...RUN_CFG().gateCommands, types: 'exit 1' } })),
  )
  assert.equal(runGateCmd(repo.root, ['1705']).code, 2)

  assert.deepEqual(recordFilesIn(repo.root), ['phase-1705.peval.json'], 'one record file per phase — a second run adds no file')
  const rec = readRecord(repo.root, 1705)
  assert.equal(rec.gate.green, false, 'latest-run-wins: the re-run replaced the green sample')
  const types = rec.gate.slots.find((s) => s.slot === 'types')
  assert.ok(types, `the types slot is recorded; got ${rec.gate.slots.map((s) => s.slot).join(', ')}`)
  assert.equal(types.exitCode, 1)
})

test('gate run --slots <subset> — leaves the record UNTOUCHED and says so (a filtered run is not a sample)', { timeout: 240_000 }, () => {
  const repo = makeRepo(RUN_CFG(), { consumerSchema: true })
  repo.writePhase(1707, phaseObj({ phase: 1707, plannedBy: PLANNER, tasks: [{ id: '1707.1' }] }))
  repo.commit('feat: phase 1707 — code', { 'lib/h.ts': 'export const h = 1\n' })

  // The per-task loop's FIRST `--slots types` lands before any full run, so the line must not
  // claim a file that does not exist yet — and must not mint one either.
  const fresh = runGateCmd(repo.root, ['1707', '--slots', 'types'])
  assert.equal(fresh.code, 0, fresh.stderr)
  assert.equal(existsSync(recordPath(repo.root, 1707)), false, 'a filtered run mints no record')
  assert.match(
    emitFailureLines(fresh.stderr).join('\n'),
    /has not been written yet/,
    `with no record on disk the line says so; got: ${JSON.stringify(fresh.stderr)}`,
  )

  assert.equal(runGateCmd(repo.root, ['1707']).code, 0)
  const full = readFileSync(recordPath(repo.root, 1707), 'utf8')
  assert.ok(readRecord(repo.root, 1707).gate.slots.length > 1, 'precondition: the full run recorded more than one slot')

  // The per-task loop runs `--slots types` after every task. Its `green` covers the filtered
  // rows alone, so recording it would overwrite the fuller sample with a one-slot projection.
  const r = runGateCmd(repo.root, ['1707', '--slots', 'types'])
  assert.equal(r.code, 0, r.stderr)
  assert.equal(readFileSync(recordPath(repo.root, 1707), 'utf8'), full, 'a --slots run must not rewrite the record')
  assert.match(
    emitFailureLines(r.stderr).join('\n'),
    /PARTIAL run.*was left untouched/s,
    `the skip is NAMED on stderr and names the record it spared; got: ${JSON.stringify(r.stderr)}`,
  )
})

test('gate run --verify-complete over a FILTERED latest report — refuses the flip and refreshes nothing', { timeout: 240_000 }, () => {
  // The second door onto the record. latestReport() returns the newest run file whatever
  // produced it, so a routine per-task `--slots types` landing after a RED full run must not
  // become the basis of either a done flip or a refreshed sample.
  const red = RUN_CFG({ gateCommands: { ...RUN_CFG().gateCommands, types: 'exit 1' } })
  const repo = makeRepo(red, { consumerSchema: true })
  const donePhase = {
    phase: 1708,
    status: 'done',
    plannedBy: PLANNER,
    tasks: [{ id: '1708.1' }],
    keyFiles: ['lib/i.ts'],
    executionResult: { phase: 1708, status: 'done', driver: DRIVER },
    metrics: METRICS,
  }
  repo.writePhase(1708, phaseObj({ ...donePhase, status: 'in-progress' }))
  repo.commit('feat: phase 1708 — code', { 'lib/i.ts': 'export const i = 1\n' })
  assert.equal(runGateCmd(repo.root, ['1708']).code, 2, 'precondition: the FULL run is RED')
  assert.equal(readRecord(repo.root, 1708).gate.green, false, 'precondition: the record carries the red verdict')

  // now a GREEN filtered run over a slot that passes — the fabricated-pass setup
  writeFileSync(join(repo.root, 'roadmap', 'roadmap.config.json'), JSON.stringify(RUN_CFG()))
  assert.equal(runGateCmd(repo.root, ['1708', '--slots', 'types']).code, 0, 'the filtered run is green over its subset')

  repo.writePhase(1708, phaseObj(donePhase))
  const r = runGateCmd(repo.root, ['1708', '--verify-complete'])
  assert.equal(r.code, 2, `a subset report cannot certify a done flip; stdout: ${r.stdout} stderr: ${r.stderr}`)
  assert.match(r.stderr, /--slots types run: its green covers that subset alone/, `the refusal names WHY; stderr: ${JSON.stringify(r.stderr)}`)
  assert.equal(
    readRecord(repo.root, 1708).gate.green,
    false,
    'the refresh did not rewrite the red sample to the subset green — the fabricated pass is unreachable',
  )
  assert.match(
    emitFailureLines(r.stderr).join('\n'),
    /was NOT refreshed from it/,
    `the skipped refresh is NAMED; stderr: ${JSON.stringify(r.stderr)}`,
  )
})

test('gate run --record-round — records no eval record (it changes only agent rounds, which the record does not carry)', { timeout: 240_000 }, () => {
  const repo = makeRepo(RUN_CFG(), { consumerSchema: true })
  repo.writePhase(1706, phaseObj({ phase: 1706, plannedBy: PLANNER, tasks: [{ id: '1706.1' }] }))
  repo.commit('feat: phase 1706 — code', { 'lib/g.ts': 'export const g = 1\n' })
  assert.equal(runGateCmd(repo.root, ['1706']).code, 0)
  assert.ok(existsSync(recordPath(repo.root, 1706)), 'precondition: the execute path emitted a record')
  rmSync(recordPath(repo.root, 1706))

  const r = runGateCmd(repo.root, [
    '1706',
    '--record-round',
    JSON.stringify({ round: 1, agent: 'code-reviewer', verdict: 'clean', summary: '0 findings' }),
  ])
  assert.equal(r.code, 0, r.stderr)
  assert.equal(existsSync(recordPath(repo.root, 1706)), false, 'the round-append lane holds no slot results — it must not mint a record')
})

// ── --verify-complete: reconciling the phase file's driver against the LANE JOURNAL ──
// The lane journal is the launcher's own record of who it started, written before any model
// spoke. When one exists, it is the TRUTH and the phase file's executionResult.driver is a
// CLAIM: a claim that disagrees, or is missing entirely, mis-attributes landed work to a cohort
// that never ran it, and no later reader can tell. An INLINE session leaves no journal, so
// there is nothing to reconcile against and the lane stays silent (the warn-only lane above
// still covers that case). Every fixture here is otherwise CONSISTENT — the driver is the only
// thing in dispute, so the exit code can only come from the reconcile.
const JOURNAL_MODEL = 'journal-model-alpha'
const CLAIMED_MODEL = 'claimed-model-beta'
const JOURNAL_STARTED_AT = '2026-08-24T10:00:00.000Z'

/** The run-lane journal `roadmap codex run` leaves in the PRIMARY checkout's .building/. */
function writeRunJournal(mainRoot, ids, over = {}) {
  const stem = `codex-${ids.join('-')}`
  mkdirSync(join(mainRoot, '.building'), { recursive: true })
  const path = join(mainRoot, '.building', `${stem}.json`)
  writeFileSync(
    path,
    JSON.stringify(
      {
        phases: ids.map(String),
        lane: 'run',
        report: 'CODEX-REPORT.md',
        worktree: join(mainRoot, `wt-${ids.join('-')}`),
        base: 'develop',
        pgid: 999999999, // never a live group
        log: join(mainRoot, '.building', `${stem}.log`),
        prompt: join(mainRoot, '.building', `${stem}-prompt.txt`),
        startedAt: JOURNAL_STARTED_AT,
        driver: { model: JOURNAL_MODEL, lane: 'codex' },
        ...over,
      },
      null,
      2,
    ) + '\n',
  )
  return path
}

const donePhase = (phase, driver) =>
  phaseObj({ phase, status: 'done', ...(driver ? { executionResult: { phase, status: 'done', driver } } : {}) })

test('gate run --verify-complete — a phase claiming a DIFFERENT driver than the lane journal exits 2, naming journal truth beside file claim', () => {
  const repo = makeRepo(RUN_CFG())
  repo.writePhase(1610, donePhase(1610, { model: CLAIMED_MODEL, lane: 'codex' }))
  repo.commit('feat: phase 1610 — code', { 'lib/j.ts': 'export const j = 1\n' })
  assert.equal(runGateCmd(repo.root, ['1610']).code, 0)
  assert.equal(latestReportOf(repo.root, 1610).green, true, 'precondition: the fixture is otherwise consistent — only the driver is in dispute')
  const jPath = writeRunJournal(repo.root, [1610])

  const r = runGateCmd(repo.root, ['1610', '--verify-complete'])
  assert.equal(r.code, 2, `a lane-launched run whose phase file claims another driver must not verify; stdout: ${r.stdout} stderr: ${r.stderr}`)
  assert.ok(r.stderr.includes(JOURNAL_MODEL), `the journal's truth is named; stderr: ${JSON.stringify(r.stderr)}`)
  assert.ok(r.stderr.includes(CLAIMED_MODEL), `the file's claim is named BESIDE it — a reader must not have to open the journal; stderr: ${JSON.stringify(r.stderr)}`)
  assert.ok(r.stderr.includes(jPath), `the journal that decided it is named (${jPath}); stderr: ${JSON.stringify(r.stderr)}`)
  assert.ok(r.stderr.includes(JOURNAL_STARTED_AT), `the journal's startedAt places the run in time; stderr: ${JSON.stringify(r.stderr)}`)
})

test('gate run --verify-complete — a lane journal beside a phase file with NO executionResult.driver exits 2, not a warning', () => {
  const repo = makeRepo(RUN_CFG())
  repo.writePhase(1611, donePhase(1611, null))
  repo.commit('feat: phase 1611 — code', { 'lib/k.ts': 'export const k = 1\n' })
  assert.equal(runGateCmd(repo.root, ['1611']).code, 0)
  const jPath = writeRunJournal(repo.root, [1611])

  const r = runGateCmd(repo.root, ['1611', '--verify-complete'])
  assert.equal(
    r.code,
    2,
    `a run the launcher journalled cannot land unattributed — the warn-only lane is for inline sessions; stdout: ${r.stdout} stderr: ${r.stderr}`,
  )
  assert.ok(r.stderr.includes(JOURNAL_MODEL), `the driver the launcher started is named; stderr: ${JSON.stringify(r.stderr)}`)
  assert.ok(r.stderr.includes(jPath), `the journal that decided it is named (${jPath}); stderr: ${JSON.stringify(r.stderr)}`)
})

test('gate run --verify-complete — a phase whose driver AGREES with the journal verifies unchanged', () => {
  const repo = makeRepo(RUN_CFG())
  repo.writePhase(1612, { ...donePhase(1612, { model: JOURNAL_MODEL, lane: 'codex' }), gateRounds: [INDEPENDENT_ROUND] })
  repo.commit('feat: phase 1612 — code', { 'lib/l.ts': 'export const l = 1\n' })
  assert.equal(runGateCmd(repo.root, ['1612']).code, 0)
  assert.equal(recordIndependentRound(repo, 1612).code, 0, 'precondition: the delegated lane recorded its independent review')
  writeRunJournal(repo.root, [1612])

  const r = runGateCmd(repo.root, ['1612', '--verify-complete'])
  assert.equal(r.code, VERIFY_COMPLETE_CONSISTENT_EXIT, `agreement is the normal case and must stay silent; stderr: ${r.stderr}`)
  assert.match(r.stdout, /phase 1612 consistent with the latest green gate report/, 'the consistency verdict still prints')
  assert.deepEqual(driverAbsentLines(r.stdout), [], 'a recorded, agreeing driver warns about nothing')
})

test('gate run --verify-complete — a journal whose lane pins NO model announces the model UNRECONCILED and still reconciles the lane', () => {
  const repo = makeRepo(RUN_CFG())
  // A registry entry may pin no model (the claude lane: the harness resolves it). The launcher
  // then cannot contradict the model half, so it must SAY so rather than pass silently — a
  // silent pass is indistinguishable from a checked one.
  repo.writePhase(1614, donePhase(1614, { model: CLAIMED_MODEL, lane: 'claude' }))
  repo.commit('feat: phase 1614 — code', { 'lib/n.ts': 'export const n = 1\n' })
  assert.equal(runGateCmd(repo.root, ['1614']).code, 0)
  const jPath = writeRunJournal(repo.root, [1614], { driver: { model: null, lane: 'claude' } })

  const r = runGateCmd(repo.root, ['1614', '--verify-complete'])
  assert.equal(r.code, VERIFY_COMPLETE_CONSISTENT_EXIT, `an unpinned model is announced, never red; stderr: ${r.stderr}`)
  assert.match(r.stderr, /UNRECONCILED/, `the unchecked half must be NAMED; stderr: ${JSON.stringify(r.stderr)}`)
  assert.ok(r.stderr.includes(jPath), `the journal it came from is named; stderr: ${JSON.stringify(r.stderr)}`)
  assert.ok(!r.stderr.includes(CLAIMED_MODEL), 'an unpinnable model is not compared, so the claim is not quoted as a mismatch')
})

test('gate run --verify-complete — an unpinned-model journal still REDS a lane that disagrees', () => {
  const repo = makeRepo(RUN_CFG())
  // The lane half is knowable even when the model half is not: announcing the model must not
  // buy the whole reconcile an exemption.
  repo.writePhase(1615, donePhase(1615, { model: CLAIMED_MODEL, lane: 'session' }))
  repo.commit('feat: phase 1615 — code', { 'lib/o.ts': 'export const o = 1\n' })
  assert.equal(runGateCmd(repo.root, ['1615']).code, 0)
  writeRunJournal(repo.root, [1615], { driver: { model: null, lane: 'claude' } })

  const r = runGateCmd(repo.root, ['1615', '--verify-complete'])
  assert.equal(r.code, 2, `a lane disagreement reds even with no pinned model; stdout: ${r.stdout} stderr: ${r.stderr}`)
  assert.match(r.stderr, /driver\.lane disagrees/, `the lane half is named as the failure; stderr: ${JSON.stringify(r.stderr)}`)
})

test('gate run --verify-complete — with NO lane journal the driver claim is not reconciled at all (an inline session)', () => {
  const repo = makeRepo(RUN_CFG())
  // The SAME claim the mismatch fixture reds on — with no journal there is no truth to check it
  // against, so an inline session must pass exactly as it did before the reconcile existed.
  repo.writePhase(1613, donePhase(1613, { model: CLAIMED_MODEL, lane: 'session' }))
  repo.commit('feat: phase 1613 — code', { 'lib/m.ts': 'export const m = 1\n' })
  assert.equal(runGateCmd(repo.root, ['1613']).code, 0)
  assert.equal(existsSync(join(repo.root, '.building')), false, 'precondition: no lane ever ran here')

  const r = runGateCmd(repo.root, ['1613', '--verify-complete'])
  assert.equal(r.code, VERIFY_COMPLETE_CONSISTENT_EXIT, `no journal ⇒ no check; stderr: ${r.stderr}`)
  assert.match(r.stdout, /phase 1613 consistent with the latest green gate report/, 'the consistency verdict is unchanged')
  assert.ok(!r.stderr.includes(CLAIMED_MODEL), `an unjournalled driver claim is nobody's business; stderr: ${JSON.stringify(r.stderr)}`)
})

/** gate run with cwd anywhere — the worktree case needs its OWN checkout's config, not the primary's. */
function runGateIn(cwd, args) {
  const r = spawnSync('node', [BIN, 'gate', 'run', ...args], {
    cwd, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ROADMAP_CONFIG: join(cwd, 'roadmap', 'roadmap.config.json') },
  })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

test('gate run --verify-complete inside a LINKED codex worktree — the journal is resolved from the PRIMARY checkout', { timeout: 240_000 }, () => {
  // The lane runs its own verify-complete from INSIDE the worktree it was given, while the
  // journal only ever exists under the primary checkout's .building/. A lookup rooted at the
  // git toplevel finds nothing here and every lane-run phase reconciles against silence — the
  // exact hole this test exists to keep shut, so it is a separate fixture, not a variant.
  const repo = makeRepo(RUN_CFG())
  repo.writePhase(1614, donePhase(1614, { model: CLAIMED_MODEL, lane: 'codex' }))
  repo.commit('feat: phase 1614 — code', { 'lib/n.ts': 'export const n = 1\n' })
  const worktree = `${repo.root}-codex-1614`
  bases.push(worktree)
  repo.git('worktree', 'add', '-q', '-b', 'codex/1614', worktree, 'HEAD')
  assert.equal(existsSync(join(worktree, 'roadmap', 'phases', 'phase-1614.phase.ts')), true, 'precondition: the lane sees the phase file')

  assert.equal(runGateIn(worktree, ['1614']).code, 0, 'precondition: the code gate runs in the worktree')
  assert.equal(existsSync(join(worktree, 'roadmap', '.gate', '1614')), true, 'precondition: the report the verify reads is the worktree\'s own')

  const jPath = writeRunJournal(repo.root, [1614])
  assert.equal(existsSync(join(worktree, '.building')), false, 'precondition: the journal exists ONLY under the primary checkout')

  const r = runGateIn(worktree, ['1614', '--verify-complete'])
  assert.equal(r.code, 2, `the journal one directory level up still decides it; stdout: ${r.stdout} stderr: ${r.stderr}`)
  assert.ok(r.stderr.includes(JOURNAL_MODEL), `the journal's truth is named; stderr: ${JSON.stringify(r.stderr)}`)
  assert.ok(r.stderr.includes(CLAIMED_MODEL), `the file's claim is named beside it; stderr: ${JSON.stringify(r.stderr)}`)
  assert.ok(r.stderr.includes(jPath), `the PRIMARY checkout's journal path is named (${jPath}); stderr: ${JSON.stringify(r.stderr)}`)
})

// ── the eval record's CONSUMER IDENTITY seen from a linked worktree ───────────────────
// A linked checkout is the SAME repository under another directory name. The record's
// consumerFingerprint.repo is the corpus cohort key, so deriving it from the active toplevel
// splits one consumer into two cohorts the moment a lane runs the gate out of a worktree —
// and every cohort-sliced number downstream is computed over half the samples. Identity is
// normalized to the primary checkout; the MEASURED fields (language, corpusSize) and the
// record's PLACEMENT still belong to the checkout that actually ran.

/**
 * A linked worktree of `repo` at a DIFFERENT basename, reusing the fixture the existing
 * worktree case builds inline. node_modules is gitignored, so the checkout does not carry the
 * consumer's zod seam — it is re-linked here or every bridge-validated write in the worktree
 * would fail for a reason that has nothing to do with identity.
 */
function linkedWorktree(repo, name, branch) {
  const dir = `${repo.root}-${name}`
  bases.push(dir)
  repo.git('worktree', 'add', '-q', '-b', branch, dir, 'HEAD')
  const zod = join(repo.root, 'node_modules', 'zod')
  if (existsSync(zod)) {
    mkdirSync(join(dir, 'node_modules'), { recursive: true })
    symlinkSync(realpathSync(zod), join(dir, 'node_modules', 'zod'), 'dir')
  }
  const git = (...a) =>
    execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    })
  const writePhase = (num, obj) => {
    writeFileSync(join(dir, 'roadmap', 'phases', `phase-${num}.phase.ts`), `export default ${JSON.stringify(obj, null, 2)}\n`)
    git('add', join('roadmap', 'phases', `phase-${num}.phase.ts`))
    git('commit', '-q', '-m', `seed phase-${num} file`) // NO em-dash → not phase-own
  }
  return { dir, writePhase }
}

const phaseFileCount = (root) => readdirSync(join(root, 'roadmap', 'phases')).filter((f) => f.endsWith('.phase.ts')).length

test('gate eval fingerprint matches primary checkout from linked worktree', { timeout: 240_000 }, () => {
  const repo = makeRepo(RUN_CFG(), { consumerSchema: true })
  repo.writePhase(1720, phaseObj({ phase: 1720, plannedBy: PLANNER, tasks: [{ id: '1720.1' }], keyFiles: ['lib/w.ts'] }))
  repo.commit('feat: phase 1720 — code', { 'lib/w.ts': 'export const w = 1\n' })

  const wt = linkedWorktree(repo, 'codex-1720', 'codex/1720')
  assert.notEqual(basename(wt.dir), basename(repo.root), 'precondition: the linked checkout has a different directory name')
  // A second phase file the PRIMARY does not have: the corpus counts must be able to disagree,
  // or "corpusSize came from the active checkout" is unfalsifiable here.
  wt.writePhase(1721, phaseObj({ phase: 1721 }))
  assert.equal(phaseFileCount(repo.root), 1, 'precondition: the primary corpus')
  assert.equal(phaseFileCount(wt.dir), 2, 'precondition: the linked corpus is non-zero AND different')

  const r = runGateIn(wt.dir, ['1720'])
  assert.equal(r.code, 0, `stdout: ${r.stdout} stderr: ${r.stderr}`)

  // Placement is unchanged: the record still lands beside the gate artifacts of the checkout
  // that ran, never beside the primary's.
  assert.ok(existsSync(recordPath(wt.dir, 1720)), `no record at ${recordPath(wt.dir, 1720)}; stderr: ${r.stderr}`)
  assert.deepEqual(recordFilesIn(repo.root), [], 'the primary checkout gets no record — only the identity travels, not the artifact')

  const fp = readRecord(wt.dir, 1720).consumerFingerprint
  assert.equal(
    fp.repo,
    basename(repo.root),
    `one repository is ONE cohort: the identity is the primary checkout's basename, got ${fp.repo}`,
  )
  assert.notEqual(fp.repo, basename(wt.dir), 'a linked checkout must not partition the corpus into a cohort of its own')
  assert.equal(fp.corpusSize, 2, 'the normalisation is identity-only: the corpus is the one the running checkout holds')
  assert.equal(fp.language, 'javascript', 'and the language is the running checkout\'s own')
})

test('gate run --verify-complete refresh keeps the primary checkout fingerprint', { timeout: 240_000 }, () => {
  // The refresh is the moment the record MATTERS — it is the one that captures the driver and
  // the metrics. A refresh that recomputed identity from the active toplevel would re-partition
  // the cohort at completion time, after the execute-time record got it right.
  const repo = makeRepo(RUN_CFG(), { consumerSchema: true })
  const inFlight = { phase: 1722, status: 'in-progress', plannedBy: PLANNER, tasks: [{ id: '1722.1' }] }
  repo.writePhase(1722, phaseObj(inFlight))
  repo.commit('feat: phase 1722 — code', { 'lib/x.ts': 'export const x = 1\n' })

  const wt = linkedWorktree(repo, 'codex-1722', 'codex/1722')
  wt.writePhase(1723, phaseObj({ phase: 1723 }))
  assert.equal(existsSync(join(repo.root, '.building')), false, 'precondition: no lane journal, so only consistency decides the exit code')

  const execute = runGateIn(wt.dir, ['1722'])
  assert.equal(execute.code, 0, `stdout: ${execute.stdout} stderr: ${execute.stderr}`)
  assert.ok(existsSync(recordPath(wt.dir, 1722)), `no execute-time record; stderr: ${execute.stderr}`)

  wt.writePhase(
    1722,
    phaseObj({
      ...inFlight,
      status: 'done',
      keyFiles: ['lib/x.ts'],
      gateRounds: [INDEPENDENT_ROUND],
      executionResult: { phase: 1722, status: 'done', driver: DRIVER },
      metrics: METRICS,
    }),
  )
  assert.equal(recordIndependentRound({ root: wt.dir }, 1722).code, 0, 'precondition: the delegated lane recorded its independent review')
  const r = runGateIn(wt.dir, ['1722', '--verify-complete'])
  assert.equal(r.code, VERIFY_COMPLETE_CONSISTENT_EXIT, `stdout: ${r.stdout} stderr: ${r.stderr}`)

  const rec = readRecord(wt.dir, 1722)
  assert.deepEqual(rec.attribution.driver, DRIVER, 'the refresh really re-emitted the record — otherwise the fingerprint assertion below is vacuous')
  assert.deepEqual(rec.metrics, METRICS, 'and captured the completion metrics')
  assert.equal(
    rec.consumerFingerprint.repo,
    basename(repo.root),
    `the refreshed record keeps the primary checkout's identity, got ${rec.consumerFingerprint.repo}`,
  )
  assert.notEqual(rec.consumerFingerprint.repo, basename(wt.dir), 'completion time is exactly when a re-partitioned cohort would go unnoticed')
  assert.equal(rec.consumerFingerprint.corpusSize, 2, 'the refresh still measures the checkout that ran')
  assert.ok(existsSync(recordPath(wt.dir, 1722)), 'the refreshed record stays in the active checkout')
  assert.deepEqual(recordFilesIn(repo.root), [], 'and the primary checkout still receives no artifact')
})

test('gate run --verify-complete — an UNREADABLE lane journal reds naming the file, never passes as "inline session"', () => {
  const repo = makeRepo(RUN_CFG())
  // A launch that died mid-write leaves a truncated journal. Treating it as "no journal" drops
  // the reconcile with no output at all — the phase file's claim goes unchecked and nobody knows.
  repo.writePhase(1616, donePhase(1616, { model: CLAIMED_MODEL, lane: 'session' }))
  repo.commit('feat: phase 1616 — code', { 'lib/p.ts': 'export const p = 1\n' })
  assert.equal(runGateCmd(repo.root, ['1616']).code, 0)
  mkdirSync(join(repo.root, '.building'), { recursive: true })
  const jPath = join(repo.root, '.building', 'codex-1616.json')
  writeFileSync(jPath, '{\n  "phases": [\n    "1616"\n  ],\n  "driver": { "model": "gpt')

  const r = runGateCmd(repo.root, ['1616', '--verify-complete'])
  assert.equal(r.code, 2, `an unreadable launcher record is not an absent one; stdout: ${r.stdout} stderr: ${r.stderr}`)
  assert.ok(r.stderr.includes(jPath), `the file that could not be read must be NAMED; stderr: ${JSON.stringify(r.stderr)}`)
  assert.match(r.stderr, /inline session/, `and told apart from the no-journal case; stderr: ${JSON.stringify(r.stderr)}`)
})

test('gate run --verify-complete — a driver mismatch names the STALE-JOURNAL remedy, not just the disagreement', () => {
  const repo = makeRepo(RUN_CFG())
  // The abandoned-lane case: `codex run` was launched, the run died or came back BLOCKED, and the
  // phase was finished inline. Nothing prunes journals, so the honest inline stamp reds forever
  // unless the error says what to do about it.
  repo.writePhase(1617, donePhase(1617, { model: CLAIMED_MODEL, lane: 'session' }))
  repo.commit('feat: phase 1617 — code', { 'lib/q.ts': 'export const q = 1\n' })
  assert.equal(runGateCmd(repo.root, ['1617']).code, 0)
  const jPath = writeRunJournal(repo.root, [1617])

  const r = runGateCmd(repo.root, ['1617', '--verify-complete'])
  assert.equal(r.code, 2, `the disagreement still reds; stdout: ${r.stdout} stderr: ${r.stderr}`)
  assert.match(r.stderr, /ABANDONED/, `an operator holding an honest inline stamp needs the way out NAMED; stderr: ${JSON.stringify(r.stderr)}`)
  assert.ok(
    r.stderr.includes(`delete ${jPath}`),
    `the remedy must name the exact file to remove (nothing prunes journals); stderr: ${JSON.stringify(r.stderr)}`,
  )
})

// ── the corrupt-latest-report lane (phase 9.2) ───────────────────────────────────────
//
// latestReport() answers `null` both when a phase has no gate report AND when the newest
// run file cannot be read, so both --record-round and --verify-complete narrate corrupt
// evidence as MISSING evidence: "no run report for phase N" / "no readable report under
// roadmap/.gate/N/". The operator then re-runs the gate, a fresh run file lands on top, and
// nobody ever learns which record was unreadable. The fix is a typed refusal
// (GateReportUnreadableError) that names the concrete file; these fixtures pin that the CLI
// SURFACES it rather than translating it back into absence, that it never quietly repairs or
// rewrites the file, and — the positive control in each — that a well-formed report behaves
// exactly as it does today.

/** Replace the NEWEST run file under a phase's gate dir with `body`. Returns its path. */
function corruptNewestReport(root, phase, body) {
  const dir = join(root, 'roadmap', '.gate', String(phase))
  const files = readdirSync(dir)
    .filter((f) => /^run-\d+-.*\.json$/.test(f))
    .sort()
  assert.ok(files.length > 0, 'fixture bug: the phase must already have a gate report to corrupt')
  const path = join(dir, files[files.length - 1])
  writeFileSync(path, body)
  return path
}
/** The OLDEST run file's parsed contents — the report a fall-back reader would wrongly use. */
const oldestReportOf = (root, phase) => {
  const dir = join(root, 'roadmap', '.gate', String(phase))
  const files = readdirSync(dir).filter((f) => /^run-\d+-.*\.json$/.test(f)).sort()
  return JSON.parse(readFileSync(join(dir, files[0]), 'utf8'))
}
const CORRUPT_BODY = '{ "phase": 0, "green": tru }\n'

test('gate run --record-round — corrupt newest report is NAMED, never reported as no report at all', () => {
  const repo = makeRepo(RUN_CFG())
  repo.writePhase(1310, phaseObj({ phase: 1310 }))
  repo.commit('feat: phase 1310 — code', { 'lib/e2.ts': 'export const e = 1\n' })
  // TWO runs: the older report stays well-formed, so a reader that fell back to the newest
  // READABLE file would append the round to stale evidence and exit 0 — green over a record
  // nobody can read.
  assert.equal(runGateCmd(repo.root, ['1310']).code, 0)
  assert.equal(runGateCmd(repo.root, ['1310']).code, 0)
  const corruptPath = corruptNewestReport(repo.root, 1310, CORRUPT_BODY)
  const round = JSON.stringify({ round: 1, agent: 'code-reviewer', verdict: 'clean', summary: '0 findings' })

  const r = runGateCmd(repo.root, ['1310', '--record-round', round])

  // EXACT code, not merely non-zero: --record-round answers every failure with 2 (malformed
  // JSON, shape refusal, no report to append to), and unreadable evidence is one more of those.
  // A loose `!= 0` would let the mode's own convention drift without a red.
  assert.equal(r.code, 2, `--record-round refuses with 2, its code for every other failure; stdout: ${r.stdout} stderr: ${r.stderr}`)
  assert.match(r.stderr, /GateReportUnreadableError/, `the failure names its class; stderr: ${JSON.stringify(r.stderr)}`)
  assert.ok(r.stderr.includes(corruptPath), `and the concrete run file; stderr: ${JSON.stringify(r.stderr)}`)
  assert.equal(
    /no run report for phase/.test(r.stderr),
    false,
    `corrupt evidence must never be narrated as ABSENT evidence; stderr: ${JSON.stringify(r.stderr)}`,
  )
  assert.equal(/no readable report/.test(r.stderr), false, `nor as "no readable report"; stderr: ${JSON.stringify(r.stderr)}`)
  assert.equal(readFileSync(corruptPath, 'utf8'), CORRUPT_BODY, 'the unreadable file is left byte-identical — nothing repairs it')
  assert.equal(oldestReportOf(repo.root, 1310).agents.length, 0, 'and the round did NOT land in an older report instead')

  // Positive control: the SAME command over a well-formed newest report behaves as today.
  writeFileSync(corruptPath, JSON.stringify({ ...oldestReportOf(repo.root, 1310), baseSha: 'repaired' }, null, 2) + '\n')
  const ok = runGateCmd(repo.root, ['1310', '--record-round', round])
  assert.equal(ok.code, 0, ok.stderr)
  assert.equal(latestReportOf(repo.root, 1310).agents.length, 1, 'the round appends to the newest report exactly as before')
})

test('gate run --verify-complete — corrupt newest report names the report, not an empty .gate dir', () => {
  const repo = makeRepo(RUN_CFG())
  repo.writePhase(1410, phaseObj({ phase: 1410 }))
  repo.commit('feat: phase 1410 — code', { 'lib/f2.ts': 'export const f = 1\n' })
  assert.equal(runGateCmd(repo.root, ['1410']).code, 0)
  assert.equal(runGateCmd(repo.root, ['1410']).code, 0)
  const corruptPath = corruptNewestReport(repo.root, 1410, CORRUPT_BODY)

  const r = runGateCmd(repo.root, ['1410', '--verify-complete'])

  // EXACT code, not merely non-zero. --verify-complete splits its codes: 1 when it CANNOT
  // evaluate (no .gate dir, no run file, unreadable phase file) and 2 when it evaluated and
  // found a problem. Unreadable evidence is the first kind, so 1 — and pinning it keeps the
  // two commands' differing conventions deliberate rather than accidental.
  assert.equal(r.code, 1, `--verify-complete cannot EVALUATE, which is its 1; stdout: ${r.stdout} stderr: ${r.stderr}`)
  assert.match(r.stderr, /GateReportUnreadableError/, `the failure names its class; stderr: ${JSON.stringify(r.stderr)}`)
  assert.ok(r.stderr.includes(corruptPath), `and the concrete run file; stderr: ${JSON.stringify(r.stderr)}`)
  assert.equal(
    /no readable report under roadmap\/\.gate\//.test(r.stderr),
    false,
    `the .gate dir is NOT empty — saying so sends the operator to re-run the gate and bury the corrupt file; stderr: ${JSON.stringify(r.stderr)}`,
  )
  assert.equal(/no run report for phase/.test(r.stderr), false, `nor the absent-report wording; stderr: ${JSON.stringify(r.stderr)}`)
  assert.equal(
    /consistent with the latest green gate report/.test(r.stdout),
    false,
    `and it certainly never verdicts CONSISTENT; stdout: ${JSON.stringify(r.stdout)}`,
  )
  assert.equal(readFileSync(corruptPath, 'utf8'), CORRUPT_BODY, 'the unreadable file is left byte-identical')

  // Positive control: restore a well-formed newest report and the verify passes as today.
  writeFileSync(corruptPath, JSON.stringify({ ...oldestReportOf(repo.root, 1410), baseSha: 'repaired' }, null, 2) + '\n')
  const ok = runGateCmd(repo.root, ['1410', '--verify-complete'])
  assert.equal(ok.code, 0, ok.stderr)
  assert.match(ok.stdout, /phase 1410 consistent with the latest green gate report/)
})

// ── --slots against a mode that cannot apply it ──────────────────────────────────────
//
// parseArgs accepts --slots beside --record-round and --verify-complete, but both of those
// modes return from runGate before buildPlan ever constructs the filter. The operator asks for
// a scoped action and silently gets the full-scope one. The dispatch must REFUSE instead, by
// both flag names, before any gate report is read or written — a refusal that lands after
// appendAgentRound has already mutated the evidence it was meant to protect.

/** Every path under a phase's gate dir (recursive, sorted) + the bytes of each .json.
 *  The listing catches a new run file or slot log; the bytes catch an in-place append. */
function gateTreeSnapshot(root, phase) {
  const dir = join(root, 'roadmap', '.gate', String(phase))
  const walk = (d, prefix) => {
    const out = []
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      if (e.isDirectory()) out.push(...walk(join(d, e.name), rel))
      else out.push(rel)
    }
    return out
  }
  const listing = walk(dir, '')
  const bytes = {}
  for (const rel of listing) if (rel.endsWith('.json')) bytes[rel] = readFileSync(join(dir, ...rel.split('/')), 'utf8')
  return { listing, bytes }
}

const CONFLICT_ROUND = JSON.stringify({ round: 1, agent: 'code-reviewer', verdict: 'clean', summary: '0 findings' })
// `roadmap --help`: 0 clean · 1 usage/config · 2 check-failed-or-refused. Two flags that cannot
// be combined is a malformed INVOCATION, not a gate that ran and said no.
const USAGE_EXIT = 1

test('gate run refuses --slots with --record-round — both flags named, the report byte-identical', () => {
  const repo = makeRepo(RUN_CFG())
  repo.writePhase(1320, phaseObj({ phase: 1320 }))
  repo.commit('feat: phase 1320 — code', { 'lib/conflict-a.ts': 'export const a = 1\n' })
  assert.equal(runGateCmd(repo.root, ['1320']).code, 0, 'fixture: a well-formed report must exist to be spared')
  const before = gateTreeSnapshot(repo.root, 1320)
  assert.ok(before.listing.some((f) => /^run-\d+-.*\.json$/.test(f)), 'fixture: a run file is on disk')

  const r = runGateCmd(repo.root, ['1320', '--slots', 'types', '--record-round', CONFLICT_ROUND])

  assert.equal(
    r.code,
    USAGE_EXIT,
    `two flags that cannot be combined is a USAGE error, so exit ${USAGE_EXIT} (0 clean / 1 usage / 2 refused); stdout: ${r.stdout} stderr: ${JSON.stringify(r.stderr)}`,
  )
  assert.ok(r.stderr.includes('--slots'), `the diagnostic names --slots; stderr: ${JSON.stringify(r.stderr)}`)
  assert.ok(
    r.stderr.includes('--record-round'),
    `and the mode flag it cannot apply to — a generic "bad flags" line leaves the operator guessing which to drop; stderr: ${JSON.stringify(r.stderr)}`,
  )
  assert.equal(
    /recorded round /.test(r.stdout),
    false,
    `a refused invocation never reports a recorded round; stdout: ${JSON.stringify(r.stdout)}`,
  )

  const after = gateTreeSnapshot(repo.root, 1320)
  assert.deepEqual(after.listing, before.listing, 'no new run file and no new slot log — the refusal precedes every report read and write')
  assert.deepEqual(
    after.bytes,
    before.bytes,
    'the existing report is byte-identical: a refusal that fired AFTER appendAgentRound would already have mutated it',
  )
  assert.equal(latestReportOf(repo.root, 1320).agents.length, 0, 'and no round landed in it')

  // Positive control — the same round WITHOUT --slots still appends and exits clean.
  const ok = runGateCmd(repo.root, ['1320', '--record-round', CONFLICT_ROUND])
  assert.equal(ok.code, 0, ok.stderr)
  assert.equal(latestReportOf(repo.root, 1320).agents.length, 1, 'the unconflicted round lane is untouched by the new refusal')
})

test('gate run refuses --slots with --verify-complete — both flags named, no verdict and no refresh', () => {
  const repo = makeRepo(RUN_CFG())
  repo.writePhase(1420, phaseObj({ phase: 1420 }))
  repo.commit('feat: phase 1420 — code', { 'lib/conflict-b.ts': 'export const b = 1\n' })
  assert.equal(runGateCmd(repo.root, ['1420']).code, 0, 'fixture: a well-formed green report must exist')
  const before = gateTreeSnapshot(repo.root, 1420)
  assert.ok(before.listing.some((f) => /^run-\d+-.*\.json$/.test(f)), 'fixture: a run file is on disk')

  const r = runGateCmd(repo.root, ['1420', '--slots', 'types', '--verify-complete'])

  assert.equal(
    r.code,
    USAGE_EXIT,
    `two flags that cannot be combined is a USAGE error, so exit ${USAGE_EXIT} (0 clean / 1 usage / 2 refused); stdout: ${r.stdout} stderr: ${JSON.stringify(r.stderr)}`,
  )
  assert.ok(r.stderr.includes('--slots'), `the diagnostic names --slots; stderr: ${JSON.stringify(r.stderr)}`)
  assert.ok(
    r.stderr.includes('--verify-complete'),
    `and the mode flag it cannot apply to — a generic "bad flags" line leaves the operator guessing which to drop; stderr: ${JSON.stringify(r.stderr)}`,
  )
  assert.equal(
    /consistent with the latest green gate report/.test(r.stdout),
    false,
    `a refused invocation must not deliver a consistency verdict the operator asked to scope; stdout: ${JSON.stringify(r.stdout)}`,
  )

  const after = gateTreeSnapshot(repo.root, 1420)
  assert.deepEqual(after.listing, before.listing, 'no new run file and no new slot log — the refusal precedes every report read and write')
  assert.deepEqual(after.bytes, before.bytes, 'and the existing report is byte-identical')

  // Positive control — --verify-complete WITHOUT --slots behaves exactly as before.
  const ok = runGateCmd(repo.root, ['1420', '--verify-complete'])
  assert.equal(ok.code, 0, ok.stderr)
  assert.match(ok.stdout, /phase 1420 consistent with the latest green gate report/, 'the unconflicted verify lane is untouched by the new refusal')
})

test('gate run --slots on the default execute path stays fully supported and stamps slotFilter', () => {
  const repo = makeRepo(RUN_CFG())
  repo.writePhase(1270, phaseObj({ phase: 1270 }))
  repo.commit('feat: phase 1270 — code', { 'lib/conflict-c.ts': 'export const c = 1\n' })

  const r = runGateCmd(repo.root, ['1270', '--slots', 'types'])

  assert.equal(r.code, 0, `--slots alone is the mode that CAN apply it — refusing it would be over-refusal; stderr: ${r.stderr}`)
  const rep = latestReportOf(repo.root, 1270)
  assert.equal(rep.slotFilter, 'types', 'the filtered run is stamped as a subset projection')
  assert.ok(rep.slots.some((s) => s.slot === 'types'), `the wanted slot actually ran; got ${rep.slots.map((s) => s.slot).join(', ')}`)
})

// ── R1: a reviewer round must not land in a filtered report, and the flag-conflict guard
//    must not answer for subcommands that have no such modes ──────────────────────────────

/** `roadmap gate <sub> …` for a sub other than run — the guard must never speak for these. */
function runGateSub(root, sub, args) {
  const r = spawnSync('node', [BIN, 'gate', sub, ...args], {
    cwd: root, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ROADMAP_CONFIG: join(root, 'roadmap', 'roadmap.config.json') },
  })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

test('gate run --record-round refuses a FILTERED latest report — the sequential form, not just the same-invocation one', () => {
  // --slots + --record-round in ONE invocation is refused at dispatch. The per-task ritual
  // produces the SEQUENTIAL form instead: a filtered run, then a round recorded later. Without
  // this the round appends to a subset projection and summarizeGateRuns then drops the report
  // entirely, so the round reaches the eval as nothing at all.
  const repo = makeRepo(RUN_CFG())
  repo.writePhase(1510, phaseObj({ phase: 1510 }))
  repo.commit('feat: phase 1510 — code', { 'lib/g2.ts': 'export const g = 1\n' })
  assert.equal(runGateCmd(repo.root, ['1510']).code, 0, 'a FULL run first, so a full report exists to be shadowed')
  assert.equal(runGateCmd(repo.root, ['1510', '--slots', 'types']).code, 0, 'then the routine filtered run lands on top')
  const filtered = latestReportOf(repo.root, 1510)
  assert.equal(filtered.slotFilter, 'types', 'fixture: the NEWEST report must be the filtered one')

  const dir = join(repo.root, 'roadmap', '.gate', '1510')
  const newest = readdirSync(dir).filter((f) => /^run-\d+-.*\.json$/.test(f)).sort().pop()
  const before = readFileSync(join(dir, newest), 'utf8')
  const round = JSON.stringify({ round: 1, agent: 'code-reviewer', verdict: 'clean', summary: '0 findings' })

  const r = runGateCmd(repo.root, ['1510', '--record-round', round])

  assert.equal(r.code, 2, `a filtered report is not a place to record a round; stdout: ${r.stdout} stderr: ${r.stderr}`)
  assert.ok(r.stderr.includes('types'), `the refusal names the FILTER that made it a subset; stderr: ${JSON.stringify(r.stderr)}`)
  assert.ok(r.stderr.includes(join(dir, newest)), `and the concrete report; stderr: ${JSON.stringify(r.stderr)}`)
  assert.equal(
    /recorded round/.test(r.stdout),
    false,
    `and it never claims the round was recorded; stdout: ${JSON.stringify(r.stdout)}`,
  )
  assert.equal(readFileSync(join(dir, newest), 'utf8'), before, 'the filtered report is left byte-identical')
  assert.equal(latestReportOf(repo.root, 1510).agents.length, 0, 'no round landed anywhere')

  // Positive control: the SAME round against a fresh FULL run is recorded exactly as before.
  assert.equal(runGateCmd(repo.root, ['1510']).code, 0)
  const ok = runGateCmd(repo.root, ['1510', '--record-round', round])
  assert.equal(ok.code, 0, ok.stderr)
  assert.equal(latestReportOf(repo.root, 1510).agents.length, 1, 'the round appends to the full report')
})

test('the --slots conflict guard answers for `run` ONLY — it never shadows another subcommand\'s own diagnostic', () => {
  const repo = makeRepo(RUN_CFG())
  repo.writePhase(1520, phaseObj({ phase: 1520 }))
  repo.commit('feat: phase 1520 — code', { 'lib/h2.ts': 'export const h = 1\n' })

  // `gate plan` has neither mode, so the guard must stay silent and plan must behave normally.
  const plan = runGateSub(repo.root, 'plan', ['1520', '--slots', 'types', '--verify-complete'])
  assert.equal(
    /cannot be combined with/.test(plan.stderr),
    false,
    `plan has no --verify-complete mode, so lecturing about it describes a command that does not exist; stderr: ${JSON.stringify(plan.stderr)}`,
  )
  assert.equal(plan.code, 0, `and plan still emits its plan; stderr: ${JSON.stringify(plan.stderr)}`)
  assert.equal(JSON.parse(plan.stdout).phase, 1520, 'the plan is the real one')

  // An unknown subcommand owes its OWN diagnostic — the flag lecture must not pre-empt it.
  const bogus = runGateSub(repo.root, 'frobnicate', ['1520', '--slots', 'types', '--verify-complete'])
  assert.match(
    bogus.stderr,
    /unknown subcommand 'frobnicate'/,
    `an unknown subcommand names itself; the flag conflict is not the reader's problem yet; stderr: ${JSON.stringify(bogus.stderr)}`,
  )
  assert.equal(/cannot be combined with/.test(bogus.stderr), false, 'and the guard stayed out of it')

  // Positive control: under `run`, both conflicts still refuse.
  assert.equal(runGateCmd(repo.root, ['1520', '--slots', 'types', '--verify-complete']).code, 1)
  const rr = JSON.stringify({ round: 1, agent: 'code-reviewer', verdict: 'clean', summary: 'x' })
  assert.equal(runGateCmd(repo.root, ['1520', '--slots', 'types', '--record-round', rr]).code, 1)
})

test('gate run --verify-complete — attribution is still reconciled after the lane journal is ARCHIVED by a land', () => {
  const repo = makeRepo(RUN_CFG())
  // `phase land` / `arc land` rename a landed lane's journal to `codex-<N>.closed.json`, which
  // the live scan class /^codex-[\d-]+\.json$/ deliberately excludes. If the reconcile only ever
  // asks findJournal, every gate re-run after a landed delegated phase silently takes the
  // "no journal at all = an inline session = no check" path — the launcher's record still exists,
  // and nothing compares it to the phase file's claim any more.
  repo.writePhase(1618, donePhase(1618, { model: CLAIMED_MODEL, lane: 'session' }))
  repo.commit('feat: phase 1618 — code', { 'lib/r.ts': 'export const r = 1\n' })
  assert.equal(runGateCmd(repo.root, ['1618']).code, 0)
  const live = writeRunJournal(repo.root, [1618])
  const closed = live.replace(/\.json$/, '.closed.json')
  renameSync(live, closed)

  const r = runGateCmd(repo.root, ['1618', '--verify-complete'])

  assert.equal(r.code, 2, `an archived journal is still launcher truth — the disagreement must red; stdout: ${r.stdout} stderr: ${r.stderr}`)
  assert.ok(r.stderr.includes(closed), `and the remedy names the ARCHIVED file, not a path that no longer exists; stderr: ${JSON.stringify(r.stderr)}`)
})

test('gate run --verify-complete — an UNREADABLE ARCHIVED journal reds, exactly as the live one does', () => {
  const repo = makeRepo(RUN_CFG())
  // archiveJournal's write is not atomic, so a crash mid-write leaves a truncated .closed.json.
  // driverReconcile's own contract two lines above the closed-fallback says a journal that EXISTS
  // and will not parse is a PROBLEM, never an absence — landing a delegated phase must not be
  // what turns that loud guard quiet.
  repo.writePhase(1619, donePhase(1619, { model: CLAIMED_MODEL, lane: 'session' }))
  repo.commit('feat: phase 1619 — code', { 'lib/s.ts': 'export const s = 1\n' })
  assert.equal(runGateCmd(repo.root, ['1619']).code, 0)
  mkdirSync(join(repo.root, '.building'), { recursive: true })
  const closed = join(repo.root, '.building', 'codex-1619.closed.json')
  writeFileSync(closed, '{\n  "phases": [\n    "1619"\n  ],\n  "driver": { "model": "gpt')

  const r = runGateCmd(repo.root, ['1619', '--verify-complete'])

  assert.equal(r.code, 2, `an unreadable archived record is not an absent one; stdout: ${r.stdout} stderr: ${r.stderr}`)
  assert.ok(r.stderr.includes(closed), `the file that could not be read must be NAMED; stderr: ${JSON.stringify(r.stderr)}`)
})

// ── gateRounds `agent` — the members recorded gate reality actually needs ─────────────
// A phase file records WHO gated it. When the enum omits a role the gate genuinely ran, the
// only way to record that round is under ANOTHER member's name — the phase then attributes
// work to an agent that never did it, and no later reader (audit, eval scorecard, reviewer
// yield) can tell. These drive the WHOLE seam the per-task ritual drives: the phase file goes
// through `definePhase` (the consumer schema's import-time parse — a plain `export default
// {…}` fixture never reaches the enum), the round is appended with --record-round, and
// --verify-complete reconciles the two.
const CONSUMER_SCHEMA = join(PLUGIN_ROOT, '..', '..', 'lib', 'roadmap', 'schema.ts')

/** The minimal phase document `definePhase` accepts, plus the rounds under test. */
const enumPhaseObj = (num, gateRounds) => ({
  phase: num,
  name: `Enum fixture phase ${num}`,
  category: 'feature',
  source: 'phase 17 — gateRounds agent enum',
  priority: 'MEDIUM',
  dependsOn: [],
  conflictsWith: [],
  keyFiles: ['lib/a.ts'],
  stakeholderDemo: 'the recorded round names the agent that ran it',
  tasks: [{ minimal: true, id: `${num}.1`, title: 'seed task', done: true }],
  status: 'in-progress',
  gateRounds,
})

/** Write a phase file that RUNS the consumer schema's import-time Zod parse (the
 *  fixture-consumer harness `definePhaseSrc` idiom), committed in its own non-phase-tagged
 *  commit exactly as makeRepo's writePhase does so it never lands in the phase-own diff.
 *  `schemaFrom` re-points the seeded lib/roadmap/schema.ts at a specific schema HOME. */
function writeDefinePhase(repo, num, gateRounds, { schemaFrom = join(PLUGIN_ROOT, 'templates', 'schema.ts') } = {}) {
  writeFileSync(join(repo.root, 'lib', 'roadmap', 'schema.ts'), `export * from '${schemaFrom}'\n`)
  const body = JSON.stringify(enumPhaseObj(num, gateRounds), null, 2)
  const rel = join('roadmap', 'phases', `phase-${num}.phase.ts`)
  writeFileSync(
    join(repo.root, rel),
    `import { definePhase } from '../../lib/roadmap/schema.ts'\nexport default definePhase(${body})\n`,
  )
  repo.git('add', rel)
  repo.git('commit', '-q', '-m', `seed phase-${num} file`)
}

const structuredRound = (round, agent) => ({ round, agent, verdict: 'clean', summary: `${agent} round ${round}: 0 findings` })
const recordRoundArgs = (num, round, agent) => [String(num), '--record-round', JSON.stringify(structuredRound(round, agent))]

/** Drive one phase end-to-end: green gate run → --record-round per declared round>=1 →
 *  --verify-complete. Returns the three results so each leg fails with its own message. */
function driveRounds(repo, num, rounds) {
  const run = runGateCmd(repo.root, [String(num)])
  const recorded = rounds.filter((r) => r.round >= 1).map((r) => runGateCmd(repo.root, recordRoundArgs(num, r.round, r.agent)))
  const verify = runGateCmd(repo.root, [String(num), '--verify-complete'])
  return { run, recorded, verify }
}

test('gate run — a software-architect round is recordable AND declarable: it appends, the phase file parses, the counts agree', { timeout: 240_000 }, () => {
  const repo = makeRepo(RUN_CFG(), { consumerSchema: true })
  const rounds = [structuredRound(0, 'quality-pass'), structuredRound(1, 'software-architect')]
  writeDefinePhase(repo, 1740, rounds)
  repo.commit('feat: phase 1740 — code', { 'lib/a.ts': 'export const a = 1\n' })

  const { run, recorded, verify } = driveRounds(repo, 1740, rounds)

  assert.equal(run.code, 0, `the phase file must READ: a round the enum rejects makes the whole phase unparseable; stderr: ${run.stderr}`)
  assert.equal(recorded[0].code, 0, `--record-round must append the architect round; stderr: ${recorded[0].stderr}`)
  const agents = latestReportOf(repo.root, 1740).agents
  assert.deepEqual(
    agents.map((a) => a.agent),
    ['software-architect'],
    'the report carries the round under the agent that RAN it — never relabelled to a member the enum happens to allow',
  )
  assert.equal(verify.code, 0, `phase and report agree on one round>=1; stdout: ${verify.stdout} stderr: ${verify.stderr}`)
})

test('gate run — a self-review round is recordable AND declarable: it appends, the phase file parses, the counts agree', { timeout: 240_000 }, () => {
  const repo = makeRepo(RUN_CFG(), { consumerSchema: true })
  const rounds = [structuredRound(0, 'quality-pass'), structuredRound(1, 'self-review')]
  writeDefinePhase(repo, 1741, rounds)
  repo.commit('feat: phase 1741 — code', { 'lib/a.ts': 'export const a = 1\n' })

  const { run, recorded, verify } = driveRounds(repo, 1741, rounds)

  assert.equal(run.code, 0, `the phase file must READ: a round the enum rejects makes the whole phase unparseable; stderr: ${run.stderr}`)
  assert.equal(recorded[0].code, 0, `--record-round must append the self-review round; stderr: ${recorded[0].stderr}`)
  assert.deepEqual(
    latestReportOf(repo.root, 1741).agents.map((a) => a.agent),
    ['self-review'],
    'a self-reviewed round is recorded as SELF-review — laundering it as code-reviewer invents an independent pass that never happened',
  )
  assert.equal(verify.code, 0, `phase and report agree on one round>=1; stdout: ${verify.stdout} stderr: ${verify.stderr}`)
})

test('gate run — the five pre-existing enum members still parse and still record (the widening adds, it never swaps)', { timeout: 240_000 }, () => {
  const repo = makeRepo(RUN_CFG(), { consumerSchema: true })
  const legacy = ['quality-pass', 'architect-critique', 'simplifier', 'code-reviewer', 'test-engineer']
  const rounds = legacy.map((agent, i) => structuredRound(i + 1, agent))
  writeDefinePhase(repo, 1742, rounds)
  repo.commit('feat: phase 1742 — code', { 'lib/a.ts': 'export const a = 1\n' })

  const { run, recorded, verify } = driveRounds(repo, 1742, rounds)

  assert.equal(run.code, 0, `every historical member must keep parsing — a phase gated before the widening must not stop reading; stderr: ${run.stderr}`)
  assert.deepEqual(recorded.map((r) => r.code), [0, 0, 0, 0, 0], `each legacy member still appends; stderr: ${recorded.map((r) => r.stderr).join(' | ')}`)
  assert.deepEqual(latestReportOf(repo.root, 1742).agents.map((a) => a.agent), legacy, 'all five recorded under their own names, in order')
  assert.equal(verify.code, 0, `five declared rounds, five recorded; stdout: ${verify.stdout} stderr: ${verify.stderr}`)
})

test('gate run — the CONSUMER schema home accepts the same widened enum as the plugin template (the two homes are one contract)', { timeout: 240_000 }, () => {
  // templates/schema.ts is the canonical home; every consumer carries a synced copy at
  // lib/roadmap/schema.ts, and a real phase file imports THAT one. Widening only the template
  // leaves this repo's own phase files rejecting the members the CLI happily records — the
  // split-brain the vendor pair exists to prevent. Same drive, pointed at the second home.
  assert.ok(existsSync(CONSUMER_SCHEMA), `precondition: the consumer schema home ${CONSUMER_SCHEMA} exists`)
  const repo = makeRepo(RUN_CFG(), { consumerSchema: true })
  const rounds = [structuredRound(1, 'software-architect'), structuredRound(2, 'self-review')]
  writeDefinePhase(repo, 1743, rounds, { schemaFrom: CONSUMER_SCHEMA })
  repo.commit('feat: phase 1743 — code', { 'lib/a.ts': 'export const a = 1\n' })

  const { run, recorded, verify } = driveRounds(repo, 1743, rounds)

  assert.equal(run.code, 0, `lib/roadmap/schema.ts must accept both new members, exactly as templates/schema.ts does; stderr: ${run.stderr}`)
  assert.deepEqual(recorded.map((r) => r.code), [0, 0], `both rounds append; stderr: ${recorded.map((r) => r.stderr).join(' | ')}`)
  assert.deepEqual(latestReportOf(repo.root, 1743).agents.map((a) => a.agent), ['software-architect', 'self-review'])
  assert.equal(verify.code, 0, `two declared rounds, two recorded; stdout: ${verify.stdout} stderr: ${verify.stderr}`)
})

// ────────────────────────────────────────────────────────────────────────────────────────
// phase 16 task 16.2 — the PHASE-OWN FILE SET must read the shared ownership grammar.
// The seam is the real `gate plan` JSON (the established one in this file): `diff.files` /
// `diff.classes` / `diff.specialistPaths` are the phase-own set, `foreignCommitsInRange` is
// its complement over base..HEAD, so between them every file in the range is accounted for
// in exactly one bucket. What a RED means: a history written in the recorded deviant
// grammars (D1 `phase N task N.X`, D2 `(phase-N)`, D4 dash variants, D5 `phase N N.X`)
// attributes FEWER files than its canonical twin, so scope and floors under-derive.
// ────────────────────────────────────────────────────────────────────────────────────────

const EM = '—'
const EN = '–'
const HY = '-'

/** The sibling every fixture carries: foreign work whose BODY quotes the grammar.
 *  `git log --grep` reads the whole message, so a body-reading matcher swallows this. */
const bodyQuoter = (n) => `feat(sib): sibling module work\n\nRelated to phase ${n} ${EM} ${n}.9 grammar, but not part of that phase.`

const CANONICAL = (n) => ({
  move: `plan(roadmap): phase ${n} ${EM} move to in-progress`,
  alpha: `feat(scope): phase ${n} ${EM} ${n}.1 alpha`,
  beta: `docs(roadmap): phase ${n} ${EM} ${n}.2 beta`,
})

/** The same three commits in grammars real executors really shipped (gitscan.test.mjs MATCH). */
const DEVIANT = (n) => ({
  move: `plan(phase-${n}): move to in-progress`, //            D2 scope-carried, no dash
  alpha: `feat(scope): phase ${n} task ${n}.1 ${HY} alpha`, //  D1 + ASCII hyphen
  beta: `docs(roadmap): phase ${n} ${n}.2 ${EN} beta`, //       D5 + en dash
})

/** One twin: identical commit positions and an identical file set, differing ONLY in the
 *  subject grammar. Returns the repo plus the sha the base must derive to. */
function seedTwin(phaseNum, subjects) {
  const repo = makeRepo()
  repo.writePhase(phaseNum, phaseObj({ phase: phaseNum }))
  repo.commit('chore(deps): unrelated pre-work', { 'lib/pre.ts': 'export const pre = 0\n' })
  const preSha = repo.git('rev-parse', 'HEAD').trim()
  repo.commit(subjects.move, { 'roadmap/plan.md': '# plan\n' })
  repo.commit(subjects.alpha, { 'lib/alpha.ts': 'export const a = 1\n' })
  repo.commit(bodyQuoter(phaseNum), { 'lib/sibling.ts': 'export const s = 2\n' })
  repo.commit(subjects.beta, { 'docs/beta.md': '# beta\n' })
  return { repo, preSha }
}

/** The grammar-independent projection of a plan: what the phase owns, and what it does not. */
const attribution = (plan) => ({
  files: plan.diff.files,
  classes: [...plan.diff.classes].sort(),
  specialistPaths: [...plan.diff.specialistPaths].sort(),
  foreign: [...(plan.foreignCommitsInRange ?? [])].sort(),
})

test('gate plan — 16.2: a deviant-grammar history derives the same base and phase-own file set as its canonical twin', () => {
  const canon = seedTwin(6100, CANONICAL(6100))
  const deviant = seedTwin(6101, DEVIANT(6101))

  const rc = planOf(canon.repo.root, ['6100'])
  assert.equal(rc.code, 0, rc.stderr)
  // Anti-vacuity: the canonical twin's answer is pinned ABSOLUTELY first, so the twin
  // equality below cannot pass by both sides deriving nothing.
  assert.equal(rc.plan.baseSha, canon.preSha, 'canonical base = parent of the move-to-in-progress commit')
  assert.deepEqual(attribution(rc.plan), {
    files: 3,
    classes: ['docs', 'lib'],
    specialistPaths: [],
    foreign: ['lib/sibling.ts'],
  }, 'canonical: owns move + alpha + beta; the body-quoting sibling is foreign')

  const rd = planOf(deviant.repo.root, ['6101'])
  assert.equal(rd.code, 0, rd.stderr)
  assert.equal(rd.plan.baseSha, deviant.preSha, 'deviant base = parent of its D2 move commit — the same position as the twin')
  assert.deepEqual(
    attribution(rd.plan),
    attribution(rc.plan),
    'the deviant grammar must attribute EXACTLY what the canonical grammar attributes',
  )
})

test('gate plan — 16.2: two deviant-grammar phases share a range and attribute only their own files, in both directions', () => {
  const repo = makeRepo()
  repo.writePhase(6200, phaseObj({ phase: 6200 }))
  repo.writePhase(6201, phaseObj({ phase: 6201 }))
  repo.commit('chore(deps): unrelated pre-work', { 'lib/pre.ts': 'export const pre = 0\n' })
  const base = repo.git('rev-parse', 'HEAD').trim()
  repo.commit(`feat(scope): phase 6200 task 6200.1 ${HY} own alpha`, { 'lib/a6200.ts': 'export const a = 1\n' })
  repo.commit(`docs(roadmap): phase 6201 6201.1 ${EN} own beta`, { 'docs/b6201.md': '# b\n' })
  repo.commit(bodyQuoter(6200), { 'lib/sibling.ts': 'export const s = 2\n' })
  repo.commit('docs(roadmap): mark phase 6200 complete', { 'roadmap/state-6200.md': '# done\n' })

  const r0 = planOf(repo.root, ['6200', '--base', base])
  assert.equal(r0.code, 0, r0.stderr)
  assert.deepEqual(attribution(r0.plan), {
    files: 2,
    classes: ['docs', 'lib'],
    specialistPaths: [],
    foreign: ['docs/b6201.md', 'lib/sibling.ts'],
  }, "6200 owns its D1 commit and its mark-complete commit — never 6201's file, never the body-quoter's")

  const r1 = planOf(repo.root, ['6201', '--base', base])
  assert.equal(r1.code, 0, r1.stderr)
  assert.deepEqual(attribution(r1.plan), {
    files: 1,
    classes: ['docs'],
    specialistPaths: [],
    foreign: ['lib/a6200.ts', 'lib/sibling.ts', 'roadmap/state-6200.md'],
  }, "6201 owns only its own D5 commit — 6200's files stay foreign in this direction too")
})

/**
 * Source-scan helpers (acceptance 2). PROSE IS NOT CODE: gate.mjs documents the em-dash
 * rule in several comments, so a raw text search would flag the comment that TEACHES the
 * grammar. `codeOf` strips comments so the scan reads only what executes; `grepSites`
 * returns the git ARGUMENT ARRAY carrying each `--grep=`, so the assertion is about what
 * is HANDED TO GIT — a character window around the call also swept in the neighbouring
 * error text that deliberately TEACHES the canonical form.
 */
function codeOf(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')
}

function grepSites(code) {
  return [...code.matchAll(/\[[^\]]*--grep=[^\]]*\]/g)].map((m) => m[0])
}

test('gate plan — 16.2: gate.mjs carries no fixed-string phase-number/em-dash grep — it binds on the shared matcher', () => {
  const code = codeOf(readFileSync(join(HERE, 'gate.mjs'), 'utf8'))
  assert.equal(
    /const\s+\w+\s*=\s*`phase\s+\$\{[^`]*[—–]/.test(code),
    false,
    'a `phase ${n} —` grep constant is the D1-D5 blind spot itself — the grammar has ONE home',
  )
  for (const site of grepSites(code)) {
    assert.equal(
      /phase\s+\$\{\s*\w+\s*\}\s*[—–]/.test(site),
      false,
      `a git --grep= fed a fixed phase-number/em-dash string:\n${site}`,
    )
    assert.match(site, /'-E'/, `the shared ere is an EXTENDED regex — git needs -E here:\n${site}`)
  }
  // Positive pair: the negative above must not be satisfiable by deleting the attribution scan.
  assert.match(code, /phaseOwnPatterns/, 'phaseOwnFiles must bind on the shared gitscan matcher')
})

// ── deviantGrammarFindings — one teaching WARN per tolerated class (phase 16 task 16.3) ─
/**
 * TEST-FIRST — RED until 16.3 widens the scan. 16.1/16.2 made the READ tolerant of the five
 * recorded deviant classes, and tolerance without a word back is how three consumers kept
 * writing subjects nobody could parse: the scan warns on exactly ONE class today (D5,
 * `phase N N.X —`, the 1696/1699 form), so the other four now pass through in silence.
 *
 * The properties: one WARN per deviant commit in the range, each naming its sha7, quoting
 * its subject verbatim, and CARRYING the canonical em-dash form (a WARN that only repeats
 * the subject teaches nothing — note that no deviant rendering below contains
 * `phase <N> —` itself, so this assertion cannot pass on the echoed subject). Both
 * directions per class: the taught write forms warn about nothing, a neighbouring phase
 * number warns nothing here (and still warns for ITSELF — the anti-vacuity half), and a
 * commit that merely QUOTES the grammar mid-subject is not this phase's to teach.
 */

/** One single-class rendering per tolerated deviant class, phase number parameterised. */
const deviantSubjects = (n) => [
  { klass: 'D1 `phase N task N.X <dash>`', subject: `feat(mudarabah): phase ${n} task ${n}.1 ${EM} batch identity + batch rollup` },
  { klass: 'D2 scope-carried `(phase-N)`', subject: `fix(phase-${n}): quality pass ${EM} prune comment prose, dedupe the usable-amount check` },
  { klass: 'D4 dash variant', subject: `feat(atlas-web): phase ${n} ${HY} add Library tree` },
  { klass: 'D4 gate-fix dash variant', subject: `fix(cli): phase ${n} gate R1 ${HY} reviewer findings` },
  { klass: 'D4 batch-step dash variant', subject: `chore(repo): phase ${n} task ${n}.2 (1/3) ${HY} batch work` },
  { klass: 'D5 `phase N N.X <dash>`', subject: `feat(console): phase ${n} ${n}.5 ${EM} Agent record as the roster detail view` },
]

/** Commit each subject on its own file; returns the rows with their shas, oldest-first. */
function seedSubjects(repo, rows, tag) {
  return rows.map((row, i) => {
    repo.commit(row.subject, { [`lib/${tag}${i}.ts`]: `export const ${tag}${i} = ${i}\n` })
    return { ...row, sha: repo.git('rev-parse', 'HEAD').trim() }
  })
}

test('deviantGrammarFindings — 16.3: every tolerated deviant class emits its own teaching WARN', () => {
  const repo = makeRepo()
  repo.commit(`docs(roadmap): phase 7301 ${EM} move to in-progress`, { 'lib/seed.ts': 'export const s = 0\n' })
  const base = repo.git('rev-parse', 'HEAD').trim()
  const rows = seedSubjects(repo, deviantSubjects(7301), 'd')

  const findings = deviantGrammarFindings(repo.root, 7301, base)

  assert.equal(findings.length, rows.length, `one WARN per deviant commit; got ${findings.length}:\n${findings.join('\n')}`)
  for (const row of rows) {
    const sha7 = row.sha.slice(0, 7)
    const mine = findings.filter((f) => f.includes(sha7))
    assert.equal(mine.length, 1, `${row.klass} must warn exactly once (${sha7}): ${row.subject}`)
    assert.ok(mine[0].includes(row.subject), `${row.klass}'s WARN must quote the subject verbatim: ${mine[0]}`)
    assert.match(mine[0], /commit grammar/i, `${row.klass}'s WARN must name the finding class: ${mine[0]}`)
    assert.match(
      mine[0],
      new RegExp(`phase (N|7301) ${EM}`),
      `${row.klass}'s WARN must teach the canonical em-dash form, not just quote the deviant one: ${mine[0]}`,
    )
  }
})

test('deviantGrammarFindings — 16.3: the taught write forms warn about nothing (the batch step’s (k/M) token is not D1)', () => {
  const repo = makeRepo()
  repo.commit(`docs(roadmap): phase 7301 ${EM} move to in-progress`, { 'lib/seed.ts': 'export const s = 0\n' })
  const base = repo.git('rev-parse', 'HEAD').trim()
  const canonical = [
    `feat(cli): phase 7301 ${EM} 7301.1 the first task`,
    `chore(repo): phase 7301 task 7301.2 (1/3) ${EM} a batch step lands`,
    `fix(cli): phase 7301 gate R0 ${EM} quality-pass findings`,
    `docs(roadmap): phase 7301 ${EM} record the transparency report`,
    'docs(roadmap): mark phase 7301 complete',
  ]
  canonical.forEach((s, i) => repo.commit(s, { [`lib/c${i}.ts`]: `export const c${i} = ${i}\n` }))

  for (const subject of canonical) {
    assert.equal(
      phaseOwnPatterns(7301).test(subject),
      true,
      `every silent canonical row must first prove it is phase-own: ${subject}`,
    )
  }

  assert.deepEqual(
    deviantGrammarFindings(repo.root, 7301, base),
    [],
    'a phase written entirely in the taught grammar must produce a silent gate — a WARN here is noise on every clean phase',
  )
})

test('deviantGrammarFindings — 16.3: overlapping D1 and D4 deviations produce one WARN naming both', () => {
  const repo = makeRepo()
  repo.commit(`docs(roadmap): phase 7301 ${EM} move to in-progress`, { 'lib/seed.ts': 'export const s = 0\n' })
  const base = repo.git('rev-parse', 'HEAD').trim()
  repo.commit(`feat(cli): phase 7301 task 7301.2 ${HY} overlap`, { 'lib/overlap.ts': 'export const overlap = true\n' })

  const findings = deviantGrammarFindings(repo.root, 7301, base)
  assert.equal(findings.length, 1)
  assert.match(findings[0], /D1/)
  assert.match(findings[0], /D4/)
})

test('deviantGrammarFindings — 16.3: a neighbouring phase number warns nothing here, and still warns for itself', () => {
  const repo = makeRepo()
  repo.commit(`docs(roadmap): phase 7301 ${EM} move to in-progress`, { 'lib/seed.ts': 'export const s = 0\n' })
  const base = repo.git('rev-parse', 'HEAD').trim()
  // 73011 extends this phase's digits to the right, 730 to the left, 7302 is the sibling.
  const neighbours = [73011, 730, 7302]
  const seeded = neighbours.map((n) => ({ n, rows: seedSubjects(repo, deviantSubjects(n), `n${n}`) }))

  assert.deepEqual(
    deviantGrammarFindings(repo.root, 7301, base),
    [],
    'no neighbouring phase number may be warned about under 7301 — the digit bound is the property the whole attribution seam stands on',
  )
  // Anti-vacuity: those same commits ARE warnable, under their own phase numbers.
  for (const { n, rows } of seeded) {
    const own = deviantGrammarFindings(repo.root, n, base)
    assert.equal(own.length, rows.length, `phase ${n} must warn on its own ${rows.length} deviant commits; got:\n${own.join('\n')}`)
    for (const row of rows) {
      assert.ok(own.some((f) => f.includes(row.sha.slice(0, 7))), `phase ${n} must warn on its own ${row.klass}: ${row.subject}`)
    }
  }
})

test('deviantGrammarFindings — 16.3: a subject that merely QUOTES the grammar is not this phase’s to teach', () => {
  const repo = makeRepo()
  repo.commit(`docs(roadmap): phase 7301 ${EM} move to in-progress`, { 'lib/seed.ts': 'export const s = 0\n' })
  const base = repo.git('rev-parse', 'HEAD').trim()
  const quoting = [
    `docs(skills): document the "phase 7301 7301.5 ${EM}" commit grammar`,
    `chore(deps): bump zod ${EM} no relation to phase 7301 task 7301.1 ${EM} at all`,
    'docs(roadmap): explain why we mark phase 7301 complete only after the gate',
    bodyQuoter(7301),
  ]
  quoting.forEach((s, i) => repo.commit(s, { [`lib/q${i}.ts`]: `export const q${i} = ${i}\n` }))

  assert.deepEqual(
    deviantGrammarFindings(repo.root, 7301, base),
    [],
    'the WARN teaches the author of a PHASE-OWN commit; a foreign session’s prose gets attributed to nobody',
  )
})

test('phaseOwnFiles: the commit-header detector is hash-WIDTH agnostic (sha256 repos)', () => {
  // `%H` is 40 hex under SHA-1 and 64 under SHA-256. A hardcoded {40} drops every header row in
  // a sha256 repo, so the phase-own set empties and test/review scope under-derives silently —
  // the one failure shape this whole phase exists to end. Pinned on the SOURCE because a sha256
  // fixture repo needs host git support the shared box may not carry; the regex is the defect.
  const src = readFileSync(new URL('./gate.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(
    src,
    /\[0-9a-f\]\{40\}\\t/,
    'a fixed 40-hex header match assumes SHA-1 — use a width range so sha256 repos attribute too',
  )
  assert.match(
    src,
    /\[0-9a-f\]\{40,64\}\\t/,
    'the header-row detector must accept both hash widths (40 sha1 / 64 sha256) — cli/commands/gate.mjs phaseOwnFiles',
  )
})
