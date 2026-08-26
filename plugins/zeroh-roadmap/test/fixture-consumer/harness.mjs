/**
 * fixture-consumer harness — the scratch-consumer-repo substrate the arc ROADCODE 1660
 * wired tier drives the REAL bin/roadmap.mjs against (ROADCODE-DESIGN §6, locked decision 4).
 *
 * A fixture consumer is a REAL consumer by construction (§7): a throwaway git repo carrying
 * nothing but roadmap.config.json, the INSTALLED lib/roadmap/schema.ts (templates/schema.ts
 * COPIED VERBATIM — pre-made decision 1; a hand-fork would recreate the seam-3 split-brain
 * this suite exists to catch), controllable fake-slot commands, and a mini estate. Every
 * suite composes from these primitives; NONE reaches into cli/lib internals — the contract
 * under test is the exit-coded CLI surface a non-Claude executor also drives.
 *
 *   makeFixtureRepo(opts)   → root  (base scaffold + git init + initial commit)
 *   runCli(root, args, env) → { code, stdout, stderr, json }
 *   writePhaseFile / writeArcFile / commitAll / commitPaths / gitLog
 *   readSlotLog(root)       → the fake-slot JSONL records ({ slot, argv, ts })
 *   makeIsolatedArc(root,…) → the isolated-branch two-checkout topology (arc-land)
 *   gitShim(root)           → a PATH `git` shim recording every argv (push-discipline proof)
 *   installConsumerSchema / provisionTsx  (called by makeFixtureRepo; exported for assertions)
 *
 * Teardown is the executor-liveness.test.mjs idiom: a process-exit rmSync over every tmp dir
 * this module created — no scratch repo survives the suite (the 1660.8 residue-delta gate).
 */
import { execFileSync, spawnSync } from 'node:child_process'
import {
  cpSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync,
  realpathSync, existsSync, rmSync, chmodSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const PLUGIN_ROOT = join(HERE, '..', '..')
export const BIN = join(PLUGIN_ROOT, 'bin', 'roadmap.mjs')
export const TEMPLATES_SCHEMA = join(PLUGIN_ROOT, 'templates', 'schema.ts')
export const FAKE_SLOT = join(HERE, 'fixtures', 'fake-slot.sh')
const PLUGIN_ZOD = realpathSync(join(PLUGIN_ROOT, 'node_modules', 'zod'))
const PLUGIN_TSX = realpathSync(join(PLUGIN_ROOT, 'node_modules', 'tsx'))
const PLUGIN_TSX_BIN = join(PLUGIN_ROOT, 'node_modules', '.bin', 'tsx')

/** Every scratch dir this module made, torn down on process exit (no residue — 1660.8). */
export const bases = []
process.on('exit', () => {
  for (const b of bases) rmSync(b, { recursive: true, force: true })
})

const gitId = ['-c', 'user.email=fixture@test', '-c', 'user.name=fixture']
/** git in `root`, returning trimmed stdout (throws on non-zero — a seed step must not fail silently). */
export function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...gitId, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}
export const add = (root, ...paths) => git(root, 'add', ...(paths.length ? paths : ['-A']))
export const commitAll = (root, msg) => { add(root); return git(root, 'commit', '-q', '-m', msg) }
export const commitPaths = (root, msg, paths) => { add(root, ...paths); return git(root, 'commit', '-q', '-m', msg) }
export const gitLog = (root, ref = 'HEAD') => git(root, 'log', '--format=%s', ref)

// ── serialization: plain `export default {…}` (derive/landing/gate read raw) ──────────
/** Serialize a JS object as a `export default` .ts source (the arc.test/landing.test idiom):
 *  quoted keys unquoted, double-quotes → single. No definePhase → no import-time Zod (the
 *  regex + typed-bridge readers only READ fields; they never re-validate). */
export function plainSrc(obj) {
  return 'export default ' + JSON.stringify(obj, null, 2).replace(/"([\w$]+)":/g, '$1:').replace(/"/g, "'") + '\n'
}

/** A definePhase(...) source that DOES run the consumer schema's import-time Zod parse (so
 *  `roadmap phase validate` catches a shape error). Imports the INSTALLED consumer schema by
 *  relative path (roadmap/phases → ../../lib/roadmap/schema.ts), exactly as a real phase file
 *  cites its `@/lib/roadmap/schema` alias — the same seam, resolved for a bare fixture. */
export function definePhaseSrc(obj) {
  const body = JSON.stringify(obj, null, 2).replace(/"([\w$]+)":/g, '$1:').replace(/"/g, "'")
  return `import { definePhase } from '../../lib/roadmap/schema.ts'\nexport default definePhase(${body})\n`
}

export const defaultConfig = (root) => ({
  configVersion: 1,
  gateCommands: {
    lint: 'bash bin/fake-slot.sh lint',
    types: 'bash bin/fake-slot.sh types',
    unit: 'bash bin/fake-slot.sh unit',
    integration: 'bash bin/fake-slot.sh integration',
    build: 'bash bin/fake-slot.sh build',
    e2e: 'none',
    emit: 'bash bin/fake-slot.sh emit',
    'unit-scoped': 'bash bin/fake-slot.sh unit-scoped {files}',
    'integration-scoped': 'bash bin/fake-slot.sh integration-scoped {files}',
    'unit-impacted': 'bash bin/fake-slot.sh unit-impacted {range}',
    'integration-impacted': 'bash bin/fake-slot.sh integration-impacted {range}',
  },
  testCadence: { enabled: true, backstop: 'ci-pr-gate (ci.yml) + nightly', floors: 'blocking' },
  mergePolicy: { arcIntegration: 'autonomous', maxOpenFollowups: 0, autonomousPushRefs: [], primaryCheckout: root },
  modelPolicy: { judgeModel: 'fable' },
  gateSpecialists: [{ paths: ['src/spine/**'], agent: '.claude/agents/spine-reviewer.md' }],
})

/** Copy templates/schema.ts VERBATIM to <root>/lib/roadmap/schema.ts (pre-made decision 1 —
 *  the cmp against templates/schema.ts is a standing assertion; never a hand-written stub). */
export function installConsumerSchema(root) {
  const dest = join(root, 'lib', 'roadmap', 'schema.ts')
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(TEMPLATES_SCHEMA, dest)
  return dest
}

/** Symlink the plugin's own tsx (devDependency, test-only) + zod into the scratch repo's
 *  node_modules (pre-made decision 3) — hermetic: the tsx bridge resolves the CONSUMER's tsx,
 *  never a global. */
export function provisionTsx(root) {
  const nm = join(root, 'node_modules')
  mkdirSync(join(nm, '.bin'), { recursive: true })
  symlinkSync(PLUGIN_ZOD, join(nm, 'zod'), 'dir')
  symlinkSync(PLUGIN_TSX, join(nm, 'tsx'), 'dir')
  symlinkSync(realpathSync(PLUGIN_TSX_BIN), join(nm, '.bin', 'tsx'))
}

/** The consumer registry stub the REAL debt-census.mts (invoked via the tsx bridge) reads to
 *  report an empty (swept) slice over a bare scratch repo — the census is exercised with fakes
 *  in derive.test.mjs; here it runs for real and honestly finds nothing. */
function installRegistryStub(root) {
  writeFileSync(
    join(root, 'lib', 'roadmap', 'registry.ts'),
    'export async function discoverPhases() { return { phases: [], errors: [] } }\n'
      + 'export async function discoverArcs() { return { arcs: [] } }\n',
  )
}

/**
 * Build the base scratch consumer (notes §Scratch-repo shape): mkdtemp → git init + identity
 * + initial commit; roadmap.config.json (defaultConfig, shallow-merged with opts.config);
 * installed schema + tsx/zod; bin/fake-slot.sh; a src/spine/ file + a plain src file so a diff
 * can touch specialist vs plain paths. opts.seedCommit=false leaves the tree UNCOMMITTED (a
 * suite that needs the phase-start SHA to be a specific later commit seeds its own).
 */
export function makeFixtureRepo(opts = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'zr-fx-')))
  bases.push(root)
  mkdirSync(join(root, 'roadmap', 'phases'), { recursive: true })
  mkdirSync(join(root, 'roadmap', 'arcs'), { recursive: true })
  mkdirSync(join(root, 'bin'), { recursive: true })
  mkdirSync(join(root, 'src', 'spine'), { recursive: true })

  installConsumerSchema(root)
  installRegistryStub(root)
  provisionTsx(root)

  cpSync(FAKE_SLOT, join(root, 'bin', 'fake-slot.sh'))
  chmodSync(join(root, 'bin', 'fake-slot.sh'), 0o755)

  writeFileSync(join(root, 'src', 'spine', 'dummy.ts'), 'export const spine = 1\n')
  writeFileSync(join(root, 'src', 'plain.ts'), 'export const plain = 1\n')

  const config = { ...defaultConfig(root), ...(opts.config ?? {}) }
  if (opts.config?.gateCommands) config.gateCommands = { ...defaultConfig(root).gateCommands, ...opts.config.gateCommands }
  writeFileSync(join(root, 'roadmap', 'roadmap.config.json'), JSON.stringify(config, null, 2) + '\n')

  git(root, 'init', '-q', '-b', config.mergePolicy?.baseRef ?? 'develop')
  if (opts.seedCommit !== false) commitAll(root, 'seed: fixture consumer scaffold')
  return root
}

/** Write a phase file. kind 'plain' (default) or 'define' (import-time Zod via definePhase). */
export function writePhaseFile(root, phaseObj, { kind = 'plain' } = {}) {
  const n = phaseObj.phase
  const p = join(root, 'roadmap', 'phases', `phase-${n}.phase.ts`)
  writeFileSync(p, kind === 'define' ? definePhaseSrc(phaseObj) : plainSrc(phaseObj))
  return p
}
/** Write a raw source string as a phase file (for the deliberately-broken/malformed cases). */
export function writePhaseRaw(root, n, src) {
  const p = join(root, 'roadmap', 'phases', `phase-${n}.phase.ts`)
  writeFileSync(p, src)
  return p
}
export function writeArcFile(root, arcObj) {
  const p = join(root, 'roadmap', 'arcs', `${arcObj.id}.arc.ts`)
  writeFileSync(p, plainSrc(arcObj))
  return p
}

/** Run the REAL bin/roadmap.mjs in `root`. Returns { code, stdout, stderr, json } (json =
 *  parsed stdout — attempted whenever stdout looks like JSON, so a suite reads machine fields,
 *  never prose). FIXTURE_SLOT_LOG + ROADMAP_CONFIG default into the env; caller env wins. */
export function runCli(root, args, env = {}, { input } = {}) {
  const fullEnv = {
    ...process.env,
    ROADMAP_CONFIG: join(root, 'roadmap', 'roadmap.config.json'),
    FIXTURE_SLOT_LOG: join(root, '.fixture-slots.jsonl'),
    ...env,
  }
  // spawnSync, not execFileSync: exit-0 stderr must be observable too (execFileSync only
  // exposes stderr on the thrown error object, silently dropping advisory lines on success —
  // the phase-11 --ignore-capacity override note was the first assertion to need them).
  const r = spawnSync('node', [BIN, ...args], {
    cwd: root, encoding: 'utf8', timeout: 120_000,
    stdio: [input != null ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    ...(input != null ? { input } : {}), env: fullEnv,
  })
  const code = r.status ?? 1
  const stdout = (r.stdout ?? '').toString()
  const stderr = (r.stderr ?? '').toString()
  let json
  const t = stdout.trim()
  if (t.startsWith('{') || t.startsWith('[')) {
    try { json = JSON.parse(t) } catch { /* not JSON — leave undefined */ }
  }
  return { code, stdout, stderr, json }
}

/** The fake-slot JSONL records for `root`, oldest→newest ({ slot, argv, ts }). */
export function readSlotLog(root) {
  const p = join(root, '.fixture-slots.jsonl')
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

// ── the isolated-branch two-checkout topology (arc-land B-cases) ────────────────────────
/**
 * makeIsolatedArc — a primary checkout on baseRef (mergePolicy.primaryCheckout) PLUS a linked
 * worktree/branch carrying the arc's member commits and the .building sidecar (the
 * isolated-branch integration model landing.mjs distinguishes). Returns { root, worktree,
 * arcBranch }. The member phase(s) are already `done` with executionResult on the arc branch.
 */
export function makeIsolatedArc(root, { arcId = 'FX', member = 9301, arcBranch = 'arc/fx', extraConfig = {} } = {}) {
  // The arc file + member live on the arc branch; the primary stays on baseRef.
  writeArcFile(root, { id: arcId, baseRef: 'develop', planes: [{ name: 'P', phases: [member] }], acceptanceCriteria: [{ id: 'c1', job: 'the fixture arc job', surfaces: ['plugin'], signal: 'observable', tier: 'wired', bar: 'good enough to judge' }] })
  writePhaseFile(root, { phase: member, status: 'done', arcId, kind: 'logic', tasks: [{ id: `${member}.1`, done: true }], executionResult: { phase: member, status: 'done', gateRounds: 1, hardStops: [] } })
  if (Object.keys(extraConfig).length) {
    const cfgPath = join(root, 'roadmap', 'roadmap.config.json')
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
    cfg.mergePolicy = { ...cfg.mergePolicy, ...extraConfig }
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n')
  }
  commitAll(root, `feat: phase ${member} — arc ${arcId} member work`)
  // Branch the arc off the current baseRef tip, add the sidecar on the primary registry.
  git(root, 'branch', arcBranch)
  const wt = realpathSync(mkdtempSync(join(tmpdir(), 'zr-fx-wt-')))
  bases.push(wt)
  git(root, 'worktree', 'add', '-q', wt, arcBranch)
  const buildingDir = join(root, 'roadmap', 'arcs', '.building')
  mkdirSync(buildingDir, { recursive: true })
  writeFileSync(join(buildingDir, `${arcId}.json`), JSON.stringify({ arcId, worktree: wt, branch: arcBranch }))
  return { root, worktree: wt, arcBranch, arcId, member }
}

/**
 * gitShim — a PATH-prepended `git` that appends every argv as JSONL to $FIXTURE_GIT_LOG then
 * DELEGATES to the real git (pre-made decision 6). Returns { binDir, logPath, env } — spread
 * `env` into runCli so `arc land` runs under the shim and a suite can scan the whole argv
 * stream for a forbidden `<branch>:<baseRef>` refspec (the ONEPROMPT incident, made a
 * structural assertion).
 */
export function gitShim(root) {
  const binDir = join(root, '.gitshim')
  mkdirSync(binDir, { recursive: true })
  const logPath = join(root, '.git-argv.jsonl')
  const realGit = execFileSync('bash', ['-lc', 'command -v git'], { encoding: 'utf8' }).trim()
  const shim = `#!/usr/bin/env bash
node -e 'const fs=require("fs");fs.appendFileSync(process.env.FIXTURE_GIT_LOG,JSON.stringify(process.argv.slice(1))+"\\n")' -- "$@"
exec "${realGit}" "$@"
`
  writeFileSync(join(binDir, 'git'), shim)
  chmodSync(join(binDir, 'git'), 0o755)
  return { binDir, logPath, env: { PATH: `${binDir}:${process.env.PATH}`, FIXTURE_GIT_LOG: logPath } }
}

/** The recorded git argv arrays (oldest→newest). */
export function readGitLog(logPath) {
  if (!existsSync(logPath)) return []
  return readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
}
