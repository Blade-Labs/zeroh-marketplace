// Load the consumer's own typed records in a bounded subprocess. No cache writes.
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
export { BridgeError } from './bridge-error.mjs'
export { consumerSchemaPath } from './roadmap-root.mjs'
export const PLUGIN_TSX = fileURLToPath(new URL('../../node_modules/.bin/tsx', import.meta.url))
export const TSX_ABSENT_HINT = 'Install the consumer dependencies with its lockfile, or install the Roadmap package dependencies. Validation is unavailable, not passed.'
export function resolveTsxInvocation(consumerRoot, { pluginTsx = PLUGIN_TSX } = {}) {
  const local = join(resolve(consumerRoot), 'node_modules/.bin/tsx')
  return { file: existsSync(local) ? local : pluginTsx, prefix: [] }
}
export function bridgeEval(consumerRoot, script, { args = [], input, timeout = 30000, exec = execFileSync, pluginTsx = PLUGIN_TSX } = {}) {
  const { file, prefix } = resolveTsxInvocation(consumerRoot, { pluginTsx })
  if (Buffer.byteLength(script) > 96000 || args.some(arg => Buffer.byteLength(String(arg)) > 96000)) return { ok: false, kind: 'load', stderr: 'Use stdin for document-sized input.' }
  try { return { ok: true, stdout: exec(file, [...prefix, '-e', script, ...args], { cwd: consumerRoot, input, timeout, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['pipe','pipe','pipe'] }) } }
  catch (error) {
    const stderr = String(error.stderr || error.message)
    if (error.code === 'ENOENT') return { ok: false, kind: 'tsx-absent', stderr: TSX_ABSENT_HINT }
    if (error.status === 3 && stderr.startsWith('ZODISSUES:')) {
      try { return { ok: false, kind: 'zod', issues: JSON.parse(stderr.slice(10)), stderr } } catch {}
    }
    return { ok: false, kind: 'load', stderr, exitCode: error.status ?? 1 }
  }
}
const importScript = `const fs = require('node:fs'); const {pathToFileURL} = require('node:url');
const paths = JSON.parse(fs.readFileSync(0, 'utf8'));
Promise.all(paths.map(async path => { const m = await import(pathToFileURL(path).href); return m.default?.default ?? m.default; }))
.then(records => process.stdout.write('PARSED:' + JSON.stringify(records)))
.catch(error => { if (Array.isArray(error.issues)) { process.stderr.write('ZODISSUES:' + JSON.stringify(error.issues)); process.exit(3) } process.stderr.write(String(error.stack || error)); process.exit(4) })`
function parsed(result) {
  if (!result.ok) return result
  const index = result.stdout.lastIndexOf('PARSED:')
  try { if (index < 0) throw new Error('No typed record returned'); return { ok: true, parsed: JSON.parse(result.stdout.slice(index + 7)) } }
  catch (error) { return { ok: false, kind: 'load', stderr: error.message } }
}
export function bridgeImportMany(paths, { consumerRoot = dirname(resolve(paths[0])), ...options } = {}) {
  return parsed(bridgeEval(consumerRoot, importScript, { ...options, input: JSON.stringify(paths.map(path => resolve(path))) }))
}
export function bridgeImport(path, options = {}) {
  const result = bridgeImportMany([path], options)
  return result.ok ? { ok: true, parsed: result.parsed[0] } : result
}
// Read literal committed intent without executing source or importing mutable helpers.
// Unsupported computed intent is explicitly unavailable; do not guess its old value.
export function bridgeSource(source, sourcePath, consumerRoot=dirname(sourcePath), wrapper = 'defineArc') {
  try {
    let ts
    try { ts=createRequire(import.meta.url)('typescript') } catch {
      try {ts=createRequire(join(resolve(consumerRoot),'package.json'))('typescript')} catch {throw new Error('TypeScript parser unavailable: install Roadmap package dependencies or consumer typescript before active intent validation.')}
    }
    const file = ts.createSourceFile(sourcePath,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
    if (file.parseDiagnostics.length) throw new Error('Committed intent has invalid TypeScript syntax')
    const exports = file.statements.filter(ts.isExportAssignment)
    if (exports.length !== 1) throw new Error('Expected one default intent export')
    let expression = exports[0].expression
    if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === wrapper && expression.arguments.length === 1) expression=expression.arguments[0]
    function literal(node) {
      if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) return literal(node.expression)
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
      if (ts.isNumericLiteral(node)) return Number(node.text)
      if (node.kind === ts.SyntaxKind.TrueKeyword) return true
      if (node.kind === ts.SyntaxKind.FalseKeyword) return false
      if (node.kind === ts.SyntaxKind.NullKeyword) return null
      if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal)
      if (ts.isObjectLiteralExpression(node)) {
        const out=Object.create(null)
        for (const property of node.properties) {
          if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name)||ts.isStringLiteral(property.name)||ts.isNumericLiteral(property.name))) throw new Error('Intent must use literal properties, not spreads, methods or computed names')
          const key=property.name.text
          if (Object.hasOwn(out,key)) throw new Error('Duplicate intent property: '+key)
          out[key]=literal(property.initializer)
        }
        return out
      }
      throw new Error('Committed intent must be a literal defineArc({...}) record; computed/imported values require an explicitly reviewed literal baseline')
    }
    const record=literal(expression)
    if (!record || Array.isArray(record) || typeof record!=='object') throw new Error('Expected a literal arc object')
    return {ok:true,parsed:record}
  } catch(error) { return {ok:false,kind:'load',stderr:error.message} }
}
// Validation always applies the selected consumer schema, even for plain object exports.
export function bridgeValidate(path, schemaPath, shape, consumerRoot) {
  const script = `const fs=require('node:fs'); const {pathToFileURL}=require('node:url');
const [path,schema,shape]=JSON.parse(fs.readFileSync(0,'utf8'));
Promise.all([import(pathToFileURL(path).href),import(pathToFileURL(schema).href)]).then(([m,s])=>{
const record=m.default?.default??m.default; const parser=s[shape]??s.default?.[shape];
if(!parser?.parse) throw new Error('Consumer schema does not export '+shape+'; use its compatible plugin or review a focused schema upgrade.');
process.stdout.write('PARSED:'+JSON.stringify(parser.parse(record)));
}).catch(error=>{if(Array.isArray(error.issues)){process.stderr.write('ZODISSUES:'+JSON.stringify(error.issues));process.exit(3)}process.stderr.write(String(error.stack||error));process.exit(4)});`
  return parsed(bridgeEval(consumerRoot,script,{input:JSON.stringify([path,schemaPath,shape])}))
}
