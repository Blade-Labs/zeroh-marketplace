#!/usr/bin/env node
// Targets are repository-relative argv, validated completely before any test starts.
import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
const plugin = realpathSync(fileURLToPath(new URL('../', import.meta.url)))
const repo = resolve(plugin, '../..')
const schema = resolve(plugin, 'scripts/schema.test.ts')
const targets = process.argv.slice(2)
try {
  if (!targets.length) throw Error('at least one .test.mjs target is required')
  const files = targets.map(target => {
    if (isAbsolute(target) || target.split(/[\\/]/).includes('..') || !(target.endsWith('.test.mjs') || resolve(repo, target) === schema)) throw Error(`unsupported target: ${target}`)
    const path = realpathSync(resolve(repo, target))
    const rel = relative(plugin, path)
    if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel) || !statSync(path).isFile()) throw Error(`target outside plugin or not a file: ${target}`)
    return path
  })
  const commands = []
  const nodeFiles = [...new Set(files.filter(path => path !== schema))]
  if (nodeFiles.length) commands.push([process.execPath, ['--test', '--test-concurrency=1', ...nodeFiles]])
  if (files.includes(schema)) commands.push(['npx', ['--no-install', 'tsx', 'scripts/schema.test.ts']])
  for (const [command, args] of commands) {
    const result = spawnSync(command, args, { cwd: plugin, stdio: 'inherit' })
    if (result.error) console.error(result.error.message)
    if (result.signal) { process.kill(process.pid, result.signal); break }
    if (result.status !== 0) { process.exitCode = result.status ?? 1; break }
  }
} catch (error) {
  console.error(`scoped tests: ${error.message}`)
  process.exitCode = 2
}
