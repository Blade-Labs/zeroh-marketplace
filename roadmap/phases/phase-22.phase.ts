import { definePhase } from '@/lib/roadmap/schema'

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
  status: 'backlog',
  plannedBy: { model: 'claude-fable-5' },
  category: 'fix',
  kind: 'hardening',
  source:
    'Fleet incident 2026-09-01: Gandalf queued an inline-"reviewed" phase (illumination 1be2812) whose gate then caught 7 findings; atlas 41/77 record 5x invented prose incl. fabricated citations; all fleet sessions run a 0.32.0 cache snapshot while the source is 0.34.0.',
  priority: 'HIGH',
  dependsOn: [17],
  conflictsWith: [21],
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
      verify: 'bash -c "test -f /home/patrik/.claude-b/plugins/known_marketplaces.json && test -d /home/patrik/.claude-b/plugins/cache/zeroh-marketplace/zeroh-roadmap/0.32.0"',
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
        'Both homes carry the identical field; a phase recording reviewRecord validates; review-phase\'s queue step names the write; the do-arc measure assert still exits 0 (13257)',
      ],
      files: [
        'plugins/zeroh-roadmap/templates/schema.ts',
        'lib/roadmap/schema.ts',
        'plugins/zeroh-roadmap/skills/review-phase/SKILL.md',
      ],
      testMode: 'tdd',
      interfaces: { consumes: [], produces: ['PhaseShape.reviewRecord'] },
      done: false,
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
            "Add git-tier Check 17: for each phase in backlog.ts or status in-progress, evidence = reviewRecord present OR a `docs(roadmap): phase N — address review findings` commit in log; neither → HIGH naming the phase and the remedy (run /review-phase N; a WAIVED review records via:'waived'). Grandfather: phases whose queue commit predates the rule's land date are exempt (the 17.2 cutoff pattern, architect-approved there) → verify: bash -c \"grep -qF 'Check 17' plugins/zeroh-roadmap/cli/commands/audit.mjs\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/audit.test.mjs',
          description:
            'RED/GREEN fixture pair per the suite pattern: a queued phase with neither evidence fires HIGH; one carrying reviewRecord fires nothing; one with the review-findings commit fires nothing; a pre-cutoff phase fires nothing (four directions) → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'check 17\' cli/commands/audit.test.mjs && capbuild node --test cli/commands/audit.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'The Gandalf shape (queued, no record, no review commit) is a HIGH finding with the runnable remedy; all three evidence forms silence it (four directions tested)',
      ],
      files: ['plugins/zeroh-roadmap/cli/commands/audit.mjs', 'plugins/zeroh-roadmap/cli/commands/audit.test.mjs'],
      testMode: 'tdd',
      dependsOn: ['22.1'],
      interfaces: { consumes: ['PhaseShape.reviewRecord from 22.1'], produces: [] },
      done: false,
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
      done: false,
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
            'Fixture: a fake cache tree (tmp configRoot with plugins/known_marketplaces.json pointing at a tmp source dir at a higher version) with the CLI invoked via a copied bin path under it → the drift line appears with both versions; equal versions → silent; no cache shape → silent (three directions) → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'version-drift\' cli/commands/status.test.mjs && capbuild node --test cli/commands/status.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'A cached session sees its own staleness on every status read, with both versions named; up-to-date and non-cache invocations stay silent (three directions tested)',
      ],
      files: ['plugins/zeroh-roadmap/cli/commands/status.mjs', 'plugins/zeroh-roadmap/cli/commands/status.test.mjs'],
      testMode: 'tdd',
      done: false,
    },
  ],
  notes:
    'interview: skipped — scope is the recorded fleet incident (illumination 1be2812 "reviewed inline"; atlas phase-77 docblock "invented prose five times across four rounds" + its mid-flight-review corrections; the 0.32.0/0.34.0 cache split observed live on both configs 2026-09-01). ' +
    'conflictsWith 21: both touch validate.mjs\'s WARN section and status.mjs — serialize, never parallel. dependsOn 17: check 17 reuses the 17.2 cutoff grandfathering pattern and the vendor-pair discipline. ' +
    'reviewScope full. Out of scope, recorded: refreshing the live sessions\' caches is an operator act (hot-swapping the plugin under Gandalf\'s in-flight 6h executor is the exact interference the shared-host rules bar); enforcement of reviewRecord at QUEUE time (a backlog-write refusal) needs a queue-owning verb that does not exist — the audit check is the honest reach of the current architecture. ' +
    'Verify rehearsal attestation: red-now probes executed 2026-09-01 — reviewRecord 0 hits both homes, Check 17 0 hits, citation 0 hits in validate.mjs, known_marketplaces 0 hits in status.mjs (each step-verify red for exactly what its diff adds); assumption probes all exit 0 including the live cache-layout observation; runner clauses inherit polarity from their grep representatives. Authored with --skip-review: plan unverified, NOT queued — review together with phase 21.',
})
