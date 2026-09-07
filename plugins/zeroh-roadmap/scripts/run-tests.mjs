#!/usr/bin/env node
// Use the host's shared admission pool when installed; CI keeps a bounded
// portable runner. Schema validation runs once after every test file passes.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveTestExecution, runNodeTests, runSchemaTest, finishTestExecution } from './test-execution.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
function discover(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? discover(path) : entry.isFile() && entry.name.endsWith('.test.mjs') ? [path] : []
  })
}
const files = ['bin', 'cli', 'hooks', 'scripts', 'test'].flatMap(dir => discover(join(root, dir))).sort()
let execution
try {
  execution = resolveTestExecution()
} catch (error) {
  console.error(error.message)
  process.exit(2)
}
const tests = runNodeTests({ cwd: root, files, execution })
const testStatus = finishTestExecution(tests)
if (testStatus !== 0) process.exit(testStatus)
const schemaStatus = finishTestExecution(runSchemaTest({ cwd: root, execution }))
if (schemaStatus !== 0) process.exit(schemaStatus)
