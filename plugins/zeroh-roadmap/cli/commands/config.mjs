/**
 * roadmap config check — load + validate roadmap.config.json, print the resolved
 * bindings. Human: a slot/policy summary on STDERR + `config OK` on STDOUT. --json:
 * the parsed config object on STDOUT, narration on STDERR. A ConfigError propagates
 * to the dispatcher's exit 1 (all JSON on stdout, narration on stderr — the
 * stream-separation rule).
 */
import { loadConfig } from '../lib/config.mjs'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gitToplevel } from '../lib/gitroot.mjs'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TEMPLATE_SCHEMA = join(PLUGIN_ROOT, 'templates', 'schema.ts')
const EXPORT_DECLARATION = /^export (?:const|function|type) (\w+)/gm

function exportedNames(file) {
  const source = readFileSync(file, 'utf8')
  const names = new Set([...source.matchAll(EXPORT_DECLARATION)].map((match) => match[1]))
  for (const match of source.matchAll(/^export \* from ['"]([^'"]+)['"]/gm)) {
    const target = resolve(dirname(file), match[1])
    if (existsSync(target)) {
      for (const name of exportedNames(target)) names.add(name)
    }
  }
  return names
}

/** Return template exports absent from a consumer's vendored schema. */
export function missingSchemaExports(consumerRoot) {
  const consumerSchema = join(consumerRoot, 'lib', 'roadmap', 'schema.ts')
  if (!existsSync(consumerSchema)) return []
  const expected = exportedNames(TEMPLATE_SCHEMA)
  const actual = exportedNames(consumerSchema)
  return [...expected].filter((name) => !actual.has(name))
}

function reportSchemaDrift(consumerRoot) {
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
  if (cfg.modelPolicy) process.stderr.write(`  modelPolicy   judge=${cfg.modelPolicy.judgeModel}\n`)
  process.stdout.write('config OK\n')
  return 0
}
