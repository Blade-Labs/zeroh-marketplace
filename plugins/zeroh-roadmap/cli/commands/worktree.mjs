/**
 * roadmap worktree — the session worktree lane's command surface:
 *
 *   roadmap worktree up                  claim a slot + ensure the worktree; prints the DIR
 *                                        (last stdout line) the session cds into
 *   roadmap worktree status              one row per registry slot: slot, dir, pid, live|dead
 *   roadmap worktree reset [--base <r>] [--slot <k>]  reset the claimed worktree's scratch head for a new
 *                                        phase (refuses dirty, exit 2)
 *
 * `up` never resets — entering the lane must not eat in-flight work; reset is its own
 * deliberate act. Base ref resolution everywhere: --base wins, else the consumer's
 * mergePolicy.autonomousPushRefs[0], else 'develop'.
 */
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { detectInstaller } from './codex.mjs'
import { gitToplevel } from '../lib/gitroot.mjs'
import { loadConfig, integrationRefOf, worktreeGcPolicyOf, ConfigError } from '../lib/config.mjs'
import { claimSlot, ensureWorktree, resetForPhase, listSlots, ownerIdentity, WorktreeError, runWorktreeCleanup } from '../lib/worktree.mjs'

/** A config that will not load REFUSES here (the ConfigError → exit 1 house posture the bin
 *  dispatcher owns): guessing 'develop' would reset or land the lane onto a branch the
 *  consumer never named. */
function integrationRef(root, argv) {
  const bi = argv.indexOf('--base')
  if (bi >= 0 && argv[bi + 1]) return argv[bi + 1]
  return integrationRefOf(loadConfig(root))
}

/** Install each package directory according to its committed lockfile. */
export function installDeps(dir) {
  const capbuild = (() => {
    try {
      execFileSync('which', ['capbuild'], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  })()
  for (const sub of [dir, join(dir, 'web')]) {
    const installer = detectInstaller(sub)
    if (installer === undefined) continue
    if (installer === null) {
      throw new Error(`cannot select a package manager for ${sub}: commit pnpm-lock.yaml or package-lock.json`)
    }
    const argv = capbuild ? ['capbuild', installer.bin, ...installer.args] : [installer.bin, ...installer.args]
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
  // The caller's OWN claim, or an explicit --slot <k> for an orphan. No silent fallback:
  // resetting an unowned worktree eats another session's state.
  const si = argv.indexOf('--slot')
  const wanted = si >= 0 ? Number(argv[si + 1]) : null
  const mine =
    wanted !== null ? (rows.find((r) => r.slot === wanted) ?? null) : (rows.find((r) => r.owner === ownerIdentity()) ?? null)
  if (!mine) {
    process.stderr.write(
      wanted !== null
        ? `roadmap worktree reset: no registry row for --slot ${wanted}\n`
        : rows.length === 0
          ? 'roadmap worktree reset: no slot claimed — run `roadmap worktree up` first\n'
          : `roadmap worktree reset: none of the ${rows.length} slot(s) is this session's — target an orphan explicitly with --slot <k>\n`,
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

/** Explicit apply is still bounded by the consumer's opt-in policy. */
export async function runGc(root, argv, { out = process.stdout, err = process.stderr, ...deps } = {}) {
  const seen = new Set(), overrides = {}
  let apply = false, json = false
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]
    if (seen.has(flag) || !['--apply', '--json', '--inactive-observations', '--inactive-interval-ms'].includes(flag)) {
      err.write('worktree gc: usage error: unknown or duplicate flag\n'); return 1
    }
    seen.add(flag)
    if (flag === '--apply') { apply = true; continue }
    if (flag === '--json') { json = true; continue }
    const raw = argv[++index], value = Number(raw)
    if (!/^[0-9]+$/.test(raw ?? '') || !Number.isSafeInteger(value) || value < (flag === '--inactive-observations' ? 2 : 1)) {
      err.write('worktree gc: usage error: observations must be at least two and interval must be positive\n'); return 1
    }
    overrides[flag === '--inactive-observations' ? 'inactiveObservations' : 'inactiveIntervalMs'] = value
  }
  let config, policy
  try {
    config = loadConfig(root)
    const configured = worktreeGcPolicyOf(config)
    if (Object.entries(overrides).some(([key, value]) => value < configured[key])) { err.write('worktree gc: usage error: overrides may only strengthen configured inactivity bounds\n'); return 1 }
    policy = { ...configured, ...overrides, integrationRef: integrationRefOf(config) }
  }
  catch (error) { err.write(`worktree gc: configuration refused: ${error.message}\n`); return 1 }
  if (apply && !policy.enabled) { err.write('worktree gc: worktreeGc.enabled must be true before --apply\n'); return 1 }
  try {
    const result = await runWorktreeCleanup(root, { apply, policy }, deps)
    if (json) out.write(JSON.stringify(result) + '\n')
    else {
      out.write(`worktree gc: ${apply ? 'apply' : 'dry-run'}\n`)
      for (const item of result.plan.items) out.write(`${item.worktree}: ${item.classification}\n`)
      for (const item of [...result.resumed.items, ...(result.applied?.items ?? [])]) out.write(`${item.ownershipId}: ${item.state}${item.reason ? ` (${item.reason})` : ''}\n`)
    }
    return 0
  } catch (error) {
    err.write(`worktree gc: scan unavailable: ${error.message}\n`)
    return error instanceof ConfigError ? 1 : 2
  }
}

export default async function run(argv) {
  const sub = argv[0]
  const root = gitToplevel(process.cwd())
  if (sub === 'gc') return runGc(root, argv.slice(1))
  if (sub === 'up') return runUp(root, argv.slice(1))
  if (sub === 'status') return runStatus(root)
  if (sub === 'reset') return runReset(root, argv.slice(1))
  process.stderr.write('roadmap worktree: usage: roadmap worktree up | status | reset [--base <ref>] [--slot <k>] | gc [--apply] [--inactive-observations N] [--inactive-interval-ms MS] [--json]\n')
  return 1
}
