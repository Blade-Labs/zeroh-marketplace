import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, dirname, join, relative, sep, resolve } from 'node:path'
import { validateGauntletContract } from './scenarios.mjs'

// Refuse an incomplete inspection rather than sampling a larger fixture estate.
export const FIXTURE_SCAN_LIMITS = Object.freeze({ maxFixtureFiles: 10000, maxFixtureBytes: 64 * 1024 * 1024 })
const check = (ok, message) => { if (!ok) throw new Error(`Fixture isolation: ${message}`) }
const within = (path, root) => { const r = relative(root, path); return r === '' || (r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r)) }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const fingerprint = s => [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs].join(':')
async function canonicalPath(path, fs) {
  check(typeof path === 'string' && isAbsolute(path), 'absolute canonical path required')
  let cursor = path
  while (true) {
    check(!(await fs.lstat(cursor)).isSymbolicLink(), `symlink path refused: ${cursor}`)
    const parent = dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  const resolved = await fs.realpath(path)
  check(resolved === path, 'noncanonical path refused')
  return resolved
}

/** Clone the supplied complete seed; scenario selection lives outside the checkout. */
export async function buildGauntletFixture({ contract, scenario, condition, root }, { cloneFixture, writeRunPacket, git }) {
  contract = validateGauntletContract(contract, { requireLaunchable: true })
  check(same(scenario, contract.scenarios.find(s => s.id === scenario?.id)), 'scenario differs from frozen contract')
  check(same(condition, contract.conditions.find(c => c.id === condition?.id)), 'condition differs from frozen contract')
  check(isAbsolute(root) && resolve(root) === root, 'absolute canonical root required')
  try { await lstat(root); throw new Error('Fixture isolation: clone target already exists') }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  let ancestor = dirname(root)
  while (true) {
    try { await canonicalPath(ancestor, { realpath, lstat }); break }
    catch (error) { if (error.code !== 'ENOENT') throw error; ancestor = dirname(ancestor) }
  }
  const armId = `${scenario.id}:${condition.id}`
  await cloneFixture({ root, seedSha: contract.fixture.baseSha, fixtureSha: contract.fixture.baseSha, scenario, condition, armId })
  const fs = { realpath, lstat }
  root = await canonicalPath(root, fs)
  const gitDir = await canonicalPath(await git(root, ['rev-parse', '--absolute-git-dir']), fs)
  const headSha = await git(root, ['rev-parse', 'HEAD'])
  const treeSha = await git(root, ['rev-parse', 'HEAD^{tree}'])
  const statusPorcelain = await git(root, ['status', '--porcelain', '--untracked-files=all'])
  check(headSha === contract.fixture.baseSha && scenario.fixtureSha === headSha, 'seed SHA mismatch')
  check(statusPorcelain === '', 'dirty seed checkout')
  const runPacket = await writeRunPacket({ armId, condition, scenario, seedSha: headSha, sealedPacketIds: contract.fixture.sealedPacketIds })
  const packetPath = await canonicalPath(runPacket.path, fs)
  check(!within(packetPath, root) && !within(packetPath, gitDir), 'run packet must remain outside checkout')
  check(await git(root, ['status', '--porcelain', '--untracked-files=all']) === '', 'run packet dirtied fixture')
  return {
    armId, root, gitDir, headSha, baseSha: headSha, fixtureSha: headSha, treeSha, statusPorcelain,
    providerNamespace: `${contract.externalActionAuthority.providerNamespace}/${scenario.id}-${condition.id}`,
    repositoryId: `${contract.externalActionAuthority.repositoryNamespace}/${scenario.id}-${condition.id}`,
    runPacket: { path: packetPath }, sealedPacketIds: [...contract.fixture.sealedPacketIds],
  }
}

/** Evaluator-side isolation check. Sealed bytes never enter the builder's control packet. */
export async function assertFixtureIsolation(fixtures, deps) {
  const { git, readPrompt, readNamespace, readSealedPackets } = deps
  const fs = { lstat, readdir, readFile, realpath, ...deps }
  check(Array.isArray(fixtures) && fixtures.length > 0, 'fixtures required')
  check(typeof readSealedPackets === 'function', 'evaluator sealed packet reader required')
  const packets = await readSealedPackets()
  check(Array.isArray(packets) && packets.length > 0, 'sealed packets unavailable')
  const packetIds = new Set()
  for (const packet of packets) {
    check(typeof packet.id === 'string' && packet.id.length > 0 && !packetIds.has(packet.id), 'duplicate or missing sealed packet ID')
    packetIds.add(packet.id)
    check(Buffer.isBuffer(packet.bytes) && packet.bytes.length > 0, 'sealed packet bytes required')
    await canonicalPath(packet.path, fs)
    check((await fs.lstat(packet.path)).isFile(), 'sealed packet must be a regular file')
    check((await fs.readFile(packet.path)).equals(packet.bytes), 'sealed packet bytes mismatch')
  }
  const roots = [], gitDirs = [], controls = [], namespaces = new Set(), arms = new Set(), repositoryIds = new Set()
  let seedSha, seedTree
  const inspectBytes = data => {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data)
    for (const packet of packets) check(!bytes.includes(packet.bytes) && !bytes.includes(Buffer.from(packet.path)), 'sealed packet bytes or path leaked')
  }
  for (const fixture of fixtures) {
    check(typeof fixture.armId === 'string' && !arms.has(fixture.armId), 'duplicate or missing arm identity')
    arms.add(fixture.armId)
    check(typeof fixture.repositoryId === 'string' && !repositoryIds.has(fixture.repositoryId), 'duplicate or missing repository identity')
    repositoryIds.add(fixture.repositoryId)
    const root = await canonicalPath(fixture.root, fs)
    const gitDir = await canonicalPath(fixture.gitDir, fs)
    const control = await canonicalPath(fixture.runPacket.path, fs)
    check(!roots.some(r => within(root, r) || within(r, root)), 'shared or nested root')
    check(!gitDirs.some(r => within(gitDir, r) || within(r, gitDir)), 'shared git directory')
    check(!controls.includes(control), 'shared run packet')
    roots.push(root); gitDirs.push(gitDir); controls.push(control)
    const namespace = await readNamespace(fixture)
    check(typeof namespace === 'string' && namespace === fixture.providerNamespace && !namespaces.has(namespace), 'shared or mismatched namespace')
    namespaces.add(namespace)
    const head = await git(root, ['rev-parse', 'HEAD'])
    const tree = await git(root, ['rev-parse', 'HEAD^{tree}'])
    const actualGitDir = await git(root, ['rev-parse', '--absolute-git-dir'])
    check(actualGitDir === gitDir, 'git directory mismatch')
    seedSha ??= fixture.fixtureSha; seedTree ??= fixture.treeSha
    check(/^[a-f0-9]{40}$/.test(seedSha) && head === seedSha && head === fixture.headSha && head === fixture.baseSha && head === fixture.fixtureSha, 'seed SHA mismatch')
    check(tree === seedTree && tree === fixture.treeSha, 'seed tree SHA mismatch')
    check(fixture.statusPorcelain === '' && await git(root, ['status', '--porcelain', '--untracked-files=all']) === '', 'dirty status; clean fixture required')
    check(Array.isArray(fixture.sealedPacketIds) && fixture.sealedPacketIds.length === packetIds.size && new Set(fixture.sealedPacketIds).size === packetIds.size && fixture.sealedPacketIds.every(id => packetIds.has(id)), 'sealed packet references mismatch')
    inspectBytes(await readPrompt(fixture))
  }
  for (const control of controls) check(![...roots, ...gitDirs].some(r => within(control, r)), 'control packet inside arm')
  const scanRoots = [...roots, ...gitDirs, ...controls.map(dirname)]
  for (const packet of packets) check(!scanRoots.some(r => within(packet.path, r)), 'sealed evaluator packet inside arm or control directory')
  const visited = new Set()
  let files = 0, bytes = 0
  async function walk(path) {
    const stat = await fs.lstat(path)
    check(!stat.isSymbolicLink(), 'symlink fixture entry refused')
    if (visited.has(path)) return
    visited.add(path)
    if (stat.isDirectory()) {
      for (const name of await fs.readdir(path)) await walk(join(path, name))
      check(fingerprint(stat) === fingerprint(await fs.lstat(path)), 'fixture directory changed during scan')
      return
    }
    check(stat.isFile(), 'special fixture entry refused')
    check(++files <= FIXTURE_SCAN_LIMITS.maxFixtureFiles && (bytes += stat.size) <= FIXTURE_SCAN_LIMITS.maxFixtureBytes, 'fixture scan limits exceeded')
    const content = await fs.readFile(path)
    check(content.length === stat.size && fingerprint(stat) === fingerprint(await fs.lstat(path)), 'fixture file changed during scan')
    inspectBytes(content)
  }
  for (const path of scanRoots) await walk(path)
  // Detect tracked or untracked mutation while evaluator inspection was in progress.
  for (const f of fixtures) {
    check(await git(f.root, ['rev-parse', 'HEAD']) === seedSha && await git(f.root, ['rev-parse', 'HEAD^{tree}']) === seedTree && await git(f.root, ['status', '--porcelain', '--untracked-files=all']) === '', 'fixture changed during isolation check')
  }
  return true
}
