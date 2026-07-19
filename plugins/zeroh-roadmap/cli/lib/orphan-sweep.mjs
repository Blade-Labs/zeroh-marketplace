/**
 * orphan-sweep — stop ownerless capbuild suite units before launching a new one.
 *
 * capbuild runs suites as transient systemd --user services (`capbuild-<invokerPid>`),
 * so the unit is NOT in the invoking shell's process group: when the invoker dies
 * without a clean stop (SIGKILL, a harness reaping a background command, a closed
 * session) the suite keeps running with no consumer. A relaunched land/gate engine
 * then starts a DUPLICATE full tier beside it — 2026-07-19, landing arc
 * APPLY-WORKFORCE: two full unit tiers thrashed 8 cores (load >20) and risked the
 * shared-store pollution flake. capbuild now carries an in-unit invoker-liveness
 * watchdog; this sweep is the defense-in-depth for hosts/units predating it, run at
 * the ONE seam every suite launch shares (runArcEndSuite / the gate).
 *
 * Attribution rule: the unit name embeds the invoker PID. The unit is an orphan
 * when that PID is gone OR the PID has been recycled by a non-capbuild process
 * (/proc/<pid>/cmdline no longer mentions capbuild). A live capbuild invoker —
 * another session legitimately mid-suite — is NEVER touched.
 *
 * Best-effort by design: a host without systemd user units (CI, macOS) returns []
 * from every probe and the sweep is a no-op. Deps injected for tests.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/** List running capbuild-* user units. Returns unit names; [] when systemd is absent. */
function defaultListUnits() {
  try {
    const out = execFileSync(
      'systemctl',
      ['--user', 'list-units', 'capbuild-*', '--state=running', '--no-legend', '--plain'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
    return out
      .split('\n')
      .map((l) => l.trim().split(/\s+/)[0])
      .filter((u) => /^capbuild-\d+\.service$/.test(u))
  } catch {
    return []
  }
}

/** The invoker's /proc cmdline, or null when the PID is gone. */
function defaultReadCmdline(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ')
  } catch {
    return null
  }
}

function defaultStopUnit(unit) {
  execFileSync('systemctl', ['--user', 'stop', unit], { stdio: 'ignore' })
}

/**
 * Pure attribution: which of these units have a dead (or recycled) invoker?
 * Exported separately so the rule is testable without a systemd host.
 */
export function findOrphanCapbuildUnits(units, readCmdline) {
  const orphans = []
  for (const unit of units) {
    const pid = Number(/^capbuild-(\d+)\.service$/.exec(unit)?.[1])
    if (!Number.isFinite(pid)) continue
    const cmdline = readCmdline(pid)
    if (cmdline == null || !cmdline.includes('capbuild')) orphans.push(unit)
  }
  return orphans
}

/**
 * Stop every orphaned capbuild unit; returns { stopped: string[] }. Never throws —
 * a sweep failure must not block the suite it protects (worst case is the status
 * quo ante: the orphan competes with the run).
 */
export function sweepOrphanCapbuildUnits({
  listUnits = defaultListUnits,
  readCmdline = defaultReadCmdline,
  stopUnit = defaultStopUnit,
  log = (msg) => process.stderr.write(`${msg}\n`),
} = {}) {
  const stopped = []
  try {
    for (const unit of findOrphanCapbuildUnits(listUnits(), readCmdline)) {
      try {
        stopUnit(unit)
        stopped.push(unit)
        log(`orphan-sweep: stopped ${unit} — its capbuild invoker is dead, so its result had no consumer (a duplicate would have run beside it)`)
      } catch {
        log(`orphan-sweep: could not stop ${unit} — continuing; it may compete with this suite`)
      }
    }
  } catch {
    // best-effort: never block the suite on sweep failure
  }
  return { stopped }
}
