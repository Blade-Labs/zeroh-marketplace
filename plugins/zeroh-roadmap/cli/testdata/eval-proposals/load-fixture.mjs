/**
 * The ONE definition of the eval-proposal fixture corpus: five synthetic dated arc-eval reports
 * plus a lessons sidecar, read exactly the way the real pass reads the real corpus (the
 * `readPriorReports` name filter for reports, one JSON document per line for lessons).
 *
 * Both cli/lib/eval-propose.test.mjs and any later command-level test load THIS, so the planted
 * corpus can never drift into two versions that disagree about what is planted.
 *
 * WHAT IS PLANTED, and why each row exists. Every finding class gets a >=2 source cluster AND a
 * singleton, so a run that emits the cluster proves the grouping and the untouched singleton
 * proves the floor:
 *
 *   class                       cluster (emitted)                          singleton (counted only)
 *   recurring-regression        speed, regression:true in ALPHA/BRAVO/CHA  doc-brevity in DELTA
 *   recurring-sentinel          standards-adherence:unjudged-backfill      verified-vs-intent:
 *                               in ALPHA/BRAVO                             no-verdicts-file in ECHO
 *   recurring-low-score         code-confidence 55.2 / 61.0                plan-quality 42.0 in CHARLIE
 *   recurring-lesson-key        cli/lib/eval-score.mjs (plugin home),      roadmap/backlog.ts
 *                               skills/do-arc/skill.md (plugin home),
 *                               src/relay/governed-turn.ts (consumer home)
 *   protocol-load-over-budget   prod-grade at 12499 and 13200              fast-lane at 15000 in CHARLIE
 *
 * The deliberate NON producers, which are the whole point of the boundary tests:
 *   - standards-adherence carries `pending-judge` in CHARLIE and DELTA, on the SAME dimension the
 *     unjudged-backfill cluster comes from, so a skip that fired on the dimension rather than on
 *     the sentinel would take the cluster with it and be caught.
 *   - composability-testability scores EXACTLY 70 in DELTA and ECHO: the low-score threshold is
 *     strict, so two reports at the boundary must still emit nothing.
 *   - DELTA's protocolLoadTokens is EXACTLY 12000 (the budget) and ECHO carries no `workflow`
 *     block at all, so neither may feed the prod-grade cluster.
 *   - lessons 4 and 5 share the bare backticked token `capbuild`, which has no '/' and therefore
 *     no derivable home: two findings, no cluster, one skippedNoLane.
 *   - the two skills lessons spell the same file `SKILL.md` and `skill.md`, so they cluster only
 *     under the lowercase normalization rule.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url))

/** The same shape of name filter readPriorReports applies: ARCID-YYYY-MM-DD.json, nothing else. */
export const REPORT_NAME_RE = /^[A-Z][A-Z0-9]*-\d{4}-\d{2}-\d{2}\.json$/

export const LESSONS_FILE = 'lessons.jsonl'

/** Sorted, so the corpus order is the same on every machine and the pass stays reproducible. */
export const REPORT_FILES = readdirSync(FIXTURE_DIR)
  .sort()
  .filter((f) => REPORT_NAME_RE.test(f))

/** Every file an evidence citation is allowed to name, by basename. */
export const FIXTURE_FILES = [...REPORT_FILES, LESSONS_FILE]

/** @returns {{ reports: object[], lessons: object[] }} parsed corpus, reports in name order. */
export function loadFixtureCorpus() {
  const reports = REPORT_FILES.map((f) => JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf8')))
  const lessons = readFileSync(join(FIXTURE_DIR, LESSONS_FILE), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))
  return { reports, lessons }
}
