import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { closeSync, constants, fstatSync, openSync, lstatSync, mkdirSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { ROOT_CANDIDATES, roadmapRoot, roadmapRootRel, consumerSchemaPath, resetRoadmapRootCache } from './roadmap-root.mjs'
import { gitToplevel, gitCommonDir } from './gitroot.mjs'
import { publishImmutableFile } from './sidecar.mjs'
import { ensureReceiptDirectory } from './run-receipt.mjs'
import { bridgeImportMany } from './tsx-bridge.mjs'

export class RootMigrationError extends Error {
  constructor(kind, message, options) { super(message, options); this.name = 'RootMigrationError'; this.kind = kind }
}
const fail = (kind, message) => { throw new RootMigrationError(kind, message) }
const json = (value) => Buffer.from(JSON.stringify(value) + '\n')
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const within = (path, dir) => path === dir || path.startsWith(dir + '/')
const externalPaths = ['tsconfig.json', 'scripts/collect-phase-metrics.ts']
const git = (root, args) => execFileSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] })
const present = (path) => { try { lstatSync(path); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error } }

function validateRelativePath(path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.split('/').some((p) => !p || p === '.' || p === '..' || p === '.git') || path.includes('\0') || path.includes('\\')) fail('unsafe-path', 'migration path must be repository-relative: ' + path)
}
function safePath(root, path) {
  validateRelativePath(path)
  let current = root
  for (const part of path.split('/')) {
    current = join(current, part)
    if (present(current) && lstatSync(current).isSymbolicLink()) fail('symlink', 'migration refuses symlink: ' + path)
  }
  return current
}
function treeFiles(root, path, out = []) {
  const absolute = safePath(root, path)
  if (!present(absolute)) return out
  const stat = lstatSync(absolute)
  if (stat.isDirectory()) for (const name of readdirSync(absolute).sort()) treeFiles(root, path + '/' + name, out)
  else if (stat.isFile()) out.push(path)
  else fail('unsafe-path', 'migration refuses special file: ' + path)
  return out
}
function runtimePath(path, root) {
  return path === root + '/.arc-mode' || within(path, root + '/.gate')
}
function movedPath(path, plan) {
  if (within(path, plan.sourceRoot)) return plan.destinationRoot + path.slice(plan.sourceRoot.length)
  if (within(path, plan.sourceSchemaDir)) return plan.destinationSchemaDir + path.slice(plan.sourceSchemaDir.length)
  return path
}
function blob(root, head, path) { return git(root, ['show', head + ':' + path]) }
function inventory(root, head, paths) {
  return git(root, ['ls-tree', '-rz', head, '--', ...paths]).toString().split('\0').filter(Boolean).map((line) => {
    const tab = line.indexOf('\t'); const [mode, type, hash] = line.slice(0, tab).split(' ')
    if (type !== 'blob' || !['100644', '100755'].includes(mode)) fail('unsafe-path', 'migration only moves regular tracked files: ' + line.slice(tab + 1))
    return { path: line.slice(tab + 1), mode, blob: hash }
  }).sort((a, b) => a.path.localeCompare(b.path))
}
function rewriteBytes(path, bytes, plan) {
  const typedRecord = path.endsWith('.ts') && (within(path, plan.sourceRoot + '/phases') || within(path, plan.sourceRoot + '/arcs') || path === plan.sourceRoot + '/backlog.ts')
  const active = externalPaths.includes(path) || [plan.sourceSchemaDir + '/registry.ts', plan.sourceSchemaDir + '/emit.ts'].includes(path) || new RegExp('^' + plan.sourceRoot + '/phases/phase-(?:40|41|42|43|44|45)\\.phase\\.ts$').test(path)
  const configFile = path === plan.sourceRoot + '/roadmap.config.json'
  if (!typedRecord && !active && !configFile) return bytes
  let text = bytes.toString('utf8')
  const destination = movedPath(path, plan)
  const schemaSpecifier = relative(dirname(destination), join(plan.destinationSchemaDir, 'schema')).split('\\').join('/')
  const specifier = schemaSpecifier.startsWith('.') ? schemaSpecifier : './' + schemaSpecifier
  if (typedRecord) {
    text = text.replace(/(^[ \t]*import\b[\s\S]*?\bfrom\s*)(['"])([^'"\n]+)\2/gm, (all, prefix, quote, source) => {
      return /(?:lib\/roadmap\/schema|lib\/schema)(?:\.ts)?$/.test(source) ? prefix + quote + specifier + quote : all
    })
  }
  if (active) {
    // Only executable quoted path literals; historical commentary stays intact.
    text = text.replace(/(['"])(roadmap\/[^'"\n]*)\1/g, (_all, quote, value) => quote + plan.destinationRoot + value.slice(plan.sourceRoot.length) + quote)
    text = text.replace(/(['"])(lib\/roadmap\/[^'"\n]*)\1/g, (_all, quote, value) => quote + plan.destinationSchemaDir + value.slice(plan.sourceSchemaDir.length) + quote)
  }
  if (configFile) {
    const config = JSON.parse(text)
    if (typeof config.$schema === 'string' && config.$schema.startsWith('.')) config.$schema = relative(plan.destinationRoot, join(plan.sourceRoot, config.$schema)).split('\\').join('/')
    if (config.gateCommands) for (const [slot, command] of Object.entries(config.gateCommands)) {
      if (typeof command === 'string') config.gateCommands[slot] = command.replace(/(?<![\w/.-])lib\/roadmap\//g, plan.destinationSchemaDir + '/').replace(/(?<![\w/.-])roadmap\//g, plan.destinationRoot + '/')
    }
    text = JSON.stringify(config, null, 2) + '\n'
  }
  return Buffer.from(text)
}
function runtimeFileDigest(path) {
  const hash = createHash('sha256'), buffer = Buffer.alloc(64 * 1024)
  const fd = openSync(path, 'r')
  try {
    let size
    while ((size = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, size))
    return hash.digest('hex')
  } finally { closeSync(fd) }
}
function runtimeIdentity(root, path) {
  const absolute = safePath(root, path), stat = lstatSync(absolute)
  const mode = stat.mode & 0o777
  if (stat.isFile()) return digest(json({ kind: 'file', mode, digest: runtimeFileDigest(absolute) }))
  if (stat.isDirectory()) return digest(json({ kind: 'directory', mode, entries: readdirSync(absolute).sort().map(name => ({ name, digest: runtimeIdentity(root, path + '/' + name) })) }))
  fail('unsafe-path', 'runtime state must contain only regular files and directories')
}
function runtimeDestination(root, destination) {
  if (!present(safePath(root, destination))) return null
  if (!lstatSync(safePath(root, destination)).isDirectory()) fail('destination-present', 'migration destination is not a directory')
  const names = readdirSync(safePath(root, destination)).sort()
  if (!names.length || names.some(name => !['.arc-mode', '.gate'].includes(name))) fail('destination-present', 'migration destination contains non-runtime entries: ' + names.join(', '))
  return { entries: names.map(path => {
    const stat = lstatSync(safePath(root, destination + '/' + path))
    if (path === '.arc-mode' ? !stat.isFile() : !stat.isDirectory()) fail('destination-present', 'runtime entry has the wrong type: ' + path)
    return { path, treeDigest: runtimeIdentity(root, destination + '/' + path) }
  }) }
}
function parkingPath(plan) { return '.building/root-migrations/' + plan.planDigest + '.runtime' }
function runtimePrefix(root, plan, moved, rewritten) {
  if (!plan.runtimeParking) return null
  const parkedPath = parkingPath(plan), parked = present(safePath(root, parkedPath))
  const entries = plan.runtimeParking.entries
  if (moved === 0 && entries.some(entry => present(safePath(root, plan.sourceRoot + '/' + entry.path)))) fail('recovery-conflict', 'source acquired conflicting runtime state')
  if (moved === 0 && !parked) {
    if (!json(runtimeDestination(root, plan.destinationRoot)).equals(json(plan.runtimeParking))) fail('recovery-conflict', 'unparked runtime identity differs')
    return { prepared: false, restored: 0 }
  }
  if (parked && readdirSync(safePath(root, parkedPath)).some(name => !entries.some(entry => entry.path === name))) fail('recovery-conflict', 'runtime parking contains foreign entries')
  let restored = 0, pendingSeen = false
  for (const entry of entries) {
    const saved = parkedPath + '/' + entry.path, target = plan.destinationRoot + '/' + entry.path
    const savedPresent = present(safePath(root, saved)), targetPresent = present(safePath(root, target))
    if (savedPresent === targetPresent) fail('recovery-conflict', 'runtime entry has no unique owner: ' + entry.path)
    if (savedPresent) pendingSeen = true
    else {
      if (pendingSeen || moved !== plan.renames.length || rewritten !== plan.rewrites.length) fail('recovery-conflict', 'runtime restore is not a valid operation prefix')
      restored++
    }
    if (runtimeIdentity(root, savedPresent ? saved : target) !== entry.treeDigest) fail('recovery-conflict', 'runtime entry identity differs: ' + entry.path)
  }
  return { prepared: true, restored }
}
function derivePlan(root, head, to) {
  const sourceRoot = ROOT_CANDIDATES[0]
  if (to !== ROOT_CANDIDATES[1]) fail('destination', 'supported migration destination is ' + ROOT_CANDIDATES[1])
  const plan = { version: 1, head, sourceRoot, destinationRoot: to, sourceSchemaDir: join('lib', sourceRoot), destinationSchemaDir: join(to, 'lib') }
  const rows = inventory(root, head, [sourceRoot, plan.sourceSchemaDir, ...externalPaths])
  for (const required of [sourceRoot + '/roadmap.config.json', plan.sourceSchemaDir + '/schema.ts']) if (!rows.some((row) => row.path === required)) fail('missing-source', 'missing tracked migration source: ' + required)
  plan.renames = [[sourceRoot, to], [plan.sourceSchemaDir, plan.destinationSchemaDir]].map(([from, destination]) => ({ from, to: destination, treeDigest: digest(json(rows.filter((row) => within(row.path, from)))) }))
  plan.trackedManifest = rows.filter((row) => within(row.path, sourceRoot) || within(row.path, plan.sourceSchemaDir))
  plan.rewrites = []
  for (const row of rows) {
    const before = blob(root, head, row.path)
    const after = rewriteBytes(row.path, before, plan)
    if (!before.equals(after)) {
      plan.rewrites.push({ pathBefore: row.path, pathAfter: movedPath(row.path, plan), beforeDigest: digest(before), afterDigest: digest(after), beforeBytes: before.toString('base64'), afterBytes: after.toString('base64') })
      if (!plan.trackedManifest.some((entry) => entry.path === row.path)) plan.trackedManifest.push(row)
    }
  }
  plan.trackedManifest.sort((a, b) => a.path.localeCompare(b.path))
  const runtimeParking = runtimeDestination(root, to)
  if (runtimeParking) { plan.version = 2; plan.runtimeParking = runtimeParking }
  plan.planDigest = digest(json(plan))
  return plan
}
function checkFiles(root, plan, after = false) {
  const allowed = new Set()
  for (const row of plan.trackedManifest) {
    const path = after ? movedPath(row.path, plan) : row.path
    const absolute = safePath(root, path); allowed.add(path)
    if (!present(absolute) || !lstatSync(absolute).isFile()) fail('tree-mismatch', 'missing migration file: ' + path)
    const rewrite = plan.rewrites.find((entry) => entry.pathBefore === row.path)
    const expected = after && rewrite ? Buffer.from(rewrite.afterBytes, 'base64') : blob(root, plan.head, row.path)
    if (!readFileSync(absolute).equals(expected)) fail('dirty-source', 'migration file bytes changed: ' + path)
    if (Boolean(lstatSync(absolute).mode & 0o111) !== (row.mode === '100755')) fail('dirty-source', 'migration file mode changed: ' + path)
  }
  const roots = after ? [plan.destinationRoot] : [plan.sourceRoot, plan.sourceSchemaDir]
  for (const dir of roots) for (const path of treeFiles(root, dir)) if (!allowed.has(path) && !runtimePath(path, after ? plan.destinationRoot : plan.sourceRoot)) fail('untracked-source', 'migration refuses untracked or ignored file: ' + path)
}
function freshPreflight(root, plan) {
  resetRoadmapRootCache()
  try {
    if (roadmapRootRel(root) !== plan.sourceRoot || relative(root, dirname(consumerSchemaPath(root))) !== plan.sourceSchemaDir) fail('source-layout', 'migration needs the complete legacy root and schema owner')
  } catch (error) { if (error instanceof RootMigrationError) throw error; throw new RootMigrationError('source-layout', error.message, { cause: error }) }
  if (git(root, ['rev-parse', 'HEAD']).toString().trim() !== plan.head) fail('head-changed', 'migration plan HEAD changed; plan again before applying')
  if (plan.runtimeParking) {
    if (!json(runtimeDestination(root, plan.destinationRoot)).equals(json(plan.runtimeParking))) fail('runtime-conflict', 'destination runtime changed since planning')
    for (const entry of plan.runtimeParking.entries) if (present(safePath(root, plan.sourceRoot + '/' + entry.path))) fail('runtime-conflict', 'source and destination both own runtime entry: ' + entry.path)
    if (present(safePath(root, parkingPath(plan)))) fail('runtime-conflict', 'runtime parking already exists without this intent')
  } else if (present(safePath(root, plan.destinationRoot))) fail('destination-present', 'migration destination must be absent: ' + plan.destinationRoot)
  const paths = [plan.sourceRoot, plan.sourceSchemaDir, plan.destinationRoot, ...plan.rewrites.map((entry) => entry.pathBefore)]
  const status = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...paths]).toString().split('\0').filter(Boolean)
  for (const row of status) if (!(row.startsWith('?? ') && (runtimePath(row.slice(3), plan.sourceRoot) || (plan.runtimeParking && runtimePath(row.slice(3), plan.destinationRoot))))) fail('dirty-source', 'migration refuses staged, unstaged or untracked changes: ' + row)
  checkFiles(root, plan)
}

function recoveryBinding(root) {
  return { version: 2, worktree: root, gitCommonDir: realpathSync(gitCommonDir(root)) }
}
function receiptFor(root, plan) {
  return { ...recoveryBinding(root), planDigest: plan.planDigest, head: plan.head, sourceRoot: plan.sourceRoot, destinationRoot: plan.destinationRoot }
}
function validateStoredPlan(root, plan) {
  const keys = (value, expected) => {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).join('|') !== expected.join('|')) fail('invalid-plan', 'migration plan has noncanonical fields')
  }
  keys(plan, ['version', 'head', 'sourceRoot', 'destinationRoot', 'sourceSchemaDir', 'destinationSchemaDir', 'renames', 'trackedManifest', 'rewrites', ...(plan?.version === 2 ? ['runtimeParking'] : []), 'planDigest'])
  const { planDigest, ...body } = plan
  if (![1, 2].includes(plan.version) || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(plan.head) || digest(json(body)) !== planDigest) fail('invalid-plan', 'migration plan version, source or digest is invalid')
  if (plan.sourceRoot !== ROOT_CANDIDATES[0] || plan.destinationRoot !== ROOT_CANDIDATES[1] || plan.sourceSchemaDir !== 'lib/' + ROOT_CANDIDATES[0] || plan.destinationSchemaDir !== plan.destinationRoot + '/lib') fail('invalid-plan', 'migration plan names an unsupported layout')
  if (!Array.isArray(plan.trackedManifest) || !Array.isArray(plan.rewrites) || !Array.isArray(plan.renames) || plan.renames.length !== 2) fail('invalid-plan', 'migration plan lists are invalid')
  if (plan.version === 2) {
    keys(plan.runtimeParking, ['entries'])
    const entries = plan.runtimeParking.entries
    if (!Array.isArray(entries) || !entries.length || entries.length > 2) fail('invalid-plan', 'runtime parking requires owned entries')
    let previous = ''
    for (const entry of entries) {
      keys(entry, ['path', 'treeDigest'])
      if (!['.arc-mode', '.gate'].includes(entry.path) || entry.path <= previous || !/^[a-f0-9]{64}$/.test(entry.treeDigest)) fail('invalid-plan', 'runtime parking entry is invalid')
      previous = entry.path
    }
  }
  const external = new Set([...externalPaths, 'scripts/check-roadmap-imports.mjs', 'scripts/nativegreen-review-regressions.test.mjs'])
  const seen = new Set()
  for (const row of plan.trackedManifest) {
    keys(row, ['path', 'mode', 'blob']); validateRelativePath(row.path)
    if (seen.has(row.path) || (!within(row.path, plan.sourceRoot) && !within(row.path, plan.sourceSchemaDir) && !external.has(row.path))) fail('invalid-plan', 'duplicate or unsupported migration source')
    seen.add(row.path)
  }
  const original = inventory(root, plan.head, [plan.sourceRoot, plan.sourceSchemaDir, ...plan.trackedManifest.filter(row => external.has(row.path)).map(row => row.path)])
  if (!json(original).equals(json(plan.trackedManifest))) fail('invalid-plan', 'migration manifest differs from its original Git tree')
  for (const path of [plan.sourceRoot + '/roadmap.config.json', plan.sourceSchemaDir + '/schema.ts']) if (!seen.has(path)) fail('invalid-plan', 'migration is missing a required source')
  const renames = [[plan.sourceRoot, plan.destinationRoot], [plan.sourceSchemaDir, plan.destinationSchemaDir]].map(([from, to]) => ({ from, to, treeDigest: digest(json(original.filter(row => within(row.path, from)))) }))
  if (!json(plan.renames).equals(json(renames))) fail('invalid-plan', 'migration rename mappings differ')
  const rewritten = new Set()
  for (const entry of plan.rewrites) {
    keys(entry, ['pathBefore', 'pathAfter', 'beforeDigest', 'afterDigest', 'beforeBytes', 'afterBytes'])
    validateRelativePath(entry.pathBefore); validateRelativePath(entry.pathAfter)
    if (!seen.has(entry.pathBefore) || rewritten.has(entry.pathBefore) || entry.pathAfter !== movedPath(entry.pathBefore, plan)) fail('invalid-plan', 'invalid migration rewrite mapping')
    rewritten.add(entry.pathBefore)
    for (const side of ['before', 'after']) {
      const encoded = entry[side + 'Bytes']
      if (typeof encoded !== 'string') fail('invalid-plan', 'rewrite bytes must be base64')
      const bytes = Buffer.from(encoded, 'base64')
      if (bytes.toString('base64') !== encoded || digest(bytes) !== entry[side + 'Digest']) fail('invalid-plan', 'rewrite bytes or digest differs')
    }
    if (!blob(root, plan.head, entry.pathBefore).equals(Buffer.from(entry.beforeBytes, 'base64')) || entry.beforeBytes === entry.afterBytes) fail('invalid-plan', 'rewrite source differs from original Git bytes')
  }
  for (const row of original) if (external.has(row.path) && !rewritten.has(row.path)) fail('invalid-plan', 'external migration source has no rewrite')
}
function storedMigrations(root) {
  const directory = safePath(root, '.building/root-migrations')
  if (!present(directory)) return []
  const names = readdirSync(directory)
  for (const name of names.filter(name => name.endsWith('.receipt.json'))) if (!names.includes(name.replace(/\.receipt\.json$/, '.intent.json'))) fail('receipt-conflict', 'migration completion has no bound intent')
  return names.filter(name => name.endsWith('.intent.json')).map(name => {
    const intentPath = safePath(root, '.building/root-migrations/' + name)
    const raw = readFileSync(intentPath)
    let intent
    try { intent = JSON.parse(raw.toString('utf8')) } catch (error) { throw new RootMigrationError('intent-unreadable', error.message, { cause: error }) }
    if (intent?.version !== 2) fail('intent-unbound', 'legacy migration intent does not bind an actual checkout')
    if (!raw.equals(json({ ...recoveryBinding(root), plan: intent.plan }))) fail('intent-unbound', 'migration intent belongs to another checkout or has noncanonical fields')
    validateStoredPlan(root, intent.plan)
    if (name !== intent.plan.planDigest + '.intent.json') fail('intent-conflict', 'migration intent filename differs from its digest')
    const receiptPath = safePath(root, '.building/root-migrations/' + intent.plan.planDigest + '.receipt.json')
    const complete = present(receiptPath)
    if (complete && !readFileSync(receiptPath).equals(json(receiptFor(root, intent.plan)))) fail('receipt-conflict', 'migration receipt is unbound or mismatched')
    return { plan: intent.plan, intentPath, receiptPath, complete }
  })
}
function validateCompletedLayout(root, plan) {
  resetRoadmapRootCache()
  if (roadmapRoot(root) !== join(root, plan.destinationRoot) || consumerSchemaPath(root) !== join(root, plan.destinationSchemaDir, 'schema.ts') || present(safePath(root, plan.sourceSchemaDir + '/schema.ts'))) fail('post-validation', 'completed migration no longer has one destination root and schema owner')
  if (!lstatSync(safePath(root, plan.destinationSchemaDir + '/schema.ts')).isFile()) fail('post-validation', 'destination schema is not a regular file')
}
function isAncestor(root, ancestor, descendant) {
  try { git(root, ['merge-base', '--is-ancestor', ancestor, descendant]); return true }
  catch (error) { if (error.status === 1) return false; throw error }
}
// Curation preserves old history under rescue refs and its boundary tree in the new chain.
// Follow those existing bridges so repeated normalization does not invalidate completion.
function migrationAncestry(root) {
  const rescued = git(root, ['for-each-ref', '--format=%(objectname) %(objecttype)', 'refs/curate-rescue/']).toString().trim()
  const tips = rescued ? rescued.split('\n').map(row => {
    const [tip, type] = row.split(' ')
    if (type !== 'commit' || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(tip)) fail('history-conflict', 'curation rescue does not name a commit')
    return { tip, tree: git(root, ['show', '-s', '--format=%T', tip]).toString().trim() }
  }) : []
  const trees = new Map(), closures = new Map(), ancestry = new Map()
  const ordinary = (ancestor, descendant) => {
    const key = ancestor + ':' + descendant
    if (!ancestry.has(key)) ancestry.set(key, isAncestor(root, ancestor, descendant))
    return ancestry.get(key)
  }
  const histories = head => {
    if (closures.has(head)) return closures.get(head)
    const reached = new Set([head]), pending = [head]
    while (pending.length) {
      const tip = pending.pop()
      if (!trees.has(tip)) trees.set(tip, new Set(git(root, ['log', '--format=%T', tip]).toString().trim().split('\n')))
      for (const rescue of tips) if (!reached.has(rescue.tip) && trees.get(tip).has(rescue.tree)) {
        reached.add(rescue.tip); pending.push(rescue.tip)
      }
    }
    closures.set(head, reached)
    return reached
  }
  return (ancestor, descendant) => ordinary(ancestor, descendant) || [...histories(descendant)].some(tip => ordinary(ancestor, tip))
}
function recoveryPlan(root, to) {
  const records = storedMigrations(root)
  const incomplete = records.filter(record => !record.complete)
  if (incomplete.length > 1) fail('recovery-conflict', 'multiple unfinished migrations need explicit reconciliation')
  if (incomplete.length) {
    const record = incomplete[0]
    if (record.plan.destinationRoot !== to) fail('intent-conflict', 'unfinished migration destination differs')
    return { status: 'interrupted', plan: record.plan, intentPath: record.intentPath }
  }
  if (!records.length) return null
  resetRoadmapRootCache()
  if (roadmapRootRel(root) === ROOT_CANDIDATES[0]) return null
  const head = git(root, ['rev-parse', 'HEAD']).toString().trim()
  const precedes = migrationAncestry(root)
  const candidates = records.filter(record => record.plan.destinationRoot === to && precedes(record.plan.head, head))
  const latest = candidates.filter(candidate => !candidates.some(other => other !== candidate && candidate.plan.head !== other.plan.head && precedes(candidate.plan.head, other.plan.head)))
  if (latest.length !== 1) fail('history-conflict', 'completed migrations have no unique ancestral owner')
  const record = latest[0]
  validateCompletedLayout(root, record.plan)
  return { status: 'already-applied', plan: record.plan, receiptPath: record.receiptPath }
}
function withMigrationLock(root, fn) {
  const directory = ensureReceiptDirectory(safePath(root, '.building/root-migrations'))
  const path = safePath(root, '.building/root-migrations/apply.lock')
  let fd
  try {
    try {
      fd = openSync(path, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600)
      if (!fstatSync(fd).isFile()) fail('lock-unavailable', 'migration lock must be a regular file')
      // FD3 duplicates the parent's open-file description: the kernel lock remains
      // held after this short helper exits, until our fd closes or this process dies.
      execFileSync('flock', ['--exclusive', '--nonblock', '3'], { stdio: ['ignore', 'pipe', 'pipe', fd] })
    } catch (error) {
      if (error.status === 1) fail('migration-busy', 'another process holds this checkout migration lock')
      throw new RootMigrationError('lock-unavailable', 'cannot acquire kernel migration lock: ' + error.message, { cause: error })
    }
    return fn(directory)
  } finally { if (fd !== undefined) closeSync(fd) }
}
function operationPrefix(root, plan) {
  let moved = 0
  let beforeSeen = false
  const unparked = Boolean(plan.runtimeParking && !present(safePath(root, parkingPath(plan))) && present(safePath(root, plan.sourceRoot)))
  for (const entry of plan.renames) {
    const source = present(safePath(root, entry.from)); const destination = !(unparked && entry.to === plan.destinationRoot) && present(safePath(root, entry.to))
    if (source === destination || (!source && beforeSeen)) fail('recovery-conflict', 'migration directories are not one valid operation prefix')
    if (source) beforeSeen = true
    else moved++
  }
  const allowed = new Set()
  const appliedRewrites = new Set()
  for (const row of plan.trackedManifest) {
    const owner = plan.renames.findIndex((entry) => within(row.path, entry.from))
    const path = owner >= 0 && owner < moved ? movedPath(row.path, plan) : row.path
    const absolute = safePath(root, path); allowed.add(path)
    if (!present(absolute) || !lstatSync(absolute).isFile()) fail('recovery-conflict', 'missing recovery input: ' + path)
    const actual = readFileSync(absolute)
    const rewrite = plan.rewrites.find((entry) => entry.pathBefore === row.path)
    if (rewrite && actual.equals(Buffer.from(rewrite.afterBytes, 'base64'))) {
      if (moved !== plan.renames.length) fail('recovery-conflict', 'rewrite appeared before directory renames completed')
      appliedRewrites.add(rewrite.pathBefore)
    } else if (!actual.equals(blob(root, plan.head, row.path))) fail('recovery-conflict', 'recovery bytes differ from both planned states: ' + path)
    if (Boolean(lstatSync(absolute).mode & 0o111) !== (row.mode === '100755')) fail('recovery-conflict', 'recovery mode changed: ' + path)
  }
  let rewritten = 0; beforeSeen = false
  for (const entry of plan.rewrites) {
    if (appliedRewrites.has(entry.pathBefore)) {
      if (beforeSeen) fail('recovery-conflict', 'rewrites are not one valid operation prefix')
      rewritten++
    } else beforeSeen = true
  }
  const actualRoots = moved === 0 ? [plan.sourceRoot, plan.sourceSchemaDir] : moved === 1 ? [plan.destinationRoot, plan.sourceSchemaDir] : [plan.destinationRoot]
  for (const dir of actualRoots) for (const path of treeFiles(root, dir)) if (!allowed.has(path) && !runtimePath(path, moved ? plan.destinationRoot : plan.sourceRoot)) fail('recovery-conflict', 'unplanned recovery file: ' + path)
  return { moved, rewritten, runtime: runtimePrefix(root, plan, moved, rewritten) }
}

export function planRootMigration(cwd, { to = ROOT_CANDIDATES[1] } = {}, _deps = {}) {
  try {
    const root = realpathSync(gitToplevel(cwd))
    const prior = recoveryPlan(root, to)
    if (prior) return prior
    const plan = derivePlan(root, git(root, ['rev-parse', 'HEAD']).toString().trim(), to)
    freshPreflight(root, plan)
    return { status: 'planned', plan }
  } catch (error) { if (error instanceof RootMigrationError) throw error; throw new RootMigrationError('preflight', error.message, { cause: error }) }
}
function replaceFile(path, bytes) {
  const temporary = path + '.root-migrate-' + randomUUID()
  const mode = lstatSync(path).mode & 0o777
  try { writeFileSync(temporary, bytes, { flag: 'wx', mode }); renameSync(temporary, path) }
  finally { if (present(temporary)) rmSync(temporary) }
}
function validateDestination(root, plan) {
  resetRoadmapRootCache()
  if (roadmapRoot(root) !== join(root, plan.destinationRoot) || roadmapRootRel(root) !== plan.destinationRoot || consumerSchemaPath(root) !== join(root, plan.destinationSchemaDir, 'schema.ts')) fail('post-validation', 'migrated root/schema discovery disagrees')
  checkFiles(root, plan, true)
  JSON.parse(readFileSync(join(root, plan.destinationRoot, 'roadmap.config.json'), 'utf8'))
  const paths = plan.trackedManifest.filter(({ path }) => path === plan.sourceRoot + '/backlog.ts' || /\.(?:arc|phase)\.ts$/.test(path)).map(({ path }) => join(root, movedPath(path, plan)))
  if (!paths.length) fail('post-validation', 'migration has no typed records to validate')
  const imported = bridgeImportMany(paths, { consumerRoot: root, cache: false })
  if (!imported.ok) fail('post-validation', 'migrated typed import failed: ' + (imported.stderr ?? imported.kind))
  for (const [path, result] of Object.entries(imported.byPath)) if (!result.ok) fail('post-validation', 'migrated typed record failed: ' + path + ': ' + (result.stderr ?? result.kind))
}

export function applyRootMigration(plan, deps = {}) {
  const root = realpathSync(gitToplevel(deps.cwd ?? process.cwd()))
  validateStoredPlan(root, plan)
  return withMigrationLock(root, () => applyUnderLock(root, plan, deps))
}
function applyUnderLock(root, plan, deps) {
  const directory = safePath(root, '.building/root-migrations')
  const intentPath = join(directory, plan.planDigest + '.intent.json')
  const receiptPath = join(directory, plan.planDigest + '.receipt.json')
  safePath(root, relative(root, intentPath)); safePath(root, relative(root, receiptPath))
  const receipt = receiptFor(root, plan)
  if (storedMigrations(root).some(record => !record.complete && record.plan.planDigest !== plan.planDigest)) fail('intent-conflict', 'another unfinished migration already owns this checkout')
  if (present(receiptPath)) {
    if (!readFileSync(receiptPath).equals(json(receipt))) fail('receipt-conflict', 'migration receipt bytes disagree')
    validateCompletedLayout(root, plan)
    return { status: 'already-applied', receiptPath, planDigest: plan.planDigest }
  }
  let prefix = { moved: 0, rewritten: 0 }
  if (present(intentPath)) {
    if (!readFileSync(intentPath).equals(json({ ...recoveryBinding(root), plan }))) fail('intent-unbound', 'migration intent is not bound to this checkout and plan')
    if (git(root, ['rev-parse', 'HEAD']).toString().trim() !== plan.head) fail('head-changed', 'incomplete migration HEAD changed; reconcile before mutation')
    try { prefix = operationPrefix(root, plan) } catch (error) { return { status: 'recovery-required', intentPath, reason: error.message } }
  } else {
    freshPreflight(root, plan)
    if (!publishImmutableFile(intentPath, json({ ...recoveryBinding(root), plan }))) return { status: 'recovery-required', intentPath, reason: 'another caller claimed this migration intent' }
    prefix = operationPrefix(root, plan)
  }
  const renamed = plan.renames.slice(0, prefix.moved)
  const rewritten = plan.rewrites.slice(0, prefix.rewritten)
  const createdParents = []
  let runtimePrepared = prefix.runtime?.prepared ?? false
  const restoredRuntime = plan.runtimeParking?.entries.slice(0, prefix.runtime?.restored ?? 0) ?? []
  try {
    if (plan.runtimeParking && !runtimePrepared) {
      renameSync(safePath(root, plan.destinationRoot), safePath(root, parkingPath(plan)))
      runtimePrepared = true
      deps.afterRuntimePark?.({ path: parkingPath(plan) })
    }
    for (const [index, entry] of plan.renames.entries()) {
      if (index < prefix.moved) continue
      const source = safePath(root, entry.from); const destination = safePath(root, entry.to)
      if (present(destination)) fail('destination-present', 'destination appeared before rename: ' + entry.to)
      const missing = []
      for (let parent = dirname(destination); parent !== root && !present(parent); parent = dirname(parent)) missing.push(parent)
      for (const parent of missing.reverse()) { mkdirSync(parent); createdParents.push(parent) }
      renameSync(source, destination); renamed.push(entry)
      deps.afterRename?.({ index, from: entry.from, to: entry.to })
    }
    for (const [index, entry] of plan.rewrites.entries()) {
      if (index < prefix.rewritten) continue
      const path = safePath(root, entry.pathAfter)
      if (digest(readFileSync(path)) !== entry.beforeDigest) fail('rewrite-conflict', 'rewrite input changed: ' + entry.pathAfter)
      replaceFile(path, Buffer.from(entry.afterBytes, 'base64')); rewritten.push(entry)
      deps.afterRewrite?.({ index, path: entry.pathAfter })
    }
    if (plan.runtimeParking) {
      for (const [index, entry] of plan.runtimeParking.entries.entries()) {
        if (index < restoredRuntime.length) continue
        const saved = parkingPath(plan) + '/' + entry.path, target = plan.destinationRoot + '/' + entry.path
        if (present(safePath(root, target)) || runtimeIdentity(root, saved) !== entry.treeDigest) fail('runtime-conflict', 'runtime restore input changed')
        renameSync(safePath(root, saved), safePath(root, target)); restoredRuntime.push(entry)
        deps.afterRuntimeRestore?.({ index, path: entry.path })
      }
      if (present(safePath(root, parkingPath(plan)))) rmdirSync(safePath(root, parkingPath(plan)))
      deps.afterRuntimeCleanup?.()
      runtimePrefix(root, plan, plan.renames.length, plan.rewrites.length)
    }
    validateDestination(root, plan); deps.validate?.(plan)
    if (!publishImmutableFile(receiptPath, json(receipt))) fail('receipt-conflict', 'another migration completion appeared')
    return { status: 'applied', receiptPath, planDigest: plan.planDigest }
  } catch (error) {
    if (present(receiptPath)) return { status: 'recovery-required', intentPath, receiptPath, reason: 'completion publication requires reconciliation: ' + error.message }
    try {
      if (runtimePrepared) {
        const parking = safePath(root, parkingPath(plan))
        if (!present(parking)) mkdirSync(parking)
        for (const entry of restoredRuntime.reverse()) {
          const target = plan.destinationRoot + '/' + entry.path, saved = parkingPath(plan) + '/' + entry.path
          if (present(safePath(root, saved)) || runtimeIdentity(root, target) !== entry.treeDigest) fail('rollback-conflict', 'runtime changed during rollback')
          renameSync(safePath(root, target), safePath(root, saved))
        }
      }
      for (const entry of rewritten.reverse()) {
        const path = safePath(root, entry.pathAfter)
        if (digest(readFileSync(path)) !== entry.afterDigest) fail('rollback-conflict', 'rewritten file changed during rollback: ' + entry.pathAfter)
        replaceFile(path, Buffer.from(entry.beforeBytes, 'base64'))
      }
      for (const entry of renamed.reverse()) {
        if (present(safePath(root, entry.from))) fail('rollback-conflict', 'source appeared during rollback: ' + entry.from)
        renameSync(safePath(root, entry.to), safePath(root, entry.from))
      }
      if (runtimePrepared) {
        if (present(safePath(root, plan.destinationRoot))) fail('rollback-conflict', 'runtime destination appeared during rollback')
        const parking = parkingPath(plan)
        if (!json(runtimeDestination(root, parking)).equals(json(plan.runtimeParking))) fail('rollback-conflict', 'parked runtime changed during rollback')
        renameSync(safePath(root, parking), safePath(root, plan.destinationRoot))
      }
      for (const parent of createdParents.reverse()) {
        try { rmdirSync(parent) } catch (cleanup) { if (!['ENOENT', 'ENOTEMPTY'].includes(cleanup.code)) throw cleanup }
      }
      resetRoadmapRootCache(); checkFiles(root, plan)
    } catch (rollback) {
      return { status: 'recovery-required', intentPath, reason: error.message, rollbackReason: rollback.message }
    }
    throw new RootMigrationError('apply-failed', 'migration failed and source was restored: ' + error.message, { cause: error })
  }
}
