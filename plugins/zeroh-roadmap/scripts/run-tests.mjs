#!/usr/bin/env node
// Use the host's shared admission pool when installed; CI keeps a bounded
// portable runner. Manifest consistency runs once after every test file passes.
import { readdirSync, existsSync, accessSync, constants } from 'node:fs'
import { join, delimiter, resolve } from 'node:path'
import { availableParallelism } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
function discover(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? discover(path) : entry.isFile() && entry.name.endsWith('.test.mjs') ? [path] : []
  })
}
const files = [...['bin', 'cli', 'hooks', 'scripts', 'test'].flatMap(dir => discover(join(root, dir))), ...discover(join(root, '../zeroh-greenfield/test'))].sort()
const requested = process.env.TEST_CONCURRENCY ?? 'auto'
if (requested !== 'auto' && !/^[1-8]$/.test(requested)) {
  console.error('TEST_CONCURRENCY must be auto or 1..8')
  process.exit(2)
}
const helper = (process.env.PATH ?? '').split(delimiter).map(dir => resolve(dir, 'capbuild-node-tests')).find(path => {
  try { accessSync(path, constants.X_OK); return existsSync(path) } catch { return false }
})
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.error) console.error(result.error.message)
  if (result.status !== 0) process.exit(result.status ?? 1)
}
if (helper) {
  run(helper, ['--workers', requested, ...files])
} else {
  const workers = requested === 'auto' ? Math.max(1, Math.min(4, availableParallelism() - 1)) : Number(requested)
  console.log(`Node test runner: ${files.length} files, concurrency=${workers}`)
  run(process.execPath, ['--test', `--test-concurrency=${workers}`, ...files])
}
run(process.execPath, ['scripts/emit-manifests.mjs', '--check'])
