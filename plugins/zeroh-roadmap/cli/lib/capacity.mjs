/**
 * capacity — live box-resource admission: "can another executor spawn RIGHT NOW, and how many
 * at most?" The mandatory gate any parallel fan-out must consult (phase 11; DESIGN-NOTES
 * §Parallel dispatch). Decisions are made from the box's at-that-moment signals; the consumer
 * config's optional `capacity` block only sets the policy bounds.
 *
 * Probe contract (every reader injectable; `defaultProbes` reads the live box):
 *   memAvailableMb() -> number        /proc/meminfo MemAvailable in MB
 *   load()           -> {load1,cores} /proc/loadavg + os.availableParallelism()
 *   runningCapbuildUnits() -> number  systemd user units capbuild-* in state=running
 *   liveExecutorArms()     -> number  live arms in <toplevel>/.building (executor-arm.mjs liveArm)
 *
 * A probe that THROWS is DEGRADED: its signal drops out of the admission math entirely (never
 * counted as zero slots), its name lands in degraded[], one reasons[] line names the gap, and
 * the verdict FAILS OPEN — a host where a signal is unreadable (non-Linux, no systemctl) is
 * never blocked on missing evidence. Fail-open is per-signal, not blanket: a readable at-cap
 * signal still refuses beside a degraded one.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { liveArm, staleArms } from './executor-arm.mjs'
import { gitToplevel } from './gitroot.mjs'
import { loadConfig } from './config.mjs'

/** Policy defaults, grounded in the shared dev box's contract (capbuild MemoryMax 6G);
 *  every field overridable per box via roadmap.config.json `capacity`. */
export const DEFAULT_CAPACITY = Object.freeze({
  memPerExecutorMb: 6144,
  minFreeMemMb: 4096,
  loadPerExecutor: 2,
  maxExecutors: 3,
})

export const CapacityVerdictShape = z.object({
  canSpawn: z.boolean(),
  maxParallel: z.number().int().min(0),
  signals: z.array(
    z.object({
      name: z.string().min(1),
      value: z.number(),
      limit: z.number(),
      ok: z.boolean(),
    }),
  ),
  reasons: z.array(z.string().min(1)),
  degraded: z.array(z.string().min(1)),
})

export const defaultProbes = {
  memAvailableMb() {
    const m = readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+)\s*kB/m)
    if (!m) throw new Error('MemAvailable not present in /proc/meminfo')
    return Math.floor(Number(m[1]) / 1024)
  },
  load() {
    const load1 = Number(readFileSync('/proc/loadavg', 'utf8').trim().split(/\s+/)[0])
    if (!Number.isFinite(load1)) throw new Error('unreadable /proc/loadavg')
    return { load1, cores: os.availableParallelism() }
  },
  runningCapbuildUnits() {
    const out = execFileSync(
      'systemctl',
      ['--user', 'list-units', '--state=running', 'capbuild-*', '--no-legend', '--plain'],
      { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] },
    )
    return out.split('\n').filter((l) => l.trim().length > 0).length
  },
  liveExecutorArms() {
    const toplevel = gitToplevel(process.cwd())
    if (!toplevel) return 0
    let entries = []
    try {
      entries = readdirSync(join(toplevel, '.building'))
    } catch {
      return 0 // no .building dir = no arms; an absent registry is a real zero, not a degrade
    }
    // liveArm alone answers spawn-exclusivity for ONE phase and counts a completed-but-
    // undisarmed arm as live; unfiltered, three such leftovers would make every arc next
    // fail CLOSED on stale evidence. staleArms is the staleness oracle — subtract its set.
    const stale = new Set()
    try {
      for (const s of staleArms(toplevel, join(toplevel, 'roadmap', 'phases'))) stale.add(s.file)
    } catch {
      /* no oracle → fall back to liveArm alone (conservative) */
    }
    let live = 0
    for (const f of entries) {
      const m = f.match(/^(\d+)-executor\.armed$/)
      if (!m) continue
      if (stale.has(join(toplevel, '.building', f))) continue
      if (liveArm(toplevel, Number(m[1]))) live++
    }
    return live
  },
}

/** The consumer's optional `capacity` policy block, or undefined where no readable config
 *  exists — the ADVISORY readers (status --json, arm) surface capacity as a side note and must
 *  not explode on an estate whose config is absent or invalid; falling back to undefined runs
 *  the admission math on DEFAULT_CAPACITY. A verb whose whole job is the verdict (`roadmap
 *  capacity`) calls loadConfig directly instead, so a broken config still fails loud there. */
export function consumerCapacityConfig(cwd) {
  try {
    return loadConfig(cwd).capacity
  } catch {
    return undefined
  }
}

/** Named refusal for a malformed ZEROH_ROADMAP_CAPACITY_PROBES seam — callers print it and
 *  refuse; NEVER a silent fallback to live probes. */
export class SeamError extends Error {}

export const SEAM_ENV = 'ZEROH_ROADMAP_CAPACITY_PROBES'

/** The seam payload carries ALL FIVE readings or it is malformed: a partial payload would
 *  silently INVENT signals (a missing capbuildUnits/liveArms coerces to zero busy — a
 *  permissive verdict that parses cleanly), the exact silent-fallback the seam contract bans. */
const SeamPayloadShape = z.strictObject({
  memAvailableMb: z.number(),
  load1: z.number(),
  cores: z.number(),
  capbuildUnits: z.number(),
  liveArms: z.number(),
})

/** The deterministic probe seam (wired tests + dry-run simulation): when the env var is set,
 *  ALL probes come from its fixed JSON values {memAvailableMb, load1, cores, capbuildUnits,
 *  liveArms}. Returns null when unset; throws SeamError on malformed JSON or a payload missing
 *  any of the five readings. ONE home — every capacity consumer reads the same seam. */
export function seamProbes(env = process.env) {
  const raw = env[SEAM_ENV]
  if (!raw) return null
  let v
  try {
    v = JSON.parse(raw)
  } catch (e) {
    throw new SeamError(`${SEAM_ENV} is not valid JSON (${e.message}) — refusing to emit a verdict, not falling back to live probes`)
  }
  const parsed = SeamPayloadShape.safeParse(v)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
    throw new SeamError(`${SEAM_ENV} payload is incomplete or malformed (${issues}) — all five readings are required; refusing to invent signals`)
  }
  v = parsed.data
  return {
    memAvailableMb: () => v.memAvailableMb,
    load: () => ({ load1: v.load1, cores: v.cores }),
    runningCapbuildUnits: () => v.capbuildUnits,
    liveExecutorArms: () => v.liveArms,
  }
}

/**
 * Compute the admission verdict. `config` is the consumer's optional `capacity` block (absent →
 * DEFAULT_CAPACITY verbatim; a partial block keeps every untouched default). Pure over the
 * injected probes — no probe is read twice, no signal is invented.
 */
export function probeCapacity(config, probes = defaultProbes) {
  const cfg = { ...DEFAULT_CAPACITY, ...(config ?? {}) }
  const signals = []
  const reasons = []
  const degraded = []
  const slots = []

  const attempt = (signalName, fn) => {
    try {
      return fn()
    } catch (e) {
      degraded.push(signalName)
      reasons.push(`${signalName} signal unreadable on this host (${e?.message ?? e}) — fail-open, not counted against spawning`)
      return null
    }
  }

  const memAvailableMb = attempt('memory', () => probes.memAvailableMb())
  if (memAvailableMb !== null) {
    const limit = cfg.minFreeMemMb + cfg.memPerExecutorMb
    const memSlots = Math.max(0, Math.floor((memAvailableMb - cfg.minFreeMemMb) / cfg.memPerExecutorMb))
    signals.push({ name: 'memory (available MB)', value: memAvailableMb, limit, ok: memSlots >= 1 })
    slots.push(memSlots)
    if (memSlots < 1) reasons.push(`memory: ${memAvailableMb} MB available < ${limit} MB needed for one more executor (minFreeMemMb ${cfg.minFreeMemMb} + memPerExecutorMb ${cfg.memPerExecutorMb})`)
  }

  const load = attempt('load', () => probes.load())
  if (load !== null) {
    const loadSlots = Math.floor(Math.max(0, load.cores - load.load1) / cfg.loadPerExecutor)
    signals.push({ name: 'load (1-min)', value: load.load1, limit: load.cores, ok: loadSlots >= 1 })
    slots.push(loadSlots)
    if (loadSlots < 1) reasons.push(`load: 1-min load ${load.load1} leaves under ${cfg.loadPerExecutor} free cores per executor on ${load.cores} cores`)
  }

  const capbuild = attempt('capbuild-units', () => probes.runningCapbuildUnits())
  const arms = attempt('executor-arms', () => probes.liveExecutorArms())
  if (capbuild !== null || arms !== null) {
    const busy = (capbuild ?? 0) + (arms ?? 0)
    const busySlots = Math.max(0, cfg.maxExecutors - busy)
    signals.push({ name: 'executors (busy)', value: busy, limit: cfg.maxExecutors, ok: busy < cfg.maxExecutors })
    slots.push(busySlots)
    if (busySlots < 1) reasons.push(`executors: ${busy} busy (capbuild units + live arms) ≥ maxExecutors ${cfg.maxExecutors}`)
  }

  // Degraded signals dropped out of the min above; an all-blind host fails open at one slot.
  const maxParallel = slots.length > 0 ? Math.min(...slots) : 1
  return CapacityVerdictShape.parse({
    canSpawn: maxParallel >= 1,
    maxParallel,
    signals,
    reasons,
    degraded,
  })
}
