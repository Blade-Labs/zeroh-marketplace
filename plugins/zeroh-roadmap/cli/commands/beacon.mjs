/**
 * roadmap beacon <event> --phase <N> [--detail <txt>] [--log <path>] [--pid <n>]
 * [--session <id>] — the ONE typed executor-heartbeat writer as a command (1737.1).
 * Thin over beacon.mjs appendExecutorEvent: closed vocabulary (unknown event = exit 1
 * usage, nothing written), phase always a number, writes the git-toplevel's
 * .building/<N>-executor.jsonl (the worktree-local file the guard + watch read).
 * --session stamps session_id — the executor-result-guard's channel (c) key.
 *
 * Returns its exit code to the dispatcher — never hard-exits the process.
 */
import { appendExecutorEvent, EXECUTOR_EVENTS } from '../lib/beacon.mjs'
import { gitToplevel } from '../lib/gitroot.mjs'

function parse(argv) {
  const opts = {}
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--phase') opts.phase = argv[++i]
    else if (a === '--detail') opts.detail = argv[++i]
    else if (a === '--log') opts.log = argv[++i]
    else if (a === '--pid') opts.pid = argv[++i]
    else if (a === '--session') opts.session = argv[++i]
    else if (!a.startsWith('--')) positional.push(a)
  }
  return { opts, positional }
}

export default async function run(argv) {
  const { opts, positional } = parse(argv)
  const event = positional[0]
  const usage = `roadmap beacon: usage: roadmap beacon <event> --phase <N> [--detail <txt>] [--log <path>] [--pid <n>] [--session <id>]\n  events: ${[...EXECUTOR_EVENTS].join(' | ')}\n`
  if (!event || !opts.phase || !/^\d+$/.test(String(opts.phase))) {
    process.stderr.write(usage)
    return 1
  }
  if (!EXECUTOR_EVENTS.has(event)) {
    process.stderr.write(`roadmap beacon: unknown event '${event}'\n${usage}`)
    return 1
  }
  const extra = {
    ...(opts.detail ? { detail: opts.detail } : {}),
    ...(opts.log ? { log: opts.log } : {}),
    ...(opts.pid ? { pid: Number(opts.pid) } : {}),
    ...(opts.session ? { session_id: opts.session } : {}),
  }
  const p = appendExecutorEvent(gitToplevel(process.cwd()), opts.phase, event, extra)
  process.stderr.write(`roadmap beacon: ${event} → ${p}\n`)
  return 0
}
