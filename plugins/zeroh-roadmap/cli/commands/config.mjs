/**
 * roadmap config check — load + validate roadmap.config.json, print the resolved
 * bindings. Human: a slot/policy summary on STDERR + `config OK` on STDOUT. --json:
 * the parsed config object on STDOUT, narration on STDERR. A ConfigError propagates
 * to the dispatcher's exit 1 (all JSON on stdout, narration on stderr — the
 * stream-separation rule).
 */
import { loadConfig } from '../lib/config.mjs'

export default async function run(argv) {
  const sub = argv[0]
  const json = argv.includes('--json')
  if (sub !== 'check') {
    process.stderr.write(`roadmap config: unknown subcommand '${sub ?? ''}' (expected: check)\n`)
    return 1
  }

  const cfg = loadConfig(process.cwd()) // ConfigError → dispatcher exit 1

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
