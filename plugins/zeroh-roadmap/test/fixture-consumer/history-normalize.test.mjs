#!/usr/bin/env node
/** Command-level conformance for six-phase history normalization and published correction recovery. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { arcFixture, appendReviewedCorrection, publishedDelivery } from './history-fixture.mjs'
import { git } from './harness.mjs'
import { normalizeArc, planHistoryNormalization } from '../../cli/lib/history-normalize.mjs'
import { ensureCurationRescue, prepareCuration, commitPreparedCuration } from '../../cli/lib/curate.mjs'

const unpublished = (head) => ({ head, publication: 'unpublished', pullRequest: null, green: false, publicationRefs: [] })
const deps = (extra = {}) => ({ inspectDelivery: ({ head }) => unpublished(head), ...extra })

function assertSixOutcomes(fixture, result) {
  assert.equal(git(fixture.root, 'rev-list', '--count', `${fixture.base}..HEAD`), '6')
  assert.equal(git(fixture.root, 'rev-parse', 'HEAD^{tree}'), git(fixture.root, 'rev-parse', `${fixture.head}^{tree}`))
  assert.deepEqual(result.outcomes.map((row) => row.phase), fixture.phases)
  for (const [index, row] of result.outcomes.entries()) {
    assert.equal(row.sourceTree, fixture.expected[index].tree)
    assert.equal(git(fixture.root, 'rev-parse', `${row.normalizedCommit}^{tree}`), row.sourceTree)
    assert.equal(git(fixture.root, 'rev-parse', `${row.normalizedCommit}^`), index ? result.outcomes[index - 1].normalizedCommit : fixture.base)
  }
}

test('six-phase command resumes a persisted post-CAS plan into the same six outcomes without rewriting commits', () => {
  const fixture = arcFixture(); let prepared
  assert.throws(() => normalizeArc(fixture.root, fixture.arcId, { apply: true }, deps({ afterCas(value) { prepared = value; throw new Error('crash-after-cas') } })), /crash-after-cas/)
  assert.equal(git(fixture.root, 'rev-parse', 'HEAD'), prepared.newHead)
  assert.equal(git(fixture.root, 'rev-parse', `${prepared.rescueRef}^{commit}`), fixture.head)
  const resumed = normalizeArc(fixture.root, fixture.arcId, { apply: true }, deps())
  assertSixOutcomes(fixture, resumed)
  assert.equal(resumed.newHead, prepared.newHead)
  assert.equal(normalizeArc(fixture.root, fixture.arcId, { apply: true }, deps()).newHead, prepared.newHead)
})

test('curation primitives refuse a prepared CAS race, an immutable rescue collision, and a missing terminal tree', () => {
  {
    const fixture = arcFixture(); const plan = planHistoryNormalization(fixture.root, { arcId: fixture.arcId, base: fixture.base, head: fixture.head }, deps())
    ensureCurationRescue(fixture.root, plan.expectedHead); const prepared = prepareCuration(fixture.root, plan)
    const competitor = git(fixture.root, 'commit-tree', plan.expectedTree, '-p', fixture.head, '-m', 'concurrent ref advance')
    git(fixture.root, 'update-ref', 'refs/heads/feature/history', competitor, fixture.head)
    assert.throws(() => commitPreparedCuration(fixture.root, prepared))
    assert.equal(git(fixture.root, 'rev-parse', 'HEAD'), competitor)
    assert.equal(git(fixture.root, 'rev-parse', `${prepared.rescueRef}^{commit}`), fixture.head)
  }
  {
    const fixture = arcFixture(); const ref = `refs/curate-rescue/${fixture.head.slice(0, 12)}`
    git(fixture.root, 'update-ref', ref, fixture.base)
    assert.throws(() => ensureCurationRescue(fixture.root, fixture.head), /collision/)
    assert.equal(git(fixture.root, 'rev-parse', ref), fixture.base)
  }
  {
    const fixture = arcFixture(); const plan = planHistoryNormalization(fixture.root, { arcId: fixture.arcId, base: fixture.base, head: fixture.head }, deps())
    const before = git(fixture.root, 'rev-parse', 'HEAD')
    assert.throws(() => prepareCuration(fixture.root, { ...plan, groups: plan.groups.slice(0, -1) }), /tree differs/)
    assert.equal(git(fixture.root, 'rev-parse', 'HEAD'), before)
  }
})

test('three reviewed mixed-phase corrections become one neutral leased tail and push replay is idempotent', () => {
  const fixture = arcFixture(); normalizeArc(fixture.root, fixture.arcId, { apply: true }, deps())
  const publishedHead = git(fixture.root, 'rev-parse', 'HEAD'); let observed
  for (const count of [1, 2, 3]) observed = publishedDelivery(fixture.root, appendReviewedCorrection(fixture, count, fixture.phases.at(-4 + count), publishedHead), publishedHead)
  let pushes = 0
  const live = () => ({ ...observed, head: git(fixture.root, 'rev-parse', 'HEAD') })
  const applied = normalizeArc(fixture.root, fixture.arcId, { apply: true }, { inspectDelivery: live, replacePublishedHead(call) { pushes++; git(fixture.root, 'update-ref', call.ref, call.newHead, call.expectedOld); return { ref: call.ref, head: call.newHead } } })
  assert.equal(applied.status, 'published-rewrite-applied'); assert.equal(pushes, 1)
  assert.equal(git(fixture.root, 'rev-list', '--count', `${fixture.base}..HEAD`), '7')
  const message = git(fixture.root, 'show', '-s', '--format=%s%n%n%b', 'HEAD')
  assert.doesNotMatch(message.split('\n')[0], /phase 400[456]/)
  for (const phase of fixture.phases.slice(-3)) assert.match(message, new RegExp(String(phase)))
  const settled = { ...observed, head: applied.newHead, pullRequest: { ...observed.pullRequest, head: applied.newHead }, checks: { head: applied.newHead, state: 'red' } }
  assert.equal(normalizeArc(fixture.root, fixture.arcId, { apply: true }, { inspectDelivery: () => settled, replacePublishedHead() { pushes++ } }).status, 'already-applied')
  assert.equal(pushes, 1)
})

test('green published corrections never rewrite or invoke the lease seam', () => {
  const fixture = arcFixture(); normalizeArc(fixture.root, fixture.arcId, { apply: true }, deps())
  const publishedHead = git(fixture.root, 'rev-parse', 'HEAD'); let observed
  for (const count of [1, 2, 3]) observed = publishedDelivery(fixture.root, appendReviewedCorrection(fixture, count, fixture.phases.at(-4 + count), publishedHead), publishedHead)
  observed = { ...observed, green: true, checks: { head: publishedHead, state: 'green' } }; let pushes = 0
  const before = git(fixture.root, 'rev-parse', 'HEAD')
  assert.throws(() => normalizeArc(fixture.root, fixture.arcId, { apply: true }, { inspectDelivery: ({ head }) => ({ ...observed, head }), replacePublishedHead(call) { pushes++; git(fixture.root, 'update-ref', call.ref, call.newHead, call.expectedOld); return { ref: call.ref, head: call.newHead } } }), (error) => error.kind === 'green')
  assert.equal(git(fixture.root, 'rev-parse', 'HEAD'), before); assert.equal(pushes, 0)
})

test('non-red published checks cannot authorize the third-correction lease even with valid ownership evidence', () => {
  const fixture = arcFixture(); normalizeArc(fixture.root, fixture.arcId, { apply: true }, deps())
  const publishedHead = git(fixture.root, 'rev-parse', 'HEAD'); let observed
  for (const count of [1, 2, 3]) observed = publishedDelivery(fixture.root, appendReviewedCorrection(fixture, count, fixture.phases.at(-4 + count), publishedHead), publishedHead)
  observed = { ...observed, checks: { head: publishedHead, state: 'pending' } }; let pushes = 0
  const before = git(fixture.root, 'rev-parse', 'HEAD')
  assert.throws(() => normalizeArc(fixture.root, fixture.arcId, { apply: true }, { inspectDelivery: ({ head }) => ({ ...observed, head }), replacePublishedHead(call) { pushes++; git(fixture.root, 'update-ref', call.ref, call.newHead, call.expectedOld); return { ref: call.ref, head: call.newHead } } }), (error) => error.kind === 'correction-unproven')
  assert.equal(git(fixture.root, 'rev-parse', 'HEAD'), before); assert.equal(pushes, 0)
})
