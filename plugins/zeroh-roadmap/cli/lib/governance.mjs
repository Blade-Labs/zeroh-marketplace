import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { loadConfig } from './config.mjs'

const RULES = [
  ['AGENTS.md', 'agents'],
  ['CLAUDE.md', 'claude'],
]

const inside = (root, path) => {
  const rel = relative(root, path)
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

const hold = (root, targets, kind, target, reason) => ({
  root, targets, instructions: [], taskRunners: null,
  hold: { kind, target, reason },
})

function inspectTarget(root, target) {
  const absolute = isAbsolute(target) ? resolve(target) : resolve(root, target)
  if (!inside(root, absolute)) {
    return { error: ['target-outside-repository', `target resolves outside repository: ${target}`] }
  }

  const rel = relative(root, absolute) || '.'
  const parts = rel === '.' ? [] : rel.split(sep)
  let cursor = root
  let nearest = root
  let canonical = root
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]
    cursor = join(cursor, part)
    let present = false
    try {
      lstatSync(cursor)
      present = true
      const actual = realpathSync(cursor)
      if (!inside(root, actual)) {
        return { error: ['symlink-escape', `target crosses a symlink outside repository: ${target}`] }
      }
      canonical = actual
      nearest = statSync(actual).isDirectory() ? actual : dirname(actual)
    } catch (error) {
      if (!present && error?.code === 'ENOENT') {
        canonical = join(canonical, ...parts.slice(index))
        break
      }
      return { error: ['access-refused', `cannot inspect target ${target}: ${error?.message ?? error}`] }
    }
  }
  return { rel: relative(root, canonical) || '.', nearest }
}

/** Resolve repository instructions and configured runner bindings as inert launch evidence. */
export function resolveGovernance(rootPath, targetPaths) {
  let root
  try {
    root = realpathSync(rootPath)
  } catch (error) {
    return hold(resolve(rootPath), [], 'access-refused', String(rootPath), error?.message ?? String(error))
  }

  const requested = [...new Set((targetPaths ?? []).map(String))]
  const inspected = []
  for (const target of requested) {
    const result = inspectTarget(root, target)
    if (result.error) return hold(root, requested.sort(), result.error[0], target, result.error[1])
    inspected.push(result)
  }
  const targets = [...new Set(inspected.map(({ rel }) => rel))].sort()

  const directories = new Set()
  for (const { nearest } of inspected) {
    let cursor = nearest
    while (inside(root, cursor)) {
      directories.add(cursor)
      if (cursor === root) break
      cursor = dirname(cursor)
    }
  }
  const orderedDirectories = [...directories].sort((a, b) => {
    const depth = (p) => relative(root, p).split(sep).filter(Boolean).length
    return depth(a) - depth(b) || relative(root, a).localeCompare(relative(root, b))
  })

  const instructions = []
  for (const directory of orderedDirectories) {
    for (const [name, kind] of RULES) {
      const path = join(directory, name)
      let present = false
      try {
        const stat = lstatSync(path)
        present = true
        if (!stat.isFile() && !stat.isSymbolicLink()) continue
        const actual = realpathSync(path)
        if (!inside(root, actual)) {
          return hold(root, targets, 'symlink-escape', relative(root, path), `instruction file resolves outside repository: ${relative(root, path)}`)
        }
        instructions.push({ path: relative(root, path), kind, text: readFileSync(path, 'utf8') })
      } catch (error) {
        if (present || error?.code !== 'ENOENT') {
          return hold(root, targets, 'access-refused', relative(root, path), error?.message ?? String(error))
        }
      }
    }
  }

  try {
    const config = loadConfig(root)
    return { root, targets, instructions, taskRunners: { ...config.gateCommands }, hold: null }
  } catch (error) {
    return {
      root, targets, instructions, taskRunners: null,
      hold: { kind: 'task-runners-unavailable', target: 'roadmap.config.json', reason: error?.message ?? String(error) },
    }
  }
}
