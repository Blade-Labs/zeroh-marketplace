#!/usr/bin/env node
/**
 * TEST-FIRST for cli/lib/gitscan.mjs `phaseOwnPatterns(phaseNum)` (phase 16 task 16.1 —
 * the export does NOT exist yet, so this file is RED until it lands). ONE matcher home
 * for the commit grammar three readers bind on today (curate's classifySubject, gate's
 * phaseOwnFiles, derivePhaseStartSha), returning { ere, test }: `ere` is the single
 * extended-regex STRING handed to `git log -E --grep` AND to `new RegExp`; `test(subject)`
 * is the anchored evaluation of that same grammar.
 *
 * What a RED here means: the read grammar changed. The two tables below are the spec.
 * Every MATCH row is a subject a real executor really wrote — verbatim from the recorded
 * incidents (mudarabah2 725/727/718/719, marketplace 10, atlas 30, azure 1699), the ones
 * whose curation never ran because the canonical-only matchers read them as foreign.
 * Every REFUSE row is a subject the widening must NOT swallow. Tolerance may only grow
 * the match table; it may never touch the refuse table, because the digit boundary
 * (a phase never matches a right-extended or prefixed sibling number) is the
 * property the whole attribution seam stands on, and prose that merely QUOTES the grammar
 * mid-subject must stay foreign or a squash rewrites a sibling session's commit.
 *
 * Both directions, per class: test 4 renders EVERY class form at an own number and at a
 * colliding number and asserts the pattern for one refuses the other's rendering — while
 * asserting the colliding rendering IS matched by ITS own phase's pattern, so no refusal
 * row can pass vacuously on a subject nothing would ever match.
 *
 * The canonical gate-fix form (`phase N gate R<d> —`) is phase-owned too. Revert/scratch
 * policy remains outside this matcher; curate.mjs owns that policy.
 *
 * Run: capbuild node --test cli/lib/gitscan.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { phaseOwnPatterns, derivePhaseStartSha } from './gitscan.mjs'

/**
 * Source-scan helpers (task 16.2 acceptance 2). PROSE IS NOT CODE: every module here
 * documents the em-dash rule in its header, so a raw text search would flag the comment
 * that TEACHES the grammar. `codeOf` strips block + line comments so the scan reads only
 * what executes; `grepSites` returns the git ARGUMENT ARRAY carrying each `--grep=`, so
 * the assertion is about what is HANDED TO GIT — a character window around the call also
 * swept in the neighbouring error text that deliberately TEACHES the canonical form.
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

const EM = '—' // — the canonical boundary dash
const EN = '–' // – D4 variant
const HY = '-' //      D4 variant (atlas 30 shipped this one)

/**
 * MATCH — recorded incident subjects, verbatim, each with the phase that OWNS it.
 * class names are the plan's: canonical, D1 `phase N task N.X <dash>`, D2 scope-carried
 * `(phase-N)`, D3 `mark phase N complete`, D4 dash variants, D5 `phase N N.X <dash>`.
 */
const MATCH = [
  // canonical (the one taught write form) — mudarabah2 727, atlas 30
  { phase: 727, klass: 'canonical', subject: `docs(roadmap): phase 727 ${EM} move to in-progress` },
  { phase: 727, klass: 'canonical', subject: `docs(roadmap): phase 727 ${EM} flush durable lessons` },
  { phase: 30, klass: 'canonical', subject: `fix(atlas-web): phase 30 ${EM} name mkdata without its dated directory` },
  // canonical task form (`phase N — N.X …`) — mudarabah2 727
  { phase: 727, klass: 'canonical', subject: `chore(deps): phase 727 ${EM} 727.7 consumer half lands on 0.34.2` },
  { phase: 727, klass: 'canonical', subject: `fix(lens): phase 727 ${EM} 727.3 per-row shed degradation, ordered ref resolution` },
  { phase: 727, klass: 'canonical gate-fix', subject: `fix(cli): phase 727 gate R0 ${EM} quality-pass findings` },
  // D1 `phase N task N.X <dash>` (no (k/M) token) — the eleven-phase mudarabah2 class
  { phase: 725, klass: 'D1', subject: `feat(mudarabah): phase 725 task 725.1 ${EM} batch identity + batch rollup` },
  { phase: 725, klass: 'D1', subject: `test(mudarabah): phase 725 task 725.5 ${EM} fence the lens out of settlement` },
  // D2 scope-carried `(phase-N)` — the quality-pass/gate-agent class (marketplace 10 refused a squash on it)
  { phase: 718, klass: 'D2', subject: `fix(phase-718): quality pass ${EM} prune comment prose, dedupe the usable-amount check` },
  { phase: 719, klass: 'D2', subject: `fix(phase-719): quality pass ${EM} prune narration, test the untested resolver` },
  { phase: 10, klass: 'D2', subject: `fix(phase-10): quality pass ${EM} true up the validate lint-gate and arc-lane comments` },
  { phase: 693, klass: 'D2', subject: `refactor(phase-693): simplify ${EM} drop anchor re-export, import canonical module directly` },
  // D3 `mark phase N complete` — the state commit whose subject carries no dash at all
  { phase: 725, klass: 'D3', subject: 'docs(roadmap): mark phase 725 complete' },
  { phase: 719, klass: 'D3', subject: 'docs(roadmap): mark phase 719 complete' },
  { phase: 10, klass: 'D3', subject: 'docs(roadmap): mark phase 10 complete' },
  // D4 dash variants — atlas 30's ASCII hyphen collapsed gate scope to a 1-file diff
  { phase: 30, klass: 'D4', subject: `feat(atlas-web): phase 30 ${HY} add Library tree` },
  { phase: 30, klass: 'D4', subject: `feat(atlas-web): phase 30 ${HY} add provenance file table` },
  { phase: 30, klass: 'D4', subject: `feat(atlas-web): phase 30 ${EN} add Library shell` },
  { phase: 725, klass: 'D4', subject: `feat(mudarabah): phase 725 task 725.4 ${HY} unit-economics panel on Financials` },
  { phase: 1699, klass: 'D4', subject: `feat(flags): phase 1699 1699.2 ${EN} WORKFORCE_CONSOLE_ENABLED kill-switch` },
  // D5 `phase N N.X <dash>` — azure 1696/1699, the class today's lone WARN already names
  { phase: 1699, klass: 'D5', subject: `feat(console): phase 1699 1699.5 ${EM} Agent record as the roster detail view` },
  { phase: 1698, klass: 'D5', subject: `docs(roadmap): phase 1698 1698.6 ${EM} validation gate green + APPLY-IDENTITY blueprint` },
]

/**
 * REFUSE — subjects the widened grammar must still read as foreign, for `phase`.
 * `digitBoundary: true` marks the rows the digit bound alone must kill: those must be
 * refused by the raw `ere` too (test 5), not merely by `test`'s anchoring.
 */
const REFUSE = [
  // --- digit boundary: a longer neighbour (21 vs 214), one per class ---
  { phase: 21, subject: `feat(scope): phase 214 ${EM} the sibling's canonical work`, why: 'canonical, 214 is not 21', digitBoundary: true },
  { phase: 21, subject: `feat(mudarabah): phase 214 task 214.3 ${EM} sibling task`, why: 'D1, 214 is not 21', digitBoundary: true },
  { phase: 21, subject: `fix(phase-214): quality pass ${EM} sibling sweep`, why: 'D2, 214 is not 21', digitBoundary: true },
  { phase: 21, subject: 'docs(roadmap): mark phase 214 complete', why: 'D3, 214 is not 21 (bound at end of subject)', digitBoundary: true },
  { phase: 21, subject: `feat(atlas-web): phase 214 ${HY} sibling hyphen work`, why: 'D4, 214 is not 21', digitBoundary: true },
  { phase: 21, subject: `feat(console): phase 214 214.5 ${EM} sibling task`, why: 'D5, 214 is not 21', digitBoundary: true },
  // --- digit boundary: a longer PREFIX (121 vs 21) and a shorter one (2 vs 21) ---
  { phase: 21, subject: `feat(scope): phase 121 ${EM} not this phase either`, why: '121 is not 21', digitBoundary: true },
  { phase: 2, subject: `feat(scope): phase 21 ${EM} the two-digit neighbour`, why: '21 is not 2', digitBoundary: true },
  { phase: 2, subject: 'docs(roadmap): mark phase 21 complete', why: 'D3, 21 is not 2', digitBoundary: true },
  { phase: 1, subject: `fix(phase-10): quality pass ${EM} true up the validate lint-gate`, why: 'D2, 10 is not 1', digitBoundary: true },
  // --- a SIBLING phase's own canonical subject (the interleave curation must refuse) ---
  { phase: 725, subject: `docs(roadmap): phase 726 ${EM} move to in-progress`, why: "a sibling phase's canonical subject", digitBoundary: true },
  { phase: 1699, subject: `feat(web): phase 1698 1698.5 ${EM} parity harness seed`, why: "a sibling phase's D5 subject", digitBoundary: true },
  // --- prose that merely QUOTES the grammar mid-subject: never phase-own ---
  { phase: 725, subject: `docs(roadmap): flush the lessons about the phase 725 ${EM} grammar incident`, why: 'mid-subject prose mention, not the anchored grammar' },
  { phase: 725, subject: `chore(deps): bump zod ${EM} no relation to phase 725 task 725.1 ${EM} at all`, why: 'mid-subject quote of the D1 form' },
  { phase: 725, subject: 'docs(roadmap): explain why we mark phase 725 complete only after the gate', why: 'mid-subject quote of the D3 form' },
  // --- plainly foreign ---
  { phase: 725, subject: 'chore(deps): bump zod to 4.4.3', why: 'no phase token at all' },
  { phase: 725, subject: 'Merge branch main into arc-MINESWEEP', why: 'a merge commit, no grammar' },
]

/** Every class as a template, so both directions can be generated per collision pair. */
const CLASS_FORMS = [
  { klass: 'canonical', render: (n, d) => `feat(scope): phase ${n} ${d} the work` },
  { klass: 'canonical gate-fix', render: (n, d) => `fix(scope): phase ${n} gate R2 ${d} reviewer findings` },
  { klass: 'D1', render: (n, d) => `feat(mudarabah): phase ${n} task ${n}.4 ${d} the fourth task` },
  { klass: 'D2', render: (n, d) => `fix(phase-${n}): quality pass ${d} prune narration` },
  { klass: 'D3', render: (n) => `docs(roadmap): mark phase ${n} complete` },
  { klass: 'D5', render: (n, d) => `feat(console): phase ${n} ${n}.5 ${d} the fifth task` },
]

const DASHES = [
  { name: 'em dash', d: EM },
  { name: 'en dash', d: EN },
  { name: 'ASCII hyphen', d: HY },
]

/** Colliding number pairs: right-extension, left-extension, and the shorter-owner direction. */
const COLLISIONS = [
  { own: 21, foreign: 214 },
  { own: 21, foreign: 121 },
  { own: 2, foreign: 21 },
  { own: 725, foreign: 7250 },
]

test('1) phaseOwnPatterns returns the { ere, test } pair — one regex STRING plus its evaluator', () => {
  const p = phaseOwnPatterns(725)
  assert.equal(typeof p.ere, 'string', 'ere is the ONE extended-regex string both engines take')
  assert.ok(p.ere.length > 0, 'ere is non-empty')
  assert.equal(typeof p.test, 'function', 'test(subject) evaluates the same grammar')
  assert.doesNotThrow(() => new RegExp(p.ere), 'ere must compile under new RegExp (the client-side confirm engine)')
  // Same grammar regardless of how the CLI hands the number over (argv gives strings).
  assert.equal(phaseOwnPatterns('725').ere, p.ere, 'a string phaseNum yields the identical grammar')
  assert.equal(Boolean(phaseOwnPatterns('725').test(`docs(roadmap): phase 725 ${EM} move to in-progress`)), true)
})

test('2) MATCH table — every recorded incident subject is read as its own phase’s work', () => {
  for (const { phase, klass, subject } of MATCH) {
    const p = phaseOwnPatterns(phase)
    assert.equal(Boolean(p.test(subject)), true, `${klass} for phase ${phase} must match: ${subject}`)
  }
})

test('3) REFUSE table — boundary and foreign subjects stay foreign', () => {
  for (const { phase, subject, why } of REFUSE) {
    const p = phaseOwnPatterns(phase)
    assert.equal(Boolean(p.test(subject)), false, `phase ${phase} must NOT match (${why}): ${subject}`)
  }
})

test('4) both directions, every class × every dash × every collision pair', () => {
  for (const { own, foreign } of COLLISIONS) {
    for (const form of CLASS_FORMS) {
      for (const { name, d } of DASHES) {
        const ownSubject = form.render(own, d)
        const foreignSubject = form.render(foreign, d)
        if (ownSubject === foreignSubject) continue // D3 has no dash: one rendering per number
        assert.equal(
          Boolean(phaseOwnPatterns(own).test(ownSubject)),
          true,
          `${form.klass} (${name}) is phase ${own}'s own work: ${ownSubject}`,
        )
        // The anti-vacuity half: the foreign rendering is a REAL subject of this grammar,
        // matched by ITS own phase — so the refusal below cannot pass on a strawman.
        assert.equal(
          Boolean(phaseOwnPatterns(foreign).test(foreignSubject)),
          true,
          `${form.klass} (${name}) is phase ${foreign}'s own work: ${foreignSubject}`,
        )
        assert.equal(
          Boolean(phaseOwnPatterns(own).test(foreignSubject)),
          false,
          `phase ${own} must not swallow phase ${foreign}'s ${form.klass} (${name}): ${foreignSubject}`,
        )
      }
    }
  }
})

test('5) the ere itself carries the grammar AND the digit bound (not just test())', () => {
  for (const { phase, klass, subject } of MATCH) {
    const re = new RegExp(phaseOwnPatterns(phase).ere)
    assert.equal(re.test(subject), true, `ere must also match ${klass} for phase ${phase}: ${subject}`)
  }
  for (const { phase, subject, why, digitBoundary } of REFUSE) {
    if (!digitBoundary) continue // anchoring lives in test(); the bound lives in the ere
    const re = new RegExp(phaseOwnPatterns(phase).ere)
    assert.equal(re.test(subject), false, `ere for phase ${phase} must be digit-bounded (${why}): ${subject}`)
  }
})

const repos = []
process.on('exit', () => repos.forEach((r) => rmSync(r, { recursive: true, force: true })))

/** A hermetic repo of empty commits — one per subject (the gate.test.mjs makeRepo idiom). */
function makeRepo(subjects) {
  const root = mkdtempSync(join(tmpdir(), 'zr-gitscan-'))
  repos.push(root)
  const git = (args, env) =>
    execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      env: { ...process.env, ...env },
    })
  git(['init', '-q'])
  git(['commit', '-q', '--allow-empty', '-m', 'seed'])
  for (const s of subjects) git(['commit', '-q', '--allow-empty', '-m', s])
  return { root, git }
}

test('6) the SAME ere is accepted by `git log -E --grep`, in ANY locale, and keeps the digit bound there', () => {
  const own = [
    `docs(roadmap): phase 725 ${EM} move to in-progress`,
    `feat(mudarabah): phase 725 task 725.1 ${EM} batch identity + batch rollup`,
    `fix(phase-725): quality pass ${EM} prune narration`,
    'docs(roadmap): mark phase 725 complete',
    `feat(mudarabah): phase 725 ${HY} add the shed table`,
    `feat(console): phase 725 725.5 ${EM} the fifth task`,
  ]
  const foreign = [
    `feat(scope): phase 7250 ${EM} a longer neighbour`,
    `feat(scope): phase 726 ${EM} the sibling phase`,
    'chore(deps): bump zod to 4.4.3',
  ]
  const repo = makeRepo([...own, ...foreign])
  const { ere } = phaseOwnPatterns(725)
  // Run the prefilter in BOTH locales. The dash variants must be an alternation of literal
  // byte sequences, never a bracket expression: a multibyte char inside a POSIX bracket is
  // locale-dependent under git's regcomp, so `[—–-]` reads as a set of single BYTES under
  // LC_ALL=C and silently stops matching the em-dash subjects — green on a UTF-8 dev box,
  // red on a C-locale CI runner. Same ere, same answer, either way.
  for (const [locale, env] of [
    ['ambient locale', {}],
    ['LC_ALL=C', { LC_ALL: 'C', LANG: 'C', LC_CTYPE: 'C' }],
  ]) {
    let out
    try {
      out = repo.git(['log', '-E', `--grep=${ere}`, '--format=%s'], env)
    } catch (e) {
      // A pattern git's regcomp rejects (PCRE-only syntax such as \d or (?:…)) fails HERE,
      // where the server-side prefilter lives — long before any client-side confirm.
      assert.fail(`git log -E --grep=<ere> rejected the pattern under ${locale}: ${e.stderr || e.message}\nere: ${ere}`)
    }
    const matched = out.split('\n').filter(Boolean)
    for (const s of own) assert.ok(matched.includes(s), `[${locale}] git -E must select phase 725's own commit: ${s}`)
    for (const s of foreign) assert.ok(!matched.includes(s), `[${locale}] git -E must not select a foreign commit: ${s}`)
  }
})

// ────────────────────────────────────────────────────────────────────────────────────────
// phase 16 task 16.2 — START-SHA DERIVATION must read the SHARED grammar, not a fixed
// `phase <N> —` string. Tests 7-9 are RED until derivePhaseStartSha binds on
// phaseOwnPatterns. What a RED means: a deviant-grammar history (the recorded D1/D2/D4/D5
// classes) derives a DIFFERENT base than its canonical twin, so gate scope and floors
// under-derive on exactly the histories that already shipped.
// ────────────────────────────────────────────────────────────────────────────────────────

/** sha of the commit whose SUBJECT is exactly `subject` (fixture bookkeeping, not the SUT). */
function shaOf(repo, subject) {
  const rows = repo.git(['log', '--format=%H%x09%s']).trim().split('\n')
  const row = rows.find((l) => l.slice(l.indexOf('\t') + 1) === subject)
  assert.ok(row, `fixture is broken: no commit with subject ${JSON.stringify(subject)}`)
  return row.slice(0, row.indexOf('\t'))
}

const PRE = 'chore(deps): unrelated pre-work'

test('7) a deviant-grammar history derives the SAME start SHA as its canonical twin', () => {
  // Two histories, same shape, same positions — one written in the taught canonical form,
  // one in the recorded deviant forms (D2 scope-carried move commit, D1 + ASCII hyphen,
  // D5 + en dash). Tier 1 (newest move-to-in-progress) must fire in BOTH, so both bases
  // land on the pre-work commit. Without tolerant attribution, the deviant twin has no
  // canonical boundary match and derivePhaseStartSha throws GitScanError('no-match').
  const canonical = makeRepo([
    PRE,
    `plan(roadmap): phase 6100 ${EM} move to in-progress`,
    `feat(scope): phase 6100 ${EM} 6100.1 alpha`,
    'feat(sib): sibling module work',
    `docs(roadmap): phase 6100 ${EM} 6100.2 beta`,
  ])
  const deviant = makeRepo([
    PRE,
    'plan(phase-6100): move to in-progress', // D2 scope-carried, no dash after the number
    `feat(scope): phase 6100 task 6100.1 ${HY} alpha`, // D1 + the atlas-30 ASCII hyphen
    'feat(sib): sibling module work',
    `docs(roadmap): phase 6100 6100.2 ${EN} beta`, // D5 + en dash
  ])
  // Anti-vacuity: pin the canonical answer to a real, independently-computed sha first.
  assert.equal(
    derivePhaseStartSha(canonical.root, 6100),
    shaOf(canonical, PRE),
    'canonical twin: base = parent of the move-to-in-progress commit',
  )
  assert.equal(
    derivePhaseStartSha(deviant.root, 6100),
    shaOf(deviant, PRE),
    'deviant twin: the SAME base — the deviant grammar names the same move commit at the same position',
  )
})

test('8) tier 2 — a sibling whose BODY quotes the grammar never becomes the phase’s oldest commit', () => {
  // No move commit anywhere, so tier 2 (parent of the OLDEST own match) decides. The
  // sibling sits BEFORE the phase's own work and only QUOTES the grammar in its body, so
  // the correct base is the sibling commit itself (the parent of the phase's own oldest).
  // `git log --grep` matches the whole message, so a body-reading matcher would instead
  // pick the sibling as the oldest match and hand back the pre-work commit — a base one
  // commit too early, silently widening the range by the sibling's whole diff.
  const OWN_OLDEST = `feat(scope): phase 6300 task 6300.1 ${HY} the phase's own oldest commit`
  const SIBLING = 'feat(sib): sibling module work'
  const repo = makeRepo([
    PRE,
    `${SIBLING}\n\nRelated to phase 6300 ${EM} 6300.9 grammar, but not part of that phase.`,
    OWN_OLDEST,
    `docs(roadmap): phase 6300 6300.2 ${EN} more work`,
  ])
  const derived = derivePhaseStartSha(repo.root, 6300)
  assert.equal(derived, shaOf(repo, SIBLING), `base = parent of ${JSON.stringify(OWN_OLDEST)}`)
  assert.notEqual(
    derived,
    shaOf(repo, PRE),
    'the body-quoting sibling must NOT be read as phase-own: attribution reads SUBJECTS',
  )
})

test('9) gitscan.mjs carries no fixed-string phase-number/em-dash grep — it binds on the shared matcher', () => {
  const code = codeOf(readFileSync(new URL('./gitscan.mjs', import.meta.url), 'utf8'))
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
  // Positive pair: the negative above must not be satisfiable by simply deleting the scan.
  assert.match(code, /phaseOwnPatterns\s*\(/, 'derivePhaseStartSha must call the shared matcher')
})
