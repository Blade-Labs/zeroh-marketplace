/**
 * fixture-consumer harness — the scratch-consumer-repo substrate the arc ROADCODE 1660
 * wired tier drives the REAL bin/roadmap.mjs against (ROADCODE-DESIGN §6, locked decision 4).
 *
 * A fixture consumer is a REAL consumer by construction (§7): a throwaway git repo carrying
 * nothing but roadmap.config.json, the INSTALLED lib/roadmap/schema.ts (templates/schema.ts
 * COPIED VERBATIM — pre-made decision 1; a hand-fork would recreate the seam-3 split-brain
 * this suite exists to catch), controllable fake-slot commands, and a mini estate. Every
 * CLI suites compose from these primitives to exercise the exit-coded consumer surface.
 * The native fixture helper also drives the shipped adapter contract with real receipt storage.
 *
 *   makeFixtureRepo(opts)   → root  (base scaffold + git init + initial commit)
 *   roadmapDir(root)        → the absolute root THAT repo's layout puts the records under
 *   runCli(root, args, env) → { code, stdout, stderr, json }
 *   writePhaseFile / writeArcFile / commitAll / commitPaths / gitLog
 *   readSlotLog(root)       → the fake-slot JSONL records ({ slot, argv, ts })
 *   makeIsolatedArc(root,…) → the isolated-branch two-checkout topology (arc-land)
 *   gitShim(root)           → a PATH `git` shim recording every argv (push-discipline proof)
 *   installConsumerSchema / provisionTsx  (called by makeFixtureRepo; exported for assertions)
 *
 * LAYOUT. The roadmap root is DISCOVERED, not pinned, so a fixture consumer is
 * built under `opts.layout`:
 *   'toplevel' (default, unchanged) — `<repo>/roadmap/…` + the LEGACY seam `<repo>/lib/roadmap/schema.ts`
 *   'docs'                          — `<repo>/docs/roadmap/…` + the ROOT-FIRST seam `<root>/lib/schema.ts`,
 *                                     and NO `<repo>/lib/` and no tsconfig at all
 *   'both'                          — both candidates MARKED, the ambiguity refusal's fixture
 * Every path helper (`roadmapDir`, `writePhaseFile`, `writeArcFile`, `writePhaseRaw`, the
 * `definePhaseSrc` import specifier) reads the layout back from the repo it is handed, so a
 * suite never carries it around. `runCli` defaults ROADMAP_CONFIG ONLY for 'toplevel': that
 * env var WINS over discovery in loadConfig, so defaulting it in a docs fixture would test
 * the harness instead of the resolver. A caller-supplied env still wins in every layout.
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

// ── layout (the root is DISCOVERED) ────────────────────────────────────────
/** Every layout this harness can build, and the candidate directories each one MARKS. */
export const LAYOUT_ROOTS = {
  toplevel: ['roadmap'],
  docs: ['docs/roadmap'],
  both: ['roadmap', 'docs/roadmap'],
}
/** repo → layout. Set by makeFixtureRepo so the path helpers need no extra argument. */
const layouts = new Map()

/** The layout `root` was built with ('toplevel' for a repo this module did not build). */
export const layoutOf = (root) => layouts.get(root) ?? 'toplevel'

/**
 * The absolute directory THIS repo's layout puts the roadmap records under.
 * 'both' deliberately THROWS rather than pick one — the whole point of that fixture is that
 * two marked roots have no single answer, and a harness that guessed would hide the refusal
 * the suite is asserting.
 * @param {string} root
 * @returns {string}
 */
export function roadmapDir(root) {
  const layout = layoutOf(root)
  if (layout === 'both') {
    throw new Error(`roadmapDir(${root}): layout 'both' marks ${LAYOUT_ROOTS.both.join(' and ')} — there is no single root, name one explicitly`)
  }
  return join(root, ...LAYOUT_ROOTS[layout][0].split('/'))
}

/** Where THIS layout vendors the consumer schema: root-first under 'docs', legacy otherwise. */
const seamPath = (root, layout = layoutOf(root)) =>
  layout === 'docs'
    ? join(root, 'docs', 'roadmap', 'lib', 'schema.ts')
    : join(root, 'lib', 'roadmap', 'schema.ts')

/** The specifier a phase/arc file under `<layoutRoot>/phases` uses to reach that seam. */
const seamSpecifier = (layout) => (layout === 'docs' ? '../lib/schema.ts' : '../../lib/roadmap/schema.ts')

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
 *  `roadmap phase validate` catches a shape error). Imports the INSTALLED consumer schema
 *  RELATIVELY, which is the whole point: no tsconfig `paths` alias is required of a consumer.
 *  The specifier follows the LAYOUT — `../../lib/roadmap/schema.ts` from `<repo>/roadmap/phases`,
 *  `../lib/schema.ts` from `<repo>/docs/roadmap/phases`. */
export function definePhaseSrc(obj, { layout = 'toplevel' } = {}) {
  const body = JSON.stringify(obj, null, 2).replace(/"([\w$]+)":/g, '$1:').replace(/"/g, "'")
  return `import { definePhase } from '${seamSpecifier(layout)}'\nexport default definePhase(${body})\n`
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

/** Copy templates/schema.ts VERBATIM to this layout's seam (pre-made decision 1 — the cmp
 *  against templates/schema.ts is a standing assertion; never a hand-written stub). Legacy
 *  `<root>/lib/roadmap/schema.ts` by default, root-first `<root>/lib/schema.ts` under 'docs'. */
export function installConsumerSchema(root, layout = 'toplevel') {
  const dest = seamPath(root, layout)
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
 *  in derive.test.mjs; here it runs for real and honestly finds nothing. It sits BESIDE the
 *  seam, because cli/audit-checks.mts resolves it as dirname(consumerSchemaPath(repo))/registry.ts.
 *  It must export everything that module destructures — discoverPhases, discoverArcs AND
 *  crossValidate — or `roadmap audit` dies at exit 1 with "crossValidate is not a function"
 *  instead of running its checks. */
function installRegistryStub(root, layout = 'toplevel') {
  writeFileSync(
    join(dirname(seamPath(root, layout)), 'registry.ts'),
    'export const DUPLICATE_PHASE_NUMBER_PREFIX = \'Duplicate phase number\'\n'
      + 'export async function discoverPhases() { return { phases: [], errors: [] } }\n'
      + 'export async function discoverArcs() { return { arcs: [] } }\n'
      + 'export function crossValidate() { return [] }\n',
  )
}

/**
 * Build the base scratch consumer (notes §Scratch-repo shape): mkdtemp → git init + identity
 * + initial commit; roadmap.config.json (defaultConfig, shallow-merged with opts.config);
 * installed schema + tsx/zod; bin/fake-slot.sh; a src/spine/ file + a plain src file so a diff
 * can touch specialist vs plain paths. opts.seedCommit=false leaves the tree UNCOMMITTED (a
 * suite that needs the phase-start SHA to be a specific later commit seeds its own).
 *
 * opts.layout selects WHERE the records and the schema seam live — 'toplevel'
 * (default, byte-identical to what every existing suite gets), 'docs', or 'both'. Under
 * 'docs' the repo carries NO `<root>/lib/` and no tsconfig, so a phase file's relative
 * `../lib/schema` import is the ONLY way the seam can resolve. Under 'both' the toplevel
 * scaffold is built in full and `docs/roadmap/` is MARKED beside it (its own config + phases/),
 * which is the ambiguity the resolver must refuse rather than silently pick between.
 */
export function makeFixtureRepo(opts = {}) {
  const layout = opts.layout ?? 'toplevel'
  if (!(layout in LAYOUT_ROOTS)) throw new Error(`makeFixtureRepo: unknown layout '${layout}' (want ${Object.keys(LAYOUT_ROOTS).join(' | ')})`)
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'zr-fx-')))
  bases.push(root)
  layouts.set(root, layout)
  // The PRIMARY root is the one the records go in; 'both' additionally MARKS the other (the
  // config + phases/ loop below marks every one of them, primary included).
  const primary = join(root, ...LAYOUT_ROOTS[layout][0].split('/'))
  mkdirSync(join(primary, 'arcs'), { recursive: true })
  mkdirSync(join(root, 'bin'), { recursive: true })
  mkdirSync(join(root, 'src', 'spine'), { recursive: true })

  // 'both' vendors the seam the same way 'toplevel' does — the ambiguity is refused before
  // any door reaches a seam, so a second copy would be scaffolding nothing reads.
  const seamLayout = layout === 'docs' ? 'docs' : 'toplevel'
  installConsumerSchema(root, seamLayout)
  installRegistryStub(root, seamLayout)
  provisionTsx(root)

  cpSync(FAKE_SLOT, join(root, 'bin', 'fake-slot.sh'))
  chmodSync(join(root, 'bin', 'fake-slot.sh'), 0o755)

  writeFileSync(join(root, 'src', 'spine', 'dummy.ts'), 'export const spine = 1\n')
  writeFileSync(join(root, 'src', 'plain.ts'), 'export const plain = 1\n')

  const config = { ...defaultConfig(root), ...(opts.config ?? {}) }
  if (opts.config?.gateCommands) config.gateCommands = { ...defaultConfig(root).gateCommands, ...opts.config.gateCommands }
  const configJson = JSON.stringify(config, null, 2) + '\n'
  for (const rel of LAYOUT_ROOTS[layout]) {
    const dir = join(root, ...rel.split('/'))
    mkdirSync(join(dir, 'phases'), { recursive: true })
    writeFileSync(join(dir, 'roadmap.config.json'), configJson)
  }

  git(root, 'init', '-q', '-b', config.mergePolicy?.baseRef ?? 'develop')
  if (opts.seedCommit !== false) commitAll(root, 'seed: fixture consumer scaffold')
  return root
}

/** Write a phase file UNDER THIS REPO'S LAYOUT root. kind 'plain' (default) or 'define'
 *  (import-time Zod via definePhase, through the specifier that layout's seam needs). */
export function writePhaseFile(root, phaseObj, { kind = 'plain' } = {}) {
  const n = phaseObj.phase
  const p = join(roadmapDir(root), 'phases', `phase-${n}.phase.ts`)
  writeFileSync(p, kind === 'define' ? definePhaseSrc(phaseObj, { layout: layoutOf(root) }) : plainSrc(phaseObj))
  return p
}
/** Write a raw source string as a phase file (for the deliberately-broken/malformed cases). */
export function writePhaseRaw(root, n, src) {
  const p = join(roadmapDir(root), 'phases', `phase-${n}.phase.ts`)
  writeFileSync(p, src)
  return p
}
export function writeArcFile(root, arcObj) {
  const p = join(roadmapDir(root), 'arcs', `${arcObj.id}.arc.ts`)
  writeFileSync(p, plainSrc(arcObj))
  return p
}

/** Run the REAL bin/roadmap.mjs in `root`. Returns { code, stdout, stderr, json } (json =
 *  parsed stdout — attempted whenever stdout looks like JSON, so a suite reads machine fields,
 *  never prose). FIXTURE_SLOT_LOG + ROADMAP_CONFIG default into the env; caller env wins. */
export function runCli(root, args, env = {}, { input, cwd } = {}) {
  // ROADMAP_CONFIG WINS over root discovery in loadConfig, so it is defaulted ONLY for the
  // 'toplevel' layout (where it has always been, keeping every sibling suite byte-identical).
  // Under 'docs'/'both' the resolver must be what answers, or the suite tests this harness.
  const fullEnv = {
    ...process.env,
    ...(layoutOf(root) === 'toplevel' ? { ROADMAP_CONFIG: join(root, 'roadmap', 'roadmap.config.json') } : {}),
    FIXTURE_SLOT_LOG: join(root, '.fixture-slots.jsonl'),
    ...env,
  }
  // spawnSync, not execFileSync: exit-0 stderr must be observable too (execFileSync only
  // exposes stderr on the thrown error object, silently dropping advisory lines on success —
  // the phase-11 --ignore-capacity override note was the first assertion to need them).
  const r = spawnSync('node', [BIN, ...args], {
    // `cwd` defaults to the repo root; a suite overrides it to prove a flagless command
    // resolves against the git TOPLEVEL rather than against wherever it was invoked.
    cwd: cwd ?? root, encoding: 'utf8', timeout: 120_000,
    stdio: [input != null ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    ...(input != null ? { input } : {}), env: fullEnv,
  })
  const code = r.status ?? 1
  const stdout = (r.stdout ?? '').toString()
  // A spawn failure / timeout has status null + error set — surface it so a hung CLI reds
  // with ETIMEDOUT in the assertion message instead of masquerading as a usage exit 1.
  const stderr = (r.stderr ?? '').toString() + (r.error ? `\n[runCli] spawn error: ${r.error}` : '')
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
    const cfgPath = join(roadmapDir(root), 'roadmap.config.json')
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
  const buildingDir = join(roadmapDir(root), 'arcs', '.building')
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

/** Deterministic native adapter fixture. Only the native process/probe boundary is fake;
 * requests, arms, immutable revisions, reducer events, and restart routing are real. */
export async function runNativeDriverFixture({ parentDriverId, policy, laneId, schedule = {}, unavailableHost = false }) {
  const [{ NativeAgentDriver }, drivers, { resolveRole }, store, arms, { createHash }] = await Promise.all([
    import('../../cli/lib/native-agent-driver.mjs'), import('../../cli/lib/drivers.mjs'),
    import('../../cli/lib/roles.mjs'), import('../../cli/lib/run-receipt.mjs'),
    import('../../cli/lib/executor-arm.mjs'), import('node:crypto'),
  ])
  const root = makeFixtureRepo()
  const phase = 3886
  const arcId = 'NATIVE-FIXTURE'
  const resolved = resolveRole('phase-executor', parentDriverId, { policy })
  const selected = { roleId: 'phase-executor', driverId: drivers.MODEL_DRIVERS[resolved.model], model: resolved.model }
  const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
  const roleCardBytes = Buffer.from('fixture semantic phase-executor card\n')
  const governanceBytes = Buffer.from('fixture consumer governance\n')
  const head = git(root, 'rev-parse', 'HEAD')
  const bounds = { filesystem: 'workspace-write', network: 'denied', gitPush: false, externalWrites: false }
  const parentAuthority = { profile: 'workspace-write', bounds, provenance: { kind: 'managed-host-input', source: 'fixture parent' } }
  const authority = {
    ...drivers.intersectAuthority(parentAuthority, { profile: 'inherit', bounds, provenance: null }),
    native: { driver: selected.driverId, runtime: { version: null, verified: false }, argv: [], enforcement: { filesystem: 'sandbox', network: 'sandbox-config', gitPush: 'semantic-only', externalWrites: 'semantic-only' }, limitations: ['fake native fixture; no OS enforcement claim'] },
  }
  const request = { ...selected, arcId, phase, runId: 'run-' + laneId, executorId: 'executor-' + laneId,
    worktree: root, baseHead: head, requestedHead: head, roleCardDigest: sha(roleCardBytes), governanceDigest: sha(governanceBytes), authority,
    authorityRef: { status: 'known', envelopeDigest: 'sha256:' + sha(JSON.stringify(authority.effective)), source: { kind: 'managed-host-receipt', ref: laneId } },
  }
  const launchOptions = { worktree: root, authority, ...(selected.driverId === 'codex' ? { json: true } : { model: selected.model, streamJson: true }) }
  authority.native.argv = drivers.launchArgv(selected.driverId, launchOptions)
  const candidate = { phase, status: 'done', gateRounds: 1, compromises: [], skipped: [] }
  const calls = []
  const completions = new Map()
  const processTransport = {
    async launch(input) {
      calls.push(structuredClone(input))
      const receipt = input.runReceipt
      const ref = { cwd: root, arcId, runId: request.runId, pendingReceiptDigest: receipt.digest }
      const bytes = Buffer.from(JSON.stringify(candidate))
      completions.set(receipt.digest, { version: 1, arcId, runId: request.runId, pendingReceiptDigest: receipt.digest,
        actionFingerprint: receipt.snapshot.pendingOperation.actionFingerprint, nativeSessionId: 'native-' + laneId,
        phaseResult: candidate, protocolTerminal: selected.driverId === 'codex' ? { type: 'turn.completed' } : { type: 'result', subtype: 'success', is_error: false },
        exitCode: 0, signal: null, stdoutBytes: bytes.length, stderrBytes: 0, stdoutDigest: sha(bytes), stderrDigest: sha(''),
      })
      return { status: 'running', operationRef: ref }
    },
    async observe(ref) {
      const completion = completions.get(ref.pendingReceiptDigest)
      return completion ? { status: 'complete', completion: structuredClone(completion) }
        : { status: 'hold', kind: 'unknown-native-outcome', reason: 'fixture has no completion for this operation revision' }
    },
  }
  const options = { cwd: root, parentDriverId, policy, sessionId: 'parent-' + laneId, parentAuthority, processTransport,
    readLaunchInputs: () => ({ roleCardBytes, governanceBytes, prompt: 'execute fixture ' + laneId }),
    provenanceStore: { read: () => unavailableHost ? { ok: false, reason: 'fixture host unavailable' }
      : { ok: true, doc: { probes: [{ name: 'version', pass: true }, { name: 'capabilities', pass: true }] } }, verify: () => 2 },
  }
  const driver = new NativeAgentDriver(options)
  const handle = await driver.start(request)
  if (handle.status === 'hold') return { outcome: 'hold', kind: handle.kind, reason: handle.reason, selected, externalLaunchCount: calls.length, ownerCount: Number(existsSync(arms.armPath(root, phase))), terminalResultCount: 0, receipts: [], refusals: [] }
  const refusals = []
  if (schedule.resume) await driver.resume(handle)
  if (schedule.action) refusals.push(await driver.performAction(handle, schedule.action))
  const prior = { arcId, stage: 'phase', status: 'active', processedEventIds: [], lastHalt: null, authorityRef: handle.request.authorityRef }
  let completed
  if (schedule.compact || schedule.newDriverInstance || schedule.parentRestart) {
    const bound = store.readRunReceipt(root, { arcId, runId: request.runId })
    const wake = () => new NativeAgentDriver(options).recover(bound, prior)
    const arrivals = await Promise.all(schedule.duplicateWake ? [wake(), wake()] : [wake()])
    const failed = arrivals.find((arrival) => !arrival.receipt || ['hold', 'conflict'].includes(arrival.status))
    if (failed) return { outcome: 'hold', kind: failed.kind, reason: failed.reason, selected, externalLaunchCount: calls.length, receipts: [], refusals }
    completed = arrivals[0]
  } else completed = await driver.awaitEvent(handle, prior)
  if (!completed.receipt) throw new Error('fixture did not persist a normalized native result')
  if (schedule.parentRestart || schedule.newDriverInstance || schedule.duplicateWake) {
    const restarted = new NativeAgentDriver(options)
    const input = { arcId, phase, plan: selected }
    const results = await Promise.all(schedule.duplicateWake ? [restarted.runPhase(input), restarted.runPhase(input)] : [restarted.runPhase(input)])
    if (results.some((result) => JSON.stringify(result.result) !== JSON.stringify(candidate))) throw new Error('fixture restart did not return the original durable candidate')
  }
  const receipts = []
  for (let revision = 0; ; revision++) {
    const receipt = store.readRunReceipt(root, { arcId, runId: request.runId }, { revision })
    if (!receipt) break
    receipts.push({ path: receipt.path, digest: receipt.digest, snapshot: receipt.snapshot, runId: receipt.snapshot.request.runId, executorId: receipt.snapshot.request.executorId })
  }
  const owner = arms.readExecutorRunArm(root, phase)
  const transition = completed.transition
  return { outcome: 'complete', selected, root, phase, runId: request.runId, executorId: request.executorId, nativeSessionId: completed.handle.nativeSessionId,
    ownerCount: Number(owner.status === 'valid'), owner: owner.arm, terminalResultCount: receipts.filter((receipt) => receipt.snapshot.terminalResult !== null).length,
    externalLaunchCount: calls.length, calls, receipts, refusals, transition,
    semanticTransition: { roleId: selected.roleId, event: transition.event.type, priorStatus: transition.prior.status, nextStatus: transition.next.status, nextStage: transition.next.stage, halt: transition.next.lastHalt?.kind, authority: handle.request.authority.effective },
  }
}
