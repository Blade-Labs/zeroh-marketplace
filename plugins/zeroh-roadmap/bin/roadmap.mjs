#!/usr/bin/env node
/**
 * roadmap — the CLI that owns every repo-state transition (arc ROADCODE). Decisions
 * and transitions are CODE here; judgment stays MODEL. Plain Node ESM, one dep (zod).
 *
 * Universal exit-code contract (honesty rail — exit codes never lie):
 *   0  success / clean / the requested state holds
 *   1  usage or configuration error (missing config, unknown/args, not-yet-implemented)
 *   2  check failed / refused / red (the caller cannot narrate around it)
 *   3/4 long-poll verdicts (watch — 1657; NOT used here)
 *
 * Commands are cli/commands/<name>.mjs default-export async run(argv) → exit code.
 * A command whose module is not present yet is listed in the tree with its owning
 * phase and exits 1 with an honest "not yet implemented" line — the skeleton shows
 * the whole tree, honestly.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ConfigError } from '../cli/lib/config.mjs'

// The full §2 command tree. `phase` is the owning ROADCODE phase; `sub` lists
// subcommands for --help. A command becomes MOUNTED the moment its module lands.
const TREE = {
  config: { phase: 1655, sub: ['check'], desc: 'load + validate roadmap.config.json; print resolved bindings' },
  init: { phase: 1655, sub: ['--config', '--scaffold'], desc: 'scaffold roadmap/ + config.json' },
  status: { phase: 1655, sub: ['[root]', '--json'], desc: 'derive the live lane table (absorbs arc-status.mjs)' },
  claim: { phase: 1655, sub: ['[root]', '--count N'], desc: 'atomically reserve the next phase number(s)' },
  arm: { phase: 1655, sub: ['<arcId>', '--inline', '--note', '--base-ref', '--mode'], desc: 'write the .building sidecar; refuse a taken lane' },
  disarm: { phase: 1655, sub: ['<arcId>', '--paused'], desc: 'remove/pause the sidecar; clear .arc-mode; free landed claims' },
  gate: { phase: 1656, sub: ['plan <phase>', 'run <phase>'], desc: 'the gate decision table + mechanical execution' },
  result: { phase: 1656, sub: ['check'], desc: 'PhaseExecutionResult .parse() via the consumer schema' },
  contract: { phase: 1656, sub: ['show --json-schema'], desc: 'emit the PhaseExecutionResult JSON Schema' },
  arc: { phase: 1657, sub: ['next <arcId>', 'land <arcId>'], desc: 'position derivation + the ONE landing engine' },
  watch: { phase: 1657, sub: ['<arcId>', '--once'], desc: 'executor liveness (absorbs executor-watch/liveness)' },
  beacon: { phase: 1737, sub: ['<event> --phase <N>', '--detail', '--log', '--session'], desc: 'typed executor heartbeat (closed vocabulary)' },
  'executor-arm': { phase: 1737, sub: ['<N> --session <id>'], desc: 'write the session-bound executor arm file (never unbound)' },
  'executor-disarm': { phase: 1737, sub: ['<N>', '--sweep'], desc: 'remove an executor arm / sweep exactly the stale set' },
  phase: { phase: 1657, sub: ['validate <N|file>', 'start <N>'], desc: 'phase-file validation + start convenience' },
  audit: { phase: 1659, sub: ['--json'], desc: "audit-roadmap's 12 checks, mechanized" },
  debt: { phase: 1658, sub: ['census', 'dispose', 'check'], desc: 'debt census/dispose wrappers' },
  measure: { phase: 1659, sub: ['--flow', '--assert'], desc: 'protocol-load meter (bytes/4 over the invocation path)' },
  codex: { phase: 1838, sub: ['run <N> [<N2>…] [--worktree] [--base]', 'status <N>'], desc: 'detached Codex delegation lane (worktree + stdin prompt + journal; gate stays with the session)' },
  eval: { phase: 1996, sub: ['<ARCID> [--date] [--force] [--collect-only] [--json]', 'record-sweep --arc <ID>', 'record-verdicts --arc <ID>', 'merge-judge --arc <ID>', 'trend', 'restamp', 'lesson "<text>" [--phase N]'], desc: 'arc eval: collect the trace, score the deterministic dimensions and ratchet, merge the judge verdict, record the land-time aggregates, capture a durable lesson to the committed sidecar' },
}

function printHelp() {
  const lines = ['roadmap — phase-driven development CLI', '', 'Commands:']
  for (const [name, meta] of Object.entries(TREE)) {
    const subs = meta.sub?.length ? `  ${meta.sub.join(' | ')}` : ''
    lines.push(`  ${name.padEnd(9)}${subs.padEnd(38)} ${meta.desc}  [ROADCODE ${meta.phase}]`)
  }
  lines.push('', 'Exit codes: 0 clean · 1 usage/config · 2 check failed/refused · 3/4 watch verdicts')
  process.stdout.write(lines.join('\n') + '\n')
}

async function main() {
  const argv = process.argv.slice(2)
  const command = argv[0]
  const rest = argv.slice(1)

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    printHelp()
    return 0
  }

  const modUrl = new URL(`../cli/commands/${command}.mjs`, import.meta.url)
  if (existsSync(fileURLToPath(modUrl))) {
    const { default: run } = await import(modUrl)
    return await run(rest)
  }

  if (command in TREE) {
    process.stderr.write(
      `roadmap ${command}: not yet implemented (lands in ROADCODE ${TREE[command].phase})\n`,
    )
    return 1
  }

  process.stderr.write(`roadmap: unknown command '${command}'. Run: roadmap --help\n`)
  return 1
}

try {
  process.exit(await main())
} catch (e) {
  if (e instanceof ConfigError) {
    for (const line of e.messageLines) process.stderr.write(line + '\n')
    process.exit(1)
  }
  process.stderr.write(`roadmap: ${e?.stack ?? e}\n`)
  process.exit(1)
}
