#!/usr/bin/env node
/**
 * capacity.test.mjs — the RED-first behavioral contract for cli/lib/capacity.mjs (task 11.1).
 * Every live signal arrives through an INJECTED probe reader, so no case touches /proc,
 * systemctl or the arm registry; the only host-touching case is the last one, which pins
 * "defaultProbes never throws on this box" and asserts nothing about the box's mood.
 * Run: node --test cli/lib/capacity.test.mjs
 *
 * THE PROBE READER CONTRACT these fixtures define (probeCapacity's 2nd argument, whole object
 * or partial-by-spread; each key is a zero-arg function, and a THROW marks its signal degraded):
 *   memAvailableMb()        -> number   MemAvailable, megabytes
 *   load()                  -> { load1, cores }
 *   runningCapbuildUnits()  -> number   running capbuild-* transient units
 *   liveExecutorArms()      -> number   live .building/<N>-executor.armed claims
 *
 * THE MATH these fixtures are computed against (phase-11 step 2), with the defaults
 * memPerExecutorMb 6144 / minFreeMemMb 4096 / loadPerExecutor 2 / maxExecutors 3:
 *   memSlots   = floor((memAvailableMb - minFreeMemMb) / memPerExecutorMb)
 *   loadSlots  = floor(max(0, cores - load1) / loadPerExecutor)
 *   busy       = runningCapbuildUnits + liveExecutorArms
 *   maxParallel= max(0, min(memSlots, loadSlots, maxExecutors - busy))   [degraded signals DROP OUT]
 *   canSpawn   = maxParallel >= 1
 * Each signal row carries its own evidence: memory value = memAvailableMb and limit =
 * minFreeMemMb + memPerExecutorMb (the floor below which no executor fits); the executor row's
 * value = busy and limit = maxExecutors. Boundaries are tested at the exact integer, both sides.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { CapacityVerdictShape, probeCapacity, defaultProbes } from './capacity.mjs'

// ── fixture helpers ────────────────────────────────────────────────────────────────────
/** A GENEROUS box (memSlots 31, loadSlots 32, busy 0) — override exactly the signal under test. */
const probes = (over = {}) => ({
  memAvailableMb: () => 200_000,
  load: () => ({ load1: 0, cores: 64 }),
  runningCapbuildUnits: () => 0,
  liveExecutorArms: () => 0,
  ...over,
})

/** A reader that is unavailable on this host (non-Linux, no systemctl, unreadable /proc). */
const unreadable = (why) => () => {
  throw new Error(why)
}

const MEM = /mem/i
const LOAD = /load/i
const EXEC = /exec|busy|slot/i

const signal = (v, re) => v.signals.find((s) => re.test(s.name))
const names = (v) => v.signals.map((s) => s.name).join(', ')

/**
 * Parse the verdict through the module's OWN shape and enforce the invariants that must hold
 * for every verdict ever produced, then hand the parsed object back for case assertions.
 */
function verdict(raw) {
  const v = CapacityVerdictShape.parse(raw)
  assert.equal(
    v.canSpawn,
    v.maxParallel >= 1,
    `canSpawn must be exactly maxParallel >= 1, never an independent flag: ${JSON.stringify(v)}`,
  )
  assert.ok(v.maxParallel >= 0 && Number.isInteger(v.maxParallel), 'maxParallel is a clamped integer')
  for (const r of v.reasons) assert.ok(r.trim().length > 0, 'a reason line is never blank')
  for (const d of v.degraded) assert.ok(d.trim().length > 0, 'a degraded name is never blank')
  assert.equal(new Set(v.degraded).size, v.degraded.length, `degraded must not repeat a signal: ${v.degraded}`)
  if (!v.canSpawn) {
    assert.ok(v.reasons.length >= 1, 'a REFUSAL always names why — a bare false is unactionable')
  }
  // reasons[] explains a REFUSAL or a DEGRADE and nothing else: task 11.4 joins it into
  // `box at capacity — <reasons.join("; ")>`, so an informational line on a clear signal
  // ships as a fabricated blockade message.
  const bound = v.signals.filter((s) => !s.ok).length
  assert.ok(
    v.reasons.length <= bound + v.degraded.length,
    `at most one reason line per BINDING constraint (${bound}) + per degraded probe (${v.degraded.length}); ` +
      `got ${JSON.stringify(v.reasons)}`,
  )
  return v
}

// ── 1. memory-bound ────────────────────────────────────────────────────────────────────
test('probeCapacity — memory-bound: available below minFreeMemMb + memPerExecutorMb refuses and names memory', () => {
  // defaults: an executor needs 4096 free + 6144 for itself = 10240 MB. One MB short.
  const v = verdict(probeCapacity(undefined, probes({ memAvailableMb: () => 10_239 })))
  assert.equal(v.canSpawn, false)
  assert.equal(v.maxParallel, 0)
  assert.ok(v.reasons.some((r) => MEM.test(r)), `a reason must name memory; got ${JSON.stringify(v.reasons)}`)
  assert.deepEqual(v.degraded, [], 'every probe answered — nothing is degraded')

  // ONLY memory binds: load and the executor cap are wide open on this fixture.
  const mem = signal(v, MEM)
  assert.ok(mem, `a memory signal row must exist; got signals: ${names(v)}`)
  assert.equal(mem.ok, false)
  assert.equal(mem.value, 10_239, 'the memory row reports the PROBED value, not a recomputation')
  assert.equal(mem.limit, 10_240, 'the memory limit is minFreeMemMb + memPerExecutorMb')
  assert.equal(signal(v, LOAD).ok, true, 'load is clear on this fixture — a blanket false hides the real cause')
  assert.equal(signal(v, EXEC).ok, true, 'the executor cap is clear on this fixture')

  // EXACTLY at the boundary the spawn is admitted — one MB is the whole difference.
  const edge = verdict(probeCapacity(undefined, probes({ memAvailableMb: () => 10_240 })))
  assert.equal(edge.canSpawn, true, '10240 MB fits exactly one executor: the bound is >=, not >')
  assert.equal(edge.maxParallel, 1)
  assert.equal(signal(edge, MEM).ok, true)

  // Below minFreeMemMb the raw slot count goes NEGATIVE — it must clamp, never underflow.
  const starved = verdict(probeCapacity(undefined, probes({ memAvailableMb: () => 1_000 })))
  assert.equal(starved.maxParallel, 0, 'memSlots of -1 clamps to 0')
  assert.equal(starved.canSpawn, false)
})

// ── 2. load-bound ──────────────────────────────────────────────────────────────────────
test('probeCapacity — load-bound: too little core headroom vs the 1-min load refuses and names load', () => {
  // 16 cores, load1 14.5 => headroom 1.5, loadPerExecutor 2 => floor(0.75) = 0 slots.
  const v = verdict(probeCapacity(undefined, probes({ load: () => ({ load1: 14.5, cores: 16 }) })))
  assert.equal(v.canSpawn, false)
  assert.equal(v.maxParallel, 0)
  assert.ok(v.reasons.some((r) => LOAD.test(r)), `a reason must name load; got ${JSON.stringify(v.reasons)}`)
  assert.deepEqual(v.degraded, [])

  const load = signal(v, LOAD)
  assert.ok(load, `a load signal row must exist; got signals: ${names(v)}`)
  assert.equal(load.ok, false)
  assert.equal(load.value, 14.5, 'the load row reports the PROBED 1-min load')
  assert.equal(signal(v, MEM).ok, true, 'memory is clear on this fixture')
  assert.equal(signal(v, EXEC).ok, true, 'the executor cap is clear on this fixture')

  // EXACTLY at the boundary: headroom 2.0 with loadPerExecutor 2 is one whole slot.
  const edge = verdict(probeCapacity(undefined, probes({ load: () => ({ load1: 14, cores: 16 }) })))
  assert.equal(edge.canSpawn, true, 'headroom == loadPerExecutor admits exactly one executor')
  assert.equal(edge.maxParallel, 1)
  assert.equal(signal(edge, LOAD).ok, true)

  // load1 ABOVE cores would make headroom negative — max(0, ...) keeps the count at zero.
  const thrashing = verdict(probeCapacity(undefined, probes({ load: () => ({ load1: 40, cores: 16 }) })))
  assert.equal(thrashing.maxParallel, 0)
  assert.equal(thrashing.canSpawn, false)
})

// ── 3. busy-bound ──────────────────────────────────────────────────────────────────────
test('probeCapacity — busy-bound: capbuild units + live arms at maxExecutors refuses and names the executor cap', () => {
  // busy = 2 capbuild units + 1 live arm = 3 = the default maxExecutors.
  const v = verdict(
    probeCapacity(undefined, probes({ runningCapbuildUnits: () => 2, liveExecutorArms: () => 1 })),
  )
  assert.equal(v.canSpawn, false)
  assert.equal(v.maxParallel, 0)
  assert.ok(
    v.reasons.some((r) => EXEC.test(r)),
    `a reason must name the executor cap; got ${JSON.stringify(v.reasons)}`,
  )
  assert.deepEqual(v.degraded, [])

  const busy = signal(v, EXEC)
  assert.ok(busy, `an executor-cap signal row must exist; got signals: ${names(v)}`)
  assert.equal(busy.ok, false)
  assert.equal(busy.value, 3, 'the executor row counts capbuild units AND live arms — both, summed')
  assert.equal(busy.limit, 3, 'the executor limit is maxExecutors')
  assert.equal(signal(v, MEM).ok, true, 'memory is clear on this fixture')
  assert.equal(signal(v, LOAD).ok, true, 'load is clear on this fixture')

  // ONE below the cap still admits exactly one spawn.
  const edge = verdict(
    probeCapacity(undefined, probes({ runningCapbuildUnits: () => 1, liveExecutorArms: () => 1 })),
  )
  assert.equal(edge.canSpawn, true, 'busy 2 of 3 leaves one slot: the bound is >=, not >')
  assert.equal(edge.maxParallel, 1)

  // An arm ALONE counts — dropping either half of busy is the regression this pins.
  const armsOnly = verdict(probeCapacity(undefined, probes({ liveExecutorArms: () => 3 })))
  assert.equal(armsOnly.canSpawn, false, 'three live arms and zero capbuild units is still at the cap')
  const unitsOnly = verdict(probeCapacity(undefined, probes({ runningCapbuildUnits: () => 3 })))
  assert.equal(unitsOnly.canSpawn, false, 'three capbuild units and zero arms is still at the cap')
})

// ── 4. all-clear ───────────────────────────────────────────────────────────────────────
test('probeCapacity — all-clear: a generous box spawns, maxParallel is the TIGHTEST slot count', () => {
  const v = verdict(probeCapacity(undefined, probes()))
  assert.equal(v.canSpawn, true)
  assert.equal(v.maxParallel, 3, 'memSlots 31, loadSlots 32, maxExecutors-busy 3 => the executor cap binds at 3')
  assert.deepEqual(v.degraded, [], 'every probe answered')
  assert.ok(v.signals.length >= 3, `all three live signals are reported even when clear; got: ${names(v)}`)
  assert.ok(v.signals.every((s) => s.ok), `no signal is failing on a generous box: ${JSON.stringify(v.signals)}`)
  assert.deepEqual(
    v.reasons,
    [],
    'nothing binds and nothing is degraded => NO reason lines: 11.4 joins reasons into the blocked ' +
      'message, so an informational line here becomes a fabricated "box at capacity" refusal',
  )

  // maxParallel is a MIN across signals, not the executor cap alone: squeeze memory to 2 slots.
  const memTight = verdict(probeCapacity(undefined, probes({ memAvailableMb: () => 16_384 })))
  assert.equal(memTight.maxParallel, 2, 'floor((16384-4096)/6144) = 2 is tighter than the cap of 3')
  assert.equal(memTight.canSpawn, true)

  // ...and load can be the tightest of the three.
  const loadTight = verdict(probeCapacity(undefined, probes({ load: () => ({ load1: 12, cores: 16 }) })))
  assert.equal(loadTight.maxParallel, 2, 'floor((16-12)/2) = 2 is tighter than the cap of 3')
  assert.equal(loadTight.canSpawn, true)
})

// ── 5. degraded fail-open ──────────────────────────────────────────────────────────────
test('probeCapacity — degraded fail-open: a THROWING probe never blocks a spawn and names the gap', () => {
  const v = verdict(
    probeCapacity(undefined, probes({ memAvailableMb: unreadable('ENOENT /proc/meminfo') })),
  )
  assert.equal(v.canSpawn, true, 'FAIL OPEN — missing evidence is not evidence of starvation')
  assert.ok(
    v.degraded.some((d) => MEM.test(d)),
    `the unreadable signal is named in degraded[]; got ${JSON.stringify(v.degraded)}`,
  )
  assert.ok(
    v.reasons.some((r) => MEM.test(r)),
    `a reasons line names the gap — a silent degrade is an unexplained verdict; got ${JSON.stringify(v.reasons)}`,
  )
  assert.equal(
    v.maxParallel,
    3,
    'a degraded signal contributes NOTHING to the min — it is dropped, never counted as zero slots',
  )

  // Any probe may be unavailable; each one degrades by name, on its own.
  const noSystemd = verdict(
    probeCapacity(undefined, probes({ runningCapbuildUnits: unreadable('systemctl not found') })),
  )
  assert.equal(noSystemd.canSpawn, true)
  assert.ok(noSystemd.degraded.some((d) => EXEC.test(d) || /capbuild/i.test(d)), `got ${noSystemd.degraded}`)
  const noLoad = verdict(probeCapacity(undefined, probes({ load: unreadable('no /proc/loadavg') })))
  assert.equal(noLoad.canSpawn, true)
  assert.ok(noLoad.degraded.some((d) => LOAD.test(d)), `got ${noLoad.degraded}`)

  // EVERY probe unavailable (a non-Linux consumer): still open, still fully explained.
  const blind = verdict(
    probeCapacity(undefined, {
      memAvailableMb: unreadable('no /proc'),
      load: unreadable('no /proc'),
      runningCapbuildUnits: unreadable('no systemctl'),
      liveExecutorArms: unreadable('no registry'),
    }),
  )
  assert.equal(blind.canSpawn, true, 'a host with zero readable signals must never be blocked')
  assert.ok(blind.maxParallel >= 1, 'fail open means a usable slot count, not canSpawn true with 0 slots')
  assert.ok(blind.degraded.length >= 3, `every unreadable signal is named; got ${JSON.stringify(blind.degraded)}`)

  // FAIL-OPEN IS NOT A BYPASS: a degraded probe alongside REAL starvation still refuses.
  const halfBlind = verdict(
    probeCapacity(
      undefined,
      probes({ memAvailableMb: unreadable('ENOENT /proc/meminfo'), liveExecutorArms: () => 3 }),
    ),
  )
  assert.equal(halfBlind.canSpawn, false, 'the executor cap is hard EVIDENCE — a degraded sibling cannot excuse it')
  assert.equal(halfBlind.maxParallel, 0)
  assert.ok(halfBlind.reasons.some((r) => EXEC.test(r)), `got ${JSON.stringify(halfBlind.reasons)}`)
  assert.ok(halfBlind.degraded.some((d) => MEM.test(d)), 'the gap is still reported alongside the refusal')
})

// ── 6. config-override precedence ──────────────────────────────────────────────────────
test('probeCapacity — config precedence: an explicit capacity block overrides the defaults on the SAME fixture', () => {
  // ONE live arm: fine under the default cap of 3, starved under an explicit cap of 1.
  const oneBusy = probes({ liveExecutorArms: () => 1 })
  const byDefault = verdict(probeCapacity(undefined, oneBusy))
  assert.equal(byDefault.canSpawn, true, 'baseline: defaults admit a spawn on this fixture')
  assert.equal(byDefault.maxParallel, 2)

  const capped = verdict(probeCapacity({ maxExecutors: 1 }, oneBusy))
  assert.equal(capped.canSpawn, false, 'the SAME fixture flips under an explicit maxExecutors of 1')
  assert.equal(capped.maxParallel, 0)
  assert.equal(signal(capped, EXEC).limit, 1, 'the signal row reports the CONFIGURED limit, not the default')
  assert.ok(capped.reasons.some((r) => EXEC.test(r)), `got ${JSON.stringify(capped.reasons)}`)

  // memPerExecutorMb: 10240 MB fits one 6144 executor, none of an 8192 one.
  const tenGig = probes({ memAvailableMb: () => 10_240 })
  assert.equal(verdict(probeCapacity(undefined, tenGig)).canSpawn, true)
  const bigger = verdict(probeCapacity({ memPerExecutorMb: 8192 }, tenGig))
  assert.equal(bigger.canSpawn, false, 'a bigger per-executor reservation starves the same box')
  assert.equal(signal(bigger, MEM).limit, 4096 + 8192, 'limit tracks the configured reservation + default minFree')

  // minFreeMemMb: raise the reserve on that same 10240 MB box.
  const reserved = verdict(probeCapacity({ minFreeMemMb: 8192 }, tenGig))
  assert.equal(reserved.canSpawn, false, 'a bigger free-memory floor starves the same box')
  assert.equal(signal(reserved, MEM).limit, 8192 + 6144)

  // loadPerExecutor: headroom 2 is one slot by default, none at 4 per executor.
  const headroom2 = probes({ load: () => ({ load1: 14, cores: 16 }) })
  assert.equal(verdict(probeCapacity(undefined, headroom2)).canSpawn, true)
  assert.equal(
    verdict(probeCapacity({ loadPerExecutor: 4 }, headroom2)).canSpawn,
    false,
    'a heavier per-executor load budget starves the same box',
  )

  // An EMPTY block is the absent block: defaults verbatim, no partial-zeroing.
  assert.deepEqual(
    verdict(probeCapacity({}, oneBusy)),
    byDefault,
    'an empty capacity block must be byte-identical to an absent one',
  )
})

// ── invariants that ride every verdict ─────────────────────────────────────────────────
test('probeCapacity — a PARTIAL capacity block keeps every untouched default', () => {
  // Only maxExecutors is set; the memory defaults (4096 + 6144) must still bind at 10239 MB.
  const v = verdict(probeCapacity({ maxExecutors: 5 }, probes({ memAvailableMb: () => 10_239 })))
  assert.equal(v.canSpawn, false, 'a partial block must not blank out memPerExecutorMb/minFreeMemMb')
  assert.ok(v.reasons.some((r) => MEM.test(r)), `got ${JSON.stringify(v.reasons)}`)
  assert.equal(signal(v, MEM).limit, 10_240, 'the untouched memory defaults survive verbatim')
  // ...and the one key that WAS set is honored: 4 busy of 5 leaves a slot the default cap would deny.
  const roomier = verdict(probeCapacity({ maxExecutors: 5 }, probes({ liveExecutorArms: () => 4 })))
  assert.equal(roomier.canSpawn, true)
  assert.equal(roomier.maxParallel, 1)
  assert.equal(verdict(probeCapacity(undefined, probes({ liveExecutorArms: () => 4 }))).canSpawn, false)
})

test('CapacityVerdictShape — REFUSES a malformed verdict (the shape is a gate, not a rubber stamp)', () => {
  const ok = {
    canSpawn: true,
    maxParallel: 2,
    signals: [{ name: 'memory', value: 200000, limit: 10240, ok: true }],
    reasons: [],
    degraded: [],
  }
  assert.doesNotThrow(() => CapacityVerdictShape.parse(ok))
  const bad = [
    [{ ...ok, canSpawn: 'yes' }, 'canSpawn must be a boolean, never a truthy string'],
    [{ ...ok, maxParallel: -1 }, 'maxParallel is >= 0 — a negative slot count is an underflowed min'],
    [{ ...ok, maxParallel: 1.5 }, 'maxParallel is an integer — half an executor cannot spawn'],
    [{ ...ok, reasons: 'memory low' }, 'reasons is an ARRAY of lines, never one blob'],
    [{ ...ok, degraded: [1] }, 'degraded holds signal NAMES'],
    [{ ...ok, signals: [{ name: 'memory', value: 1, limit: 2 }] }, 'a signal without ok is unreadable'],
    [{ ...ok, signals: [{ value: 1, limit: 2, ok: true }] }, 'an UNNAMED signal cannot be reasoned about'],
    [{ ...ok, signals: [{ name: 'memory', value: '1', limit: 2, ok: true }] }, 'signal values are numbers'],
  ]
  for (const [v, why] of bad) {
    assert.throws(() => CapacityVerdictShape.parse(v), `${why}: ${JSON.stringify(v)}`)
  }
})

test('probeCapacity — defaultProbes reads the LIVE box: a shape-valid verdict, never a throw', () => {
  // The only host-touching case. It asserts nothing about this box's mood (that would be flaky) —
  // it pins that the real readers are wired, and that an unreadable one degrades instead of throwing.
  const v = verdict(probeCapacity())
  assert.ok(Array.isArray(v.signals))
  const explicit = verdict(probeCapacity(undefined, defaultProbes))
  assert.equal(typeof explicit.canSpawn, 'boolean', 'defaultProbes is the exported default, usable by name')
})
