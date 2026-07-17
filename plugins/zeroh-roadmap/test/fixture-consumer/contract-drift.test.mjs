#!/usr/bin/env node
/**
 * contract-drift.test.mjs — the generated-JSON-Schema ↔ Zod agreement check (arc ROADCODE
 * 1660.6, D1; risk 3 executor-contract split-brain). The workflow's agent() schemas are
 * GENERATED via `roadmap contract show --json-schema`; the CLI/hook validate through the
 * consumer's Zod shape via `roadmap result check`. If those two ever drift, a result could
 * pass one validator and fail the other. This suite validates the SAME fixture table through
 * BOTH — ajv over the generated schema AND `roadmap result check` (Zod via tsx) — and asserts
 * PER-FIXTURE agreement, never schema-text equality. Run: node --test contract-drift.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import Ajv2020 from 'ajv/dist/2020.js'
import { makeFixtureRepo, runCli } from './harness.mjs'

// ≥3 accepts spanning all three result statuses + ≥4 rejects (distinct invalid shapes).
const CANDIDATES = [
  { name: 'accept: done with empty debt arrays', expect: true, value: { phase: 1, status: 'done', gateRounds: 2, compromises: [], skipped: [], hardcoded: [], surfaced: [], hardStops: [] } },
  { name: 'accept: escalated with an escalation block', expect: true, value: { phase: 2, status: 'escalated', gateRounds: 0, escalation: { question: 'which option is right here?', options: ['A', 'B'] }, compromises: [], skipped: [], hardcoded: [], surfaced: [], hardStops: [] } },
  { name: 'accept: failed with populated arrays', expect: true, value: { phase: 3, status: 'failed', gateRounds: 1, compromises: ['a real compromise text here'], skipped: ['a real skipped criterion here'], hardcoded: ['a real hardcoded value here'], surfaced: ['a real surfaced item here'], hardStops: [{ tag: '[MULTI-REPO]', text: 'a real hardstop text here' }] } },
  { name: 'reject: missing status', expect: false, value: { phase: 4, gateRounds: 1 } },
  { name: 'reject: wrong enum member', expect: false, value: { phase: 5, status: 'DONE', gateRounds: 1 } },
  { name: 'reject: surfaced a string not an array', expect: false, value: { phase: 6, status: 'done', gateRounds: 1, surfaced: 'oops not an array' } },
  { name: 'reject: gateRounds wrong type', expect: false, value: { phase: 7, status: 'done', gateRounds: 'two' } },
]

test('D1 — every fixture gets the SAME verdict from ajv(generated schema) and Zod(result check)', () => {
  const root = makeFixtureRepo()
  const shown = runCli(root, ['contract', 'show', '--json-schema'])
  assert.equal(shown.code, 0, `contract show failed:\n${shown.stderr}`)
  const schema = JSON.parse(shown.stdout)
  const ajv = new Ajv2020({ strict: false, allErrors: true })
  const validate = ajv.compile(schema)

  for (const c of CANDIDATES) {
    const ajvOk = validate(c.value)
    const rc = runCli(root, ['result', 'check'], {}, { input: JSON.stringify(c.value) })
    const zodOk = rc.code === 0
    assert.equal(ajvOk, zodOk, `${c.name}: ajv=${ajvOk} but Zod=${zodOk} — the generated schema DRIFTED from the Zod shape`)
    assert.equal(zodOk, c.expect, `${c.name}: expected ${c.expect ? 'accept' : 'reject'}, got ${zodOk ? 'accept' : 'reject'}`)
  }
})
