import { definePhase } from '../lib/schema'

/**
 * Plan-side integrity — the 2026-09-01 Gandalf incident, mechanized.
 *
 * A fleet session (Gandalf, plugin 0.32.0) queued a phase whose commit says "reviewed
 * inline (Mode A CLEAN)" — the standing ruling says the review pass is EXECUTED, never
 * inline, and 0.32.0 CARRIES that ruling verbatim; the honor system failed anyway. The
 * gate then caught seven findings the skipped review owned. In atlas, phases 41→77 record
 * the sibling disease: "the lane's author produced invented prose five times across four
 * rounds" — fabricated path segments and line anchors in phase prose — and the remediation
 * plan itself shipped an invented `lint/` segment that only a MID-FLIGHT Mode A caught.
 * MINESWEEP mechanized no-self-judge for EXECUTION (phase 17); this phase is the twin for
 * PLANNING, plus the citation-integrity check the invented-prose class demands, plus the
 * version-drift line that would have told every stale session it was running Aug-22 code.
 *
 * ## Hypotheses
 * 1. CONFIRMED — queue-time review evidence is honor-system only: review-phase Mode A
 *    leaves NO durable typed artifact on the phase it reviewed (a CLEAN verdict's only
 *    trace is the queue edit itself), so nothing mechanical can refuse an unreviewed
 *    queue entry (probes: reviewRecord 0 hits in both schema homes; Check 17 0 hits).
 * 2. CONFIRMED — phase prose citations are never verified: a `file.ts:NN` anchor invented
 *    during transcription parses fine and validates fine (0 citation checks in
 *    validate.mjs); the FLUENTFRONT case-variant lesson covered symbols in verifies, not
 *    prose anchors.
 * 3. CONFIRMED — a session cannot see its plugin is stale: both configs resolve the
 *    0.32.0 cache snapshot (frozen 2026-08-22) for every consumer repo while the
 *    marketplace source directory sits at 0.34.0; nothing in status/config check compares
 *    the running root against the marketplace source (0 hits).
 *
 * timing: band 4-6 × surface:false, N=4, median 148.8 min, p80 196.4 min
 */
export default definePhase({
  phase: 22,
  name: 'Plan-side integrity: durable review records, citation-integrity WARN, plugin version-drift line',
  status: 'done',
  completedDate: '2026-09-02',
  gate: {
    lint: 'clean',
    typeCheck: 'clean',
    unitTests: {
      passed: 1693,
      total: 1693,
      notes:
        'Authoritative full gate: roadmap/.gate/22/run-000008-2026-09-02T05-50-21-944Z.json — GREEN, 1,693/1,693. lint/types/build/integration declared-none; lint-diff and history-comments exited 0.',
    },
    integrationTests: { passed: 0, total: 0, notes: 'declared-none in gateCommands.' },
    e2eTests: { passed: 0, total: 0, notes: 'declared-none; no rendered surface.' },
    build: 'clean',
  },
  gateRounds: [
    { round: 0, agent: 'quality-pass', verdict: 'findings-fixed', summary: 'Independent quality findings closed in 08f8640; citation scope independently ruled by software-architect.' },
    { round: 1, agent: 'code-reviewer', verdict: 'findings-fixed', summary: 'Multi-phase attribution, review evidence, and timezone defects closed in 7122b04.' },
    { round: 2, agent: 'code-reviewer', verdict: 'findings-fixed', summary: 'Verification, queue history, suffix, and citation-boundary defects closed in e7bca82.' },
    { round: 3, agent: 'code-reviewer', verdict: 'findings-fixed', summary: 'Verification, fixture-vacuity, and queue chronology defects closed in 8611ee4.' },
    { round: 4, agent: 'code-reviewer', verdict: 'findings-fixed', summary: 'Queue-move and subject-fixture defects closed in db70725.' },
    { round: 5, agent: 'code-reviewer', verdict: 'findings-fixed', summary: 'Schema review-waiver documentation closed in da07372; correctness cap exhausted.' },
    {
      round: 6,
      agent: 'code-reviewer',
      model: 'claude-fable-5-1',
      verdict: 'findings-fixed',
      summary:
        'Supervising-session review after the cap: post-cutoff commit subjects (the queue subject above all) no longer count as review evidence — the record alone does; only a READY reviewRecord earns the queue; unusable git degrades to one LOW instead of a false BROKEN; the plan(roadmap) queue-subject variant is recognized; the citation lint resolves `cd <dir> &&`-relative and files[]-tail citations; versionDriftLine keeps its best-effort contract for a non-string selfPath. RED 10 → GREEN 103/103, 66/66, 31/31; mutation proofs re-quoted against the final suites.',
    },
  ],
  metrics: {
    commits: 12,
    linesAdded: 976,
    linesRemoved: 25,
    filesChanged: 16,
    testsAtStart: 1635,
    testsAtEnd: 1693,
    testsAdded: 58,
    startedAt: '2026-09-01T21:06:29.000Z',
    completedAt: '2026-09-02T05:51:36.000Z',
  },
  executionResult: {
    phase: 22,
    status: 'done',
    driver: { model: 'gpt-5.6-sol', lane: 'codex' },
    roles: [
      { role: 'quality-pass', model: 'claude-opus-5', via: 'child-cli' },
      { role: 'quality-pass', model: 'claude-opus-5', via: 'child-cli' },
      { role: 'software-architect', model: 'claude-fable-5', via: 'child-cli' },
      { role: 'code-reviewer', model: 'claude-fable-5', via: 'child-cli' },
      { role: 'code-reviewer', model: 'claude-fable-5', via: 'child-cli' },
      { role: 'code-reviewer', model: 'claude-fable-5', via: 'child-cli' },
      { role: 'code-reviewer', model: 'claude-fable-5', via: 'child-cli' },
      { role: 'code-reviewer', model: 'claude-fable-5', via: 'child-cli' },
      { role: 'code-reviewer', model: 'claude-fable-5', via: 'child-cli' },
      { role: 'code-reviewer', model: 'claude-fable-5-1', via: 'native' },
    ],
    compromises: [],
    skipped: [],
    hardcoded: [],
    surfaced: [
      'The first quality-pass launch inherited delegation and self-matched a background reviewer; it was interrupted and rerun with delegation disabled.',
      'The first correctness-review launch twice piped a suite through tail, contrary to the shared-host protocol; it was interrupted and rerun without pipes.',
      'The five-round correctness cap ended with findings fixed rather than a clean follow-up round.',
      'The protocol-owned curation composer emitted its fixed generic Claude trailer; the lane-specific Claude Fable 5 trailer could not be injected without overriding the required curation act.',
    ],
    hardStops: [],
    gateRounds: 7,
  },
  plannedBy: { model: 'claude-fable-5' },
  reviewRecord: { date: '2026-09-01', model: 'claude-fable-5-1', verdict: 'READY', via: 'executed' },
  category: 'fix',
  kind: 'hardening',
  source:
    'Fleet incident 2026-09-01: Gandalf queued an inline-"reviewed" phase (illumination 1be2812) whose gate then caught 7 findings; atlas 41/77 record 5x invented prose incl. fabricated citations; all fleet sessions run a 0.32.0 cache snapshot while the source is 0.34.0.',
  priority: 'HIGH',
  dependsOn: [17],
  conflictsWith: [],
  keyFiles: [
    'plugins/zeroh-roadmap/templates/schema.ts',
    'lib/roadmap/schema.ts',
    'plugins/zeroh-roadmap/skills/review-phase/SKILL.md',
    'plugins/zeroh-roadmap/cli/commands/audit.mjs',
    'plugins/zeroh-roadmap/cli/commands/audit.test.mjs',
    'plugins/zeroh-roadmap/cli/lib/validate.mjs',
    'plugins/zeroh-roadmap/bin/validate-roadmap-file.test.mjs',
    'plugins/zeroh-roadmap/cli/commands/status.mjs',
    'plugins/zeroh-roadmap/cli/commands/status.test.mjs',
  ],
  stakeholderDemo:
    'A queued phase with no durable review record is a named audit finding instead of an honor-system hope; a phase citing a file or line that does not exist at HEAD gets a WARN naming the invented anchor; every status read tells a stale session which plugin version it is actually running.',
  userFacing: false,
  assumptions: [
    {
      claim: 'No reviewRecord field exists in either schema home, and audit has no check 17.',
      verify:
        'bash -c "test \\"$(grep -cF reviewRecord plugins/zeroh-roadmap/templates/schema.ts)\\" = \\"0\\" && test \\"$(grep -cF reviewRecord lib/roadmap/schema.ts)\\" = \\"0\\" && test \\"$(grep -cF \'Check 17\' plugins/zeroh-roadmap/cli/commands/audit.mjs)\\" = \\"0\\""',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'validate.mjs performs no citation-existence check on phase prose.',
      verify: 'bash -c "test \\"$(grep -cE \'citation|citedPath\' plugins/zeroh-roadmap/cli/lib/validate.mjs)\\" = \\"0\\""',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The installed-cache layout is <configRoot>/plugins/cache/<marketplace>/<plugin>/<version>/ with known_marketplaces.json two levels above cache/, carrying a directory source path (observed live on both configs, 2026-09-01).',
      verify: 'bash -c "R=${CLAUDE_CONFIG_DIR:-$HOME/.claude}; test -f $R/plugins/known_marketplaces.json && test -d $R/plugins/cache/zeroh-marketplace/zeroh-roadmap"',
      onFalse: 'ESCALATE',
    },
  ],
  tasks: [
    {
      id: '22.1',
      title: 'reviewRecord: the durable Mode A verdict, written by review-phase, in both schema homes',
      problem:
        'A CLEAN Mode A review leaves no artifact on the phase it reviewed, so "reviewed inline" and "reviewed for real" are indistinguishable to every later reader — the exact laundering the gateRounds enum widening ended for execution reviews.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/templates/schema.ts',
          description:
            "Add optional `reviewRecord: { date: string(min 8), model: string(min 2), verdict: enum(['READY','NEEDS_WORK','BLOCKER']), via: enum(['executed','waived']) }` to PhaseShape, docblock stating the ruling: `via:'executed'` is writable only by an actually-run Mode A pass; 'waived' records a user --skip-review with the report line. Mirror line-identically in lib/roadmap/schema.ts in the same commit (the vendor-pair discipline) → verify: bash -c \"grep -qF 'reviewRecord' plugins/zeroh-roadmap/templates/schema.ts && diff <(grep -A 1 reviewRecord plugins/zeroh-roadmap/templates/schema.ts | head -2) <(grep -A 1 reviewRecord lib/roadmap/schema.ts | head -2) >/dev/null\"",
        },
        {
          file: 'plugins/zeroh-roadmap/skills/review-phase/SKILL.md',
          description:
            'Mode A Step 8 writes reviewRecord {date, model: the judge\'s own id, verdict, via:\'executed\'} onto the phase file BEFORE queueing — one sentence added to the existing queue instruction, DIET-funded in-file if the flow measure demands (review-phase is metered in the plan-arc flow, not do-arc; measure and record either way) → verify: bash -c "grep -qF \'reviewRecord\' plugins/zeroh-roadmap/skills/review-phase/SKILL.md"',
        },
      ],
      acceptanceCriteria: [
        'Both homes carry the identical field; a phase recording reviewRecord validates; review-phase\'s queue step names the write; `roadmap measure --flow plan-arc` (the flow that loads review-phase — measure-manifest.json:32) recorded before/after in the transparencyReport with growth ≤ the one sentence (the do-arc assert does not load this file, so its exit 0 is not evidence)',
      ],
      files: [
        'plugins/zeroh-roadmap/templates/schema.ts',
        'lib/roadmap/schema.ts',
        'plugins/zeroh-roadmap/skills/review-phase/SKILL.md',
      ],
      testMode: 'tdd',
      interfaces: { consumes: [], produces: ['PhaseShape.reviewRecord'] },
      done: true,
      doneDate: '2026-09-01',
      transparencyReport: {
        whatWasDone:
          "Added the optional reviewRecord contract to both schema homes and taught review-phase to persist an executed or waived verdict before queueing.",
        how:
          'The claude-opus-5 test-engineer added six schema checks spanning both homes and demonstrated five RED failures before implementation. The schema now requires date, model, the READY/NEEDS_WORK/BLOCKER verdict enum, and executed/waived provenance while remaining optional for historical phases. The scoped schema run passed with 0 failures; the types slot was declared-none. plan-arc measured 65,155 bytes before and 65,335 after, a single 180-byte sentence increase.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations: 'None',
      },
    },
    {
      id: '22.2',
      title: 'Audit check 17: a queued or in-progress phase without review evidence',
      problem:
        'Nothing refuses an unreviewed queue entry; the Gandalf phase sailed into execution and its gate paid the seven findings the skipped review owned.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/audit.mjs',
          description:
            "Add git-tier Check 17: for each phase in backlog.ts or status in-progress, evidence = reviewRecord present OR one of the THREE review-commit subjects git log actually carries: `docs(roadmap): phase N — address review findings` (plan-arc, b0d2182), `plan(roadmap): phase N review fixes` and `docs(roadmap): queue phase N` (review-phase SKILL.md:150, 2f76630 / 590cdcc); none → HIGH naming the phase + remedy (run /review-phase N; a WAIVED review records via:'waived'). Grandfather: queue commits before the rule's land date are exempt via a named ISO cutoff constant (the 17.2 pattern, gate-report.mjs:23) → verify: bash -c \"grep -qF 'Check 17' plugins/zeroh-roadmap/cli/commands/audit.mjs\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/audit.test.mjs',
          description:
            'RED/GREEN fixture pair per the suite pattern: a queued phase with neither evidence fires HIGH; one carrying reviewRecord fires nothing; one with any of the three review-commit subjects fires nothing (table over all three); a pre-cutoff phase fires nothing (four directions) → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'unreviewed queue\' cli/commands/audit.test.mjs && capbuild node --test cli/commands/audit.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'The Gandalf shape (queued, no record, no review commit) is a HIGH finding with the runnable remedy; reviewRecord, each of the three review-commit subjects, and the pre-cutoff exemption all silence it',
      ],
      files: ['plugins/zeroh-roadmap/cli/commands/audit.mjs', 'plugins/zeroh-roadmap/cli/commands/audit.test.mjs'],
      testMode: 'tdd',
      dependsOn: ['22.1'],
      interfaces: { consumes: ['PhaseShape.reviewRecord from 22.1'], produces: [] },
      done: true,
      doneDate: '2026-09-01',
      transparencyReport: {
        whatWasDone:
          'Added audit Check 17 for queued and in-progress phases without durable or commit-backed plan-review evidence, with an ISO cutoff for historical phases and a runnable review remedy.',
        how:
          'The claude-opus-5 test-engineer established 3 RED failures across an eight-case matrix. The implementation recognizes reviewRecord and all three historical review subjects with exact phase-number matching, and grandfathers phase files created before 2026-09-01. The final audit suite passed 87/87 and the types slot was declared-none. Check 17 mutation proof (re-quoted at gate R6 against the final 103-case suite): disabling the per-phase finding loop produced RED with 13 failures; drifting the historical subject scan to read past the cutoff (the R6 HIGH re-introduced) produced RED with 6 failures; the legal phase-1000 review-subject decoy and the pre-cutoff grandfather stayed GREEN.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'The planned verify named a nonexistent lowercase check-id literal; gate Round 2 re-keyed it to the suite\'s intentional observable-contract label, unreviewed queue.',
      },
    },
    {
      id: '22.3',
      title: 'Citation-integrity WARN: invented paths and line anchors in phase prose',
      problem:
        'Atlas 41\'s five invented-prose incidents included fabricated path segments and line numbers in phase docblocks/ledgers — text that parses, validates, and lies. A `file:line` or repo-path citation that does not exist at HEAD is mechanically checkable.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/validate.mjs',
          description:
            "New WARN lint (new-to-git files only, the grandfather rule): extract repo-relative path citations matching (src|cli|lib|scripts|plugins|roadmap|docs|web)/[\\w./-]+\\.\\w+ from task problems/steps/notes prose; a cited path absent at HEAD (and absent from the phase's OWN files[] — a plan legitimately cites files it will create) WARNs naming the invented anchor and the atlas-41 incident class. Line-number suffixes are stripped before the existence check (lines drift legally; the PATH inventing is the disease) → verify: bash -c \"grep -qF 'citation' plugins/zeroh-roadmap/cli/lib/validate.mjs\"",
        },
        {
          file: 'plugins/zeroh-roadmap/bin/validate-roadmap-file.test.mjs',
          description:
            'Table pair: a new-to-git phase citing a nonexistent src/lint/foo.test.ts WARNs naming it; the clean twin citing a real file is silent; a cited path that appears in the phase\'s own files[] (to-be-created) is silent; committed files exempt (four directions) → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'citation\' bin/validate-roadmap-file.test.mjs && capbuild node --test bin/validate-roadmap-file.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'The atlas-41 shape (invented path segment in prose) WARNs on a new file with the incident class named; real, to-be-created, and grandfathered citations stay silent; exit codes unchanged',
      ],
      files: ['plugins/zeroh-roadmap/cli/lib/validate.mjs', 'plugins/zeroh-roadmap/bin/validate-roadmap-file.test.mjs'],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-09-01',
      transparencyReport: {
        whatWasDone:
          'Added a new-file citation-integrity warning that checks repo-relative paths in task problems, step descriptions, and phase notes against HEAD while allowing files the phase plans to create.',
        how:
          'The claude-opus-5 test-engineer established 4 RED failures and seven silent guard directions. The implementation extracts and de-duplicates supported repo-path shapes, treats line suffixes as non-semantic, verifies paths with git cat-file, and retains the authoring-only grandfather rule. The final validator suite passed 61/61 and the types slot was declared-none. Citation guard mutation proof (re-quoted at gate R6 against the final 66-case suite): disabling the lint produced RED with 5 failures; drifting the `cd <dir>` resolution to accept any path produced RED with 1 failure; the real-path, planned-file, files[]-tail and cd-relative-real decoys stayed GREEN.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'Scans parsed prose only (notes, tasks[].problem, tasks[].steps[].description) per the ratified step scope; the raw leading docblock is not scanned — see the out-of-scope record in notes.',
      },
    },
    {
      id: '22.4',
      title: 'Version-drift line: status tells a cached session what it is running',
      problem:
        'Every fleet session ran a 0.32.0 snapshot frozen 2026-08-22 while the source sat at 0.34.0 — ten days of landed rails (including the ones whose absence caused this incident) silently unloaded, with autoUpdate:true and fresh lastUpdated stamps lying about it.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/status.mjs',
          description:
            "Detect the cache shape from the CLI's own path (bin/roadmap.mjs resolved under */plugins/cache/<mkt>/<plugin>/<ver>/): read the running version from its own .claude-plugin/plugin.json, resolve known_marketplaces.json at <configRoot>/plugins/, and when that marketplace's source is a DIRECTORY, read the source plugin.json version; differ → one advisory line `plugin: running <v> from cache, source is <v2> — update via /plugin` on text + JSON (present-only). Not under a cache path, unreadable market file, non-directory source → silent (best-effort by construction, never a failure) → verify: bash -c \"grep -qF 'known_marketplaces' plugins/zeroh-roadmap/cli/commands/status.mjs\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/status.test.mjs',
          description:
            'Export a pure versionDriftLine({ selfPath }) (status.mjs feeds import.meta.url — add the node:url import) so no test copies the plugin tree: fixture = tmp configRoot with plugins/known_marketplaces.json → tmp source dir at a higher version, fake cache selfPath under it → line names both versions; equal versions → silent; selfPath outside */plugins/cache/ → silent (three directions); plus ONE spawned bin/roadmap.mjs status from this checkout asserting the line ABSENT (non-cache door) → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'versionDriftLine\' cli/commands/status.test.mjs && capbuild node --test cli/commands/status.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'A cached session sees its own staleness on every status read, with both versions named; up-to-date and non-cache invocations stay silent (three directions tested)',
      ],
      files: ['plugins/zeroh-roadmap/cli/commands/status.mjs', 'plugins/zeroh-roadmap/cli/commands/status.test.mjs'],
      testMode: 'tdd',
      done: true,
      doneDate: '2026-09-01',
      transparencyReport: {
        whatWasDone:
          'Added a pure cache/source version-drift derivation and surfaced its advisory on both human and JSON status output only when the running cached plugin differs from its directory source.',
        how:
          'The claude-opus-5 test-engineer established 6 RED failures covering drift, equality, non-cache paths, unreadable registries, checkout silence, and both output surfaces. versionDriftLine resolves the running manifest, marketplace directory registry, marketplace plugin source, and source manifest with best-effort null behavior. The full status suite passed 29/29 and the types slot was declared-none.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'The planned test verify named a hyphenated version-drift literal absent from the suite; gate Round 3 re-keyed it to the exported seam name, versionDriftLine.',
      },
    },
  ],
  notes:
    'interview: skipped — scope is the recorded fleet incident (illumination 1be2812 "reviewed inline"; atlas phase-77 docblock "invented prose five times across four rounds" + its mid-flight-review corrections; the 0.32.0/0.34.0 cache split observed live on both configs 2026-09-01). ' +
    'conflictsWith: none — phase 21 (after its own review) touches worktree/executor-arm/status/tsx-bridge/codex and their tests; this phase touches schema/review-phase SKILL/audit/validate/status.mjs — status.mjs is the ONE shared file, but 21 edits derive() step (1) and this phase appends an advisory line: disjoint hunks, no serialization needed. dependsOn 17: check 17 reuses the 17.2 cutoff grandfathering pattern and the vendor-pair discipline. ' +
    'reviewScope full. Out of scope, recorded: refreshing the live sessions\' caches is an operator act (hot-swapping the plugin under Gandalf\'s in-flight 6h executor is the exact interference the shared-host rules bar); enforcement of reviewRecord at QUEUE time (a backlog-write refusal) needs a queue-owning verb that does not exist — the audit check is the honest reach of the current architecture; docblock/ledger citation scanning (the atlas incidents\' literal location) needs a raw-text extractor plus a path-perspective rule — 4 plugin-relative docblock citations in the existing corpus (e.g. phase-14\'s cli/commands/phase.mjs) false-WARN under the repo-relative HEAD check — a followup if docblock invention recurs in this consumer. ' +
    'Verify rehearsal attestation: red-now probes executed 2026-09-01 — reviewRecord 0 hits both homes, Check 17 0 hits, citation 0 hits in validate.mjs, known_marketplaces 0 hits in status.mjs (each step-verify red for exactly what its diff adds); assumption probes all exit 0 including the live cache-layout observation; runner clauses inherit polarity from their grep representatives. Authored with --skip-review; Mode A review EXECUTED 2026-09-01 (claude-fable-5-1, standalone inline): READY after five [FIXED] repairs — (1) conflictsWith [21] rested on a false claim ("both touch validate.mjs"): phase 21 never touches validate.mjs; the only shared file is status.mjs in disjoint hunks — pairing dropped; (2) assumption 3 hard-coded one session\'s config root under /home — re-keyed to ${CLAUDE_CONFIG_DIR:-$HOME/.claude} (both configs carry the layout); (3) 22.1\'s criterion cited the do-arc measure assert, which does not load review-phase (measure-manifest.json:32 puts it in plan-arc) — vacuous, re-keyed to plan-arc; (4) 22.2 keyed review evidence on ONE commit subject while review-phase\'s own two forms (SKILL.md:150) would have read as unreviewed — widened to the three forms git log carries; (5) 22.4\'s test needed a copied plugin tree under a fake cache — replaced by an injected-selfPath seam plus one real non-cache spawn. Ratified: reviewScope full; testMode tdd on all four; userFacing false. The 17.2 cutoff pattern verified real at gate-report.mjs:23.',
})
