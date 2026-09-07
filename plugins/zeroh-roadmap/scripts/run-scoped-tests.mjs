#!/usr/bin/env node
// Targets are repository-relative argv, validated completely before any test starts.
import { realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveTestExecution, runNodeTests, runSchemaTest, finishTestExecution } from './test-execution.mjs'
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
    const inPlugin = !(rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel))
    const inConsumerScripts = dirname(path) === resolve(repo, 'scripts') && path.endsWith('.test.mjs')
    if ((!inPlugin && !inConsumerScripts) || !statSync(path).isFile()) throw Error(`target outside test homes or not a file: ${target}`)
    return { path, cwd: inPlugin ? plugin : repo }
  })
  const execution = resolveTestExecution()
  for (const cwd of [plugin, repo]) {
    const nodeFiles = [...new Set(files.filter(file => file.cwd === cwd && file.path !== schema).map(file => file.path))]
    if (!nodeFiles.length) continue
    const result = runNodeTests({ cwd, files: nodeFiles, execution })
    const status = finishTestExecution(result)
    if (status !== 0) process.exit(status)
  }
  if (files.some(file => file.path === schema)) {
    const status = finishTestExecution(runSchemaTest({ cwd: plugin, execution }))
    if (status !== 0) process.exit(status)
  }
} catch (error) {
  console.error(`scoped tests: ${error.message}`)
  process.exitCode = 2
}
