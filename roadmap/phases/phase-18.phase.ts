import { definePhase } from '@/lib/roadmap/schema'

/**
 * MINESWEEP plane 2 — measurement layer repairs: the loop must measure to improve.
 *
 * The mined corpus shows the eval loop mostly not measuring: atlas produced ZERO eval
 * records over 25 landed phases because its schema copy silently lacks the record shapes
 * (recorded and shrugged off in 13 phase files); 15 lessons exist only in lane-worktree
 * copies of lessons.jsonl that no land ever merges back; azure holds 9 arcs with sweeps/
 * verdicts but no report and its newest report carries 4/7 dimensions pending-judge with
 * nothing surfacing that; 41 debt-census rows across 9 azure sweeps are explanatory-empty
 * ("None …") noise. Evidence: roadmap/arc-prompts/MINESWEEP-execution-prompt.md §measure.
 *
 * ## Hypotheses (why the loop under-measures)
 * 1. CONFIRMED — every gap is a SILENT degradation: schema drift only surfaces as a
 *    per-phase exit-4 note (tsx-bridge SHAPE_PARSE_SCRIPT: "re-sync lib/roadmap/schema.ts"
 *    on stderr of a sub-spawn), lessons merge-back simply does not exist (probe:
 *    mergeLaneLessons 0 hits), pending-judge dimensions persist without a summary line,
 *    and the census's vacuity skip tests exact-'None' only (debt-census.mts:95) while the
 *    recorded rows BEGIN with "None" and continue.
 * 2. REFUTED — "consumers just forgot to run the eval": azure ran sweeps and verdicts for
 *    those 9 arcs — the chain half-ran and nothing named the missing tail; forgetting is
 *    downstream of silence.
 *
 * timing: band 4-6 × surface:false, N=4, median 148.8 min, p80 196.4 min
 */
export default definePhase({
  phase: 18,
  name: 'Measurement repairs: schema-drift check, lessons merge-back on land, eval-gap visibility, census noise',
  status: 'in-progress',
  plannedBy: { model: 'claude-fable-5' },
  category: 'fix',
  kind: 'hardening',
  arcId: 'MINESWEEP',
  source:
    'MINESWEEP plane "Integrity & measurement" — 2026-08-31 mining §Q3 item 3 (atlas 13-phase drift record; 15 stranded lessons; azure 9 report-less arcs; PAYLOADCMS 4/7 pending-judge; 41 vacuous census rows).',
  priority: 'HIGH',
  dependsOn: [],
  conflictsWith: [],
  keyFiles: [
    'plugins/zeroh-roadmap/cli/commands/config.mjs',
    'plugins/zeroh-roadmap/cli/commands/config.test.mjs',
    'plugins/zeroh-roadmap/cli/commands/audit.mjs',
    'plugins/zeroh-roadmap/cli/commands/audit.test.mjs',
    'plugins/zeroh-roadmap/cli/lib/landing.mjs',
    'plugins/zeroh-roadmap/cli/commands/phase.mjs',
    'plugins/zeroh-roadmap/cli/commands/status.mjs',
    'plugins/zeroh-roadmap/scripts/debt-census.mts',
    'plugins/zeroh-roadmap/cli/commands/eval.mjs',
  ],
  stakeholderDemo:
    'Consumer schema drift is a named audit/config finding instead of a silently-empty scorecard; lessons recorded in a lane worktree survive its land; a landed arc with no eval report and a report with unjudged dimensions both say so; the debt census stops surfacing explanatory-empty rows as debt.',
  userFacing: false,
  assumptions: [
    {
      claim: 'The only schema-drift surfacing today is the tsx-bridge exit-4 stderr line — neither config check nor audit knows the export inventory.',
      verify:
        'bash -c "grep -qF \'re-sync lib/roadmap/schema.ts\' plugins/zeroh-roadmap/cli/lib/tsx-bridge.mjs && test \\"$(grep -cF schemaDrift plugins/zeroh-roadmap/cli/commands/audit.mjs)\\" = \\"0\\" && test \\"$(grep -cF schemaDrift plugins/zeroh-roadmap/cli/commands/config.mjs)\\" = \\"0\\""',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'No land path touches lessons.jsonl (merge-back does not exist in either landing verb).',
      verify:
        'bash -c "test \\"$(grep -cF lessons plugins/zeroh-roadmap/cli/lib/landing.mjs)\\" = \\"0\\" && test \\"$(grep -cF lessons plugins/zeroh-roadmap/cli/commands/phase.mjs)\\" = \\"0\\""',
      onFalse: 'ESCALATE',
    },
    {
      claim: "The census's vacuity skip is exact-match only: `String(v).trim() === 'None'` (debt-census.mts:95), so \"None — …\" prose becomes a debt row.",
      verify: 'bash -c "grep -qF \\"String(v).trim() === \'None\'\\" plugins/zeroh-roadmap/scripts/debt-census.mts"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The canonical shape inventory is greppable: templates/schema.ts declares its exports as `export const <Name>` lines (text-diffable against the consumer copy without tsx).',
      verify: 'bash -c "test \\"$(grep -cE \'^export (const|function|type) \' plugins/zeroh-roadmap/templates/schema.ts)\\" -gt \\"20\\""',
      onFalse: 'ESCALATE',
    },
  ],
  tasks: [
    {
      id: '18.1',
      title: 'Schema-drift check: export-inventory diff in config check + audit check 16',
      problem:
        'A consumer whose lib/roadmap/schema.ts predates a plugin shape loses every downstream sample silently — atlas recorded the identical soft note in 13 phases and never healed, and the scorecard read as "no data" instead of "broken pipe".',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/config.mjs',
          description:
            "Add a text-level export-inventory compare to `config check`: names = lines matching /^export (const|function|type) (\\w+)/ in the plugin's templates/schema.ts vs the consumer's lib/roadmap/schema.ts (resolve the plugin copy from import.meta.url; consumer path from toplevel); missing-in-consumer names print one `schemaDrift:` stderr line each naming the export and the remedy (re-vendor the schema); extra consumer exports are fine (consumers extend). Text compare by design — no tsx spawn, so the check works exactly when the bridge would fail → verify: bash -c \"grep -qF 'schemaDrift' plugins/zeroh-roadmap/cli/commands/config.mjs\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/audit.mjs',
          description:
            "Add git-tier '── Check 16: consumer schema drift ──' reusing the same compare (export the helper from config.mjs or a shared lib — ONE inventory reader): HIGH finding per missing export, message naming the eval-collection consequence ('phase eval records cannot emit') and the re-vendor remedy → verify: bash -c \"grep -qF 'Check 16' plugins/zeroh-roadmap/cli/commands/audit.mjs\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/audit.test.mjs',
          description:
            'Fixture pair: a consumer schema stripped of PhaseEvalRecordShape (the atlas shape, verbatim) fires check 16 HIGH naming that export; the in-sync twin fires nothing; config check mirrors both (its own test in config.test.mjs) → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'check 16\' cli/commands/audit.test.mjs && capbuild node --test cli/commands/audit.test.mjs cli/commands/config.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'The atlas drift shape (missing PhaseEvalRecordShape/DriverShape) is a HIGH audit finding and a config-check line, both naming the consequence and remedy; an in-sync consumer stays silent (both directions)',
        'One inventory reader serves both surfaces (grep: the regex literal exists once)',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/commands/config.mjs',
        'plugins/zeroh-roadmap/cli/commands/config.test.mjs',
        'plugins/zeroh-roadmap/cli/commands/audit.mjs',
        'plugins/zeroh-roadmap/cli/commands/audit.test.mjs',
      ],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-09-01',
      transparencyReport: {
        whatWasDone:
          'Added one shared text-level schema export inventory and used it in both config check and audit check 16. Missing consumer exports now produce one schemaDrift stderr line per export during config checks and one HIGH audit finding per export, while absent schemas, complete vendored copies, and template re-exports remain silent.',
        how:
          'The test-engineer role first added wired subprocess fixtures for stale PhaseEvalRecordShape and DriverShape consumers, healthy vendored and re-export consumers, JSON stream separation, cross-surface parity, and the single-regex-home invariant. The RED run executed 84 tests with 6 new failures and no pre-existing failures. Implementation resolves the canonical template from import.meta.url, extracts export declarations with one regex, follows export-star targets for the established fixture/consumer form, and compares that set with lib/roadmap/schema.ts. GREEN verification was 84/84 tests; the phase types slot was declared-none and green. Quality-pass guard proof: planted a second export-scanning regex literal in audit.mjs -> RED (found 2: audit.mjs, config.mjs); rewrote the config.mjs literals as new RegExp to drift the anchor -> RED (found 0); placed the literal in a // comment as a decoy -> GREEN. Every scratch mutation was reverted.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'The inventory is deliberately text-level and recognizes the planned line-oriented declarations plus export-star forwarding; it is not a TypeScript parser. Ten behavioral tests were added across the two planned test files by the required TDD role.',
      },
    },
    {
      id: '18.2',
      title: 'mergeLaneLessons: land verbs union the lane lessons back to the primary',
      problem:
        '15 lessons exist only in atlas lane-worktree copies of roadmap/arc-evals/lessons.jsonl — an executor records a lesson where it stands, the land moves the CODE and disposes the tree, and the lesson dies with it.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/landing.mjs',
          description:
            "Export mergeLaneLessons(primaryRoot, laneDir): read both roadmap/arc-evals/lessons.jsonl files (absent → empty), append to the primary's every lane line absent from it by exact-line identity (append-only, order-preserving, no rewrite of existing lines; guarantee the primary ends with a newline before appending — concatenating onto an unterminated last line would corrupt both lines and defeat exact-line dedupe), report { merged: n }; a malformed lane line is appended as-is (lessons are freeform JSONL — fidelity beats parsing) → verify: bash -c \"grep -qF 'export function mergeLaneLessons' plugins/zeroh-roadmap/cli/lib/landing.mjs\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/phase.mjs',
          description:
            'Call it in runLand for the codex-lane path BEFORE disposeSource (order is the safety: copy out first, then dispose — the archiveReviewLane rule), stderr-reporting a non-zero merge count; slot-lane lands share the primary file already (worktree lessons ARE the lane\'s own) — call only when cwd is a journal-confirmed lane; covered in phase.test.mjs (a lane fixture\'s novel lesson line reaches the primary before dispose) → verify: bash -c "grep -qF \'mergeLaneLessons\' plugins/zeroh-roadmap/cli/commands/phase.mjs && grep -qF \'mergeLaneLessons\' plugins/zeroh-roadmap/cli/commands/phase.test.mjs"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/landing.mjs',
          description:
            'Same call in landArc\'s codex-lane-dispose step, before each dispose, recorded as a `lessons-merge` record step ({ dir, merged }) so the land report carries it → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'lessons-merge\' cli/lib/landing.mjs && capbuild node --test cli/lib/landing.test.mjs cli/lib/landing-mechanics.test.mjs >/dev/null 2>&1"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/landing.test.mjs',
          description:
            'Tests: a lane with two novel lines and one duplicate merges exactly the two, preserving primary order (second merge of the same lane is a no-op — state coverage: re-land idempotence); absent lane file merges zero without error; primary file created when absent → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'mergeLaneLessons\' cli/lib/landing.test.mjs && capbuild node --test cli/lib/landing.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'Lane-only lesson lines survive both land verbs (merged before disposal, counts reported); duplicates never double; re-running the merge is a no-op (both directions + idempotence tested)',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/lib/landing.mjs',
        'plugins/zeroh-roadmap/cli/lib/landing.test.mjs',
        'plugins/zeroh-roadmap/cli/commands/phase.mjs',
        'plugins/zeroh-roadmap/cli/commands/phase.test.mjs',
      ],
      testMode: 'tdd',
      interfaces: { consumes: [], produces: ['mergeLaneLessons(primaryRoot, laneDir) from cli/lib/landing.mjs'] },
      done: true,
      doneDate: '2026-09-01',
      transparencyReport: {
        whatWasDone:
          'Added mergeLaneLessons as an append-only exact-line union and wired it into both codex-lane landing verbs before worktree disposal. Phase land reports nonzero merge counts on stderr; arc land records a lessons-merge step for every lane.',
        how:
          'The test-engineer role established RED through pure corpus fixtures plus real phase-land and injected arc-land disposal seams. The merger preserves existing primary bytes, inserts a separating newline only when required, keeps malformed lines verbatim, creates the primary corpus when absent, deduplicates within and across corpora, and returns the number actually appended. The first GREEN attempt exposed older first-match consumers of the ordered arc record; the call remained before disposal while its evidence record moved after the established disposal outcome. Final verification passed landing.test 52/52, landing-mechanics.test 36/36, phase.test 38/38, and the declared-none types slot.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'Whitespace-only lesson lines remain meaningful exact lines; only empty separator lines are ignored. The merge deliberately preserves malformed JSONL instead of parsing or normalizing it.',
      },
    },
    {
      id: '18.3',
      title: 'Eval-gap visibility: unjudged dimensions at report time, eval-less landed arcs in status',
      problem:
        'A persisted report with 4/7 dimensions pending-judge reads like a finished eval, and an arc whose phases all landed with no dated report at all reads like "nothing to do" — both azure realities, both silent.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/eval.mjs',
          description:
            "After the dated report persists in the `roadmap eval <ARCID>` path: count dimensions whose value is the pending-judge sentinel; when >0 print `<n> dimension(s) pending-judge — the eval-arc skill's judge pass (roadmap eval merge-judge --arc <ID>) finishes this report` on stderr → verify: bash -c \"grep -qF 'pending-judge —' plugins/zeroh-roadmap/cli/commands/eval.mjs\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/status.mjs',
          description:
            'In the per-arc progress rendering: when arcProgress shows every member phase done AND roadmap/arc-evals/ holds no file matching the anchored `^<ID>-\\d{4}-\\d{2}-\\d{2}\\.json$` (architect amendment A6 — a `-verdicts.json` or `-sweep.json` sibling must NOT count as a report: the azure mined class is precisely arcs with verdicts and no report; the anchor is the same pattern eval.mjs:616 already defines), append ` · eval: none` to that arc\'s line (text + a evalMissing flag in --json); arcs still building show nothing → verify: bash -c "grep -qF \'eval: none\' plugins/zeroh-roadmap/cli/commands/status.mjs"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/status.test.mjs',
          description:
            'Fixtures: all-done arc without a report shows the marker; the same arc with a dated report does not; an in-progress arc does not; an all-done arc with ONLY a -verdicts.json still shows it (four directions, A6) — eval.mjs summary line covered in eval.test.mjs with a pending-judge fixture report → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'eval: none\' cli/commands/status.test.mjs && grep -qF \'pending-judge —\' cli/commands/eval.test.mjs && capbuild node --test cli/commands/status.test.mjs cli/commands/eval.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'A half-run eval chain and a never-run one are both one glance visible (report-time count line; status arc marker), and neither fires on healthy states (all directions tested)',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/commands/eval.mjs',
        'plugins/zeroh-roadmap/cli/commands/eval.test.mjs',
        'plugins/zeroh-roadmap/cli/commands/status.mjs',
        'plugins/zeroh-roadmap/cli/commands/status.test.mjs',
      ],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-09-01',
      transparencyReport: {
        whatWasDone:
          'Made both incomplete eval-chain states visible: newly persisted reports count pending-judge dimensions on stderr with the merge-judge command, and status rows for all-done arcs without an anchored dated report carry `eval: none` plus `evalMissing: true`.',
        how:
          'The test-engineer role added real CLI fixtures for pending and terminal report states plus all four status directions, including verdict, sweep, backup, malformed-date, prefixed, and other-arc filename decoys. Status derives completion from arcProgress and checks only the canonical roadmap/arc-evals directory with an escaped, anchored dated-report pattern. Eval counts the validated persisted dimension values after both report files are written. A RED during verification exposed that the suite helper discarded successful stderr; the two new cases now use a local dual-stream capture helper. Final verification passed status.test 23/23, eval.test 97/97, and the declared-none types slot.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'The JSON status shape follows the existing present-only advisory convention: evalMissing is emitted only when true rather than serialized as false on healthy rows.',
      },
    },
    {
      id: '18.4',
      title: 'Debt census: explanatory-empty rows excluded and counted, never surfaced as debt',
      problem:
        'The census skips only the exact string "None"; a report reading "None — the guard was already shared" becomes a debt row demanding disposition — 41 such rows across 9 azure sweeps, and PAYLOADCMS\'s sweep names the bug in its own disposition text.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/scripts/debt-census.mts',
          description:
            "Widen the skip at the existing check: a field whose trimmed text matches /^(none|nothing|n\\/a)\\b[\\s.,;:—–-]*/i AND carries no debt marker beyond the explanation (decision: the prefix test alone, per the recorded incident class) is EXCLUDED and counted; the census summary prints `excluded <n> explanatory-empty field(s)` so the exclusion is visible, never silent (the honest-degradation rule) → verify: bash -c \"grep -qF 'explanatory-empty' plugins/zeroh-roadmap/scripts/debt-census.mts\"",
        },
        {
          file: 'plugins/zeroh-roadmap/scripts/debt-census.mts',
          description:
            'Update the dangling-resolution join symmetrically: a resolution pointing at a now-excluded field reports as dangling with the exclusion named — its dangling line carries the literal `excluded as explanatory-empty` instead of the bare no-matching-field mystery → verify: bash -c "grep -qF \'excluded as explanatory-empty\' plugins/zeroh-roadmap/scripts/debt-census.mts"',
        },
      ],
      acceptanceCriteria: [
        'The azure row texts ("None — …" verbatim prefixes) no longer yield debt rows; a real debt field starting with any other word still does; the exclusion count line appears exactly when >0 (both directions — exercised via the debt check test path or a census fixture)',
      ],
      files: ['plugins/zeroh-roadmap/scripts/debt-census.mts'],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-09-01',
      transparencyReport: {
        whatWasDone:
          'Debt census now excludes whole-word none, nothing, and n/a explanatory-empty prefixes, reports the exclusion count when nonzero, and labels resolutions aimed at excluded fields as dangling because the field was excluded as explanatory-empty.',
        how:
          'The test-engineer role extended the existing audit census fixture rather than minting a new spec or unarmed ratchet artifact. Six explanatory-empty spellings, zero/one count boundaries, four prefix near-misses, archive audit behavior, and active/archive dangling joins established five RED cases. The implementation uses one case-insensitive prefix regex, tracks excluded refs separately from real debt refs, keeps closing counts honest, exposes excludedExplanatoryEmpty in totals, and prints the summary only above zero. Verification passed audit.test 79/79 and the declared-none types slot.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'The existing cli/commands/audit.test.mjs census fixture was added to the task diff although files[] named only debt-census.mts; this is the governed unit lane already exercising the active and archive census join. Prefix semantics intentionally follow the recorded incident class and can exclude future prose beginning with “None” even if that prose later describes debt, with the visible count preserving discoverability.',
      },
    },
  ],
  notes:
    'interview: skipped — arc member; scope from the MINESWEEP arc record. reviewScope full (landing-path and census semantics changes). ' +
    'Out-of-scope, documented: azure\'s 9 report-less arcs and atlas\'s actual re-vendor are consumer operator acts the new findings name (arc DEFERRED); RunnerSummary backfill and timing-stats recalibration (azure LOW_SCORE 70 vs SPEED_REFERENCE 8) are proposal-lane work already tracked in azure\'s own proposals corpus — re-planning them here would duplicate a consumer\'s queue; scorecard codex-cell absence heals through samples once drift is fixed, not through code. ' +
    'Design decision recorded: the census exclusion is prefix-keyed to the RECORDED incident class and made VISIBLE via the count line rather than silent — a broader semantic filter risks eating real debt prose ("None of the fallbacks guard X" would still be excluded by prefix; accepted: that phrasing has zero recorded occurrences across 23 sweeps, and the count line keeps any future miss discoverable). ' +
    'Verify rehearsal attestation: red-now probes executed 2026-08-31 — schemaDrift 0 hits (config/audit), lessons 0 hits (landing/phase), explanatory-empty 0 hits, `pending-judge —` (em-dash form) 0 hits, `eval: none` 0 hits (each step-verify red for exactly what its diff adds); assumption probes all exit 0 (exact-None line present at debt-census.mts:95; export inventory >20 lines); runner clauses inherit polarity from their grep representatives. ' +
    'Review re-rehearsal 2026-08-31 (review-phase Mode A): all 4 assumption probes exit 0; two step verifies were green-now with no red grep representative and were re-keyed — 18.3.3 (both suites pass at HEAD; added `eval: none`/`pending-judge —` greps on the test files, both 0 hits now) and 18.4.2 (schema.test.ts never touches the census; re-keyed to `excluded as explanatory-empty` in debt-census.mts, 0 hits now); assumption-1 pipeline simplified to per-file zero-counts; 18.2.2 verify widened to phase.test.mjs (0 hits now) so both land verbs carry tested coverage. All other step verifies exit 1 at HEAD. NB eval.test.mjs runs ~4 min — budget the 18.3.3 runner accordingly. ' +
    'Mode A metadata ratifications: testMode tdd stands on all four tasks (18.4\'s test home is the --check ratchet path or a census fixture per its criterion — debt-census.mts today has no test file); reviewScope full stands (landing-path + census semantics); userFacing:false correct (plugin-internal CLI surfaces only).',
  executionResult: {
    phase: 18,
    status: 'failed',
    driver: { model: 'gpt-5.6-sol', lane: 'codex' },
    roles: [
      { role: 'test-engineer', model: 'claude-opus-5', via: 'child-cli' },
      { role: 'test-engineer', model: 'claude-opus-5', via: 'child-cli' },
      { role: 'test-engineer', model: 'claude-opus-5', via: 'child-cli' },
      { role: 'test-engineer', model: 'claude-opus-5', via: 'child-cli' },
      { role: 'test-engineer', model: 'claude-opus-5', via: 'child-cli' },
    ],
    compromises: [],
    skipped: ['Task 18.1 TDD could not begin because the required test-engineer role was unavailable.'],
    hardcoded: [],
    surfaced: ['claude-opus-5 reported its weekly usage limit and has no configured fallback tier.'],
    hardStops: [],
    gateRounds: 0,
  },
})
