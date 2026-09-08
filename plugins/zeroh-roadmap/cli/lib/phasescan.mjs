// Factual record discovery; malformed files stay visible as errors, never empty progress.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bridgeImportMany } from './tsx-bridge.mjs'
import { gitToplevel } from './gitroot.mjs'
import { defaultExec } from './exec.mjs'
export function recordPaths(root, directory, suffix) {
  const dir = join(root, directory)
  return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.endsWith(suffix)).map(entry => join(dir, entry.name)).sort() : []
}
export function scanProgress(root) {
  const files = [...recordPaths(root, 'phases', '.phase.ts'), ...recordPaths(root, 'arcs', '.arc.ts')]
  if (!files.length) return { phases: [], arcs: [], errors: [] }
  let consumerRoot=root
  try {consumerRoot=gitToplevel(root)} catch {}
  const result = bridgeImportMany(files, { consumerRoot })
  if (!result.ok) return { phases: [], arcs: [], errors: [result.stderr || result.kind] }
  const records = result.parsed.map((record, i) => ({ ...record, file: files[i] }))
  return { phases: records.filter(record => record.file.endsWith('.phase.ts')), arcs: records.filter(record => record.file.endsWith('.arc.ts')), errors: [] }
}
export function maxDeclaredPhase(directories) {
  let max = 0
  for (const dir of directories) {
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) { max = Math.max(max, maxDeclaredPhase([join(dir, entry.name)])); continue }
      if (!entry.name.endsWith('.phase.ts')) continue
      const source = readFileSync(join(dir, entry.name), 'utf8')
      // Over-reserving a quoted number is safe; filename also prevents reuse of malformed records.
      const numbers = [...source.matchAll(/\bphase\s*:\s*(\d+)/g)].map(match => Number(match[1]))
      max = Math.max(max, Number(entry.name.match(/phase-(\d+)/)?.[1] ?? 0), ...numbers)
    }
  }
  return max
}
export function maxRemotePhase(root, ref, exec = defaultExec) {
  const list = exec('git', ['ls-tree', '-r', '--name-only', ref], { cwd: root })
  if (list.status !== 0) return 0
  let max=0
  for (const path of list.stdout.split('\n').filter(path => path.endsWith('.phase.ts'))) {
    const record=exec('git',['show',`${ref}:${path}`],{cwd:root})
    const declared=[...record.stdout.matchAll(/\bphase\s*:\s*(\d+)/g)].map(match=>Number(match[1]))
    max=Math.max(max,Number(path.match(/phase-(\d+)/)?.[1]??0),...declared)
  }
  return max
}
