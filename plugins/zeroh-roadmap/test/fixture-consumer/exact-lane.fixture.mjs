import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Test-only exact lane launcher. The caller owns repo/config/phase setup and supplies the real CLI invocation. */
export async function launchCompletedExactLane({ root, lane, id, worktree, invoke, authorPlan = true, reviewDoc = null }) {
  const journalPath = join(root, '.building', `codex-${lane}-${id}.json`)
  if (!existsSync(journalPath)) execFileSync('git', ['-C', root, 'worktree', 'add', '-q', ...(lane === 'review' ? ['--detach'] : ['-b', `codex-${lane}/${id}`]), worktree, 'develop'])
  const fakeBin = join(root, `fakebin-complete-${lane}`)
  mkdirSync(fakeBin, { recursive: true })
  const reportName = lane === 'plan' ? 'CODEX-PLAN.md' : 'CODEX-REVIEW.md'
  const planAct = lane === 'plan' && authorPlan
    ? `mkdir -p roadmap/phases\nprintf 'export default { id: ${id}, tasks: [] }\\n' > roadmap/phases/phase-${id}.phase.ts\ngit add roadmap/phases/phase-${id}.phase.ts\ngit -c user.email=t@t -c user.name=t commit -qm authored-plan\n`
    : ''
  writeFileSync(join(fakeBin, 'codex'), `#!/bin/sh\nset -eu\n${planAct}printf 'verified ${lane} ${id}\\nCODEX-RUN-COMPLETE\\n' > ${reportName}\n`)
  chmodSync(join(fakeBin, 'codex'), 0o755)
  const extras = lane === 'plan' ? ['--brief', reviewDoc] : reviewDoc ? ['--doc', reviewDoc] : []
  const launched = invoke([lane, String(id), ...extras, '--worktree', worktree, '--base', 'develop'], { PATH: `${fakeBin}:${process.env.PATH}` })
  assert.equal(launched.code ?? launched.status, 0, `${lane}: ${launched.stderr ?? ''}`)
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const journal = JSON.parse(readFileSync(journalPath, 'utf8'))
    if (journal.completionFingerprint) return { root, worktree, journalPath, journal, reportName, reportPath: join(worktree, reportName) }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.fail(`${lane}: supervisor did not stamp completion after native exit`)
}
