#!/usr/bin/env node
/**
 * orphan-sweep.test.mjs — the attribution rule (dead vs recycled vs live invoker)
 * and the sweep's never-throw / never-touch-live-runs contract. All deps injected;
 * no systemd host required. Run: node --test cli/lib/orphan-sweep.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findOrphanCapbuildUnits, sweepOrphanCapbuildUnits } from './orphan-sweep.mjs'

const cmdlines = {
  100: 'bash /home/u/.local/bin/capbuild node --test a.test.ts', // live invoker
  200: null, // dead invoker
  300: 'node /some/unrelated/daemon.js', // PID recycled by a non-capbuild process
}
const readCmdline = (pid) => cmdlines[pid] ?? null

test('findOrphanCapbuildUnits: dead and recycled invokers are orphans, live is not', () => {
  const orphans = findOrphanCapbuildUnits(
    ['capbuild-100.service', 'capbuild-200.service', 'capbuild-300.service'],
    readCmdline,
  )
  assert.deepEqual(orphans, ['capbuild-200.service', 'capbuild-300.service'])
})

test('findOrphanCapbuildUnits: malformed unit names are ignored, never stopped', () => {
  assert.deepEqual(findOrphanCapbuildUnits(['capbuild-.service', 'weird.service'], readCmdline), [])
})

test('sweepOrphanCapbuildUnits: stops exactly the orphans and reports them', () => {
  const stops = []
  const { stopped } = sweepOrphanCapbuildUnits({
    listUnits: () => ['capbuild-100.service', 'capbuild-200.service'],
    readCmdline,
    stopUnit: (u) => stops.push(u),
    log: () => {},
  })
  assert.deepEqual(stops, ['capbuild-200.service'])
  assert.deepEqual(stopped, ['capbuild-200.service'])
})

test('sweepOrphanCapbuildUnits: a stop failure is logged, not thrown, and the rest still sweep', () => {
  const stops = []
  const logs = []
  const { stopped } = sweepOrphanCapbuildUnits({
    listUnits: () => ['capbuild-200.service', 'capbuild-300.service'],
    readCmdline,
    stopUnit: (u) => {
      if (u === 'capbuild-200.service') throw new Error('busy')
      stops.push(u)
    },
    log: (m) => logs.push(m),
  })
  assert.deepEqual(stopped, ['capbuild-300.service'])
  assert.ok(logs.some((m) => m.includes('could not stop capbuild-200.service')))
})

test('sweepOrphanCapbuildUnits: a listUnits failure is a silent no-op (never blocks the suite)', () => {
  const { stopped } = sweepOrphanCapbuildUnits({
    listUnits: () => {
      throw new Error('no systemd here')
    },
    readCmdline,
    stopUnit: () => assert.fail('must not stop anything'),
    log: () => {},
  })
  assert.deepEqual(stopped, [])
})
