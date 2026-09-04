#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

const args = process.argv.slice(2)
if (args.includes('--help')) {
  console.log('Usage: check-readme-catalog.mjs (--catalog <json> | --project-root <dir>) [--readme <file>]')
  process.exit(0)
}
const value = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined }
const readmePath = resolve(value('--readme') ?? 'README.md')
const fail = message => { console.error(message); process.exitCode = 1 }
if (!existsSync(readmePath)) fail(`nonexistent README: ${readmePath}`)
else {
  const body = readFileSync(readmePath, 'utf8')
  const block = body.match(/<!-- repo-catalog:start -->([\s\S]*?)<!-- repo-catalog:end -->/)?.[1]
  if (!block) fail('malformed README catalog')
  else {
    const tableLines = block.split(/\r?\n/).filter(line => line.trim().startsWith('|'))
    const parsedRows = [...block.matchAll(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|$/gm)]
    if (parsedRows.length !== tableLines.length || parsedRows.length < 2) fail('malformed README catalog row')
    const rows = parsedRows.slice(2).map(([, name, root]) => ({ name: name.trim(), root: root.trim() }))
    const catalogPath = value('--catalog')
    const projectRoot = value('--project-root')
    let projects
    try {
      if (catalogPath) {
        const parsed = JSON.parse(readFileSync(resolve(catalogPath), 'utf8'))
        projects = Array.isArray(parsed) ? parsed : parsed.projects
        if (!Array.isArray(projects)) throw new Error('shape')
        for (const project of projects) if (!project?.name || !project?.root || !existsSync(resolve(project.root))) throw new Error(`nonexistent catalog root: ${project?.root}`)
      } else if (projectRoot) {
        const root = resolve(projectRoot)
        if (!existsSync(root)) throw new Error('nonexistent project root')
        let name
        if (existsSync(resolve(root, 'package.json'))) name = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).name
        else if (existsSync(resolve(root, 'pubspec.yaml'))) name = readFileSync(resolve(root, 'pubspec.yaml'), 'utf8').match(/^name:\s*([^\s#]+)/m)?.[1]
        else for (const file of ['settings.gradle.kts', 'settings.gradle']) if (existsSync(resolve(root, file))) name ??= readFileSync(resolve(root, file), 'utf8').match(/rootProject\.name\s*=\s*['\"]([^'\"]+)/)?.[1]
        name ??= basename(root)
        projects = [{ name, root: projectRoot }]
      } else throw new Error('choose --catalog or --project-root')
    } catch (error) { fail(`invalid catalog shape or input: ${error.message}`); projects = null }
    const duplicate = (items, label) => {
      const seen = new Set(); for (const item of items) { if (seen.has(item.name)) fail(`duplicate ${label} name: ${item.name}`); seen.add(item.name) }
    }
    duplicate(rows, 'README')
    if (projects) {
      duplicate(projects, 'catalog')
      const byName = new Map(rows.map(row => [row.name, row]))
      const catalogNames = new Set(projects.map(project => project.name))
      for (const project of projects) if (!byName.has(project.name)) fail(`missing README project: ${project.name} (${project.root})`)
      else if (byName.get(project.name).root !== project.root) fail(`README project path mismatch: ${project.name} (${byName.get(project.name).root} != ${project.root})`)
      for (const row of rows) if (!catalogNames.has(row.name)) fail(`orphan README project: ${row.name} (${row.root})`)
    }
  }
}
