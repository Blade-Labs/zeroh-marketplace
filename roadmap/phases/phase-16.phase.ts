import { definePhase } from '@/lib/roadmap/schema'

/**
 * MINESWEEP plane 1 — commit-grammar: tolerant READ, canonical WRITE.
 *
 * The `phase N —` em-dash grammar is load-bearing for attribution (curation ranges, the
 * phase-own file set, start-SHA derivation) and it broke in three consumers: mudarabah2
 * has ELEVEN phases whose curation never ran (its executors wrote `phase N task N.X — …`
 * and `fix(phase-N): …`), marketplace phase 1 recorded an unrecoverable misclassification
 * and phase 10 a refused squash range (a gate agent's `fix(phase-10):` subject), atlas 30
 * shipped an ASCII hyphen that collapsed gate scope to a 1-file diff and skipped
 * quality-pass. Arc LOCKED decision: tolerance is READ-side only; the canonical write
 * grammar stays the one taught form and every tolerated deviant still WARNs.
 * Evidence: roadmap/arc-prompts/MINESWEEP-execution-prompt.md §grammar.
 *
 * ## Hypotheses (why attribution breaks)
 * 1. CONFIRMED — three independent matchers each accept ONLY the canonical form while
 *    real executors (human-prompted agents, delegated drivers, gate agents) write five
 *    recorded deviant classes: classifySubject (curate.mjs:39), phaseOwnFiles's
 *    fixed-string grep (gate.mjs:142), derivePhaseStartSha's grep (gitscan.mjs:47).
 *    Evidence: the eleven mudarabah2 limitations entries name "the same CLI
 *    classification quirk" across phases 715-727.
 * 2. REFUTED — "executors just need better instructions": marketplace phase 10 recorded
 *    the fix pair verbatim ("pass the commit grammar into gate-agent prompts OR have the
 *    orchestrator own the commit") and STILL recommends grammar injection — instruction
 *    alone failed three repos; the read side must also stop being brittle.
 *
 * timing: band 4-6 × surface:false, N=4, median 148.8 min, p80 196.4 min
 */
export default definePhase({
  phase: 16,
  name: 'Commit-grammar tolerant attribution: one matcher home, widened read, deviant WARNs, grammar in agent cards',
  status: 'in-progress',
  plannedBy: { model: 'claude-fable-5' },
  category: 'fix',
  kind: 'hardening',
  arcId: 'MINESWEEP',
  source:
    'MINESWEEP plane "Lane lifecycle" — 2026-08-31 mining §Q3 item 2 (P3/P9 cross-repo pattern: 11 mudarabah2 phases + marketplace 1/10 + atlas 17/30).',
  priority: 'HIGH',
  dependsOn: [],
  conflictsWith: [],
  keyFiles: [
    'plugins/zeroh-roadmap/cli/lib/gitscan.mjs',
    'plugins/zeroh-roadmap/cli/lib/gitscan.test.mjs',
    'plugins/zeroh-roadmap/cli/lib/curate.mjs',
    'plugins/zeroh-roadmap/cli/lib/curate.test.mjs',
    'plugins/zeroh-roadmap/cli/commands/gate.mjs',
    'plugins/zeroh-roadmap/cli/commands/gate.test.mjs',
    'plugins/zeroh-roadmap/agents/quality-pass.md',
    'plugins/zeroh-roadmap/agents/software-developer.md',
    'plugins/zeroh-roadmap/agents/test-engineer.md',
    'plugins/zeroh-roadmap/DIET-LEDGER.md',
  ],
  stakeholderDemo:
    'Curation and gate attribution read the commit grammars real executors actually wrote (the five recorded deviant classes) without loosening what counts as foreign, every tolerated deviant still teaches the canonical form via a WARN, and every committing agent card carries the grammar.',
  userFacing: false,
  assumptions: [
    {
      claim: 'The three matchers are independent: classifySubject builds its own regexes, phaseOwnFiles greps the fixed string, derivePhaseStartSha greps the fixed string — no shared pattern home exists.',
      verify:
        'bash -c "grep -qF \'const grep = `phase ${phaseNum} —`\' plugins/zeroh-roadmap/cli/lib/gitscan.mjs && grep -qF \'const grep = `phase ${phaseNum} —`\' plugins/zeroh-roadmap/cli/commands/gate.mjs && test \\"$(grep -cF phaseOwnPatterns plugins/zeroh-roadmap/cli/lib/gitscan.mjs)\\" = \\"0\\""',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'git log accepts -E/--extended-regexp for --grep on this host (probed 2026-08-31: `git log -E --grep` matched and exited 0).',
      verify: 'bash -c "cd /home/patrik/zeroh-marketplace && git log -E --grep=\'phase (14|15) —\' --format=%s -1 | grep -q phase"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'deviantGrammarFindings warns on exactly one deviant class today (`phase N N.X —`), so the other four recorded classes surface nothing.',
      verify: 'bash -c "grep -qF \'phase ${phaseNum} ${phaseNum}\' plugins/zeroh-roadmap/cli/commands/gate.mjs"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The per-card ceiling is ~5,000 B (DIET-LEDGER 2026-07-16 ruling) and quality-pass.md currently measures 5,545 B — any card addition must be diet-funded in-file with ledger rows.',
      verify: 'bash -c "test \\"$(wc -c < plugins/zeroh-roadmap/agents/quality-pass.md)\\" -gt \\"5000\\""',
      onFalse: 'ESCALATE',
    },
  ],
  tasks: [
    {
      id: '16.1',
      title: 'phaseOwnPatterns: ONE tolerant matcher home in gitscan.mjs',
      problem:
        'Three matchers, one grammar, zero sharing — any future tolerance fix would fork three ways (the arc singleSeam this task closes). The boundary property (phase 21 never matches phase 214) must survive the widening.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/gitscan.mjs',
          description:
            "Export phaseOwnPatterns(phaseNum) returning { ere, test } — ere: ONE extended-regex string usable by `git log -E --grep` and `new RegExp`, alternating the canonical form and the five recorded deviant classes: D1 `phase N task N.X <dash>` (no (k/M) token), D2 scope-carried `\\(phase-N\\)` directly after the type, D3 `mark phase N complete`, D4 dash variants as an ALTERNATION group `(—|–|-)` wherever the boundary dash appears — never a bracket expression (a multibyte char inside a POSIX bracket is locale-dependent under git's regcomp; alternating literal byte sequences is safe in any locale), D5 `phase N N.X <dash>`; every `phase N` occurrence is digit-bounded by the class's own mandatory NEXT literal (dash, `)`, ` task`, ` complete` — architect note N3: a bare `[^0-9]` cannot match at end-of-subject, so bound with the following literal each class already requires, and keep one end-of-string boundary row in the table tests) so 21 never matches 214; test(subject) = anchored RegExp evaluation of the same ere → verify: bash -c \"grep -qF 'export function phaseOwnPatterns' plugins/zeroh-roadmap/cli/lib/gitscan.mjs\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/gitscan.test.mjs',
          description:
            'Table-driven tests from the RECORDED incident subjects verbatim (mudarabah2 `feat(catalog): phase 715 task 715.2 — …`, `fix(phase-718): quality pass`, `docs(roadmap): mark phase 718 complete`; atlas ASCII-hyphen form; the 1696 `phase N N.X —` form) — each matches its own phase number; the boundary set (phase 21 vs 214, prose mid-sentence mention, a SIBLING phase\'s canonical subject) each does NOT match → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'phaseOwnPatterns\' cli/lib/gitscan.test.mjs && capbuild node --test cli/lib/gitscan.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'One exported ere + test pair covers canonical + D1-D5, digit-bounded; every recorded incident subject matches and every boundary/foreign subject refuses (both directions, table-driven)',
      ],
      files: ['plugins/zeroh-roadmap/cli/lib/gitscan.mjs', 'plugins/zeroh-roadmap/cli/lib/gitscan.test.mjs'],
      testMode: 'tdd',
      interfaces: { consumes: [], produces: ['phaseOwnPatterns(phaseNum) from cli/lib/gitscan.mjs'] },
      done: true,
      doneDate: '2026-09-01',
      transparencyReport: {
        whatWasDone:
          'Added phaseOwnPatterns(phaseNum) as the single commit-subject ownership grammar. Its one git-ERE/JavaScript-compatible expression recognizes the canonical form and recorded D1-D5 variants, including em/en/ASCII dash alternation, while subject anchoring and mandatory literals after every phase number prevent sibling and prose matches.',
        how:
          'TDD: the resolved claude-opus-5 test-engineer wrote six table-driven tests from recorded incident subjects and confirmed RED on the missing export. The implementation validates digit-only phase identifiers, composes one anchored ERE, and closes over the same compiled expression for test(subject). The scoped run passed 6/6, including git log -E checks under the ambient and C locales and bidirectional phase-number collision cases; the types slot was declared-none and green.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations: 'None',
      },
    },
    {
      id: '16.2',
      title: 'derivePhaseStartSha + phaseOwnFiles consume the shared matcher',
      problem:
        'Start-SHA derivation and the phase-own file set silently drop deviant-grammar commits: scope/floor under-derive with nothing surfacing it (atlas 30: gate plan collapsed to a 1-file diff and SKIPPED quality-pass entirely).',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/gitscan.mjs',
          description:
            "derivePhaseStartSha: replace the fixed-string grep with `git log -E --grep=<phaseOwnPatterns(N).ere>`; tier-1 move-commit selection logic unchanged (the move commit is CLI-written and stays canonical); tier-2 oldest-match fallback now sees deviant task commits; every server-side match is re-CONFIRMED client-side by phaseOwnPatterns(N).test against the row's %s subject before it can be chosen (git --grep scans the WHOLE message — a foreign commit merely quoting a deviant subject in its body must not shift the base; the landing.mjs deriveArcSuiteScope precedent) → verify: bash -c \"! grep -qF 'const grep = \\`phase \\${phaseNum} —\\`' plugins/zeroh-roadmap/cli/lib/gitscan.mjs\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/gate.mjs',
          description:
            'phaseOwnFiles: same replacement (`git log -E --grep=<ere>` emitting %H%x09%s plus --name-only) with the same client-side phaseOwnPatterns(N).test subject confirm — a commit whose BODY merely quotes the grammar contributes no files to the phase-own set; deriveBaseSha keeps its typed no-match error text updated to name the canonical form as the EXPECTED one → verify: bash -c "! grep -qF \'const grep = `phase ${phaseNum} —`\' plugins/zeroh-roadmap/cli/commands/gate.mjs"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/gitscan.test.mjs',
          description:
            'Range-derivation test over a real tmp history interleaving D1/D2 subjects with a sibling phase: the derived base and the phase-own file set include the deviant commits\' files and exclude the sibling\'s AND a foreign commit whose body (not subject) quotes a deviant form (state coverage: derivation re-run after ANOTHER phase\'s commits land on top yields the same base) → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'derivePhaseStartSha\' cli/lib/gitscan.test.mjs && capbuild node --test cli/lib/gitscan.test.mjs cli/commands/gate.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'A fixture history with deviant-grammar task commits derives the same base and phase-own set as its canonical twin; sibling commits — including one whose BODY quotes the grammar — stay excluded (both directions)',
        'No fixed-string `phase N —` grep remains in gitscan.mjs or gate.mjs (negative grep, paired with the phaseOwnPatterns positive)',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/lib/gitscan.mjs',
        'plugins/zeroh-roadmap/cli/commands/gate.mjs',
        'plugins/zeroh-roadmap/cli/lib/gitscan.test.mjs',
        'plugins/zeroh-roadmap/cli/commands/gate.test.mjs',
      ],
      testMode: 'tdd',
      dependsOn: ['16.1'],
      interfaces: { consumes: ['phaseOwnPatterns(phaseNum) from 16.1'], produces: [] },
      done: true,
      doneDate: '2026-09-01',
      transparencyReport: {
        whatWasDone:
          'derivePhaseStartSha and gate phaseOwnFiles now prefilter with git log -E using phaseOwnPatterns().ere and re-confirm every returned subject with phaseOwnPatterns().test. Start-SHA selection therefore sees tolerated task subjects without accepting a foreign commit whose body merely quotes the grammar, and phase-own file collection associates files only with client-confirmed commit headers.',
        how:
          'TDD: the resolved claude-opus-5 test-engineer added canonical/deviant twin histories, bidirectional interleaved-phase fixtures, body-quote exclusions, and source guards. After replacing both fixed-string greps, gitscan passed 9/9 and gate passed 67/67. The first gate run exposed 11 existing environment failures because the plugin-local node_modules link was absent; restoring the worktree-local symlink to the already installed root dependencies made the unchanged cases and the three new cases all green. Guard mutation proof: planted inline `--grep=phase ${n} —` → RED ("a git --grep= fed a fixed phase-number/em-dash string"); renamed phaseOwnPatterns → RED (SyntaxError naming the missing export); lawful second reader using -E + shared ere beside prose quoting the canonical form → GREEN. The types slot was declared-none and green.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations: 'None',
      },
    },
    {
      id: '16.3',
      title: 'classifySubject tolerates D1-D5; deviantGrammarFindings names every class',
      problem:
        'Curation refuses its own phase\'s work as foreign (11 mudarabah2 phases never curated; marketplace 10\'s squash range refused on a gate agent\'s subject) — and the one deviant WARN covers only the 1696 class, so the other four break silently.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/curate.mjs',
          description:
            "classifySubject: D1 and D5 classify 'task'; D2 (`type(phase-N): …`) classifies 'task' ('gate-fix' when the remainder matches the gate-fix form); D3 (`docs(roadmap): mark phase N complete`) classifies 'state'; D4 dash variants accepted wherever the canonical dash is matched — all via phaseOwnPatterns fragments, prefix-anchored exactly as today (a mid-sentence quote stays foreign); the revert/scratch rules unchanged → verify: bash -c \"grep -qF 'mark phase' plugins/zeroh-roadmap/cli/lib/curate.mjs\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/gate.mjs',
          description:
            'deviantGrammarFindings: one WARN class per D1-D5 (D5 keeps its existing text), each naming the observed subject, its class, and the canonical form — tolerated is not silent (arc honesty rail 3) → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'fix(phase-\' cli/commands/gate.test.mjs && capbuild node --test cli/commands/gate.test.mjs >/dev/null 2>&1"',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/curate.test.mjs',
          description:
            'Curation-range tests from the recorded incident subjects: a range interleaving all five deviant classes for phase N plus canonical commits derives ok:true with zero foreign; the same range plus ONE sibling-phase subject refuses naming exactly that commit (both directions) → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'mark phase\' cli/lib/curate.test.mjs && capbuild node --test cli/lib/curate.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'The mudarabah2 incident range (verbatim subjects) curates clean; a genuinely foreign subject still refuses by name; every tolerated deviant emits its teaching WARN (all directions tested)',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/lib/curate.mjs',
        'plugins/zeroh-roadmap/cli/lib/curate.test.mjs',
        'plugins/zeroh-roadmap/cli/commands/gate.mjs',
        'plugins/zeroh-roadmap/cli/commands/gate.test.mjs',
      ],
      testMode: 'tdd',
      dependsOn: ['16.1'],
      interfaces: { consumes: ['phaseOwnPatterns(phaseNum) from 16.1'], produces: [] },
      done: true,
      doneDate: '2026-09-01',
      transparencyReport: {
        whatWasDone:
          'Curation now classifies canonical and tolerated D1-D5 subjects through the shared phaseOwnPatterns matcher while preserving scratch, batch, gate-fix, task, and state distinctions. Gate warnings cover every tolerated noncanonical form (D1, D2, D4, D5), collapse overlapping classes into one finding, and ignore foreign prose and canonical D3 completion commits.',
        how:
          'TDD: the resolved claude-opus-5 test-engineer added recorded-incident ranges, sibling and digit-boundary refusals, canonical negatives, and per-class warning fixtures, demonstrating RED in 7 new cases. A Decision Contract resolved the plan wording against the binding grammar: claude-fable-5 was unavailable, so gpt-5.6-sol returned PROCEED_WITH_FIX and kept D3 as canonical state while interpreting warnings as applying to noncanonical D1/D2/D4/D5. The combined scoped suites passed 98/98 after retaining the established warning prefix; the types slot was declared-none and green.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations: 'None',
      },
    },
    {
      id: '16.4',
      title: 'Committing agent cards carry the grammar (diet-funded, ledgered)',
      problem:
        'marketplace phase 10 recorded the fix verbatim ("pass the commit grammar into gate-agent prompts") and atlas 17 called the same gap "worth closing in the agent card" — the three cards that commit (quality-pass, software-developer, test-engineer) say nothing about subjects, and quality-pass.md already sits at 5,545 B against the ~5,000 ceiling.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/agents/quality-pass.md',
          description:
            'Add one line to each of the three cards: commit subjects MUST bind to the phase — `type(scope): phase N — <what>` (task form `phase N — N.X: <what>`; quality-pass fixes: `fix(scope): phase N gate RX — <what>`), em dash directly after the number; fund each addition byte-for-byte by compressing prose in the SAME card (quality-pass must land ≤ its current 5,545 B; the other two stay ≤5,000) → verify: bash -c "grep -qF \'phase N —\' plugins/zeroh-roadmap/agents/quality-pass.md && grep -qF \'phase N —\' plugins/zeroh-roadmap/agents/software-developer.md && grep -qF \'phase N —\' plugins/zeroh-roadmap/agents/test-engineer.md"',
        },
        {
          file: 'plugins/zeroh-roadmap/DIET-LEDGER.md',
          description:
            'One disposition row per compressed passage (grammar: passage | disposition | evidence), per the ledger\'s own honesty rail — a trim without a row is a gate failure; record before/after `wc -c` per card → verify: bash -c "grep -qE \'phase 16[^0-9]\' plugins/zeroh-roadmap/DIET-LEDGER.md"',
        },
      ],
      acceptanceCriteria: [
        'All three committing cards name the binding grammar; no card grew (wc -c before/after recorded in the ledger row); every compressed passage has its ledger disposition',
      ],
      files: [
        'plugins/zeroh-roadmap/agents/quality-pass.md',
        'plugins/zeroh-roadmap/agents/software-developer.md',
        'plugins/zeroh-roadmap/agents/test-engineer.md',
        'plugins/zeroh-roadmap/DIET-LEDGER.md',
      ],
      testMode: 'none',
      done: true,
      doneDate: '2026-09-01',
      transparencyReport: {
        whatWasDone:
          'Added the binding canonical subject grammar to quality-pass, software-developer, and test-engineer so every committing role teaches phase ownership, task form, gate-fix form, and the em-dash boundary. Added measured DIET-LEDGER dispositions for every passage compressed to fund the additions.',
        how:
          'Compressed only generic framing and examples while preserving every operative rule, then recorded four passage-level dispositions. Measured sizes moved from 5,545 to 5,543 B for quality-pass, 2,179 to 2,176 B for software-developer, and 2,877 to 2,859 B for test-engineer. Per-file grammar greps, the digit-bounded phase-16 ledger grep, size ceilings, git diff hygiene, and the declared-none types slot all passed.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations: 'None',
      },
    },
  ],
  notes:
    'interview: skipped — arc member; scope from the MINESWEEP arc record (LOCKED: read-side tolerance only; rejectedAlternatives bars widening the WRITE grammar). ' +
    'reviewScope full (attribution is the substrate every gate/curation decision stands on). ' +
    'Blast radius, checked and bounded: the fixed-string `phase N —` also appears in derive.mjs resume derivation via derivePhaseStartSha (inherits 16.2 through the shared helper — no separate edit) and in prose/error texts (teaching text, deliberately canonical-only); untestedGateFixFindings keeps its own bounded gate-fix regex (already tolerant of its form); landing.mjs deriveArcSuiteScope keeps its own DELIBERATELY-broader digit-bounded scan — fail-toward-full suite scope, not ownership attribution, so narrowing it to phaseOwnPatterns would change its conservative semantics (checked, excluded); phase.mjs (move commit) and landing.mjs deriveArcSuiteRange consume derivePhaseStartSha and inherit 16.2 exactly as derive.mjs does. 4 tasks — below the 5-8 target for a nameable reason: the change is one seam consumed three ways plus a card edit; padding would shard the seam. ' +
    'Verify rehearsal attestation: red-now probes executed 2026-08-31 — phaseOwnPatterns 0 hits, `mark phase` 0 hits in curate.mjs (step-verifies red for exactly the symbols their diffs add); the two negative greps (fixed-string grep removed from gitscan/gate) anchor on the exact template-literal line each diff deletes and each is paired with its phaseOwnPatterns positive; dry-run confirmed the pattern text appears nowhere in this phase\'s own step descriptions in writable position (the assumption block quotes it read-only); assumption probes all exit 0 (incl. the live git log -E probe); runner clauses inherit polarity from their grep representatives. ' +
    'Mode A review 2026-08-31 [FIXED]: all four assumption probes re-run, each exit 0 (incl. the live git log -E probe); both 16.2 negative greps confirmed RED today (the template-literal lines exist at gitscan.mjs:47 and gate.mjs:142 — correct post-diff polarity). Repaired: the three runner-only step verifies (16.2 s3, 16.3 s2, 16.3 s3) were GREEN today — node --test silently skips a nonexistent test-file pattern, so each gained a red-today grep guard on a symbol its diff adds; 16.4 s1\'s grep -qc passed on ANY card matching, now per-file &&-chained; 16.4 s2\'s `phase 16` anchor was GREEN today via the ledger\'s phase-1659 rows, now digit-bounded `phase 16[^0-9]` (red today, matches the new `phase 16.4` row); D4 pinned to a dash ALTERNATION group (multibyte chars in POSIX bracket expressions are locale-dependent under git regcomp); 16.2 gained the client-side subject confirm + body-quote fixture (git --grep scans whole messages — the deriveArcSuiteScope hazard, now closed at the attribution seam too). Metadata ratified: per-task tdd on 16.1-16.3, none on 16.4 (cards + ledger, no executable logic); reviewScope full stands; userFacing:false needs no flag. Queue untouched (--no-queue: the arc tier owns placement).',
})
