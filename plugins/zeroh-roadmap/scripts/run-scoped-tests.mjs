#!/usr/bin/env node
// Targets are repository-relative argv, validated completely before any test starts.
import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
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
    if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel) || !statSync(path).isFile()) throw Error(`target outside plugin or not a file: ${target}`)
    return path
  })
  const nodeFiles = [...new Set(files.filter(path => path !== schema))]
  const execution = resolveTestExecution()
  if (nodeFiles.length) {
    const result = runNodeTests({ cwd: plugin, files: nodeFiles, execution })
    const status = finishTestExecution(result)
    if (status !== 0) process.exit(status)
  }
  if (files.includes(schema)) {
    const status = finishTestExecution(runSchemaTest({ cwd: plugin, execution }))
    if (status !== 0) process.exit(status)
  }
} catch (error) {
  console.error(`scoped tests: ${error.message}`)
  process.exitCode = 2
}
