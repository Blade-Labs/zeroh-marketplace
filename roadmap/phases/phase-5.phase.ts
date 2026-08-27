import { definePhase } from '@/lib/roadmap/schema'

/**
 * The handoff skill — session continuity for work that has not yet
 * crystallized into phases.
 *
 * Operator ruling 2026-08-23: the IDEAL handoff is the typed artifacts —
 * "write all context inside an arc/phases and simply say do arc / do phase in
 * a fresh session." The skill is a ROUTER honoring that: route context INTO
 * phase notes / assumptions / arc decisions / the vault / `roadmap eval
 * lesson` FIRST; only the residue with no typed home lands in
 * `.building/HANDOFF.md`; the last output is the one-line prompt for the
 * fresh session, pointing at the right door.
 *
 * Evidence base (2026-08-23 survey): three real hand-written handoffs found —
 * /tmp/PROMPT-710-711.md (phases existed → file collapsed to invocation +
 * scope fence + release intent), /tmp/RESUME-702-703.md (mid-flight state
 * with shas; hand-invented "supersedes all earlier versions" discipline),
 * mudarabah2/.building/PHASE-713-HANDOFF.md + NEXT-SESSION-PROMPT.md — four
 * names, two locations (/tmp is per-box and died with the box migration).
 * The agreed-place problem is real and measured.
 */
export default definePhase({
  phase: 5,
  name: 'Handoff skill — route context into phases first, residue to .building/HANDOFF.md',
  status: 'done',
  plannedBy: { model: 'claude-opus-5[1m]' },
  category: 'feature',
  kind: 'logic',
  source:
    'Operator request 2026-08-23 ("one thing I always ask for"): mechanize the session-handoff file + one-line execution prompt; shape ratified in-session (router model, .building/ home, skill-only no CLI verb). Standalone phase — deliberately NOT POLYSEAT (its gate is ratified and queued).',
  priority: 'MEDIUM',
  dependsOn: [4],
  conflictsWith: [],
  keyFiles: [
    'plugins/zeroh-roadmap/skills/handoff/SKILL.md',
    'plugins/zeroh-roadmap/skills/handoff/references/template.md',
    'plugins/zeroh-roadmap/skills/handoff/evals/evals.json',
    'plugins/zeroh-roadmap/SKILL-AUTHORING-STANDARD.md',
  ],
  stakeholderDemo:
    'Ending a session is one skill call that files everything durable into the plan artifacts and leaves at most a small residue file — and starting the next session is one constant line, in any fresh window, on any model.',
  assumptions: [
    {
      claim:
        'No handoff/session-continuity skill exists in the plugin yet (the pattern lives only as hand-written files).',
      verify: 'bash -c "! test -d plugins/zeroh-roadmap/skills/handoff"',
      onFalse: 'ESCALATE',
    },
    {
      claim:
        "The manifest generator + ratchet from POLYSEAT phase 4 exist, so adding a skill directory must ride a regeneration or it reds the suite.",
      verify: 'test -f plugins/zeroh-roadmap/scripts/emit-manifests.mjs',
      onFalse: 'ESCALATE',
    },
    {
      claim:
        'The authoring standard is at v2 with PASS/FAIL rules the review task scores against.',
      verify:
        "grep -qF 'Skill Authoring Standard (SKILL.md Quality Bar) v2' plugins/zeroh-roadmap/SKILL-AUTHORING-STANDARD.md",
      onFalse: 'ESCALATE',
    },
  ],
  notes:
    "DESIGN (ratified in-session 2026-08-23, all decisions pre-made — implement, do not re-decide):\n\nTHE ROUTER PROTOCOL (the skill's core): at session end, for each candidate context item ask where it durably belongs and ROUTE IT THERE FIRST — design reasoning & learned code-facts → the phase's `notes`; new tripwires → `assumptions`; rulings → the arc's LOCKED DECISIONS; durable cross-project facts → the operator's vault (if bound); durable lessons → `roadmap eval lesson`. Committing phase-file edits IS the handoff. Only the measured residue classes land in .building/HANDOFF.md: scope fences · cross-phase intent (e.g. release framing) · mid-flight uncommitted state with shas + live background tasks + artifact URLs · unclear-awaiting-whom · ephemeral gotchas. Each residue line records WHY it was not routable — the self-liquidating property: the better the phases, the emptier the file.\n\nTHE ONE-LINER is the skill's final output, pointing at the right door: pure `do arc <ID>` / `do phase <N>`; hybrid `Read .building/HANDOFF.md (the fence), then do phase <N>`; pre-phase `Read .building/HANDOFF.md and continue from Next.` An agreed place makes the pickup line a CONSTANT — that is the whole win; pickup needs no skill.\n\nFILE CONTRACT: .building/HANDOFF.md, never committed (.building/ is the agreed untracked scratch home in every consumer — codex journals, arm files, driver provenance). Header carries freshness anchors: writtenAt · HEAD sha · 'supersedes previous' (the RESUME-702-703 discipline, mechanized); the template instructs the fresh session to run `git log --oneline <sha>..HEAD` and trust the repo over the file when they diverge. `--name <slug>` variant → .building/handoff-<slug>.md for parallel sessions on one repo; the default file lists siblings. PHASE-IN-FLIGHT REFUSAL: when `roadmap status` / the phase file already carry doing/state/next, the skill says so and refuses to duplicate them — the handoff exists ONLY for what has not crystallized.\n\nSKILL-ONLY, NO CLI VERB (ratified): routing is judgment (the skill half of the plugin's split); the mechanical bits (anchors, staleness diff) are three instructed lines — no TREE row, no protocol-load growth until proven needed.\n\nDEGREES OF FREEDOM (per the Anthropic best-practices doc, fetched 2026-08-23): routing decisions = high freedom (judgment checklist); the residue file format = strict template (references/template.md); the freshness check = low freedom (exact command, do not vary). EVAL-FIRST (the doc's 'Build evaluations first'): task 5.1 authors the three evaluation scenarios BEFORE the skill body — pure-phase (expect: routes everything, file near-empty, one-liner `do phase N`), hybrid (expect: fence + intent in file, hybrid one-liner), pre-phase freeform (expect: full residue file) — in the doc's evaluation JSON structure (skills/query/files/expected_behavior).\n\nREVIEW TASK 5.3 (operator-requested): score the FINISHED skill against BOTH bars — the Anthropic best-practices checklist (description third-person + triggers; body <500 lines; references one level deep; no time-sensitive info; consistent terminology — pick 'handoff' and never 'resume/prompt file'; concrete examples; workflow with checklist; feedback loop) AND the plugin's SKILL-AUTHORING-STANDARD v2 (every rule PASS/FAIL/N-A, delta-only paragraphs per R1). Name/description constraints: lowercase-hyphen ≤64 chars; description ≤1024 chars, third person, what + when with trigger terms (handoff, hand off, fresh session, continue in new session, context file, one-line prompt).\n\nMANIFEST INTERPLAY: phase 4's ratchet asserts manifest skill lists == ls skills/ — adding skills/handoff/ REDS the suite until scripts/emit-manifests.mjs regenerates; 5.4 runs it in the same commit as the skill directory (dependsOn [4]).\n\nREVIEW RATIFICATIONS (Mode A, 2026-08-23): R20 provenance rule — the skill's evidence-of-use line cites the 2026-08-23 survey by date + this phase's commit, NEVER the historical handoff filenames (5.3's terminology probe bans those tokens deliberately; consumer-repo paths would also break R21 portability). testMode 'none' ratified on all four tasks — every artifact is declarative (markdown/JSON/regenerated manifests); the guards are the step-level grep/node verifies plus phase 4's manifest ratchet, per the declarative-artifact rule (ratchet/lint lane, not bespoke tests). kind 'logic' accepted — the enum (mockup|logic|hardening|release) has no docs kind. The 5.2 <200-line cap is SKILL-AUTHORING-STANDARD R7's workflow cap, the DELIBERATE tighter of the two bars (the Anthropic doc's <500 is the looser; both must pass, the tighter binds — not drift). Assumption 2 fails at plan time BY DESIGN: it is the execution-time tripwire proving dependsOn [4] actually delivered scripts/emit-manifests.mjs before 5.4 leans on it.",
  gate: {
    lint: 'clean',
    typeCheck: 'clean',
    unitTests: {
      passed: 1260,
      total: 1260,
      notes:
        'The authoritative full plugin gate is roadmap/.gate/5/run-000010-2026-08-24T20-50-39-029Z.json: all 1,260 tests passed. lint, types, build, and integration are declared absent in gateCommands; the plugin-native history-comments scan and lint-diff hygiene slot also exited cleanly.',
    },
    integrationTests: {
      passed: 0,
      total: 0,
      notes: 'declared-none in gateCommands — this declarative skill phase has no integration tier.',
    },
    e2eTests: {
      passed: 0,
      total: 0,
      notes: 'declared-none in gateCommands — this phase adds no rendered surface.',
    },
    build: 'clean',
    preReview: 'clean',
  },
  gateRounds: [
    {
      round: 0,
      agent: 'quality-pass',
      verdict: 'findings-fixed',
      summary:
        'Corrected the skill provenance anchor to the committed eval artifact and, after an architect PROCEED_WITH_FIX verdict, replaced the speculative arc filename with the real POLYSEAT.arc.ts convention. The focused manifest test passed 15/15.',
    },
    {
      round: 1,
      agent: 'code-reviewer',
      verdict: 'findings-fixed',
      summary:
        'Closed four contract gaps: the hybrid eval now targets POLYSEAT phase 4 and emits its exact phase invocation, handoff and do-arc name their two-way boundary, the always-active router dispatches handoff requests, and task 5.4 records the generator output actually changed.',
    },
    {
      round: 2,
      agent: 'code-reviewer',
      verdict: 'findings-fixed',
      summary:
        'The do-arc protocol-load ratchet exposed the new routing prose as over budget. Compressed the boundary and dispatch wording without dropping the rule, recorded the diet, and proved 13,253 tokens against the 13,257 ceiling plus 10/10 focused measure tests.',
    },
    {
      round: 3,
      agent: 'code-reviewer',
      verdict: 'clean',
      summary:
        'Convergence review returned no findings after independently checking the eval routes, handoff/do-arc ownership boundary, generated discovery inventory, authoring scorecards, protocol-load budget, and task evidence.',
    },
  ],
  metrics: {
    commits: 1,
    linesAdded: 232,
    linesRemoved: 17,
    filesChanged: 8,
    testsAtStart: 1260,
    testsAtEnd: 1260,
    testsAdded: 0,
    startedAt: '2026-08-24T19:25:56Z',
    completedAt: '2026-08-24T20:52:26Z',
    haltCount: 0,
  },
  compromises: 'None',
  completedDate: '2026-08-24',
  executionResult: {
    phase: 5,
    status: 'done',
    driver: { model: 'gpt-5.6-sol', lane: 'codex' },
    roles: [
      { role: 'quality-pass', model: 'claude-opus-5', via: 'child-cli' },
      { role: 'software-architect', model: 'claude-fable-5', via: 'child-cli' },
      { role: 'code-reviewer', model: 'claude-fable-5', via: 'child-cli' },
      { role: 'code-reviewer', model: 'claude-fable-5', via: 'child-cli' },
      { role: 'code-reviewer', model: 'claude-fable-5', via: 'child-cli' },
    ],
    compromises: [],
    skipped: [],
    hardcoded: [],
    surfaced: [
      'The envelope-prescribed scoped helper scripts/test/run-tier.sh does not exist in this checkout. Its exact invocation exited 127; no substitute tier command was invented. The focused manifest test and the authoritative full gate supplied the proof.',
      'The first full gate was environmental RED because the plugin-local node_modules tree was absent (79 failures, all missing dependencies). A capbuild-wrapped local npm install restored the declared environment, and the authoritative rerun passed 1,260/1,260.',
      'The quality pass raised a speculative arc-path hard stop. The bound software-architect returned PROCEED_WITH_FIX, and the executor corrected both the eval fixture and skill pattern to the repository\'s real <ID>.arc.ts convention.',
      'roadmap phase curate rewrote the required lane trailer to its generic Claude trailer. The executor amended only the newly curated commit message to restore the exact Claude Fable 5 trailer required by this lane.',
    ],
    hardStops: [],
    gateRounds: 4, // trued 3→4 (phase 13.8): the convention counts every recorded round INCLUDING round 0
  },
  tasks: [
    {
      id: '5.1',
      title: 'Evaluations first — three scenarios with expected routing behaviour',
      problem:
        "The best-practices doc is explicit: build evaluations BEFORE writing extensive documentation, so the skill solves the three measured cases (PROMPT-710-711's pure-phase collapse, RESUME-702-703's mid-flight state, the freeform NEXT-SESSION case) rather than imagined ones.",
      steps: [
        {
          file: 'plugins/zeroh-roadmap/skills/handoff/evals/evals.json',
          description:
            "Author the three scenarios ({skills, query, files, expected_behavior} per the doc's structure) mapping 1:1 to the notes' EVAL-FIRST cases: phases-exist, hybrid mid-arc, pre-phase freeform; each expected_behavior names routing destinations → verify: node -e \"const e=require('./plugins/zeroh-roadmap/skills/handoff/evals/evals.json'); process.exit(e.length===3 && e.every(x=>Array.isArray(x.expected_behavior)&&x.expected_behavior.length>=3)?0:1)\"",
        },
      ],
      acceptanceCriteria: [
        'Three evaluation scenarios exist, each with ≥3 expected behaviours naming routing destinations',
        'The scenarios map 1:1 to the three measured hand-written precedents from the 2026-08-23 survey',
      ],
      files: ['plugins/zeroh-roadmap/skills/handoff/evals/evals.json'],
      testMode: 'none',
      transparencyReport: {
        whatWasDone:
          'Added three handoff evaluation scenarios in the established skills/query/files/expected_behavior shape: pure phase, hybrid mid-arc, and pre-phase freeform. Each scenario names at least four observable outcomes, including the durable routing destination, the permitted residue behavior, and the exact fresh-session invocation door.',
        how:
          'Authored the evaluations before the skill body so tasks 5.2 and 5.3 have concrete behavioral targets. The pure case routes phase-owned facts to notes and assumptions and emits `do phase 5`; the hybrid case separates arc/phase facts from a justified fence and mid-flight residue; the pre-phase case preserves unroutable discovery state while still routing vault facts and lessons. Verified the JSON loads with exactly three entries and every expected_behavior array has at least three items; the phase types slot was GREEN as declared-none.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'These are declarative evaluation fixtures, not executable assertions. Their behavioral scoring intentionally occurs when the finished skill is reviewed against the scenarios in task 5.3 and the phase gate.',
      },
      done: true,
      doneDate: '2026-08-24',
    },
    {
      id: '5.2',
      title: 'The skill body and template — router protocol, residue contract, constant one-liner',
      problem:
        'The pattern exists only as four differently-named hand-written files in two locations, one of which (/tmp) died with the box migration. The skill mechanizes the routing judgment and fixes the agreed place.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/skills/handoff/SKILL.md',
          description:
            "Author per the notes' design: frontmatter (name 'handoff'; third-person description with trigger terms, ≤1024 chars); body = the routing checklist (destinations table with the copy-progress checklist pattern), the residue classes with why-not-routable discipline, the phase-in-flight refusal, the one-liner emission rule (three doors), --name variant, freshness-anchor writing; template by reference one level deep. Consistent terminology: 'handoff' only; R20 provenance per the notes' ratification block → verify: bash -c \"head -8 plugins/zeroh-roadmap/skills/handoff/SKILL.md | grep -qE '^name: *\\\"?handoff' && test $(wc -l < plugins/zeroh-roadmap/skills/handoff/SKILL.md) -lt 200\"",
        },
        {
          file: 'plugins/zeroh-roadmap/skills/handoff/references/template.md',
          description:
            'The strict residue-file template: header line (mission · writtenAt · HEAD <sha> · supersedes previous), sections Invocation / Fence / State (shas, background tasks, artifact URLs) / Unclear (awaiting whom) / Residue (item + why-not-routable each) / Siblings; plus the exact low-freedom pickup staleness command (`git log --oneline <sha>..HEAD` — trust the repo over the file) → verify: grep -qF "supersedes previous" plugins/zeroh-roadmap/skills/handoff/references/template.md',
        },
      ],
      acceptanceCriteria: [
        'SKILL.md body under 200 lines with the template one reference-level deep, routing table present, all three one-liner doors named',
        'Running the skill against eval scenario 1 mentally satisfies its expected_behavior: durable items route to phase artifacts, not the file',
      ],
      files: [
        'plugins/zeroh-roadmap/skills/handoff/SKILL.md',
        'plugins/zeroh-roadmap/skills/handoff/references/template.md',
      ],
      testMode: 'none',
      transparencyReport: {
        whatWasDone:
          'Created the 68-line handoff workflow and its one-level strict template reference. The workflow inspects roadmap state, routes five durable context classes into phase notes, assumptions, arc locked decisions, a bound operator vault, or `roadmap eval lesson`, refuses phase-in-flight duplication, admits only five residue classes with a why-not-routable reason, writes freshness anchors, supports named parallel handoffs, and emits one of three literal pickup lines.',
        how:
          'Implemented the high-freedom routing judgment as a destination checklist and the low-freedom residue contract as `references/template.md`. The template fixes the header and section schema, includes writtenAt/HEAD/supersedes-previous anchors, and carries the exact `git log --oneline <sha>..HEAD` reconciliation command. Mentally applied eval scenario 1: its design facts and tripwires route to the phase artifacts, no residue file is required, and the final line is `do phase 5`. The skill-creator validator reported `Skill is valid!`; the planned grep checks, 68-line body cap, terminology probe, diff check, and declared-none types slot all passed.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'Vault routing is conditional on a repository already binding an operator vault; the skill does not invent a vault path. The phase-in-flight duplication refusal is explicitly honor-system because this judgment workflow has no CLI verb by design.',
      },
      done: true,
      doneDate: '2026-08-24',
    },
    {
      id: '5.3',
      title: 'Score the finished skill against both authoring bars, fix what fails',
      problem:
        'The operator explicitly requested the final skill be reviewed against the Anthropic best-practices doc; the gauntlet standard additionally binds every new plugin skill ("must pass it"). An unscored skill is an unshipped one.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/skills/handoff/SKILL.md',
          description:
            "Score rule-by-rule against (a) SKILL-AUTHORING-STANDARD.md v2 (every rule PASS/FAIL/N-A, scoring computed) and (b) the Anthropic checklist enumerated in the notes' REVIEW TASK 5.3 block; FIX every FAIL in place; full scorecard into the transparencyReport → verify: bash -c \"grep -qE 'name: *\\\"?handoff' plugins/zeroh-roadmap/skills/handoff/SKILL.md && ! grep -riE 'resume file|prompt file|next-session' plugins/zeroh-roadmap/skills/handoff/SKILL.md plugins/zeroh-roadmap/skills/handoff/references/template.md\" (evals.json deliberately excluded — scenario text may quote the historical filenames it mechanizes away)",
        },
      ],
      acceptanceCriteria: [
        'Both scorecards recorded in the transparencyReport with zero unfixed FAILs',
        "Terminology probe passes: the skill never calls the artifact anything but 'handoff'",
      ],
      files: ['plugins/zeroh-roadmap/skills/handoff/SKILL.md'],
      testMode: 'none',
      transparencyReport: {
        whatWasDone:
          'Scored the finished handoff skill against all 28 rules in SKILL-AUTHORING-STANDARD v2 and all eight checklist groups enumerated from the Anthropic best-practices review brief. Fixed the two initial wording failures in place: made the provenance paragraph imperative for R10 and named honor-system review enforcement for the no-trailing-commentary output rule under R28. The finished review has zero unfixed FAILs.',
        how:
          'V2 SCORECARD — R1 PASS: every paragraph carries handoff-specific paths, commands, artifacts, or vocabulary. R2 PASS: every H2 contains a literal path, command, schema field, or numbered contract. R3 PASS: the 260-character third-person description states capability and five trigger shapes. R4 PASS: handoff and do-arc now name their boundary between cross-session residue and optional execution-loop pause notes. R5 N-A: no deploy, release, production mutation, destructive operation, or paid API step. R6 PASS: frontmatter contains only name and description. R7 PASS: 69 lines, below the ratified 200-line workflow cap. R8 PASS: the sole one-level reference is cited at writing, completion, and staleness-check points. R9 PASS: deterministic status, SHA, lesson, and staleness operations use roadmap/git commands; only routing judgment remains prose. R10 PASS after fix: paragraphs use imperative instructions. R11 PASS: headings reconstruct inspect -> route -> classify -> write -> emit -> check. R12 PASS: commands and variable placeholders are literal and defined. R13 PASS: unreadable status/files, anchor failure, ambiguous ownership, and stale HEAD each name STOP/refusal/reconciliation behavior. R14 PASS: every gotcha pairs an observable condition with its response. R15 PASS: routing, residue, and template facts each have one owner. R16 PASS: no CLAUDE.md rule is restated. R17 PASS: handoff and do-arc both assign the overlap and prohibit duplicate residue. R18 PASS: independent activation is justified and the body exceeds 15 lines. R19 PASS: no newer sibling, command, or repository rule contradicts it. R20 PASS: provenance cites the dated survey recorded in the phase file, without historical consumer filenames. R21 PASS: cited repository paths resolve or are explicit produced-artifact patterns; roadmap status/eval lesson and git commands exist. R22 N-A: no tuned numeric threshold beyond the standard-derived 200-line cap, which the phase binds and this report records. R23 PASS: done is a routed roadmap edit and literal pickup line, or a template-conformant handoff and literal pickup line. R24 PASS: the full handoff template and all three downstream lines are literal. R25 PASS: only stable paths, commands, fields, and headings are anchors. R26 PASS: the only date is provenance. R27 PASS: replacement and supersedes-previous semantics prohibit amendment strata. R28 PASS after fix: the sole NEVER is explicitly honor-system and pickup-line enforcement is named as review-time honor-system. ANTHROPIC SCORECARD — PASS description is third-person with capability and triggers; PASS body is 69 lines (<500); PASS reference depth is one; PASS content is timeless apart from required dated provenance; PASS terminology uses handoff and the banned terminology probe is clean; PASS concrete examples are the routing table, strict template, and three literal pickup lines; PASS the six-stage workflow includes a progress checklist; PASS the final status/staleness checks form a feedback loop. Verified the exact terminology command, skill-creator validation, diff check, and declared-none types slot.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'The score is a static artifact review rather than a live model-forward evaluation. The three committed evaluation scenarios remain the behavioral evidence surface for the phase gate; this task changes only wording needed to make the authoring bars fully pass.',
      },
      done: true,
      doneDate: '2026-08-24',
    },
    {
      id: '5.4',
      title: 'Manifests regenerated — the new skill ships to every harness',
      problem:
        "Phase 4's ratchet asserts every manifest's skill list equals ls skills/ — adding skills/handoff/ without regenerating reds the plugin suite, and NOT shipping it to codex/cursor/gemini would re-open the no-claude-privilege gap for this skill.",
      steps: [
        {
          file: 'plugins/zeroh-roadmap/scripts/emit-manifests.mjs',
          description:
            'Run the generator (no edits to it); commit the regenerated manifests in the same commit as the skill directory; the ratchet in the plugin suite is the proof → verify: capbuild node plugins/zeroh-roadmap/scripts/emit-manifests.mjs --check',
        },
      ],
      acceptanceCriteria: [
        "Every harness resolves the skills directory, the generated Codex inventory lists 'handoff', and the plugin suite's manifest ratchet is green",
      ],
      files: ['plugins/zeroh-roadmap/.codex/INSTALL.md'],
      testMode: 'none',
      transparencyReport: {
        whatWasDone:
          'Ran the manifest generator after adding `skills/handoff/`. The five declared harness manifests remained byte-identical because each already points at the whole skills directory; the generator updated its Codex surfaced-inventory artifact, `plugins/zeroh-roadmap/.codex/INSTALL.md`, from 12 to 13 skills and added handoff to the generated list.',
        how:
          'Executed `capbuild node plugins/zeroh-roadmap/scripts/emit-manifests.mjs`, then its `--check` mode successfully. Confirmed the Codex, Cursor, Copilot, and Gemini manifests route their skills directory and the Claude manifest uses Claude plugin discovery, so the new directory ships without per-skill manifest edits. The types slot was GREEN as declared-none. Attempted the prescribed scoped command `capbuild bash scripts/test/run-tier.sh unit plugins/zeroh-roadmap/scripts/emit-manifests.test.mjs`; it exited 127 because this repository does not contain `scripts/test/run-tier.sh`. No substitute scoped command was invented; the configured full gate will execute the plugin suite and its manifest ratchet.',
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          'The original task files list named five directory-pointer manifests but omitted `plugins/zeroh-roadmap/.codex/INSTALL.md`, the generator\'s only changed output; correctness Round 1 repaired the task record to name the generated inventory and the directory-discovery contract. Scoped tier execution is unavailable in this checkout because the envelope-named helper path does not exist, so the manifest ratchet was proven by its focused node test and the full gate.',
      },
      done: true,
      doneDate: '2026-08-24',
    },
  ],
})
