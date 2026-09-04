#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const PROTOCOL = 'scope-manifest-json-v1'
const input = process.argv[2]
const root = process.cwd()
const unsafe = /(^|\/)(package(?:-lock)?\.json|nx\.json|workspace\.json|project\.json|(?:jest|vitest|playwright)\.config\.[^/]+)$/
const testFile = /(?:^|\/)(?:[^/]+\.)?(?:test|spec)\.[cm]?[jt]sx?$/

function full(reason) {
  return { tier: 'full', reason, argv: ['exec', '--', 'nx', 'run-many', '-t', 'test'] }
}

function pathsFromManifest(token) {
  if (typeof token !== 'string' || !token.startsWith('@')) throw new Error('missing @manifest')
  const file = resolve(token.slice(1))
  if (!isAbsolute(token.slice(1)) || (!file.includes('/roadmap-scope-') && relative(root, file).startsWith('..'))) throw new Error('manifest outside roadmap ownership')
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  if (parsed?.protocol !== PROTOCOL || !Array.isArray(parsed.paths)) throw new Error('malformed scope manifest')
  return parsed.paths
}

function pathsFromRange(range) {
  if (!/^[A-Za-z0-9._/-]+\.\.[A-Za-z0-9._/-]+$/.test(range ?? '')) throw new Error('unsafe git range')
  const r = spawnSync('git', ['diff', '--name-only', '-z', range], { cwd: root, encoding: 'utf8' })
  if (r.status !== 0) throw new Error('git diff failed')
  return r.stdout.split('\0').filter(Boolean)
}

let selection
try {
  const paths = input?.startsWith('@') ? pathsFromManifest(input) : pathsFromRange(input)
  if (paths.length === 0) selection = full('empty scope')
  else if (paths.some((p) => typeof p !== 'string' || p.length === 0 || p.includes('\0') || p.includes('\n') || isAbsolute(p) || relative(root, resolve(root, p)).startsWith('..'))) selection = full('unsafe scope path')
  else if (paths.some((p) => unsafe.test(p))) selection = full('workspace or test-runner input')
  else if (paths.some((p) => testFile.test(p) && !existsSync(resolve(root, p)))) selection = full('nonexistent exact-test target')
  else selection = { tier: paths.every((p) => testFile.test(p)) ? 'scoped' : 'affected', reason: 'validated scope manifest', argv: ['exec', '--', 'nx', 'affected', '-t', 'test', `--files=${paths.join(',')}`] }
} catch (error) {
  selection = full(error.message)
}

process.stdout.write(JSON.stringify(selection) + '\n')
const child = spawnSync('npm', selection.argv, { cwd: root, stdio: 'inherit' })
process.exit(child.error ? 1 : (child.status ?? 1))
