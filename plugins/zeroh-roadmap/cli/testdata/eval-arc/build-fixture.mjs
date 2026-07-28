/**
 * build-fixture — the SHARED arc-eval fixture corpus builder (arc EVALCORE, 1996.2).
 * eval-collect.test.mjs, eval-score.test.mjs and eval.test.mjs all materialize the SAME
 * synthetic arc through this one entry point, so a corpus fact lives in exactly one
 * place and no test can quietly diverge on what "the fixture" contains.
 *
 * `buildEvalFixture(opts)` copies the static `files/` tree into a fresh mkdtemp repo
 * (plain fs.cpSync — NEVER a hardlink clone: shared inodes leak one test's mutations
 * into another's fixture), rewrites the two generated files, and scripts the git
 * history the escape-fix detection is scored against. Every root is registered for
 * removal on process exit, exactly as cli/lib/landing.test.mjs does with its `bases`.
 *
 * ## Bridge posture — a REAL tsx bridge, not an injected exec
 * The fixture repo carries a `lib/roadmap/schema.ts` that RE-EXPORTS the real consumer
 * schema by absolute path (the cli/lib/tsx-bridge.test.mjs `makeConsumer` pattern) and a
 * `node_modules/.bin/tsx` shim pointing at the plugin's own tsx. `resolveTsxInvocation`
 * therefore finds a local tsx and the collector's phase reads run through the genuine
 * bridge against the genuine contract — a fixture phase file that violates the consumer
 * schema fails the test instead of sailing past an exec stub that would have returned
 * whatever the test author believed the schema said. (A byte COPY of schema.ts cannot
 * work here: it would not resolve its own `zod` import from a mkdtemp repo.)
 */
import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = join(HERE, '..', '..', '..')
const FILES = join(HERE, 'files')

/** The placeholder the shipped fixture file carries; rewritten on every materialize. */
const SCHEMA_PLACEHOLDER = '__SCHEMA_PATH__'

/**
 * The default contract the fixture validates through: the PLUGIN's own templates/schema.ts.
 * Resolved from this module, never a consumer checkout path — the fixture has to build on a
 * machine where no consumer repo exists, and every consumer's lib/roadmap/schema.ts is a
 * synced copy of this file (that sync is proven by the schema tests, not by this fixture).
 */
export const DEFAULT_SCHEMA_PATH = join(PLUGIN_ROOT, 'templates', 'schema.ts')

export const ARC_ID = 'EVALFIX'
export const PHASE_NUMS = [9001, 9002]

/** The scripted history, oldest → newest. `mentionsInBody` is the body-only decoy. */
export const FIXTURE_COMMITS = [
  { subject: 'seed', date: '2026-07-15T09:00:00', files: {} },
  {
    subject: 'feat(x): phase 9001 — 9001.1 add the collector',
    date: '2026-07-16T10:00:00',
    files: { 'src/collector.ts': 'export const collect = () => ({ phases: [] })\n' },
  },
  {
    subject: 'feat(x): phase 9002 — 9002.1 add the scorer',
    date: '2026-07-17T11:00:00',
    files: { 'src/scorer.ts': 'export const score = () => ({ dimensions: {} })\n' },
  },
  // The land boundary: the newest MEMBER commit, so landedAt is this commit's author date.
  {
    subject: 'docs(roadmap): mark phase 9002 complete',
    date: '2026-07-18T12:00:00',
    append: { 'roadmap/phases/phase-9002.phase.ts': '\n// recorded complete\n' },
    files: {},
  },
  // A body-only "phase 9001" mention AFTER the land: must never be read as a member
  // commit (it would drag landedAt forward and swallow the escape fix behind it).
  {
    subject: 'chore: tidy the fixture notes',
    body: 'relates to phase 9001 — no code from that phase is touched here.',
    date: '2026-07-18T18:00:00',
    files: { 'src/notes.txt': 'notes\n' },
  },
  // THE PLANTED ESCAPE FIX: post-land, conventional fix grammar, touches an arc file.
  {
    subject: 'fix(x): repair the collector guard',
    date: '2026-07-19T13:00:00',
    files: { 'src/collector.ts': 'export const collect = () => ({ phases: [], guarded: true })\n' },
  },
  // Post-land fix grammar but ZERO overlap with the arc's files — never an escape.
  {
    subject: 'fix(other): unrelated repair',
    date: '2026-07-20T14:00:00',
    files: { 'src/unrelated.ts': 'export const unrelated = true\n' },
  },
]

/** The one file a `malformedPhase` fixture writes in place of a real phase file. */
const MALFORMED_PHASE_SRC = "throw new Error('boom')\n"

const roots = []
process.on('exit', () => roots.forEach((r) => rmSync(r, { recursive: true, force: true })))

function git(root, args, env = {}) {
  return execFileSync('git', ['-C', root, '-c', 'user.email=fixture@zeroh.test', '-c', 'user.name=fixture', ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
}

/**
 * Materialize the fixture consumer repo. Returns its absolute root.
 *
 * @param {object}  [opts]
 * @param {boolean} [opts.omitVerdicts]  skip writing the verdicts artifact (field-level absence)
 * @param {number}  [opts.malformedPhase] write THIS phase's file as one that throws on import
 * @param {boolean} [opts.omitArc]        skip writing the arc file (the CollectError 'no-arc' case)
 * @param {string}  [opts.schemaPath]     override the consumer schema the fixture validates through
 */
export function buildEvalFixture(opts = {}) {
  const { omitVerdicts = false, malformedPhase = null, omitArc = false, schemaPath = DEFAULT_SCHEMA_PATH } = opts
  const root = mkdtempSync(join(tmpdir(), 'zr-evalfix-'))
  roots.push(root)

  // Plain recursive copy — hardlink cloning would share inodes across fixtures.
  cpSync(FILES, root, { recursive: true })
  // `gate/` ships un-dotted in testdata (a dot-dir is easy to lose to a glob/ignore);
  // its real home is roadmap/.gate/<phase>/.
  renameSync(join(root, 'gate'), join(root, 'roadmap', '.gate'))

  // The shipped file carries a placeholder, so the checked-in fixture names no machine path.
  const schemaHome = join(root, 'lib', 'roadmap', 'schema.ts')
  writeFileSync(schemaHome, readFileSync(schemaHome, 'utf8').replace(SCHEMA_PLACEHOLDER, schemaPath))
  if (omitVerdicts) rmSync(join(root, 'roadmap', 'arc-evals', `${ARC_ID}-2026-07-20-verdicts.json`), { force: true })
  if (omitArc) rmSync(join(root, 'roadmap', 'arcs', `${ARC_ID}.arc.ts`), { force: true })
  if (malformedPhase != null)
    writeFileSync(join(root, 'roadmap', 'phases', `phase-${malformedPhase}.phase.ts`), MALFORMED_PHASE_SRC)

  // A local tsx shim so resolveTsxInvocation binds the plugin's tsx directly (no npx
  // resolution tax) and the bridge is genuinely exercised from the tmp repo.
  const binDir = join(root, 'node_modules', '.bin')
  mkdirSync(binDir, { recursive: true })
  const tsxBin = join(PLUGIN_ROOT, 'node_modules', '.bin', 'tsx')
  writeFileSync(join(binDir, 'tsx'), `#!/bin/sh\nexec ${tsxBin} "$@"\n`)
  chmodSync(join(binDir, 'tsx'), 0o755)

  git(root, ['init', '-q'])
  for (const c of FIXTURE_COMMITS) {
    for (const [rel, content] of Object.entries(c.files ?? {})) {
      mkdirSync(dirname(join(root, rel)), { recursive: true })
      writeFileSync(join(root, rel), content)
    }
    for (const [rel, extra] of Object.entries(c.append ?? {})) {
      const p = join(root, rel)
      if (existsSync(p)) writeFileSync(p, readFileSync(p, 'utf8') + extra)
    }
    git(root, ['add', '-A', '--', ':!node_modules'])
    const message = c.body ? `${c.subject}\n\n${c.body}` : c.subject
    git(root, ['commit', '-q', '--allow-empty', '-m', message], {
      GIT_AUTHOR_DATE: c.date,
      GIT_COMMITTER_DATE: c.date,
    })
  }
  return root
}
