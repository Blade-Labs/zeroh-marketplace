import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
export const canonical = (value) => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
export const SOURCE_ROOTS = [
  '.agents/plugins/marketplace.json', '.claude-plugin/marketplace.json',
  'plugins/zeroh-greenfield',
  ...['bin', 'cli', 'skills', 'test', 'scripts', 'templates', 'agents', '.claude-plugin', '.codex-plugin', 'package.json', 'package-lock.json'].map((path) => `plugins/zeroh-roadmap/${path}`),
]
const SOURCE_EVIDENCE_EXCLUSIONS = new Set([
  'plugins/zeroh-greenfield/dry-runs/empty/receipt.json',
  'plugins/zeroh-greenfield/dry-runs/brownfield/receipt.json',
  'plugins/zeroh-greenfield/DRYRUN-2026-09.md',
])
export function sourceFiles(root) {
  const files = []
  function visit(path) {
    if (SOURCE_EVIDENCE_EXCLUSIONS.has(path) || path === 'plugins/zeroh-greenfield/dry-runs/evidence' || path.startsWith('plugins/zeroh-greenfield/dry-runs/evidence/')) return
    const absolute = resolve(root, path)
    let stat
    try { stat = lstatSync(absolute) } catch (error) {
      if (error.code === 'ENOENT') return
      throw error
    }
    assert.ok(!stat.isSymbolicLink(), `source snapshot cannot silently follow symlinks: ${path}`)
    if (stat.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) visit(`${path}/${name}`)
    } else {
      assert.ok(stat.isFile(), `unsupported source entry: ${path}`)
      files.push({ path, sha256: sha256(readFileSync(absolute)), executable: Boolean(stat.mode & 0o111) })
    }
  }
  for (const path of SOURCE_ROOTS) visit(path)
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}

export function sourceSnapshot(root) {
  const sourceSnapshotFiles = sourceFiles(root)
  return {
    invocationBaseCommit: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {encoding:'utf8'}).trim(),
    sourceSnapshotFiles,
    sourceSnapshotSha256: sha256(canonical(sourceSnapshotFiles)),
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node greenfield-evidence-source.mjs <source-root>')
  process.stdout.write(JSON.stringify(sourceSnapshot(resolve(process.argv[2])), null, 2) + '\n')
}
