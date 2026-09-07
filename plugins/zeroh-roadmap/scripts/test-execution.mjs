import { accessSync, constants, existsSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { delimiter, resolve, dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

export function resolveTestExecution({ env = process.env, parallelism = availableParallelism() } = {}) {
  const requested = env.TEST_CONCURRENCY ?? 'auto'
  if (requested !== 'auto' && !/^[1-8]$/.test(requested)) {
    throw new Error('TEST_CONCURRENCY must be auto or 1..8')
  }
  const helper = (env.PATH ?? '').split(delimiter).map((dir) => resolve(dir, 'capbuild-node-tests')).find((path) => {
    try { accessSync(path, constants.X_OK); return existsSync(path) } catch { return false }
  }) ?? null
  const workers = requested === 'auto' ? Math.max(1, Math.min(4, parallelism - 1)) : Number(requested)
  return { requested, helper, workers }
}

export function runNodeTests({ cwd, files, execution }) {
  if (execution.helper) {
    return spawnSync(execution.helper, ['--workers', execution.requested, ...files], { cwd, stdio: 'inherit' })
  }
  console.log(`Node test runner: ${files.length} files, concurrency=${execution.workers}`)
  return spawnSync(process.execPath, ['--test', `--test-concurrency=${execution.workers}`, ...files], { cwd, stdio: 'inherit' })
}

export function runSchemaTest({ cwd, execution }) {
  if (execution.helper) {
    return spawnSync(join(dirname(execution.helper), 'capbuild'),
      ['--timeout', '300', 'npx', '--no-install', 'tsx', 'scripts/schema.test.ts'],
      { cwd, stdio: 'inherit' })
  }
  return spawnSync('npx', ['--no-install', 'tsx', 'scripts/schema.test.ts'], { cwd, stdio: 'inherit' })
}

export function finishTestExecution(result) {
  if (result.error) console.error(result.error.message)
  if (result.signal) process.kill(process.pid, result.signal)
  return result.status ?? 1
}
