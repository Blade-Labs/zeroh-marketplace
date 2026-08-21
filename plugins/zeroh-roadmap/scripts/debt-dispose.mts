#!/usr/bin/env node
/**
 * debt-dispose — write debtResolutions entries into phase files from a worklist.
 *
 * The mechanical half of an estate debt sweep: debt-census.mts derives the
 * ledger, a human/agent pass decides dispositions, this script lands them.
 * It NEVER touches transparency reports (debt content is immutable) — it only
 * appends `{ ref, status, note }` entries to each phase's `debtResolutions`.
 *
 * Worklist JSON: [{ "phase": 123, "ref": "123.4.limitations",
 *                   "status": "dismissed", "via": "...", "date": "2026-07-11" }, ...]
 * status ∈ fixed | won't_fix | dismissed | planned | operator-pending
 * (schema: `date` is REQUIRED (ISO yyyy-mm-dd); `via` required ≥7 chars for
 * fixed (commit/phase ref) and ≥20 chars for won't_fix (substantive reason),
 * optional otherwise).
 *
 * Safety rails:
 *   - refuses a worklist entry whose phase file has status 'in-progress'
 *     (another session may own it — shared-tree rule) unless --allow-in-progress
 *   - skips a (phase, ref) that already has ANY resolution entry (latest-wins
 *     re-disposition is a deliberate act — do it by hand, not in bulk)
 *   - prints the exact modified file list on stdout (one per line, for
 *     explicit-path staging); all narration goes to stderr
 *   - edits are textual + idempotent; re-running the same worklist is a no-op
 *
 * Usage (from the consumer repo cwd, which provides tsx):
 *   node --import tsx <plugin>/scripts/debt-dispose.mts <worklist.json> [repo-root] [--allow-in-progress]
 * Always re-run `npm run emit:phases` afterwards — the registry parse is the
 * proof the edits kept every file valid.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const allowInProgress = args.includes('--allow-in-progress')
const positional = args.filter((a) => !a.startsWith('--'))
const worklistPath = positional[0]
if (!worklistPath) {
  console.error('usage: debt-dispose.mts <worklist.json> [repo-root] [--allow-in-progress]')
  process.exit(1)
}
const repo = resolve(positional[1] ?? '.')
const worklist: { phase: number; ref: string; status: string; via?: string; date: string }[] = JSON.parse(
  readFileSync(worklistPath, 'utf8'),
)

const VALID = new Set(['fixed', "won't_fix", 'dismissed', 'planned', 'operator-pending'])
for (const w of worklist) {
  if (!VALID.has(w.status)) {
    console.error(`invalid status '${w.status}' on ${w.phase}/${w.ref}`)
    process.exit(1)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(w.date ?? '')) {
    console.error(`missing/invalid date on ${w.phase}/${w.ref} (schema requires yyyy-mm-dd)`)
    process.exit(1)
  }
}

const byPhase = new Map<number, typeof worklist>()
for (const w of worklist) {
  if (!byPhase.has(w.phase)) byPhase.set(w.phase, [])
  byPhase.get(w.phase)!.push(w)
}

const modified: string[] = []
let applied = 0
let skippedExisting = 0

for (const [phase, items] of [...byPhase.entries()].sort((a, b) => a[0] - b[0])) {
  const file = join(repo, 'roadmap/phases', `phase-${phase}.phase.ts`)
  if (!existsSync(file)) {
    console.error(`  ⚠ no file for phase ${phase} — skipped ${items.length} item(s)`)
    continue
  }
  let src = readFileSync(file, 'utf8')
  if (/status: 'in-progress'/.test(src) && !allowInProgress) {
    console.error(`  ⚠ phase ${phase} is in-progress (concurrent session may own it) — skipped; use --allow-in-progress to override`)
    continue
  }

  const fresh = items.filter((w) => !src.includes(`ref: ${JSON.stringify(w.ref)}`))
  skippedExisting += items.length - fresh.length
  if (!fresh.length) continue

  const entries = fresh
    .map(
      (w) =>
        `    {\n      ref: ${JSON.stringify(w.ref)},\n      status: ${JSON.stringify(w.status)},\n` +
        (w.via ? `      via: ${JSON.stringify(w.via)},\n` : '') +
        `      date: ${JSON.stringify(w.date)},\n` +
        '    },',
    )
    .join('\n')

  if (/debtResolutions: \[/.test(src)) {
    // existing array (possibly `[]`) — insert right after the opening bracket
    src = src.replace(/debtResolutions: \[\s*\]/, 'debtResolutions: [\n]')
    src = src.replace(/debtResolutions: \[/, `debtResolutions: [\n${entries}`)
  } else {
    // append the field before the final `})` line of definePhase
    const closeIdx = src.lastIndexOf('\n})')
    if (closeIdx < 0) {
      console.error(`  ⚠ phase ${phase}: could not find definePhase close — skipped`)
      continue
    }
    // The preceding field may end WITHOUT a trailing comma (e.g. a template-
    // literal notes field) — appending a new field after it then quarantines
    // the file. Ensure a comma terminates whatever precedes the insertion.
    const head = src.slice(0, closeIdx)
    const needsComma = !/[,{[]\s*$/.test(head.trimEnd())
    src = `${head}${needsComma ? ',' : ''}\n  debtResolutions: [\n${entries}\n  ],${src.slice(closeIdx)}`
  }
  writeFileSync(file, src)
  modified.push(`roadmap/phases/phase-${phase}.phase.ts`)
  applied += fresh.length
}

console.error(`debt-dispose: ${applied} resolution(s) written into ${modified.length} file(s); ${skippedExisting} already-disposed ref(s) skipped`)
for (const f of modified) console.log(f)
