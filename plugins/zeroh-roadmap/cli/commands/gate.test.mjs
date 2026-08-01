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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { untestedGateFixFindings, deviantGrammarFindings } from './gate.mjs'

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

function runGateCmd(root, args) {
  try {
    const stdout = execFileSync('node', [BIN, 'gate', 'run', ...args], {
      cwd: root, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ROADMAP_CONFIG: join(root, 'roadmap', 'roadmap.config.json') },
    })
    return { code: 0, stdout, stderr: '' }
  } catch (err) {
    return { code: err.status ?? 1, stdout: (err.stdout ?? '').toString(), stderr: (err.stderr ?? '').toString() }
  }
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
