import { readdirSync, readFileSync, lstatSync, existsSync } from 'node:fs'
import { resolve, join, dirname, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gitToplevel } from '../plugins/zeroh-roadmap/cli/lib/gitroot.mjs'
import { bridgeEval } from '../plugins/zeroh-roadmap/cli/lib/tsx-bridge.mjs'

export function checkRoadmapImports(root) {
  root = resolve(root)
  if (!existsSync(join(root, 'lib/schema.ts'))) throw new Error('missing root-local schema')
  const backlog = join(root, 'backlog.ts')
  if (!existsSync(backlog)) throw new Error('missing backlog artifact')
  const files = [backlog]
  for (const [dir, suffix] of [['arcs', '.arc.ts'], ['phases', '.phase.ts']]) {
    const found = []
    const walk = (path) => {
      for (const name of readdirSync(path).sort()) {
        const file = join(path, name); const stat = lstatSync(file)
        if (stat.isSymbolicLink()) throw new Error('symlink artifact: ' + file)
        if (stat.isDirectory()) walk(file)
        else if (name.endsWith(suffix)) found.push(file)
      }
    }
    walk(join(root, dir))
    if (!found.length) throw new Error('empty ' + dir)
    files.push(...found)
  }
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    const imports = [...source.matchAll(/^[ \t]*import\b[\s\S]*?\bfrom\s*['"]([^'"\n]+)['"]/gm)].map((match) => match[1])
    const rel = relative(dirname(file), join(root, 'lib/schema')).split('\\').join('/')
    const expected = rel.startsWith('.') ? rel : './' + rel
    if (imports.filter((value) => value === expected).length !== 1 || imports.some((value) => value.includes('lib/roadmap/schema'))) throw new Error('invalid schema import: ' + file + ' (expected ' + expected + ')')
  }
  return files
}

const VALIDATE_RECORDS = `
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
;(async () => {
  const input = JSON.parse(readFileSync(0, 'utf8'))
  const importedSchema = await import(pathToFileURL(input.schema).href)
  const schema = importedSchema.PhaseShape ? importedSchema : importedSchema.default
  for (const record of input.records) {
    const imported = await import(pathToFileURL(record.path).href)
    let value = imported.default
    if (value && typeof value === 'object' && value.default != null) value = value.default
    schema[record.shape].parse(value)
  }
  process.stdout.write('validated ' + input.records.length)
})().catch((error) => { process.stderr.write(String(error.stack || error)); process.exitCode = 1 })
`
export function validateRoadmapImports(root, { consumerRoot } = {}) {
  root = resolve(root)
  const files = checkRoadmapImports(root)
  if (!consumerRoot) { try { consumerRoot = gitToplevel(root) } catch { consumerRoot = resolve(root, '../..') } }
  const records = files.map((path) => ({ path, shape: path.endsWith('.phase.ts') ? 'PhaseShape' : path.endsWith('.arc.ts') ? 'ArcShape' : 'BacklogShape' }))
  const result = bridgeEval(consumerRoot, VALIDATE_RECORDS, { args: ['-'], input: JSON.stringify({ schema: join(root, 'lib/schema.ts'), records }) })
  if (!result.ok) throw new Error('typed record validation failed: ' + (result.stderr ?? result.kind))
  return files
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log('valid typed imports: ' + validateRoadmapImports(resolve(process.argv[2] ?? 'docs/roadmap')).length) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
