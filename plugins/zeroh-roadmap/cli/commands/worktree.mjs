/**
 * roadmap worktree — the session worktree lane's command surface:
 *
 *   roadmap worktree up                  claim a slot + ensure the worktree; prints the DIR
 *                                        (last stdout line) the session cds into
 *   roadmap worktree status              one row per registry slot: slot, dir, pid, live|dead
 *   roadmap worktree reset [--base <r>]  reset the claimed worktree's scratch head for a new
 *                                        phase (refuses dirty, exit 2)
 *
 * `up` never resets — entering the lane must not eat in-flight work; reset is its own
 * deliberate act. Base ref resolution everywhere: --base wins, else the consumer's
 * mergePolicy.autonomousPushRefs[0], else 'develop'.
 */
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { gitToplevel } from '../lib/gitroot.mjs'
import { loadConfig, integrationRefOf } from '../lib/config.mjs'
import { claimSlot, ensureWorktree, resetForPhase, listSlots, WorktreeError } from '../lib/worktree.mjs'

/** A config that will not load REFUSES here (the ConfigError → exit 1 house posture the bin
 *  dispatcher owns): guessing 'develop' would reset or land the lane onto a branch the
 *  consumer never named. */
function integrationRef(root, argv) {
  const bi = argv.indexOf('--base')
  if (bi >= 0 && argv[bi + 1]) return argv[bi + 1]
  return integrationRefOf(loadConfig(root))
}

/** npm ci per subdir carrying a package.json — the codex-lane install pattern; a repo
 *  with no package.json anywhere installs nothing. capbuild wraps when present. */
function installDeps(dir) {
  const capbuild = (() => {
    try {
      execFileSync('which', ['capbuild'], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  })()
  for (const sub of [dir, join(dir, 'web')]) {
    if (!existsSync(join(sub, 'package.json'))) continue
    const argv = capbuild ? ['capbuild', 'npm', 'ci', '--no-audit', '--no-fund'] : ['npm', 'ci', '--no-audit', '--no-fund']
    execFileSync(argv[0], argv.slice(1), { cwd: sub, stdio: 'inherit' })
  }
}

function runUp(root, argv) {
  // Base BEFORE claim: a config refusal must not leave a slot row behind for a worktree it
  // never created.
  const baseRef = integrationRef(root, argv)
  let base = baseRef
  try {
    execFileSync('git', ['-C', root, 'rev-parse', '--verify', `${baseRef}^{commit}`], { stdio: 'ignore' })
  } catch {
    // A consumer whose integration ref does not exist yet still gets a worktree, but the
    // session must hear WHERE it started — `worktree reset` is what puts it on the real tip.
    base = 'HEAD'
    process.stderr.write(`roadmap worktree up: ${baseRef} does not resolve in ${root} — starting the worktree at HEAD instead\n`)
  }
  const { slot, dir } = claimSlot(root)
  ensureWorktree(root, slot, { baseRef: base, installDeps })
  process.stdout.write(`${dir}\n`)
  return 0
}

function runStatus(root) {
  const rows = listSlots(root)
  if (rows.length === 0) {
    process.stdout.write('no slots claimed\n')
    return 0
  }
  for (const r of rows) {
    process.stdout.write(`slot ${r.slot}  ${r.dir}  pid ${r.pid}  ${r.live ? 'live' : 'dead'}\n`)
  }
  return 0
}

function runReset(root, argv) {
  const rows = listSlots(root)
  const mine = rows.find((r) => r.pid === process.pid) ?? (rows.length === 1 ? rows[0] : null)
  if (!mine) {
    process.stderr.write(
      rows.length === 0
        ? 'roadmap worktree reset: no slot claimed — run `roadmap worktree up` first\n'
        : `roadmap worktree reset: ${rows.length} slots exist and none is this process's — ambiguous target, run from the claiming session\n`,
    )
    return 1
  }
  const baseRef = integrationRef(root, argv)
  try {
    resetForPhase(mine.dir, baseRef)
  } catch (e) {
    process.stderr.write(`${e.message}\n`)
    return e instanceof WorktreeError ? 2 : 1
  }
  process.stdout.write(`reset ${mine.dir} to ${baseRef}\n`)
  return 0
}

export default async function run(argv) {
  const sub = argv[0]
  const root = gitToplevel(process.cwd())
  if (sub === 'up') return runUp(root, argv.slice(1))
  if (sub === 'status') return runStatus(root)
  if (sub === 'reset') return runReset(root, argv.slice(1))
  process.stderr.write('roadmap worktree: usage: roadmap worktree up | status | reset [--base <ref>]\n')
  return 1
}
