/**
 * roadmap init [--config] [--scaffold] — bare init = scaffold then config.
 *  --scaffold execs the plugin's OWN scripts/scaffold-roadmap.sh (the proven copier;
 *    ONE implementation — never a node port beside the living bash).
 *  --config writes <toplevel>/roadmap/roadmap.config.json ($schema → relative path
 *    to the plugin schema, configVersion 1, the seven core gateCommands slots with
 *    honest placeholders) and REFUSES (exit 1) if the file already exists — never
 *    clobber a consumer's config. init writes no optional blocks: absent mergePolicy
 *    = hold-for-user is the safe default by construction.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gitToplevel } from '../lib/gitroot.mjs'
import { roadmapRoot } from '../lib/roadmap-root.mjs'

const SCAFFOLD_SH = fileURLToPath(new URL('../../scripts/scaffold-roadmap.sh', import.meta.url))
const SCHEMA_ABS = fileURLToPath(new URL('../roadmap.config.schema.json', import.meta.url))

const PLACEHOLDER_CONFIG = {
  gateCommands: {
    lint: 'npm run lint',
    types: 'npm run type-check',
    unit: 'npm test',
    integration: 'npm run test:integration',
    build: 'npm run build',
    e2e: 'npm run test:e2e',
    emit: 'npm run emit:phases',
  },
}

export default async function run(argv) {
  const wantScaffold = argv.includes('--scaffold')
  const wantConfig = argv.includes('--config')
  const both = !wantScaffold && !wantConfig // bare init runs both

  const toplevel = gitToplevel(process.cwd())

  if (both || wantScaffold) {
    execFileSync('bash', [SCAFFOLD_SH, toplevel], { stdio: 'inherit' })
  }

  if (both || wantConfig) {
    const configPath = join(roadmapRoot(toplevel), 'roadmap.config.json')
    if (existsSync(configPath)) {
      process.stderr.write(
        `roadmap init: ${configPath} already exists — refusing to clobber a consumer's config\n`,
      )
      return 1
    }
    mkdirSync(dirname(configPath), { recursive: true })
    const config = {
      $schema: relative(dirname(configPath), SCHEMA_ABS),
      configVersion: 1,
      ...PLACEHOLDER_CONFIG,
    }
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
    process.stderr.write(`roadmap init: wrote ${configPath}\n`)
  }

  return 0
}
