/**
 * roadmap config check — load + validate roadmap.config.json, print the resolved
 * bindings. Human: a slot/policy summary on STDERR + `config OK` on STDOUT. --json:
 * the parsed config object on STDOUT, narration on STDERR. A ConfigError propagates
 * to the dispatcher's exit 1 (all JSON on stdout, narration on stderr — the
 * stream-separation rule).
 */
import { loadConfig } from '../lib/config.mjs'
import { mergePolicy } from '../lib/roles.mjs'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gitToplevel } from '../lib/gitroot.mjs'
import { consumerSchemaPath } from '../lib/roadmap-root.mjs'
import { BridgeError } from '../lib/bridge-error.mjs'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TEMPLATE_SCHEMA = join(PLUGIN_ROOT, 'templates', 'schema.ts')
const EXPORT_DECLARATION = /^export (?:const|function|type) (\w+)/gm

function starTarget(file, specifier) {
  const bare = resolve(dirname(file), specifier)
  const sourceSibling = /\.(?:m|c)?js$/.test(bare) ? bare.replace(/\.(m|c)?js$/, (_m, flavor) => `.${flavor ?? ''}ts`) : null
  return [bare, sourceSibling, `${bare}.ts`, join(bare, 'index.ts')]
    .filter(Boolean)
    .find((candidate) => existsSync(candidate) && statSync(candidate).isFile())
}

function exportInventory(file, seen = new Set()) {
  if (seen.has(file)) return { names: new Set(), unresolved: [] }
  seen.add(file)
  const source = readFileSync(file, 'utf8')
  const names = new Set([...source.matchAll(EXPORT_DECLARATION)].map((match) => match[1]))
  const unresolved = []
  for (const match of source.matchAll(/^export \* from ['"]([^'"]+)['"]/gm)) {
    const target = starTarget(file, match[1])
    if (target) {
      const nested = exportInventory(target, seen)
      for (const name of nested.names) names.add(name)
      unresolved.push(...nested.unresolved)
    } else unresolved.push(`${file}: ${match[1]}`)
  }
  return { names, unresolved }
}

/** Return template exports absent from a consumer's vendored schema. */
export function missingSchemaExports(consumerRoot) {
  // A repo with no vendored schema at EITHER seam has no drift to report — the resolver's
  // schema-missing throw is that answer, not an error this reader should propagate.
  let consumerSchema
  try {
    consumerSchema = consumerSchemaPath(consumerRoot)
  } catch (error) {
    if (!(error instanceof BridgeError && error.kind === 'schema-missing')) throw error
    return []
  }
  const expected = exportInventory(TEMPLATE_SCHEMA).names
  const actual = exportInventory(consumerSchema)
  if (actual.unresolved.length) return []
  return [...expected].filter((name) => !actual.names.has(name))
}

/** Return unresolved export-star specifiers instead of misreporting every export as missing. */
export function unresolvedSchemaExports(consumerRoot) {
  try {
    return exportInventory(consumerSchemaPath(consumerRoot)).unresolved
  } catch (error) {
    if (!(error instanceof BridgeError && error.kind === 'schema-missing')) throw error
    return []
  }
}

function reportSchemaDrift(consumerRoot) {
  for (const target of unresolvedSchemaExports(consumerRoot)) {
    process.stderr.write(`schemaDrift: could not resolve export-star target ${target}; export inventory is incomplete — repair the consumer schema barrel or re-vendor it\n`)
  }
  for (const name of missingSchemaExports(consumerRoot)) {
    process.stderr.write(
      `schemaDrift: ${name} is not exported by lib/roadmap/schema.ts; phase eval records cannot emit and scorecard samples go silent — re-vendor the schema from the plugin template\n`,
    )
  }
}

export default async function run(argv) {
  const sub = argv[0]
  const json = argv.includes('--json')
  if (sub !== 'check') {
    process.stderr.write(`roadmap config: unknown subcommand '${sub ?? ''}' (expected: check)\n`)
    return 1
  }

  const cfg = loadConfig(process.cwd()) // ConfigError → dispatcher exit 1
  reportSchemaDrift(gitToplevel(process.cwd()))

  if (json) {
    process.stdout.write(JSON.stringify(cfg, null, 2) + '\n')
    process.stderr.write('config OK (--json on stdout)\n')
    return 0
  }

  const gc = cfg.gateCommands
  process.stderr.write('roadmap config — resolved bindings:\n')
  for (const slot of ['lint', 'types', 'unit', 'integration', 'build', 'e2e', 'emit']) {
    process.stderr.write(`  ${slot.padEnd(12)} ${gc[slot]}\n`)
  }
  if (cfg.mergePolicy) {
    process.stderr.write(`  mergePolicy   arcIntegration=${cfg.mergePolicy.arcIntegration}\n`)
  } else {
    process.stderr.write('  mergePolicy   (absent → hold-for-user)\n')
  }
  const modelPolicy = mergePolicy(cfg.modelPolicy)
  process.stderr.write(`  modelPolicy   ${JSON.stringify(modelPolicy)}\n`)
  process.stdout.write('config OK\n')
  return 0
}
