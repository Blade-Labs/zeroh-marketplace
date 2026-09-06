/** Save once, preflight before mutation, execute the reviewed bytes. Not an authorization sandbox. */
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, writeFileSync, realpathSync, mkdtempSync, rmSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const inside = (root, path) => path === root || path.startsWith(root + sep)
const engines = {
  bash: { command: 'bash', check: ['-n'], run: ['-e', '-o', 'pipefail'] },
  python: { command: 'python3', check: ['-c', 'import ast,sys; ast.parse(sys.stdin.read())'], run: [] },
  node: { command: process.execPath, check: ['--input-type=module', '--check'], run: [] },
}
function state(cwd, path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Expected a relative file path')
  let current = cwd
  for (const part of path.split('/')) {
    current = resolve(current, part)
    try { if (lstatSync(current).isSymbolicLink()) throw new Error(`Symlink target refused: ${path}`) }
    catch (error) { if (error.code === 'ENOENT') return null; throw error }
  }
  const stat = lstatSync(current)
  if (!stat.isFile()) throw new Error(`Expected a regular file: ${path}`)
  return { sha256: hash(readFileSync(current)), mode: stat.mode & 0o777 }
}
function check(program) {
  const engine = engines[program.kind]
  if (!engine) throw new Error('kind must be bash, python or node')
  const result = spawnSync(engine.command, engine.check, { input: program.source, encoding: 'utf8', cwd: program.cwd })
  if (result.error || result.status !== 0) throw new Error(`Preflight failed: ${result.error?.message ?? result.stderr}`)
  return engine
}
export function prepare(request, directory) {
  const cwd = realpathSync(request.cwd)
  const output = realpathSync(directory)
  if (inside(cwd, output)) throw new Error('Prepared artifacts must live outside the consumer')
  if (!Array.isArray(request.paths) || !request.paths.length || new Set(request.paths).size !== request.paths.length) throw new Error('Declare unique target file paths')
  const source = readFileSync(request.script, 'utf8')
  const program = { version: 1, cwd, kind: request.kind, source, before: Object.fromEntries(request.paths.map(path => [path, state(cwd, path)])) }
  check(program)
  const bytes = JSON.stringify(program) + '\n'
  const path = resolve(output, `${hash(bytes)}.json`)
  try { writeFileSync(path, bytes, { flag: 'wx', mode: 0o400 }) }
  catch (error) { if (error.code !== 'EEXIST' || readFileSync(path, 'utf8') !== bytes) throw error }
  return path
}
export function run(path, approved = false) {
  if (!approved) throw new Error('Execution requires prior host/user approval of this artifact')
  const bytes = readFileSync(path)
  if (resolve(path) !== resolve(dirname(path), `${hash(bytes)}.json`)) throw new Error('Prepared artifact digest mismatch')
  const program = JSON.parse(bytes)
  if (program.version !== 1 || realpathSync(program.cwd) !== program.cwd || inside(program.cwd, resolve(path))) throw new Error('Invalid prepared artifact target')
  const engine = check(program)
  for (const [target, expected] of Object.entries(program.before)) {
    if (JSON.stringify(state(program.cwd, target)) !== JSON.stringify(expected)) throw new Error(`Target changed since preparation: ${target}`)
  }
  // Private execution copy of the checked bytes: children cannot consume the
  // program as stdin, and argv size limits cannot truncate large programs.
  const directory = mkdtempSync(resolve(tmpdir(), 'greenfield-program-'))
  try {
    const script = resolve(directory, program.kind === 'node' ? 'program.mjs' : 'program')
    writeFileSync(script, program.source, { flag: 'wx', mode: 0o400 })
    const result = spawnSync(engine.command, [...engine.run, script], { cwd: program.cwd, stdio: ['ignore', 'inherit', 'inherit'] })
    if (result.error) throw result.error
    return result.status ?? 1
  } finally { rmSync(directory, { recursive: true, force: true }) }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, path, option] = process.argv.slice(2)
    if (command === 'prepare') process.stdout.write(prepare(JSON.parse(readFileSync(path, 'utf8')), option) + '\n')
    else if (command === 'run') process.exitCode = run(path, option === '--approved')
    else throw new Error('Usage: prepared-program.mjs prepare request.json <existing-artifact-directory> | run <artifact.json> --approved')
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1 }
}
