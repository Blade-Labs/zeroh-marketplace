import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { makeFixtureRepo, writeArcFile, writePhaseFile, commitAll, git } from './harness.mjs'
import { writeReport } from '../../cli/lib/gate-report.mjs'

export function arcFixture() {
  const root = makeFixtureRepo()
  cpSync(new URL('../../templates/registry.ts', import.meta.url), join(root, 'lib', 'roadmap', 'registry.ts'))
  git(root, 'config', 'user.email', 'history@test'); git(root, 'config', 'user.name', 'history fixture')
  const arcId = 'HISTORY'; const phases = [4001, 4002, 4003, 4004, 4005, 4006]
  writeArcFile(root, { id: arcId, name: 'History normalization fixture', baseRef: 'develop', planes: [{ name: 'delivery', phases }] })
  for (const phase of phases) writePhaseFile(root, {
    phase, arcId, status: 'done', name: `History phase ${phase}`, category: 'test', kind: 'logic', source: 'fixture-consumer', priority: 'LOW',
    dependsOn: [], conflictsWith: [], keyFiles: [`src/history-${phase}.txt`], stakeholderDemo: `phase ${phase} is represented once`,
    tasks: [{ minimal: true, id: `${phase}.1`, title: `deliver phase ${phase}`, done: true, transparencyReport: { whatWasDone: `delivered ${phase}`, how: 'fixture commit', compromises: 'None', skipped: 'None', hardcoded: 'None', limitations: 'None' } }],
    gate: { lint: 'clean', typeCheck: 'clean', unitTests: { passed: 1, total: 1 }, integrationTests: { passed: 1, total: 1 }, e2eTests: { passed: 0, total: 0, skipped: 0 }, build: 'clean' },
    gateRounds: [{ round: 1, agent: 'code-reviewer', model: 'test-reviewer', verdict: 'clean', findings: [], summary: 'independent fixture review clean' }],
    metrics: { commits: 1, linesAdded: 1, linesRemoved: 0, filesChanged: 1, testsAtStart: 1, testsAtEnd: 1, testsAdded: 0 },
    completedDate: '2026-09-07',
    executionResult: { phase, status: 'done', gateRounds: 1, hardStops: [] },
  }, { kind: 'define' })
  commitAll(root, 'seed: typed six-phase arc'); const base = git(root, 'rev-parse', 'HEAD')
  git(root, 'checkout', '-q', '-b', 'feature/history')
  const expected = []
  for (const [index, phase] of phases.entries()) {
    const commits = []
    const commit = (subject, suffix) => {
      const path = join(root, 'src', `history-${phase}-${suffix}.txt`); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, subject + '\n')
      git(root, 'add', path); git(root, 'commit', '-q', '-m', subject); const sha = git(root, 'rev-parse', 'HEAD'); commits.push(sha); return sha
    }
    commit(`docs(roadmap): phase ${phase} — move to in-progress`, 'state')
    const task = commit(index === 2 ? `feat(history): deliver phase (${phase}.1)` : `feat(history): phase ${phase} — ${phase}.1 deliver phase`, 'task')
    let reviewSha = task
    for (let round = 0; round < index % 3; round++) reviewSha = commit(`fix(history): phase ${phase} gate R${round} — review findings`, `gate-${round}`)
    commit(`docs(roadmap): phase ${phase} — record transparency report`, 'done')
    if (index === phases.length - 1) reviewSha = commit(`fix(history): phase ${phase} gate R2 — trailing findings`, 'trailing')
    expected.push({ phase, commits, reviewSha, boundary: git(root, 'rev-parse', 'HEAD'), tree: git(root, 'rev-parse', 'HEAD^{tree}') })
  }
  const head = git(root, 'rev-parse', 'HEAD')
  for (const row of expected) writeReport(root, {
    phase: row.phase, startedAt: '2026-09-07T06:00:00.000Z', baseSha: base, mode: 'phase', kind: 'logic',
    testScope: { derived: 'relevant', declared: null, effective: 'relevant' }, reviewScope: { derived: 'full', declared: null, effective: 'full' },
    slots: [{ slot: 'types', command: 'test', exitCode: 0, durationMs: 1, logPath: null }],
    agents: [{ round: 1, agent: 'code-reviewer', verdict: 'clean', summary: 'clean', sha: row.reviewSha, recordedAt: '2026-09-07T06:01:00.000Z' }], green: true, notes: [],
  })
  return { root, arcId, phases, base, head, expected }
}


function latestGatePath(root, phase) {
  const dir = join(root, 'roadmap', '.gate', String(phase))
  return join(dir, readdirSync(dir).filter((name) => name.endsWith('.json')).sort().at(-1))
}
export function appendReviewedCorrection(fixture, round, phase = fixture.phases.at(-1)) { const path = join(fixture.root, 'src', `published-correction-${round}.txt`)
  writeFileSync(path, `correction ${round}\n`); git(fixture.root, 'add', path)
  git(fixture.root, 'commit', '-q', '-m', `fix(history): phase ${phase} gate R${round} — published correction`)
  const head = git(fixture.root, 'rev-parse', 'HEAD'); const gatePath = latestGatePath(fixture.root, phase)
  const report = JSON.parse(readFileSync(gatePath, 'utf8'))
  report.agents = [{ round: 1, agent: 'code-reviewer', verdict: 'clean', summary: `correction ${round} reviewed`, sha: head, recordedAt: '2026-09-07T07:00:00.000Z' }]
  writeFileSync(gatePath, JSON.stringify(report, null, 2) + '\n')
  return head
}
export function publishedDelivery(root, localHead, publishedHead, overrides = {}) {
  const ref = 'refs/remotes/origin/feature/history'; git(root, 'update-ref', ref, publishedHead)
  return { head: localHead, publication: 'published', pullRequest: { head: publishedHead, ref }, green: false, checks: { head: publishedHead, state: 'red' }, correction: { classification: 'causal', pushRequired: true }, publicationRefs: [ref], ...overrides }
}

